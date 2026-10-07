// 批次视图：全部采样批次，按发育阶段 / 状态 / 案件筛选，点击看详情卡
import { useMemo, useState } from "react";
import { STAGES } from "../types";
import type { Stage } from "../types";
import { isOutdated, useStore } from "../store";
import { BatchCard } from "../components/BatchCard";
import { BatchDetailModal } from "../components/BatchDetail";
import { EmptyState } from "../components/ui";

type StageFilter = Stage | "全部";
type StatusFilter = "全部" | "待鉴定" | "已定稿" | "已过时";

export function BatchesView() {
  const { cases, batches, readings, identifications } = useStore();
  const [stage, setStage] = useState<StageFilter>("全部");
  const [status, setStatus] = useState<StatusFilter>("全部");
  const [caseId, setCaseId] = useState<string>("全部");
  const [keyword, setKeyword] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return batches.filter((b) => {
      if (caseId !== "全部" && b.caseId !== caseId) return false;
      const ident = identifications.find((i) => i.batchId === b.id);
      if (stage !== "全部" && ident?.stage !== stage) return false;
      const outdated = isOutdated(ident, readings, b.caseId);
      const finalized = ident?.finalized ?? false;
      if (status === "待鉴定" && finalized) return false;
      if (status === "已定稿" && (!finalized || outdated)) return false;
      if (status === "已过时" && !outdated) return false;
      if (keyword.trim()) {
        const k = keyword.trim().toLowerCase();
        const caseRec = cases.find((c) => c.id === b.caseId);
        const hay = `${b.batchNo} ${b.samplingPoint} ${caseRec?.caseNo ?? ""} ${ident?.species ?? ""}`.toLowerCase();
        if (!hay.includes(k)) return false;
      }
      return true;
    });
  }, [batches, identifications, readings, stage, status, caseId, keyword, cases]);

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <h2>采样批次</h2>
          <p>按发育阶段筛选批次；点击卡片查看温度过程、积温与鉴定结论。</p>
        </div>
      </div>

      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-group__label">发育阶段</span>
          <div className="chips">
            {(["全部", ...STAGES] as StageFilter[]).map((s) => (
              <button
                key={s}
                className={stage === s ? "chip chip--active" : "chip"}
                onClick={() => setStage(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-group__label">鉴定状态</span>
          <div className="chips">
            {(["全部", "待鉴定", "已定稿", "已过时"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                className={status === s ? "chip chip--active" : "chip"}
                onClick={() => setStatus(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-group__label">案件</span>
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="全部">全部案件</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>{c.caseNo}</option>
            ))}
          </select>
        </div>

        <div className="filter-group filter-group--search">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索批次 / 采样点 / 种属"
          />
        </div>
      </div>

      <p className="filter-count">共 {filtered.length} 个批次</p>

      {filtered.length === 0 ? (
        <EmptyState title="没有匹配的批次" hint="调整筛选条件，或先去案件页登记批次。" />
      ) : (
        <div className="batch-grid">
          {filtered.map((b) => (
            <BatchCard key={b.id} batch={b} onClick={() => setSelectedBatchId(b.id)} />
          ))}
        </div>
      )}

      <BatchDetailModal batchId={selectedBatchId} onClose={() => setSelectedBatchId(null)} />
    </div>
  );
}
