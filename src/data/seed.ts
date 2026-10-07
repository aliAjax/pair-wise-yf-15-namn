// 首次启动的演示数据：刻意包含乱序读数、同时刻重复、断档与"定稿后补录温度"。
import type {
  BatchDoc,
  CaseDoc,
  EntityDoc,
  IdentificationDoc,
  PointDoc,
  ReadingDoc,
  SettingsDoc,
  SpeciesDoc,
} from "../types";
import {
  analyzeReadings,
  makeSnapshot,
} from "../domain/thermal";

const BASE = "2026-10-03";

function iso(d: string, hhmm: string): string {
  return `${d}T${hhmm}:00.000Z`;
}

/** 模拟昼夜温度曲线（确定性，无随机） */
function diurnal(startHour: number): number {
  const phase = ((startHour - 9) / 24) * Math.PI * 2;
  return Math.round((19 + 7 * Math.sin(phase) + 0.8 * Math.sin(phase * 3)) * 10) / 10;
}

function series(
  batchId: string,
  startISO: string,
  endISO: string,
  stepMin: number,
  opts: {
    skip?: (h: number) => boolean;
    receivedLagMin?: (idx: number) => number;
  } = {},
): ReadingDoc[] {
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  const out: ReadingDoc[] = [];
  let n = 0;
  for (let t = start; t <= end; t += stepMin * 60000) {
    const h = (t - Date.parse(`${BASE}T00:00:00.000Z`)) / 3600000;
    if (opts.skip?.(h)) continue;
    const measured = new Date(t).toISOString();
    const lag = opts.receivedLagMin?.(n) ?? Math.min(n + 1, 30);
    out.push({
      type: "reading",
      id: `${batchId}-r${String(n).padStart(3, "0")}`,
      batchId,
      t: measured,
      c: diurnal(h),
      receivedAt: new Date(t + lag * 60000).toISOString(),
      source: "sensor",
      updatedAt: new Date(t + lag * 60000).toISOString(),
    });
    n++;
  }
  return out;
}

