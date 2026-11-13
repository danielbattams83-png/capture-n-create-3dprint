"use client";

import { Component, Suspense, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Box3, Vector3 } from "three";
import type { Group } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

export type ModelExportAction = () => void;

type ModelViewerProps = {
  modelUrl: string;
  width: number;
  depth: number;
  height: number;
  onExportReady: (exportModel: ModelExportAction | null) => void;
  onExportError: (message: string) => void;
};

type ViewerErrorBoundaryProps = {
  children: ReactNode;
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

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[340px] items-center justify-center px-6 text-center">
          <div>
            <p className="text-sm font-semibold text-[#505747]">Preview unavailable</p>
            <p className="mt-2 text-xs leading-5 text-[#898d84]">
              The model could not be displayed. You can still download the generated file below.
            </p>
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
}: ModelViewerProps) {
  const { scene } = useGLTF(modelUrl);
  const modelRef = useRef<Group>(null);
  const normalized = useMemo(() => {
    const object = scene.clone(true);
    const bounds = new Box3().setFromObject(object);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const safeSize = (value: number) => (value > 0 ? value : 1);

    return {
      object,
      offset: [-center.x, -bounds.min.y, -center.z] as [number, number, number],
      scale: [
        width / safeSize(size.x),
        height / safeSize(size.y),
        depth / safeSize(size.z),
      ] as [number, number, number],
    };
  }, [scene, width, depth, height]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;

    const exportModel = () => {
      try {
        model.updateWorldMatrix(true, true);
        const stlData = new STLExporter().parse(model, { binary: true });
        const blob = new Blob([stlData], { type: "model/stl" });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = `capture-create-model-${width}x${depth}x${height}mm.stl`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      } catch (error) {
        console.error("Could not export the scaled model as STL.", error);
        onExportError("Could not export the STL. Please try again.");
      }
    };

    onExportReady(exportModel);
    return () => onExportReady(null);
  }, [height, normalized, onExportError, onExportReady, width, depth]);

  return (
    <group ref={modelRef} scale={normalized.scale}>
      <primitive object={normalized.object} position={normalized.offset} />
    </group>
  );
}

function LoadingModel() {
  return (
    <Html center>
      <div className="whitespace-nowrap rounded-lg bg-white/90 px-3 py-2 text-xs font-medium text-[#68705e] shadow-sm">
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
}: ModelViewerProps) {
  return (
    <ViewerErrorBoundary key={modelUrl}>
      <div className="relative h-[360px] min-h-[340px] w-full overflow-hidden rounded-2xl bg-[#f7f8f4] sm:h-[420px]">
        <Canvas
          dpr={[1, 1.5]}
          camera={{ position: [230, 185, 230], fov: 40, near: 0.1, far: 2000 }}
          gl={{ antialias: true, alpha: false }}
        >
          <color attach="background" args={["#f7f8f4"]} />
          <ambientLight intensity={1.6} />
          <directionalLight position={[120, 200, 100]} intensity={2.2} />
          <directionalLight position={[-100, 100, -80]} intensity={0.8} />
          <Suspense fallback={<LoadingModel />}>
            <LoadedModel
              modelUrl={modelUrl}
              width={width}
              depth={depth}
              height={height}
              onExportReady={onExportReady}
              onExportError={onExportError}
            />
          </Suspense>
          <Grid
            args={[220, 220]}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.5, 0]}
            cellSize={10}
            sectionSize={50}
            cellColor="#cbd2c2"
            sectionColor="#aab69b"
            cellThickness={0.7}
            sectionThickness={1.2}
            fadeDistance={340}
            fadeStrength={0.8}
          />
          <OrbitControls
            makeDefault
            target={[0, height / 2, 0]}
            minDistance={15}
            maxDistance={900}
            enableDamping
            dampingFactor={0.08}
          />
        </Canvas>
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-[#e5e8df] bg-white/90 px-2.5 py-1.5 text-[10px] font-medium text-[#6e7564] shadow-sm backdrop-blur">
          Print bed · 220 × 220 mm
        </div>
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1.5 text-[10px] font-medium text-[#767b70] shadow-sm backdrop-blur">
          Drag to orbit · Scroll to zoom · Right-drag to pan
        </div>
      </div>
    </ViewerErrorBoundary>
  );
}
