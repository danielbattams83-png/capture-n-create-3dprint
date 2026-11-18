"use client";

const DATABASE_NAME = "capture-create-creations";
const DATABASE_VERSION = 1;
const STORE_NAME = "models";
const DAY_MS = 24 * 60 * 60 * 1000;

export type CreationDimensions = {
  width: number;
  depth: number;
  height: number;
};

export type StoredCreation = {
  id: string;
  name: string;
  model: Blob;
  createdAt: number;
  expiresAt: number;
  dimensions: CreationDimensions;
  remoteModelUrl?: string;
  thumbnailUrl?: string;
};

const DURABLE_TTL_MS = 100 * 365 * DAY_MS;

export function createCreationId(prefix = "creation"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("expiresAt", "expiresAt");
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("The local creations database could not be opened."));
  });
}

export async function purgeExpiredCreations(now = Date.now()): Promise<number> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const index = transaction.objectStore(STORE_NAME).index("expiresAt");
    const request = index.openCursor(IDBKeyRange.upperBound(now));
    let removed = 0;

    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        removed += 1;
        cursor.continue();
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Expired creations could not be purged."));
    });
    await transactionDone(transaction);
    return removed;
  } finally {
    database.close();
  }
}

export async function listCreations(): Promise<StoredCreation[]> {
  const local = await listLocalCreations();
  const remote = await fetchRemoteCreations();
  if (!remote) return local;

  const cached = new Map(local.map((creation) => [creation.id, creation]));
  const merged: StoredCreation[] = [];
  for (const item of remote) {
    const existing = cached.get(item.id);
    cached.delete(item.id);
    if (existing?.model && existing.model.size > 0) {
      const creation = {
        ...existing,
        name: item.name,
        dimensions: item.dimensions,
        remoteModelUrl: item.modelUrl,
        thumbnailUrl: item.thumbnailUrl ?? undefined,
        expiresAt: existing.createdAt + DURABLE_TTL_MS,
      };
      await saveLocalCreation(creation);
      merged.push(creation);
      continue;
    }
    try {
      const response = await fetch(item.modelUrl);
      if (!response.ok) continue;
      const model = await response.blob();
      const createdAt = Date.parse(item.createdAt);
      const creation: StoredCreation = {
        id: item.id,
        name: item.name,
        model,
        createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
        expiresAt: (Number.isFinite(createdAt) ? createdAt : Date.now()) + DURABLE_TTL_MS,
        dimensions: item.dimensions,
        remoteModelUrl: item.modelUrl,
        thumbnailUrl: item.thumbnailUrl ?? undefined,
      };
      await saveLocalCreation(creation);
      merged.push(creation);
    } catch (error) {
      console.error("Could not cache a saved creation.", error);
    }
  }
  merged.push(...cached.values());
  return merged.sort((left, right) => right.createdAt - left.createdAt);
}

async function listLocalCreations(): Promise<StoredCreation[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    const creations = await requestResult(request);
    await transactionDone(transaction);
    return creations.sort((left, right) => right.createdAt - left.createdAt);
  } finally {
    database.close();
  }
}

export async function getCreation(id: string): Promise<StoredCreation | undefined> {
  const local = await getLocalCreation(id);
  if (local?.model && local.model.size > 0) return local;
  const remote = await fetchRemoteCreations();
  const match = remote?.find((creation) => creation.id === id);
  if (!match) return local;
  const response = await fetch(match.modelUrl);
  if (!response.ok) return local;
  const createdAt = Date.parse(match.createdAt);
  const creation: StoredCreation = {
    id: match.id,
    name: match.name,
    model: await response.blob(),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    expiresAt: (Number.isFinite(createdAt) ? createdAt : Date.now()) + DURABLE_TTL_MS,
    dimensions: match.dimensions,
    remoteModelUrl: match.modelUrl,
    thumbnailUrl: match.thumbnailUrl ?? undefined,
  };
  await saveLocalCreation(creation);
  return creation;
}

async function getLocalCreation(id: string): Promise<StoredCreation | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(id);
    const creation = await requestResult(
      request as IDBRequest<StoredCreation | undefined>,
    );
    await transactionDone(transaction);
    return creation;
  } finally {
    database.close();
  }
}

