type CropScanRequest = {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  paddingRatio: number;
  alphaThreshold: number;
};

type CropScanResult = {
  bounds?: { x: number; y: number; width: number; height: number };
  error?: string;
};

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<CropScanRequest>) => void) | null;
  postMessage: (message: CropScanResult) => void;
};

scope.onmessage = (event) => {
  const { pixels, width, height, paddingRatio, alphaThreshold } = event.data;
  if (
    !pixels ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    pixels.length < width * height * 4
  ) {
    scope.postMessage({ error: "The crop scan received an invalid image." });
    return;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (pixels[row + x * 4 + 3] <= alphaThreshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    scope.postMessage({ error: "No foreground subject was detected in this image." });
    return;
  }

  const subjectWidth = maxX - minX + 1;
  const subjectHeight = maxY - minY + 1;
  const paddingX = Math.ceil(subjectWidth * paddingRatio);
  const paddingY = Math.ceil(subjectHeight * paddingRatio);
  const cropX = Math.max(0, minX - paddingX);
  const cropY = Math.max(0, minY - paddingY);
  const cropMaxX = Math.min(width - 1, maxX + paddingX);
  const cropMaxY = Math.min(height - 1, maxY + paddingY);

  scope.postMessage({
    bounds: {
      x: cropX,
      y: cropY,
      width: cropMaxX - cropX + 1,
      height: cropMaxY - cropY + 1,
    },
  });
};

export {};
