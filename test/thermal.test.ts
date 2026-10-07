// 纯逻辑测试：积温引擎 + 定稿保护 + 种子场景。用 esbuild 打包后由 node 运行。
import assert from "node:assert";
import {
  analyzeReadings,
  fnv1a,
  isSnapshotStale,
  makeSnapshot,
  parseReadingsCSV,
  readingsHash,
} from "../src/domain/thermal";
import { isProtected, pushToRelay } from "../src/data/relay";
import { buildSeed } from "../src/data/seed";
import type { EntityDoc, IdentificationDoc, ReadingDoc } from "../src/types";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const iso = (d: Date) => d.toISOString();
const hour = (n: number) => n * 3600_000;

// 恒温 20℃ 序列（起点 10℃ → 每小时 10 ADH）
function steadySeries(start: Date, end: Date, c = 20): { t: string; c: number }[] {
  const out: { t: string; c: number }[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += hour(1)) {
    out.push({ t: iso(new Date(t)), c });
  }
  return out;
}

const collected = new Date("2026-10-05T10:00:00Z");
const start = new Date(collected.getTime() - hour(24));
const ordered = steadySeries(start, collected);

test("恒温序列：目标 100 ADH（10ADH/h）反推虫龄≈10小时", () => {
  const r = analyzeReadings(ordered, iso(collected), 10, 100, 90);
  assert.strictEqual(r.gapCount, 0);
  assert.ok(r.cumulativeADH != null && Math.abs(r.cumulativeADH - 240) < 1e-6);
  assert.ok(r.ageHoursMin != null && Math.abs(r.ageHoursMin - 10) < 0.2, `虫龄=${r.ageHoursMin}`);
  assert.strictEqual(r.coverage, 1);
});

test("乱序到达：积温与哈希完全一致，仅报告乱序数", () => {
  // 3 条读数"晚到"：测量时刻仍在原位置，但到达时间排在序列之后
  const late: Record<number, string> = {
    2: iso(new Date(collected.getTime() - hour(1))),
    3: iso(new Date(collected.getTime() - 2 * hour(1))),
    10: iso(new Date(collected.getTime() - 30 * 60_000)),
  };
  const delayed = ordered.map((p, i) =>
    late[i] ? { ...p, receivedAt: late[i] } : p,
  );
  const a = analyzeReadings(ordered, iso(collected), 10, 100, 90);
  const b = analyzeReadings(delayed, iso(collected), 10, 100, 90);
  assert.strictEqual(readingsHash(ordered), readingsHash(delayed));
  assert.ok(b.outOfOrderCount >= 2, `乱序数=${b.outOfOrderCount}`);
  assert.strictEqual(a.cumulativeADH, b.cumulativeADH);
  assert.strictEqual(a.ageHoursMin, b.ageHoursMin);
});

test("同时刻重复读数：合并为均值且计数", () => {
  const dup = [...ordered, { t: ordered[5].t, c: 24 }]; // 20 与 24 同时刻 → 22
  const r = analyzeReadings(dup, iso(collected), 10, 100, 90);
  assert.strictEqual(r.duplicateCount, 1);
  assert.strictEqual(r.points.length, ordered.length);
});

test("断档：超阈值时段不积分、覆盖率下降、年龄区间放宽", () => {
  // 删掉中间 4 小时（04:00-08:00 之间 3 个点）→ 相邻间隔 5h > 90min
  const gapped = ordered.filter((p, i) => !(i >= 19 && i <= 21));
  const full = analyzeReadings(ordered, iso(collected), 10, 100, 90);
  const r = analyzeReadings(gapped, iso(collected), 10, 100, 90);
  assert.strictEqual(r.gapCount, 1);
  assert.ok(r.maxGapMin >= 240);
  assert.ok(r.coverage < 1);
  assert.ok((r.cumulativeADH ?? 0) < (full.cumulativeADH ?? 0));
  assert.ok((r.ageHoursMax ?? 0) >= (r.ageHoursMin ?? 0));
});

test("采样后读数只展示不积分", () => {
  const after = [...ordered, { t: iso(new Date(collected.getTime() + hour(2))), c: 35 }];
  const r = analyzeReadings(after, iso(collected), 10, 100, 90);
  assert.strictEqual(r.points.some((p) => p.afterCollect), true);
  assert.ok(Math.abs((r.cumulativeADH ?? 0) - 240) < 1e-6);
});

test("积温不足时标记外推", () => {
  const shortStart = new Date(collected.getTime() - hour(4));
  const r = analyzeReadings(steadySeries(shortStart, collected), iso(collected), 10, 100, 90);
  assert.strictEqual(r.extrapolated, true);
  assert.ok(r.ageHoursMax != null && r.ageHoursMax >= 9.5);
});

