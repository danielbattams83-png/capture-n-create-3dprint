import { createHmac, timingSafeEqual } from "node:crypto";

const MESHY_API_BASE_URL = "https://api.meshy.ai/openapi/v1";
const MESHY_REQUEST_TIMEOUT_MS = 30_000;

export class MeshyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MeshyApiError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
    const requestHost = forwardedHost || request.headers.get("host");
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
    const requestProtocol = forwardedProtocol || new URL(request.url).protocol.slice(0, -1);

    return originUrl.host === requestHost && originUrl.protocol.slice(0, -1) === requestProtocol;
  } catch {
    return false;
  }
}

export type MeshyTaskType = "image-to-3d" | "multi-image-to-3d";

export function createTaskToken(taskId: string, taskType: MeshyTaskType): string {
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) {
    throw new MeshyApiError("Image generation is not configured. Check the server environment.", 500);
  }
  return createHmac("sha256", apiKey).update(`${taskType}:${taskId}`).digest("hex");
}

export function verifyTaskToken(taskId: string, taskType: MeshyTaskType, token: string): boolean {
  if (!/^[\da-f]{64}$/i.test(token)) return false;

  const expected = Buffer.from(createTaskToken(taskId, taskType), "hex");
  const provided = Buffer.from(token, "hex");
  return timingSafeEqual(expected, provided);
}

export function getErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;

  const message = value.message ?? value.error;
  if (typeof message === "string" && message.trim()) {
    return message.trim().replace(/meshy/gi, "image generation service").slice(0, 500);
  }

  if (isRecord(message) && typeof message.message === "string") {
    return message.message.trim().replace(/meshy/gi, "image generation service").slice(0, 500);
  }

  return undefined;
}

export async function fetchMeshy(path: string, init: RequestInit): Promise<unknown> {
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) {
    throw new MeshyApiError("Image generation is not configured. Check the server environment.", 500);
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${MESHY_API_BASE_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(MESHY_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new MeshyApiError("The image generation request timed out. Please try again.", 504);
    }

    throw new MeshyApiError("Unable to reach the image generation service. Please try again.", 502);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MeshyApiError("The image generation service returned an invalid response.", 502);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new MeshyApiError("The image generation service rejected its server credentials.", 500);
    }

    const status =
      response.status === 429 ? 503 : response.status >= 500 ? 502 : response.status;
    const message = getErrorMessage(payload);
    throw new MeshyApiError(
      message ? `Image generation error: ${message}` : "The image generation request failed.",
      status,
    );
  }

  return payload;
}
