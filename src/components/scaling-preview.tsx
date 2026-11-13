"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, Ruler, Scissors, SlidersHorizontal } from "lucide-react";

type ScalingPreviewProps = {
  file: File;
  previewUrl: string;
  widthMm: number;
  heightMm: number;
  onHeightChange: (height: number) => void;
  onAspectRatioChange: (ratio: number) => void;
};

type DragState = {
  startY: number;
  startHeight: number;
  pixelsPerMm: number;
};

const BED_SIZE_MM = 250;
const RULER_MARKS = [0, 50, 100, 150, 200, 250];

function colorDistance(
  red: number,
  green: number,
  blue: number,
  color: [number, number, number],
) {
  return Math.hypot(red - color[0], green - color[1], blue - color[2]);
}

function sampleCorner(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number] {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let offsetY = 0; offsetY < 3; offsetY += 1) {
    for (let offsetX = 0; offsetX < 3; offsetX += 1) {
      const pixelX = Math.min(width - 1, x + offsetX);
      const pixelY = Math.min(height - 1, y + offsetY);
      const index = (pixelY * width + pixelX) * 4;
      if (data[index + 3] === 0) continue;
      red += data[index];
      green += data[index + 1];
      blue += data[index + 2];
      count += 1;
    }
  }

  return count > 0
    ? [red / count, green / count, blue / count]
    : [0, 0, 0];
}

