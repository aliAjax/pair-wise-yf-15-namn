// 积温（Accumulated Degree-Hours）领域引擎：纯函数，客户端与测试共用。
import type {
  ExposureCode,
  PreservationKind,
  ReadingDoc,
  StageCode,
  ThermalSnapshot,
} from "../types";

export interface StageOption {
  code: StageCode;
  label: string;
}

/** 发育阶段（筛选项与鉴定项共用；顺序即发育先后） */
export const STAGES: StageOption[] = [
  { code: "egg", label: "卵期" },
  { code: "instar1", label: "一龄幼虫" },
  { code: "instar2", label: "二龄幼虫" },
  { code: "instar3", label: "三龄幼虫" },
  { code: "postfeeding", label: "离食期幼虫" },
  { code: "pupa", label: "蛹期" },
  { code: "adult", label: "成虫" },
];

export const EXPOSURE: { code: ExposureCode; label: string }[] = [
  { code: "fresh", label: "新鲜期" },
  { code: "bloat", label: "肿胀期" },
  { code: "decay", label: "腐烂期" },
  { code: "advanced", label: "后腐烂期" },
  { code: "skeleton", label: "白骨化" },
];

export const PRESERVATION: { code: PreservationKind; label: string }[] = [
  { code: "ethanol", label: "75%乙醇" },
  { code: "dry", label: "干制" },
  { code: "freeze", label: "冷冻" },
  { code: "live", label: "活体带回" },
];

export const stageLabel = (code: StageCode): string =>
  STAGES.find((s) => s.code === code)?.label ?? code;
export const exposureLabel = (code: ExposureCode): string =>
  EXPOSURE.find((s) => s.code === code)?.label ?? code;
export const preservationLabel = (code: PreservationKind): string =>
  PRESERVATION.find((p) => p.code === code)?.label ?? code;

/** FNV-1a 32 位哈希（非加密用途：快照一致性比对足够） */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

interface RawPoint {
  t: number;
  c: number;
}

export interface SeriesPoint extends RawPoint {
  afterCollect?: boolean; // 采样时刻之后的点：只用于展示温度过程，不参与积温
}

export interface ThermalResult {
  points: SeriesPoint[]; // 排序后的温度过程（含采样后点，供画曲线）
  outOfOrderCount: number;
  duplicateCount: number;
  mergedDuplicateCount: number;
  gapCount: number; // 估计窗口内超阈值断档数
  maxGapMin: number;
  coverage: number; // 估计窗口内有效积分时长占比 0..1
  meanTempC: number | null; // 覆盖时段加权平均温度
  cumulativeADH: number | null; // 至采样时刻的有效积温
  ageHoursMin: number | null; // 反推虫龄（小时）
  ageHoursMax: number | null;
  targetADH: number | null;
  extrapolated: boolean; // 现有积温尚未达到阶段目标，年龄上界为外推
  colonizedFrom: string | null; // 定植窗口起（早）
  colonizedTo: string | null; // 定植窗口止（晚）
  warnings: string[];
  windowStart: number | null;
  collectedAt: number | null;
}

function dedupe(points: RawPoint[]): {
  points: RawPoint[];
  merged: number;
} {
  const out: RawPoint[] = [];
  let merged = 0;
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.t === p.t) {
      // 同一时刻多条（重复上报）：取均值
      last.c = (last.c + p.c) / 2;
      merged++;
    } else {
      out.push({ ...p });
    }
  }
  return { points: out, merged };
}

interface Segment {
  t0: number;
  t1: number;
  c0: number;
  c1: number;
  gap: boolean;
  minutes: number;
}

/**
 * 计算一批次的积温结论。
 * @param readings 原始读数（允许乱序）
 * @param collectedAtIso 采样时刻
 * @param baseTempC 发育起点温度
 * @param targetADH 该种属当前发育阶段的目标 ADH
 * @param gapThresholdMin 超过该分钟数视为断档（断档不参与积分）
 */
