import "server-only";

import {
  fetchMeshy,
  getErrorMessage,
  isRecord,
  MeshyApiError,
} from "@/lib/meshy";

const MAX_PROMPT_LENGTH = 800;

export const TEXTURE_STYLE_PRESETS = {
  realistic: "photorealistic PBR material with physically accurate surface detail",
  stylized: "clean stylized material with bold color separation and soft painted detail",
  hand_painted: "hand-painted game art texture with visible brushwork and gentle shading",
  weathered: "weathered aged material with subtle wear, scratches, and natural variation",
  minimal: "minimal modern material with restrained colors and a clean matte finish",
} as const;

export type TextureStylePreset = keyof typeof TEXTURE_STYLE_PRESETS;
export type RetextureTaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED";

export type RetextureTask = {
  id: string;
  status: RetextureTaskStatus;
  progress: number;
  modelUrl?: string;
  error?: string;
};

function isTextureStylePreset(value: string): value is TextureStylePreset {
  return value in TEXTURE_STYLE_PRESETS;
}

function getSecureUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export async function submitRetextureTask(input: {
  modelUrl?: string;
  inputTaskId?: string;
  prompt?: string;
  stylePreset?: string;
  imageUrls?: string[];
}): Promise<string> {
  if (
    (!input.inputTaskId && !getSecureUrl(input.modelUrl)) ||
    (input.inputTaskId && input.modelUrl)
  ) {
    throw new MeshyApiError(
      "Texture generation requires either a completed Meshy task or one uploaded GLB.",
      400,
    );
  }

  const requestedImageUrls = input.imageUrls ?? [];
  const imageUrls = requestedImageUrls
    .map((url) => getSecureUrl(url))
    .filter((url): url is string => Boolean(url));
  const usingPhotos = requestedImageUrls.length > 0;
  if (usingPhotos && (imageUrls.length !== requestedImageUrls.length || imageUrls.length > 4)) {
    throw new MeshyApiError("Provide one to four valid source photo URLs.", 400);
  }
  if (usingPhotos && (input.prompt?.trim() || input.stylePreset)) {
    throw new MeshyApiError("Choose either a texture description or source photos.", 400);
  }

  let styleFields: Record<string, unknown>;
  if (usingPhotos) {
    styleFields = {
      multiview_image_urls: imageUrls,
      ai_model: "meshy-7",
      enable_pbr: true,
      texture_resolution: "2k",
    };
  } else {
    const prompt = input.prompt?.trim() ?? "";
    if (!prompt) {
      throw new MeshyApiError("Describe the texture you want to generate.", 400);
    }
    if (!input.stylePreset || !isTextureStylePreset(input.stylePreset)) {
      throw new MeshyApiError("Choose a valid texture style preset.", 400);
    }

    const textStylePrompt = `${prompt}. ${TEXTURE_STYLE_PRESETS[input.stylePreset]}`;
    if (textStylePrompt.length > MAX_PROMPT_LENGTH) {
      throw new MeshyApiError("The texture description is too long.", 400);
    }
    styleFields = {
      text_style_prompt: textStylePrompt,
      ai_model: "latest",
      enable_pbr: true,
      texture_resolution: "2k",
    };
  }

  const response = await fetchMeshy("/retexture", {
    method: "POST",
    body: JSON.stringify({
      ...(input.inputTaskId
        ? { input_task_id: input.inputTaskId }
        : { model_url: input.modelUrl }),
      ...styleFields,
      enable_original_uv: true,
      target_formats: ["glb"],
    }),
  });

  if (!isRecord(response) || typeof response.result !== "string" || !response.result) {
    throw new MeshyApiError(
      "The texture service returned a task response without an ID.",
      502,
    );
  }
  return response.result;
}

export async function getRetextureTask(taskId: string): Promise<RetextureTask> {
  const response = await fetchMeshy(
    `/retexture/${encodeURIComponent(taskId)}`,
    { method: "GET" },
  );
  if (!isRecord(response) || typeof response.status !== "string") {
    throw new MeshyApiError("The texture service returned an invalid task.", 502);
  }

  const statuses = new Set<RetextureTaskStatus>([
    "PENDING",
    "IN_PROGRESS",
    "SUCCEEDED",
    "FAILED",
    "CANCELED",
  ]);
  if (!statuses.has(response.status as RetextureTaskStatus)) {
    throw new MeshyApiError("The texture service returned an unknown task status.", 502);
  }

  const status = response.status as RetextureTaskStatus;
  const progress =
    typeof response.progress === "number" && Number.isFinite(response.progress)
      ? Math.min(100, Math.max(0, response.progress))
      : 0;
  const modelUrls = isRecord(response.model_urls) ? response.model_urls : {};
  const modelUrl = getSecureUrl(modelUrls.glb);
  const taskError = getErrorMessage(response.task_error);

  if (status === "SUCCEEDED" && !modelUrl) {
    throw new MeshyApiError(
      "Texture generation completed without a downloadable GLB.",
      502,
    );
  }

  return {
    id: taskId,
    status,
    progress,
    modelUrl,
    error:
      taskError ??
      (status === "FAILED"
        ? "The texture could not be generated."
        : status === "CANCELED"
          ? "Texture generation was canceled."
          : undefined),
  };
}
