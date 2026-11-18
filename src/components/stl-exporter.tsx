"use client";

import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { Object3D } from "three";

export function downloadObjectAsStl(object: Object3D, filename: string) {
  const stlData = new STLExporter().parse(object, { binary: true });
  const blob = new Blob([stlData], { type: "model/stl" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

export default function StlExporter({
  disabled = false,
  onExport,
}: {
  disabled?: boolean;
  onExport: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExport}
      disabled={disabled}
      className="rounded-lg border border-white/[0.1] px-3 py-2 text-xs font-semibold text-[#d7dde5] hover:bg-[#1e242b] disabled:opacity-45"
    >
      Print-ready STL
    </button>
  );
}
