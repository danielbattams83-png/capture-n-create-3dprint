"use client";

import { useReducedMotion } from "framer-motion";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import AcesLoader from "@/components/aces-loader";

const INTRO_STORAGE_KEY = "aces-intro-played";
const STATIC_FALLBACK_MS = 700;

type IntroMode = "pending" | "scene" | "static" | "done";

function markIntroPlayed() {
  try {
    window.sessionStorage.setItem(INTRO_STORAGE_KEY, "1");
  } catch (error) {
    console.error("Could not remember the studio intro.", error);
  }
}

export default function AppLoadingScreen() {
  const reduceMotion = useReducedMotion();
  const [mode, setMode] = useState<IntroMode>("pending");

  const finish = useCallback(() => {
    markIntroPlayed();
    setMode("done");
  }, []);

  const useStaticFallback = useCallback(() => {
    setMode((current) => (current === "done" ? current : "static"));
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;
    let alreadyPlayed = false;
    try {
      alreadyPlayed = window.sessionStorage.getItem(INTRO_STORAGE_KEY) === "1";
    } catch {
      alreadyPlayed = false;
    }
    if (alreadyPlayed) {
      setMode("done");
      return;
    }
    setMode(reduceMotion ? "static" : "scene");
  }, [reduceMotion]);

  useEffect(() => {
    if (mode !== "static") return;
    const timeout = window.setTimeout(finish, STATIC_FALLBACK_MS);
    return () => window.clearTimeout(timeout);
  }, [finish, mode]);

  if (mode === "pending" || mode === "done") return null;

  return (
    <div
      role="status"
      aria-label="Loading A.C.E.S. 3D Print Studio"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#07090D]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(59,130,246,0.14),transparent_48%)]" />
      <div className="relative h-[min(52vh,420px)] w-[min(92vw,640px)]">
        {mode === "scene" ? (
          <AcesLoader onComplete={finish} onUnavailable={useStaticFallback} />
        ) : (
          <Image
            src="/A.C.E.S. 3D Print Studio.png"
            alt=""
            width={2197}
            height={1431}
            priority
            className="h-full w-full object-contain"
          />
        )}
      </div>
      <button
        type="button"
        onClick={finish}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium tracking-wide text-slate-400 transition hover:border-white/20 hover:text-slate-200"
      >
        Skip
      </button>
    </div>
  );
}
