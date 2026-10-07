import { useMemo, useState } from "react";
import { newId, store, useStore } from "../data/store";
import { fmtDT, toLocalInput, buildBatchView } from "../domain/selectors";
import type { CaseDoc } from "../types";
import { Badge, Card } from "../components/ui";

export default function CasesPage({ navigate }: { navigate: (hash: string) => void }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [caseNo, setCaseNo] = useState("");
  const [location, setLocation] = useState("");
  const [sceneType, setSceneType] = useState("室外");
  const [foundAt, setFoundAt] = useState(() => toLocalInput(new Date().toISOString()));
  const [examiner, setExaminer] = useState("");
  const [notes, setNotes] = useState("");

  const stats = useMemo(() => {
    const m = new Map<string, { batches: number; points: number; stale: number; pending: number }>();
    for (const c of s.cases) m.set(c.id, { batches: 0, points: 0, stale: 0, pending: 0 });
    for (const p of s.points) {
      const row = m.get(p.caseId);
      if (row) row.points++;
    }
    const gap = s.settings?.gapThresholdMin ?? 90;
    for (const b of s.batches) {
      const row = m.get(b.caseId);
      if (!row) continue;
      row.batches++;
      const v = buildBatchView(b, s.readings, s.identifications, s.species, gap);
      if (!v.identification) row.pending++;
      if (v.finalStale) row.stale++;
    }
    return m;
  }, [s.cases, s.points, s.batches, s.readings, s.identifications, s.species, s.settings]);

  const create = () => {
    if (!caseNo.trim()) {
      store.notify("请填写案件编号");
      return;
    }
    const t = Date.parse(foundAt);
    const doc: Omit<CaseDoc, "updatedAt"> = {
      type: "case",
      id: newId("case"),
      caseNo: caseNo.trim(),
      location: location.trim() || "—",
      sceneType: sceneType.trim() || "室外",
      foundAt: Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(),
      examiner: examiner.trim(),
      notes: notes.trim() || undefined,
    };
    store.mutate(doc, "案件已登记，可继续添加采样点与批次");
    setCaseNo("");
    setLocation("");
    setExaminer("");
    setNotes("");
    setOpen(false);
    navigate(`#/case/${doc.id}`);
  };

  return (
    <div className="page">
      <Card
        title="现场案件登记"
        extra={
          <button className="btn-small primary" onClick={() => setOpen((v) => !v)}>
            {open ? "取消" : "登记新案件"}
          </button>
        }
      >
        {open && (
          <div className="new-case-form">
            <div className="form-grid">
              <label className="field">
                <span className="field-label">案件编号 *</span>
                <input placeholder="CASE-2026-092" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">现场类型</span>
                <input value={sceneType} onChange={(e) => setSceneType(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">发现地点</span>
                <input value={location} onChange={(e) => setLocation(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">发现时间</span>
                <input type="datetime-local" value={foundAt} onChange={(e) => setFoundAt(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">勘验人</span>
                <input value={examiner} onChange={(e) => setExaminer(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span className="field-label">现场概况</span>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <button className="primary" onClick={create}>保存并进入案件</button>
          </div>
        )}
      </Card>

      <div className="case-list">
        {s.cases
          .slice()
          .sort((a, b) => b.foundAt.localeCompare(a.foundAt))
          .map((c) => {
            const row = stats.get(c.id);
            return (
              <article
                key={c.id}
                className="card clickable case-row"
                onClick={() => navigate(`#/case/${c.id}`)}
              >
                <div>
                  <h3>{c.caseNo}</h3>
                  <p className="muted">{c.location} · {c.sceneType}</p>
                  <p className="muted small">发现 {fmtDT(c.foundAt)} · {c.examiner || "勘验人未填"}</p>
                  {c.notes && <p className="small">{c.notes}</p>}
                </div>
                <div className="badge-line case-stats">
                  <Badge tone="blue">{row?.batches ?? 0} 批次</Badge>
                  <Badge tone="ghost">{row?.points ?? 0} 采样点</Badge>
                  {(row?.pending ?? 0) > 0 && <Badge tone="amber">{row?.pending} 待鉴定</Badge>}
                  {(row?.stale ?? 0) > 0 && <Badge tone="red">{row?.stale} 定稿过时</Badge>}
                </div>
              </article>
            );
          })}
      </div>
    </div>
  );
}
