"use client";

const DATABASE_NAME = "capture-create-creations";
const DATABASE_VERSION = 1;
const STORE_NAME = "models";
const TTL_DAYS = 7;
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
};

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
  await purgeExpiredCreations();
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
  await purgeExpiredCreations();
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
      ...input,
      createdAt,
      expiresAt: existing?.expiresAt ?? createdAt + TTL_DAYS * DAY_MS,
    };
    store.put(creation);
    await transactionDone(transaction);
    return creation;
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
}

export function getExpirationDays(expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
}
