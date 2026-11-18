import { NextResponse } from "next/server";
import { createUploadSession } from "@/lib/blob-uploads";
import { consumeRateLimit } from "@/lib/jobs";
import { isRecord, isSameOrigin, MeshyApiError } from "@/lib/meshy";
import { readStudioSession, withStudioSession } from "@/lib/session";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  const session = readStudioSession(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withStudioSession(
      NextResponse.json({ error: "Send the upload file metadata as JSON." }, { status: 400 }),
      session,
    );
  }
  if (
    !isRecord(body) ||
    (body.kind !== "image" && body.kind !== "model") ||
    !Array.isArray(body.files) ||
    body.files.some(
      (file) =>
        !isRecord(file) ||
        typeof file.contentType !== "string" ||
        typeof file.size !== "number",
    )
  ) {
    return withStudioSession(
      NextResponse.json({ error: "Invalid upload file metadata." }, { status: 400 }),
      session,
    );
  }

  try {
    const rateLimit = await consumeRateLimit({
      userId: session.userId,
      action: "upload-session",
      limit: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (!rateLimit.allowed) {
      return withStudioSession(
        NextResponse.json(
          { error: "Too many upload sessions. Please try again later." },
          {
            status: 429,
            headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
          },
        ),
        session,
      );
    }

    return withStudioSession(
      NextResponse.json(
        createUploadSession(
          session.userId,
          body.kind,
          body.files as { contentType: string; size: number }[],
        ),
        { headers: { "Cache-Control": "private, no-store" } },
      ),
      session,
    );
  } catch (error) {
    if (error instanceof MeshyApiError) {
      return withStudioSession(
        NextResponse.json(
          { error: error.message },
          {
            status: error.status,
            headers: error.retryAfterSeconds
              ? { "Retry-After": String(error.retryAfterSeconds) }
              : undefined,
          },
        ),
        session,
      );
    }
    console.error("Upload session creation failed.", error);
    return withStudioSession(
      NextResponse.json({ error: "Unable to authorize an upload." }, { status: 500 }),
      session,
    );
  }
}
