// 案件 / 批次 / 温度读数 录入表单
import { useState } from "react";
import type { Batch, CaseRecord, TempReading } from "../types";
import { PRESERVATIONS } from "../types";
import { saveBatch, saveCase, saveReading } from "../store";
import { fromLocalInput, toLocalInput } from "../utils";
import { Field, Modal } from "./ui";

export function CaseFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: CaseRecord;
}) {
  const [caseNo, setCaseNo] = useState(editing?.caseNo ?? "");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [occurredAt, setOccurredAt] = useState(
    toLocalInput(editing?.occurredAt ?? Date.now())
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");

  const submit = () => {
    saveCase({
      id: editing?.id,
      caseNo: caseNo.trim() || `CASE-${Math.floor(Math.random() * 900 + 100)}`,
      title: title.trim() || "未命名案件",
      location: location.trim(),
      occurredAt: fromLocalInput(occurredAt),
      notes,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "编辑案件" : "新增案件"}>
      <div className="form-grid">
        <Field label="案件编号">
          <input value={caseNo} onChange={(e) => setCaseNo(e.target.value)} placeholder="如 CASE-072" />
        </Field>
        <Field label="案件名称">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="简要描述" />
        </Field>
        <Field label="现场地点">
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="采样地点" />
        </Field>
        <Field label="案发时间">
          <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </Field>
        <Field label="备注">
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="现场情况、传感器布置…" />
        </Field>
      </div>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn btn--primary" onClick={submit}>保存案件</button>
      </div>
    </Modal>
  );
}

export function BatchFormModal({
  open,
  onClose,
  caseId,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  caseId: string;
  editing?: Batch;
}) {
  const [batchNo, setBatchNo] = useState(editing?.batchNo ?? "");
  const [samplingPoint, setSamplingPoint] = useState(editing?.samplingPoint ?? "");
  const [collectedAt, setCollectedAt] = useState(
    toLocalInput(editing?.collectedAt ?? Date.now())
  );
  const [preservation, setPreservation] = useState(editing?.preservation ?? PRESERVATIONS[0]);
  const [quantity, setQuantity] = useState(editing?.quantity ?? 1);
  const [notes, setNotes] = useState(editing?.notes ?? "");

  const submit = () => {
    saveBatch({
      id: editing?.id,
      caseId,
      batchNo: batchNo.trim() || "未命名批次",
      samplingPoint: samplingPoint.trim(),
      collectedAt: fromLocalInput(collectedAt),
      preservation,
      quantity: Number(quantity) || 1,
      notes,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "编辑批次" : "新增采样批次"}>
      <div className="form-grid">
        <Field label="批次编号">
          <input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="如 CASE-072-A" />
        </Field>
        <Field label="采样点">
          <input value={samplingPoint} onChange={(e) => setSamplingPoint(e.target.value)} placeholder="具体采样位置" />
        </Field>
        <Field label="采样时间">
          <input type="datetime-local" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} />
        </Field>
        <Field label="保存方式">
          <select value={preservation} onChange={(e) => setPreservation(e.target.value)}>
            {PRESERVATIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="数量">
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
        </Field>
        <Field label="备注">
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="样本描述…" />
        </Field>
      </div>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn btn--primary" onClick={submit}>保存批次</button>
      </div>
    </Modal>
  );
}

export function ReadingFormModal({
  open,
  onClose,
  caseId,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  caseId: string;
  editing?: TempReading;
}) {
  const [ts, setTs] = useState(toLocalInput(editing?.ts ?? Date.now()));
  const [value, setValue] = useState(editing?.value ?? 24);
  const [source, setSource] = useState<TempReading["source"]>(editing?.source ?? "manual");

  const submit = () => {
    saveReading({
      id: editing?.id,
      caseId,
      ts: fromLocalInput(ts),
      value: Number(value),
      source,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "编辑温度读数" : "补录温度读数"}>
      <div className="form-grid">
        <Field label="观测时间">
          <input type="datetime-local" value={ts} onChange={(e) => setTs(e.target.value)} />
        </Field>
        <Field label="温度 (℃)">
          <input type="number" step="0.1" value={value} onChange={(e) => setValue(Number(e.target.value))} />
        </Field>
        <Field label="来源">
          <select value={source} onChange={(e) => setSource(e.target.value as TempReading["source"])}>
            <option value="sensor">传感器</option>
            <option value="manual">人工补录</option>
          </select>
        </Field>
      </div>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn btn--primary" onClick={submit}>保存读数</button>
      </div>
    </Modal>
  );
}
