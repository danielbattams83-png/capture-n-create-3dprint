import { NextResponse } from "next/server";
import { syncJobFromMeshy } from "@/lib/jobs";
import { isRecord, isSameOrigin, MeshyApiError, readTaskToken } from "@/lib/meshy";
import { getTextToImageTask } from "@/lib/meshyService";
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
      NextResponse.json({ error: "Send the image task credentials as JSON." }, { status: 400 }),
      session,
    );
  }
  if (
    !isRecord(body) ||
    typeof body.task_id !== "string" ||
    !body.task_id.trim() ||
    body.task_id.length > 256 ||
    typeof body.task_token !== "string"
  ) {
    return withStudioSession(
      NextResponse.json({ error: "A valid task_id and task_token are required." }, { status: 400 }),
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
    const task = await getTextToImageTask(taskId);
    await syncJobFromMeshy({
      meshyTaskId: task.id,
      status:
        task.status === "SUCCEEDED"
          ? "succeeded"
          : task.status === "FAILED" || task.status === "CANCELED"
            ? "failed"
            : "processing",
      progress: task.progress,
      outputUrls: task.imageUrls.length > 0 ? { images: task.imageUrls } : null,
      error: task.error ?? null,
    });
    const response = NextResponse.json({
      task_id: task.id,
      status: task.status,
      progress: task.progress,
      image_urls: task.imageUrls,
      error: task.error,
    });
    response.headers.set("Cache-Control", "no-store");
    return withStudioSession(response, session);
  } catch (error) {
    if (error instanceof MeshyApiError) {
      return withStudioSession(
        NextResponse.json({ error: error.message }, { status: error.status }),
        session,
      );
    }
    console.error("Text-to-image polling failed.", error);
    return withStudioSession(
      NextResponse.json({ error: "Unable to check image generation." }, { status: 500 }),
      session,
    );
  }
}
