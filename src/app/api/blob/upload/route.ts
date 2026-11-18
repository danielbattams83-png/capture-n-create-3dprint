import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import {
  checkRateLimit,
  getBlobReadWriteToken,
  getUploadPrefix,
  isAllowedUploadPath,
  MAX_IMAGE_SIZE,
  MAX_MODEL_SIZE,
  verifyUploadSession,
  type UploadKind,
} from "@/lib/blob-uploads";
import { isRecord, isSameOrigin } from "@/lib/meshy";

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
        const payload = parseClientPayload(clientPayload);
        const session = payload
          ? verifyUploadSession(request, payload.authorization)
          : null;
        if (!payload || !session) {
          throw new Error("Upload authorization is invalid or expired.");
        }
        if (
          session.kind !== payload.kind ||
          !session.pathnames.includes(pathname) ||
          !isAllowedUploadPath(pathname, payload.kind, session.sid)
        ) {
          throw new Error(
            `Uploads must use the ${getUploadPrefix(payload.kind, session.sid)} prefix.`,
          );
        }

        const rateLimit = checkRateLimit(`blob-token:${session.sid}`, 8, 10 * 60 * 1000);
        if (!rateLimit.allowed) {
          throw new Error("This upload session has reached its file limit.");
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to authorize this upload." },
      { status: 400 },
    );
  }
}