export function analyzeReadings(
  readings: Pick<ReadingDoc, "t" | "c">[],
  collectedAtIso: string | null,
  baseTempC: number,
  targetADH: number | null,
  gapThresholdMin: number,
): ThermalResult {
  const warnings: string[] = [];
  const collectedAt = collectedAtIso ? Date.parse(collectedAtIso) : null;

  // 1) 乱序检测：以"到达本机的顺序"对照测量时刻
  const raw = readings
    .map((r) => ({
      t: Date.parse(r.t),
      c: r.c,
      receivedAt: Date.parse(
        (r as { receivedAt?: string }).receivedAt ?? r.t,
      ),
    }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.c));
  let inversions = 0;
  const arrival = [...raw].sort(
    (a, b) => a.receivedAt - b.receivedAt || a.t - b.t,
  );
  for (let i = 1; i < arrival.length; i++) {
    if (arrival[i].t < arrival[i - 1].t) inversions++;
  }

  const beforeSort = [...raw].sort((a, b) => a.t - b.t);
  const { points: sorted, merged } = dedupe(beforeSort);

  const points: SeriesPoint[] = sorted.map((p) => ({
    ...p,
    afterCollect: collectedAt !== null && p.t > collectedAt,
  }));

  const result: ThermalResult = {
    points,
    outOfOrderCount: inversions,
    duplicateCount: merged,
    mergedDuplicateCount: merged,
    gapCount: 0,
    maxGapMin: 0,
    coverage: 0,
    meanTempC: null,
    cumulativeADH: null,
    ageHoursMin: null,
    ageHoursMax: null,
    targetADH,
    extrapolated: false,
    colonizedFrom: null,
    colonizedTo: null,
    warnings,
    windowStart: null,
    collectedAt,
  };

  if (inversions > 0) {
    warnings.push(
      `检测到 ${inversions} 处读数乱序（已按时间重排，不影响积温）`,
    );
  }
  if (merged > 0) {
    warnings.push(`${merged} 条同时刻重复读数已按温度均值合并`);
  }

  // 2) 取采样时刻之前（含）的读数构造估计窗口
  let win = sorted;
  if (collectedAt !== null) {
    win = sorted.filter((p) => p.t <= collectedAt);
    if (sorted.some((p) => p.t > collectedAt)) {
      warnings.push("采样时刻之后的温度仅展示，不计入积温");
    }
  }

  if (win.length === 0) {
    warnings.push("估计窗口内没有温度读数，无法计算积温");
    return result;
  }

  // 分段：相邻读数 + 末尾"保持到采样时刻"的虚拟点
  const segments: Segment[] = [];
  for (let i = 1; i < win.length; i++) {
    const minutes = (win[i].t - win[i - 1].t) / 60000;
    segments.push({
      t0: win[i - 1].t,
      t1: win[i].t,
      c0: win[i - 1].c,
      c1: win[i].c,
      gap: minutes > gapThresholdMin,
      minutes,
    });
  }
  const last = win[win.length - 1];
  if (collectedAt !== null && collectedAt > last.t) {
    const minutes = (collectedAt - last.t) / 60000;
    segments.push({
      t0: last.t,
      t1: collectedAt,
      c0: last.c,
      c1: last.c, // 末次读数保持到采样
      gap: minutes > gapThresholdMin,
      minutes,
    });
  }

  let maxGap = 0;
  let gapCount = 0;
  for (const s of segments) {
    if (s.gap) {
      gapCount++;
      maxGap = Math.max(maxGap, s.minutes);
    }
  }
  result.gapCount = gapCount;
  result.maxGapMin = Math.round(maxGap);
  if (gapCount > 0) {
    warnings.push(
      `存在 ${gapCount} 处断档（最长 ${Math.round(maxGap)} 分钟），断档时段不积分、覆盖率相应下降`,
    );
  }

  // 3) 有效段上做梯形积分 ADH
  let cum = 0;
  let coveredMin = 0;
  let tempMin = 0;
  const cumPts: { t: number; adh: number }[] = [];
  for (const s of segments) {
    if (!s.gap) {
      const eff0 = Math.max(s.c0, baseTempC) - baseTempC;
      const eff1 = Math.max(s.c1, baseTempC) - baseTempC;
      const hours = s.minutes / 60;
      cum += ((eff0 + eff1) / 2) * hours;
      coveredMin += s.minutes;
      tempMin += ((s.c0 + s.c1) / 2) * s.minutes;
    }
    cumPts.push({ t: s.t1, adh: cum });
  }

  const endTime = collectedAt ?? last.t;
  const startTime = win[0].t;
  const windowMin = Math.max((endTime - startTime) / 60000, 0);
  const coverage = windowMin > 0 ? Math.min(coveredMin / windowMin, 1) : 1;

  result.windowStart = startTime;
  result.coverage = coverage;
  result.meanTempC = coveredMin > 0 ? tempMin / coveredMin : null;
  result.cumulativeADH = cum;

  if (coveredMin === 0) {
    warnings.push("断档覆盖了整个观测窗口，积温结论不可用");
    return result;
  }

  // 4) 由阶段目标 ADH 反推虫龄（向采样时刻回溯）
  if (targetADH != null && Number.isFinite(targetADH) && targetADH > 0) {
    if (cum < targetADH) {
      // 观测积温不足：用覆盖时段的平均积温速率外推（明确标记为外推）
      result.extrapolated = true;
      const rate = cum / (coveredMin / 60); // ADH / 小时
      if (rate > 0) {
        const age = targetADH / rate;
        result.ageHoursMax = Math.round(age * 10) / 10;
        result.ageHoursMin = Math.round(age * coverage * 10) / 10;
        warnings.push(
          "观测积温未达该阶段目标值，虫龄上界按平均积温速率外推，仅供参考",
        );
      } else {
        warnings.push("覆盖时段积温速率为 0（温度低于起点温度），无法外推虫龄");
      }
    } else {
      // 定植后发育 targetADH：从采样时刻沿累计曲线回溯，
      // 找满足 cum(T) - cum(X) = targetADH 的时刻 X，虫龄 = T - X。
      const threshold = cum - targetADH;
      let prev = { t: startTime, adh: 0 };
      let hit: { t: number; adh: number } | null = null;
      for (const p of cumPts) {
        if (p.adh >= threshold) {
          hit = p;
          break;
        }
        prev = p;
      }
      if (threshold <= 0) {
        // 观测窗口起点时积温仍未超过目标：最早定植不晚于窗口起点
        const ageBest = (endTime - startTime) / 3600000;
        const missingHours = (windowMin - coveredMin) / 60;
        result.ageHoursMin = Math.round(ageBest * 10) / 10;
        result.ageHoursMax = Math.round((ageBest + missingHours) * 10) / 10;
      } else if (hit && hit.adh > prev.adh) {
        const frac = (threshold - prev.adh) / (hit.adh - prev.adh);
        const ageBest =
          (endTime - (prev.t + frac * (hit.t - prev.t))) / 3600000;
        // 覆盖率不足时，缺失时长可能使实际虫龄偏大，给出区间
        const missingHours = (windowMin - coveredMin) / 60;
        result.ageHoursMin = Math.round(ageBest * 10) / 10;
        result.ageHoursMax = Math.round((ageBest + missingHours) * 10) / 10;
      }
    }

    if (result.ageHoursMin != null) {
      result.colonizedTo = new Date(
        endTime - result.ageHoursMin * 3600000,
      ).toISOString();
    }
    if (result.ageHoursMax != null) {
      result.colonizedFrom = new Date(
        endTime - result.ageHoursMax * 3600000,
      ).toISOString();
    }
  }

  if (coverage < 0.95) {
    warnings.push(
      `温度覆盖率仅 ${Math.round(coverage * 100)}%，定植时间区间已相应放宽`,
    );
  }

  return result;
}

