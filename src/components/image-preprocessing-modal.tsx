"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { AlertCircle, Check, LoaderCircle, Sparkles, X } from "lucide-react";

export type ProcessedImageReview = {
  file: File;
  previewUrl: string;
};

type ImagePreprocessingModalProps = {
  open: boolean;
  phase: "processing" | "review" | "error" | null;
  images: ProcessedImageReview[];
  sourceFiles: File[];
  completedCount: number;
  totalCount: number;
  error: string;
  onApprove: () => void;
  onCancel: () => void;
  onRetry: () => void;
};

function formatFileSize(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(2)} MB`
    : `${Math.max(1, Math.round(bytes / 1_000))} KB`;
}

export default function ImagePreprocessingModal({
  open,
  phase,
  images,
  sourceFiles,
  completedCount,
  totalCount,
  error,
  onApprove,
  onCancel,
  onRetry,
}: ImagePreprocessingModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const filesRequiringOptimization = sourceFiles.filter(
    (file) => file.size > 1_000_000,
  );
  const sourceSize = sourceFiles.reduce((total, file) => total + file.size, 0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="image-preprocessing-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      style={{ display: open ? "flex" : "none" }}
      className="fixed inset-0 m-0 flex h-dvh w-screen max-h-none max-w-none items-center justify-center overflow-y-auto border-0 bg-transparent p-4 text-[#f3f4f6] backdrop:bg-black/80 sm:p-6"
    >
      <div className="studio-panel relative my-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-[#232832] bg-[#14171d] shadow-[0_24px_100px_rgba(0,0,0,0.65)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#232832] px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#17243a] text-[#60a5fa]">
              {phase === "processing" ? (
                <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
              ) : phase === "error" ? (
                <AlertCircle aria-hidden="true" className="size-5 text-[#fda4af]" />
              ) : (
                <Sparkles aria-hidden="true" className="size-5" />
              )}
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#60a5fa]">
                Image preparation
              </p>
              <h2
                id="image-preprocessing-title"
                className="mt-1 text-base font-semibold sm:text-lg"
              >
                {phase === "processing"
                  ? "Isolating subject..."
                  : phase === "error"
                    ? "Could not isolate the subject"
                    : "Approve isolated images"}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel image preparation"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#232832] bg-[#0b0d10] text-[#9ca3af] transition hover:border-[#3b82f6] hover:text-[#f3f4f6]"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-5 sm:p-7">
          {filesRequiringOptimization.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="mb-5 flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3.5 py-3 text-amber-100"
            >
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-amber-300"
              />
              <p className="text-xs leading-5">
                <span className="font-semibold">Large file warning:</span>{" "}
                {sourceFiles.length === 1
                  ? `the selected file is ${formatFileSize(sourceSize)}`
                  : `${sourceFiles.length} selected files total ${formatFileSize(sourceSize)}`}
                . {filesRequiringOptimization.length === 1 ? "One file is" : `${filesRequiringOptimization.length} files are`} over the safe 1 MB target and will be reduced before upload.
              </p>
            </div>
          )}

          {phase === "processing" && (
            <div className="flex min-h-72 flex-col items-center justify-center text-center">
              <span className="flex size-16 items-center justify-center rounded-2xl border border-[#2b3440] bg-[#0b0d10] text-[#60a5fa]">
                <LoaderCircle aria-hidden="true" className="size-7 animate-spin" />
              </span>
              <p className="mt-5 text-base font-semibold">Isolating subject...</p>
              <p className="mt-2 max-w-md text-xs leading-5 text-[#9ca3af]">
                Removing the background and cropping to the subject with a 10% safety margin.
                The first image can take longer while the model loads.
              </p>
              {totalCount > 1 && (
                <p className="mt-4 font-mono text-[10px] text-[#7d8794]">
                  {Math.min(completedCount + 1, totalCount)} OF {totalCount}
                </p>
              )}
            </div>
          )}

          {phase === "review" && (
            <>
              <p className="mb-4 text-sm leading-6 text-[#b9c0ca]">
                Review the transparent, auto-cropped {images.length === 1 ? "image" : "images"} before adding {images.length === 1 ? "it" : "them"} to your model.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {images.map(({ file, previewUrl }, index) => (
                  <div
                    key={`${file.name}-${file.lastModified}`}
                    className="overflow-hidden rounded-xl border border-[#2b3440] bg-[#0b0d10]"
                  >
                    <div
                      className="relative aspect-square"
                      style={{
                        backgroundColor: "#14171d",
                        backgroundImage:
                          "linear-gradient(45deg, #242a33 25%, transparent 25%), linear-gradient(-45deg, #242a33 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #242a33 75%), linear-gradient(-45deg, transparent 75%, #242a33 75%)",
                        backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
                        backgroundSize: "16px 16px",
                      }}
                    >
                      <Image
                        src={previewUrl}
                        alt={`Isolated subject preview ${index + 1}`}
                        fill
                        unoptimized
                        sizes="(max-width: 640px) 90vw, 320px"
                        className="object-contain p-3"
                      />
                    </div>
                    <p className="flex items-center justify-between gap-3 border-t border-[#2b3440] px-3 py-2 font-mono text-[10px] text-[#9ca3af]">
                      <span className="min-w-0 truncate">{file.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {formatFileSize(file.size)}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          {phase === "error" && (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <AlertCircle aria-hidden="true" className="size-8 text-[#fda4af]" />
              <p role="alert" className="mt-4 max-w-lg text-sm leading-6 text-[#fda4af]">
                {error}
              </p>
              <p className="mt-2 max-w-md text-xs leading-5 text-[#9ca3af]">
                Check your connection and try again. Image processing runs locally after the model files are downloaded.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[#232832] bg-[#101318] px-5 py-4 sm:flex-row sm:justify-end sm:px-7">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[#2b3440] px-4 py-2.5 text-sm font-medium text-[#9ca3af] transition hover:bg-[#1b2029] hover:text-white"
          >
            {phase === "processing" ? "Cancel" : "Discard"}
          </button>
          {phase === "error" && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1d4ed8]"
            >
              Try again
            </button>
          )}
          {phase === "review" && (
            <button
              type="button"
              onClick={onApprove}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1d4ed8]"
            >
              <Check aria-hidden="true" className="size-4" />
              Use isolated {images.length === 1 ? "image" : "images"}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
