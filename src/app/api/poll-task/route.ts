import { NextResponse } from "next/server";
import {
  fetchMeshy,
  getErrorMessage,
  isRecord,
  isSameOrigin,
  MeshyApiError,
  verifyTaskToken,
} from "@/lib/meshy";

const taskStatuses = new Set(["PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED"]);

function getSecureModelUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body containing task_id." }, { status: 400 });
  }

  if (
    !isRecord(body) ||
    typeof body.task_id !== "string" ||
    !body.task_id.trim() ||
    (body.task_type !== "image-to-3d" && body.task_type !== "multi-image-to-3d") ||
    typeof body.task_token !== "string"
  ) {
    return NextResponse.json(
      { error: "A task_id, task_type, and task_token are required." },
      { status: 400 },
    );
  }
  if (body.task_id.length > 256) {
    return NextResponse.json({ error: "The task_id is too long." }, { status: 400 });
  }
  if (!verifyTaskToken(body.task_id.trim(), body.task_type, body.task_token)) {
    return NextResponse.json({ error: "Invalid task token." }, { status: 403 });
  }

  try {
    const task = await fetchMeshy(
      `/${body.task_type}/${encodeURIComponent(body.task_id.trim())}`,
      { method: "GET" },
    );

    if (!isRecord(task) || typeof task.status !== "string" || !taskStatuses.has(task.status)) {
      return NextResponse.json(
        { error: "Meshy returned an invalid task status." },
        { status: 502 },
      );
    }

    const progress =
      typeof task.progress === "number" && Number.isFinite(task.progress)
        ? Math.min(100, Math.max(0, task.progress))
        : 0;

    if (task.status === "FAILED" || task.status === "CANCELED") {
      const taskError = getErrorMessage(task.task_error);
      return NextResponse.json({
        task_id: body.task_id,
        status: task.status,
        progress,
        error:
          taskError ??
          (task.status === "FAILED"
            ? "Meshy could not generate a model from this image."
            : "The Meshy generation task was canceled."),
      });
    }

    if (task.status === "SUCCEEDED") {
      const modelUrls = isRecord(task.model_urls) ? task.model_urls : {};
      const glb = getSecureModelUrl(modelUrls.glb);
      const stl = getSecureModelUrl(modelUrls.stl);
      if (!glb && !stl) {
        return NextResponse.json(
          { error: "Meshy completed the task without a GLB or STL download URL." },
          { status: 502 },
        );
      }

      return NextResponse.json({
        task_id: body.task_id,
        status: task.status,
        progress,
        model_urls: { glb, stl },
      });
    }

    return NextResponse.json({
      task_id: body.task_id,
      status: task.status,
      progress,
    });
  } catch (error) {
    if (error instanceof MeshyApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Meshy task polling failed.", error);
    return NextResponse.json({ error: "Unable to check the model task." }, { status: 500 });
  }
}
