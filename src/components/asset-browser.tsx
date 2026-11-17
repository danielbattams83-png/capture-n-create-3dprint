"use client";

import Image from "next/image";
import { ExternalLink, LoaderCircle, Pencil, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
    <section aria-labelledby="asset-library-title" className="w-full py-16">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[#60a5fa]">
            Free model gallery
          </p>
          <h2
            id="asset-library-title"
            className="text-3xl font-bold tracking-[-0.04em] text-white sm:text-4xl"
          >
            Find a model to make your own
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#aeb8c4]">
            Browse downloadable Khronos sample models. Expand a card for details
            or load it directly into the editor.
          </p>
        </div>
        <label className="flex h-12 w-full items-center gap-3 rounded-xl border border-white/[0.1] bg-[#182028] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] lg:max-w-sm">
          <Search aria-hidden="true" className="size-4 text-[#94a3b8]" />
          <span className="sr-only">Search free 3D models</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search models"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#64748b]"
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
              className={`rounded-full border px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] transition ${
                selected
                  ? "border-[#60a5fa]/55 bg-[#1d2d48] text-[#bfdbfe]"
                  : "border-white/[0.08] bg-[#182028] text-[#94a3b8] hover:border-white/[0.16] hover:text-white"
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
          className="mt-5 rounded-xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-[#fda4af]"
        >
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex min-h-72 items-center justify-center">
          <LoaderCircle
            aria-label="Loading free 3D assets"
            className="size-6 animate-spin text-[#60a5fa]"
          />
        </div>
      ) : filteredAssets.length > 0 ? (
        <div className="asset-bento mt-7">
          {filteredAssets.map((asset, index) => {
            const editing = editingId === asset.id;
            const expanded = expandedId === asset.id;
            return (
              <article
                key={asset.id}
                className="asset-bento-card"
                style={{ "--span": index % 5 === 0 ? 2 : 1 } as CSSProperties}
                data-expanded={expanded ? "true" : undefined}
                tabIndex={0}
                onClick={() => setExpandedId(expanded ? null : asset.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setExpandedId(expanded ? null : asset.id);
                  }
                }}
                onPointerMove={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  event.currentTarget.style.setProperty(
                    "--x",
                    `${event.clientX - bounds.left}px`,
                  );
                  event.currentTarget.style.setProperty(
                    "--y",
                    `${event.clientY - bounds.top}px`,
                  );
                }}
              >
                <div className="asset-bento-inner">
                  <div className="asset-bento-media">
                    <Image
                      src={asset.thumbnailUrl}
                      alt={`${asset.label} 3D model preview`}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 34vw"
                      className="object-cover"
                    />
                  </div>
                  <span className="asset-bento-hint" aria-hidden="true">
                    <Plus className="size-4" />
                  </span>
                  <div className="asset-bento-body">
                    <span className="asset-bento-tag">{asset.category}</span>
                    <div className="flex items-center gap-3">
                      <h3 className="asset-bento-heading">{asset.label}</h3>
                      <a
                        href={asset.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`View ${asset.label} source`}
                        className="ml-auto rounded-full border border-white/[0.14] bg-black/30 p-2 text-[#d7dde5] backdrop-blur transition hover:bg-black/50"
                      >
                        <ExternalLink aria-hidden="true" className="size-4" />
                      </a>
                    </div>
                    <p className="asset-bento-text">
                      {asset.polyCount.toLocaleString()} triangles · {asset.license}
                    </p>
                    <div className="asset-bento-detail">
                      <div>
                        <p>
                          Downloadable GLB ready to resize, texture, and save to
                          your local Collection.
                        </p>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void editAsset(asset);
                          }}
                          disabled={editingId !== null}
                          className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#60a5fa] px-5 text-sm font-bold text-[#071c29] shadow-[0_6px_16px_rgba(96,165,250,0.18)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55"
                        >
                          {editing ? (
                            <LoaderCircle
                              aria-hidden="true"
                              className="size-4 animate-spin"
                            />
                          ) : (
                            <Pencil aria-hidden="true" className="size-4" />
                          )}
                          {editing ? "Opening model…" : "Edit / Load Model"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-7 flex min-h-52 items-center justify-center rounded-[22px] border border-dashed border-white/[0.12] bg-[#182028] px-6 text-center text-sm text-[#94a3b8]">
          No models match that search.
        </div>
      )}

      <p className="mt-5 text-xs leading-5 text-[#7d8794]">
        Models are provided by the Khronos glTF Sample Assets repository under
        the license shown on each card.
      </p>
    </section>
  );
}
