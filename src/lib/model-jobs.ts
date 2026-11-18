import "server-only";

import { NextResponse } from "next/server";
import { validateUploadedBlobs } from "@/lib/blob-uploads";
import { createIdempotencyKey, readIdempotencyNonce } from "@/lib/idempotency";
import { beginGenerationJob, toPublicJob, type JobRecord } from "@/lib/jobs";
import {
  fetchMeshy,
  isRecord,
  isSameOrigin,
  MeshyApiError,
} from "@/lib/meshy";
import { readStudioSession, withStudioSession } from "@/lib/session";

function generationResponse(job: JobRecord, reused: boolean) {
  const pub = toPublicJob(job);
  return {
    job_id: pub.id,
    resumed: reused,
    task_id: pub.meshyTaskId,
    task_type: pub.meshyTaskType,
    task_token: pub.taskToken,
    status: pub.status,
    progress: pub.progress,
    model_urls: pub.outputUrls,
    error: pub.error,
  };
}

export async function submitModelGeneration(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Send JSON containing image_urls and upload_authorization." },
      { status: 400 },
    );
  }

  if (
    !isRecord(requestBody) ||
    !Array.isArray(requestBody.image_urls) ||
    requestBody.image_urls.some((url) => typeof url !== "string") ||
    typeof requestBody.upload_authorization !== "string"
  ) {
    return NextResponse.json(
      { error: "Provide one to four uploaded image URLs and their upload authorization." },
      { status: 400 },
    );
  }

  let nonce = "";
  try {
    nonce = readIdempotencyNonce(requestBody.idempotency_nonce);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The idempotency nonce is invalid." },
      { status: 400 },
    );
  }

  const session = readStudioSession(request);
  let imageUrls: string[] = [];

  try {
    imageUrls = await validateUploadedBlobs({
      userId: session.userId,
      authorization: requestBody.upload_authorization,
      urls: requestBody.image_urls,
      kind: "image",
    });
    const generationOptions = {
      ai_model: "meshy-7.1",
      should_texture: false,
      target_formats: ["glb", "stl"],
    };
    const idempotencyKey = createIdempotencyKey({
      type: "model",
      image_urls: imageUrls,
      ...generationOptions,
      nonce,
    });
    const taskType = imageUrls.length === 1 ? "image-to-3d" : "multi-image-to-3d";
    const { job, reused } = await beginGenerationJob({
      userId: session.userId,
      idempotencyKey,
      type: "model",
      inputUrls: imageUrls,
      parameters: { ...generationOptions, nonce },
      submit: async () => {
        const meshyBody =
          taskType === "image-to-3d"
            ? { image_url: imageUrls[0], ...generationOptions }
            : { image_urls: imageUrls, ...generationOptions };
        const result = await fetchMeshy(`/${taskType}`, {
          method: "POST",
          body: JSON.stringify(meshyBody),
        });
        if (!isRecord(result) || typeof result.result !== "string" || !result.result) {
          throw new MeshyApiError(
            "The image generation service returned a task response without an ID.",
            502,
          );
        }
        return { meshyTaskId: result.result, meshyTaskType: taskType };
      },
    });

    const response = NextResponse.json(generationResponse(job, reused), {
      status: reused ? 200 : 201,
    });
    response.headers.set("Cache-Control", "no-store");
    return withStudioSession(response, session);
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
    if (error instanceof Error && error.message === "DATABASE_URL is not configured.") {
      return NextResponse.json({ error: "Job storage is not configured." }, { status: 500 });
    }

    console.error("Image generation task creation failed.", error);
    return withStudioSession(
      NextResponse.json({ error: "Unable to create the 3D model task." }, { status: 500 }),
      session,
    );
  }
}
