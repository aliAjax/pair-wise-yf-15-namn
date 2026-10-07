// 演示数据：模拟真实案件、批次、温度读数（含断档/乱序）与鉴定结论
import type {
  Batch,
  CaseRecord,
  Identification,
  TempReading,
} from "./types";
import { hashString, uid } from "./utils";

const HOUR = 3600_000;

/** 生成一段昼夜波动的温度序列（可人为制造断档与乱序） */
function genReadings(
  caseId: string,
  startTs: number,
  hours: number,
  opts: {
    base: number;
    swing: number;
    gapAt?: number; // 在第几小时制造断档
    gapHours?: number;
    disorder?: boolean; // 是否在末尾补一条更早的乱序读数
  }
): TempReading[] {
  const out: TempReading[] = [];
  const now = Date.now();
  for (let h = 0; h <= hours; h += 2) {
    if (opts.gapAt !== undefined && h >= opts.gapAt && h < opts.gapAt + (opts.gapHours ?? 6)) {
      continue; // 传感器断档：这几小时没有读数
    }
    const diurnal = Math.sin(((h - 9) / 24) * Math.PI * 2) * opts.swing; // 昼夜周期，15 时前后最高
    const noise = (Math.random() - 0.5) * 1.2;
    const value = Math.round((opts.base + diurnal + noise) * 10) / 10;
    out.push({
      id: uid("rd"),
      caseId,
      ts: startTs + h * HOUR,
      value,
      source: "sensor",
      synced: true,
      updatedAt: now - (hours - h) * HOUR,
    });
  }
  if (opts.disorder && out.length > 2) {
    // 人工补录一条更早的读数（乱序），合并时按时间重排
    const backfill: TempReading = {
      id: uid("rd"),
      caseId,
      ts: out[out.length - 2].ts - 3 * HOUR,
      value: Math.round((opts.base - 1 + (Math.random() - 0.5)) * 10) / 10,
      source: "manual",
      synced: true,
      updatedAt: now,
    };
    out.push(backfill);
  }
  return out;
}

function readingHash(readings: TempReading[]): string {
  const s = [...readings]
    .sort((a, b) => a.ts - b.ts)
    .map((r) => `${r.ts}:${r.value}`)
    .join("|");
  return hashString(s);
}

