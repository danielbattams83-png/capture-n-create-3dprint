import { NextResponse } from "next/server";
import {
  createTaskToken,
  isSameOrigin,
  MeshyApiError,
} from "@/lib/meshy";
import { submitRetextureTask } from "@/lib/meshyService";

const MAX_MODEL_SIZE = 100 * 1024 * 1024;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Send the GLB model and texture settings as multipart form data." },
      { status: 400 },
    );
  }

  const model = formData.get("model");
  const prompt = formData.get("prompt");
  const stylePreset = formData.get("style_preset");
  if (
    !(model instanceof File) ||
    typeof prompt !== "string" ||
    typeof stylePreset !== "string"
  ) {
    return NextResponse.json(
      { error: "A GLB model, prompt, and style preset are required." },
      { status: 400 },
    );
  }
  if (model.size === 0 || model.size > MAX_MODEL_SIZE) {
    return NextResponse.json(
      { error: "The model must be a non-empty GLB smaller than 100 MB." },
      { status: 413 },
    );
  }

  try {
    const modelBytes = Buffer.from(await model.arrayBuffer());
    const taskId = await submitRetextureTask({
      modelBytes,
      prompt,
      stylePreset,
    });
    return NextResponse.json(
      {
        task_id: taskId,
        task_token: createTaskToken(taskId, "retexture"),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof MeshyApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Texture task creation failed.", error);
    return NextResponse.json(
      { error: "Unable to start texture generation." },
      { status: 500 },
    );
  }
}
