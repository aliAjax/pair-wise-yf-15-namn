// 单个样本详情卡片：采样信息 + 温度过程 + 积温 + 鉴定结论（定稿不可替换，过时可见）
import { useMemo, useState } from "react";
import type { Batch, Identification } from "../types";
import { EXPOSURE_STAGES, STAGES } from "../types";
import {
  calcADD,
  finalizeIdentification,
  findGaps,
  isOutdated,
  readingsForCase,
  saveIdentification,
  useStore,
} from "../store";
import { fmtDateTime } from "../utils";
import { TemperatureChart } from "./TemperatureChart";
import { Badge, Field, Modal } from "./ui";

export function BatchDetailModal({
  batchId,
  onClose,
}: {
  batchId: string | null;
  onClose: () => void;
}) {
  const { batches } = useStore();
  const batch = batches.find((b) => b.id === batchId);
  if (!batchId || !batch) return null;
  return (
    <Modal open={!!batchId} onClose={onClose} width={960}>
      <BatchDetail batch={batch} onClose={onClose} />
    </Modal>
  );
}

export function BatchDetail({
  batch,
  onClose,
}: {
  batch: Batch;
  onClose: () => void;
}) {
  const { cases, readings, identifications } = useStore();
  const caseRec = cases.find((c) => c.id === batch.caseId);
  const ident = identifications.find((i) => i.batchId === batch.id);

  const caseReadings = useMemo(
    () => readingsForCase(readings, batch.caseId),
    [readings, batch.caseId]
  );
  const gaps = useMemo(() => findGaps(readings, batch.caseId), [readings, batch.caseId]);
  const outdated = isOutdated(ident, readings, batch.caseId);

  const add = useMemo(() => {
    const base = ident?.baseTemp ?? 10;
    return calcADD(readings, batch.caseId, base);
  }, [readings, batch.caseId, ident?.baseTemp]);

  return (
    <div className="detail">
      <div className="detail__head">
        <div>
          <div className="detail__eyebrow">
            {caseRec?.caseNo} · 采样批次
            {!batch.synced ? <Badge tone="amber">待同步</Badge> : null}
          </div>
          <h2>{batch.batchNo}</h2>
          <p className="detail__sub">
            {batch.samplingPoint} · 采样于 {fmtDateTime(batch.collectedAt)}
          </p>
        </div>
        <button className="modal__close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <div className="detail__grid">
        <section className="detail__main">
          <div className="detail__section-title">
            <h3>温度过程</h3>
            <span>
              {caseReadings.length} 条记录 · 平均 {add.avgTemp.toFixed(1)}℃ ·
              跨 {add.hours.toFixed(0)} 小时
            </span>
          </div>
          <TemperatureChart
            readings={caseReadings}
            gaps={gaps}
            baseTemp={ident?.baseTemp}
          />
          {gaps.length > 0 ? (
            <p className="detail__gap-note">
              检测到 {gaps.length} 处断档（传感器离线或未记录），积温仅按实测区间积分。
            </p>
          ) : null}

          <div className="detail__stats">
            <div className="stat">
              <small>积温（重算）</small>
              <strong>{add.addDays.toFixed(1)} ℃·日</strong>
            </div>
            <div className="stat">
              <small>平均温度</small>
              <strong>{add.avgTemp.toFixed(1)} ℃</strong>
            </div>
            <div className="stat">
              <small>记录时长</small>
              <strong>{add.hours.toFixed(0)} h</strong>
            </div>
            <div className="stat">
              <small>断档</small>
              <strong>{gaps.length} 处</strong>
            </div>
          </div>
        </section>

        <aside className="detail__side">
          <IdentificationPanel
            key={ident?.id ?? `new-${batch.id}`}
            batch={batch}
            ident={ident}
            outdated={outdated}
            recalcAdd={add.addDays}
            readingCount={caseReadings.length}
          />

          <div className="detail__meta">
            <h4>采样信息</h4>
            <dl>
              <div><dt>采样点</dt><dd>{batch.samplingPoint}</dd></div>
              <div><dt>采样时间</dt><dd>{fmtDateTime(batch.collectedAt)}</dd></div>
              <div><dt>保存方式</dt><dd>{batch.preservation}</dd></div>
              <div><dt>数量</dt><dd>{batch.quantity}</dd></div>
              <div><dt>所属案件</dt><dd>{caseRec?.caseNo} {caseRec?.title}</dd></div>
              {batch.notes ? <div><dt>备注</dt><dd>{batch.notes}</dd></div> : null}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

function IdentificationPanel({
  batch,
  ident,
  outdated,
  recalcAdd,
  readingCount,
}: {
  batch: Batch;
  ident: Identification | undefined;
  outdated: boolean;
  recalcAdd: number;
  readingCount: number;
}) {
  const existing = ident;
  const [stage, setStage] = useState<Identification["stage"]>(existing?.stage ?? "");
  const [species, setSpecies] = useState(existing?.species ?? "");
  const [exposureStage, setExposureStage] = useState(existing?.exposureStage ?? "");
  const [baseTemp, setBaseTemp] = useState(existing?.baseTemp ?? 10);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [by, setBy] = useState(existing?.finalizedBy ?? "");
  const [err, setErr] = useState("");

  const finalized = existing?.finalized ?? false;

  const persist = (overrides: Partial<Identification> = {}) => {
    saveIdentification({
      id: existing?.id ?? `ident-${batch.id}`,
      batchId: batch.id,
      stage,
      species,
      exposureStage,
      baseTemp,
      notes,
      ...overrides,
    });
  };

  const handleFinalize = () => {
    if (!stage) return setErr("请选择发育阶段");
    if (!species.trim()) return setErr("请填写昆虫种属");
    if (!exposureStage) return setErr("请选择暴露阶段");
    setErr("");
    const id = existing?.id ?? `ident-${batch.id}`;
    persist({ id });
    finalizeIdentification(id, by.trim());
  };

  if (finalized && existing) {
    return (
      <div className={`ident ${outdated ? "ident--outdated" : "ident--final"}`}>
        <div className="ident__head">
          <h4>鉴定结论</h4>
          {outdated ? (
            <Badge tone="red">已过时</Badge>
          ) : (
            <Badge tone="green">已定稿</Badge>
          )}
        </div>

        {outdated ? (
          <div className="ident__outdated">
            温度记录已变动（现有 {readingCount} 条），定稿结论不可替换，积温需按新记录重算。
          </div>
        ) : null}

        <dl className="ident__dl">
          <div><dt>发育阶段</dt><dd>{existing.stage}</dd></div>
          <div><dt>昆虫种属</dt><dd>{existing.species}</dd></div>
          <div><dt>暴露阶段</dt><dd>{existing.exposureStage}</dd></div>
          <div><dt>发育起点</dt><dd>{existing.baseTemp}℃</dd></div>
          <div>
            <dt>积温（定稿）</dt>
            <dd>
              {existing.addValue.toFixed(1)} ℃·日
              {outdated ? (
                <span className="ident__recalc">
                  重算 {recalcAdd.toFixed(1)} ℃·日
                </span>
              ) : null}
            </dd>
          </div>
          <div><dt>定稿人</dt><dd>{existing.finalizedBy}</dd></div>
          <div><dt>定稿时间</dt><dd>{fmtDateTime(existing.finalizedAt)}</dd></div>
        </dl>
        {existing.notes ? <p className="ident__notes">{existing.notes}</p> : null}
        <p className="ident__lock">结论已定稿，不可替换或修改。</p>
      </div>
    );
  }

  return (
    <div className="ident ident--draft">
      <div className="ident__head">
        <h4>鉴定结论</h4>
        <Badge tone="amber">待鉴定</Badge>
      </div>

      <div className="ident__form">
        <Field label="发育阶段">
          <select value={stage} onChange={(e) => setStage(e.target.value as Identification["stage"])}>
            <option value="">请选择</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="昆虫种属">
          <input
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            placeholder="如 丝光绿蝇 Lucilia sericata"
          />
        </Field>
        <Field label="尸体暴露阶段">
          <select value={exposureStage} onChange={(e) => setExposureStage(e.target.value)}>
            <option value="">请选择</option>
            {EXPOSURE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="发育起点温度 (℃)">
          <input
            type="number"
            step="0.5"
            value={baseTemp}
            onChange={(e) => setBaseTemp(Number(e.target.value))}
          />
        </Field>
        <Field label="鉴定备注">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="鉴定依据、复核说明…"
          />
        </Field>
        <Field label="定稿人">
          <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="如 李法医" />
        </Field>
      </div>

      {err ? <p className="ident__err">{err}</p> : null}

      <div className="ident__actions">
        <button className="btn" onClick={() => persist()}>保存草稿</button>
        <button className="btn btn--primary" onClick={handleFinalize}>
          定稿结论
        </button>
      </div>
      <p className="ident__hint">定稿后结论不可替换；若此后温度记录变动，将标记“已过时”并重算积温。</p>
    </div>
  );
}

