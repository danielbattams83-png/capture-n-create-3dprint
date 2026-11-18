"use client";

import { Component, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Pause, Play } from "lucide-react";
import { Box3, Mesh, Vector3 } from "three";
import type { Group, Material, Object3D, Texture } from "three";

const MATERIAL_MAPS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "aoMap",
  "bumpMap",
  "displacementMap",
  "alphaMap",
  "lightMap",
] as const;

function ownMaterial(material: Material) {
  const copy = material.clone();
  const source = material as Material & Partial<Record<string, Texture | null>>;
  const target = copy as Material & Partial<Record<string, Texture | null>>;
  for (const key of MATERIAL_MAPS) {
    const texture = source[key];
    if (!texture) continue;
    const cloned = texture.clone();
    cloned.needsUpdate = true;
    target[key] = cloned;
  }
  return copy;
}

function ownModel(source: Object3D) {
  const object = source.clone(true);
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry = child.geometry.clone();
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => ownMaterial(material))
      : ownMaterial(child.material);
  });
  return object;
}

function disposeMaterial(material: Material) {
  const textured = material as Material & Partial<Record<string, Texture | null>>;
  for (const key of MATERIAL_MAPS) textured[key]?.dispose();
  material.dispose();
}

function disposeObject(object: Object3D) {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(disposeMaterial);
  });
}

export type ModelExportAction = () => void;

type ModelViewerProps = {
  modelUrl: string;
  width: number;
  depth: number;
  height: number;
  onExportReady: (exportModel: ModelExportAction | null) => void;
  onExportError: (message: string) => void;
  onRetry: () => void;
  animated?: boolean;
};

type ViewerErrorBoundaryProps = {
  children: ReactNode;
  onRetry: () => void;
  resetKey: string;
};

type ViewerErrorBoundaryState = {
  hasError: boolean;
};

class ViewerErrorBoundary extends Component<
  ViewerErrorBoundaryProps,
  ViewerErrorBoundaryState
> {
  state: ViewerErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ViewerErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("3D model preview failed to load.", error);
  }

  componentDidUpdate(previousProps: ViewerErrorBoundaryProps) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[340px] items-center justify-center px-6 text-center">
          <div>
            <p className="text-sm font-semibold text-[#f3f4f6]">Preview unavailable</p>
            <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
              The model could not be displayed. You can retry the preview or download the generated file below.
            </p>
            <button
              type="button"
              onClick={this.props.onRetry}
              className="mt-4 rounded-lg border border-[#232832] bg-[#14171d] px-3 py-2 text-xs font-semibold text-[#60a5fa] shadow-sm transition hover:bg-[#1b2029]"
            >
              Retry preview
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function LoadedModel({
  modelUrl,
  width,
  depth,
  height,
  onExportReady,
  onExportError,
  animated = false,
}: Omit<ModelViewerProps, "onRetry">) {
  const { scene } = useGLTF(modelUrl);
  const modelRef = useRef<Group>(null);
  const fitted = useMemo(() => {
    const object = ownModel(scene);
    const bounds = new Box3().setFromObject(object);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const safeSize = (value: number) => (value > 0 ? value : 1);
    return {
      object,
      offset: [-center.x, -bounds.min.y, -center.z] as [number, number, number],
      size: [safeSize(size.x), safeSize(size.y), safeSize(size.z)] as const,
    };
  }, [scene]);
  const scale = [
    width / fitted.size[0],
    height / fitted.size[1],
    depth / fitted.size[2],
  ] as [number, number, number];

  useEffect(() => {
    const object = fitted.object;
    return () => disposeObject(object);
  }, [fitted.object]);

  useFrame(({ clock }, delta) => {
    const model = modelRef.current;
    if (!model) return;
    if (!animated) {
      model.position.y = 0;
      return;
    }
    model.position.y = Math.sin(clock.elapsedTime * 1.15) * 2;
    model.rotation.y += delta * 0.22;
  });

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;

    const exportModel = async () => {
      try {
        const previousPositionY = model.position.y;
        const previousRotationY = model.rotation.y;
        model.position.y = 0;
        model.rotation.y = 0;
        model.updateWorldMatrix(true, true);
        const { downloadObjectAsStl } = await import("@/components/stl-exporter");
        downloadObjectAsStl(
          model,
          `capture-create-model-${width}x${depth}x${height}mm.stl`,
        );
        model.position.y = previousPositionY;
        model.rotation.y = previousRotationY;
      } catch (error) {
        console.error("Could not export the scaled model as STL.", error);
        onExportError("Could not export the STL. Please try again.");
      }
    };

    onExportReady(exportModel);
    return () => onExportReady(null);
  }, [depth, fitted.object, height, onExportError, onExportReady, width]);

  return (
    <group ref={modelRef} scale={scale}>
      <primitive object={fitted.object} position={fitted.offset} />
    </group>
  );
}

