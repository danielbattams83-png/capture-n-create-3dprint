"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import type { ModelExportAction } from "@/components/model-viewer";

const ModelViewer = dynamic(() => import("@/components/model-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[360px] items-center justify-center rounded-2xl bg-[#f7f8f4] text-xs font-medium text-[#7b8173] sm:h-[420px]">
      Preparing 3D preview…
    </div>
  ),
});

type GenerationStatus = "idle" | "uploading" | "generating" | "ready" | "error";
type PrintDimension = "x" | "y" | "z";
type ModelUrls = { glb?: string; stl?: string };
type SelectedImage = { file: File; previewUrl: string };
type PreviewTask = {
  taskId: string;
  taskType: "image-to-3d" | "multi-image-to-3d";
  taskToken: string;
};

const stages: { id: Exclude<GenerationStatus, "idle" | "error">; label: string }[] = [
  { id: "uploading", label: "Uploading image" },
  { id: "generating", label: "Generating 3D model" },
  { id: "ready", label: "Ready to print" },
];

function getApiError(value: unknown): string | undefined {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const dimensionLabels: Record<PrintDimension, string> = {
  x: "Width",
  y: "Depth",
  z: "Height",
};

function PhotoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-6">
      <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8.5" cy="9" r="1.5" fill="currentColor" />
      <path d="m5 17 4.5-4 3 2.5 2.5-2 4 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CubeIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m4.5 7.7 7.5 4.4 7.5-4.4M12 12.1V21" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-3.5">
      <path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home() {
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [progress, setProgress] = useState(0);
  const [modelUrls, setModelUrls] = useState<ModelUrls | null>(null);
  const [previewModelUrl, setPreviewModelUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exportModel, setExportModel] = useState<ModelExportAction | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const previewUrls = useRef<string[]>([]);
  const previewTask = useRef<PreviewTask | null>(null);
  const [dimensions, setDimensions] = useState<Record<PrintDimension, string>>({
    x: "100",
    y: "100",
    z: "3",
  });

  useEffect(() => {
    return () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!previewModelUrl) return;
    return () => URL.revokeObjectURL(previewModelUrl);
  }, [previewModelUrl]);

  const registerExportModel = useCallback((action: ModelExportAction | null) => {
    setExportModel(() => action);
  }, []);

  const loadModelPreview = async (task: PreviewTask, signal: AbortSignal) => {
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewModelUrl(null);

    try {
      const response = await fetch("/api/model-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: task.taskId,
          task_type: task.taskType,
          task_token: task.taskToken,
        }),
        signal,
      });
      if (!response.ok) {
        const result = await readJson(response);
        throw new Error(getApiError(result) ?? "Could not download the model for preview.");
      }

      const modelBlob = await response.blob();
      if (modelBlob.size === 0) {
        throw new Error("Meshy returned an empty model file.");
      }
      if (!signal.aborted) {
        setPreviewModelUrl(URL.createObjectURL(modelBlob));
      }
    } catch (previewLoadError) {
      if (!signal.aborted) {
        setPreviewError(
          previewLoadError instanceof Error
            ? previewLoadError.message
            : "Could not load the 3D preview. You can still download the generated file.",
        );
      }
    } finally {
      if (!signal.aborted) setPreviewLoading(false);
    }
  };

  const retryModelPreview = async () => {
    if (!previewTask.current) return;

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    await loadModelPreview(previewTask.current, controller.signal);
    if (activeRequest.current === controller) activeRequest.current = null;
  };

  const startGeneration = async (selectedImages: SelectedImage[]) => {
    if (selectedImages.length === 0) return;

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setError("");
    setExportError("");
    setModelUrls(null);
    setPreviewModelUrl(null);
    setPreviewError("");
    setPreviewLoading(false);
    previewTask.current = null;
    setExportModel(null);
    setProgress(0);
    setStatus("uploading");

    try {
      const formData = new FormData();
      selectedImages.forEach(({ file }) => formData.append("images", file));

      const createResponse = await fetch("/api/generate-3d", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const createResult = await readJson(createResponse);
      if (!createResponse.ok) {
        throw new Error(getApiError(createResult) ?? "Could not start 3D generation.");
      }
      if (
        !isRecord(createResult) ||
        typeof createResult.task_id !== "string" ||
        (createResult.task_type !== "image-to-3d" &&
          createResult.task_type !== "multi-image-to-3d") ||
        typeof createResult.task_token !== "string"
      ) {
        throw new Error("The generation service returned an invalid task response.");
      }

      const taskId = createResult.task_id;
      const taskType = createResult.task_type;
      const taskToken = createResult.task_token;
      const task: PreviewTask = { taskId, taskType, taskToken };
      previewTask.current = task;
      setStatus("generating");
      const startedAt = Date.now();

      while (Date.now() - startedAt < 15 * 60 * 1000) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        if (controller.signal.aborted) return;

        const pollResponse = await fetch("/api/poll-task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_id: taskId,
            task_type: taskType,
            task_token: taskToken,
          }),
          signal: controller.signal,
        });
        const pollResult = await readJson(pollResponse);
        if (!pollResponse.ok) {
          throw new Error(getApiError(pollResult) ?? "Could not check the generation status.");
        }
        if (!isRecord(pollResult) || typeof pollResult.status !== "string") {
          throw new Error("The generation service returned an invalid task status.");
        }

        if (pollResult.status === "FAILED" || pollResult.status === "CANCELED") {
          throw new Error(getApiError(pollResult) ?? "Meshy could not generate this model.");
        }

        if (
          typeof pollResult.progress === "number" &&
          Number.isFinite(pollResult.progress)
        ) {
          setProgress(Math.min(100, Math.max(0, pollResult.progress)));
        }

        if (pollResult.status === "SUCCEEDED") {
          const urls = isRecord(pollResult.model_urls) ? pollResult.model_urls : null;
          const glb = urls && typeof urls.glb === "string" ? urls.glb : undefined;
          const stl = urls && typeof urls.stl === "string" ? urls.stl : undefined;
          if (!glb && !stl) {
            throw new Error("The model finished without a downloadable GLB or STL file.");
          }

          setModelUrls({ glb, stl });
          setProgress(100);
          setStatus("ready");
          if (glb) await loadModelPreview(task, controller.signal);
          return;
        }
      }

      throw new Error("Model generation timed out. Please try again.");
    } catch (generationError) {
      if (controller.signal.aborted) return;
      setError(
        generationError instanceof Error
          ? generationError.message
          : "An unexpected error occurred during model generation.",
      );
      setStatus("error");
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  };

  const onDrop = (acceptedFiles: File[], rejectedFiles: { file: File }[]) => {
    if (rejectedFiles.length > 0) {
      setError("Choose up to four JPG, PNG, or WebP images, each smaller than 20 MB.");
      return;
    }
    if (acceptedFiles.length === 0) return;
    if (images.length + acceptedFiles.length > 4) {
      setError("Meshy supports up to four photos of the same object.");
      return;
    }

    activeRequest.current?.abort();
    activeRequest.current = null;
    setError("");
    setExportError("");
    setModelUrls(null);
    setPreviewModelUrl(null);
    setPreviewError("");
    setPreviewLoading(false);
    previewTask.current = null;
    setExportModel(null);
    setProgress(0);
    setStatus("idle");
    const addedImages = acceptedFiles.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    previewUrls.current.push(...addedImages.map(({ previewUrl }) => previewUrl));
    setImages((current) => [...current, ...addedImages]);
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"] },
    maxFiles: 4,
    maxSize: 20 * 1024 * 1024,
    multiple: true,
    noClick: true,
  });

  const removeImage = (indexToRemove: number) => {
    const removed = images[indexToRemove];
    if (removed) {
      URL.revokeObjectURL(removed.previewUrl);
      previewUrls.current = previewUrls.current.filter((url) => url !== removed.previewUrl);
    }
    setImages((current) => current.filter((_, index) => index !== indexToRemove));
    activeRequest.current?.abort();
    activeRequest.current = null;
    setStatus("idle");
    setProgress(0);
    setError("");
    setExportError("");
    setModelUrls(null);
    setPreviewModelUrl(null);
    setPreviewError("");
    setPreviewLoading(false);
    previewTask.current = null;
    setExportModel(null);
  };

  const updateDimension = (dimension: PrintDimension, value: string) => {
    setDimensions((current) => ({ ...current, [dimension]: value }));
  };

  const getDimensionValue = (dimension: PrintDimension) => {
    const value = Number(dimensions[dimension]);
    return Number.isFinite(value) && value > 0 ? value : 100;
  };

  const handleRemoveImage = () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current = [];
    setImages([]);
    setStatus("idle");
    setError("");
    setExportError("");
    setProgress(0);
    setModelUrls(null);
    setPreviewModelUrl(null);
    setPreviewError("");
    setPreviewLoading(false);
    previewTask.current = null;
    setExportModel(null);
  };

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-[#20211f]">
      <header className="border-b border-[#e9e9e5] bg-white/80">
        <div className="mx-auto flex h-24 max-w-7xl items-center justify-between px-5 sm:h-[192px] sm:px-8">
          <a href="#" className="flex shrink-0 items-center" aria-label="Capture & Create - 3D Print Studio home">
            <Image
              src="/capture-create-3d-print-studio.png"
              alt="Capture & Create 3D Print Studio"
              width={965}
              height={706}
              priority
              className="h-auto w-28 object-contain sm:w-[232px]"
            />
          </a>
          <div className="hidden items-center gap-2 text-xs font-medium text-[#787c74] sm:flex">
            <span className="size-1.5 rounded-full bg-[#a5c848]" />
            Your ideas, made tangible
          </div>
          <button type="button" className="rounded-full border border-[#e8e9e3] px-4 py-2 text-xs font-semibold text-[#4c5049] transition hover:border-[#c8cbc2] hover:bg-[#fafaf8]">
            How it works
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 pb-12 pt-9 sm:px-8 sm:pt-14">
        <div className="mb-9 max-w-2xl sm:mb-11">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#e7e9df] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#777d6b]">
            <span className="size-1.5 rounded-full bg-[#9cbf3f]" />
            Capture &amp; Create
          </div>
          <h1 className="text-[clamp(2.2rem,5vw,3.8rem)] font-semibold leading-[1.05] tracking-[-0.065em]">
            A photo, made <span className="text-[#8eaa43]">three-dimensional.</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-7 text-[#777a73] sm:text-base">
            Turn a favorite image into a print-ready relief. Add a photo, set your size, and we&apos;ll shape it for you.
          </p>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]">
          <section className="overflow-hidden rounded-[22px] border border-[#e8e9e4] bg-white shadow-[0_8px_30px_rgba(27,31,24,0.035)]">
            <div className="flex items-center justify-between border-b border-[#efefec] px-5 py-4 sm:px-7">
              <div>
                <h2 className="text-sm font-semibold">{status === "ready" && modelUrls?.glb ? "3D model preview" : "Your photos"}</h2>
                <p className="mt-1 text-xs text-[#969991]">
                  {status === "ready" && modelUrls?.glb
                    ? "Inspect your model before printing"
                    : "Upload up to four views of the same object"}
                </p>
              </div>
              <span className="rounded-full bg-[#f3f5ed] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7b8e4a]">Step 01</span>
            </div>

            <div className="p-4 sm:p-6">
              <div
                {...getRootProps({
                  className: `relative flex min-h-[300px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed transition sm:min-h-[368px] ${
                    isDragActive ? "border-[#91ad42] bg-[#f3f7e9]" : "border-[#dfe2d9] bg-[#fafbf8] hover:border-[#aab987] hover:bg-[#f8faf4]"
                  }`,
                })}
              >
                <input {...getInputProps()} />
                {status === "ready" && modelUrls?.glb && previewModelUrl ? (
                  <ModelViewer
                    modelUrl={previewModelUrl}
                    width={getDimensionValue("x")}
                    depth={getDimensionValue("y")}
                    height={getDimensionValue("z")}
                    onExportReady={registerExportModel}
                    onExportError={setExportError}
                    onRetry={() => void retryModelPreview()}
                  />
                ) : status === "ready" && modelUrls?.glb ? (
                  <div
                    className="flex min-h-[340px] w-full flex-col items-center justify-center px-6 text-center sm:min-h-[420px]"
                    role="status"
                  >
                    <CubeIcon className="size-8 text-[#91a66a]" />
                    <p className="mt-4 text-sm font-semibold text-[#505747]">
                      {previewLoading ? "Loading your 3D preview…" : "Preview unavailable"}
                    </p>
                    <p className="mt-2 max-w-sm text-xs leading-5 text-[#898d84]">
                      {previewError ||
                        "The model is ready. You can still download it while the preview loads."}
                    </p>
                    {!previewLoading && previewError && (
                      <button
                        type="button"
                        onClick={() => void retryModelPreview()}
                        className="mt-4 rounded-lg border border-[#dfe2d9] bg-white px-3 py-2 text-xs font-semibold text-[#536b2d] shadow-sm transition hover:bg-[#f3f5ed]"
                      >
                        Retry preview
                      </button>
                    )}
                  </div>
                ) : images.length > 0 ? (
                  <div className="grid w-full grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5">
                    {images.map(({ file, previewUrl }, index) => (
                      <div key={`${file.name}-${file.lastModified}-${index}`} className="group relative aspect-square overflow-hidden rounded-xl border border-[#e6e9df] bg-white">
                        <Image
                          src={previewUrl}
                          alt={`View ${index + 1}: ${file.name}`}
                          fill
                          unoptimized
                          className="object-cover"
                          sizes="(max-width: 640px) 45vw, 20vw"
                        />
                        <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-1 text-[10px] font-medium text-white">
                          View {index + 1}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeImage(index);
                          }}
                          className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-white/95 text-sm font-semibold text-[#50544d] opacity-100 shadow-sm transition hover:bg-white sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {images.length < 4 && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          open();
                        }}
                        className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#dfe2d9] bg-white/70 text-xs font-medium text-[#78816a] transition hover:border-[#aab987] hover:bg-white"
                      >
                        <span className="text-xl leading-none">+</span>
                        Add view
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center px-6 text-center">
                    <span className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-[#e9ebe3] bg-white text-[#839a4c] shadow-sm">
                      <PhotoIcon />
                    </span>
                    <p className="text-[15px] font-semibold text-[#343731]">
                      {isDragActive ? "Drop it here to get started" : "Drop your photo here"}
                    </p>
                    <p className="mt-2 text-sm text-[#8b8e86]">or choose up to four photos from different angles</p>
                    <span className="mt-5 rounded-full border border-[#e9eae5] bg-white px-3 py-1.5 text-[11px] font-medium text-[#777b73]">JPG, PNG, WEBP <span className="mx-1 text-[#d0d2cb]">·</span> 20 MB each <span className="mx-1 text-[#d0d2cb]">·</span> up to 4 images</span>
                  </div>
                )}
              </div>

              {error && <p role="alert" className="mt-3 text-xs font-medium text-[#b34e3a]">{error}</p>}

              {images.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-[#858980]">{images.length} of 4 photos selected</p>
                  <button
                    type="button"
                    onClick={() => open()}
                    disabled={images.length >= 4 || status === "uploading" || status === "generating"}
                    className="rounded-lg border border-[#e8e9e3] bg-white px-3 py-2 text-xs font-semibold text-[#59634b] transition hover:bg-[#f8faf4] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add photos
                  </button>
                </div>
              )}

              {images.length > 0 && status !== "idle" && (
                <div className="mt-5 rounded-xl bg-[#f8f9f5] px-4 py-4 sm:px-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-[#3d4139]">Model progress</p>
                      <p className="mt-1 text-[11px] text-[#90948a]" role="status" aria-live="polite">
                        {status === "uploading" && "Uploading your image…"}
                        {status === "generating" && `Generating your model… ${progress}%`}
                        {status === "ready" && "Your model is ready to print"}
                        {status === "error" && "Generation stopped"}
                      </p>
                    </div>
                    <button type="button" onClick={handleRemoveImage} className="rounded-md px-2 py-1 text-[11px] font-medium text-[#84877f] transition hover:bg-white hover:text-[#343731]">
                      Clear all
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    {stages.map((stage, index) => {
                      const currentIndex = stages.findIndex((item) => item.id === status);
                      const isComplete = currentIndex > index;
                      const isCurrent = stage.id === status;
                      const fillWidth =
                        status === "uploading" && isCurrent
                          ? "45%"
                          : status === "generating" && isCurrent
                            ? `${progress}%`
                            : "100%";

                      return (
                        <div key={stage.id} className="min-w-0">
                          <div className={`mb-2 h-1 rounded-full ${isComplete || isCurrent ? "bg-[#9cba48]" : "bg-[#e6e8e1]"}`}>
                            {isCurrent && stage.id !== "ready" && (
                              <div
                                className={`h-full rounded-full bg-[#718c30] ${stage.id === "uploading" ? "animate-pulse" : ""}`}
                                style={{ width: fillWidth }}
                              />
                            )}
                          </div>
                          <p className={`truncate text-[10px] font-medium sm:text-[11px] ${isComplete || isCurrent ? "text-[#505747]" : "text-[#a0a39b]"}`}>
                            {isComplete && <span className="mr-1 inline-flex align-[-2px] text-[#849e43]"><CheckIcon /></span>}
                            {stage.label}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  {status === "error" && error && (
                    <p role="alert" className="mt-3 text-xs font-medium text-[#b34e3a]">{error}</p>
                  )}
                  {status === "error" && (
                    <button
                      type="button"
                      onClick={() => void startGeneration(images)}
                      className="mt-3 text-xs font-semibold text-[#536b2d] underline underline-offset-2"
                    >
                      Try again
                    </button>
                  )}
                </div>
              )}
              {status === "ready" && modelUrls && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#e7ebdc] bg-[#f7f9f1] px-4 py-3">
                  <span className="mr-auto text-xs font-semibold text-[#505747]">Download model</span>
                  {modelUrls.glb && (
                    <a href={modelUrls.glb} target="_blank" rel="noreferrer" className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#536b2d] shadow-sm hover:bg-[#eef3e4]">
                      GLB
                    </a>
                  )}
                  {modelUrls.stl && (
                    <a href={modelUrls.stl} target="_blank" rel="noreferrer" className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#536b2d] shadow-sm hover:bg-[#eef3e4]">
                      STL
                    </a>
                  )}
                  {modelUrls.glb && (
                    <button
                      type="button"
                      onClick={() => exportModel?.()}
                      disabled={!exportModel}
                      className="w-full rounded-lg bg-[#29352b] px-4 py-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#394a36] disabled:cursor-wait disabled:opacity-60"
                    >
                      {exportModel ? "Download for 3D Printing (STL)" : "Preparing STL export…"}
                    </button>
                  )}
                </div>
              )}
              {exportError && <p role="alert" className="mt-2 text-xs font-medium text-[#b34e3a]">{exportError}</p>}
            </div>
            <div className="flex items-center gap-2 border-t border-[#efefec] px-5 py-3.5 text-[11px] text-[#93968e] sm:px-7">
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4 shrink-0">
                <path d="M8 1.8 13 4v3.4c0 3.1-2.1 5.4-5 6.8-2.9-1.4-5-3.7-5-6.8V4l5-2.2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="m5.8 8 1.5 1.5 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Your photos are sent securely to Meshy to generate your model.
            </div>
          </section>

          <aside className="rounded-[22px] border border-[#e8e9e4] bg-white p-5 shadow-[0_8px_30px_rgba(27,31,24,0.035)] sm:p-6">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-[#f1f5e8] text-[#849c48]"><CubeIcon /></div>
                <h2 className="text-sm font-semibold">Print dimensions</h2>
                <p className="mt-1 text-xs text-[#92958d]">Set the finished model size</p>
              </div>
              <span className="rounded-full bg-[#f3f5ed] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7b8e4a]">Step 02</span>
            </div>

            <div className="space-y-3">
              {(["x", "y", "z"] as const).map((dimension) => (
                <label key={dimension} className="flex items-center justify-between gap-4 rounded-xl border border-[#eceee8] px-4 py-3.5 transition focus-within:border-[#afc17e]">
                  <span className="flex items-center gap-3">
                    <span className={`flex size-7 items-center justify-center rounded-lg text-xs font-semibold ${
                      dimension === "x" ? "bg-[#f3eee6] text-[#a17d4b]" : dimension === "y" ? "bg-[#eaf1f2] text-[#648b91]" : "bg-[#f0edf5] text-[#8975a2]"
                    }`}>{dimension.toUpperCase()}</span>
                    <span className="text-xs font-medium text-[#5b5f56]">{dimensionLabels[dimension]}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <input
                      aria-label={`${dimensionLabels[dimension]} in millimeters`}
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={dimensions[dimension]}
                      onChange={(event) => updateDimension(dimension, event.target.value)}
                      className="w-20 bg-transparent text-right text-sm font-semibold tabular-nums text-[#353932] outline-none"
                    />
                    <span className="text-[11px] text-[#9a9d94]">mm</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-5 rounded-xl bg-[#f8f9f5] px-4 py-3.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#858980]">Estimated footprint</span>
                <span className="font-semibold tabular-nums text-[#4d5345]">
                  {dimensions.x || "0"} × {dimensions.y || "0"} × {dimensions.z || "0"} mm
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={open}
              disabled={images.length >= 4 || status === "uploading" || status === "generating"}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-[#dfe4d5] bg-white px-4 py-3 text-sm font-semibold text-[#536344] transition hover:bg-[#f8faf4] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PhotoIcon />
              {images.length ? "Add more photos" : "Choose photos"}
            </button>
            <button
              type="button"
              onClick={() => void startGeneration(images)}
              disabled={images.length === 0 || status === "uploading" || status === "generating"}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#29352b] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#394a36] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CubeIcon className="size-[18px] text-[#d5eb89]" />
              {status === "ready" ? "Regenerate 3D model" : status === "uploading" || status === "generating" ? "Generating model…" : status === "error" ? "Try again" : "Generate 3D model"}
            </button>
            <p className="mt-3 text-center text-[10px] leading-5 text-[#a0a39b]">
              {status === "error" ? "Your photos are still here if you want to retry." : images.length ? "Dimensions are saved with this session." : "Add one to four photos of the same object."}
            </p>
          </aside>
        </div>

        <footer className="mt-9 flex flex-col gap-2 border-t border-[#e8e9e4] pt-5 text-[11px] text-[#a0a39b] sm:flex-row sm:items-center sm:justify-between">
          <span>Capture &amp; Create - 3D Print Studio</span>
          <span>Image-to-model generation powered by Meshy</span>
        </footer>
      </div>
    </main>
  );
}
