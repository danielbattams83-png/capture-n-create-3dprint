"use client";

import { Component, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Box3, Vector3 } from "three";
import type { Group } from "three";
import { Box, ChevronLeft, ChevronRight, Download, Pencil } from "lucide-react";
import {
  getExpirationDays,
  listCreations,
  type StoredCreation,
} from "@/lib/creations-storage";

type CreationView = StoredCreation & { modelUrl: string };

type CreationsCarouselProps = {
  refreshKey: number;
  onEdit: (creation: StoredCreation) => void;
};

type ModelBoundaryProps = {
  children: ReactNode;
};

type ModelBoundaryState = {
  failed: boolean;
};

class ModelBoundary extends Component<ModelBoundaryProps, ModelBoundaryState> {
  state: ModelBoundaryState = { failed: false };

  static getDerivedStateFromError(): ModelBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex size-full items-center justify-center text-[#7d8794]">
          <Box aria-hidden="true" className="size-8" />
        </div>
      );
    }
    return this.props.children;
  }
}

function CarouselModel({
  modelUrl,
  animated,
}: {
  modelUrl: string;
  animated: boolean;
}) {
  const { scene } = useGLTF(modelUrl);
  const groupRef = useRef<Group>(null);
  const normalized = useMemo(() => {
    const object = scene.clone(true);
    const bounds = new Box3().setFromObject(object);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const largestDimension = Math.max(size.x, size.y, size.z, 0.001);
    return {
      object,
      offset: [-center.x, -center.y, -center.z] as [number, number, number],
      scale: 1.75 / largestDimension,
    };
  }, [scene]);

  useFrame(({ clock }, delta) => {
    if (!animated || !groupRef.current) return;
    groupRef.current.position.y = Math.sin(clock.elapsedTime * 1.25) * 0.1;
    groupRef.current.rotation.y += delta * 0.3;
  });

  return (
    <group ref={groupRef} scale={normalized.scale}>
      <primitive object={normalized.object} position={normalized.offset} />
    </group>
  );
}

