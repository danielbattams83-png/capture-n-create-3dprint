"use client";

import { useEffect, useRef, useState } from "react";

const MINOR_TICK_PX = 10;
const MAJOR_TICK_INTERVAL = 5;

function PrecisionScaleRulers() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const updateSize = () => {
      const nextSize = {
        width: overlay.clientWidth,
        height: overlay.clientHeight,
      };
      setSize((current) =>
        current.width === nextSize.width && current.height === nextSize.height
          ? current
          : nextSize,
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(overlay);
    return () => observer.disconnect();
  }, []);

  const horizontalTicks = Array.from({
    length: Math.floor(size.width / MINOR_TICK_PX) + 1,
  });
  const verticalTicks = Array.from({
    length: Math.floor(size.height / MINOR_TICK_PX) + 1,
  });
  const labelStyle = {
    textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.9)",
  };

  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-xl border-l border-t border-white/25"
    >
      {horizontalTicks.map((_, index) => {
        const major = index % MAJOR_TICK_INTERVAL === 0;
        const position = index * MINOR_TICK_PX;
        return (
          <span
            key={`horizontal-${position}`}
            className={`absolute top-0 border-l border-white/70 ${
              major ? "h-3" : "h-1.5"
            }`}
            style={{ left: position }}
          >
            {major && (
              <span
                className="absolute left-0 top-3 rounded-sm bg-black/25 px-0.5 font-mono text-[9px] font-medium leading-3 text-white"
                style={{
                  ...labelStyle,
                  transform: index === 0 ? "translateX(2px)" : "translateX(-50%)",
                }}
              >
                {index / MAJOR_TICK_INTERVAL}
              </span>
            )}
          </span>
        );
      })}

      {verticalTicks.map((_, index) => {
        const major = index % MAJOR_TICK_INTERVAL === 0;
        const position = index * MINOR_TICK_PX;
        return (
          <span
            key={`vertical-${position}`}
            className={`absolute left-0 border-t border-white/70 ${
              major ? "w-3" : "w-1.5"
            }`}
            style={{ top: position }}
          >
            {major && index > 0 && (
              <span
                className="absolute left-3 top-0 rounded-sm bg-black/25 px-0.5 font-mono text-[9px] font-medium leading-3 text-white"
                style={{ ...labelStyle, transform: "translateY(-50%)" }}
              >
                {index / MAJOR_TICK_INTERVAL}
              </span>
            )}
          </span>
        );
      })}

      <span
        className="absolute right-2 top-2 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-white/90"
        style={labelStyle}
      >
        cm
      </span>
    </div>
  );
}

export default function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const nativeCameraRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    let cancelled = false;
    let stream: MediaStream | undefined;

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access is unavailable in this browser. Try your device camera or choose an existing photo.");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (cause) {
        stream?.getTracks().forEach((track) => track.stop());
        if (cancelled) return;
        const name = cause instanceof Error ? cause.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser, or use your device camera below. You can also close this window and choose an existing photo."
            : name === "NotFoundError"
              ? "No camera was found. Connect a camera, use your device camera below, or choose an existing photo."
              : cause instanceof Error && !navigator.mediaDevices?.getUserMedia
                ? cause.message
                : "Could not start the camera. It may be in use by another app. Try your device camera or choose an existing photo.",
        );
      }
    }

    void startCamera();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      dialog?.close();
    };
  }, []);

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight || capturing) return;
    setCapturing(true);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Could not take a photo. Try your device camera below.");
      setCapturing(false);
      return;
    }
    context.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!dialogRef.current?.open) return;
      if (!blob) {
        setError("Could not save the photo. Please try again.");
        setCapturing(false);
        return;
      }
      onCapture(new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" }));
      onClose();
    }, "image/jpeg", 0.92);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="camera-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-5 text-[#343731] shadow-xl backdrop:bg-black/60"
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id="camera-title" className="text-lg font-semibold">Take a photo</h2>
        <button type="button" onClick={onClose} className="rounded-lg border border-[#dfe2d9] px-3 py-2 text-sm font-semibold">Close camera</button>
      </div>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          onLoadedData={() => setReady(true)}
          className="size-full object-contain"
        />
        <PrecisionScaleRulers />
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-[#b34e3a]">{error}</p>
      ) : (
        <p role="status" className="mt-3 text-sm text-[#777b73]">{ready ? "Frame your object, then take a photo." : "Starting camera… Allow camera access when prompted."}</p>
      )}
      <button
        type="button"
        onClick={takePhoto}
        disabled={!ready || capturing || Boolean(error)}
        className="mt-4 w-full rounded-xl bg-[#29352b] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {capturing ? "Saving photo…" : "Capture photo"}
      </button>
      <input
        ref={nativeCameraRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        aria-label="Device camera photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            onCapture(file);
            onClose();
          }
        }}
      />
      <button type="button" onClick={() => {
        const stream = videoRef.current?.srcObject;
        if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
        setReady(false);
        setError("Live camera stopped. Use your device camera below, or close and reopen this window to restart the preview.");
        nativeCameraRef.current?.click();
      }} className="mt-2 w-full rounded-xl border border-[#dfe2d9] px-4 py-3 text-sm font-semibold">
        Use device camera instead
      </button>
      <p className="mt-2 text-xs text-[#777b73]">On supported phones this opens the camera app; other devices may show a file picker.</p>
    </dialog>
  );
}
