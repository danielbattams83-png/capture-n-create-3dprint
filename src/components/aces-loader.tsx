"use client";

import { useEffect, useRef } from "react";
import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  TorusGeometry,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Texture,
} from "three";

export const ACES_INTRO_DURATION_MS = 1200;

type AcesLoaderProps = {
  onComplete: () => void;
  onUnavailable: () => void;
};

function disposeMaterial(material: Material) {
  const textured = material as Material & Record<string, Texture | null | undefined>;
  for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"]) {
    textured[key]?.dispose();
  }
  material.dispose();
}

export default function AcesLoader({ onComplete, onUnavailable }: AcesLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onCompleteRef = useRef(onComplete);
  const onUnavailableRef = useRef(onUnavailable);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onUnavailableRef.current = onUnavailable;
  }, [onComplete, onUnavailable]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
      if (!renderer.getContext()) throw new Error("WebGL context unavailable");
    } catch (error) {
      console.error("AcesLoader could not start WebGL.", error);
      onUnavailableRef.current();
      return;
    }

    const scene = new Scene();
    const camera = new PerspectiveCamera(42, 1, 0.1, 30);
    camera.position.set(0, 0.35, 4.4);

    const geometries: BufferGeometry[] = [];
    const materials: Material[] = [];
    const textures: Texture[] = [];

    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 64;
    glowCanvas.height = 64;
    const glowContext = glowCanvas.getContext("2d");
    if (glowContext) {
      const gradient = glowContext.createRadialGradient(32, 32, 2, 32, 32, 32);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(1, "#1d4ed8");
      glowContext.fillStyle = gradient;
      glowContext.fillRect(0, 0, 64, 64);
    }
    const glowTexture = new CanvasTexture(glowCanvas);
    textures.push(glowTexture);

    const ringGeometry = new TorusGeometry(1.2, 0.028, 12, 72);
    const ringMaterial = new MeshStandardMaterial({
      color: "#93c5fd",
      emissive: "#1d4ed8",
      emissiveMap: glowTexture,
      emissiveIntensity: 0.65,
      metalness: 0.72,
      roughness: 0.22,
    });
    const ring = new Mesh(ringGeometry, ringMaterial);
    scene.add(ring);
    geometries.push(ringGeometry);
    materials.push(ringMaterial);

    const cubeGeometry = new BoxGeometry(0.24, 0.24, 0.24);
    geometries.push(cubeGeometry);
    const cubes = ["#f8fafc", "#93c5fd", "#60a5fa", "#dbeafe"].map((color) => {
      const material = new MeshStandardMaterial({
        color,
        metalness: 0.35,
        roughness: 0.28,
      });
      materials.push(material);
      const mesh = new Mesh(cubeGeometry, material);
      scene.add(mesh);
      return mesh;
    });

    scene.add(new AmbientLight("#e2e8f0", 0.55));
    const keyLight = new DirectionalLight("#60a5fa", 2.4);
    keyLight.position.set(2.2, 3.1, 4);
    scene.add(keyLight);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);

    let frame = 0;
    let disposed = false;
    const startedAt = performance.now();

    const resize = () => {
      const width = Math.max(parent.clientWidth, 1);
      const height = Math.max(parent.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);

    const tick = (now: number) => {
      if (disposed) return;
      const progress = Math.min(1, (now - startedAt) / ACES_INTRO_DURATION_MS);
      const ease = 1 - (1 - progress) ** 3;
      ring.rotation.x = 0.35 + ease * 0.9;
      ring.rotation.y = progress * Math.PI * 1.6;
      cubes.forEach((cube, index) => {
        const angle = progress * Math.PI * 2 + (index * Math.PI) / 2;
        const radius = 1.25 - ease * 0.28;
        cube.position.set(
          Math.cos(angle) * radius,
          Math.sin(progress * Math.PI * 2 + index) * 0.18,
          Math.sin(angle) * 0.42,
        );
        cube.rotation.x = angle * 0.6;
        cube.rotation.y = angle;
        cube.scale.setScalar(0.35 + ease * 0.7);
      });
      camera.position.z = 4.8 - ease * 0.9;
      renderer.render(scene, camera);
      if (progress >= 1) {
        onCompleteRef.current();
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => disposeMaterial(material));
      textures.forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, []);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}
