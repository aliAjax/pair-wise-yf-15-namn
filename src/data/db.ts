// IndexedDB 极简封装：单据库 + 发件箱 + 照片 + 键值元信息。
import type { EntityDoc, ID, OutboxOp, PhotoRec } from "../types";

const DB_NAME = "forensic-entomo";
const DB_VERSION = 1;
export const STORE = {
  cases: "cases",
  points: "points",
  batches: "batches",
  readings: "readings",
  identifications: "identifications",
  species: "species",
  settings: "settings",
  outbox: "outbox",
  photos: "photos",
  meta: "meta",
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];
const ENTITY_STORES: StoreName[] = [
  STORE.cases,
  STORE.points,
  STORE.batches,
  STORE.readings,
  STORE.identifications,
  STORE.species,
  STORE.settings,
];
export const entityStores = (): StoreName[] => [...ENTITY_STORES];

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ENTITY_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
      if (!db.objectStoreNames.contains(STORE.outbox)) {
        db.createObjectStore(STORE.outbox, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE.photos)) {
        db.createObjectStore(STORE.photos);
      }
      if (!db.objectStoreNames.contains(STORE.meta)) {
        db.createObjectStore(STORE.meta);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= openDB();
  return dbPromise;
}

export function storeFor(doc: { type: string }): StoreName {
  switch (doc.type) {
    case "case": return STORE.cases;
    case "point": return STORE.points;
    case "batch": return STORE.batches;
    case "reading": return STORE.readings;
    case "identification": return STORE.identifications;
    case "species": return STORE.species;
    case "settings": return STORE.settings;
    default: throw new Error(`未知单据类型: ${doc.type}`);
  }
}

function tx<T>(
  names: StoreName | StoreName[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const list = Array.isArray(names) ? names : [names];
  return db().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const t = database.transaction(list, mode);
        let req: IDBRequest<T> | Promise<T>;
        try {
          req = fn(t);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = () => {
          if (req instanceof Promise) req.then(resolve, reject);
          else resolve(req.result);
        };
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function getDoc<T = EntityDoc>(
  name: StoreName,
  id: ID,
): Promise<T | undefined> {
  return tx(name, "readonly", (t) => t.objectStore(name).get(id) as IDBRequest<T>);
}

export async function getAll<T = EntityDoc>(name: StoreName): Promise<T[]> {
  return tx(name, "readonly", (t) =>
    t.objectStore(name).getAll() as IDBRequest<T[]>);
}

export async function putDoc<T extends EntityDoc>(
  name: StoreName,
  doc: T,
): Promise<void> {
  await tx(name, "readwrite", (t) => t.objectStore(name).put(doc, doc.id));
}

export async function bulkPut<T extends EntityDoc>(
  name: StoreName,
  docs: T[],
): Promise<void> {
  if (docs.length === 0) return;
  await tx(name, "readwrite", (t) => {
    const store = t.objectStore(name);
    for (const d of docs) store.put(d, d.id);
    return Promise.resolve();
  });
}

export async function putOp(op: OutboxOp): Promise<void> {
  await tx(STORE.outbox, "readwrite", (t) => t.objectStore(STORE.outbox).put(op));
}

export async function deleteOp(id: ID): Promise<void> {
  await tx(STORE.outbox, "readwrite", (t) => t.objectStore(STORE.outbox).delete(id));
}

export function allOps(): Promise<OutboxOp[]> {
  return getAll<OutboxOp>(STORE.outbox);
}

export async function putPhoto(p: PhotoRec): Promise<void> {
  await tx(STORE.photos, "readwrite", (t) =>
    t.objectStore(STORE.photos).put(p, p.key));
}

export function getPhoto(key: string): Promise<PhotoRec | undefined> {
  return getDoc<PhotoRec>(STORE.photos, key);
}

export async function putMeta(key: string, value: unknown): Promise<void> {
  await tx(STORE.meta, "readwrite", (t) =>
    t.objectStore(STORE.meta).put(value, key));
}

export function getMeta<T>(key: string): Promise<T | undefined> {
  return getDoc<T>(STORE.meta, key);
}

export async function clearAll(): Promise<void> {
  const database = await db();
  await Promise.all(
    [...database.objectStoreNames].map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const t = database.transaction(name, "readwrite");
          t.objectStore(name).clear();
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        }),
    ),
  );
}