export function buildSeed() {
  const now = Date.now();
  const cases: CaseRecord[] = [];
  const batches: Batch[] = [];
  const readings: TempReading[] = [];
  const identifications: Identification[] = [];

  // ---- 案件一：室外草地，案发约 3.5 天前 ----
  const c1: CaseRecord = {
    id: "case-042",
    caseNo: "CASE-042",
    title: "城郊室外草地无名尸案",
    location: "城郊结合部 室外草地",
    occurredAt: now - 84 * HOUR,
    createdAt: now - 84 * HOUR,
    notes: "尸体位于草地隐蔽处，周围有蝇类活动，传感器 2 小时一记。",
    synced: true,
    updatedAt: now - 84 * HOUR,
  };
  cases.push(c1);

  readings.push(
    ...genReadings(c1.id, c1.occurredAt, 84, {
      base: 25,
      swing: 4.5,
      gapAt: 30,
      gapHours: 8,
      disorder: true,
    })
  );

  const b1: Batch = {
    id: "batch-042-a",
    caseId: c1.id,
    batchNo: "CASE-042-A",
    samplingPoint: "室外草地 · 尸体东侧 0.5m",
    collectedAt: now - 6 * HOUR,
    preservation: "乙醇保存",
    quantity: 12,
    notes: "幼虫三龄为主，体态饱满。",
    createdAt: now - 6 * HOUR,
    synced: true,
    updatedAt: now - 6 * HOUR,
  };
  const b2: Batch = {
    id: "batch-042-b",
    caseId: c1.id,
    batchNo: "CASE-042-B",
    samplingPoint: "室外草地 · 尸体阴影区",
    collectedAt: now - 6 * HOUR,
    preservation: "乙醇保存",
    quantity: 7,
    notes: "见蛹期样本，需复核种属。",
    createdAt: now - 6 * HOUR,
    synced: true,
    updatedAt: now - 6 * HOUR,
  };
  batches.push(b1, b2);

  // 鉴定 A：已定稿，但定稿后又有新读数并入 → 过时
  const c1HashAtFinalize = readingHash(
    readings.filter((r) => r.caseId === c1.id && r.source !== "manual")
  );
  identifications.push({
    id: "ident-042-a",
    batchId: b1.id,
    stage: "幼虫",
    species: "丝光绿蝇 Lucilia sericata",
    exposureStage: "腐败期",
    baseTemp: 10,
    addValue: 186.4,
    tempHash: c1HashAtFinalize, // 定稿时还没有那条人工补录
    finalized: true,
    finalizedAt: now - 5 * HOUR,
    finalizedBy: "李法医",
    notes: "三龄幼虫，积温约 186.4 ℃·日，推断暴露 3 天左右。",
    synced: true,
    updatedAt: now - 5 * HOUR,
  });

  // 鉴定 B：未定稿（草稿）
  identifications.push({
    id: "ident-042-b",
    batchId: b2.id,
    stage: "蛹",
    species: "",
    exposureStage: "腐败期",
    baseTemp: 10,
    addValue: 0,
    tempHash: "",
    finalized: false,
    finalizedAt: null,
    finalizedBy: "",
    notes: "蛹期，种属待鉴定。",
    synced: true,
    updatedAt: now - 4 * HOUR,
  });

  // ---- 案件二：水沟边缘，案发约 2 天前 ----
  const c2: CaseRecord = {
    id: "case-051",
    caseNo: "CASE-051",
    title: "排水沟边缘蝇类滋生案",
    location: "城东排水沟边缘",
    occurredAt: now - 50 * HOUR,
    createdAt: now - 50 * HOUR,
    notes: "潮湿、半阴，成虫活动频繁。",
    synced: true,
    updatedAt: now - 50 * HOUR,
  };
  cases.push(c2);
  readings.push(
    ...genReadings(c2.id, c2.occurredAt, 50, {
      base: 23,
      swing: 3.5,
      disorder: true,
    })
  );

  const b3: Batch = {
    id: "batch-051-a",
    caseId: c2.id,
    batchNo: "CASE-051-A",
    samplingPoint: "水沟边缘 · 石块下",
    collectedAt: now - 3 * HOUR,
    preservation: "冷冻保存",
    quantity: 20,
    notes: "成虫采集，已完成拍照。",
    createdAt: now - 3 * HOUR,
    synced: true,
    updatedAt: now - 3 * HOUR,
  };
  batches.push(b3);
  identifications.push({
    id: "ident-051-a",
    batchId: b3.id,
    stage: "成虫",
    species: "",
    exposureStage: "肿胀期",
    baseTemp: 12,
    addValue: 0,
    tempHash: "",
    finalized: false,
    finalizedAt: null,
    finalizedBy: "",
    notes: "成虫样本，待鉴定种属。",
    synced: true,
    updatedAt: now - 2 * HOUR,
  });

  // ---- 案件三：室内，案发约 1 天前，人工稀疏读数 ----
  const c3: CaseRecord = {
    id: "case-067",
    caseNo: "CASE-067",
    title: "室内现场蝇卵案",
    location: "某出租屋 室内",
    occurredAt: now - 26 * HOUR,
    createdAt: now - 26 * HOUR,
    notes: "室内温度稳定，人工记录 3 次。",
    synced: true,
    updatedAt: now - 26 * HOUR,
  };
  cases.push(c3);
  const base3 = genReadings(c3.id, c3.occurredAt, 26, {
    base: 26,
    swing: 1.5,
  });
  // 只保留少数几条，模拟人工稀疏记录
  readings.push(...base3.filter((_, i) => i % 3 === 0));

  const b4: Batch = {
    id: "batch-067-a",
    caseId: c3.id,
    batchNo: "CASE-067-A",
    samplingPoint: "室内 · 窗台内侧",
    collectedAt: now - 2 * HOUR,
    preservation: "干燥保存",
    quantity: 30,
    notes: "卵块，待孵化鉴定。",
    createdAt: now - 2 * HOUR,
    synced: true,
    updatedAt: now - 2 * HOUR,
  };
  batches.push(b4);
  identifications.push({
    id: "ident-067-a",
    batchId: b4.id,
    stage: "卵",
    species: "",
    exposureStage: "新鲜期",
    baseTemp: 12,
    addValue: 0,
    tempHash: "",
    finalized: false,
    finalizedAt: null,
    finalizedBy: "",
    notes: "卵期，待鉴定。",
    synced: true,
    updatedAt: now - 2 * HOUR,
  });

  return {
    cases,
    batches,
    readings,
    identifications,
    outbox: [],
    online: true,
    lastSyncAt: now,
  };
}
