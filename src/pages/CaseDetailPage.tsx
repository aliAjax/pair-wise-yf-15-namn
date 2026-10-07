import { useMemo, useState } from "react";
import { newId, store, useStore } from "../data/store";
import { buildBatchView, fmtDT, fmtTemp, toLocalInput } from "../domain/selectors";
import { PRESERVATION, preservationLabel, stageLabel } from "../domain/thermal";
import type { BatchDoc, PointDoc } from "../types";
import { Badge, Card, Field } from "../components/ui";

export default function CaseDetailPage({
  caseId,
  navigate,
}: {
  caseId: string;
  navigate: (hash: string) => void;
}) {
  const s = useStore();
  const gap = s.settings?.gapThresholdMin ?? 90;
  const caseDoc = s.cases.find((c) => c.id === caseId);
  const [addingPoint, setAddingPoint] = useState(false);
  const [addingBatch, setAddingBatch] = useState(false);
  const [pointName, setPointName] = useState("");
  const [pointMicro, setPointMicro] = useState("");
  const [batchPoint, setBatchPoint] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [batchAt, setBatchAt] = useState(() => toLocalInput(new Date().toISOString()));
  const [batchTemp, setBatchTemp] = useState("");
  const [batchBy, setBatchBy] = useState("");
  const [batchPres, setBatchPres] = useState<BatchDoc["preservation"]>("ethanol");

  const points = useMemo(
    () => s.points.filter((p) => p.caseId === caseId),
    [s.points, caseId],
  );
  const batches = useMemo(() => {
    return s.batches
      .filter((b) => b.caseId === caseId)
      .map((b) => buildBatchView(b, s.readings, s.identifications, s.species, gap))
      .sort((a, b) => b.batch.sampledAt.localeCompare(a.batch.sampledAt));
  }, [s.batches, s.readings, s.identifications, s.species, gap, caseId]);

  if (!caseDoc) {
    return (
      <div className="page">
        <div className="empty">案件不存在或已删除。</div>
        <p className="center">
          <button onClick={() => navigate("#/")}>返回批次列表</button>
        </p>
      </div>
    );
  }

  const patchCase = (patch: Partial<typeof caseDoc>) =>
    store.mutate({ ...caseDoc, ...patch }, "案件信息已更新");

  const addPoint = () => {
    if (!pointName.trim()) {
      store.notify("请填写采样点名称");
      return;
    }
    const doc: Omit<PointDoc, "updatedAt"> = {
      type: "point",
      id: newId("point"),
      caseId: caseDoc.id,
      name: pointName.trim(),
      microhabitat: pointMicro.trim(),
    };
    store.mutate(doc, "采样点已登记");
    setPointName("");
    setPointMicro("");
    setAddingPoint(false);
  };

  const addBatch = () => {
    if (!batchNo.trim() || !batchPoint) {
      store.notify("请填写批次号并选择采样点");
      return;
    }
    const t = Date.parse(batchAt);
    if (!Number.isFinite(t)) {
      store.notify("请填写有效采样时刻");
      return;
    }
    const doc: Omit<BatchDoc, "updatedAt"> = {
      type: "batch",
      id: newId("batch"),
      caseId: caseDoc.id,
      pointId: batchPoint,
      batchNo: batchNo.trim(),
      sampledAt: new Date(t).toISOString(),
      ambientTempC: batchTemp === "" ? null : Number(batchTemp),
      collectedBy: batchBy.trim() || caseDoc.examiner,
      preservation: batchPres,
    };
    store.mutate(doc, "采样批次已登记，可进入批次补录温度");
    setBatchNo("");
    setBatchTemp("");
    setAddingBatch(false);
  };

  return (
    <div className="page">
      <nav className="crumbs">
        <a href="#/" onClick={(e) => { e.preventDefault(); navigate("#/"); }}>批次</a>
        <span>›</span>
        <b>{caseDoc.caseNo}</b>
      </nav>

      <div className="detail-head">
        <div>
          <h1>{caseDoc.caseNo}</h1>
          <p className="muted">{caseDoc.location} · 发现于 {fmtDT(caseDoc.foundAt)} · {caseDoc.examiner}</p>
        </div>
        <Badge tone="blue">{batches.length} 个批次 · {points.length} 个采样点</Badge>
      </div>

      <div className="case-grid">
        <Card title="案件登记">
          <div className="form-grid">
            <Field label="案件编号">
              <input value={caseDoc.caseNo} onChange={(e) => patchCase({ caseNo: e.target.value })} />
            </Field>
            <Field label="现场类型">
              <input value={caseDoc.sceneType} onChange={(e) => patchCase({ sceneType: e.target.value })} />
            </Field>
            <Field label="发现地点">
              <input value={caseDoc.location} onChange={(e) => patchCase({ location: e.target.value })} />
            </Field>
            <Field label="发现时间">
              <input
                type="datetime-local"
                value={toLocalInput(caseDoc.foundAt)}
                onChange={(e) => patchCase({ foundAt: new Date(e.target.value).toISOString() })}
              />
            </Field>
            <Field label="现场勘验人">
              <input value={caseDoc.examiner} onChange={(e) => patchCase({ examiner: e.target.value })} />
            </Field>
          </div>
          <Field label="案情备注">
            <textarea rows={2} value={caseDoc.notes ?? ""} onChange={(e) => patchCase({ notes: e.target.value })} />
          </Field>
        </Card>

        <Card
          title="采样点"
          extra={<button className="btn-small" onClick={() => setAddingPoint((v) => !v)}>
            {addingPoint ? "取消" : "新增采样点"}
          </button>}
        >
          {addingPoint && (
            <div className="inline-form">
              <input placeholder="采样点名称，如 A点·头侧土壤" value={pointName} onChange={(e) => setPointName(e.target.value)} />
              <input placeholder="微生境（遮阴/向阳/土质）" value={pointMicro} onChange={(e) => setPointMicro(e.target.value)} />
              <button className="primary" onClick={addPoint}>登记</button>
            </div>
          )}
          <ul className="point-list">
            {points.map((p) => (
              <li key={p.id}>
                <b>{p.name}</b>
                <span className="muted">{p.microhabitat || "—"}{p.notes ? ` · ${p.notes}` : ""}</span>
              </li>
            ))}
            {points.length === 0 && <li className="muted">还没有采样点。</li>}
          </ul>
        </Card>
      </div>

      <Card
        title="该案件的采样批次"
        extra={
          <button
            className="btn-small primary"
            disabled={points.length === 0}
            onClick={() => {
              setBatchPoint((v) => v || points[0]?.id || "");
              setAddingBatch((v) => !v);
            }}
          >
            {addingBatch ? "取消" : "登记新批次"}
          </button>
        }
      >
        {points.length === 0 && (
          <div className="muted small">请先登记至少一个采样点，再登记批次。</div>
        )}
        {addingBatch && (
          <div className="inline-form grid4">
            <input placeholder="批次号，如 091-A02" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
            <select value={batchPoint} onChange={(e) => setBatchPoint(e.target.value)}>
              <option value="">选择采样点</option>
              {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="datetime-local" value={batchAt} onChange={(e) => setBatchAt(e.target.value)} />
            <input type="number" step="0.1" placeholder="现场温度℃" value={batchTemp} onChange={(e) => setBatchTemp(e.target.value)} />
            <input placeholder="采集人" value={batchBy} onChange={(e) => setBatchBy(e.target.value)} />
            <select value={batchPres} onChange={(e) => setBatchPres(e.target.value as BatchDoc["preservation"])}>
              {PRESERVATION.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select>
            <button className="primary" onClick={addBatch}>登记批次</button>
          </div>
        )}
        <div className="case-batches">
          {batches.map((v) => (
            <article
              key={v.batch.id}
              className="batch-row card clickable inner"
              onClick={() => navigate(`#/batch/${v.batch.id}`)}
            >
              <div className="batch-row-main">
                <div className="batch-row-top">
                  <h3>{v.batch.batchNo}</h3>
                  <span className="muted">{points.find((p) => p.id === v.batch.pointId)?.name ?? "—"}</span>
                </div>
                <div className="badge-line">
                  {v.identification ? (
                    <>
                      <Badge tone="green">{stageLabel(v.identification.stage)}</Badge>
                      <Badge tone="blue">{v.species?.commonName ?? "种属待选"}</Badge>
                      {v.identification.status === "final" && (
                        <Badge tone={v.finalStale ? "red" : "ghost"}>
                          {v.finalStale ? "定稿已过时" : "已定稿"}
                        </Badge>
                      )}
                    </>
                  ) : (
                    <Badge tone="amber">待鉴定</Badge>
                  )}
                  {v.thermal.gapCount > 0 && <Badge tone="amber">断档 {v.thermal.gapCount}</Badge>}
                </div>
              </div>
              <div className="batch-row-meta">
                <div>采样 {fmtDT(v.batch.sampledAt)}</div>
                <div>{preservationLabel(v.batch.preservation)} · 现场 {fmtTemp(v.batch.ambientTempC)}</div>
                <div>{v.readings.length} 条读数 · 均温 {fmtTemp(v.thermal.meanTempC)}</div>
                <div>{v.thermal.cumulativeADH != null ? `${Math.round(v.thermal.cumulativeADH)} ADH` : "积温 —"}</div>
              </div>
            </article>
          ))}
          {batches.length === 0 && <div className="empty">该案件还没有批次。</div>}
        </div>
      </Card>
    </div>
  );
}
