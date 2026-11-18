import { NextResponse } from "next/server";
import {
  createTaskToken,
  isRecord,
  isSameOrigin,
  MeshyApiError,
  readTaskToken,
} from "@/lib/meshy";
import { submitRetextureTask } from "@/lib/meshyService";
import {
  checkRateLimit,
  deleteTemporaryBlobs,
  validateUploadedBlobs,
} from "@/lib/blob-uploads";

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

  let temporaryUrls: string[] = [];
  try {
    let inputTaskId: string | undefined;
    let modelUrl: string | undefined;
    let rateLimitKey: string;
    let rateLimitCount: number;

    if (hasTaskSource) {
      inputTaskId = body.input_task_id as string;
      const taskType = body.input_task_type as
        | "image-to-3d"
        | "multi-image-to-3d";
      if (
        !readTaskToken(
          inputTaskId,
          taskType,
          body.source_task_token as string,
        )
      ) {
        throw new MeshyApiError("The source task credentials are invalid or expired.", 403);
      }
      rateLimitKey = `meshy-texture-task:${body.source_task_token as string}`;
      rateLimitCount = 3;
    } else {
      const modelUrls = await validateUploadedBlobs({
        request,
        authorization: body.upload_authorization as string,
        urls: [body.model_url as string],
        kind: "model",
      });
      temporaryUrls.push(...modelUrls);
      modelUrl = modelUrls[0];
      rateLimitKey = `meshy-texture-upload:${body.upload_authorization as string}`;
      rateLimitCount = 1;
    }

    let imageUrls: string[] | undefined;
    if (hasPhotoStyle) {
      imageUrls = await validateUploadedBlobs({
        request,
        authorization: body.image_upload_authorization as string,
        urls: body.image_urls as string[],
        kind: "image",
      });
      temporaryUrls.push(...imageUrls);
    }

    if (!checkRateLimit(rateLimitKey, rateLimitCount, 10 * 60 * 1000).allowed) {
      throw new MeshyApiError("Too many texture requests for this model. Try again shortly.", 429);
    }
    const taskId = await submitRetextureTask({
      inputTaskId,
      modelUrl,
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      stylePreset: typeof body.style_preset === "string" ? body.style_preset : undefined,
      imageUrls,
    });
    return NextResponse.json(
      {
        task_id: taskId,
        task_token: createTaskToken(taskId, "retexture", temporaryUrls),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof MeshyApiError) {
      if (error.status < 500) await deleteTemporaryBlobs(temporaryUrls);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Texture task creation failed.", error);
    return NextResponse.json(
      { error: "Unable to start texture generation." },
      { status: 500 },
    );
  }
}
