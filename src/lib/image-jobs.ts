import "server-only";

import { NextResponse } from "next/server";
import { createIdempotencyKey, readIdempotencyNonce } from "@/lib/idempotency";
import { beginGenerationJob, toPublicJob, type JobRecord } from "@/lib/jobs";
import { isRecord, isSameOrigin, MeshyApiError } from "@/lib/meshy";
import {
  submitTextToImageTask,
  TEXT_TO_IMAGE_MODELS,
  TEXT_TO_IMAGE_RATIOS,
  type TextToImageModel,
  type TextToImageRatio,
} from "@/lib/meshyService";
import { readStudioSession, withStudioSession } from "@/lib/session";

function isModel(value: unknown): value is TextToImageModel {
  return typeof value === "string" && TEXT_TO_IMAGE_MODELS.some((model) => model === value);
}

function isRatio(value: unknown): value is TextToImageRatio {
  return typeof value === "string" && TEXT_TO_IMAGE_RATIOS.some((ratio) => ratio === value);
}

function imageUrls(job: JobRecord): string[] {
  return job.outputUrls?.images ?? [];
}

export function textToImageResponse(job: JobRecord, reused: boolean) {
  const pub = toPublicJob(job);
  return {
    job_id: pub.id,
    resumed: reused,
    task_id: pub.meshyTaskId,
    task_token: pub.taskToken,
    status: pub.status,
    progress: pub.progress,
    image_urls: imageUrls(job),
    parameters: pub.parameters,
    error: pub.error,
  };
}

export async function submitTextToImage(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the image prompt as JSON." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: "Describe the image you want to generate." }, { status: 400 });
  }

  let nonce = "";
  try {
    nonce = readIdempotencyNonce(body.idempotency_nonce);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The idempotency nonce is invalid." },
      { status: 400 },
    );
  }

  const aiModel: TextToImageModel = isModel(body.ai_model) ? body.ai_model : "nano-banana";
  const generateMultiView = body.generate_multi_view === true;
  const aspectRatio: TextToImageRatio = isRatio(body.aspect_ratio) ? body.aspect_ratio : "1:1";
  const removeBackground = body.remove_background !== false;
  const prompt = body.prompt.trim();
  const session = readStudioSession(request);

  try {
    const idempotencyKey = createIdempotencyKey({
      type: "image",
      prompt,
      aiModel,
      aspectRatio: generateMultiView ? null : aspectRatio,
      removeBackground,
      generateMultiView,
      nonce,
    });
    const { job, reused } = await beginGenerationJob({
      userId: session.userId,
      idempotencyKey,
      type: "image",
      inputUrls: [],
      parameters: {
        prompt,
        aiModel,
        aspectRatio: generateMultiView ? null : aspectRatio,
        removeBackground,
        generateMultiView,
        nonce,
      },
      submit: async () => ({
        meshyTaskId: await submitTextToImageTask({
          prompt,
          aiModel,
          aspectRatio,
          removeBackground,
          generateMultiView,
        }),
        meshyTaskType: "text-to-image",
      }),
    });
    const response = NextResponse.json(textToImageResponse(job, reused), {
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
    console.error("Text-to-image task creation failed.", error);
    return withStudioSession(
      NextResponse.json({ error: "Unable to start image generation." }, { status: 500 }),
      session,
    );
  }
}
