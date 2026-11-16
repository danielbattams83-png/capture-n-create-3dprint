"use client";

import Image from "next/image";
import { ExternalLink, LoaderCircle, Pencil, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ASSET_CATEGORIES,
  fetchKhronosAssets,
  type AssetCategory,
  type KhronosAsset,
} from "@/lib/khronos-assets";

type AssetBrowserProps = {
  onEdit: (asset: KhronosAsset) => Promise<void>;
};

export default function AssetBrowser({ onEdit }: AssetBrowserProps) {
  const [assets, setAssets] = useState<KhronosAsset[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"All" | AssetCategory>("All");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchKhronosAssets()
      .then((catalog) => {
        if (!cancelled) setAssets(catalog);
      })
      .catch((catalogError) => {
        if (!cancelled) {
          setError(
            catalogError instanceof Error
              ? catalogError.message
              : "The free 3D asset catalog could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return assets.filter(
      (asset) =>
        (category === "All" || asset.category === category) &&
        (!normalizedQuery ||
          asset.label.toLowerCase().includes(normalizedQuery) ||
          asset.category.toLowerCase().includes(normalizedQuery)),
    );
  }, [assets, category, query]);

  const editAsset = async (asset: KhronosAsset) => {
    setEditingId(asset.id);
    setError("");
    try {
      await onEdit(asset);
    } catch (editError) {
      setError(
        editError instanceof Error
          ? editError.message
          : "This model could not be opened in the editor.",
      );
    } finally {
      setEditingId(null);
    }
  };

  return (
    <section
      aria-labelledby="asset-library-title"
      className="w-full py-16"
    >
      <div className="overflow-hidden rounded-[28px] border border-[#e4e6e1] bg-[#f7f8f5] p-5 shadow-[0_28px_70px_rgba(25,31,38,0.08)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[#3975d7]">
              Free CC assets
            </p>
            <h2
              id="asset-library-title"
              className="text-3xl font-bold tracking-[-0.04em] text-[#17191c] sm:text-4xl"
            >
              Find a model to make your own
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#687078]">
              Browse downloadable Khronos sample models, then open one directly in
              the editor and save your version to Creations.
            </p>
          </div>
          <label className="flex h-12 w-full items-center gap-3 rounded-xl border border-[#dfe2dc] bg-white px-4 shadow-sm lg:max-w-sm">
            <Search aria-hidden="true" className="size-4 text-[#7f8790]" />
            <span className="sr-only">Search free 3D models</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models"
              className="min-w-0 flex-1 bg-transparent text-sm text-[#20242a] outline-none placeholder:text-[#9aa0a6]"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-2" aria-label="Model categories">
          {ASSET_CATEGORIES.map((option) => {
            const selected = category === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setCategory(option)}
                aria-pressed={selected}
                className={`rounded-full px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] transition ${
                  selected
                    ? "bg-[#17191c] text-white"
                    : "border border-[#dfe2dc] bg-white text-[#687078] hover:border-[#9ea4aa] hover:text-[#20242a]"
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-[#f0c7c7] bg-[#fff5f5] px-4 py-3 text-sm text-[#9d3030]"
          >
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex min-h-72 items-center justify-center">
            <LoaderCircle
              aria-label="Loading free 3D assets"
              className="size-6 animate-spin text-[#3975d7]"
            />
          </div>
        ) : filteredAssets.length > 0 ? (
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredAssets.map((asset) => {
              const editing = editingId === asset.id;
              return (
                <article
                  key={asset.id}
                  className="group overflow-hidden rounded-2xl border border-[#e2e4df] bg-white transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(30,35,41,0.1)]"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-[#eceeea]">
                    <Image
                      src={asset.thumbnailUrl}
                      alt={`${asset.label} 3D model preview`}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      className="object-cover transition duration-300 group-hover:scale-[1.025]"
                    />
                    <span className="absolute left-3 top-3 rounded-full bg-black/65 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-white backdrop-blur">
                      {asset.category}
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold tracking-[-0.02em] text-[#1b1e22]">
                        {asset.label}
                      </h3>
                      <a
                        href={asset.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View ${asset.label} source`}
                        className="rounded-md p-1 text-[#8a9198] transition hover:bg-[#f0f1ee] hover:text-[#3975d7]"
                      >
                        <ExternalLink aria-hidden="true" className="size-4" />
                      </a>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.06em] text-[#7b838b]">
                      <span>{asset.polyCount.toLocaleString()} triangles</span>
                      <span>{asset.license}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void editAsset(asset)}
                      disabled={editingId !== null}
                      className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#3975d7] text-sm font-semibold text-white transition hover:bg-[#2f65bd] disabled:cursor-wait disabled:opacity-55"
                    >
                      {editing ? (
                        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                      ) : (
                        <Pencil aria-hidden="true" className="size-4" />
                      )}
                      {editing ? "Opening model…" : "Edit Model"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-7 flex min-h-52 items-center justify-center rounded-2xl border border-dashed border-[#d6d9d3] bg-white/70 px-6 text-center text-sm text-[#737b83]">
            No models match that search.
          </div>
        )}

        <p className="mt-5 text-xs leading-5 text-[#858c93]">
          Models are provided by the Khronos glTF Sample Assets repository under
          the license shown on each card.
        </p>
      </div>
    </section>
  );
}
