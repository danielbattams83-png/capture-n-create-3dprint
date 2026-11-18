import "server-only";

import { ensureJobsSchema, getDatabasePool } from "@/lib/jobs";

export type CreationDimensions = {
  width: number;
  depth: number;
  height: number;
};

export type SavedCreation = {
  id: string;
  name: string;
  modelUrl: string;
  thumbnailUrl: string | null;
  dimensions: CreationDimensions;
  createdAt: string;
  updatedAt: string;
};

type CreationRow = {
  id: string;
  name: string;
  model_url: string;
  thumbnail_url: string | null;
  width: number;
  depth: number;
  height: number;
  created_at: Date | string;
  updated_at: Date | string;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapCreation(row: CreationRow): SavedCreation {
  return {
    id: row.id,
    name: row.name,
    modelUrl: row.model_url,
    thumbnailUrl: row.thumbnail_url,
    dimensions: {
      width: Number(row.width),
      depth: Number(row.depth),
      height: Number(row.height),
    },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function isOwnedCreationUrl(userId: string, value: string): boolean {
  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".public.blob.vercel-storage.com") &&
      path.startsWith(`creations/${userId}/`)
    );
  } catch {
    return false;
  }
}

export async function listSavedCreations(userId: string): Promise<SavedCreation[]> {
  await ensureJobsSchema();
  const result = await getDatabasePool().query<CreationRow>(
    `SELECT id, name, model_url, thumbnail_url, width, depth, height, created_at, updated_at
     FROM creations
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map(mapCreation);
}

export async function upsertSavedCreation(input: {
  userId: string;
  id: string;
  name: string;
  modelUrl: string;
  thumbnailUrl: string | null;
  dimensions: CreationDimensions;
}): Promise<SavedCreation> {
  await ensureJobsSchema();
  const result = await getDatabasePool().query<CreationRow>(
    `INSERT INTO creations (
       id, user_id, name, model_url, thumbnail_url, width, depth, height
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           model_url = EXCLUDED.model_url,
           thumbnail_url = EXCLUDED.thumbnail_url,
           width = EXCLUDED.width,
           depth = EXCLUDED.depth,
           height = EXCLUDED.height,
           updated_at = NOW()
       WHERE creations.user_id = EXCLUDED.user_id
     RETURNING id, name, model_url, thumbnail_url, width, depth, height, created_at, updated_at`,
    [
      input.id,
      input.userId,
      input.name,
      input.modelUrl,
      input.thumbnailUrl,
      input.dimensions.width,
      input.dimensions.depth,
      input.dimensions.height,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("The creation could not be saved for this session.");
  return mapCreation(row);
}

export async function updateSavedCreationDimensions(
  userId: string,
  id: string,
  dimensions: CreationDimensions,
): Promise<boolean> {
  await ensureJobsSchema();
  const result = await getDatabasePool().query(
    `UPDATE creations
     SET width = $3, depth = $4, height = $5, updated_at = NOW()
     WHERE user_id = $1 AND id = $2`,
    [userId, id, dimensions.width, dimensions.depth, dimensions.height],
  );
  return (result.rowCount ?? 0) > 0;
}
