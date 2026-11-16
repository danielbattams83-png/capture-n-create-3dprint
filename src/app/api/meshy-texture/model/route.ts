import { NextResponse } from "next/server";
import {
  isRecord,
  isSameOrigin,
  MeshyApiError,
  verifyTaskToken,
} from "@/lib/meshy";
import { getRetextureTask } from "@/lib/meshyService";

const MODEL_DOWNLOAD_TIMEOUT_MS = 120_000;

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
  if (!verifyTaskToken(taskId, "retexture", body.task_token)) {
    return NextResponse.json({ error: "Invalid task token." }, { status: 403 });
  }

  try {
    const task = await getRetextureTask(taskId);
    if (task.status !== "SUCCEEDED" || !task.modelUrl) {
      return NextResponse.json(
        { error: "The textured model is not ready yet." },
        { status: 409 },
      );
    }

    let modelResponse: Response;
    try {
      modelResponse = await fetch(task.modelUrl, {
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(MODEL_DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return NextResponse.json(
          { error: "The textured model download timed out." },
          { status: 504 },
        );
      }
      return NextResponse.json(
        { error: "The textured model could not be downloaded." },
        { status: 502 },
      );
    }
    if (!modelResponse.ok || !modelResponse.body) {
      return NextResponse.json(
        { error: `Textured model download failed (HTTP ${modelResponse.status}).` },
        { status: 502 },
      );
    }

    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'inline; filename="textured-model.glb"',
      "Content-Type": "model/gltf-binary",
      "X-Content-Type-Options": "nosniff",
    });
    const contentLength = modelResponse.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(modelResponse.body, { headers });
  } catch (error) {
    if (error instanceof MeshyApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Textured model proxy failed.", error);
    return NextResponse.json(
      { error: "The textured model could not be loaded." },
      { status: 500 },
    );
  }
}
