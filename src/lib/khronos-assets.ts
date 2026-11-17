"use client";

export type AssetCategory = "Props" | "Furniture" | "Nature" | "Characters";

export type KhronosAsset = {
  id: string;
  label: string;
  category: AssetCategory;
  polyCount: number;
  license: "CC0 1.0" | "CC BY 4.0";
  thumbnailUrl: string;
  modelUrl: string;
  sourceUrl: string;
};

type ModelIndexEntry = {
  label: string;
  name: string;
  screenshot?: string;
  variants?: Record<string, string>;
};

type CuratedAsset = {
  name: string;
  category: AssetCategory;
  polyCount: number;
  license: KhronosAsset["license"];
};

const REPOSITORY_BASE =
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main";
const MODEL_INDEX_URL = `${REPOSITORY_BASE}/Models/model-index.json`;

const CURATED_ASSETS: CuratedAsset[] = [
  { name: "AntiqueCamera", category: "Props", polyCount: 20066, license: "CC0 1.0" },
  { name: "BoomBox", category: "Props", polyCount: 6036, license: "CC0 1.0" },
  { name: "ChronographWatch", category: "Props", polyCount: 100002, license: "CC BY 4.0" },
  { name: "Lantern", category: "Props", polyCount: 5394, license: "CC0 1.0" },
  { name: "ToyCar", category: "Props", polyCount: 108936, license: "CC0 1.0" },
  { name: "TrafficCone", category: "Props", polyCount: 17224, license: "CC BY 4.0" },
  { name: "WaterBottle", category: "Props", polyCount: 4510, license: "CC0 1.0" },
  { name: "MaterialsVariantsShoe", category: "Props", polyCount: 22700, license: "CC BY 4.0" },
  { name: "ChairDamaskPurplegold", category: "Furniture", polyCount: 9984, license: "CC BY 4.0" },
  { name: "GlamVelvetSofa", category: "Furniture", polyCount: 4196, license: "CC BY 4.0" },
  { name: "SheenChair", category: "Furniture", polyCount: 39936, license: "CC0 1.0" },
  { name: "SheenWoodLeatherSofa", category: "Furniture", polyCount: 46492, license: "CC BY 4.0" },
  { name: "SpecularSilkPouf", category: "Furniture", polyCount: 81280, license: "CC BY 4.0" },
  { name: "Avocado", category: "Nature", polyCount: 682, license: "CC0 1.0" },
  { name: "BarramundiFish", category: "Nature", polyCount: 3864, license: "CC0 1.0" },
  { name: "ScatterPlant", category: "Nature", polyCount: 54491, license: "CC BY 4.0" },
  { name: "DiffuseTransmissionPlant", category: "Nature", polyCount: 68409, license: "CC BY 4.0" },
  { name: "GlassVaseFlowers", category: "Nature", polyCount: 10218, license: "CC0 1.0" },
  { name: "CesiumMan", category: "Characters", polyCount: 4672, license: "CC BY 4.0" },
  { name: "Fox", category: "Characters", polyCount: 576, license: "CC BY 4.0" },
  { name: "RiggedFigure", category: "Characters", polyCount: 256, license: "CC BY 4.0" },
];

export const ASSET_CATEGORIES: ("All" | AssetCategory)[] = [
  "All",
  "Props",
  "Furniture",
  "Nature",
  "Characters",
];

export async function fetchKhronosAssets(): Promise<KhronosAsset[]> {
  const response = await fetch(MODEL_INDEX_URL);
  if (!response.ok) {
    throw new Error("The free 3D asset catalog is temporarily unavailable.");
  }
  const index = (await response.json()) as ModelIndexEntry[];
  const entries = new Map(index.map((entry) => [entry.name, entry]));

  return CURATED_ASSETS.flatMap((curated) => {
    const entry = entries.get(curated.name);
    const glbFile = entry?.variants?.["glTF-Binary"];
    if (!entry || !entry.screenshot || !glbFile) return [];
    const modelDirectory = `${REPOSITORY_BASE}/Models/${entry.name}`;
    return [
      {
        id: entry.name,
        label: entry.label,
        category: curated.category,
        polyCount: curated.polyCount,
        license: curated.license,
        thumbnailUrl: `${modelDirectory}/${entry.screenshot}`,
        modelUrl: `${modelDirectory}/glTF-Binary/${glbFile}`,
        sourceUrl: `https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/${entry.name}`,
      },
    ];
  });
}
