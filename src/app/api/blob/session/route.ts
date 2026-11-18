import { NextResponse } from "next/server";
import {
  checkRateLimit,
  createUploadSession,
} from "@/lib/blob-uploads";
import { isRecord, isSameOrigin, MeshyApiError } from "@/lib/meshy";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the upload file metadata as JSON." }, { status: 400 });
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
    return NextResponse.json({ error: "Invalid upload file metadata." }, { status: 400 });
  }

  const address =
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local";
  const rateLimit = checkRateLimit(`upload-session:${address}`, 20, 60 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many upload sessions. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  try {
    return NextResponse.json(
      createUploadSession(
        request,
        body.kind,
        body.files as { contentType: string; size: number }[],
      ),
      {
      headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    if (error instanceof MeshyApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Upload session creation failed.", error);
    return NextResponse.json({ error: "Unable to authorize an upload." }, { status: 500 });
  }
}
