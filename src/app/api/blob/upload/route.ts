import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import {
  getBlobReadWriteToken,
  getUploadPrefix,
  isAllowedUploadPath,
  MAX_IMAGE_SIZE,
  MAX_MODEL_SIZE,
  verifyUploadSession,
  type UploadKind,
} from "@/lib/blob-uploads";
import { consumeRateLimit } from "@/lib/jobs";
import { isRecord, isSameOrigin, MeshyApiError } from "@/lib/meshy";
import { readStudioSession } from "@/lib/session";

type ClientPayload = {
  authorization: string;
  kind: UploadKind;
};

function parseClientPayload(value: string | null): ClientPayload | null {
  if (!value) return null;
  try {
    const payload: unknown = JSON.parse(value);
    if (
      !isRecord(payload) ||
      typeof payload.authorization !== "string" ||
      (payload.kind !== "image" && payload.kind !== "model")
    ) {
      return null;
    }
    return payload as ClientPayload;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid Blob upload request." }, { status: 400 });
  }

  if (body.type === "blob.generate-client-token" && !isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  try {
    const result = await handleUpload({
      request,
      body,
      token: getBlobReadWriteToken(),
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const studio = readStudioSession(request);
        if (studio.isNew) {
          throw new MeshyApiError("Upload authorization requires a studio session.", 401);
        }
        const payload = parseClientPayload(clientPayload);
        const session = payload
          ? verifyUploadSession(studio.userId, payload.authorization)
          : null;
        if (!payload || !session) {
          throw new MeshyApiError("Upload authorization is invalid or expired.", 403);
        }
        if (
          session.kind !== payload.kind ||
          !session.pathnames.includes(pathname) ||
          !isAllowedUploadPath(pathname, payload.kind, session.sid)
        ) {
          throw new MeshyApiError(
            `Uploads must use the ${getUploadPrefix(payload.kind, session.sid)} prefix.`,
            403,
          );
        }

        const rateLimit = await consumeRateLimit({
          userId: studio.userId,
          action: `blob-token:${session.sid}`,
          limit: 8,
          windowMs: 10 * 60 * 1000,
        });
        if (!rateLimit.allowed) {
          throw new MeshyApiError(
            "This upload session has reached its file limit.",
            429,
            rateLimit.retryAfterSeconds,
          );
        }

        return {
          allowedContentTypes:
            payload.kind === "image"
              ? ["image/jpeg", "image/png", "image/webp"]
              : ["model/gltf-binary", "application/octet-stream"],
          maximumSizeInBytes:
            payload.kind === "image" ? MAX_IMAGE_SIZE : MAX_MODEL_SIZE,
          validUntil: Math.min(session.exp, Date.now() + 5 * 60 * 1000),
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          ttlDays: 1,
          tokenPayload: JSON.stringify({
            sid: session.sid,
            kind: payload.kind,
          }),
        };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Blob upload authorization failed.", error);
    const status = error instanceof MeshyApiError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to authorize this upload." },
      {
        status,
        headers:
          error instanceof MeshyApiError && error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : undefined,
      },
    );
  }
}
