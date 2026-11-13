"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import {
  AlertCircle,
  Box,
  Check,
  Download,
  LockKeyhole,
  Sparkles,
  X,
} from "lucide-react";

export type GenerationModalStatus =
  | "idle"
  | "uploading"
  | "generating"
  | "ready"
  | "error";

export type GenerationModalImage = {
  file: File;
  previewUrl: string;
};

type GenerationModalProps = {
  open: boolean;
  images: GenerationModalImage[];
  status: GenerationModalStatus;
  failedStage: "uploading" | "generating" | null;
  progress: number;
  error: string;
  dimensions: { width: string; depth: string; height: string };
  modelUrls: { glb?: string; stl?: string } | null;
  exportReady: boolean;
  onClose: () => void;
  onRetry: () => void;
  onExport: () => void;
  onViewModel: () => void;
};

const stages = [
  { id: "uploading", label: "Uploading images" },
  { id: "generating", label: "Generating 3D model" },
  { id: "ready", label: "Ready to print" },
] as const;

export default function GenerationModal({
  open,
  images,
  status,
  failedStage,
  progress,
  error,
  dimensions,
  modelUrls,
  exportReady,
  onClose,
  onRetry,
  onExport,
  onViewModel,
}: GenerationModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isProcessing = status === "uploading" || status === "generating";
  const currentStageIndex =
    status === "uploading"
      ? 0
      : status === "generating"
        ? 1
        : status === "error"
          ? failedStage === "generating"
            ? 1
            : 0
        : status === "ready"
          ? 2
          : -1;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      closeButtonRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="generation-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{ display: open ? "flex" : "none" }}
      className="fixed inset-0 m-0 flex h-dvh w-screen max-h-none max-w-none items-center justify-center overflow-y-auto border-0 bg-transparent p-4 text-[#f3f4f6] backdrop:bg-black/80 sm:p-6"
    >
      <div className="studio-panel relative my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-[#232832] bg-[#14171d] shadow-[0_24px_100px_rgba(0,0,0,0.65)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#232832] px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#17243a] text-[#60a5fa]">
              {status === "error" ? (
                <AlertCircle aria-hidden="true" className="size-5" />
              ) : status === "ready" ? (
                <Check aria-hidden="true" className="size-5" />
              ) : (
                <Sparkles aria-hidden="true" className="size-5" />
              )}
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#60a5fa]">
                Generation studio
              </p>
              <h2
                id="generation-dialog-title"
                className="mt-1 text-base font-semibold text-[#f3f4f6] sm:text-lg"
              >
                {status === "ready"
                  ? "Your model is ready"
                  : status === "error"
                    ? "Generation needs attention"
                    : "Creating your 3D model"}
              </h2>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={isProcessing ? "Continue generation in the background" : "Close"}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#232832] bg-[#0b0d10] text-[#9ca3af] transition hover:border-[#3b82f6] hover:text-[#f3f4f6]"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="max-h-[calc(100dvh-11rem)] space-y-5 overflow-y-auto p-5 sm:space-y-6 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#f3f4f6]">Source photos</p>
              <p className="mt-1 text-xs text-[#9ca3af]">
                {images.length} {images.length === 1 ? "view" : "views"} · original files stay unchanged
              </p>
            </div>
            <span className="rounded-full border border-[#232832] bg-[#0b0d10] px-3 py-1.5 font-mono text-[10px] tabular-nums text-[#9ca3af]">
              {dimensions.width} × {dimensions.depth} × {dimensions.height} mm
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {images.map(({ file, previewUrl }, index) => (
              <div
                key={`${file.name}-${file.lastModified}-${index}`}
                className="group relative aspect-square overflow-hidden rounded-xl border border-[#232832] bg-[#0b0d10]"
              >
                <Image
                  src={previewUrl}
                  alt={`Submitted view ${index + 1}: ${file.name}`}
                  fill
                  unoptimized
                  sizes="(max-width: 640px) 40vw, 140px"
                  className="object-cover"
                />
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/90 to-transparent px-2 pb-2 pt-5 font-mono text-[9px] text-white">
                  VIEW {String(index + 1).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-[#232832] bg-[#0b0d10] p-4 sm:p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#f3f4f6]">Model progress</p>
                <p className="mt-1 text-xs text-[#9ca3af]" role="status" aria-live="polite">
                  {status === "uploading" && "Sending your photos securely…"}
                  {status === "generating" && `Generating your model… ${progress}%`}
                  {status === "ready" && "Your model is ready to preview and download."}
                  {status === "error" && "The last attempt did not complete."}
                  {status === "idle" && "Preparing your photos…"}
                </p>
              </div>
              {status === "generating" && (
                <span className="font-mono text-lg tabular-nums text-[#60a5fa]">
                  {progress}%
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {stages.map((stage, index) => {
                const isComplete = currentStageIndex > index;
                const isCurrent = currentStageIndex === index;
                const isFailed = status === "error" && failedStage === stage.id;

                return (
                  <div key={stage.id} className="min-w-0">
                    <div className="mb-2 h-1 overflow-hidden rounded-full bg-[#232832]">
                      {(isComplete || isCurrent) && (
                        <div
                          className={`h-full rounded-full ${
                            isFailed ? "bg-[#fb7185]" : "bg-[#3b82f6]"
                          } ${isCurrent && isProcessing ? "animate-pulse" : ""}`}
                          style={{
                            width:
                              stage.id === "generating" && isCurrent
                                ? `${progress}%`
                                : "100%",
                          }}
                        />
                      )}
                    </div>
                    <p
                      className={`truncate font-mono text-[9px] sm:text-[10px] ${
                        isFailed ? "text-[#fda4af]" : isComplete || isCurrent ? "text-[#bfdbfe]" : "text-[#7d8794]"
                      }`}
                    >
                      {isComplete && (
                        <Check aria-hidden="true" className="mr-1 inline size-3" />
                      )}
                      {stage.label}
                    </p>
                  </div>
                );
              })}
            </div>

            {status === "error" && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-[#7f1d35]/60 bg-[#291b21] px-3 py-3 text-xs leading-5 text-[#fda4af]"
              >
                {error || "An unexpected error occurred. Please try again."}
              </div>
            )}
          </div>

          {status === "ready" && modelUrls && (
            <div className="flex flex-wrap gap-2">
              {modelUrls.glb && (
                <a
                  href={modelUrls.glb}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-[#232832] bg-[#0b0d10] px-3 py-2 text-xs font-semibold text-[#bfdbfe] transition hover:border-[#3b82f6]"
                >
                  <Download aria-hidden="true" className="size-3.5" />
                  Download GLB
                </a>
              )}
              {modelUrls.stl && (
                <a
                  href={modelUrls.stl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-[#232832] bg-[#0b0d10] px-3 py-2 text-xs font-semibold text-[#bfdbfe] transition hover:border-[#3b82f6]"
                >
                  <Download aria-hidden="true" className="size-3.5" />
                  Download STL
                </a>
              )}
              {modelUrls.glb && (
                <button
                  type="button"
                  onClick={onExport}
                  disabled={!exportReady}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2563eb] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1d4ed8] disabled:cursor-wait disabled:opacity-60"
                >
                  <Box aria-hidden="true" className="size-3.5" />
                  {exportReady ? "Export scaled STL" : "Preparing STL export…"}
                </button>
              )}
            </div>
          )}

          <p className="flex items-start gap-2 text-[10px] leading-5 text-[#7d8794]">
            <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[#60a5fa]" />
            Your original photos are submitted for generation. You can dismiss this window while it runs; progress will continue in the background.
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[#232832] bg-[#101318] px-5 py-4 sm:flex-row sm:justify-end sm:px-7">
          {status === "error" ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[#232832] px-4 py-2.5 text-sm font-medium text-[#9ca3af] transition hover:bg-[#1b2029]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1d4ed8]"
              >
                <Sparkles aria-hidden="true" className="size-4" />
                Try again
              </button>
            </>
          ) : status === "ready" ? (
            <button
              type="button"
              onClick={modelUrls?.glb ? onViewModel : onClose}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1d4ed8]"
            >
              <Box aria-hidden="true" className="size-4" />
              {modelUrls?.glb ? "View 3D preview" : "Done"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#232832] px-4 py-2.5 text-sm font-medium text-[#9ca3af] transition hover:bg-[#1b2029]"
            >
              Continue in background
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
