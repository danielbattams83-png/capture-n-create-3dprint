"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Lock, Maximize2, Ruler, Unlock } from "lucide-react";

type ScalingPreviewProps = {
  file: File;
  previewUrl: string;
  widthMm: number;
  heightMm: number;
  proportionsLocked: boolean;
  onWidthChange: (width: number) => void;
  onHeightChange: (height: number) => void;
  onProportionsLockedChange: (locked: boolean) => void;
  onAspectRatioChange: (ratio: number) => void;
};

type DragState = {
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  pixelsPerMm: number;
};

const BED_SIZE_MM = 250;
const RULER_MARKS = [0, 50, 100, 150, 200, 250];

export default function ScalingPreview({
  file,
  previewUrl,
  widthMm,
  heightMm,
  proportionsLocked,
  onWidthChange,
  onHeightChange,
  onProportionsLockedChange,
  onAspectRatioChange,
}: ScalingPreviewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [imageError, setImageError] = useState("");

  useEffect(() => {
    const image = new window.Image();
    image.onload = () => {
      setSourceImage(image);
      setImageError("");
      onAspectRatioChange(image.naturalWidth / image.naturalHeight);
    };
    image.onerror = () => {
      setSourceImage(null);
      setImageError("This image could not be loaded for calibration.");
    };
    image.src = previewUrl;

    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [file, onAspectRatioChange, previewUrl]);

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const grid = gridRef.current;
    if (!grid) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: widthMm,
      startHeight: heightMm,
      pixelsPerMm: grid.clientWidth / BED_SIZE_MM,
    };
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const nextWidth = drag.startWidth + (event.clientX - drag.startX) / drag.pixelsPerMm;
    const nextHeight = drag.startHeight - (event.clientY - drag.startY) / drag.pixelsPerMm;

    if (proportionsLocked) {
      const widthScaleChange = Math.abs(nextWidth / drag.startWidth - 1);
      const heightScaleChange = Math.abs(nextHeight / drag.startHeight - 1);
      if (widthScaleChange >= heightScaleChange) {
        onWidthChange(nextWidth);
      } else {
        onHeightChange(nextHeight);
      }
      return;
    }

    onWidthChange(Math.min(BED_SIZE_MM, Math.max(1, Math.round(nextWidth))));
    onHeightChange(Math.min(BED_SIZE_MM, Math.max(1, Math.round(nextHeight))));
  };

  const stopResize = () => {
    dragRef.current = null;
  };

  const imageWidthPercent = (widthMm / BED_SIZE_MM) * 100;
  const imageHeightPercent = (heightMm / BED_SIZE_MM) * 100;

  return (
    <section className="studio-panel mt-5 overflow-hidden rounded-2xl border border-[#232832] bg-[#14171d]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232832] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#17243a] text-[#60a5fa]">
            <Ruler aria-hidden="true" className="size-[18px]" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-[#f3f4f6]">
              Scaling &amp; Calibration Preview
            </h2>
            <p className="mt-1 text-[11px] text-[#9ca3af]">
              250 × 250 mm build plate · {file.name}
            </p>
          </div>
        </div>
        <span className="font-mono text-[10px] font-medium uppercase tracking-wide text-[#9ca3af]">
          250 MM BED
        </span>
      </div>

      <div className="p-4 sm:p-5">
        <div className="mx-auto max-w-[660px]">
          <div className="mb-1 ml-10 flex h-6 items-end justify-between border-b border-[#2a323d] pl-1">
            {RULER_MARKS.map((mark) => (
              <span
                key={mark}
                className="relative font-mono text-[9px] leading-4 text-[#7d8794]"
              >
                <span className="absolute -bottom-1 left-0 h-1 border-l border-[#556170]" />
                {mark}
              </span>
            ))}
            <span className="font-mono text-[9px] text-[#9ca3af]">WIDTH · MM</span>
          </div>

          <div className="flex">
            <div className="mr-1 flex w-9 flex-col justify-between border-r border-[#2a323d] py-1 text-right">
              {[...RULER_MARKS].reverse().map((mark) => (
                <span
                  key={mark}
                  className="relative pr-1 font-mono text-[9px] leading-3 text-[#7d8794]"
                >
                  <span className="absolute right-0 top-1/2 w-1 border-t border-[#556170]" />
                  {mark}
                </span>
              ))}
              <span className="font-mono text-[8px] uppercase tracking-wide text-[#9ca3af] [writing-mode:vertical-rl]">
                Height · mm
              </span>
            </div>

            <div
              ref={gridRef}
              className="relative aspect-square min-w-0 flex-1 overflow-hidden border border-[#2a323d] bg-[#0b0d10]"
              style={{
                backgroundImage:
                  "linear-gradient(to right, #1e242b 1px, transparent 1px), linear-gradient(to bottom, #1e242b 1px, transparent 1px), linear-gradient(to right, #2a323d 1px, transparent 1px), linear-gradient(to bottom, #2a323d 1px, transparent 1px)",
                backgroundSize: "4% 4%, 4% 4%, 20% 20%, 20% 20%",
              }}
            >
              <div className="pointer-events-none absolute inset-0 z-10">
                <div
                  className="absolute bottom-0 left-1/2 max-w-none -translate-x-1/2"
                  style={{
                    width: `${imageWidthPercent}%`,
                    height: `${imageHeightPercent}%`,
                  }}
                >
                  <div className="pointer-events-none absolute -top-7 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded border border-[#3b82f6]/40 bg-[#0b0d10]/90 px-2 py-1 font-mono text-[10px] text-[#93c5fd]">
                    {widthMm} × {heightMm} mm
                  </div>
                  <div className="pointer-events-none absolute -inset-x-2 -inset-y-1 rounded border border-[#3b82f6] shadow-[0_0_16px_rgba(59,130,246,0.28)]" />
                  <Image
                    src={previewUrl}
                    alt={`Original photo preview of ${file.name}`}
                    fill
                    unoptimized
                    sizes="(max-width: 640px) 65vw, 35vw"
                    className="object-fill"
                  />
                  <button
                    type="button"
                    aria-label={
                      proportionsLocked
                        ? "Drag to resize the model while preserving its proportions"
                        : "Drag to resize the model width and height independently"
                    }
                    onPointerDown={handleResizePointerDown}
                    onPointerMove={handleResizePointerMove}
                    onPointerUp={stopResize}
                    onPointerCancel={stopResize}
                    className="pointer-events-auto absolute -bottom-3 -right-3 z-30 flex size-7 touch-none items-center justify-center rounded-full border border-[#93c5fd] bg-[#2563eb] text-white shadow-[0_0_12px_rgba(59,130,246,0.55)]"
                  >
                    <Maximize2 aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
              </div>

              {!sourceImage && !imageError && (
                <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-[#9ca3af]">
                  Loading image…
                </div>
              )}
              {imageError && (
                <div role="alert" className="absolute inset-x-3 top-3 rounded-lg bg-[#291b21] px-3 py-2 text-xs text-[#fda4af]">
                  {imageError}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 border-t border-[#232832] pt-4 sm:grid-cols-2">
          <label className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#232832] bg-[#0b0d10] text-[#60a5fa]">
              <Ruler aria-hidden="true" className="size-4" />
            </span>
            <span className="w-24 shrink-0 text-xs text-[#9ca3af]">Target width</span>
            <input
              aria-label="Target width in millimeters"
              type="range"
              min="1"
              max={BED_SIZE_MM}
              step="1"
              value={Math.min(BED_SIZE_MM, Math.max(1, widthMm))}
              onChange={(event) => onWidthChange(Number(event.target.value))}
              className="studio-range min-w-0 flex-1"
            />
            <span className="flex items-center gap-1 font-mono text-xs tabular-nums text-[#f3f4f6]">
              <input
                aria-label="Target width in millimeters"
                type="number"
                min="1"
                max={BED_SIZE_MM}
                step="1"
                value={widthMm}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value > 0) onWidthChange(value);
                }}
                className="w-14 bg-transparent text-right font-mono text-xs tabular-nums text-[#f3f4f6] outline-none"
              />
              mm
            </span>
          </label>
          <label className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#232832] bg-[#0b0d10] text-[#60a5fa]">
              <Ruler aria-hidden="true" className="size-4" />
            </span>
            <span className="w-24 shrink-0 text-xs text-[#9ca3af]">Target height</span>
            <input
              aria-label="Target height in millimeters"
              type="range"
              min="1"
              max={BED_SIZE_MM}
              step="1"
              value={Math.min(BED_SIZE_MM, Math.max(1, heightMm))}
              onChange={(event) => onHeightChange(Number(event.target.value))}
              className="studio-range min-w-0 flex-1"
            />
            <span className="flex items-center gap-1 font-mono text-xs tabular-nums text-[#f3f4f6]">
              <input
                aria-label="Target height in millimeters"
                type="number"
                min="1"
                max={BED_SIZE_MM}
                step="1"
                value={heightMm}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value > 0) onHeightChange(value);
                }}
                className="w-14 bg-transparent text-right font-mono text-xs tabular-nums text-[#f3f4f6] outline-none"
              />
              mm
            </span>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            aria-pressed={proportionsLocked}
            onClick={() => onProportionsLockedChange(!proportionsLocked)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
              proportionsLocked
                ? "border-[#3b82f6]/50 bg-[#17243a] text-[#93c5fd]"
                : "border-[#2a323d] bg-[#0b0d10] text-[#9ca3af] hover:border-[#3b82f6]/50 hover:text-[#f3f4f6]"
            }`}
          >
            {proportionsLocked ? (
              <Lock aria-hidden="true" className="size-3.5" />
            ) : (
              <Unlock aria-hidden="true" className="size-3.5" />
            )}
            Lock proportions
          </button>
          <p className="font-mono text-[10px] text-[#7d8794]">
            {proportionsLocked ? "Proportions locked" : "Width and height scale independently"} · 250 mm bed reference
          </p>
        </div>
      </div>
    </section>
  );
}
