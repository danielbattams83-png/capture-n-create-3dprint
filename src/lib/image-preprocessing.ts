"use client";

const ALPHA_THRESHOLD = 8;
const SUBJECT_PADDING_RATIO = 0.1;
const MAX_PROCESSED_IMAGE_BYTES = 1_000_000;
const MIN_OUTPUT_DIMENSION = 32;
const MAX_PREP_EDGE = 1600;
const MOBILE_REMOVAL_TIMEOUT_MS = 20_000;

type CropBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CropScanResult = {
  bounds?: CropBounds;
  error?: string;
};

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

function isMobileBrowser(): boolean {
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const narrowScreen = window.matchMedia("(max-width: 900px)").matches;
  return coarsePointer || narrowScreen;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Background removal took too long on this device."));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function bitmapToPngFile(bitmap: ImageBitmap, name: string): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Image processing is unavailable in this browser.");
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvasToPngBlob(canvas);
  return new File([blob], name, { type: "image/png", lastModified: Date.now() });
}

export async function downscalePhoto(file: File, maxEdge = MAX_PREP_EDGE): Promise<File> {
  if (!("createImageBitmap" in window)) return file;

  const bitmap = await createImageBitmap(file);
  const largestEdge = Math.max(bitmap.width, bitmap.height);
  if (largestEdge <= maxEdge) {
    bitmap.close();
    return file;
  }

  const scale = maxEdge / largestEdge;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const resized = await createImageBitmap(bitmap, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
  });
  bitmap.close();
  const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
  return bitmapToPngFile(resized, `${baseName}.png`);
}

function scanCropBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  paddingRatio: number,
): Promise<CropBounds> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./cropWorker.ts", import.meta.url), { type: "module" });
    const copy = new Uint8ClampedArray(pixels);
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("The subject crop timed out."));
    }, 8000);

    worker.onmessage = (event: MessageEvent<CropScanResult>) => {
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data.bounds) {
        resolve(event.data.bounds);
        return;
      }
      reject(new Error(event.data.error ?? "The subject crop could not be scanned."));
    };
    worker.onerror = () => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error("The subject crop could not be scanned."));
    };
    worker.postMessage(
      {
        pixels: copy,
        width,
        height,
        paddingRatio,
        alphaThreshold: ALPHA_THRESHOLD,
      },
      [copy.buffer],
    );
  });
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
  const bounds = await scanCropBounds(pixels, width, height, paddingRatio);

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = bounds.width;
  outputCanvas.height = bounds.height;
  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) throw new Error("Image processing is unavailable in this browser.");
  outputContext.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );

  return encodePngWithinLimit(outputCanvas, maxBytes);
}

export async function isolateAndCropSubject(file: File): Promise<File> {
  const prepared = await downscalePhoto(file);
  const baseName = prepared.name.replace(/\.[^.]+$/, "") || "subject";

  try {
    const { removeBackground } = await import("@imgly/background-removal");
    const removal = removeBackground(prepared, {
      output: { format: "image/png", quality: 1 },
    });
    const transparentImage = isMobileBrowser()
      ? await withTimeout(removal, MOBILE_REMOVAL_TIMEOUT_MS)
      : await removal;
    const croppedImage = await cropTransparentImage(
      transparentImage,
      SUBJECT_PADDING_RATIO,
      Math.min(prepared.size, MAX_PROCESSED_IMAGE_BYTES),
    );
    return new File([croppedImage], `${baseName}-isolated.png`, {
      type: "image/png",
      lastModified: Date.now(),
    });
  } catch (error) {
    if (!isMobileBrowser()) throw error;
    console.error("Background removal was skipped on this device.", error);
    return prepared;
  }
}
