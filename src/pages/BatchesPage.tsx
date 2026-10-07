import { useMemo, useState } from "react";
import { useStore } from "../data/store";
import { buildBatchView, fmtDT, fmtTemp } from "../domain/selectors";
import { STAGES, stageLabel, hoursLabel } from "../domain/thermal";
import type { StageCode } from "../types";
import { Badge } from "../components/ui";

export default function BatchesPage({ navigate }: { navigate: (hash: string) => void }) {
  const s = useStore();
  const [stage, setStage] = useState<StageCode | "all" | "unstaged">("all");
  const [caseId, setCaseId] = useState<string>("all");
  const [q, setQ] = useState("");
  const gap = s.settings?.gapThresholdMin ?? 90;

  const views = useMemo(
    () =>
      s.batches
        .map((b) => buildBatchView(b, s.readings, s.identifications, s.species, gap))
        .sort((a, b) => b.batch.sampledAt.localeCompare(a.batch.sampledAt)),
    [s.batches, s.readings, s.identifications, s.species, gap],
  );

  const caseMap = useMemo(() => new Map(s.cases.map((c) => [c.id, c])), [s.cases]);
  const pointMap = useMemo(() => new Map(s.points.map((p) => [p.id, p])), [s.points]);

  const filtered = views.filter((v) => {
    if (caseId !== "all" && v.batch.caseId !== caseId) return false;
    if (stage === "unstaged" && v.identification) return false;
    if (stage !== "all" && stage !== "unstaged" && v.identification?.stage !== stage)
      return false;
    if (q.trim()) {
      const hay = `${v.batch.batchNo} ${caseMap.get(v.batch.caseId)?.caseNo ?? ""} ${
        pointMap.get(v.batch.pointId)?.name ?? ""
      } ${v.species?.commonName ?? ""}`;
      if (!hay.toLowerCase().includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  const staleCount = views.filter((v) => v.finalStale).length;
  const pendingId = s.batches.filter((b) =>
    !s.identifications.some((i) => i.batchId === b.id),
  ).length;
  const avgTemp =
    views.reduce((acc, v) => acc + (v.thermal.meanTempC ?? 0), 0) /
    Math.max(views.filter((v) => v.thermal.meanTempC != null).length, 1);

  const countOf = (code: StageCode | "all" | "unstaged") => {
    if (code === "all") return views.length;
    if (code === "unstaged") return pendingId;
    return views.filter((v) => v.identification?.stage === code).length;
  };

  return (
    <div className="page">
      <div className="metrics">
        <div className="metric"><small>采样批次</small><strong>{views.length}</strong></div>
        <div className="metric"><small>覆盖时段均温</small><strong>{isFinite(avgTemp) ? fmtTemp(avgTemp) : "—"}</strong></div>
        <div className="metric"><small>待实验室鉴定</small><strong>{pendingId}</strong></div>
        <div className={`metric ${staleCount ? "metric-alert" : ""}`}>
          <small>定稿已过时</small><strong>{staleCount}</strong>
        </div>
      </div>

      <div className="layout">
        <aside className="filters card">
          <h2>发育阶段筛选</h2>
          <button
            className={`filter-chip ${stage === "all" ? "on" : ""}`}
            onClick={() => setStage("all")}
          >
            全部 <em>{countOf("all")}</em>
          </button>
          {STAGES.map((st) => (
            <button
              key={st.code}
              className={`filter-chip ${stage === st.code ? "on" : ""}`}
              onClick={() => setStage(st.code)}
            >
              {st.label} <em>{countOf(st.code)}</em>
            </button>
          ))}
          <button
            className={`filter-chip ${stage === "unstaged" ? "on" : ""}`}
            onClick={() => setStage("unstaged")}
          >
            未鉴定 <em>{countOf("unstaged")}</em>
          </button>

          <h2 className="mt">案件</h2>
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="all">全部案件</option>
            {s.cases.map((c) => (
              <option key={c.id} value={c.id}>{c.caseNo}</option>
            ))}
          </select>

          <h2 className="mt">检索</h2>
          <input
            placeholder="批次号 / 地点 / 种属"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </aside>

        <section className="batch-list">
          {filtered.length === 0 && (
            <div className="empty">没有符合筛选条件的批次。</div>
          )}
          {filtered.map((v) => {
            const c = caseMap.get(v.batch.caseId);
            const p = pointMap.get(v.batch.pointId);
            return (
              <article
                key={v.batch.id}
                className="batch-row card clickable"
                onClick={() => navigate(`#/batch/${v.batch.id}`)}
              >
                <div className="batch-row-main">
                  <div className="batch-row-top">
                    <h3>{v.batch.batchNo}</h3>
                    <span className="muted">{c?.caseNo} · {p?.name ?? "采样点已删除"}</span>
                  </div>
                  <div className="badge-line">
                    {v.identification ? (
                      <>
                        <Badge tone="green">{stageLabel(v.identification.stage)}</Badge>
                        <Badge tone="blue">{v.species?.commonName ?? "种属待选"}</Badge>
                        {v.identification.status === "final" ? (
                          <Badge tone={v.finalStale ? "red" : "ghost"}>
                            {v.finalStale ? "定稿已过时" : `定稿 ${fmtDT(v.identification.finalizedAt).slice(5)}`}
                          </Badge>
                        ) : (
                          <Badge tone="amber">鉴定草稿</Badge>
                        )}
                      </>
                    ) : (
                      <Badge tone="amber">待实验室鉴定</Badge>
                    )}
                    {v.thermal.gapCount > 0 && (
                      <Badge tone="amber">温度断档 {v.thermal.gapCount} 处</Badge>
                    )}
                  </div>
                </div>
                <div className="batch-row-meta">
                  <div>采样 {fmtDT(v.batch.sampledAt)}</div>
                  <div>现场 {fmtTemp(v.batch.ambientTempC)} · 均温 {fmtTemp(v.thermal.meanTempC)}</div>
                  <div>{v.thermal.cumulativeADH != null ? `${Math.round(v.thermal.cumulativeADH)} ADH` : "积温 —"}</div>
                  <div>虫龄 {hoursLabel(v.thermal.ageHoursMin)}{v.thermal.ageHoursMax != null && v.thermal.ageHoursMax !== v.thermal.ageHoursMin ? ` ~ ${hoursLabel(v.thermal.ageHoursMax)}` : ""}</div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