function DemandFrames({
  spinning,
  visible,
  revision,
}: {
  spinning: boolean;
  visible: boolean;
  revision: string;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const active = spinning && visible;

  useEffect(() => {
    if (!visible) return;
    invalidate();
  }, [invalidate, revision, spinning, visible]);

  useFrame((state) => {
    if (!active) return;
    state.invalidate();
  });

  return null;
}

function LoadingModel() {
  return (
    <Html center>
      <div className="whitespace-nowrap rounded-lg border border-[#232832] bg-[#14171d]/90 px-3 py-2 text-xs font-medium text-[#9ca3af] shadow-sm">
        Loading 3D model…
      </div>
    </Html>
  );
}

export default function ModelViewer({
  modelUrl,
  width,
  depth,
  height,
  onExportReady,
  onExportError,
  onRetry,
  animated = false,
}: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [spinning, setSpinning] = useState(animated);
  const [pageVisible, setPageVisible] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  const visible = pageVisible && onScreen;

  useEffect(() => {
    const onVisibility = () => setPageVisible(!document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry?.isIntersecting ?? false),
      { threshold: 0.05 },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <ViewerErrorBoundary resetKey={modelUrl} onRetry={onRetry}>
      <div
        ref={containerRef}
        className="relative h-[360px] min-h-[340px] w-full overflow-hidden rounded-2xl border border-[#232832] bg-[#0b0d10] sm:h-[420px]"
      >
        <Canvas
          frameloop="demand"
          dpr={[1, 1.5]}
          camera={{ position: [230, 185, 230], fov: 40, near: 0.1, far: 2000 }}
          gl={{ antialias: true, alpha: false }}
        >
          <DemandFrames
            spinning={spinning && visible}
            visible={visible}
            revision={`${modelUrl}:${width}:${depth}:${height}`}
          />
          <color attach="background" args={["#0b0d10"]} />
          <ambientLight intensity={1.1} />
          <directionalLight position={[120, 200, 100]} color="#60a5fa" intensity={2.2} />
          <directionalLight position={[-100, 100, -80]} color="#f3f4f6" intensity={0.8} />
          <Suspense fallback={<LoadingModel />}>
            <LoadedModel
              modelUrl={modelUrl}
              width={width}
              depth={depth}
              height={height}
              onExportReady={onExportReady}
              onExportError={onExportError}
              animated={spinning && visible}
            />
          </Suspense>
          <Grid
            args={[220, 220]}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.5, 0]}
            cellSize={10}
            sectionSize={50}
            cellColor="#1e242b"
            sectionColor="#2a323d"
            cellThickness={0.7}
            sectionThickness={1.2}
            fadeDistance={340}
            fadeStrength={0.8}
          />
          <OrbitControls
            makeDefault
            enabled={visible}
            target={[0, height / 2, 0]}
            minDistance={15}
            maxDistance={900}
            enableDamping
            dampingFactor={0.08}
          />
        </Canvas>
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-[#232832] bg-[#14171d]/90 px-2.5 py-1.5 font-mono text-[10px] font-medium text-[#9ca3af] shadow-sm backdrop-blur">
          Print bed · 250 × 250 mm
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-7.75rem)] truncate rounded-full border border-[#232832] bg-[#14171d]/90 px-3 py-1.5 text-[10px] font-medium text-[#9ca3af] shadow-sm backdrop-blur sm:left-1/2 sm:max-w-[min(28rem,calc(100%-16rem))] sm:-translate-x-1/2">
          Drag to orbit · Scroll to zoom · Right-drag to pan
        </div>
        <button
          type="button"
          onClick={() => setSpinning((current) => !current)}
          aria-pressed={spinning}
          className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-[#232832] bg-[#14171d]/90 px-3 py-1.5 text-[10px] font-semibold text-[#d7dde5] shadow-sm backdrop-blur transition hover:border-[#3b4654] hover:text-white"
        >
          {spinning ? (
            <Pause aria-hidden="true" className="size-3" />
          ) : (
            <Play aria-hidden="true" className="size-3" />
          )}
          {spinning ? "Stop spin" : "Spin"}
        </button>
      </div>
    </ViewerErrorBoundary>
  );
}
