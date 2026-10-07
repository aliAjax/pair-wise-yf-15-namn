// 数据层：离线优先（localStorage）、断网入队、联网合并、积温与断档计算
import { useSyncExternalStore } from "react";
import type {
  Batch,
  CaseRecord,
  EntityKind,
  Gap,
  Identification,
  OutboxItem,
  State,
  SyncReport,
  TempReading,
} from "./types";
import { buildSeed } from "./seed";
import { hashString, uid } from "./utils";

const STORAGE_KEY = "forent-sample-record-v1";

function loadInitial(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (parsed && Array.isArray(parsed.cases)) return parsed;
    }
  } catch {
    /* ignore */
  }
  return buildSeed();
}

let state: State = loadInitial();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full / unavailable */
  }
}

function setState(updater: (s: State) => State) {
  state = updater(state);
  persist();
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, () => state);
}

// ---------------------------------------------------------------------------
// 通用提交：在线立即同步；离线写入本地并入队，待联网合并
// ---------------------------------------------------------------------------
function commit<T extends { id: string; synced: boolean; updatedAt: number }>(
  kind: EntityKind,
  collection: "cases" | "batches" | "readings" | "identifications",
  entity: T,
  op: "upsert" | "delete"
) {
  setState((s) => {
    const synced = s.online;
    const next = { ...entity, synced, updatedAt: Date.now() };
    const list = s[collection] as unknown as T[];
    const idx = list.findIndex((x) => x.id === entity.id);
    let newList: T[];
    if (op === "delete") {
      newList = list.filter((x) => x.id !== entity.id);
    } else if (idx >= 0) {
      newList = list.map((x) => (x.id === entity.id ? next : x));
    } else {
      newList = [...list, next];
    }
    const outbox = synced
      ? s.outbox
      : [
          ...s.outbox,
          {
            id: uid("ob"),
            kind,
            op,
            entityId: entity.id,
            payload: next,
            createdAt: Date.now(),
          } satisfies OutboxItem,
        ];
    return { ...s, [collection]: newList, outbox };
  });
}

// ---- 案件 ----
export function saveCase(input: Partial<CaseRecord> & { id?: string }) {
  const now = Date.now();
  const entity: CaseRecord = {
    id: input.id ?? uid("case"),
    caseNo: input.caseNo ?? "",
    title: input.title ?? "",
    location: input.location ?? "",
    occurredAt: input.occurredAt ?? now,
    createdAt: input.createdAt ?? now,
    notes: input.notes ?? "",
    synced: state.online,
    updatedAt: now,
  };
  commit("case", "cases", entity, "upsert");
  return entity.id;
}

export function deleteCase(id: string) {
  const existing = state.cases.find((c) => c.id === id);
  if (existing) commit("case", "cases", existing, "delete");
  // 级联删除批次、读数、鉴定
  state.batches
    .filter((b) => b.caseId === id)
    .forEach((b) => {
      const ex = state.batches.find((x) => x.id === b.id);
      if (ex) commit("batch", "batches", ex, "delete");
    });
  state.readings
    .filter((r) => r.caseId === id)
    .forEach((r) => commit("reading", "readings", r, "delete"));
}

// ---- 批次 ----
export function saveBatch(input: Partial<Batch> & { id?: string; caseId: string }) {
  const now = Date.now();
  const entity: Batch = {
    id: input.id ?? uid("batch"),
    caseId: input.caseId,
    batchNo: input.batchNo ?? "",
    samplingPoint: input.samplingPoint ?? "",
    collectedAt: input.collectedAt ?? now,
    preservation: input.preservation ?? "乙醇保存",
    quantity: input.quantity ?? 1,
    notes: input.notes ?? "",
    createdAt: input.createdAt ?? now,
    synced: state.online,
    updatedAt: now,
  };
  commit("batch", "batches", entity, "upsert");
  return entity.id;
}

export function deleteBatch(id: string) {
  const existing = state.batches.find((b) => b.id === id);
  if (existing) commit("batch", "batches", existing, "delete");
}

// ---- 温度读数 ----
export function saveReading(input: Partial<TempReading> & { id?: string; caseId: string }) {
  const now = Date.now();
  const entity: TempReading = {
    id: input.id ?? uid("rd"),
    caseId: input.caseId,
    ts: input.ts ?? now,
    value: input.value ?? 0,
    source: input.source ?? "manual",
    synced: state.online,
    updatedAt: now,
  };
  commit("reading", "readings", entity, "upsert");
  return entity.id;
}

export function deleteReading(id: string) {
  const existing = state.readings.find((r) => r.id === id);
  if (existing) commit("reading", "readings", existing, "delete");
}

// ---- 鉴定结论 ----
export function saveIdentification(
  input: Partial<Identification> & { id: string; batchId: string }
) {
  const now = Date.now();
  const prev = state.identifications.find((i) => i.id === input.id);
  const entity: Identification = {
    id: input.id,
    batchId: input.batchId,
    stage: input.stage ?? prev?.stage ?? "",
    species: input.species ?? prev?.species ?? "",
    exposureStage: input.exposureStage ?? prev?.exposureStage ?? "",
    baseTemp: input.baseTemp ?? prev?.baseTemp ?? 10,
    addValue: input.addValue ?? prev?.addValue ?? 0,
    tempHash: input.tempHash ?? prev?.tempHash ?? "",
    finalized: prev?.finalized ?? false,
    finalizedAt: prev?.finalizedAt ?? null,
    finalizedBy: prev?.finalizedBy ?? "",
    notes: input.notes ?? prev?.notes ?? "",
    synced: state.online,
    updatedAt: now,
  };
  commit("identification", "identifications", entity, "upsert");
}

