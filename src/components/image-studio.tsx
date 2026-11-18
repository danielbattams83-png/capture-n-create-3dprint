"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ImageIcon, LoaderCircle, Sparkles } from "lucide-react";
import { saveConceptHandoff } from "@/lib/concept-handoff";
import {
  isTransientRequestFailure,
  reconnectDelayMs,
  waitForPoll,
} from "@/lib/resilient-poll";

const STYLE_CHIPS = [
  "3D printable figurine",
  "Relief coin emblem",
  "Low-poly prop",
] as const;

const ASPECT_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16"] as const;
const MODELS = [
  { value: "nano-banana", label: "Standard" },
  { value: "nano-banana-2", label: "Sharper" },
  { value: "gpt-image-2", label: "Studio" },
] as const;

type AspectRatio = (typeof ASPECT_RATIOS)[number];
type ImageModel = (typeof MODELS)[number]["value"];
type ImageStatus = "idle" | "submitting" | "generating" | "reconnecting" | "ready" | "error";

type ConceptImage = {
  remoteUrl: string;
  previewUrl: string;
};

type ImageCredentials = {
  task_id: string;
  task_token: string;
};

const checkerboard = {
  backgroundColor: "#0e141c",
  backgroundImage:
    "linear-gradient(45deg, #1c2633 25%, transparent 25%), linear-gradient(-45deg, #1c2633 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1c2633 75%), linear-gradient(-45deg, transparent 75%, #1c2633 75%)",
  backgroundSize: "20px 20px",
  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
} as const;

