// React 渲染冒烟：jsdom 挂载整个应用并走完引导播种。
/** @jsxImportSource react */
import "fake-indexeddb/auto";
import { JSDOM } from "jsdom";
import assert from "node:assert";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost:62003/",
});
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
(globalThis as { localStorage: unknown }).localStorage = dom.window.localStorage;
class FakeChannel {
  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { BroadcastChannel: unknown }).BroadcastChannel = FakeChannel;
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: ReturnType<typeof setTimeout>) =>
  clearTimeout(id)) as typeof cancelAnimationFrame;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

const { createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { default: App } = await import("../src/App");

const container = document.getElementById("root")!;
const root = createRoot(container);
await act(async () => {
  root.render(createElement(App));
});
await act(async () => {
  await tick(30);
});

const text = container.textContent ?? "";
assert.ok(text.includes("采样批次"), "应渲染批次导航");
assert.ok(text.includes("发育阶段筛选"), "应渲染阶段筛选");
assert.ok(text.includes("CASE-2026-091"), "应渲染种子案件");
assert.ok(text.includes("定稿已过时") || text.includes("定稿过时"), "应显示过时标记");
console.log("  ✓ 列表页挂载：导航/筛选/案件/过时标记均渲染");

// 进入批次详情
window.location.hash = "#/batch/batch-1";
window.dispatchEvent(new dom.window.Event("hashchange"));
await act(async () => {
  await tick(10);
});
const d1 = container.textContent ?? "";
assert.ok(d1.includes("温度过程"), "详情页应有温度过程图");
assert.ok(d1.includes("积温结论"), "详情页应有积温结论");
assert.ok(d1.includes("ADH"), "应显示积温数值");
assert.ok(d1.includes("定稿版本链"), "应显示定稿版本链");
console.log("  ✓ 批次详情：温度过程、积温结论、版本链均渲染");

// 参数页
window.location.hash = "#/params";
window.dispatchEvent(new dom.window.Event("hashchange"));
await act(async () => {
  await tick(10);
});
const d2 = container.textContent ?? "";
assert.ok(d2.includes("联网与本地合并"), "参数页应渲染同步面板");
assert.ok(d2.includes("Lucilia sericata"), "参数页应列出种属参数");
console.log("  ✓ 参数页：同步状态与种属参数均渲染");

// 案件页
window.location.hash = "#/cases";
window.dispatchEvent(new dom.window.Event("hashchange"));
await act(async () => {
  await tick(10);
});
const d3 = container.textContent ?? "";
assert.ok(d3.includes("现场案件登记"), "案件页应渲染");
console.log("  ✓ 案件页挂载正常");

root.unmount();
console.log("\nReact 渲染冒烟全部通过");
process.exit(0);
