"use client";

import { upload } from "@vercel/blob/client";

type UploadKind = "image" | "model" | "creation";

type UploadSession = {
  authorization: string;
  sessionId: string;
  pathnames: string[];
  expiresAt: number;
};

async function createUploadSession(
  kind: UploadKind,
  files: File[],
  signal: AbortSignal,
): Promise<UploadSession> {
  const response = await fetch("/api/blob/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind,
      files: files.map((file) => ({
        contentType:
          file.type ||
          (kind === "model" || kind === "creation" ? "model/gltf-binary" : ""),
        size: file.size,
      })),
    }),
    signal,
  });
  const result: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    typeof result !== "object" ||
    result === null ||
    !("authorization" in result) ||
    typeof result.authorization !== "string" ||
    !("sessionId" in result) ||
    typeof result.sessionId !== "string" ||
    !("pathnames" in result) ||
    !Array.isArray(result.pathnames) ||
    result.pathnames.some((pathname) => typeof pathname !== "string") ||
    !("expiresAt" in result) ||
    typeof result.expiresAt !== "number"
  ) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "The upload could not be authorized.";
    throw new Error(message);
  }
  return result as UploadSession;
}

export async function uploadTemporaryFiles(input: {
  files: File[];
  kind: UploadKind;
  signal: AbortSignal;
  onProgress?: (percentage: number) => void;
}): Promise<{ urls: string[]; authorization: string }> {
  const session = await createUploadSession(input.kind, input.files, input.signal);
  const progress = input.files.map(() => 0);

  const blobs = await Promise.all(
    input.files.map((file, index) =>
      upload(
        session.pathnames[index],
        file,
        {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          clientPayload: JSON.stringify({
            authorization: session.authorization,
            kind: input.kind,
          }),
          contentType:
            file.type ||
            (input.kind === "model" || input.kind === "creation"
              ? "model/gltf-binary"
              : undefined),
          multipart: file.size > 5 * 1024 * 1024,
          abortSignal: input.signal,
          onUploadProgress: ({ percentage }) => {
            progress[index] = percentage;
            input.onProgress?.(
              progress.reduce((sum, value) => sum + value, 0) / progress.length,
            );
          },
        },
      ),
    ),
  );

  return {
    urls: blobs.map((blob) => blob.url),
    authorization: session.authorization,
  };
}
