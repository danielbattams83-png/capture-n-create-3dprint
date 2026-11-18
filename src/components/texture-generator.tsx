"use client";

import Image from "next/image";
import { Check, ImageIcon, LoaderCircle, Paintbrush, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { uploadTemporaryFiles } from "@/lib/client-blob-upload";

type TextureSourceImage = {
  file: File;
  previewUrl: string;
};

type TextureGeneratorProps = {
  model: Blob;
  sourceImages?: TextureSourceImage[];
  sourceTask?: {
    taskId: string;
    taskType: "image-to-3d" | "multi-image-to-3d";
    taskToken: string;
  };
  onTextureReady: (model: Blob) => void | Promise<void>;
};

type TextureMode = "prompt" | "photo";

type TextureStatus = "idle" | "submitting" | "generating" | "applying" | "done" | "error";

const STYLE_PRESETS = [
  { value: "realistic", label: "Realistic PBR" },
  { value: "stylized", label: "Stylized" },
  { value: "hand_painted", label: "Hand-painted" },
  { value: "weathered", label: "Weathered" },
  { value: "minimal", label: "Minimal" },
] as const;

function getResponseError(value: unknown): string | undefined {
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

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Texture generation canceled.", "AbortError"));
      },
      { once: true },
    );
  });
}

