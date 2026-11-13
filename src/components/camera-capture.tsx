"use client";

import { useEffect, useRef, useState } from "react";

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
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        onLoadedData={() => setReady(true)}
        className="aspect-[4/3] w-full rounded-xl bg-black object-contain"
      />
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
