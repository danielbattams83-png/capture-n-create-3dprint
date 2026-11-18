import { NextResponse } from "next/server";
import {
  isRecord,
  isSameOrigin,
  MeshyApiError,
  readTaskToken,
} from "@/lib/meshy";
import { getRetextureTask } from "@/lib/meshyService";
import { deleteTemporaryBlobs } from "@/lib/blob-uploads";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Send the texture task credentials as JSON." },
      { status: 400 },
    );
  }

  if (
    !isRecord(body) ||
    typeof body.task_id !== "string" ||
    !body.task_id.trim() ||
    body.task_id.length > 256 ||
    typeof body.task_token !== "string"
  ) {
    return NextResponse.json(
      { error: "A valid task_id and task_token are required." },
      { status: 400 },
    );
  }
  const taskId = body.task_id.trim();
  const token = readTaskToken(taskId, "retexture", body.task_token);
  if (!token) {
    return NextResponse.json({ error: "Invalid task token." }, { status: 403 });
  }

  try {
    const task = await getRetextureTask(taskId);
    if (
      task.status === "SUCCEEDED" ||
      task.status === "FAILED" ||
      task.status === "CANCELED"
    ) {
      await deleteTemporaryBlobs(token.blobUrls);
    }
    return NextResponse.json({
      task_id: task.id,
      status: task.status,
      progress: task.progress,
      error: task.error,
    });
  } catch (error) {
    if (error instanceof MeshyApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Texture task polling failed.", error);
    return NextResponse.json(
      { error: "Unable to check texture generation." },
      { status: 500 },
    );
  }
}
