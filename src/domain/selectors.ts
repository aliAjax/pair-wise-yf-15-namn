// 视图层选择器：把各集合拼成详情卡所需的视图模型。
import type {
  BatchDoc,
  IdentificationDoc,
  ReadingDoc,
  SpeciesDoc,
} from "../types";
import {
  analyzeReadings,
  isSnapshotStale,
  readingsHash,
  type ThermalResult,
} from "./thermal";

export interface BatchView {
  batch: BatchDoc;
  readings: ReadingDoc[];
  identification: IdentificationDoc | undefined; // 最新一版（草稿或定稿）
  finals: IdentificationDoc[]; // 全部定稿，按时间倒序
  species: SpeciesDoc | undefined;
  thermal: ThermalResult;
  currentHash: string;
  finalStale: boolean; // 最新定稿相对当前温度/参数已过时
}

export function readingsOf(
  readings: ReadingDoc[],
  batchId: string,
): ReadingDoc[] {
  return readings
    .filter((r) => r.batchId === batchId)
    .sort((a, b) => a.t.localeCompare(b.t));
}

export function identificationsOf(
  ids: IdentificationDoc[],
  batchId: string,
): IdentificationDoc[] {
  return ids
    .filter((i) => i.batchId === batchId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function buildBatchView(
  batch: BatchDoc,
  readings: ReadingDoc[],
  ids: IdentificationDoc[],
  species: SpeciesDoc[],
  gapThresholdMin: number,
): BatchView {
  const rs = readingsOf(readings, batch.id);
  const list = identificationsOf(ids, batch.id);
  const identification = list[0];
  const finals = list.filter((i) => i.status === "final");
  const sp = species.find((s) => s.id === identification?.speciesId);
  const target =
    identification && sp
      ? (sp.stageTargetsADH[identification.stage] ?? null)
      : null;
  const base = sp?.baseTempC ?? 10;
  const thermal = analyzeReadings(
    rs,
    batch.sampledAt,
    base,
    identification ? target : null,
    gapThresholdMin,
  );
  const currentHash = readingsHash(rs);
  const latestFinal = finals[0];
  const finalStale = latestFinal?.snapshot
    ? isSnapshotStale(
        latestFinal.snapshot,
        currentHash,
        sp?.baseTempC ?? 10,
        target,
        gapThresholdMin,
      )
    : false;
  return {
    batch,
    readings: rs,
    identification,
    finals,
    species: sp,
    thermal,
    currentHash,
    finalStale,
  };
}

export function fmtDT(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

export function fmtTemp(c: number | null | undefined): string {
  return c == null || Number.isNaN(c) ? "—" : `${Math.round(c * 10) / 10} ℃`;
}

export function fmtADH(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v)} ADH`;
}

/** 供 <input type="datetime-local"> 使用 */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}
