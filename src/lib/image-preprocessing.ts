"use client";

const ALPHA_THRESHOLD = 8;
const SUBJECT_PADDING_RATIO = 0.1;
const MAX_PROCESSED_IMAGE_BYTES = 1_000_000;
const MIN_OUTPUT_DIMENSION = 32;

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The isolated image could not be encoded."));
      }
    }, "image/png");
  });
}

async function encodePngWithinLimit(
  sourceCanvas: HTMLCanvasElement,
  maxBytes: number,
): Promise<Blob> {
  let canvas = sourceCanvas;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const blob = await canvasToPngBlob(canvas);
    if (blob.size <= maxBytes) return blob;

    if (
      canvas.width <= MIN_OUTPUT_DIMENSION &&
      canvas.height <= MIN_OUTPUT_DIMENSION
    ) {
      break;
    }

    const sizeRatio = Math.sqrt(maxBytes / blob.size) * 0.94;
    const scale = Math.max(0.5, Math.min(0.85, sizeRatio));
    const resizedCanvas = document.createElement("canvas");
    resizedCanvas.width = Math.max(
      MIN_OUTPUT_DIMENSION,
      Math.floor(canvas.width * scale),
    );
    resizedCanvas.height = Math.max(
      MIN_OUTPUT_DIMENSION,
      Math.floor(canvas.height * scale),
    );
    const context = resizedCanvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable in this browser.");
    context.drawImage(canvas, 0, 0, resizedCanvas.width, resizedCanvas.height);
    canvas = resizedCanvas;
  }

  throw new Error("The isolated image could not be reduced to a safe upload size.");
}

async function drawBlobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");

  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(blob);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      throw new Error("Image processing is unavailable in this browser.");
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  }

  const sourceUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The isolated image could not be decoded."));
      element.src = sourceUrl;
    });
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable in this browser.");
    context.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function cropTransparentImage(
  transparentImage: Blob,
  paddingRatio = SUBJECT_PADDING_RATIO,
  maxBytes = MAX_PROCESSED_IMAGE_BYTES,
): Promise<Blob> {
  const sourceCanvas = await drawBlobToCanvas(transparentImage);
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Image processing is unavailable in this browser.");

  const { width, height } = sourceCanvas;
  const pixels = sourceContext.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha <= ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error("No foreground subject was detected in this image.");
  }

  const subjectWidth = maxX - minX + 1;
  const subjectHeight = maxY - minY + 1;
  const paddingX = Math.ceil(subjectWidth * paddingRatio);
  const paddingY = Math.ceil(subjectHeight * paddingRatio);
  const cropX = Math.max(0, minX - paddingX);
  const cropY = Math.max(0, minY - paddingY);
  const cropMaxX = Math.min(width - 1, maxX + paddingX);
  const cropMaxY = Math.min(height - 1, maxY + paddingY);
  const cropWidth = cropMaxX - cropX + 1;
  const cropHeight = cropMaxY - cropY + 1;

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = cropWidth;
  outputCanvas.height = cropHeight;
  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) throw new Error("Image processing is unavailable in this browser.");
  outputContext.drawImage(
    sourceCanvas,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );

  return encodePngWithinLimit(outputCanvas, maxBytes);
}

export async function isolateAndCropSubject(file: File): Promise<File> {
  const { removeBackground } = await import("@imgly/background-removal");
  const transparentImage = await removeBackground(file, {
    output: { format: "image/png", quality: 1 },
  });
  const croppedImage = await cropTransparentImage(
    transparentImage,
    SUBJECT_PADDING_RATIO,
    Math.min(file.size, MAX_PROCESSED_IMAGE_BYTES),
  );
  const baseName = file.name.replace(/\.[^.]+$/, "") || "subject";

  return new File([croppedImage], `${baseName}-isolated.png`, {
    type: "image/png",
    lastModified: Date.now(),
  });
}
