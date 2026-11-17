"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import AssetBrowser from "@/components/asset-browser";
import type { StoredCreation } from "@/lib/creations-storage";
import type { KhronosAsset } from "@/lib/khronos-assets";

const CreationsCarousel = dynamic(() => import("@/components/creations-carousel"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-96 items-center justify-center rounded-[22px] border border-white/[0.08] bg-[#182028] font-mono text-xs text-[#94a3b8]">
      Loading your Collections…
    </div>
  ),
});

export default function AssetsWorkspace() {
  const router = useRouter();

  const editCreation = (creation: StoredCreation) => {
    router.push(`/create-model?creation=${encodeURIComponent(creation.id)}`);
  };

  const editCatalogAsset = async (asset: KhronosAsset) => {
    router.push(`/create-model?asset=${encodeURIComponent(asset.id)}`);
  };

  return (
    <main className="min-h-screen bg-[#0b0d10] px-5 pb-20 pt-10 text-white sm:px-8 sm:pt-14">
      <div className="mx-auto max-w-7xl">
        <header className="max-w-3xl">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#60a5fa]">
            Assets
          </p>
          <h1 className="mt-3 text-[clamp(2.5rem,6vw,4.75rem)] font-bold leading-[0.98] tracking-[-0.055em]">
            Your models, ready to move.
          </h1>
          <p className="mt-5 text-base leading-7 text-[#aeb8c4] sm:text-lg">
            Bring a saved creation forward or choose a free CC-licensed model as
            the starting point for your next edit.
          </p>
        </header>

        <div className="mt-10">
          <CreationsCarousel refreshKey={0} onEdit={editCreation} />
        </div>

        <AssetBrowser onEdit={editCatalogAsset} />
      </div>
    </main>
  );
}
