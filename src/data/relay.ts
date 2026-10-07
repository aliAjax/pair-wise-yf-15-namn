// 联网合并层。
// 无真实后端时，用同浏览器 localStorage 充当"服务端中继"：
// 多个标签页连同一中继即可验证断网编辑、联网合并与并发更新（LWW）。
import type { EntityDoc } from "../types";
import {
  bulkPut,
  entityStores,
  getAll,
  putDoc,
  storeFor,
  type StoreName,
} from "./db";

const RELAY_KEY = "forensic-entomo.relay.v1";
const CHANNEL = "forensic-entomo-chan";

interface RelayDoc {
  doc: EntityDoc;
}
type RelayState = Record<string, RelayDoc>; // 键: type/id

const relayKey = (doc: EntityDoc): string => `${doc.type}/${doc.id}`;

function readRelay(): RelayState {
  try {
    const raw = localStorage.getItem(RELAY_KEY);
    return raw ? (JSON.parse(raw) as RelayState) : {};
  } catch {
    return {};
  }
}

function writeRelay(state: RelayState): void {
  localStorage.setItem(RELAY_KEY, JSON.stringify(state));
}

let channel: BroadcastChannel | null = null;
function chan(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel(CHANNEL);
  return channel;
}

/** 定稿鉴定不可变：服务器同样拒收对其的覆盖（修订版是新 id，不受影响） */
export function isProtected(
  existing: EntityDoc | undefined,
  incoming: EntityDoc,
): boolean {
  if (incoming.type !== "identification") return false;
  if (existing && existing.type === "identification" && existing.status === "final") {
    return existing.updatedAt !== incoming.updatedAt;
  }
  return false;
}

export interface PushResult {
  accepted: number;
  rejected: number;
  reverted: EntityDoc[]; // 被服务器拒收、需回滚本地的文档
}

/** 推送一批本地变更到中继，返回被接受/拒收情况 */
export function pushToRelay(docs: EntityDoc[]): PushResult {
  const state = readRelay();
  const accepted: EntityDoc[] = [];
  let rejected = 0;
  const reverted: EntityDoc[] = [];
  for (const incoming of docs) {
    const key = relayKey(incoming);
    const existing = state[key]?.doc;
    if (isProtected(existing, incoming)) {
      rejected++;
      if (existing) reverted.push(existing);
      continue;
    }
    if (!existing || incoming.updatedAt >= existing.updatedAt) {
      state[key] = { doc: incoming };
      accepted.push(incoming);
    }
  }
  if (accepted.length > 0) writeRelay(state);
  chan()?.postMessage({ kind: "pushed", at: new Date().toISOString() });
  return { accepted: accepted.length, rejected, reverted };
}

/** 从中继拉取 updatedAt 严格更新的文档（LWW），回写本地 */
export async function pullFromRelay(
  since: string | null,
): Promise<{ merged: EntityDoc[]; latest: string }> {
  const state = readRelay();
  const localByStore = new Map<string, Map<string, EntityDoc>>();
  for (const name of entityStores()) {
    const all = await getAll<EntityDoc>(name);
    localByStore.set(name, new Map(all.map((d) => [d.id, d])));
  }

  const winners = new Map<string, EntityDoc[]>();
  const merged: EntityDoc[] = [];
  let latest = since ?? "";
  for (const { doc } of Object.values(state)) {
    if (doc.updatedAt > latest) latest = doc.updatedAt;
    if (since && doc.updatedAt <= since) continue;
    const name = storeFor(doc);
    const cur = localByStore.get(name)?.get(doc.id);
    if (!cur || doc.updatedAt >= cur.updatedAt) {
      const list = winners.get(name) ?? [];
      list.push(doc);
      winners.set(name, list);
      merged.push(doc);
    }
  }
  for (const [name, docs] of winners) {
    await bulkPut(name as StoreName, docs);
  }
  return { merged, latest };
}

/** 首次启动：把种子数据整体推送到中继 */
export async function seedRelay(docs: EntityDoc[]): Promise<void> {
  const state = readRelay();
  let changed = false;
  for (const doc of docs) {
    const key = relayKey(doc);
    const existing = state[key]?.doc;
    if (!existing || doc.updatedAt >= existing.updatedAt) {
      state[key] = { doc };
      changed = true;
    }
    await putDoc(storeFor(doc), doc);
  }
  if (changed) writeRelay(state);
  chan()?.postMessage({ kind: "seed", at: new Date().toISOString() });
}

export function onRelayPush(cb: () => void): () => void {
  const c = chan();
  if (!c) return () => {};
  const handler = (e: MessageEvent) => {
    if (e.data?.kind === "pushed" || e.data?.kind === "seed") cb();
  };
  c.addEventListener("message", handler);
  // 非 BroadcastChannel 环境下的兜底：storage 事件
  const storageHandler = (e: StorageEvent) => {
    if (e.key === RELAY_KEY) cb();
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    c.removeEventListener("message", handler);
    window.removeEventListener("storage", storageHandler);
  };
}

export function relayHasData(): boolean {
  return Object.keys(readRelay()).length > 0;
}