/** 定稿：锁定结论，写入积温快照与温度指纹；定稿后不可替换 */
export function finalizeIdentification(id: string, by: string) {
  const ident = state.identifications.find((i) => i.id === id);
  if (!ident) return;
  const batch = state.batches.find((b) => b.id === ident.batchId);
  if (!batch) return;
  const { addDays } = calcADD(state.readings, batch.caseId, ident.baseTemp);
  const hash = tempHashFor(state.readings, batch.caseId);
  const now = Date.now();
  const entity: Identification = {
    ...ident,
    addValue: Math.round(addDays * 10) / 10,
    tempHash: hash,
    finalized: true,
    finalizedAt: now,
    finalizedBy: by || "未署名",
    synced: state.online,
    updatedAt: now,
  };
  commit("identification", "identifications", entity, "upsert");
}

// ---------------------------------------------------------------------------
// 在线 / 离线
// ---------------------------------------------------------------------------
export function setOnline(online: boolean) {
  setState((s) => ({ ...s, online }));
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
}

/** 联网合并：把本地待同步变更并入服务端快照（去重、末位覆盖），并重排乱序读数 */
export function syncNow(): SyncReport {
  const report: SyncReport = { merged: 0, reordered: 0, gaps: 0, at: Date.now() };
  setState((s) => {
    report.merged = s.outbox.length;

    // 统计乱序：存储顺序中时间戳逆序的读数条数
    let reordered = 0;
    const byCase = new Map<string, TempReading[]>();
    for (const r of s.readings) {
      const arr = byCase.get(r.caseId) ?? [];
      arr.push(r);
      byCase.set(r.caseId, arr);
    }
    for (const arr of byCase.values()) {
      const stored = [...arr];
      for (let i = 1; i < stored.length; i++) {
        if (stored[i].ts < stored[i - 1].ts) reordered++;
      }
      report.gaps += findGaps(arr.map((r) => r), arr[0]?.caseId ?? "").length;
    }
    report.reordered = reordered;

    const mark = <T extends { synced: boolean }>(list: T[]): T[] =>
      list.map((x) => ({ ...x, synced: true }));

    return {
      ...s,
      cases: mark(s.cases),
      batches: mark(s.batches),
      readings: mark(s.readings),
      identifications: mark(s.identifications),
      outbox: [],
      online: true,
      lastSyncAt: report.at,
    };
  });
  return report;
}

// ---------------------------------------------------------------------------
// 选择器 / 计算
// ---------------------------------------------------------------------------
export function readingsForCase(readings: TempReading[], caseId: string): TempReading[] {
  return readings
    .filter((r) => r.caseId === caseId)
    .sort((a, b) => a.ts - b.ts);
}

export interface ADDResult {
  addDays: number; // ℃·日
  addHours: number; // ℃·时
  avgTemp: number;
  hours: number;
  points: number;
}

/** 积温：对温度记录做梯形积分（仅累计高于发育起点温度的部分），换算为 ℃·日 */
export function calcADD(
  readings: TempReading[],
  caseId: string,
  baseTemp: number
): ADDResult {
  const sorted = readingsForCase(readings, caseId);
  if (sorted.length < 2) {
    return {
      addDays: 0,
      addHours: 0,
      avgTemp: sorted[0]?.value ?? 0,
      hours: 0,
      points: sorted.length,
    };
  }
  let degHours = 0;
  let weighted = 0;
  let hours = 0;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const dt = (b.ts - a.ts) / 3600_000;
    const avg = (a.value + b.value) / 2;
    degHours += Math.max(avg - baseTemp, 0) * dt;
    weighted += avg * dt;
    hours += dt;
  }
  return {
    addHours: degHours,
    addDays: degHours / 24,
    avgTemp: weighted / hours,
    hours,
    points: sorted.length,
  };
}

/** 断档：相邻读数间隔超过阈值（3h 或 2 倍中位间隔）即视为断档 */
export function findGaps(readings: TempReading[], caseId: string): Gap[] {
  const sorted = readingsForCase(readings, caseId);
  if (sorted.length < 3) return [];
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push((sorted[i].ts - sorted[i - 1].ts) / 3600_000);
  }
  const med = [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
  const threshold = Math.max(3, med * 2);
  const gaps: Gap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const dt = (sorted[i].ts - sorted[i - 1].ts) / 3600_000;
    if (dt > threshold) {
      gaps.push({ startTs: sorted[i - 1].ts, endTs: sorted[i].ts, hours: dt });
    }
  }
  return gaps;
}

export function tempHashFor(readings: TempReading[], caseId: string): string {
  const s = readingsForCase(readings, caseId)
    .map((r) => `${r.ts}:${r.value}`)
    .join("|");
  return hashString(s);
}

/** 已定稿且温度指纹与定稿时不同 → 结论过时（定稿不可替换，但需提示重算） */
export function isOutdated(
  ident: Identification | undefined,
  readings: TempReading[],
  caseId: string
): boolean {
  if (!ident || !ident.finalized || !ident.tempHash) return false;
  return tempHashFor(readings, caseId) !== ident.tempHash;
}

export function identificationForBatch(
  identifications: Identification[],
  batchId: string
): Identification | undefined {
  return identifications.find((i) => i.id === batchId || i.batchId === batchId);
}

/** 重置全部数据（演示用） */
export function resetAll() {
  setState(() => buildSeed());
}