function CreationViewport({
  modelUrl,
  animated,
}: {
  modelUrl: string;
  animated: boolean;
}) {
  return (
    <ModelBoundary>
      <Canvas
        frameloop={animated ? "always" : "demand"}
        dpr={animated ? [1, 1.5] : 1}
        camera={{ position: [0, 0.25, 3], fov: 42 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={1.4} />
        <directionalLight position={[3, 4, 3]} color="#60a5fa" intensity={2.4} />
        <directionalLight position={[-3, 2, -2]} color="#ffffff" intensity={1} />
        <Suspense
          fallback={
            <mesh>
              <boxGeometry args={[0.35, 0.35, 0.35]} />
              <meshStandardMaterial color="#3b82f6" wireframe />
            </mesh>
          }
        >
          <CarouselModel modelUrl={modelUrl} animated={animated} />
        </Suspense>
      </Canvas>
    </ModelBoundary>
  );
}

export default function CreationsCarousel({
  refreshKey,
  onEdit,
}: CreationsCarouselProps) {
  const [creations, setCreations] = useState<CreationView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const modelUrlsRef = useRef<string[]>([]);
  const loadedOnceRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!loadedOnceRef.current) setLoading(true);
      setError("");
      try {
        const storedCreations = await listCreations();
        if (cancelled) return;
        const modelUrls: string[] = [];
        const views = storedCreations.map((creation) => {
          const modelUrl = URL.createObjectURL(creation.model);
          modelUrls.push(modelUrl);
          return { ...creation, modelUrl };
        });
        const previousUrls = modelUrlsRef.current;
        modelUrlsRef.current = modelUrls;
        setCreations(views);
        setActiveId((current) =>
          current && views.some(({ id }) => id === current) ? current : views[0]?.id ?? null,
        );
        window.setTimeout(() => {
          previousUrls.forEach((url) => {
            useGLTF.clear(url);
            URL.revokeObjectURL(url);
          });
        }, 0);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Your local creations could not be loaded.",
          );
        }
      } finally {
        if (!cancelled) {
          loadedOnceRef.current = true;
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    return () => {
      const modelUrls = modelUrlsRef.current;
      window.setTimeout(() => {
        modelUrls.forEach((url) => {
          useGLTF.clear(url);
          URL.revokeObjectURL(url);
        });
      }, 0);
    };
  }, []);

  const activeIndex = creations.findIndex(({ id }) => id === activeId);
  const activeCreation = activeIndex >= 0 ? creations[activeIndex] : null;
  const activeExpiresIn = activeCreation
    ? getExpirationDays(activeCreation.expiresAt)
    : null;

  useEffect(() => {
    if (!activeId) return;
    cardRefs.current.get(activeId)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeId]);

  const move = (direction: -1 | 1) => {
    if (creations.length === 0) return;
    const nextIndex = Math.min(
      creations.length - 1,
      Math.max(0, (activeIndex < 0 ? 0 : activeIndex) + direction),
    );
    setActiveId(creations[nextIndex].id);
  };

  const renderSideCard = (creation: CreationView, index: number) => {
    const side = index < activeIndex ? -1 : 1;
    const expiresIn = getExpirationDays(creation.expiresAt);
    return (
      <div
        key={creation.id}
        ref={(element) => {
          if (element) cardRefs.current.set(creation.id, element);
          else cardRefs.current.delete(creation.id);
        }}
        role="button"
        tabIndex={0}
        aria-label={`View ${creation.name}`}
        className="relative h-60 w-44 shrink-0 cursor-pointer snap-center overflow-hidden rounded-2xl border border-[#2a323d] bg-[#14171d] opacity-65 shadow-2xl transition-all duration-500 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] sm:w-52"
        style={{
          transform: `perspective(900px) rotateY(${side * -18}deg) scale(0.9)`,
        }}
        onClick={() => setActiveId(creation.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setActiveId(creation.id);
          }
        }}
      >
        <div className="flex h-44 items-center justify-center bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.2),transparent_65%)]">
          <span className="flex size-16 items-center justify-center rounded-2xl border border-[#3b82f6]/25 bg-[#17243a] text-[#60a5fa] shadow-[0_0_28px_rgba(59,130,246,0.2)]">
            <Box aria-hidden="true" className="size-7" />
          </span>
        </div>
        <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/50 px-2.5 py-1 font-mono text-[9px] text-white shadow-sm backdrop-blur">
          {expiresIn === 0
            ? "Expires today"
            : `Expires in ${expiresIn} ${expiresIn === 1 ? "day" : "days"}`}
        </div>
        <div className="border-t border-[#232832] px-4 py-3">
          <p className="truncate text-sm font-semibold text-[#f3f4f6]">{creation.name}</p>
          <p className="mt-1 font-mono text-[9px] text-[#7d8794]">
            {creation.dimensions.width} × {creation.dimensions.depth} ×{" "}
            {creation.dimensions.height} MM
          </p>
        </div>
      </div>
    );
  };

  return (
    <section className="mt-10 overflow-hidden rounded-[22px] border border-[#e8e9e4] bg-white shadow-[0_8px_30px_rgba(27,31,24,0.035)]">
      <div className="flex items-center justify-between gap-4 border-b border-[#efefec] px-5 py-4 sm:px-7">
        <div>
          <h2 className="text-base font-semibold text-[#343731]">Creations</h2>
          <p className="mt-1 text-xs text-[#92958d]">
            Models are stored on this device for seven days.
          </p>
        </div>
        {creations.length > 1 && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => move(-1)}
              disabled={activeIndex <= 0}
              aria-label="Previous creation"
              className="flex size-9 items-center justify-center rounded-lg border border-[#dfe2d9] text-[#59634b] transition hover:bg-[#f8faf4] disabled:opacity-35"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              disabled={activeIndex >= creations.length - 1}
              aria-label="Next creation"
              className="flex size-9 items-center justify-center rounded-lg border border-[#dfe2d9] text-[#59634b] transition hover:bg-[#f8faf4] disabled:opacity-35"
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex min-h-72 items-center justify-center font-mono text-xs text-[#92958d]">
          Loading local creations…
        </div>
      ) : error ? (
        <div className="flex min-h-72 items-center justify-center px-6 text-center text-sm text-[#b34e3a]">
          {error}
        </div>
      ) : creations.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-[#17243a] text-[#60a5fa]">
            <Box aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-4 text-sm font-semibold text-[#505747]">No saved creations yet</p>
          <p className="mt-2 max-w-sm text-xs leading-5 text-[#92958d]">
            Generated GLB models will appear here automatically and remain available on this device for seven days.
          </p>
        </div>
      ) : (
        <div className="relative bg-[#0b0d10] px-4 py-7 sm:px-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.13),transparent_58%)]" />
          <div className="relative flex snap-x snap-mandatory items-center gap-5 overflow-x-auto px-[max(0px,calc(50%-14rem))] py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {creations.slice(0, Math.max(activeIndex, 0)).map(renderSideCard)}
            {activeCreation && (
              <div
                key="active-creation"
                ref={(element) => {
                  if (element) cardRefs.current.set(activeCreation.id, element);
                  else cardRefs.current.delete(activeCreation.id);
                }}
                className="relative h-[390px] w-[min(82vw,520px)] shrink-0 snap-center overflow-hidden rounded-2xl border border-[#3b82f6]/70 bg-[#14171d] shadow-2xl"
              >
                <div className="h-[285px]">
                  <CreationViewport modelUrl={activeCreation.modelUrl} animated />
                </div>
                <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/50 px-2.5 py-1 font-mono text-[9px] text-white shadow-sm backdrop-blur">
                  {activeExpiresIn === 0
                    ? "Expires today"
                    : `Expires in ${activeExpiresIn} ${
                        activeExpiresIn === 1 ? "day" : "days"
                      }`}
                </div>
                <div className="border-t border-[#232832] px-4 py-3">
                  <p className="truncate text-sm font-semibold text-[#f3f4f6]">
                    {activeCreation.name}
                  </p>
                  <p className="mt-1 font-mono text-[9px] text-[#7d8794]">
                    {activeCreation.dimensions.width} × {activeCreation.dimensions.depth} ×{" "}
                    {activeCreation.dimensions.height} MM
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(activeCreation)}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1d4ed8]"
                    >
                      <Pencil aria-hidden="true" className="size-3.5" />
                      Edit
                    </button>
                    <a
                      href={activeCreation.modelUrl}
                      download={`${activeCreation.name.replace(/[^a-z0-9-_]+/gi, "-")}.glb`}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#2f3946] px-3 py-2 text-xs font-semibold text-[#d7dde5] transition hover:bg-[#1b2029]"
                    >
                      <Download aria-hidden="true" className="size-3.5" />
                      Download
                    </a>
                  </div>
                </div>
              </div>
            )}
            {creations.slice(activeIndex + 1).map(renderSideCard)}
          </div>
          {activeCreation && (
            <p className="relative mt-1 text-center text-[10px] text-[#66717f]">
              Select a side model to bring it forward
            </p>
          )}
        </div>
      )}
    </section>
  );
}
