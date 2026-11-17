"use client";

import { Check, LoaderCircle, Paintbrush, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type TextureGeneratorProps = {
  model: Blob;
  onTextureReady: (model: Blob) => void | Promise<void>;
};

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
  onTextureReady,
}: TextureGeneratorProps) {
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
    if (!trimmedPrompt || status === "submitting" || status === "generating") return;

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setStatus("submitting");
    setProgress(0);
    setError("");

    try {
      const formData = new FormData();
      formData.append(
        "model",
        new File([model], "active-model.glb", { type: "model/gltf-binary" }),
      );
      formData.append("prompt", trimmedPrompt);
      formData.append("style_preset", stylePreset);

      const createResponse = await fetch("/api/meshy-texture", {
        method: "POST",
        body: formData,
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

      for (let attempt = 0; attempt < 300; attempt += 1) {
        if (attempt > 0) await wait(2000, controller.signal);
        const statusResponse = await fetch("/api/meshy-texture/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credentials),
          signal: controller.signal,
        });
        const statusResult = await readJson(statusResponse);
        if (!statusResponse.ok) {
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

      throw new Error("Texture generation took too long. Please try again.");
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
            Describe a new surface for the active model. Generation uses Meshy credits.
          </p>
        </div>
      </div>

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

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
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
        <button
          type="button"
          onClick={() => void generateTexture()}
          disabled={busy || !prompt.trim()}
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
                  ? "Generate another"
                  : "Generate"}
        </button>
      </div>

      {busy && (
        <div className="mt-4" role="status" aria-live="polite">
          <div className="mb-2 flex items-center justify-between text-[11px] text-[#aeb6c0]">
            <span>
              {status === "submitting"
                ? "Uploading model…"
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
