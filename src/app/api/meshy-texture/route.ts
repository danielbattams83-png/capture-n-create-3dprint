import { NextResponse } from "next/server";
import { validateUploadedBlobs } from "@/lib/blob-uploads";
import { createIdempotencyKey, readIdempotencyNonce } from "@/lib/idempotency";
import { beginGenerationJob, toPublicJob } from "@/lib/jobs";
import {
  isRecord,
  isSameOrigin,
  MeshyApiError,
  readTaskToken,
} from "@/lib/meshy";
import { submitRetextureTask } from "@/lib/meshyService";
import { readStudioSession, withStudioSession } from "@/lib/session";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Send JSON containing the uploaded GLB URL and texture settings." },
      { status: 400 },
    );
  }

  if (!isRecord(body)) {
    return NextResponse.json(
      { error: "A model source and either a texture prompt or source photos are required." },
      { status: 400 },
    );
  }

  const hasTextStyle =
    typeof body.prompt === "string" || typeof body.style_preset === "string";
  const hasPhotoStyle =
    Array.isArray(body.image_urls) ||
    typeof body.image_upload_authorization === "string";
  if (hasTextStyle === hasPhotoStyle) {
    return NextResponse.json(
      { error: "Choose either a texture description or source photos." },
      { status: 400 },
    );
  }
  if (
    hasTextStyle &&
    (typeof body.prompt !== "string" || typeof body.style_preset !== "string")
  ) {
    return NextResponse.json(
      { error: "A texture prompt and style preset are required." },
      { status: 400 },
    );
  }
  if (
    hasPhotoStyle &&
    (!Array.isArray(body.image_urls) ||
      body.image_urls.length < 1 ||
      body.image_urls.length > 4 ||
      body.image_urls.some((url) => typeof url !== "string") ||
      typeof body.image_upload_authorization !== "string")
  ) {
    return NextResponse.json(
      { error: "Provide one to four uploaded source photos." },
      { status: 400 },
    );
  }

  const hasTaskSource =
    typeof body.input_task_id === "string" &&
    (body.input_task_type === "image-to-3d" ||
      body.input_task_type === "multi-image-to-3d") &&
    typeof body.source_task_token === "string";
  const hasBlobSource =
    typeof body.model_url === "string" &&
    typeof body.upload_authorization === "string";
  if (hasTaskSource === hasBlobSource) {
    return NextResponse.json(
      { error: "Provide either completed Meshy task credentials or one uploaded GLB." },
      { status: 400 },
    );
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

  const session = readStudioSession(request);
  const temporaryUrls: string[] = [];
  try {
    let inputTaskId: string | undefined;
    let modelUrl: string | undefined;

    if (hasTaskSource) {
      inputTaskId = body.input_task_id as string;
      const taskType = body.input_task_type as "image-to-3d" | "multi-image-to-3d";
      if (!readTaskToken(inputTaskId, taskType, body.source_task_token as string)) {
        throw new MeshyApiError("The source task credentials are invalid or expired.", 403);
      }
    } else {
      const modelUrls = await validateUploadedBlobs({
        userId: session.userId,
        authorization: body.upload_authorization as string,
        urls: [body.model_url as string],
        kind: "model",
      });
      temporaryUrls.push(...modelUrls);
      modelUrl = modelUrls[0];
    }

    let imageUrls: string[] | undefined;
    if (hasPhotoStyle) {
      imageUrls = await validateUploadedBlobs({
        userId: session.userId,
        authorization: body.image_upload_authorization as string,
        urls: body.image_urls as string[],
        kind: "image",
      });
      temporaryUrls.push(...imageUrls);
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const stylePreset = typeof body.style_preset === "string" ? body.style_preset : "";
    const idempotencyKey = createIdempotencyKey({
      type: "texture",
      source: inputTaskId ?? modelUrl ?? "",
      prompt,
      stylePreset,
      imageUrls: imageUrls ?? [],
      nonce,
    });
    const { job, reused } = await beginGenerationJob({
      userId: session.userId,
      idempotencyKey,
      type: "texture",
      inputUrls: temporaryUrls,
      parameters: {
        prompt,
        stylePreset,
        inputTaskId: inputTaskId ?? null,
        modelUrl: modelUrl ?? null,
        nonce,
      },
      submit: async () => {
        const taskId = await submitRetextureTask({
          inputTaskId,
          modelUrl,
          prompt: prompt || undefined,
          stylePreset: stylePreset || undefined,
          imageUrls,
        });
        return { meshyTaskId: taskId, meshyTaskType: "retexture" as const };
      },
    });
    const pub = toPublicJob(job);
    const response = NextResponse.json(
      {
        job_id: pub.id,
        resumed: reused,
        task_id: pub.meshyTaskId,
        task_token: pub.taskToken,
        status: pub.status,
        progress: pub.progress,
        error: pub.error,
      },
      { status: reused ? 200 : 201 },
    );
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

    console.error("Texture task creation failed.", error);
    return withStudioSession(
      NextResponse.json({ error: "Unable to start texture generation." }, { status: 500 }),
      session,
    );
  }
}
