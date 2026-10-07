// 案件视图：案件列表 + 案件样本关联页（批次 + 温度过程）
import { useMemo, useState } from "react";
import type { CaseRecord } from "../types";
import {
  calcADD,
  deleteCase,
  findGaps,
  readingsForCase,
  useStore,
} from "../store";
import { fmtDateTime } from "../utils";
import { BatchCard } from "../components/BatchCard";
import { BatchDetailModal } from "../components/BatchDetail";
import { TemperatureChart } from "../components/TemperatureChart";
import { BatchFormModal, CaseFormModal, ReadingFormModal } from "../components/forms";
import { Badge, EmptyState } from "../components/ui";

export function CasesView() {
  const { cases, batches, readings } = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caseFormOpen, setCaseFormOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<CaseRecord | undefined>();

  const selected = cases.find((c) => c.id === selectedId);

  if (selected) {
    return (
      <CaseDetail
        caseRec={selected}
        onBack={() => setSelectedId(null)}
        onEdit={() => {
          setEditingCase(selected);
          setCaseFormOpen(true);
        }}
      />
    );
  }

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <h2>案件</h2>
          <p>按案件登记采样批次、采样点与环境温度，鉴定结论由实验室定稿。</p>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => {
            setEditingCase(undefined);
            setCaseFormOpen(true);
          }}
        >
          + 新增案件
        </button>
      </div>

      {cases.length === 0 ? (
        <EmptyState
          title="暂无案件"
          hint="新增一个案件，开始登记采样批次与温度记录。"
          action={
            <button className="btn btn--primary" onClick={() => setCaseFormOpen(true)}>
              新增案件
            </button>
          }
        />
      ) : (
        <div className="case-list">
          {cases.map((c) => {
            const caseBatches = batches.filter((b) => b.caseId === c.id);
            const caseReadings = readingsForCase(readings, c.id);
            const add = calcADD(readings, c.id, 10);
            const gaps = findGaps(readings, c.id);
            return (
              <article
                key={c.id}
                className="case-card"
                onClick={() => setSelectedId(c.id)}
              >
                <div className="case-card__main">
                  <div className="case-card__title-row">
                    <strong className="case-card__no">{c.caseNo}</strong>
                    <h3>{c.title}</h3>
                    {!c.synced ? <Badge tone="amber">待同步</Badge> : null}
                  </div>
                  <p className="case-card__loc">
                    {c.location} · 案发 {fmtDateTime(c.occurredAt)}
                  </p>
                  {c.notes ? <p className="case-card__notes">{c.notes}</p> : null}
                </div>
                <div className="case-card__stats">
                  <div><b>{caseBatches.length}</b><span>批次</span></div>
                  <div><b>{caseReadings.length}</b><span>温度记录</span></div>
                  <div><b>{add.avgTemp.toFixed(1)}℃</b><span>平均温度</span></div>
                  <div><b>{gaps.length}</b><span>断档</span></div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <CaseFormModal
        open={caseFormOpen}
        onClose={() => setCaseFormOpen(false)}
        editing={editingCase}
      />
    </div>
  );
}

function CaseDetail({
  caseRec,
  onBack,
  onEdit,
}: {
  caseRec: CaseRecord;
  onBack: () => void;
  onEdit: () => void;
}) {
  const { batches, readings, identifications } = useStore();
  const [batchFormOpen, setBatchFormOpen] = useState(false);
  const [readingFormOpen, setReadingFormOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const caseBatches = batches.filter((b) => b.caseId === caseRec.id);
  const caseReadings = useMemo(
    () => readingsForCase(readings, caseRec.id),
    [readings, caseRec.id]
  );
  const gaps = useMemo(() => findGaps(readings, caseRec.id), [readings, caseRec.id]);
  const add = useMemo(() => calcADD(readings, caseRec.id, 10), [readings, caseRec.id]);

  const outdatedCount = caseBatches.filter((b) => {
    const ident = identifications.find((i) => i.batchId === b.id);
    if (!ident?.finalized) return false;
    const hashNow = hashOf(readings, caseRec.id);
    return hashNow !== ident.tempHash;
  }).length;

  return (
    <div className="view">
      <button className="back-btn" onClick={onBack}>← 返回案件列表</button>

      <div className="case-detail__head">
        <div>
          <div className="case-detail__eyebrow">{caseRec.caseNo}</div>
          <h2>{caseRec.title}</h2>
          <p>{caseRec.location} · 案发 {fmtDateTime(caseRec.occurredAt)}</p>
        </div>
        <div className="case-detail__actions">
          <button className="btn" onClick={onEdit}>编辑案件</button>
          <button
            className="btn btn--danger"
            onClick={() => {
              if (confirm(`删除案件 ${caseRec.caseNo}？其下批次与温度记录将一并删除。`)) {
                deleteCase(caseRec.id);
                onBack();
              }
            }}
          >
            删除
          </button>
        </div>
      </div>

      <div className="detail__stats">
        <div className="stat"><small>采样批次</small><strong>{caseBatches.length}</strong></div>
        <div className="stat"><small>温度记录</small><strong>{caseReadings.length}</strong></div>
        <div className="stat"><small>平均温度</small><strong>{add.avgTemp.toFixed(1)} ℃</strong></div>
        <div className="stat"><small>断档</small><strong>{gaps.length} 处</strong></div>
        <div className="stat"><small>积温(10℃基)</small><strong>{add.addDays.toFixed(1)} ℃·日</strong></div>
        {outdatedCount > 0 ? (
          <div className="stat stat--alert">
            <small>结论过时</small>
            <strong>{outdatedCount}</strong>
          </div>
        ) : null}
      </div>

      <section className="panel">
        <div className="view__head">
          <div>
            <h3>温度过程</h3>
            <p>传感器读数偶尔乱序或断档；联网合并后按时间重排，断档处断开标注。</p>
          </div>
          <button className="btn" onClick={() => setReadingFormOpen(true)}>+ 补录温度</button>
        </div>
        <TemperatureChart readings={caseReadings} gaps={gaps} />
      </section>

      <section className="panel">
        <div className="view__head">
          <div>
            <h3>采样批次</h3>
            <p>点击批次卡片查看详情卡（温度过程 + 积温 + 鉴定结论）。</p>
          </div>
          <button className="btn btn--primary" onClick={() => setBatchFormOpen(true)}>
            + 新增批次
          </button>
        </div>

        {caseBatches.length === 0 ? (
          <EmptyState title="暂无批次" hint="为该案件登记第一个采样批次。" />
        ) : (
          <div className="batch-grid">
            {caseBatches.map((b) => (
              <BatchCard key={b.id} batch={b} onClick={() => setSelectedBatchId(b.id)} />
            ))}
          </div>
        )}
      </section>

      <BatchFormModal
        open={batchFormOpen}
        onClose={() => setBatchFormOpen(false)}
        caseId={caseRec.id}
      />
      <ReadingFormModal
        open={readingFormOpen}
        onClose={() => setReadingFormOpen(false)}
        caseId={caseRec.id}
      />
      <BatchDetailModal batchId={selectedBatchId} onClose={() => setSelectedBatchId(null)} />
    </div>
  );
}

function hashOf(readings: ReturnType<typeof useStore>["readings"], caseId: string) {
  const s = readingsForCase(readings, caseId)
    .map((r) => `${r.ts}:${r.value}`)
    .join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
