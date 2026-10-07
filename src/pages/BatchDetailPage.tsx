import { useMemo, useRef, useState } from "react";
import { newId, store, useStore } from "../data/store";
import {
  buildBatchView,
  fmtDT,
  fmtTemp,
  toLocalInput,
  type BatchView,
} from "../domain/selectors";
import {
  EXPOSURE,
  PRESERVATION,
  STAGES,
  exposureLabel,
  hoursLabel,
  makeSnapshot,
  parseReadingsCSV,
  preservationLabel,
  stageLabel,
  toReadingsCSV,
} from "../domain/thermal";
import type {
  BatchDoc,
  ExposureCode,
  IdentificationDoc,
  PreservationKind,
  ReadingDoc,
  StageCode,
} from "../types";
import { Badge, Card, Field, PhotoAttach, TemperatureChart, ThermalPanel } from "../components/ui";

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function BatchDetailPage({
  batchId,
  navigate,
}: {
  batchId: string;
  navigate: (hash: string) => void;
}) {
  const s = useStore();
  const gap = s.settings?.gapThresholdMin ?? 90;
  const batch = s.batches.find((b) => b.id === batchId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [newT, setNewT] = useState(() => toLocalInput(new Date().toISOString()));
  const [newC, setNewC] = useState("");

  const view = useMemo(
    () =>
      batch
        ? buildBatchView(batch, s.readings, s.identifications, s.species, gap)
        : null,
    [batch, s.readings, s.identifications, s.species, gap],
  );

  if (!batch || !view) {
    return (
      <div className="page">
        <div className="empty">批次不存在或已删除。</div>
        <p className="center">
          <button onClick={() => navigate("#/")}>返回批次列表</button>
        </p>
      </div>
    );
  }
  const caseDoc = s.cases.find((c) => c.id === batch.caseId);
  const point = s.points.find((p) => p.id === batch.pointId);

  const patchBatch = (patch: Partial<BatchDoc>) =>
    store.mutate({ ...batch, ...patch }, "批次信息已更新");

  const addManualReading = () => {
    const c = Number(newC);
    const t = Date.parse(newT);
    if (!Number.isFinite(c) || !Number.isFinite(t)) {
      store.notify("请填写有效的时间与温度");
      return;
    }
    const nowIso = new Date().toISOString();
    const doc: Omit<ReadingDoc, "updatedAt"> = {
      type: "reading",
      id: newId("rd"),
      batchId: batch.id,
      t: new Date(t).toISOString(),
      c,
      receivedAt: nowIso,
      source: "manual",
    };
    store.mutate(doc, "温度读数已记录");
    setNewC("");
  };

  const importCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseReadingsCSV(String(reader.result));
      if (rows.length === 0) {
        store.notify("CSV 中没有可识别的行（格式：时间ISO,温度）");
        return;
      }
      const nowIso = new Date().toISOString();
      const docs: Omit<ReadingDoc, "updatedAt">[] = rows.map((r, i) => ({
        type: "reading",
        id: newId(`rd${i}`),
        batchId: batch.id,
        t: r.t,
        c: r.c,
        receivedAt: nowIso,
        source: "manual",
        note: "CSV导入",
      }));
      store.bulkAddReadings(docs);
    };
    reader.readAsText(file);
  };

  const finalizeCurrent = () => {
    const cur = view.identification;
    if (!cur) return;
    if (!cur.speciesId) {
      store.notify("请先选择昆虫种属再定稿");
      return;
    }
    const now = new Date().toISOString();
    // 定稿：把当前草稿转成不可变文档（保留同一内容的快照）
    const finalized: IdentificationDoc = {
      ...cur,
      status: "final",
      finalizedAt: now,
      snapshot: makeSnapshot(
        view.readings,
        view.species?.baseTempC ?? 10,
        view.thermal.targetADH,
        gap,
        view.thermal,
      ),
    };
    try {
      store.mutate(finalized, "鉴定已定稿：内容冻结，后续温度变化只会标记过时，不会替换结论");
    } catch (e) {
      store.notify((e as Error).message);
    }
  };

  const createRevision = () => {
    const baseDoc = view.finals[0] ?? view.identification;
    if (!baseDoc) return;
    const draft: IdentificationDoc = {
      ...baseDoc,
      id: newId("id"),
      versionOf: baseDoc.id,
      status: "draft",
      finalizedAt: undefined,
      snapshot: undefined,
      basis: baseDoc.basis ? `${baseDoc.basis}\n\n【修订】` : "",
    };
    store.mutate(draft, "已基于最新定稿创建修订草稿，原结论保留不变");
  };

  return (
    <div className="page detail-page">
      <nav className="crumbs">
        <a href="#/" onClick={(e) => { e.preventDefault(); navigate("#/"); }}>批次</a>
        <span>›</span>
        <a href={`#/case/${batch.caseId}`} onClick={(e) => { e.preventDefault(); navigate(`#/case/${batch.caseId}`); }}>
          {caseDoc?.caseNo ?? "案件"}
        </a>
        <span>›</span>
        <b>{batch.batchNo}</b>
      </nav>

      <div className="detail-head">
        <div>
          <h1>{batch.batchNo}</h1>
          <p className="muted">{point?.name} · {caseDoc?.location} · 采样 {fmtDT(batch.sampledAt)}</p>
        </div>
        <div className="badge-line">
          {view.identification ? (
            <>
              <Badge tone="green">{stageLabel(view.identification.stage)}</Badge>
              <Badge tone="blue">{view.species?.commonName ?? "种属待选"}</Badge>
              {view.identification.status === "final" ? (
                <Badge tone={view.finalStale ? "red" : "ghost"}>
                  {view.finalStale ? "定稿已过时 · 建议出修订版" : "已定稿"}
                </Badge>
              ) : (
                <Badge tone="amber">草稿</Badge>
              )}
            </>
          ) : (
            <Badge tone="amber">待鉴定</Badge>
          )}
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <Card title="温度过程（传感器可乱序到达 / 断档）">
            <TemperatureChart view={view} />
          </Card>

          <Card
            title="积温结论"
            extra={<Badge tone="ghost">每次温度改动自动重算</Badge>}
          >
            <ThermalPanel view={view} />
          </Card>

          <Card
            title="温度读数明细"
            extra={
              <div className="btn-row">
                <button className="btn-small" onClick={() => fileRef.current?.click()}>
                  导入 CSV
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importCSV(f);
                    e.target.value = "";
                  }}
                />
                <button
                  className="btn-small"
                  onClick={() =>
                    download(`${batch.batchNo}-温度.csv`, toReadingsCSV(view.readings))
                  }
                >
                  导出 CSV
                </button>
              </div>
            }
          >
            <div className="reading-add">
              <input
                type="datetime-local"
                value={newT}
                onChange={(e) => setNewT(e.target.value)}
              />
              <input
                type="number"
                step="0.1"
                placeholder="温度 ℃（含断档补录）"
                value={newC}
                onChange={(e) => setNewC(e.target.value)}
              />
              <button className="primary" onClick={addManualReading}>补录读数</button>
            </div>
            <div className="table-scroll">
              <table className="readings-table">
                <thead>
                  <tr>
                    <th>时刻</th><th>温度</th><th>来源</th><th>备注</th><th />
                  </tr>
                </thead>
                <tbody>
                  {[...view.readings].reverse().map((r) => {
                    const after = new Date(r.t) > new Date(batch.sampledAt);
                    return (
                      <tr key={r.id} className={after ? "row-after" : ""}>
                        <td>{fmtDT(r.t)}{after && <Badge tone="ghost"> 采样后</Badge>}</td>
                        <td>{r.c} ℃</td>
                        <td>{r.source === "sensor" ? "传感器" : "人工"}</td>
                        <td className="muted">{r.note ?? ""}</td>
                        <td>
                          <button
                            className="link-danger"
                            onClick={() => void store.softDelete(r)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <IdentificationSection view={view} gap={gap} onFinalize={finalizeCurrent} onRevise={createRevision} />
        </div>

        <aside className="detail-side">
          <Card title="现场登记信息">
            <div className="side-form">
              <Field label="采样点">
                <select
                  value={batch.pointId}
                  onChange={(e) => patchBatch({ pointId: e.target.value })}
                >
                  {s.points.filter((p) => p.caseId === batch.caseId).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="采样时刻（积温窗口终点）">
                <input
                  type="datetime-local"
                  value={toLocalInput(batch.sampledAt)}
                  onChange={(e) =>
                    patchBatch({ sampledAt: new Date(e.target.value).toISOString() })
                  }
                />
              </Field>
              <Field label="现场环境温度 ℃">
                <input
                  type="number"
                  step="0.1"
                  value={batch.ambientTempC ?? ""}
                  onChange={(e) =>
                    patchBatch({ ambientTempC: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="采集人">
                <input value={batch.collectedBy} onChange={(e) => patchBatch({ collectedBy: e.target.value })} />
              </Field>
              <Field label="保存方式">
                <select
                  value={batch.preservation}
                  onChange={(e) => patchBatch({ preservation: e.target.value as PreservationKind })}
                >
                  {PRESERVATION.map((p) => (
                    <option key={p.code} value={p.code}>{p.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="批次备注">
                <textarea rows={3} value={batch.notes ?? ""} onChange={(e) => patchBatch({ notes: e.target.value })} />
              </Field>
              <div className="muted small">
                当前保存：{preservationLabel(batch.preservation)} · {fmtTemp(batch.ambientTempC)}
              </div>
              <button
                className="link-danger btn-small"
                onClick={() => {
                  if (confirm("删除该批次？其温度读数与鉴定将不再显示（发墓碑同步）。")) {
                    void store.softDelete(batch).then(() => navigate("#/"));
                  }
                }}
              >
                删除批次
              </button>
            </div>
          </Card>
          <Card title="样本照片">
            <PhotoAttach photoKey={`batch:${batch.id}`} />
          </Card>
        </aside>
      </div>
    </div>
  );
}

function IdentificationSection({
  view,
  gap,
  onFinalize,
  onRevise,
}: {
  view: BatchView;
  gap: number;
  onFinalize: () => void;
  onRevise: () => void;
}) {
  const s = useStore();
  const cur = view.identification;

  const patchDraft = (patch: Partial<IdentificationDoc>) => {
    if (!cur || cur.status === "final") return;
    store.mutate({ ...cur, ...patch });
  };

  const createBlank = () => {
    const draft: Omit<IdentificationDoc, "updatedAt"> = {
      type: "identification",
      id: newId("id"),
      batchId: view.batch.id,
      versionOf: null,
      status: "draft",
      stage: "instar1",
      speciesId: "",
      exposureStage: "fresh",
      analyst: "",
      lab: "",
      basis: "",
    };
    store.mutate(draft, "已创建鉴定草稿");
  };

  return (
    <Card
      title="实验室鉴定"
      extra={
        cur?.status === "draft" ? (
          <div className="btn-row">
            <button className="btn-small" onClick={onFinalize}>定稿（冻结）</button>
          </div>
        ) : cur?.status === "final" ? (
          <button className="btn-small" onClick={onRevise}>新建修订版</button>
        ) : undefined
      }
    >
      {!cur && (
        <div className="empty-inline">
          <span>该批次还没有鉴定记录。</span>
          <button className="primary" onClick={createBlank}>新建鉴定</button>
        </div>
      )}

      {cur?.status === "draft" && (
        <div className="id-form">
          <div className="form-grid">
            <Field label="昆虫种属">
              <select
                value={cur.speciesId}
                onChange={(e) => patchDraft({ speciesId: e.target.value as IdentificationDoc["speciesId"] })}
              >
                <option value="">请选择…</option>
                {s.species.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.commonName}（{sp.scientificName}）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="发育阶段">
              <select value={cur.stage} onChange={(e) => patchDraft({ stage: e.target.value as StageCode })}>
                {STAGES.map((st) => (
                  <option key={st.code} value={st.code}>{st.label}</option>
                ))}
              </select>
            </Field>
            <Field label="尸体暴露阶段">
              <select
                value={cur.exposureStage}
                onChange={(e) => patchDraft({ exposureStage: e.target.value as ExposureCode })}
              >
                {EXPOSURE.map((x) => (
                  <option key={x.code} value={x.code}>{x.label}</option>
                ))}
              </select>
            </Field>
            <Field label="鉴定人">
              <input value={cur.analyst} onChange={(e) => patchDraft({ analyst: e.target.value })} />
            </Field>
            <Field label="实验室">
              <input value={cur.lab} onChange={(e) => patchDraft({ lab: e.target.value })} />
            </Field>
          </div>
          <Field label="鉴定依据 / 备注">
            <textarea rows={3} value={cur.basis} onChange={(e) => patchDraft({ basis: e.target.value })} />
          </Field>
          <div className="muted small">
            草稿可反复修改；点"定稿"后内容冻结并保存积温快照，虫龄 {hoursLabel(view.thermal.ageHoursMin)} ~ {hoursLabel(view.thermal.ageHoursMax)}。
          </div>
        </div>
      )}

      {cur?.status === "final" && (
        <FinalSummary id={cur} view={view} gap={gap} />
      )}

      {view.finals.length > 0 && (
        <div className="version-list">
          <h3>定稿版本链（不可替换，仅可追加）</h3>
          {view.finals.map((f) => {
            const sp = s.species.find((x) => x.id === f.speciesId);
            return (
              <article key={f.id} className={`version-item ${f === view.finals[0] && view.finalStale ? "stale" : ""}`}>
                <div className="badge-line">
                  <Badge tone={f === view.finals[0] && view.finalStale ? "red" : "ghost"}>
                    {f === view.finals[0]
                      ? view.finalStale ? "最新定稿 · 已过时" : "最新定稿"
                      : "历史定稿"}
                  </Badge>
                  <Badge tone="green">{stageLabel(f.stage)}</Badge>
                  <span className="muted small">{sp?.commonName} · {exposureLabel(f.exposureStage)} · 定稿于 {fmtDT(f.finalizedAt)} · {f.analyst}</span>
                </div>
                <p>{f.basis}</p>
                {f.snapshot && (
                  <dl className="snapshot">
                    <dt>定稿时积温</dt><dd>{f.snapshot.cumulativeADH != null ? `${Math.round(f.snapshot.cumulativeADH)} ADH` : "—"}</dd>
                    <dt>定稿时虫龄</dt>
                    <dd>
                      {hoursLabel(f.snapshot.ageHoursMin)}
                      {f.snapshot.ageHoursMax != null && f.snapshot.ageHoursMax !== f.snapshot.ageHoursMin
                        ? ` ~ ${hoursLabel(f.snapshot.ageHoursMax)}`
                        : ""}
                    </dd>
                    <dt>读数哈希</dt><dd><code>{f.snapshot.readingsHash}</code>（{f.snapshot.readingCount} 条）</dd>
                  </dl>
                )}
              </article>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function FinalSummary({
  id,
  view,
  gap: _gap,
}: {
  id: IdentificationDoc;
  view: BatchView;
  gap: number;
}) {
  const s = useStore();
  const sp = s.species.find((x) => x.id === id.speciesId);
  return (
    <div className="final-summary">
      <div className="form-grid">
        <div className="readonly"><small>种属</small><b>{sp ? `${sp.commonName}（${sp.scientificName}）` : "—"}</b></div>
        <div className="readonly"><small>发育阶段</small><b>{stageLabel(id.stage)}</b></div>
        <div className="readonly"><small>暴露阶段</small><b>{exposureLabel(id.exposureStage)}</b></div>
        <div className="readonly"><small>鉴定人 / 实验室</small><b>{id.analyst} · {id.lab}</b></div>
      </div>
      <p className="basis">{id.basis}</p>
      {view.finalStale && (
        <div className="stale-banner">
          <strong>该定稿已过时：</strong>定稿后温度记录或种属积温参数发生变化。
          当前重算虫龄为 {hoursLabel(view.thermal.ageHoursMin)} ~ {hoursLabel(view.thermal.ageHoursMax)}
          （定稿时 {hoursLabel(id.snapshot?.ageHoursMin ?? null)} ~ {hoursLabel(id.snapshot?.ageHoursMax ?? null)}）。
          原结论依法保留，如需采纳新结果请新建修订版。
        </div>
      )}
    </div>
  );
}