/** 温度记录内容哈希：只取决于排序后的时刻与温度，乱序不影响结果 */
export function readingsHash(
  readings: Pick<ReadingDoc, "t" | "c">[],
): string {
  const rows = readings
    .map((r) => [Date.parse(r.t), r.c] as const)
    .filter(([t]) => Number.isFinite(t))
    .sort((a, b) => a[0] - b[0])
    .map(([t, c]) => `${t}:${Math.round(c * 100) / 100}`)
    .join("|");
  return fnv1a(rows);
}

export function makeSnapshot(
  readings: Pick<ReadingDoc, "t" | "c">[],
  baseTempC: number,
  stageTargetADH: number | null,
  gapThresholdMin: number,
  result: ThermalResult,
): ThermalSnapshot {
  return {
    readingsHash: readingsHash(readings),
    speciesBaseTempC: baseTempC,
    stageTargetADH,
    gapThresholdMin,
    readingCount: readings.length,
    cumulativeADH: result.cumulativeADH,
    ageHoursMin: result.ageHoursMin,
    ageHoursMax: result.ageHoursMax,
    computedAt: new Date().toISOString(),
  };
}

/** 定稿结论是否已过时：温度记录或所用参数发生变化即为过时 */
export function isSnapshotStale(
  snap: ThermalSnapshot,
  currentHash: string,
  baseTempC: number,
  stageTargetADH: number | null,
  gapThresholdMin: number,
): boolean {
  return (
    snap.readingsHash !== currentHash ||
    snap.speciesBaseTempC !== baseTempC ||
    snap.stageTargetADH !== stageTargetADH ||
    snap.gapThresholdMin !== gapThresholdMin
  );
}

/** 简单 CSV 解析：每行 `时间ISO,温度`，# 开头为注释，兼容本地导出再导入 */
export function parseReadingsCSV(
  text: string,
): { t: string; c: number }[] {
  const out: { t: string; c: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const cells = s.split(/[,\t;]/).map((x) => x.trim());
    if (cells.length < 2) continue;
    const t = Date.parse(cells[0].replace(" ", "T"));
    const c = Number(cells[1].replace("℃", ""));
    if (Number.isFinite(t) && Number.isFinite(c)) {
      out.push({ t: new Date(t).toISOString(), c });
    }
  }
  return out;
}

export function toReadingsCSV(readings: Pick<ReadingDoc, "t" | "c">[]): string {
  const rows = [...readings]
    .map((r) => [Date.parse(r.t), r.t, r.c] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, t, c]) => `${t},${c}`);
  return "# ISO时刻,温度℃\n" + rows.join("\n") + "\n";
}

export function hoursLabel(h: number | null): string {
  if (h == null) return "—";
  if (h < 48) return `${Math.round(h * 10) / 10} 小时`;
  return `${Math.round((h / 24) * 10) / 10} 天`;
}
