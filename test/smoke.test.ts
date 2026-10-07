// 端到端冒烟：在 Node 中模拟 IndexedDB + 中继，走完整 store 生命周期。
import "fake-indexeddb/auto";
import assert from "node:assert";
import { store } from "../src/data/store";
import { buildBatchView } from "../src/domain/selectors";
import { getAll, STORE } from "../src/data/db";
import type { BatchDoc, IdentificationDoc } from "../src/types";

class FakeLocalStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
class FakeChannel {
  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { localStorage: unknown }).localStorage = new FakeLocalStorage();
(globalThis as { BroadcastChannel: unknown }).BroadcastChannel = FakeChannel;
(globalThis as { window: unknown }).window = { addEventListener() {}, removeEventListener() {} };

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  await store.boot();
  const s0 = store.state;
  assert.strictEqual(s0.ready, true);
  assert.ok(s0.batches.length >= 3, "应播种 3 个批次");
  assert.ok(s0.readings.length > 100, "应播种大量温度读数");
  assert.strictEqual(s0.pendingCount, 0, "播种后发件箱应为空");

  const gap = s0.settings!.gapThresholdMin;
  const v1 = buildBatchView(s0.batches.find((b) => b.id === "batch-1")!, s0.readings, s0.identifications, s0.species, gap);
  assert.strictEqual(v1.identification?.status, "final");
  assert.strictEqual(v1.finalStale, true, "定稿后补录夜间温度 → 过时");
  console.log("  ✓ 播种：batch-1 定稿因补录读数显示过时");

  // 断网：两处变更只积压，不推中继
  await store.setOnline(false);
  const relayBefore = localStorage.getItem("forensic-entomo.relay.v1")!;
  store.mutate({ ...s0.batches.find((b) => b.id === "batch-2")!, notes: "断网现场补充：设备进水，部分读数缺失" });
  await tick();
  store.mutate({ ...store.state.batches.find((b) => b.id === "batch-2")!, ambientTempC: 24.6 });
  await tick();
  assert.ok(store.state.pendingCount >= 3, "离线变更应在发件箱积压");
  assert.strictEqual(localStorage.getItem("forensic-entomo.relay.v1"), relayBefore, "离线时中继不得变化");
  console.log(`  ✓ 断网：${store.state.pendingCount} 项变更积压在本机，中继未动`);

  // 联网：自动推送 + LWW 拉取，发件箱清空
  await store.setOnline(true);
  await tick(20);
  assert.strictEqual(store.state.pendingCount, 0, "联网合并后发件箱清空");
  const updated = store.state.batches.find((b) => b.id === "batch-2")!;
  assert.ok(updated.notes!.includes("设备进水"), "离线编辑应已合并");
  assert.strictEqual(updated.ambientTempC, 24.6);
  console.log("  ✓ 联网：发件箱重放成功，离线编辑已合并");

  // 定稿不可变：直接 mutate 抛错
  const id1 = store.state.identifications.find((i) => i.id === "id-1") as IdentificationDoc;
  assert.throws(
    () => store.mutate({ ...id1, basis: "试图篡改原始定稿" }),
    /不可修改/,
  );
  console.log("  ✓ 定稿保护：篡改定稿在客户端被拒绝");

  // 温度删除（墓碑）→ 积温重算 → 过时消失（哈希回到定稿快照）
  const late = store.state.readings.find((r) => r.id === "batch-1-rlate");
  assert.ok(late, "应存在补录的夜间读数");
  await store.softDelete(late!);
  await tick(20);
  const v1again = buildBatchView(
    store.state.batches.find((b) => b.id === "batch-1")!,
    store.state.readings,
    store.state.identifications,
    store.state.species,
    gap,
  );
  assert.strictEqual(v1again.finalStale, false, "撤销补录后定稿应重新变为现行");
  assert.ok(v1again.readings.every((r) => r.id !== "batch-1-rlate"));
  console.log("  ✓ 重算：删除补录读数后积温回到定稿状态，过时标记自动消失");

  // 乱序/断档在演示数据上可观测
  const v2 = buildBatchView(
    store.state.batches.find((b) => b.id === "batch-2")!,
    store.state.readings,
    store.state.identifications,
    store.state.species,
    gap,
  );
  assert.ok(v2.thermal.gapCount >= 1, "batch-2 应检出断档");
  const v1views = buildBatchView(
    store.state.batches.find((b) => b.id === "batch-1")!,
    store.state.readings,
    store.state.identifications,
    store.state.species,
    gap,
  );
  void v1views;
  console.log(`  ✓ 断档检测：batch-2 检出 ${v2.thermal.gapCount} 处，覆盖率 ${Math.round(v2.thermal.coverage * 100)}%`);

  // 乱序：按"到达本机时间 receivedAt"排序后对照测量时刻
  const rawR1 = store.state.readings.filter((r) => r.batchId === "batch-1");
  const arrival = [...rawR1].sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt) || a.t.localeCompare(b.t),
  );
  let inversions = 0;
  for (let i = 1; i < arrival.length; i++) if (arrival[i].t < arrival[i - 1].t) inversions++;
  assert.ok(inversions >= 2, "乱序读数应在到达顺序中检出");
  console.log(`  ✓ 乱序保留：按到达时间检出 ${inversions} 处晚到读数，计算侧自动重排`);

  // 修订版：复制定稿为新草稿，原定稿仍在
  const rev: Omit<IdentificationDoc, "updatedAt"> = {
    ...id1,
    id: "id-revision-test",
    versionOf: id1.id,
    status: "draft",
    finalizedAt: undefined,
    snapshot: undefined,
    basis: "复核后维持原种属判断。",
  };
  store.mutate(rev);
  await tick(20);
  const finals = store.state.identifications.filter((i) => i.batchId === "batch-1" && i.status === "final");
  assert.ok(finals.some((f) => f.id === "id-1" && f.basis.includes("后气门形态")), "原定稿必须保留");
  assert.ok(store.state.identifications.some((i) => i.id === "id-revision-test"));
  console.log("  ✓ 版本链：修订草稿可新建，原定稿原样保留");

  // 墓碑确实落库
  const allReadings = await getAll(STORE.readings);
  const tomb = allReadings.find((r) => r.id === "batch-1-rlate");
  assert.strictEqual(tomb?.deleted, true, "删除应保留墓碑用于同步");
  console.log("  ✓ 删除以墓碑形式保留，可同步到其他设备");

  console.log("\n端到端冒烟全部通过");
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
