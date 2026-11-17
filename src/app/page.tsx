"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Box, Check, LockKeyhole, Plus, Sparkles, UploadCloud, X } from "lucide-react";
import type { ModelExportAction } from "@/components/model-viewer";
import AppNavigation from "@/components/app-navigation";
import ScalingPreview from "@/components/scaling-preview";

const ModelViewer = dynamic(() => import("@/components/model-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[360px] items-center justify-center rounded-2xl bg-[#0B0D12] font-mono text-xs font-medium text-slate-400 sm:h-[420px]">
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
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const previewUrls = useRef<string[]>([]);
  const previewTask = useRef<PreviewTask | null>(null);
  const [dimensions, setDimensions] = useState<Record<PrintDimension, string>>({
    x: "100",
    y: "3",
    z: "100",
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

  const handleAspectRatioChange = useCallback((ratio: number) => {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    setAspectRatio(ratio);
    setDimensions((current) => {
      const maxHeight = Math.max(1, Math.min(250, Math.floor(250 / ratio)));
      const height = Math.min(maxHeight, Number(current.z) || 100);
      return {
        ...current,
        x: String(Math.round(height * ratio)),
        z: String(height),
      };
    });
  }, []);

  const handlePreviewHeightChange = useCallback(
    (height: number) => {
      const maxHeight = aspectRatio
        ? Math.max(1, Math.min(250, Math.floor(250 / aspectRatio)))
        : 250;
      const boundedHeight = Math.min(maxHeight, Math.max(1, height));
      setDimensions((current) => ({
        ...current,
        x: String(
          aspectRatio
            ? Math.round(boundedHeight * aspectRatio)
            : Number(current.x) || 100,
        ),
        z: String(boundedHeight),
      }));
    },
    [aspectRatio],
  );

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
        throw new Error("The generation service returned an empty model file.");
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
          throw new Error(getApiError(pollResult) ?? "The generation service could not create this model.");
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
      setError("Up to four photos of the same object can be selected.");
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
    if (indexToRemove === 0) setAspectRatio(null);
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
    if (aspectRatio && dimension === "x" && value !== "") {
      const width = Number(value);
      if (Number.isFinite(width) && width > 0) {
        const maxHeight = Math.max(1, Math.min(250, Math.floor(250 / aspectRatio)));
        const height = Math.max(1, Math.min(maxHeight, width / aspectRatio));
        setDimensions((current) => ({
          ...current,
          x: String(Math.round(height * aspectRatio)),
          z: String(height),
        }));
        return;
      }
    }

    if (aspectRatio && dimension === "z" && value !== "") {
      const maxHeight = Math.max(1, Math.min(250, Math.floor(250 / aspectRatio)));
      const height = Math.max(1, Math.min(maxHeight, Number(value)));
      if (Number.isFinite(height) && height > 0) {
        setDimensions((current) => ({
          ...current,
          x: String(Math.round(height * aspectRatio)),
          z: String(height),
        }));
        return;
      }
    }

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
    setAspectRatio(null);
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
    <main id="top" className="min-h-screen overflow-x-hidden bg-[#0B0D12] text-slate-100">
      <header className="relative border-b border-white/[0.06] bg-[#0B0D12]">
        <div className="relative mx-auto flex max-w-7xl flex-col items-center px-4 pb-4 sm:px-8 md:pb-5">
          <a
            href="#top"
            className="relative block h-36 w-full max-w-2xl shrink-0 overflow-hidden sm:h-40 md:h-44"
            aria-label="A.C.E.S. 3D Print Studio home"
          >
            <Image
              src="/A.C.E.S. 3D Print Studio.png"
              alt="A.C.E.S. 3D Print Studio"
              width={2197}
              height={1431}
              priority
              className="size-full object-cover object-center"
            />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-[#0B0D12]" />
          </a>
          <div className="-mt-1 mb-4 hidden items-center gap-2 text-xs font-medium tracking-wide text-slate-400 md:flex">
            <Sparkles aria-hidden="true" className="size-3.5 text-blue-400" strokeWidth={1.5} />
            For the space between ideas and inventions.
          </div>
          <AppNavigation />
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 pb-28 pt-7 sm:px-6 sm:pt-10 md:px-8 md:pb-12 md:pt-12">
        <div className="mb-7 max-w-2xl sm:mb-9">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-300">
            <span className="size-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
            Capture &amp; Create
          </div>
          <h1 className="max-w-[18ch] text-[clamp(1.75rem,6vw,2.75rem)] font-bold leading-[1.12] tracking-tight [hyphens:none]">
            A photo, made <span className="text-blue-400">three-dimensional.</span>
          </h1>
          <p className="mt-3 max-w-[36ch] text-sm leading-relaxed text-slate-400 sm:text-base">
            Turn a favorite image into a print-ready relief. Add a photo, set your size, and we&apos;ll shape it for you.
          </p>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]">
          <section
            id="capture"
            className="scroll-mt-28 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#12151E] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] p-4 sm:p-6">
              <div className="min-w-0">
                <span className="inline-flex rounded-full border border-blue-400/20 bg-blue-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-blue-300 tabular-nums">
                  01 · Capture &amp; Prep
                </span>
                <h2 className="mt-3 text-base font-semibold tracking-tight text-white sm:text-lg">{status === "ready" && modelUrls?.glb ? "3D model preview" : "Your photos"}</h2>
                <p className="mt-1 text-xs leading-normal text-slate-400 sm:text-sm">
                  {status === "ready" && modelUrls?.glb
                    ? "Inspect your model before printing"
                    : "Upload up to four views of the same object"}
                </p>
              </div>
            </div>

            <div id="assets" className="scroll-mt-28 p-4 sm:p-6">
              <div
                {...getRootProps({
                  className: `relative flex min-h-[260px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed transition sm:min-h-[368px] ${
                    isDragActive ? "border-blue-400 bg-blue-500/10" : "border-white/10 bg-[#0B0D12] hover:border-blue-400/60 hover:bg-white/[0.025]"
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
                    <Box aria-hidden="true" className="size-8 text-blue-400" />
                    <p className="mt-4 text-sm font-semibold text-white">
                      {previewLoading ? "Loading your 3D preview…" : "Preview unavailable"}
                    </p>
                    <p className="mt-2 max-w-sm text-xs leading-5 text-slate-400">
                      {previewError ||
                        "The model is ready. You can still download it while the preview loads."}
                    </p>
                    {!previewLoading && previewError && (
                      <button
                        type="button"
                        onClick={() => void retryModelPreview()}
                        className="button-secondary mt-4"
                      >
                        Retry preview
                      </button>
                    )}
                  </div>
                ) : images.length > 0 ? (
                  <div className="grid w-full grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5">
                    {images.map(({ file, previewUrl }, index) => (
                      <div key={`${file.name}-${file.lastModified}-${index}`} className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-[#0F121A]">
                        <Image
                          src={previewUrl}
                          alt={`View ${index + 1}: ${file.name}`}
                          fill
                          unoptimized
                          className="object-cover"
                          sizes="(max-width: 640px) 45vw, 20vw"
                        />
                        <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-1 font-mono text-[10px] font-medium text-white">
                          View {index + 1}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeImage(index);
                          }}
                          className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full border border-white/10 bg-[#14171d]/95 text-sm font-semibold text-white opacity-100 shadow-sm transition hover:bg-[#232832] active:scale-[0.97] sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <X aria-hidden="true" className="size-4" />
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
                        className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/[0.03] text-xs font-medium text-slate-400 transition hover:border-blue-400/50 hover:bg-white/[0.06] active:scale-[0.97]"
                      >
                        <Plus aria-hidden="true" className="size-4" />
                        Add view
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center px-6 text-center">
                    <span className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/10 text-blue-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                      <UploadCloud aria-hidden="true" className="size-5" />
                    </span>
                    <p className="text-sm font-semibold tracking-tight text-white sm:text-base">
                      {isDragActive ? "Drop it here to get started" : "Drop your photo here"}
                    </p>
                    <p className="mt-2 max-w-[30ch] text-xs leading-normal text-slate-400 sm:text-sm">or choose up to four photos from different angles</p>
                    <span className="mt-4 max-w-full rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-center text-[10px] font-medium leading-4 text-slate-400 sm:text-[11px]">JPG, PNG, WEBP <span className="mx-1 text-slate-600">·</span> 20 MB each <span className="mx-1 text-slate-600">·</span> up to 4 images</span>
                  </div>
                )}
              </div>

              {images[0] && (
                <ScalingPreview
                  file={images[0].file}
                  previewUrl={images[0].previewUrl}
                  widthMm={Math.round(getDimensionValue("z") * (aspectRatio ?? 1))}
                  heightMm={getDimensionValue("z")}
                  onHeightChange={handlePreviewHeightChange}
                  onAspectRatioChange={handleAspectRatioChange}
                />
              )}

              {error && <p role="alert" className="mt-3 text-xs font-medium text-rose-300">{error}</p>}

              {images.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-400 tabular-nums">{images.length} of 4 photos selected</p>
                  <button
                    type="button"
                    onClick={() => open()}
                    disabled={images.length >= 4 || status === "uploading" || status === "generating"}
                    className="button-secondary"
                  >
                    Add photos
                  </button>
                </div>
              )}

              {images.length > 0 && status !== "idle" && (
                <div className="mt-5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 sm:px-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-white">Model progress</p>
                      <p className="mt-1 text-[11px] text-slate-400 tabular-nums" role="status" aria-live="polite">
                        {status === "uploading" && "Uploading your image…"}
                        {status === "generating" && `Generating your model… ${progress}%`}
                        {status === "ready" && "Your model is ready to print"}
                        {status === "error" && "Generation stopped"}
                      </p>
                    </div>
                    <button type="button" onClick={handleRemoveImage} className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:bg-white/[0.06] hover:text-white active:scale-[0.97]">
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
                          <div className={`mb-2 h-1 rounded-full ${isComplete || isCurrent ? "bg-blue-500" : "bg-white/10"}`}>
                            {isCurrent && stage.id !== "ready" && (
                              <div
                                className={`h-full rounded-full bg-[#3b82f6] ${stage.id === "uploading" ? "animate-pulse" : ""}`}
                                style={{ width: fillWidth }}
                              />
                            )}
                          </div>
                          <p className={`truncate text-[10px] font-medium sm:text-[11px] ${isComplete || isCurrent ? "text-slate-200" : "text-slate-500"}`}>
                            {isComplete && <span className="mr-1 inline-flex align-[-2px] text-blue-400"><Check aria-hidden="true" className="size-3.5" /></span>}
                            {stage.label}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  {status === "error" && error && (
                    <p role="alert" className="mt-3 text-xs font-medium text-rose-300">{error}</p>
                  )}
                  {status === "error" && (
                    <button
                      type="button"
                      onClick={() => void startGeneration(images)}
                      className="mt-3 text-xs font-semibold text-blue-300 underline underline-offset-2"
                    >
                      Try again
                    </button>
                  )}
                </div>
              )}
              {status === "ready" && modelUrls && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
                  <span className="mr-auto text-xs font-semibold text-white">Download model</span>
                  {modelUrls.glb && (
                    <a href={modelUrls.glb} target="_blank" rel="noreferrer" className="button-secondary">
                      GLB
                    </a>
                  )}
                  {modelUrls.stl && (
                    <a href={modelUrls.stl} target="_blank" rel="noreferrer" className="button-secondary">
                      STL
                    </a>
                  )}
                  {modelUrls.glb && (
                    <button
                      type="button"
                      onClick={() => exportModel?.()}
                      disabled={!exportModel}
                      className="button-primary w-full"
                    >
                      {exportModel ? "Download for 3D Printing (STL)" : "Preparing STL export…"}
                    </button>
                  )}
                </div>
              )}
              {exportError && <p role="alert" className="mt-2 text-xs font-medium text-rose-300">{exportError}</p>}
            </div>
            <div className="flex items-start gap-2 border-t border-white/[0.08] px-4 py-3.5 text-[11px] leading-normal text-slate-400 sm:px-6">
              <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-blue-400" strokeWidth={1.5} />
              Your photos are sent securely to our image-generation service.
            </div>
          </section>

          <aside
            id="model"
            className="scroll-mt-28 rounded-2xl border border-white/[0.08] bg-[#12151E] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] sm:p-6"
          >
            <div className="mb-5">
              <span className="inline-flex rounded-full border border-blue-400/20 bg-blue-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-blue-300 tabular-nums">
                02 · Size &amp; Create
              </span>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10 text-blue-400">
                  <Box aria-hidden="true" className="size-[18px]" strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold tracking-tight text-white sm:text-lg">Print dimensions</h2>
                  <p className="mt-0.5 text-xs leading-normal text-slate-400 sm:text-sm">Set the finished model size</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {(["x", "y", "z"] as const).map((dimension) => (
                <label key={dimension} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-3 transition focus-within:border-blue-400/60 sm:px-4">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className={`flex size-7 items-center justify-center rounded-lg text-xs font-semibold ${
                      dimension === "x" ? "bg-amber-400/10 text-amber-300" : dimension === "y" ? "bg-cyan-400/10 text-cyan-300" : "bg-violet-400/10 text-violet-300"
                    } font-mono`}>{dimension.toUpperCase()}</span>
                    <span className="truncate text-xs font-medium text-slate-300">{dimensionLabels[dimension]}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <input
                      aria-label={`${dimensionLabels[dimension]} in millimeters`}
                      type="number"
                      min="0.1"
                      max={
                        dimension === "x" && aspectRatio
                          ? 250
                          : dimension === "z" && aspectRatio
                            ? Math.max(1, Math.min(250, Math.floor(250 / aspectRatio)))
                            : undefined
                      }
                      step={dimension === "x" && aspectRatio ? "1" : "0.1"}
                      value={dimensions[dimension]}
                      onChange={(event) => updateDimension(dimension, event.target.value)}
                      className="w-16 min-w-0 bg-transparent text-right font-mono text-sm font-semibold tabular-nums text-white outline-none sm:w-20"
                    />
                    <span className="text-[11px] text-slate-500">mm</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3.5 sm:px-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-400">Estimated footprint</span>
                <span className="max-w-full font-mono font-semibold tabular-nums text-slate-100">
                  {dimensions.x || "0"} × {dimensions.y || "0"} × {dimensions.z || "0"} mm
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={open}
              disabled={images.length >= 4 || status === "uploading" || status === "generating"}
              className="button-secondary mt-5 w-full gap-2"
            >
              <UploadCloud aria-hidden="true" className="size-5" />
              {images.length ? "Add more photos" : "Choose photos"}
            </button>
            <button
              type="button"
              onClick={() => void startGeneration(images)}
              disabled={images.length === 0 || status === "uploading" || status === "generating"}
              className="button-primary mt-2 w-full gap-2"
            >
              <Sparkles aria-hidden="true" className="size-[18px] text-[#bfdbfe]" />
              {status === "ready" ? "Regenerate 3D model" : status === "uploading" || status === "generating" ? "Generating model…" : status === "error" ? "Try again" : "Generate 3D model"}
            </button>
            <p className="mt-3 text-center text-[10px] leading-5 text-slate-500">
              {status === "error" ? "Your photos are still here if you want to retry." : images.length ? "Dimensions are saved with this session." : "Add one to four photos of the same object."}
            </p>
          </aside>
        </div>

        <footer id="textures" className="mt-9 flex scroll-mt-28 flex-col gap-2 border-t border-white/[0.08] pt-5 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Capture &amp; Create - 3D Print Studio</span>
          <span>Precision image-to-model generation</span>
        </footer>
      </div>
    </main>
  );
}
