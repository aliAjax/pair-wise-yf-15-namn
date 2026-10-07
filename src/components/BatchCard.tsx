// 批次卡片：列表中展示批次、发育阶段、鉴定状态（待鉴定/已定稿/已过时）
import type { Batch } from "../types";
import { isOutdated, useStore } from "../store";
import { fmtDateTime } from "../utils";
import { Badge } from "./ui";

export function BatchCard({
  batch,
  onClick,
}: {
  batch: Batch;
  onClick?: () => void;
}) {
  const { cases, readings, identifications } = useStore();
  const caseRec = cases.find((c) => c.id === batch.caseId);
  const ident = identifications.find((i) => i.batchId === batch.id);
  const outdated = isOutdated(ident, readings, batch.caseId);

  let status: { label: string; tone: "green" | "amber" | "red" | "gray" };
  if (!ident || !ident.finalized) status = { label: "待鉴定", tone: "amber" };
  else if (outdated) status = { label: "已过时", tone: "red" };
  else status = { label: "已定稿", tone: "green" };

  return (
    <article className="batch-card" onClick={onClick} role={onClick ? "button" : undefined}>
      <div className="batch-card__top">
        <div className="batch-card__ids">
          <strong>{batch.batchNo}</strong>
          <span>{caseRec?.caseNo}</span>
        </div>
        <div className="batch-card__badges">
          {!batch.synced ? <Badge tone="gray">待同步</Badge> : null}
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </div>

      <div className="batch-card__stage">
        {ident?.finalized || ident?.stage ? (
          <>
            <span className="stage-pill">{ident.stage || "待定"}</span>
            <span className="batch-card__species">{ident.species || "种属未定"}</span>
          </>
        ) : (
          <span className="batch-card__species batch-card__species--muted">尚未鉴定</span>
        )}
      </div>

      <dl className="batch-card__meta">
        <div><dt>采样点</dt><dd>{batch.samplingPoint}</dd></div>
        <div><dt>采样时间</dt><dd>{fmtDateTime(batch.collectedAt)}</dd></div>
        <div><dt>保存</dt><dd>{batch.preservation}</dd></div>
        <div><dt>数量</dt><dd>{batch.quantity}</dd></div>
      </dl>
    </article>
  );
}
