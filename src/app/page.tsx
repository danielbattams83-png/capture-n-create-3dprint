"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Box, Check, LockKeyhole, Plus, Sparkles, UploadCloud, X } from "lucide-react";
import type { ModelExportAction } from "@/components/model-viewer";
import ScalingPreview from "@/components/scaling-preview";
import CameraCapture from "@/components/camera-capture";
import GenerationModal from "@/components/generation-modal";
import ImagePreprocessingModal from "@/components/image-preprocessing-modal";
import type { ProcessedImageReview } from "@/components/image-preprocessing-modal";
import TextureGenerator from "@/components/texture-generator";
import { isolateAndCropSubject } from "@/lib/image-preprocessing";
import { fetchKhronosAssets, type KhronosAsset } from "@/lib/khronos-assets";
import {
  createCreationId,
  getCreation,
  saveCreation,
  updateCreationDimensions,
  type StoredCreation,
} from "@/lib/creations-storage";

const ModelViewer = dynamic(() => import("@/components/model-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[360px] items-center justify-center rounded-2xl bg-[#0b0d10] font-mono text-xs font-medium text-[#9ca3af] sm:h-[420px]">
      Preparing 3D preview…
    </div>
  ),
});

type GenerationStatus = "idle" | "uploading" | "generating" | "ready" | "error";
type PrintDimension = "x" | "y" | "z";
type ModelUrls = { glb?: string; stl?: string };
type SelectedImage = { file: File; previewUrl: string };
type PreprocessingPhase = "processing" | "review" | "error" | null;
type PreviewTask = {
  taskId: string;
  taskType: "image-to-3d" | "multi-image-to-3d";
  taskToken: string;
  creationName: string;
  dimensions: { width: number; depth: number; height: number };
};

const stages: { id: Exclude<GenerationStatus, "idle" | "error">; label: string }[] = [
  { id: "uploading", label: "Uploading image" },
  { id: "generating", label: "Generating 3D model" },
  { id: "ready", label: "Ready to print" },
];

function getApiError(value: unknown): string | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const dimensionLabels: Record<PrintDimension, string> = {
  x: "Width",
  y: "Depth",
  z: "Height",
};

type StudioProps = {
  initialAssetId?: string;
  initialCreationId?: string;
};

