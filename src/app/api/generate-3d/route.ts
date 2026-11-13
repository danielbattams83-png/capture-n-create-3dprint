import { NextResponse } from "next/server";
import {
  createTaskToken,
  fetchMeshy,
  isRecord,
  isSameOrigin,
  MeshyApiError,
} from "@/lib/meshy";

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const MAX_IMAGE_COUNT = 4;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function matchesImageSignature(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }

  return (
    mimeType === "image/webp" &&
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  );
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the image as multipart form data." }, { status: 400 });
  }

  const images = formData.getAll("images");
  if (images.length < 1 || images.some((image) => !(image instanceof File))) {
    return NextResponse.json(
      { error: "Upload one to four image files using the images field." },
      { status: 400 },
    );
  }
  if (images.length > MAX_IMAGE_COUNT) {
    return NextResponse.json(
      { error: "Upload no more than four images of the same object." },
      { status: 400 },
    );
  }

  const imageDataUris: string[] = [];
  for (const image of images) {
    if (!(image instanceof File)) continue;
    if (!allowedMimeTypes.has(image.type)) {
      return NextResponse.json(
        { error: "Use JPG, PNG, or WebP images." },
        { status: 415 },
      );
    }
    if (image.size === 0 || image.size > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: "Each image must be smaller than 20 MB and cannot be empty." },
        { status: 413 },
      );
    }

    let imageBytes: Buffer;
    try {
      imageBytes = Buffer.from(await image.arrayBuffer());
    } catch {
      return NextResponse.json(
        { error: "An uploaded image could not be read." },
        { status: 400 },
      );
    }
    if (!matchesImageSignature(imageBytes, image.type)) {
      return NextResponse.json(
        { error: "An image's contents do not match its selected file type." },
        { status: 400 },
      );
    }

    imageDataUris.push(`data:${image.type};base64,${imageBytes.toString("base64")}`);
  }

  try {
    const taskType = images.length === 1 ? "image-to-3d" : "multi-image-to-3d";
    const body =
      taskType === "image-to-3d"
        ? { image_url: imageDataUris[0], target_formats: ["glb", "stl"] }
        : { image_urls: imageDataUris, target_formats: ["glb", "stl"] };
    const result = await fetchMeshy(`/${taskType}`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!isRecord(result) || typeof result.result !== "string" || !result.result) {
      return NextResponse.json(
        { error: "Meshy returned a task response without an ID." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        task_id: result.result,
        task_type: taskType,
        task_token: createTaskToken(result.result, taskType),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof MeshyApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Meshy task creation failed.", error);
    return NextResponse.json({ error: "Unable to create the 3D model task." }, { status: 500 });
  }
}
