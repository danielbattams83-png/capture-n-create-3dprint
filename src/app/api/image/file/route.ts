import { NextResponse } from "next/server";
import { getOwnedJobByTask } from "@/lib/jobs";
import { isRecord, isSameOrigin, MeshyApiError, readTaskToken } from "@/lib/meshy";
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
      NextResponse.json({ error: "Send the image address as JSON." }, { status: 400 }),
      session,
    );
  }
  if (
    !isRecord(body) ||
    typeof body.task_id !== "string" ||
    typeof body.task_token !== "string" ||
    typeof body.url !== "string"
  ) {
    return withStudioSession(
      NextResponse.json({ error: "The image request is invalid." }, { status: 400 }),
      session,
    );
  }
  const taskId = body.task_id.trim();
  if (!readTaskToken(taskId, "text-to-image", body.task_token)) {
    return withStudioSession(
      NextResponse.json({ error: "Invalid task token." }, { status: 403 }),
      session,
    );
  }

  try {
    const job = await getOwnedJobByTask(session.userId, taskId);
    const allowed = job?.outputUrls?.images ?? [];
    if (!job || job.type !== "image" || !allowed.includes(body.url)) {
      return withStudioSession(
        NextResponse.json({ error: "That image is not part of this session." }, { status: 403 }),
        session,
      );
    }
    const upstream = await fetch(body.url, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      throw new MeshyApiError("The generated image could not be downloaded.", 502);
    }
    const response = new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "image/png",
        "Cache-Control": "private, no-store",
      },
    });
    return withStudioSession(response, session);
  } catch (error) {
    if (error instanceof MeshyApiError) {
      return withStudioSession(
        NextResponse.json({ error: error.message }, { status: error.status }),
        session,
      );
    }
    console.error("Generated image download failed.", error);
    return withStudioSession(
      NextResponse.json({ error: "Unable to download the generated image." }, { status: 500 }),
      session,
    );
  }
}
