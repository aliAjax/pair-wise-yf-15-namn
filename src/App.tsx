import { useState } from "react";
import "./styles.css";
import { setOnline, syncNow, useStore } from "./store";
import { fmtRelative } from "./utils";
import { CasesView } from "./views/Cases";
import { BatchesView } from "./views/Batches";
import { TemperatureView } from "./views/Temperature";
import { IdentifyView } from "./views/Identify";
import { Toast } from "./components/ui";

type Tab = "cases" | "batches" | "temperature" | "identify";

const TABS: { key: Tab; label: string }[] = [
  { key: "cases", label: "案件" },
  { key: "batches", label: "采样批次" },
  { key: "temperature", label: "温度记录" },
  { key: "identify", label: "鉴定结论" },
];

export default function App() {
  const { online, outbox, lastSyncAt, cases, batches, readings, identifications } = useStore();
  const [tab, setTab] = useState<Tab>("cases");
  const [toast, setToast] = useState("");

  const unsynced =
    cases.filter((c) => !c.synced).length +
    batches.filter((b) => !b.synced).length +
    readings.filter((r) => !r.synced).length +
    identifications.filter((i) => !i.synced).length;

  const doSync = () => {
    const report = syncNow();
    setToast(
      `已合并 ${report.merged} 项本地变更，整理乱序读数 ${report.reordered} 条，识别断档 ${report.gaps} 处。`
    );
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <div className="topbar__title">
            <span className="topbar__mark">法医昆虫学</span>
            <h1>样本记录系统</h1>
          </div>
          <p className="topbar__sub">
            现场按案件登记采样批次与环境温度，实验室鉴定暴露阶段与昆虫种属；离线本地暂存，联网合并，温度变动后积温重算。
          </p>
        </div>

        <div className="syncbar">
          <div className={`syncbar__status ${online ? "is-online" : "is-offline"}`}>
            <span className="syncbar__dot" />
            {online ? "在线" : "离线"}
          </div>
          <div className="syncbar__meta">
            {online ? (
              <span>上次同步 {fmtRelative(lastSyncAt)}</span>
            ) : (
              <span>离线记录将保存在本机，联网后合并</span>
            )}
            {unsynced > 0 ? <span className="syncbar__pending">待同步 {unsynced}</span> : null}
          </div>
          <button
            className="btn"
            onClick={() => setOnline(!online)}
            title="手动模拟联网 / 断网"
          >
            {online ? "模拟断网" : "模拟联网"}
          </button>
          <button className="btn btn--primary" onClick={doSync} disabled={!online}>
            立即同步
          </button>
        </div>
      </header>

      <nav className="nav">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "nav__btn nav__btn--active" : "nav__btn"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "identify" &&
            identifications.some((i) => i.finalized && isOutdatedQuick(i, readings, batches)) ? (
              <i className="nav__dot" />
            ) : null}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === "cases" && <CasesView />}
        {tab === "batches" && <BatchesView />}
        {tab === "temperature" && <TemperatureView />}
        {tab === "identify" && <IdentifyView />}
      </main>

      <footer className="footer">
        <span>数据保存在浏览器本地（localStorage），断网可用；定稿结论不可替换，过时结论以红色标记。</span>
      </footer>

      {toast ? <Toast message={toast} onClose={() => setToast("")} /> : null}
    </div>
  );
}

function isOutdatedQuick(
  ident: { finalized: boolean; tempHash: string; batchId: string },
  readings: { caseId: string; ts: number; value: number }[],
  batches: { id: string; caseId: string }[]
): boolean {
  if (!ident.finalized || !ident.tempHash) return false;
  const batch = batches.find((b) => b.id === ident.batchId);
  if (!batch) return false;
  const s = readings
    .filter((r) => r.caseId === batch.caseId)
    .sort((a, b) => a.ts - b.ts)
    .map((r) => `${r.ts}:${r.value}`)
    .join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) !== ident.tempHash;
}
