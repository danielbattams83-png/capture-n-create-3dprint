import { NextResponse } from "next/server";
import {
  fetchMeshy,
  isRecord,
  isSameOrigin,
  MeshyApiError,
  verifyTaskToken,
} from "@/lib/meshy";
import type { MeshyTaskType } from "@/lib/meshy";

const MESHY_MODEL_TIMEOUT_MS = 120_000;

function isMeshyTaskType(value: unknown): value is MeshyTaskType {
  return value === "image-to-3d" || value === "multi-image-to-3d";
}

function getModelUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
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
    return NextResponse.json({ error: "Send a JSON body containing the task credentials." }, { status: 400 });
  }

  if (
    !isRecord(body) ||
    typeof body.task_id !== "string" ||
    !body.task_id.trim() ||
    !isMeshyTaskType(body.task_type) ||
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
  try {
    if (!verifyTaskToken(body.task_id.trim(), body.task_type, body.task_token)) {
      return NextResponse.json({ error: "Invalid task token." }, { status: 403 });
    }

    const task = await fetchMeshy(
      `/${body.task_type}/${encodeURIComponent(body.task_id.trim())}`,
      { method: "GET" },
    );

    if (!isRecord(task) || task.status !== "SUCCEEDED" || !isRecord(task.model_urls)) {
      return NextResponse.json(
        { error: "The model is not ready for preview yet." },
        { status: 409 },
      );
    }

    const modelUrl = getModelUrl(task.model_urls.glb);
    if (!modelUrl) {
      return NextResponse.json(
        { error: "Meshy did not return a valid GLB preview URL." },
        { status: 502 },
      );
    }

    let modelResponse: Response;
    try {
      modelResponse = await fetch(modelUrl, {
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(MESHY_MODEL_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return NextResponse.json(
          { error: "The 3D model download timed out. Try loading the preview again." },
          { status: 504 },
        );
      }

      return NextResponse.json(
        { error: "The 3D model could not be downloaded from Meshy. Try loading the preview again." },
        { status: 502 },
      );
    }

    if (!modelResponse.ok || !modelResponse.body) {
      return NextResponse.json(
        { error: `Meshy model download failed (HTTP ${modelResponse.status}).` },
        { status: 502 },
      );
    }

    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'inline; filename="model.glb"',
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

    console.error("Meshy model preview request failed.", error);
    return NextResponse.json(
      { error: "The 3D model preview could not be loaded." },
      { status: 500 },
    );
  }
}