test("快照：定稿后补录温度即判定过时", () => {
  const r1 = analyzeReadings(ordered, iso(collected), 10, 100, 90);
  const snap = makeSnapshot(ordered, 10, 100, 90, r1);
  assert.ok(!isSnapshotStale(snap, readingsHash(ordered), 10, 100, 90));
  const changed = [...ordered, { t: iso(new Date(start.getTime() + hour(3) + 120_000)), c: 13 }];
  assert.ok(isSnapshotStale(snap, readingsHash(changed), 10, 100, 90));
  // 参数变化也算过时
  assert.ok(isSnapshotStale(snap, readingsHash(ordered), 11, 100, 90));
  assert.ok(isSnapshotStale(snap, readingsHash(ordered), 10, 120, 90));
  assert.ok(isSnapshotStale(snap, readingsHash(ordered), 10, 100, 60));
});

test("CSV 解析容忍表头/分隔符/乱序", () => {
  const rows = parseReadingsCSV(
    "# 注释\n2026-10-05T09:00:00Z,21.5\n2026-10-05T08:00:00Z;19\n坏行\n",
  );
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].c, 21.5);
});

test("fnv1a 稳定", () => {
  assert.match(fnv1a("abc"), /^[0-9a-f]{8}$/);
  assert.strictEqual(fnv1a("abc"), fnv1a("abc"));
  assert.notStrictEqual(fnv1a("abc"), fnv1a("abd"));
});

// ---- 定稿保护：需要 localStorage，node 下打桩 ----
class FakeLocalStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
(globalThis as { localStorage?: unknown }).localStorage = new FakeLocalStorage();
(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;

test("定稿鉴定：同 updatedAt 幂等，不同 updatedAt 覆盖被拒并回滚", () => {
  const finalDoc: IdentificationDoc = {
    type: "identification",
    id: "id-x",
    batchId: "b1",
    versionOf: null,
    status: "final",
    stage: "instar2",
    speciesId: "sp1",
    exposureStage: "bloat",
    analyst: "A",
    lab: "L",
    basis: "原始定稿",
    finalizedAt: "2026-10-05T14:00:00Z",
    updatedAt: "2026-10-05T14:00:00Z",
  };
  assert.strictEqual(pushToRelay([finalDoc as EntityDoc]).accepted, 1);
  // 同内容重放（幂等）
  assert.strictEqual(pushToRelay([finalDoc as EntityDoc]).rejected, 0);
  // 篡改定稿
  const tampered = { ...finalDoc, basis: "被篡改", updatedAt: "2026-10-09T00:00:00Z" };
  const res = pushToRelay([tampered as EntityDoc]);
  assert.strictEqual(res.accepted, 0);
  assert.strictEqual(res.rejected, 1);
  assert.strictEqual(res.reverted[0] && (res.reverted[0] as IdentificationDoc).basis, "原始定稿");
  assert.strictEqual(isProtected(undefined, finalDoc as EntityDoc), false);
  // 非鉴定文档不受保护
  const rd: ReadingDoc = {
    type: "reading", id: "r1", batchId: "b1",
    t: "2026-10-05T00:00:00Z", c: 20, source: "sensor",
    updatedAt: "2026-10-05T00:00:00Z",
  };
  assert.strictEqual(pushToRelay([rd as EntityDoc]).accepted, 1);
});

test("种子场景：batch-1 的定稿 id-1 在补录夜间温度后恰好过时", () => {
  const { docs } = buildSeed();
  const batch = docs.find((d) => d.id === "batch-1")!;
  const readings = docs.filter((d): d is ReadingDoc => d.type === "reading" && d.batchId === "batch-1");
  const id1 = docs.find((d) => d.id === "id-1") as IdentificationDoc;
  const sp = docs.find((d) => d.id === "sp-lucilia")! as unknown as {
    baseTempC: number;
    stageTargetsADH: Record<string, number | null>;
  };
  const target = sp.stageTargetsADH[id1.stage];
  const stale = isSnapshotStale(
    id1.snapshot!,
    readingsHash(readings),
    sp.baseTempC,
    target,
    90,
  );
  assert.ok(stale, "补录的 10-04 03:00 夜间读数应使定稿快照过时");

  // batch-2 含 4 小时断档
  const r2 = docs.filter((d): d is ReadingDoc => d.type === "reading" && d.batchId === "batch-2");
  const batch2 = docs.find((d) => d.id === "batch-2")! as unknown as { sampledAt: string };
  const resBatch2 = analyzeReadings(r2, batch2.sampledAt, 12, 820, 90);
  assert.ok(resBatch2.gapCount >= 1, "batch-2 应有断档");
  assert.ok(resBatch2.coverage < 1);
});

console.log(`\n全部 ${passed} 项测试通过`);
