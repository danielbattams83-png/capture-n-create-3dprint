import { NextResponse } from "next/server";
import {
  createTaskToken,
  fetchMeshy,
  isRecord,
  isSameOrigin,
  MeshyApiError,
} from "@/lib/meshy";
import {
  checkRateLimit,
  deleteTemporaryBlobs,
  validateUploadedBlobs,
} from "@/lib/blob-uploads";

export async function POST(request: Request) {
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

  let imageUrls: string[] = [];

  try {
    imageUrls = await validateUploadedBlobs({
      request,
      authorization: requestBody.upload_authorization,
      urls: requestBody.image_urls,
      kind: "image",
    });
    if (
      !checkRateLimit(
        `meshy-image-submit:${requestBody.upload_authorization}`,
        1,
        10 * 60 * 1000,
      ).allowed
    ) {
      throw new MeshyApiError("This upload has already been submitted.", 429);
    }
    const taskType = imageUrls.length === 1 ? "image-to-3d" : "multi-image-to-3d";
    const generationOptions = {
      ai_model: "meshy-7.1",
      should_texture: false,
      target_formats: ["glb", "stl"],
    };
    const meshyBody =
      taskType === "image-to-3d"
        ? { image_url: imageUrls[0], ...generationOptions }
        : { image_urls: imageUrls, ...generationOptions };
    const result = await fetchMeshy(`/${taskType}`, {
      method: "POST",
      body: JSON.stringify(meshyBody),
    });

    if (!isRecord(result) || typeof result.result !== "string" || !result.result) {
      await deleteTemporaryBlobs(imageUrls);
      return NextResponse.json(
        { error: "The image generation service returned a task response without an ID." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        task_id: result.result,
        task_type: taskType,
        task_token: createTaskToken(result.result, taskType, imageUrls),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof MeshyApiError) {
      if (error.status < 500) await deleteTemporaryBlobs(imageUrls);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Image generation task creation failed.", error);
    return NextResponse.json({ error: "Unable to create the 3D model task." }, { status: 500 });
  }
}