export function Studio({
  initialAssetId,
  initialCreationId,
}: StudioProps = {}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [preprocessingPhase, setPreprocessingPhase] =
    useState<PreprocessingPhase>(null);
  const [preprocessingSourceFiles, setPreprocessingSourceFiles] = useState<File[]>([]);
  const [processedImageReviews, setProcessedImageReviews] = useState<
    ProcessedImageReview[]
  >([]);
  const [preprocessingCompletedCount, setPreprocessingCompletedCount] = useState(0);
  const [preprocessingError, setPreprocessingError] = useState("");
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [generationModalOpen, setGenerationModalOpen] = useState(false);
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [failedStage, setFailedStage] = useState<"uploading" | "generating" | null>(null);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [progress, setProgress] = useState(0);
  const [modelUrls, setModelUrls] = useState<ModelUrls | null>(null);
  const [previewModelUrl, setPreviewModelUrl] = useState<string | null>(null);
  const [activeModelBlob, setActiveModelBlob] = useState<Blob | null>(null);
  const [activeModelName, setActiveModelName] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exportModel, setExportModel] = useState<ModelExportAction | null>(null);
  const [, setCreationsRefreshKey] = useState(0);
  const [editingCreationId, setEditingCreationId] = useState<string | null>(null);
  const [catalogModel, setCatalogModel] = useState<{
    asset: KhronosAsset;
    blob: Blob;
    savedId: string | null;
  } | null>(null);
  const [catalogSaveStatus, setCatalogSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [lockedAspectRatio, setLockedAspectRatio] = useState<number | null>(1);
  const activeRequest = useRef<AbortController | null>(null);
  const previewUrls = useRef<string[]>([]);
  const pendingPreviewUrls = useRef<string[]>([]);
  const preprocessingRun = useRef(0);
  const previewTask = useRef<PreviewTask | null>(null);
  const routeModelLoadHandled = useRef(false);
  const [dimensions, setDimensions] = useState<Record<PrintDimension, string>>({
    x: "100",
    y: "3",
    z: "100",
  });

  useEffect(() => {
    return () => {
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
      pendingPreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!previewModelUrl) return;
    return () => URL.revokeObjectURL(previewModelUrl);
  }, [previewModelUrl]);

  useEffect(() => {
    if (!editingCreationId) return;
    const width = Number(dimensions.x);
    const depth = Number(dimensions.y);
    const height = Number(dimensions.z);
    if (![width, depth, height].every((value) => Number.isFinite(value) && value > 0)) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void updateCreationDimensions(editingCreationId, { width, depth, height })
        .catch((storageError) =>
          console.error("Could not save the edited creation dimensions.", storageError),
        );
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [dimensions.x, dimensions.y, dimensions.z, editingCreationId]);

  const registerExportModel = useCallback((action: ModelExportAction | null) => {
    setExportModel(() => action);
  }, []);

  const handleAspectRatioChange = useCallback((ratio: number) => {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    setLockedAspectRatio((current) => (current === null ? null : ratio));
    setDimensions((current) => {
      const maxHeight = Math.max(1, Math.min(250, Math.floor(250 / ratio)));
      const height = Math.min(maxHeight, Number(current.z) || 100);
      return {
        ...current,
        x: String(Math.round(height * ratio)),
        z: String(height),
      };
    });
  }, []);

  const handlePreviewWidthChange = useCallback(
    (width: number) => {
      if (lockedAspectRatio) {
        const minWidth = Math.max(1, lockedAspectRatio);
        const maxWidth = Math.min(250, 250 * lockedAspectRatio);
        const boundedWidth = Math.min(maxWidth, Math.max(minWidth, width));
        const boundedHeight = boundedWidth / lockedAspectRatio;
        setDimensions((current) => ({
          ...current,
          x: String(Math.round(boundedWidth * 10) / 10),
          z: String(Math.round(boundedHeight * 10) / 10),
        }));
        return;
      }

      const boundedWidth = Math.min(250, Math.max(1, width));
      setDimensions((current) => ({ ...current, x: String(boundedWidth) }));
    },
    [lockedAspectRatio],
  );

  const handlePreviewHeightChange = useCallback(
    (height: number) => {
      if (lockedAspectRatio) {
        const minHeight = Math.max(1, 1 / lockedAspectRatio);
        const maxHeight = Math.min(250, 250 / lockedAspectRatio);
        const boundedHeight = Math.min(maxHeight, Math.max(minHeight, height));
        const boundedWidth = boundedHeight * lockedAspectRatio;
        setDimensions((current) => ({
          ...current,
          x: String(Math.round(boundedWidth * 10) / 10),
          z: String(Math.round(boundedHeight * 10) / 10),
        }));
        return;
      }

      const boundedHeight = Math.min(250, Math.max(1, height));
      setDimensions((current) => ({ ...current, z: String(boundedHeight) }));
    },
    [lockedAspectRatio],
  );

  const handleProportionsLockedChange = useCallback(
    (locked: boolean) => {
      if (!locked) {
        setLockedAspectRatio(null);
        return;
      }

      const width = Number(dimensions.x);
      const height = Number(dimensions.z);
      if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
        setLockedAspectRatio(width / height);
      }
    },
    [dimensions.x, dimensions.z],
  );

  const loadModelPreview = async (task: PreviewTask, signal: AbortSignal) => {
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewModelUrl(null);
    setCatalogModel(null);
    setCatalogSaveStatus("idle");

    try {
      const response = await fetch("/api/model-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: task.taskId,
          task_type: task.taskType,
          task_token: task.taskToken,
        }),
        signal,
      });
      if (!response.ok) {
        const result = await readJson(response);
        throw new Error(getApiError(result) ?? "Could not download the model for preview.");
      }

      const modelBlob = await response.blob();
      if (modelBlob.size === 0) {
        throw new Error("The generation service returned an empty model file.");
      }
      if (!signal.aborted) {
        setPreviewModelUrl(URL.createObjectURL(modelBlob));
        setActiveModelBlob(modelBlob);
        setActiveModelName(task.creationName);
        try {
          await saveCreation({
            id: task.taskId,
            name: task.creationName,
            model: modelBlob,
            dimensions: task.dimensions,
          });
          if (!signal.aborted) {
            setEditingCreationId(task.taskId);
            setCreationsRefreshKey((current) => current + 1);
          }
        } catch (storageError) {
          console.error("Could not save the model to local creations.", storageError);
        }
      }
    } catch (previewLoadError) {
      if (!signal.aborted) {
        setPreviewError(
          previewLoadError instanceof Error
            ? previewLoadError.message
            : "Could not load the 3D preview. You can still download the generated file.",
        );
      }
    } finally {
      if (!signal.aborted) setPreviewLoading(false);
    }
  };

  const retryModelPreview = async () => {
    if (!previewTask.current) return;

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    await loadModelPreview(previewTask.current, controller.signal);
    if (activeRequest.current === controller) activeRequest.current = null;
  };

  const startGeneration = async (selectedImages: SelectedImage[]) => {
    if (selectedImages.length === 0) return;

    let activeStage: "uploading" | "generating" = "uploading";
    setGenerationModalOpen(true);
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setError("");
    setExportError("");
    setModelUrls(null);
    setPreviewModelUrl(null);
    setActiveModelBlob(null);
    setActiveModelName("");
    setPreviewError("");
    setPreviewLoading(false);
    setCatalogModel(null);
    setCatalogSaveStatus("idle");
    setEditingCreationId(null);
    previewTask.current = null;
    setExportModel(null);
    setProgress(0);
    setFailedStage(null);
    setStatus("uploading");

    try {
      const formData = new FormData();
      selectedImages.forEach(({ file }) => formData.append("images", file));

      const createResponse = await fetch("/api/generate-3d", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const createResult = await readJson(createResponse);
      if (!createResponse.ok) {
        throw new Error(getApiError(createResult) ?? "Could not start 3D generation.");
      }
      if (
        !isRecord(createResult) ||
        typeof createResult.task_id !== "string" ||
        (createResult.task_type !== "image-to-3d" &&
          createResult.task_type !== "multi-image-to-3d") ||
        typeof createResult.task_token !== "string"
      ) {
        throw new Error("The generation service returned an invalid task response.");
      }

      const taskId = createResult.task_id;
      const taskType = createResult.task_type;
      const taskToken = createResult.task_token;
      const sourceName = selectedImages[0]?.file.name
        .replace(/-isolated\.png$/i, "")
        .replace(/\.[^.]+$/, "");
      const task: PreviewTask = {
        taskId,
        taskType,
        taskToken,
        creationName: sourceName ? `${sourceName} model` : "3D creation",
        dimensions: {
          width: getDimensionValue("x"),
          depth: getDimensionValue("y"),
          height: getDimensionValue("z"),
        },
      };
      previewTask.current = task;
      activeStage = "generating";
      setStatus("generating");

      for (let pollAttempt = 0; pollAttempt < 180; pollAttempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        if (controller.signal.aborted) return;

        const pollResponse = await fetch("/api/poll-task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_id: taskId,
            task_type: taskType,
            task_token: taskToken,
          }),
          signal: controller.signal,
        });
        const pollResult = await readJson(pollResponse);
        if (!pollResponse.ok) {
          throw new Error(getApiError(pollResult) ?? "Could not check the generation status.");
        }
        if (!isRecord(pollResult) || typeof pollResult.status !== "string") {
          throw new Error("The generation service returned an invalid task status.");
        }

        if (pollResult.status === "FAILED" || pollResult.status === "CANCELED") {
          throw new Error(getApiError(pollResult) ?? "The generation service could not create this model.");
        }

        if (
          typeof pollResult.progress === "number" &&
          Number.isFinite(pollResult.progress)
        ) {
          setProgress(Math.min(100, Math.max(0, pollResult.progress)));
        }

        if (pollResult.status === "SUCCEEDED") {
          const urls = isRecord(pollResult.model_urls) ? pollResult.model_urls : null;
          const glb = urls && typeof urls.glb === "string" ? urls.glb : undefined;
          const stl = urls && typeof urls.stl === "string" ? urls.stl : undefined;
          if (!glb && !stl) {
            throw new Error("The model finished without a downloadable GLB or STL file.");
          }

          setModelUrls({ glb, stl });
          setProgress(100);
          setStatus("ready");
          if (glb) await loadModelPreview(task, controller.signal);
          return;
        }
      }

      throw new Error("Model generation timed out. Please try again.");
    } catch (generationError) {
      if (controller.signal.aborted) return;
      setError(
        generationError instanceof Error
          ? generationError.message
          : "An unexpected error occurred during model generation.",
      );
      setFailedStage(activeStage);
      setStatus("error");
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  };

  const photoControlsDisabled =
    images.length >= 4 ||
    status === "uploading" ||
    status === "generating" ||
    preprocessingPhase !== null;

  const revokePendingPreviews = () => {
    pendingPreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    pendingPreviewUrls.current = [];
  };

  const cancelImagePreprocessing = () => {
    preprocessingRun.current += 1;
    revokePendingPreviews();
    setProcessedImageReviews([]);
    setPreprocessingSourceFiles([]);
    setPreprocessingCompletedCount(0);
    setPreprocessingError("");
    setPreprocessingPhase(null);
  };

  const beginImagePreprocessing = async (sourceFiles: File[]) => {
    const run = preprocessingRun.current + 1;
    preprocessingRun.current = run;
    revokePendingPreviews();
    setProcessedImageReviews([]);
    setPreprocessingSourceFiles(sourceFiles);
    setPreprocessingCompletedCount(0);
    setPreprocessingError("");
    setPreprocessingPhase("processing");

    const processedImages: ProcessedImageReview[] = [];
    try {
      for (let index = 0; index < sourceFiles.length; index += 1) {
        const processedFile = await isolateAndCropSubject(sourceFiles[index]);
        if (preprocessingRun.current !== run) return;
        const previewUrl = URL.createObjectURL(processedFile);
        pendingPreviewUrls.current.push(previewUrl);
        processedImages.push({ file: processedFile, previewUrl });
        setPreprocessingCompletedCount(index + 1);
      }

      if (preprocessingRun.current !== run) return;
      setProcessedImageReviews(processedImages);
      setPreprocessingPhase("review");
    } catch (processingError) {
      if (preprocessingRun.current !== run) return;
      revokePendingPreviews();
      setProcessedImageReviews([]);
      setPreprocessingError(
        processingError instanceof Error
          ? processingError.message
          : "The subject could not be isolated from this image.",
      );
      setPreprocessingPhase("error");
    }
  };

  const approveProcessedImages = () => {
    if (preprocessingPhase !== "review" || processedImageReviews.length === 0) return;
    previewUrls.current.push(...processedImageReviews.map(({ previewUrl }) => previewUrl));
    pendingPreviewUrls.current = [];
    setImages((current) => [...current, ...processedImageReviews]);
    setProcessedImageReviews([]);
    setPreprocessingSourceFiles([]);
    setPreprocessingCompletedCount(0);
    setPreprocessingError("");
    setPreprocessingPhase(null);
  };

  const onDrop = (acceptedFiles: File[], rejectedFiles: { file: File }[]) => {
    if (photoControlsDisabled) return;
    if (
      rejectedFiles.length > 0 ||
      acceptedFiles.some(
        (file) =>
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          file.size > 20 * 1024 * 1024,
      )
    ) {
      setError("Choose up to four JPG, PNG, or WebP images, each smaller than 20 MB.");
      return;
    }
    if (acceptedFiles.length === 0) return;
    if (images.length + acceptedFiles.length > 4) {
      setError("Up to four photos of the same object can be selected.");
      return;
    }

    activeRequest.current?.abort();
    activeRequest.current = null;
    setError("");
    setExportError("");
    setModelUrls(null);
    setPreviewModelUrl(null);
    setPreviewError("");
    setPreviewLoading(false);
    previewTask.current = null;
    setExportModel(null);
    setProgress(0);
    setFailedStage(null);
    setStatus("idle");
    void beginImagePreprocessing(acceptedFiles);
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"] },
    maxFiles: 4,
    maxSize: 20 * 1024 * 1024,
    multiple: true,
    noClick: images.length > 0,
    noKeyboard: images.length > 0,
    disabled: photoControlsDisabled,
  });

  const removeImage = (indexToRemove: number) => {
    const removed = images[indexToRemove];
    if (removed) {
      URL.revokeObjectURL(removed.previewUrl);
      previewUrls.current = previewUrls.current.filter((url) => url !== removed.previewUrl);
    }
    setImages((current) => current.filter((_, index) => index !== indexToRemove));
    activeRequest.current?.abort();
    activeRequest.current = null;
    setGenerationModalOpen(false);
    setFailedStage(null);
    setStatus("idle");
    setProgress(0);
    setError("");
    setExportError("");
    setModelUrls(null);
    setPreviewModelUrl(null);
    setPreviewError("");
    setPreviewLoading(false);
    previewTask.current = null;
    setExportModel(null);
    setEditingCreationId(null);
  };

  const updateDimension = (dimension: PrintDimension, value: string) => {
    if (value !== "" && dimension === "x" && lockedAspectRatio) {
      const width = Number(value);
      if (Number.isFinite(width) && width > 0) {
        handlePreviewWidthChange(width);
        return;
      }
    }

    if (value !== "" && dimension === "z" && lockedAspectRatio) {
      const height = Number(value);
      if (Number.isFinite(height) && height > 0) {
        handlePreviewHeightChange(height);
        return;
      }
    }

    setDimensions((current) => ({ ...current, [dimension]: value }));
  };

  const getDimensionValue = (dimension: PrintDimension) => {
    const value = Number(dimensions[dimension]);
    return Number.isFinite(value) && value > 0 ? value : 100;
  };

  const handleRemoveImage = () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current = [];
    setImages([]);
    setGenerationModalOpen(false);
    setFailedStage(null);
    setStatus("idle");
    setError("");
    setExportError("");
    setProgress(0);
    setModelUrls(null);
    setPreviewModelUrl(null);
    setActiveModelBlob(null);
    setActiveModelName("");
    setPreviewError("");
    setPreviewLoading(false);
    previewTask.current = null;
    setExportModel(null);
    setEditingCreationId(null);
    setCatalogModel(null);
    setCatalogSaveStatus("idle");
  };

  const editCreation = useCallback((creation: StoredCreation) => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    const modelUrl = URL.createObjectURL(creation.model);
    setPreviewModelUrl(modelUrl);
    setActiveModelBlob(creation.model);
    setActiveModelName(creation.name);
    setModelUrls({ glb: modelUrl });
    setDimensions({
      x: String(creation.dimensions.width),
      y: String(creation.dimensions.depth),
      z: String(creation.dimensions.height),
    });
    setLockedAspectRatio(creation.dimensions.width / creation.dimensions.height);
    setEditingCreationId(creation.id);
    setCatalogModel(null);
    setCatalogSaveStatus("idle");
    setGenerationModalOpen(false);
    setPreviewError("");
    setPreviewLoading(false);
    setExportError("");
    setExportModel(null);
    setError("");
    setFailedStage(null);
    setProgress(100);
    setStatus("ready");
    previewTask.current = null;
    window.setTimeout(
      () =>
        document
          .getElementById("created-model")
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      0,
    );
  }, []);

  const editCatalogAsset = useCallback(async (asset: KhronosAsset) => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setPreviewLoading(true);
    setPreviewError("");

    try {
      const response = await fetch(asset.modelUrl);
      if (!response.ok) {
        throw new Error(`Could not download ${asset.label} (${response.status}).`);
      }
      const modelBlob = await response.blob();
      if (modelBlob.size === 0) {
        throw new Error(`${asset.label} returned an empty model file.`);
      }

      const modelUrl = URL.createObjectURL(modelBlob);
      setPreviewModelUrl(modelUrl);
      setActiveModelBlob(modelBlob);
      setActiveModelName(`${asset.label} edit`);
      setModelUrls({ glb: modelUrl });
      setDimensions({ x: "100", y: "100", z: "100" });
      setLockedAspectRatio(1);
      setEditingCreationId(null);
      setCatalogModel({ asset, blob: modelBlob, savedId: null });
      setCatalogSaveStatus("idle");
      setGenerationModalOpen(false);
      setExportError("");
      setExportModel(null);
      setError("");
      setFailedStage(null);
      setProgress(100);
      setStatus("ready");
      previewTask.current = null;
      window.setTimeout(
        () =>
          document
            .getElementById("created-model")
            ?.scrollIntoView({ behavior: "smooth", block: "center" }),
        0,
      );
    } catch (assetError) {
      throw assetError instanceof Error
        ? assetError
        : new Error("This model could not be opened in the editor.");
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const saveCatalogModel = async () => {
    if (!catalogModel || catalogModel.savedId) return;
    setCatalogSaveStatus("saving");
    try {
      const creation = await saveCreation({
        id: createCreationId(`khronos-${catalogModel.asset.id}`),
        name: `${catalogModel.asset.label} edit`,
        model: catalogModel.blob,
        dimensions: {
          width: getDimensionValue("x"),
          depth: getDimensionValue("y"),
          height: getDimensionValue("z"),
        },
      });
      setCatalogModel((current) =>
        current ? { ...current, savedId: creation.id } : current,
      );
      setEditingCreationId(creation.id);
      setCreationsRefreshKey((current) => current + 1);
      setCatalogSaveStatus("saved");
    } catch (storageError) {
      console.error("Could not save the catalog model to Creations.", storageError);
      setCatalogSaveStatus("error");
    }
  };

  const applyGeneratedTexture = async (texturedModel: Blob) => {
    const modelUrl = URL.createObjectURL(texturedModel);
    setPreviewModelUrl(modelUrl);
    setModelUrls({ glb: modelUrl });
    setActiveModelBlob(texturedModel);
    setCatalogModel((current) =>
      current ? { ...current, blob: texturedModel } : current,
    );
    setPreviewError("");
    setExportError("");
    setExportModel(null);

    if (editingCreationId) {
      try {
        await saveCreation({
          id: editingCreationId,
          name: activeModelName || "Textured model",
          model: texturedModel,
          dimensions: {
            width: getDimensionValue("x"),
            depth: getDimensionValue("y"),
            height: getDimensionValue("z"),
          },
        });
        setCreationsRefreshKey((current) => current + 1);
      } catch (storageError) {
        console.error("Could not update the local creation texture.", storageError);
      }
    }
  };

  const saveActiveModelToCollections = async () => {
    if (!activeModelBlob) return;
    if (catalogModel && !catalogModel.savedId) {
      await saveCatalogModel();
      return;
    }
    if (editingCreationId) return;

    setCatalogSaveStatus("saving");
    try {
      const creation = await saveCreation({
        id: createCreationId("collection"),
        name: activeModelName || "Created model",
        model: activeModelBlob,
        dimensions: {
          width: getDimensionValue("x"),
          depth: getDimensionValue("y"),
          height: getDimensionValue("z"),
        },
      });
      setEditingCreationId(creation.id);
      setCreationsRefreshKey((current) => current + 1);
      setCatalogSaveStatus("saved");
    } catch (storageError) {
      console.error("Could not save the active model to Collections.", storageError);
      setCatalogSaveStatus("error");
    }
  };

  useEffect(() => {
    if (routeModelLoadHandled.current) return;
    routeModelLoadHandled.current = true;
    const parameters = new URLSearchParams(window.location.search);
    const creationId = initialCreationId ?? parameters.get("creation");
    const assetId = initialAssetId ?? parameters.get("asset");
    if (!creationId && !assetId) return;

    const loadRequestedModel = async () => {
      try {
        if (creationId) {
          const creation = await getCreation(creationId);
          if (!creation) {
            throw new Error("That saved creation is no longer available.");
          }
          editCreation(creation);
          return;
        }

        const assets = await fetchKhronosAssets();
        const asset = assets.find(({ id }) => id === assetId);
        if (!asset) throw new Error("That free model could not be found.");
        await editCatalogAsset(asset);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "The selected model could not be opened.",
        );
      }
    };

    void loadRequestedModel();
  }, [editCatalogAsset, editCreation, initialAssetId, initialCreationId]);

  return (
    <>
    <main className="min-h-screen overflow-x-hidden bg-[#0B0D12] text-slate-100">
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-7 sm:px-6 sm:pt-10 md:px-8 md:pt-12">
        <div className="mb-7 max-w-2xl sm:mb-9">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-300">
            <span className="size-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
            Capture &amp; Create
          </div>
          <h1 className="max-w-[18ch] text-[clamp(1.75rem,6vw,2.75rem)] font-bold leading-[1.12] tracking-tight [hyphens:none]">
            A photo, made <span className="text-blue-400">three-dimensional.</span>
          </h1>
          <p className="mt-3 max-w-[36ch] text-sm leading-relaxed text-slate-400 sm:text-base">
            Turn a favorite image into a print-ready relief. Add a photo, set your size, and we&apos;ll shape it for you.
          </p>
        </div>

        <div className="flex flex-col gap-5">
          <div id="create-image" className="scroll-mt-8">
            <section id="capture" className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#12151E] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
            <div className="border-b border-white/[0.08] p-4 sm:p-6">
              <div className="min-w-0">
                <span className="inline-flex rounded-full border border-blue-400/20 bg-blue-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-blue-300 tabular-nums">
                  01 · Capture &amp; Prep
                </span>
                <h2 className="mt-3 text-base font-semibold tracking-tight text-white sm:text-lg">Photo capture &amp; preparation</h2>
                <p className="mt-1 text-xs leading-normal text-slate-400 sm:text-sm">
                  Upload up to four views; each subject is isolated and cropped for approval.
                </p>
              </div>
            </div>

            <div className="p-4 sm:p-6">
              <div
                {...getRootProps({
                  className: `relative flex min-h-[260px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed transition sm:min-h-[368px] ${
                    isDragActive ? "border-[#3b82f6] bg-[#17243a]" : "border-[#232832] bg-[#0b0d10] hover:border-[#3b82f6] hover:bg-[#14171d]"
                  }`,
                })}
              >
                <input {...getInputProps()} />
                {images.length > 0 ? (
                  <div className="grid w-full grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5">
                    {images.map(({ file, previewUrl }, index) => (
                      <div key={`${file.name}-${file.lastModified}-${index}`} className="group relative aspect-square overflow-hidden rounded-xl border border-[#e6e9df] bg-white">
                        <Image
                          src={previewUrl}
                          alt={`View ${index + 1}: ${file.name}`}
                          fill
                          unoptimized
                          className="object-cover"
                          sizes="(max-width: 640px) 45vw, 20vw"
                        />
                        <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-1 font-mono text-[10px] font-medium text-white">
                          View {index + 1}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeImage(index);
                          }}
                          className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-[#14171d]/95 text-sm font-semibold text-[#f3f4f6] opacity-100 shadow-sm transition hover:bg-[#232832] sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <X aria-hidden="true" className="size-4" />
                        </button>
                      </div>
                    ))}
                    {images.length < 4 && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          open();
                        }}
                        disabled={photoControlsDisabled}
                        className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#232832] bg-[#14171d] text-xs font-medium text-[#9ca3af] transition hover:border-[#3b82f6] hover:bg-[#1b2029] disabled:opacity-50"
                      >
                        <Plus aria-hidden="true" className="size-4" />
                        Add view
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center px-6 text-center">
                    <span className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-[#232832] bg-[#14171d] text-[#60a5fa] shadow-sm">
                      <UploadCloud aria-hidden="true" className="size-5" />
                    </span>
                    <p className="text-[15px] font-semibold text-[#343731]">
                      {isDragActive ? "Drop it here to get started" : "Drop your photo here"}
                    </p>
                    <p className="mt-2 text-sm text-[#8b8e86]">or choose up to four photos from different angles</p>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        open();
                      }}
                      disabled={photoControlsDisabled}
                      className="button-primary mt-4"
                    >
                      Choose photos
                    </button>
                    <span className="mt-5 rounded-full border border-[#e9eae5] bg-white px-3 py-1.5 text-[11px] font-medium text-[#777b73]">JPG, PNG, WEBP <span className="mx-1 text-[#d0d2cb]">·</span> 20 MB each <span className="mx-1 text-[#d0d2cb]">·</span> up to 4 images</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                disabled={photoControlsDisabled}
                className="button-secondary mt-4 w-full"
              >
                Take a photo
              </button>
              {cameraOpen && (
                <CameraCapture
                  onCapture={(file) => void onDrop([file], [])}
                  onClose={() => setCameraOpen(false)}
                />
              )}

              {images[0] && (
                <ScalingPreview
                  file={images[0].file}
                  previewUrl={images[0].previewUrl}
                  widthMm={getDimensionValue("x")}
                  heightMm={getDimensionValue("z")}
                  proportionsLocked={lockedAspectRatio !== null}
                  onWidthChange={handlePreviewWidthChange}
                  onHeightChange={handlePreviewHeightChange}
                  onProportionsLockedChange={handleProportionsLockedChange}
                  onAspectRatioChange={handleAspectRatioChange}
                />
              )}

              {error && <p role="alert" className="mt-3 text-xs font-medium text-[#b34e3a]">{error}</p>}

              {images.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-[#858980]">{images.length} of 4 photos selected</p>
                  <button
                    type="button"
                    onClick={() => open()}
                    disabled={photoControlsDisabled}
                    className="button-secondary"
                  >
                    Add photos
                  </button>
                </div>
              )}

              {images.length > 0 && status !== "idle" && !generationModalOpen && (
                <div className="mt-5 rounded-xl bg-[#f8f9f5] px-4 py-4 sm:px-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-[#3d4139]">Model progress</p>
                      <p className="mt-1 text-[11px] text-[#90948a]" role="status" aria-live="polite">
                        {status === "uploading" && "Uploading your image…"}
                        {status === "generating" && `Generating your model… ${progress}%`}
                        {status === "ready" && "Your model is ready to print"}
                        {status === "error" && "Generation stopped"}
                      </p>
                    </div>
                    <button type="button" onClick={handleRemoveImage} className="rounded-md px-2 py-1 text-[11px] font-medium text-[#84877f] transition hover:bg-white hover:text-[#343731]">
                      Clear all
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    {stages.map((stage, index) => {
                      const currentIndex = stages.findIndex((item) => item.id === status);
                      const isComplete = currentIndex > index;
                      const isCurrent = stage.id === status;
                      const fillWidth =
                        status === "uploading" && isCurrent
                          ? "45%"
                          : status === "generating" && isCurrent
                            ? `${progress}%`
                            : "100%";

                      return (
                        <div key={stage.id} className="min-w-0">
                          <div className={`mb-2 h-1 rounded-full ${isComplete || isCurrent                           ? "bg-[#3b82f6]" : "bg-[#e6e8e1]"}`}>
                            {isCurrent && stage.id !== "ready" && (
                              <div
                                className={`h-full rounded-full bg-[#3b82f6] ${stage.id === "uploading" ? "animate-pulse" : ""}`}
                                style={{ width: fillWidth }}
                              />
                            )}
                          </div>
                          <p className={`truncate text-[10px] font-medium sm:text-[11px] ${isComplete || isCurrent ? "text-[#505747]" : "text-[#a0a39b]"}`}>
                            {isComplete && <span className="mr-1 inline-flex align-[-2px] text-[#60a5fa]"><Check aria-hidden="true" className="size-3.5" /></span>}
                            {stage.label}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  {status === "error" && error && (
                    <p role="alert" className="mt-3 text-xs font-medium text-[#b34e3a]">{error}</p>
                  )}
                  {status === "error" && (
                    <button
                      type="button"
                      onClick={() => void startGeneration(images)}
                      className="mt-3 text-xs font-semibold text-[#536b2d] underline underline-offset-2"
                    >
                      Try again
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-[#efefec] px-5 py-3.5 text-[11px] text-[#93968e] sm:px-7">
              <LockKeyhole aria-hidden="true" className="size-4 shrink-0 text-[#60a5fa]" />
              Only approved, isolated images are sent to our image-generation service.
            </div>
            </section>
          </div>

          <div id="model-settings" className="scroll-mt-8">
            <aside className="rounded-2xl border border-white/[0.08] bg-[#12151E] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] sm:p-6">
            <div className="mb-5">
              <span className="inline-flex rounded-full border border-blue-400/20 bg-blue-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-blue-300 tabular-nums">
                02 · Size &amp; Create
              </span>
              <div>
                <div className="mb-3 mt-3 flex size-9 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10 text-blue-400"><Box aria-hidden="true" className="size-[18px]" strokeWidth={1.5} /></div>
                <h2 className="text-base font-semibold tracking-tight text-white sm:text-lg">3D model generation &amp; parameters</h2>
                <p className="mt-1 text-xs leading-normal text-slate-400 sm:text-sm">Set the finished size, then generate the model.</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {(["x", "y", "z"] as const).map((dimension) => (
                <label key={dimension} className="flex items-center justify-between gap-4 rounded-xl border border-[#eceee8] px-4 py-3.5 transition focus-within:border-[#afc17e]">
                  <span className="flex items-center gap-3">
                    <span className={`flex size-7 items-center justify-center rounded-lg text-xs font-semibold ${
                      dimension === "x" ? "bg-[#f3eee6] text-[#a17d4b]" : dimension === "y" ? "bg-[#eaf1f2] text-[#648b91]" : "bg-[#f0edf5] text-[#8975a2]"
                    } font-mono`}>{dimension.toUpperCase()}</span>
                    <span className="text-xs font-medium text-[#5b5f56]">{dimensionLabels[dimension]}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <input
                      aria-label={`${dimensionLabels[dimension]} in millimeters`}
                      type="number"
                      min="0.1"
                      max={dimension === "x" || dimension === "z" ? 250 : undefined}
                      step="0.1"
                      value={dimensions[dimension]}
                      onChange={(event) => updateDimension(dimension, event.target.value)}
                      className="w-20 bg-transparent text-right font-mono text-sm font-semibold tabular-nums text-[#f3f4f6] outline-none"
                    />
                    <span className="text-[11px] text-[#9a9d94]">mm</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-5 rounded-xl bg-[#f8f9f5] px-4 py-3.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#858980]">Estimated footprint</span>
                <span className="font-mono font-semibold tabular-nums text-[#f3f4f6]">
                  {dimensions.x || "0"} × {dimensions.y || "0"} × {dimensions.z || "0"} mm
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={open}
              disabled={photoControlsDisabled}
              className="button-secondary mt-5 w-full gap-2"
            >
              <UploadCloud aria-hidden="true" className="size-5" />
              {images.length ? "Add more photos" : "Choose photos"}
            </button>
            <button
              type="button"
              onClick={() => void startGeneration(images)}
              disabled={images.length === 0 || status === "uploading" || status === "generating"}
              className="button-primary mt-2 w-full gap-2"
            >
              <Sparkles aria-hidden="true" className="size-[18px] text-[#bfdbfe]" />
              {status === "ready" ? "Regenerate 3D model" : status === "uploading" || status === "generating" ? "Generating model…" : status === "error" ? "Try again" : "Generate 3D model"}
            </button>
            <p className="mt-3 text-center text-[10px] leading-5 text-[#a0a39b]">
              {status === "error" ? "Your photos are still here if you want to retry." : images.length ? "Dimensions are saved with this session." : "Add one to four photos of the same object."}
            </p>
            </aside>
          </div>
        </div>

        <section
          id="created-model"
          className="mt-10 scroll-mt-40 overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#182028] shadow-[0_12px_32px_-18px_rgba(0,0,0,0.6)]"
        >
          <div className="border-b border-white/[0.08] px-5 py-5 sm:px-7">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[#60a5fa]">
              Created model
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-[-0.025em] text-white">
              {activeModelName || "Your generated output"}
            </h2>
            <p className="mt-1 text-xs text-[#94a3b8]">
              Inspect, save, texture, or export the finished model.
            </p>
          </div>

          {status === "ready" && modelUrls?.glb && previewModelUrl ? (
            <div className="p-4 sm:p-6">
              <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.5fr)]">
                <ModelViewer
                  modelUrl={previewModelUrl}
                  width={getDimensionValue("x")}
                  depth={getDimensionValue("y")}
                  height={getDimensionValue("z")}
                  onExportReady={registerExportModel}
                  onExportError={setExportError}
                  onRetry={() => void retryModelPreview()}
                  animated
                />

                <aside className="flex flex-col rounded-[20px] border border-white/[0.08] bg-[#11171d] p-5">
                  <span className="w-fit rounded-full border border-[#60a5fa]/35 bg-[#60a5fa]/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#93c5fd]">
                    Ready
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-white">
                    Continue your model
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[#94a3b8]">
                    Current size: {dimensions.x || "0"} × {dimensions.y || "0"} ×{" "}
                    {dimensions.z || "0"} mm
                  </p>

                  <div className="mt-5 grid gap-2">
                    <button
                      type="button"
                      onClick={() => void saveActiveModelToCollections()}
                      disabled={
                        catalogSaveStatus === "saving" ||
                        Boolean(editingCreationId) ||
                        Boolean(catalogModel?.savedId)
                      }
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#2563eb] px-4 text-sm font-semibold text-white transition hover:bg-[#1d4ed8] disabled:cursor-default disabled:bg-[#334155] disabled:text-[#94a3b8]"
                    >
                      <Check aria-hidden="true" className="size-4" />
                      {catalogSaveStatus === "saving"
                        ? "Saving…"
                        : editingCreationId || catalogModel?.savedId
                          ? "Saved to Collections"
                          : "Save to Collections"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        document
                          .getElementById("texture-studio")
                          ?.scrollIntoView({ behavior: "smooth", block: "center" });
                        window.setTimeout(
                          () =>
                            document
                              .querySelector<HTMLTextAreaElement>(
                                "#texture-studio textarea",
                              )
                              ?.focus(),
                          450,
                        );
                      }}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-[#1e242b] px-4 text-sm font-semibold text-white transition hover:border-[#60a5fa]/45 hover:bg-[#24303c]"
                    >
                      <Sparkles aria-hidden="true" className="size-4 text-[#93c5fd]" />
                      Send to Textures
                    </button>
                  </div>

                  <div className="mt-auto pt-5">
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[#7d8794]">
                      Download
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {modelUrls.glb && (
                        <a
                          href={modelUrls.glb}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-white/[0.1] px-3 py-2 text-xs font-semibold text-[#d7dde5] hover:bg-[#1e242b]"
                        >
                          GLB
                        </a>
                      )}
                      {modelUrls.stl && (
                        <a
                          href={modelUrls.stl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-white/[0.1] px-3 py-2 text-xs font-semibold text-[#d7dde5] hover:bg-[#1e242b]"
                        >
                          STL
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => exportModel?.()}
                        disabled={!exportModel}
                        className="rounded-lg border border-white/[0.1] px-3 py-2 text-xs font-semibold text-[#d7dde5] hover:bg-[#1e242b] disabled:opacity-45"
                      >
                        Print-ready STL
                      </button>
                    </div>
                  </div>
                </aside>
              </div>

              {activeModelBlob && (
                <div id="texture-studio" className="scroll-mt-40">
                  <TextureGenerator
                    model={activeModelBlob}
                    onTextureReady={applyGeneratedTexture}
                  />
                </div>
              )}
              {catalogSaveStatus === "error" && (
                <p role="alert" className="mt-3 text-xs font-medium text-[#fda4af]">
                  The model could not be saved to Collections. Please try again.
                </p>
              )}
              {exportError && (
                <p role="alert" className="mt-3 text-xs font-medium text-[#fda4af]">
                  {exportError}
                </p>
              )}
            </div>
          ) : status === "ready" && modelUrls?.glb ? (
            <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
              <Box aria-hidden="true" className="size-8 text-[#60a5fa]" />
              <p className="mt-4 text-sm font-semibold text-white">
                {previewLoading ? "Loading your 3D preview…" : "Preview unavailable"}
              </p>
              <p className="mt-2 max-w-sm text-xs leading-5 text-[#94a3b8]">
                {previewError || "The model is ready, but its preview could not be shown."}
              </p>
              {!previewLoading && previewError && (
                <button
                  type="button"
                  onClick={() => void retryModelPreview()}
                  className="mt-4 rounded-xl bg-[#2563eb] px-4 py-2.5 text-xs font-semibold text-white"
                >
                  Retry preview
                </button>
              )}
            </div>
          ) : previewLoading ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <Sparkles
                aria-hidden="true"
                className="size-7 animate-pulse text-[#60a5fa]"
              />
              <p className="mt-4 text-sm font-semibold text-white">
                Loading selected model…
              </p>
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl border border-[#60a5fa]/25 bg-[#17243a] text-[#60a5fa]">
                <Box aria-hidden="true" className="size-6" />
              </span>
              <p className="mt-4 text-sm font-semibold text-white">
                Your created model will appear here
              </p>
              <p className="mt-2 max-w-sm text-xs leading-5 text-[#94a3b8]">
                Complete Steps 1 and 2, or load a model from Assets.
              </p>
            </div>
          )}
        </section>

        <footer className="mt-9 flex flex-col gap-2 border-t border-[#e8e9e4] pt-5 text-[11px] text-[#a0a39b] sm:flex-row sm:items-center sm:justify-between">
          <span>Capture &amp; Create - 3D Print Studio</span>
          <span>Precision image-to-model generation</span>
        </footer>
      </div>
    </main>
    {status !== "idle" && !generationModalOpen && (
      <button
        type="button"
        onClick={() => setGenerationModalOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-[#3b82f6]/50 bg-[#14171d] px-4 py-3 text-xs font-semibold text-[#f3f4f6] shadow-[0_8px_30px_rgba(0,0,0,0.35)] transition hover:border-[#60a5fa] hover:bg-[#1b2029] sm:bottom-6 sm:right-6"
        aria-label={
          status === "generating"
            ? `View generation progress, ${progress}%`
            : "View generation details"
        }
      >
        {status === "ready" ? (
          <Check aria-hidden="true" className="size-4 text-[#60a5fa]" />
        ) : status === "error" ? (
          <X aria-hidden="true" className="size-4 text-[#fda4af]" />
        ) : (
          <Sparkles aria-hidden="true" className="size-4 text-[#60a5fa]" />
        )}
        {status === "uploading"
          ? "Uploading photos"
          : status === "generating"
            ? `Generating · ${progress}%`
            : status === "ready"
              ? "View model details"
              : "View generation error"}
      </button>
    )}
    <ImagePreprocessingModal
      open={preprocessingPhase !== null}
      phase={preprocessingPhase}
      images={processedImageReviews}
      completedCount={preprocessingCompletedCount}
      totalCount={preprocessingSourceFiles.length}
      error={preprocessingError}
      onApprove={approveProcessedImages}
      onCancel={cancelImagePreprocessing}
      onRetry={() => void beginImagePreprocessing(preprocessingSourceFiles)}
    />
    <GenerationModal
      open={generationModalOpen}
      images={images}
      status={status}
      failedStage={failedStage}
      progress={progress}
      error={error}
      dimensions={{
        width: dimensions.x,
        depth: dimensions.y,
        height: dimensions.z,
      }}
      modelUrls={modelUrls}
      exportReady={Boolean(exportModel)}
      onClose={() => setGenerationModalOpen(false)}
      onRetry={() => void startGeneration(images)}
      onExport={() => exportModel?.()}
      onViewModel={() => {
        setGenerationModalOpen(false);
        window.setTimeout(
          () =>
            document
              .getElementById("created-model")
              ?.scrollIntoView({ behavior: "smooth", block: "center" }),
          0,
        );
      }}
    />
    </>
  );
}

export default function Home() {
  return <Studio />;
}
