import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { del, head, list } from "@vercel/blob";
import { MeshyApiError } from "@/lib/meshy";
import { isStudioUserId } from "@/lib/session";

export const IMAGE_UPLOAD_PREFIX = "temp/meshy/images";
export const MODEL_UPLOAD_PREFIX = "temp/meshy/models";
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
export const MAX_MODEL_SIZE = 100 * 1024 * 1024;
export const UPLOAD_SESSION_TTL_MS = 10 * 60 * 1000;

export type UploadKind = "image" | "model" | "creation";
export const CREATION_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

type UploadSession = {
  sid: string;
  userId: string;
  kind: UploadKind;
  pathnames: string[];
  exp: number;
};

export function getBlobReadWriteToken(): string | undefined {
  return (
    process.env.MESHY_BLOB_READ_WRITE_TOKEN ||
    process.env.BLOB_READ_WRITE_TOKEN
  );
}

function getBlobCommandOptions(): {
  token?: string;
  storeId?: string;
} {
  return {
    token: getBlobReadWriteToken(),
    storeId:
      process.env.MESHY_BLOB_STORE_ID ||
      process.env.BLOB_STORE_ID,
  };
}

function getSigningSecret(): string {
  const secret = process.env.BLOB_UPLOAD_SECRET || process.env.MESHY_API_KEY;
  if (!secret) {
    throw new MeshyApiError("Uploads are not configured. Check the server environment.", 500);
  }
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSigningSecret()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createUploadSession(
  userId: string,
  kind: UploadKind,
  files: { contentType: string; size: number }[],
): {
  authorization: string;
  sessionId: string;
  pathnames: string[];
  expiresAt: number;
} {
  if (!isStudioUserId(userId)) {
    throw new MeshyApiError("Upload authorization requires a studio session.", 401);
  }

  const maximumCount = kind === "image" ? 4 : kind === "creation" ? 2 : 1;
  const allowedTypes =
    kind === "image"
      ? new Set(["image/jpeg", "image/png", "image/webp"])
      : kind === "creation"
        ? new Set(["model/gltf-binary", "application/octet-stream", "image/png"])
        : new Set(["model/gltf-binary", "application/octet-stream"]);
  const maximumSize = kind === "image" ? MAX_IMAGE_SIZE : MAX_MODEL_SIZE;
  const creationModelCount = files.filter(
    (file) => file.contentType === "model/gltf-binary" || file.contentType === "application/octet-stream",
  ).length;
  if (
    files.length < 1 ||
    files.length > maximumCount ||
    (kind === "creation" && (creationModelCount !== 1 || files.length > 2)) ||
    files.some(
      (file) =>
        !allowedTypes.has(file.contentType) ||
        !Number.isSafeInteger(file.size) ||
        file.size <= 0 ||
        file.size > (file.contentType === "image/png" && kind === "creation"
          ? CREATION_THUMBNAIL_MAX_BYTES
          : maximumSize),
    )
  ) {
    throw new MeshyApiError("The requested uploads have an invalid type, size, or count.", 400);
  }

  const sessionId = randomUUID();
  const pathnames = files.map((file) => {
    const extension =
      kind === "model" || file.contentType === "model/gltf-binary" || file.contentType === "application/octet-stream"
        ? "glb"
        : file.contentType === "image/jpeg"
          ? "jpg"
          : file.contentType === "image/webp"
            ? "webp"
            : "png";
    return `${getUploadPrefix(kind, sessionId, userId)}${randomUUID()}.${extension}`;
  });
  const session: UploadSession = {
    sid: sessionId,
    userId,
    kind,
    pathnames,
    exp: Date.now() + UPLOAD_SESSION_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return {
    authorization: `${payload}.${sign(payload)}`,
    sessionId: session.sid,
    pathnames,
    expiresAt: session.exp,
  };
}

export function verifyUploadSession(userId: string, token: string): UploadSession | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !safeEqual(sign(payload), signature)) return null;

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<UploadSession>;
    if (
      typeof session.sid !== "string" ||
      !/^[\da-f-]{36}$/i.test(session.sid) ||
      typeof session.userId !== "string" ||
      !isStudioUserId(session.userId) ||
      session.userId !== userId ||
      (session.kind !== "image" && session.kind !== "model" && session.kind !== "creation") ||
      !Array.isArray(session.pathnames) ||
      session.pathnames.length < 1 ||
      session.pathnames.some(
        (pathname) =>
          typeof pathname !== "string" ||
          !isAllowedUploadPath(
            pathname,
            session.kind as UploadKind,
            session.sid as string,
            session.userId,
          ),
      ) ||
      typeof session.exp !== "number" ||
      session.exp <= Date.now()
    ) {
      return null;
    }
    return session as UploadSession;
  } catch {
    return null;
  }
}

