import { useEffect, useState } from "react";
import { StoreProvider, store, useStore } from "./data/store";
import BatchesPage from "./pages/BatchesPage";
import BatchDetailPage from "./pages/BatchDetailPage";
import CasesPage from "./pages/CasesPage";
import CaseDetailPage from "./pages/CaseDetailPage";
import ParamsPage from "./pages/ParamsPage";

function useHashRoute(): [string, (h: string) => void] {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = (h: string) => {
    window.location.hash = h;
  };
  return [hash, navigate];
}

function Header({ navigate }: { navigate: (h: string) => void }) {
  const s = useStore();
  const online = s.settings?.online ?? true;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="brand" onClick={() => navigate("#/")}>
          <span className="brand-mark">虫</span>
          <span className="brand-text">
            <b>法医昆虫学样品记录</b>
            <small>现场登记 · 积温反推 · 定稿留痕</small>
          </span>
        </button>
        <nav className="main-nav">
          <a href="#/" onClick={(e) => { e.preventDefault(); navigate("#/"); }}>采样批次</a>
          <a href="#/cases" onClick={(e) => { e.preventDefault(); navigate("#/cases"); }}>案件</a>
          <a href="#/params" onClick={(e) => { e.preventDefault(); navigate("#/params"); }}>参数与合并</a>
        </nav>
        <button
          className={`conn ${online ? "on" : "off"}`}
          title="点击进入参数页切换在线状态"
          onClick={() => navigate("#/params")}
        >
          <i className="dot" />
          {online ? "在线" : "离线"}
          {s.pendingCount > 0 && <span className="pending">{s.pendingCount}</span>}
        </button>
      </div>
    </header>
  );
}

function Shell() {
  const s = useStore();
  const [hash, navigate] = useHashRoute();

  if (!s.ready) {
    return (
      <div className="boot">
        <div className="boot-card">正在打开本地样品库…</div>
      </div>
    );
  }

  let page: React.ReactNode;
  const batchMatch = hash.match(/^#\/batch\/([\w-]+)/);
  const caseMatch = hash.match(/^#\/case\/([\w-]+)/);
  if (batchMatch) page = <BatchDetailPage batchId={batchMatch[1]} navigate={navigate} />;
  else if (caseMatch) page = <CaseDetailPage caseId={caseMatch[1]} navigate={navigate} />;
  else if (hash.startsWith("#/cases")) page = <CasesPage navigate={navigate} />;
  else if (hash.startsWith("#/params")) page = <ParamsPage />;
  else page = <BatchesPage navigate={navigate} />;

  return (
    <div className="shell">
      <Header navigate={navigate} />
      <main className="content">{page}</main>
      <footer className="footer">
        <span>
          数据保存在本机 IndexedDB · 照片不出本机 · 单据通过发件箱在联网时按时间戳合并 ·
          已定稿鉴定不可替换，仅以修订版追加
        </span>
        <button className="footer-reset" onClick={() => void store.flushOutbox(true)}>
          立即同步
        </button>
      </footer>
      {s.toast && <div className="toast">{s.toast}</div>}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