export default function TextureGenerator({
  model,
  sourceImages = [],
  sourceTask,
  onTextureReady,
}: TextureGeneratorProps) {
  const [mode, setMode] = useState<TextureMode>("prompt");
  const [prompt, setPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState("realistic");
  const [status, setStatus] = useState<TextureStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => activeRequest.current?.abort();
  }, []);

  const generateTexture = async () => {
    const trimmedPrompt = prompt.trim();
    const usingPhoto = mode === "photo";
    if (usingPhoto ? sourceImages.length === 0 : !trimmedPrompt) return;
    if (status === "submitting" || status === "generating" || status === "applying") return;

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setStatus("submitting");
    setProgress(0);
    setError("");

    try {
      const photoUpload = usingPhoto
        ? await uploadTemporaryFiles({
            files: sourceImages.map(({ file }) => file),
            kind: "image",
            signal: controller.signal,
            onProgress: setProgress,
          })
        : null;
      const modelSource = sourceTask
        ? {
            input_task_id: sourceTask.taskId,
            input_task_type: sourceTask.taskType,
            source_task_token: sourceTask.taskToken,
          }
        : await uploadTemporaryFiles({
            files: [
              new File([model], "active-model.glb", { type: "model/gltf-binary" }),
            ],
            kind: "model",
            signal: controller.signal,
            onProgress: setProgress,
          }).then((uploaded) => ({
            model_url: uploaded.urls[0],
            upload_authorization: uploaded.authorization,
          }));

      const createResponse = await fetch("/api/meshy-texture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...modelSource,
          ...(photoUpload
            ? {
                image_urls: photoUpload.urls,
                image_upload_authorization: photoUpload.authorization,
              }
            : {
                prompt: trimmedPrompt,
                style_preset: stylePreset,
              }),
        }),
        signal: controller.signal,
      });
      const createResult = await readJson(createResponse);
      if (!createResponse.ok) {
        throw new Error(
          getResponseError(createResult) ?? "Texture generation could not be started.",
        );
      }
      if (
        typeof createResult !== "object" ||
        createResult === null ||
        !("task_id" in createResult) ||
        typeof createResult.task_id !== "string" ||
        !("task_token" in createResult) ||
        typeof createResult.task_token !== "string"
      ) {
        throw new Error("The texture service returned invalid task credentials.");
      }

      const credentials = {
        task_id: createResult.task_id,
        task_token: createResult.task_token,
      };
      setStatus("generating");

      for (let attempt = 0; attempt < 720; attempt += 1) {
        if (attempt > 0) await wait(5000, controller.signal);
        const statusResponse = await fetch("/api/meshy-texture/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credentials),
          signal: controller.signal,
        });
        const statusResult = await readJson(statusResponse);
        if (!statusResponse.ok) {
          if (statusResponse.status >= 500) continue;
          throw new Error(
            getResponseError(statusResult) ?? "Texture progress could not be checked.",
          );
        }
        if (
          typeof statusResult !== "object" ||
          statusResult === null ||
          !("status" in statusResult) ||
          typeof statusResult.status !== "string"
        ) {
          throw new Error("The texture service returned an invalid task status.");
        }

        const nextProgress =
          "progress" in statusResult && typeof statusResult.progress === "number"
            ? Math.min(100, Math.max(0, statusResult.progress))
            : 0;
        setProgress(nextProgress);

        if (statusResult.status === "FAILED" || statusResult.status === "CANCELED") {
          throw new Error(
            getResponseError(statusResult) ??
              (statusResult.status === "CANCELED"
                ? "Texture generation was canceled."
                : "The texture could not be generated."),
          );
        }
        if (statusResult.status !== "SUCCEEDED") continue;

        setStatus("applying");
        setProgress(100);
        const modelResponse = await fetch("/api/meshy-texture/model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credentials),
          signal: controller.signal,
        });
        if (!modelResponse.ok) {
          const modelError = await readJson(modelResponse);
          throw new Error(
            getResponseError(modelError) ?? "The textured model could not be downloaded.",
          );
        }
        const texturedModel = await modelResponse.blob();
        if (texturedModel.size === 0) {
          throw new Error("The texture service returned an empty model.");
        }
        await onTextureReady(texturedModel);
        setStatus("done");
        return;
      }

      throw new Error(
        "Texture generation is still running after one hour. Keep the task ID and check it again later.",
      );
    } catch (generationError) {
      if (generationError instanceof Error && generationError.name === "AbortError") return;
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Texture generation failed.",
      );
      setStatus("error");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  };

  const busy =
    status === "submitting" || status === "generating" || status === "applying";

  return (
    <section
      aria-labelledby="texture-generator-title"
      className="mt-4 rounded-2xl border border-[#2a3340] bg-[#11151b] p-4 text-[#f3f4f6] sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#1d2d48] text-[#93c5fd]">
          <Paintbrush aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h3 id="texture-generator-title" className="text-sm font-semibold">
            Generate Texture
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#9ca3af]">
            Describe a surface, or apply the uploaded or captured photos. Generation uses Meshy credits.
          </p>
        </div>
      </div>

      <div
        className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-[#0b0d10] p-1"
        role="group"
        aria-label="Texture source"
      >
        {(
          [
            { value: "prompt", label: "Describe" },
            { value: "photo", label: "From photo" },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            disabled={busy}
            onClick={() => {
              setMode(option.value);
              if (status === "done" || status === "error") setStatus("idle");
              setError("");
            }}
            className={`h-9 rounded-lg text-xs font-semibold transition disabled:opacity-60 ${
              mode === option.value
                ? "bg-[#1d2d48] text-[#dbeafe]"
                : "text-[#9ca3af] hover:text-[#d7dde5]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === "photo" ? (
        <div className="mt-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9ca3af]">
            Source photos
          </p>
          {sourceImages.length > 0 ? (
            <>
              <p className="mt-1 text-xs leading-5 text-[#9ca3af]">
                The first photo is the front view. Any others add angles of the same object.
              </p>
              <ul className="mt-3 grid grid-cols-4 gap-2">
                {sourceImages.map((image, index) => (
                  <li key={image.previewUrl} className="relative aspect-square overflow-hidden rounded-lg">
                    <Image
                      src={image.previewUrl}
                      alt={image.file.name || `Source photo ${index + 1}`}
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="80px"
                    />
                    {index === 0 && (
                      <span className="absolute bottom-1 left-1 rounded bg-[#0b0d10]/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-[#dbeafe]">
                        Front
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-[#9ca3af]">
              <ImageIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Upload or take a photo first. Those images can be used as this model&apos;s texture.
            </p>
          )}
        </div>
      ) : (
      <label className="mt-4 block">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9ca3af]">
          Texture prompt
        </span>
        <textarea
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            if (status === "done" || status === "error") setStatus("idle");
          }}
          maxLength={650}
          rows={3}
          disabled={busy}
          placeholder="weathered copper with green patina"
          className="mt-2 w-full resize-none rounded-xl border border-[#303946] bg-[#0b0d10] px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-[#626b76] focus:border-[#60a5fa] disabled:opacity-60"
        />
      </label>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        {mode === "prompt" ? (
          <label>
            <span className="sr-only">Texture style preset</span>
            <select
              value={stylePreset}
              onChange={(event) => setStylePreset(event.target.value)}
              disabled={busy}
              className="h-11 w-full rounded-xl border border-[#303946] bg-[#0b0d10] px-3 text-sm text-[#d8dce1] outline-none focus:border-[#60a5fa] disabled:opacity-60"
            >
              {STYLE_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="self-center text-xs leading-5 text-[#9ca3af]">
            Applies the color and surface from your photos.
          </p>
        )}
        <button
          type="button"
          onClick={() => void generateTexture()}
          disabled={busy || (mode === "photo" ? sourceImages.length === 0 : !prompt.trim())}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#2563eb] px-5 text-sm font-semibold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#303946] disabled:text-[#8993a0]"
        >
          {busy ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : status === "done" ? (
            <Check aria-hidden="true" className="size-4" />
          ) : (
            <Sparkles aria-hidden="true" className="size-4" />
          )}
          {status === "submitting"
            ? "Starting…"
            : status === "generating"
              ? "Generating…"
              : status === "applying"
                ? "Applying…"
                : status === "done"
                  ? mode === "photo"
                    ? "Apply again"
                    : "Generate another"
                  : mode === "photo"
                    ? "Apply photos"
                    : "Generate"}
        </button>
      </div>

      {busy && (
        <div className="mt-4" role="status" aria-live="polite">
          <div className="mb-2 flex items-center justify-between text-[11px] text-[#aeb6c0]">
            <span>
              {status === "submitting"
                ? mode === "photo"
                  ? sourceTask
                    ? "Uploading photos…"
                    : "Uploading photos and model…"
                  : sourceTask
                    ? "Preparing model…"
                    : "Uploading model…"
                : status === "applying"
                  ? "Applying texture without moving the camera…"
                  : "Generating texture…"}
            </span>
            <span className="font-mono tabular-nums">{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#29313c]">
            <div
              className="h-full rounded-full bg-[#60a5fa] transition-[width] duration-500"
              style={{ width: `${Math.max(status === "submitting" ? 3 : 0, progress)}%` }}
            />
          </div>
        </div>
      )}

      {status === "done" && (
        <p className="mt-3 text-xs font-medium text-[#86efac]" role="status">
          Texture applied to the active model.
        </p>
      )}
      {error && (
        <p className="mt-3 text-xs font-medium leading-5 text-[#fda4af]" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