export function getUploadPrefix(kind: UploadKind, sessionId: string, userId?: string): string {
  if (kind === "creation") return `creations/${userId}/${sessionId}/`;
  const root = kind === "image" ? IMAGE_UPLOAD_PREFIX : MODEL_UPLOAD_PREFIX;
  return `${root}/${sessionId}/`;
}

export function isAllowedUploadPath(
  pathname: string,
  kind: UploadKind,
  sessionId: string,
  userId?: string,
): boolean {
  const prefix = getUploadPrefix(kind, sessionId, userId);
  if (!pathname.startsWith(prefix) || pathname.includes("..")) return false;
  const filename = pathname.slice(prefix.length);
  if (!filename || filename.includes("/")) return false;
  if (kind === "image") return /\.(?:jpe?g|png|webp)$/i.test(filename);
  if (kind === "creation") return /\.(?:glb|png)$/i.test(filename);
  return /\.glb$/i.test(filename);
}

function isPublicBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".public.blob.vercel-storage.com")
    );
  } catch {
    return false;
  }
}

export async function validateUploadedBlobs(input: {
  userId: string;
  authorization: string;
  urls: string[];
  kind: UploadKind;
}): Promise<string[]> {
  const session = verifyUploadSession(input.userId, input.authorization);
  if (!session) throw new MeshyApiError("The upload authorization is invalid or expired.", 403);

  const maximumCount = input.kind === "image" ? 4 : input.kind === "creation" ? 2 : 1;
  if (input.urls.length < 1 || input.urls.length > maximumCount) {
    throw new MeshyApiError(
      input.kind === "image"
        ? "Provide one to four uploaded images."
        : input.kind === "creation"
          ? "Provide the creation model and an optional thumbnail."
          : "Provide one uploaded GLB.",
      400,
    );
  }

  const expectedTypes =
    input.kind === "image"
      ? new Set(["image/jpeg", "image/png", "image/webp"])
      : input.kind === "creation"
        ? new Set(["model/gltf-binary", "application/octet-stream", "image/png"])
        : new Set(["model/gltf-binary", "application/octet-stream"]);
  const maximumSize = input.kind === "image" ? MAX_IMAGE_SIZE : MAX_MODEL_SIZE;
  const validated: string[] = [];

  for (const value of input.urls) {
    if (
      typeof value !== "string" ||
      !isPublicBlobUrl(value) ||
      session.kind !== input.kind ||
      !session.pathnames.includes(new URL(value).pathname.slice(1))
    ) {
      throw new MeshyApiError("An uploaded file URL is not authorized for this session.", 403);
    }

    let metadata;
    try {
      metadata = await head(value, getBlobCommandOptions());
    } catch {
      throw new MeshyApiError("An uploaded file could not be verified.", 400);
    }
    if (
      !session.pathnames.includes(metadata.pathname) ||
      metadata.size <= 0 ||
      metadata.size > (metadata.contentType === "image/png" && input.kind === "creation"
        ? CREATION_THUMBNAIL_MAX_BYTES
        : maximumSize) ||
      !expectedTypes.has(metadata.contentType)
    ) {
      throw new MeshyApiError("An uploaded file has an invalid type or size.", 415);
    }
    validated.push(metadata.url);
  }

  return validated;
}

export async function deleteTemporaryBlobs(urls: string[]): Promise<void> {
  const safeUrls = urls.filter(isPublicBlobUrl);
  if (safeUrls.length === 0) return;
  try {
    await del(safeUrls, getBlobCommandOptions());
  } catch (error) {
    console.error("Temporary Blob cleanup failed.", error);
  }
}

export async function deleteExpiredTemporaryBlobs(
  olderThan: Date,
): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await list({
      prefix: "temp/meshy/",
      cursor,
      limit: 1000,
      ...getBlobCommandOptions(),
    });
    const expired = page.blobs
      .filter((blob) => blob.uploadedAt < olderThan)
      .map((blob) => blob.url);
    if (expired.length > 0) {
      await del(expired, getBlobCommandOptions());
      deleted += expired.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}