function readError(value: unknown): string | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return undefined;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function ImageStudio() {
  const router = useRouter();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const credentials = useRef<ImageCredentials | null>(null);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ImageModel>("nano-banana");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [removeBackground, setRemoveBackground] = useState(true);
  const [multiView, setMultiView] = useState(false);
  const [status, setStatus] = useState<ImageStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [images, setImages] = useState<ConceptImage[]>([]);
  const [canResume, setCanResume] = useState(false);

  useEffect(() => {
    return () => {
      activeRequest.current?.abort();
      setImages((current) => {
        current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
        return current;
      });
    };
  }, []);

  const resizePrompt = () => {
    const field = promptRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  };

  const replaceImages = (next: ConceptImage[]) => {
    setImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return next;
    });
  };

  const loadPreviews = async (
    urls: string[],
    nextCredentials: ImageCredentials,
    signal: AbortSignal,
  ) => {
    const previews = await Promise.all(
      urls.slice(0, 4).map(async (url) => {
        const response = await fetch("/api/image/file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...nextCredentials, url }),
          signal,
        });
        if (!response.ok) {
          const result = await readJson(response);
          throw new Error(readError(result) ?? "The generated image could not be displayed.");
        }
        const blob = await response.blob();
        return { remoteUrl: url, previewUrl: URL.createObjectURL(blob) };
      }),
    );
    if (!signal.aborted) replaceImages(previews);
  };

  const pollImage = async (nextCredentials: ImageCredentials, controller: AbortController) => {
    setStatus("generating");
    let transientAttempts = 0;
    for (let attempt = 0; attempt < 120; ) {
      const delay = transientAttempts > 0 ? reconnectDelayMs(transientAttempts) : attempt === 0 ? 0 : 4000;
      if (delay > 0) await waitForPoll(delay, controller.signal);
      let response: Response;
      try {
        response = await fetch("/api/image/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextCredentials),
          signal: controller.signal,
        });
      } catch (pollError) {
        if (controller.signal.aborted || !isTransientRequestFailure(pollError)) throw pollError;
        transientAttempts += 1;
        setStatus("reconnecting");
        continue;
      }
      const result = await readJson(response);
      if (!response.ok) {
        if (isTransientRequestFailure(null, response.status)) {
          transientAttempts += 1;
          setStatus("reconnecting");
          continue;
        }
        throw new Error(readError(result) ?? "Image progress could not be checked.");
      }
      if (
        typeof result !== "object" ||
        result === null ||
        !("status" in result) ||
        typeof result.status !== "string"
      ) {
        throw new Error("The image service returned an invalid task status.");
      }
      transientAttempts = 0;
      setStatus((current) => (current === "reconnecting" ? "generating" : current));
      if ("progress" in result && typeof result.progress === "number") {
        setProgress(Math.min(100, Math.max(0, result.progress)));
      }
      if (result.status === "FAILED" || result.status === "CANCELED") {
        throw new Error(readError(result) ?? "The image could not be generated.");
      }
      if (result.status !== "SUCCEEDED") {
        attempt += 1;
        continue;
      }
      const urls =
        "image_urls" in result && Array.isArray(result.image_urls)
          ? result.image_urls.filter((url): url is string => typeof url === "string")
          : [];
      if (urls.length === 0) throw new Error("Image generation finished without a file.");
      await loadPreviews(urls, nextCredentials, controller.signal);
      setProgress(100);
      setStatus("ready");
      return;
    }
    throw new Error("Image generation is still running. Resume to keep checking the same task.");
  };

  const resumeImage = async () => {
    const existing = credentials.current;
    if (!existing) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setError("");
    try {
      await pollImage(existing, controller);
    } catch (generationError) {
      if (generationError instanceof Error && generationError.name === "AbortError") return;
      setError(generationError instanceof Error ? generationError.message : "Image generation failed.");
      setStatus("error");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  };

  const generateImage = async (force = false) => {
    const trimmed = prompt.trim();
    if (!trimmed || status === "submitting" || status === "generating") return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setStatus("submitting");
    setProgress(0);
    setError("");
    replaceImages([]);
    try {
      let response: Response | null = null;
      let transientAttempts = 0;
      const requestBody = {
        prompt: trimmed,
        ai_model: model,
        aspect_ratio: aspectRatio,
        remove_background: removeBackground,
        generate_multi_view: multiView,
        ...(force ? { idempotency_nonce: crypto.randomUUID() } : {}),
      };
      while (!response || (!response.ok && response.status >= 500)) {
        if (response) {
          transientAttempts += 1;
          setStatus("reconnecting");
          await waitForPoll(reconnectDelayMs(transientAttempts), controller.signal);
        }
        try {
          response = await fetch("/api/image/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
        } catch (createError) {
          if (controller.signal.aborted || !isTransientRequestFailure(createError)) throw createError;
          transientAttempts += 1;
          setStatus("reconnecting");
          await waitForPoll(reconnectDelayMs(transientAttempts), controller.signal);
        }
      }
      const result = await readJson(response);
      if (!response.ok) throw new Error(readError(result) ?? "Image generation could not be started.");
      if (
        typeof result !== "object" ||
        result === null ||
        !("task_id" in result) ||
        typeof result.task_id !== "string" ||
        !("task_token" in result) ||
        typeof result.task_token !== "string"
      ) {
        throw new Error("The image service returned invalid task credentials.");
      }
      credentials.current = { task_id: result.task_id, task_token: result.task_token };
      setCanResume(true);
      if (
        "status" in result &&
        result.status === "succeeded" &&
        "image_urls" in result &&
        Array.isArray(result.image_urls)
      ) {
        const urls = result.image_urls.filter((url): url is string => typeof url === "string");
        if (urls.length > 0) {
          await loadPreviews(urls, credentials.current, controller.signal);
          setProgress(100);
          setStatus("ready");
          return;
        }
      }
      await pollImage(credentials.current, controller);
    } catch (generationError) {
      if (generationError instanceof Error && generationError.name === "AbortError") return;
      if (isTransientRequestFailure(generationError)) {
        setStatus("reconnecting");
        return;
      }
      setError(generationError instanceof Error ? generationError.message : "Image generation failed.");
      setStatus("error");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const restore = async () => {
      try {
        const response = await fetch("/api/jobs/active", { cache: "no-store", signal: controller.signal });
        const result = await readJson(response);
        if (!response.ok || typeof result !== "object" || result === null || !("jobs" in result)) return;
        if (!Array.isArray(result.jobs)) return;
        const job = result.jobs.find(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            "type" in item &&
            item.type === "image" &&
            "meshyTaskId" in item &&
            typeof item.meshyTaskId === "string" &&
            "taskToken" in item &&
            typeof item.taskToken === "string",
        );
        if (!job || typeof job !== "object") return;
        const parameters = "parameters" in job && typeof job.parameters === "object" && job.parameters
          ? job.parameters
          : null;
        if (parameters && "prompt" in parameters && typeof parameters.prompt === "string") {
          setPrompt(parameters.prompt);
        }
        if (parameters && "removeBackground" in parameters && parameters.removeBackground === false) {
          setRemoveBackground(false);
        }
        if (parameters && "generateMultiView" in parameters && parameters.generateMultiView === true) {
          setMultiView(true);
        }
        credentials.current = {
          task_id: job.meshyTaskId as string,
          task_token: job.taskToken as string,
        };
        setCanResume(true);
        const output = "outputUrls" in job && typeof job.outputUrls === "object" ? job.outputUrls : null;
        const savedUrls =
          output && "images" in output && Array.isArray(output.images)
            ? output.images.filter((url: unknown): url is string => typeof url === "string")
            : [];
        if ("status" in job && job.status === "succeeded" && savedUrls.length > 0) {
          await loadPreviews(savedUrls, credentials.current, controller.signal);
          setStatus("ready");
          setProgress(100);
          return;
        }
        if ("status" in job && (job.status === "queued" || job.status === "processing")) {
          if (typeof job.progress === "number") setProgress(job.progress);
          await pollImage(credentials.current, controller);
        }
      } catch (restoreError) {
        if (controller.signal.aborted || isTransientRequestFailure(restoreError)) return;
        console.error("Could not restore the image job.", restoreError);
      }
    };
    void restore();
    return () => controller.abort();
    // Restore the in-flight image once. Later generates own their requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = status === "submitting" || status === "generating" || status === "reconnecting";

  const sendToModel = () => {
    const existing = credentials.current;
    if (!existing || images.length === 0) return;
    saveConceptHandoff({
      urls: images.map((image) => image.remoteUrl),
      skipPreprocessing: removeBackground,
      taskId: existing.task_id,
      taskToken: existing.task_token,
    });
    router.push("/create-model");
  };

  const downloadImage = (image: ConceptImage, index: number) => {
    const link = document.createElement("a");
    link.href = image.previewUrl;
    link.download = `aces-concept-${index + 1}.png`;
    link.click();
  };

  return (
    <main className="min-h-[calc(100vh-140px)] bg-[#0b0d10] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[#60a5fa]">
            Image workspace
          </p>
          <h1 className="mt-2 text-[clamp(1.8rem,6vw,3rem)] font-bold leading-[1.05] tracking-[-0.045em]">
            Draw the concept first.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#aeb8c4]">
            Generate a clean reference image, then send it straight into the model studio.
          </p>
        </div>

        <section className="rounded-[22px] border border-white/[0.08] bg-[#12151E] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] sm:p-5">
          <label htmlFor="concept-prompt" className="text-xs font-semibold text-[#d7dde5]">
            Prompt
          </label>
          <textarea
            id="concept-prompt"
            ref={promptRef}
            rows={3}
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              resizePrompt();
            }}
            placeholder="A small ceramic fox figurine, front view, crisp edges, studio light"
            className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-[#232832] bg-[#0b0d10] px-4 py-3 text-base leading-6 text-white outline-none placeholder:text-[#6b7280] focus:border-[#3b82f6]"
          />
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {STYLE_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => {
                  setPrompt(chip);
                  window.setTimeout(resizePrompt, 0);
                }}
                className="shrink-0 rounded-full border border-[#2a3340] bg-[#0b0d10] px-3 py-1.5 text-xs font-medium text-[#bfdbfe] transition hover:border-[#3b82f6]"
              >
                {chip}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void generateImage(status === "ready" || status === "error")}
            disabled={!prompt.trim() || status === "submitting" || status === "generating"}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2563eb] text-sm font-semibold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#303946] disabled:text-[#8993a0]"
          >
            {busy ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Sparkles aria-hidden="true" className="size-4" />
            )}
            {status === "reconnecting"
              ? "Reconnecting..."
              : status === "submitting"
                ? "Starting..."
                : status === "generating"
                  ? `Generating ${Math.round(progress)}%`
                  : "Generate Image"}
          </button>
        </section>

        <section className="rounded-[22px] border border-white/[0.08] bg-[#12151E] p-4 sm:p-5">
          <p className="text-xs font-semibold text-[#d7dde5]">3D-ready options</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={removeBackground}
              onClick={() => setRemoveBackground((current) => !current)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                removeBackground
                  ? "border-[#3b82f6] bg-[#17243a] text-[#bfdbfe]"
                  : "border-[#2a3340] text-[#9ca3af]"
              }`}
            >
              Transparent background
            </button>
            <button
              type="button"
              aria-pressed={multiView}
              onClick={() => setMultiView((current) => !current)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                multiView
                  ? "border-[#3b82f6] bg-[#17243a] text-[#bfdbfe]"
                  : "border-[#2a3340] text-[#9ca3af]"
              }`}
            >
              Multi-view
            </button>
          </div>
          {multiView ? null : (
            <div className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none]" role="group" aria-label="Aspect ratio">
              {ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  aria-pressed={aspectRatio === ratio}
                  onClick={() => setAspectRatio(ratio)}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 font-mono text-[11px] ${
                    aspectRatio === ratio
                      ? "border-[#3b82f6] text-[#bfdbfe]"
                      : "border-[#2a3340] text-[#9ca3af]"
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none]" role="group" aria-label="Image model">
            {MODELS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={model === option.value}
                onClick={() => setModel(option.value)}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  model === option.value
                    ? "border-[#3b82f6] text-white"
                    : "border-[#2a3340] text-[#9ca3af]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section aria-live="polite" className="rounded-[22px] border border-white/[0.08] bg-[#12151E] p-4 sm:p-5">
          {images.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center text-center">
              <ImageIcon aria-hidden="true" className="size-6 text-[#60a5fa]" />
              <p className="mt-3 text-sm font-semibold">
                {status === "reconnecting" ? "Reconnecting..." : "Your concept will appear here"}
              </p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-[#9ca3af]">
                {busy
                  ? "Meshy is painting the reference. You can leave and come back."
                  : "A transparent cutout is shown on a checkerboard so you can check the edges."}
              </p>
            </div>
          ) : (
            <div className={`grid gap-3 ${images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {images.map((image, index) => (
                <figure key={image.remoteUrl} className="overflow-hidden rounded-2xl border border-[#232832]">
                  <div className="flex min-h-56 items-center justify-center p-3" style={checkerboard}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.previewUrl}
                      alt={`Generated concept ${index + 1}`}
                      className="max-h-80 w-full object-contain"
                    />
                  </div>
                  <figcaption className="flex justify-end border-t border-[#232832] p-2">
                    <button
                      type="button"
                      onClick={() => downloadImage(image, index)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a3340] px-3 py-1.5 text-xs font-semibold text-[#d7dde5]"
                    >
                      <Download aria-hidden="true" className="size-3.5" />
                      Download PNG
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}

          {error ? (
            <p role="alert" className="mt-3 text-xs leading-5 text-[#fda4af]">
              {error}
            </p>
          ) : null}

          {status === "error" || status === "reconnecting" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void resumeImage()}
                disabled={!canResume}
                className="rounded-lg border border-[#3b82f6]/50 px-3 py-2 text-xs font-semibold text-[#bfdbfe] disabled:opacity-50"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={() => void generateImage(true)}
                className="rounded-lg bg-[#2563eb] px-3 py-2 text-xs font-semibold text-white"
              >
                Generate again
              </button>
            </div>
          ) : null}

          {status === "ready" && images.length > 0 ? (
            <button
              type="button"
              onClick={sendToModel}
              className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-[#2563eb] text-sm font-semibold text-white transition hover:bg-[#1d4ed8]"
            >
              Create 3D Model →
            </button>
          ) : null}
        </section>
      </div>
    </main>
  );
}