export default function ScalingPreview({
  file,
  previewUrl,
  widthMm,
  heightMm,
  onHeightChange,
  onAspectRatioChange,
}: ScalingPreviewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [tolerance, setTolerance] = useState(25);
  const [showCutout, setShowCutout] = useState(false);
  const [subjectBounds, setSubjectBounds] = useState<{
    widthPercent: number;
    heightPercent: number;
  } | null>(null);
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

  useEffect(() => {
    const output = canvasRef.current;
    if (!output || !showCutout || !sourceImage) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const maxBufferSize = 360;
      const scale = Math.min(
        1,
        maxBufferSize / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight),
      );
      const width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
      const height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));
      const buffer = document.createElement("canvas");
      buffer.width = width;
      buffer.height = height;
      const bufferContext = buffer.getContext("2d", { willReadFrequently: true });
      const outputContext = output.getContext("2d");
      if (!bufferContext || !outputContext) {
        setImageError("The cutout preview is unavailable in this browser.");
        return;
      }

      bufferContext.drawImage(sourceImage, 0, 0, width, height);
      const imageData = bufferContext.getImageData(0, 0, width, height);
      const pixels = imageData.data;
      const cornerColors = [
        sampleCorner(pixels, width, height, 0, 0),
        sampleCorner(pixels, width, height, width - 3, 0),
        sampleCorner(pixels, width, height, 0, height - 3),
        sampleCorner(pixels, width, height, width - 3, height - 3),
      ];
      const threshold = (tolerance / 100) * Math.sqrt(3 * 255 * 255);
      const pixelCount = width * height;
      const queue = new Int32Array(pixelCount);
      let queueStart = 0;
      let queueEnd = 0;

      const enqueueIfBackground = (pixel: number) => {
        const index = pixel * 4;
        if (pixels[index + 3] === 0) return;
        const matchesCorner = cornerColors.some(
          (color) =>
            colorDistance(pixels[index], pixels[index + 1], pixels[index + 2], color) <=
            threshold,
        );
        if (!matchesCorner) return;
        pixels[index + 3] = 0;
        queue[queueEnd] = pixel;
        queueEnd += 1;
      };

      for (let x = 0; x < width; x += 1) {
        enqueueIfBackground(x);
        enqueueIfBackground((height - 1) * width + x);
      }
      for (let y = 1; y < height - 1; y += 1) {
        enqueueIfBackground(y * width);
        enqueueIfBackground(y * width + width - 1);
      }

      while (queueStart < queueEnd) {
        const pixel = queue[queueStart];
        queueStart += 1;
        const x = pixel % width;
        if (x > 0) enqueueIfBackground(pixel - 1);
        if (x + 1 < width) enqueueIfBackground(pixel + 1);
        if (pixel >= width) enqueueIfBackground(pixel - width);
        if (pixel + width < pixelCount) enqueueIfBackground(pixel + width);
      }

      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const index = pixel * 4;
        if (pixels[index + 3] === 0) continue;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        pixels[index] = 59;
        pixels[index + 1] = 130;
        pixels[index + 2] = 246;
        pixels[index + 3] = Math.round(pixels[index + 3] * 0.78);
      }

      bufferContext.putImageData(imageData, 0, 0);
      output.width = width;
      output.height = height;
      outputContext.clearRect(0, 0, width, height);
      outputContext.drawImage(buffer, 0, 0);
      setSubjectBounds(
        maxY >= minY && maxX >= minX
          ? {
              widthPercent: ((maxX - minX + 1) / width) * 100,
              heightPercent: ((maxY - minY + 1) / height) * 100,
            }
          : null,
      );
      setImageError("");
    });

    return () => window.cancelAnimationFrame(frame);
  }, [showCutout, sourceImage, tolerance]);

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const grid = gridRef.current;
    if (!grid) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startY: event.clientY,
      startHeight: heightMm,
      pixelsPerMm: grid.clientWidth / BED_SIZE_MM,
    };
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const nextHeight = drag.startHeight - (event.clientY - drag.startY) / drag.pixelsPerMm;
    onHeightChange(Math.min(maxTargetHeight, Math.max(1, Math.round(nextHeight))));
  };

  const stopResize = () => {
    dragRef.current = null;
  };

  const aspectRatio = sourceImage
    ? sourceImage.naturalWidth / sourceImage.naturalHeight
    : widthMm / heightMm;
  const maxTargetHeight = Math.max(
    1,
    Math.min(BED_SIZE_MM, Math.floor(BED_SIZE_MM / aspectRatio)),
  );
  const imageWidthPercent = (widthMm / BED_SIZE_MM) * 100;

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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex rounded-lg border border-[#232832] bg-[#0b0d10] p-1"
            role="group"
            aria-label="Preview mode"
          >
            <button
              type="button"
              onClick={() => setShowCutout(false)}
              aria-pressed={!showCutout}
              className={`rounded-md px-3 py-2 text-xs font-medium transition ${
                showCutout
                  ? "text-[#9ca3af] hover:bg-[#14171d]"
                  : "bg-[#232832] text-[#f3f4f6]"
              }`}
            >
              Original Photo
            </button>
            <button
              type="button"
              onClick={() => setShowCutout(true)}
              aria-pressed={showCutout}
              className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition ${
                showCutout
                  ? "bg-[#17243a] text-[#60a5fa]"
                  : "text-[#9ca3af] hover:bg-[#14171d]"
              }`}
            >
              <Scissors aria-hidden="true" className="size-3.5" />
              Cutout Silhouette
            </button>
          </div>

          {showCutout && (
            <label className="flex min-w-[210px] flex-1 items-center gap-3 sm:max-w-[300px]">
              <SlidersHorizontal
                aria-hidden="true"
                className="size-4 shrink-0 text-[#9ca3af]"
              />
              <span className="whitespace-nowrap text-[11px] text-[#9ca3af]">
                Cutout tolerance
              </span>
              <input
                aria-label="Cutout tolerance"
                type="range"
                min="0"
                max="100"
                value={tolerance}
                onChange={(event) => setTolerance(Number(event.target.value))}
                className="studio-range min-w-0 flex-1"
              />
              <span className="w-10 text-right font-mono text-xs tabular-nums text-[#60a5fa]">
                {tolerance}%
              </span>
            </label>
          )}
        </div>

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
              <div className="pointer-events-none absolute inset-x-0 bottom-[8%] z-10 flex justify-center">
                <div
                  className="relative max-w-none"
                  style={{
                    width: `${imageWidthPercent}%`,
                    aspectRatio: `${aspectRatio}`,
                    maxHeight: "92%",
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
                    className={`object-fill transition-opacity ${
                      showCutout ? "opacity-0" : "opacity-100"
                    }`}
                  />
                  <canvas
                    ref={canvasRef}
                    aria-label="Color-keyed cutout silhouette preview"
                    role="img"
                    className={`absolute inset-0 size-full transition-opacity drop-shadow-[0_0_8px_rgba(59,130,246,0.7)] ${
                      showCutout ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  {showCutout && subjectBounds && (
                    <span className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-[#3b82f6]/40 bg-[#0b0d10]/85 px-2 py-1 font-mono text-[9px] text-[#93c5fd]">
                      SUBJECT ≈{" "}
                      {((widthMm * subjectBounds.widthPercent) / 100).toFixed(1)} ×{" "}
                      {((heightMm * subjectBounds.heightPercent) / 100).toFixed(1)} MM
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label="Drag to resize the model while preserving its aspect ratio"
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

        <div className="mt-4 flex flex-col gap-3 border-t border-[#232832] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#232832] bg-[#0b0d10] text-[#60a5fa]">
              <Ruler aria-hidden="true" className="size-4" />
            </span>
            <span className="w-24 shrink-0 text-xs text-[#9ca3af]">Target height</span>
            <input
              aria-label="Target height in millimeters"
              type="range"
              min="1"
              max={maxTargetHeight}
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
                max={maxTargetHeight}
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
          <p className="font-mono text-[10px] text-[#7d8794]">
            Aspect locked · 250 mm bed reference
          </p>
        </div>

        {showCutout && (
          <p className="mt-3 flex items-center gap-2 text-[10px] leading-5 text-[#7d8794]">
            <SlidersHorizontal aria-hidden="true" className="size-3.5 shrink-0" />
            Cutout is a local visual guide only. The original image file is sent unchanged for generation.
          </p>
        )}
      </div>
    </section>
  );
}