export function buildSeed(): { docs: EntityDoc[] } {
  const docs: EntityDoc[] = [];

  // ---- 种属发育参数（参考值，实验室可自行校准） ----
  const species: SpeciesDoc[] = [
    {
      type: "species",
      id: "sp-lucilia",
      scientificName: "Lucilia sericata",
      commonName: "丝光绿蝇",
      family: "丽蝇科 Calliphoridae",
      baseTempC: 10,
      stageTargetsADH: {
        egg: 300,
        instar1: 520,
        instar2: 760,
        instar3: 1500,
        postfeeding: 2500,
        pupa: 6000,
        adult: null,
      },
      referenceNote: "教学演示参考常数；正式案件请以本实验室标定品系数据为准。",
      updatedAt: iso(BASE, "09:05"),
    },
    {
      type: "species",
      id: "sp-chrysomya",
      scientificName: "Chrysomya megacephala",
      commonName: "大头金蝇",
      family: "丽蝇科 Calliphoridae",
      baseTempC: 12,
      stageTargetsADH: {
        egg: 240,
        instar1: 480,
        instar2: 820,
        instar3: 1650,
        postfeeding: 2700,
        pupa: 6500,
        adult: null,
      },
      referenceNote: "教学演示参考常数。",
      updatedAt: iso(BASE, "09:05"),
    },
    {
      type: "species",
      id: "sp-musca",
      scientificName: "Musca domestica",
      commonName: "家蝇",
      family: "蝇科 Muscidae",
      baseTempC: 11,
      stageTargetsADH: {
        egg: 200,
        instar1: 380,
        instar2: 620,
        instar3: 1150,
        postfeeding: null,
        pupa: 4800,
        adult: null,
      },
      referenceNote: "教学演示参考常数。",
      updatedAt: iso(BASE, "09:05"),
    },
  ];
  docs.push(...species);

  // ---- 案件 1 ----
  const case1: CaseDoc = {
    type: "case",
    id: "case-1",
    caseNo: "CASE-2026-091",
    location: "城郊废旧工棚东侧草地",
    sceneType: "室外 / 草地",
    foundAt: iso(BASE, "08:10"),
    examiner: "李勘",
    notes: "尸体仰卧，衣着完整，口鼻见大量蝇类活动。",
    updatedAt: iso(BASE, "09:10"),
  };
  const point1: PointDoc = {
    type: "point",
    id: "point-1",
    caseId: "case-1",
    name: "A点·尸体下方遮阴处",
    microhabitat: "背阴、草高约20cm、土壤潮湿",
    updatedAt: iso(BASE, "09:12"),
  };
  const point2: PointDoc = {
    type: "point",
    id: "point-2",
    caseId: "case-1",
    name: "B点·工棚门口向阳处",
    microhabitat: "日照直晒、硬质泥地",
    notes: "距尸体约6米，作为对照采样点。",
    updatedAt: iso(BASE, "09:12"),
  };
  const batch1: BatchDoc = {
    type: "batch",
    id: "batch-1",
    caseId: "case-1",
    pointId: "point-1",
    batchNo: "091-A01",
    sampledAt: iso("2026-10-05", "10:00"),
    ambientTempC: 21.4,
    collectedBy: "李勘",
    preservation: "ethanol",
    notes: "口鼻腔采集幼虫约30头。",
    updatedAt: iso("2026-10-05", "10:05"),
  };
  const batch2: BatchDoc = {
    type: "batch",
    id: "batch-2",
    caseId: "case-1",
    pointId: "point-2",
    batchNo: "091-B01",
    sampledAt: iso("2026-10-05", "10:30"),
    ambientTempC: 24.0,
    collectedBy: "王勘",
    preservation: "live",
    notes: "对照点土壤表层幼虫。",
    updatedAt: iso("2026-10-05", "10:40"),
  };
  docs.push(case1, point1, point2, batch1, batch2);

  // 批次1：10-03 12:00 → 10-05 10:00，每30分钟一条
  const r1 = series(batch1.id, iso(BASE, "12:00"), batch1.sampledAt, 30);
  // 模拟乱序上报：3 条数据延迟了约 3 小时才到达（测量时刻早、到达时刻晚）
  for (const idx of [4, 20, 21]) {
    const measured = Date.parse(r1[idx].t);
    r1[idx] = {
      ...r1[idx],
      receivedAt: new Date(measured + 190 * 60000).toISOString(),
      updatedAt: new Date(measured + 190 * 60000).toISOString(),
      note: "传感器晚到的缓存读数",
    };
  }
  // 同时刻重复上报（温度略有偏差，计算时取均值）
  const dup: ReadingDoc = {
    ...r1[10],
    id: "batch-1-rdup",
    c: Math.round((r1[10].c - 0.6) * 10) / 10,
    note: "传感器重复上报",
    receivedAt: new Date(Date.parse(r1[10].t) + 45 * 60000).toISOString(),
    updatedAt: iso("2026-10-05", "09:50"),
  };

  // 定稿后实验室补录的夜间人工读数（晚于鉴定定稿时间）——使定稿快照过时
  const inserted: ReadingDoc = {
    type: "reading",
    id: "batch-1-rlate",
    batchId: batch1.id,
    t: iso("2026-10-04", "03:00"),
    c: 12.9,
    receivedAt: iso("2026-10-06", "11:15"),
    source: "manual",
    note: "次日补录现场记录仪夜间数据",
    updatedAt: iso("2026-10-06", "11:20"),
  };
  docs.push(...r1, dup, inserted);

  // 批次2：10-04 06:00 → 10-05 10:30，中间 22:00-02:00 断档（4小时）
  const r2 = series(batch2.id, iso("2026-10-04", "06:00"), batch2.sampledAt, 30, {
    skip: (h) => h >= 22 + 24 && h < 26 + 24,
  });
  docs.push(...r2);

  // 批次1的定稿鉴定：快照基于"补录前"的读数集合
  const finalizedAt = iso("2026-10-05", "14:30");
  const preInsert = [...r1, dup];
  const pre = analyzeReadings(preInsert, batch1.sampledAt, 10, 760, 90);
  const id1: IdentificationDoc = {
    type: "identification",
    id: "id-1",
    batchId: batch1.id,
    versionOf: null,
    status: "final",
    stage: "instar2",
    speciesId: "sp-lucilia",
    exposureStage: "bloat",
    analyst: "周法医",
    lab: "市局法医昆虫学实验室",
    basis: "口鼻腔采集，二龄幼虫，后气门形态符合丝光绿蝇；样本发育较整齐。",
    finalizedAt,
    snapshot: makeSnapshot(preInsert, 10, 760, 90, pre),
    updatedAt: finalizedAt,
  };
  docs.push(id1);

  // 批次2：尚未定稿的草稿
  const id2: IdentificationDoc = {
    type: "identification",
    id: "id-2",
    batchId: batch2.id,
    versionOf: null,
    status: "draft",
    stage: "instar3",
    speciesId: "sp-chrysomya",
    exposureStage: "decay",
    analyst: "周法医",
    lab: "市局法医昆虫学实验室",
    basis: "疑似大头金蝇三龄，待复核棘突排列。",
    updatedAt: iso("2026-10-06", "09:00"),
  };
  docs.push(id2);

  // ---- 案件 2（记录较稀疏） ----
  const case2: CaseDoc = {
    type: "case",
    id: "case-2",
    caseNo: "CASE-2026-088",
    location: "横塘江南岸芦苇丛",
    sceneType: "室外 / 水边",
    foundAt: iso("2026-10-01", "17:20"),
    examiner: "陈勘",
    notes: "高度腐败，蛹壳与幼虫混生。",
    updatedAt: iso("2026-10-01", "18:00"),
  };
  const point3: PointDoc = {
    type: "point",
    id: "point-3",
    caseId: "case-2",
    name: "C点·尸体北侧1米土中",
    microhabitat: "湿润黏土、落叶覆盖",
    updatedAt: iso("2026-10-01", "18:05"),
  };
  const batch3: BatchDoc = {
    type: "batch",
    id: "batch-3",
    caseId: "case-2",
    pointId: point3.id,
    batchNo: "088-C01",
    sampledAt: iso("2026-10-02", "09:00"),
    ambientTempC: 17.5,
    collectedBy: "陈勘",
    preservation: "dry",
    notes: "土壤筛取蛹壳若干。",
    updatedAt: iso("2026-10-02", "09:20"),
  };
  const r3 = series(batch3.id, iso("2026-10-01", "18:00"), batch3.sampledAt, 60);
  docs.push(case2, point3, batch3, ...r3);

  const settings: SettingsDoc = {
    type: "settings",
    id: "settings",
    online: true,
    gapThresholdMin: 90,
    autoSeed: true,
    updatedAt: iso(BASE, "09:00"),
  };
  docs.push(settings);

  return { docs };
}