export async function saveCreation(input: {
  id: string;
  name: string;
  model: Blob;
  dimensions: CreationDimensions;
}): Promise<StoredCreation> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const existing = await requestResult(
      store.get(input.id) as IDBRequest<StoredCreation | undefined>,
    );
    const createdAt = existing?.createdAt ?? Date.now();
    const creation: StoredCreation = {
      ...existing,
      ...input,
      createdAt,
      expiresAt: createdAt + DURABLE_TTL_MS,
      remoteModelUrl: existing?.remoteModelUrl,
      thumbnailUrl: existing?.thumbnailUrl,
    };
    store.put(creation);
    await transactionDone(transaction);
    return (await syncCreation(creation)) ?? creation;
  } finally {
    database.close();
  }
}

async function saveLocalCreation(creation: StoredCreation): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(creation);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function updateCreationDimensions(
  id: string,
  dimensions: CreationDimensions,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const creation = await requestResult(
      store.get(id) as IDBRequest<StoredCreation | undefined>,
    );
    if (creation) store.put({ ...creation, dimensions });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
  try {
    await fetch("/api/creations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, dimensions }),
    });
  } catch (error) {
    console.error("Could not sync creation dimensions.", error);
  }
}

type RemoteCreation = {
  id: string;
  name: string;
  modelUrl: string;
  thumbnailUrl: string | null;
  dimensions: CreationDimensions;
  createdAt: string;
};

async function fetchRemoteCreations(): Promise<RemoteCreation[] | null> {
  try {
    const response = await fetch("/api/creations", { cache: "no-store" });
    if (!response.ok) return null;
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("creations" in result) ||
      !Array.isArray(result.creations)
    ) {
      return null;
    }
    return result.creations.filter((item): item is RemoteCreation => {
      if (typeof item !== "object" || item === null) return false;
      const creation = item as Partial<RemoteCreation>;
      return (
        typeof creation.id === "string" &&
        typeof creation.name === "string" &&
        typeof creation.modelUrl === "string" &&
        typeof creation.createdAt === "string" &&
        typeof creation.dimensions === "object" &&
        creation.dimensions !== null
      );
    });
  } catch (error) {
    console.error("Could not load saved creations.", error);
    return null;
  }
}

async function createLabelThumbnail(creation: StoredCreation): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A creation thumbnail could not be created.");
  context.fillStyle = "#11171d";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#60a5fa";
  context.font = "600 22px sans-serif";
  context.fillText(creation.name.slice(0, 28), 24, 120);
  context.fillStyle = "#94a3b8";
  context.font = "14px monospace";
  context.fillText(
    `${creation.dimensions.width} × ${creation.dimensions.depth} × ${creation.dimensions.height} mm`,
    24,
    152,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("A creation thumbnail could not be encoded."));
    }, "image/png");
  });
}

async function syncCreation(creation: StoredCreation): Promise<StoredCreation | null> {
  try {
    const { uploadTemporaryFiles } = await import("@/lib/client-blob-upload");
    const thumbnail = await createLabelThumbnail(creation);
    const uploaded = await uploadTemporaryFiles({
      kind: "creation",
      files: [
        new File([creation.model], `${creation.id}.glb`, { type: "model/gltf-binary" }),
        new File([thumbnail], `${creation.id}.png`, { type: "image/png" }),
      ],
      signal: AbortSignal.timeout(120_000),
    });
    const response = await fetch("/api/creations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: creation.id,
        name: creation.name,
        modelUrl: uploaded.urls[0],
        thumbnailUrl: uploaded.urls[1] ?? null,
        dimensions: creation.dimensions,
      }),
    });
    if (!response.ok) return null;
    const synced: StoredCreation = {
      ...creation,
      remoteModelUrl: uploaded.urls[0],
      thumbnailUrl: uploaded.urls[1],
    };
    await saveLocalCreation(synced);
    return synced;
  } catch (error) {
    console.error("Could not sync the creation.", error);
    return null;
  }
}

export function getExpirationDays(expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
}

export function creationExpiryLabel(expiresAt: number, now = Date.now()): string {
  if (expiresAt - now > 365 * DAY_MS) return "Saved";
  const days = getExpirationDays(expiresAt, now);
  if (days === 0) return "Expires today";
  return `Expires in ${days} ${days === 1 ? "day" : "days"}`;
}
