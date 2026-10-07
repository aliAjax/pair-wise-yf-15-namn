// 鉴定视图：实验室鉴定工作队列（待鉴定 / 已定稿 / 已过时），点击进入详情卡定稿
import { useMemo, useState } from "react";
import { isOutdated, useStore } from "../store";
import { fmtDateTime } from "../utils";
import { BatchDetailModal } from "../components/BatchDetail";
import { Badge, EmptyState } from "../components/ui";

export function IdentifyView() {
  const { cases, batches, readings, identifications } = useStore();
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const rows = useMemo(() => {
    return batches
      .map((b) => {
        const caseRec = cases.find((c) => c.id === b.caseId);
        const ident = identifications.find((i) => i.batchId === b.id);
        const outdated = isOutdated(ident, readings, b.caseId);
        return { batch: b, caseRec, ident, outdated };
      })
      .sort((a, b) => {
        // 待鉴定优先，其次已过时，再按采样时间倒序
        const rank = (r: { ident?: { finalized: boolean }; outdated: boolean }) =>
          !r.ident?.finalized ? 0 : r.outdated ? 1 : 2;
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return b.batch.collectedAt - a.batch.collectedAt;
      });
  }, [batches, cases, identifications, readings]);

  const pending = rows.filter((r) => !r.ident?.finalized);
  const outdated = rows.filter((r) => r.outdated);
  const finalized = rows.filter((r) => r.ident?.finalized && !r.outdated);

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <h2>鉴定结论</h2>
          <p>暴露阶段与昆虫种属由实验室鉴定并定稿；定稿不可替换，温度记录变动后标记“已过时”。</p>
        </div>
      </div>

      <div className="detail__stats">
        <div className="stat"><small>待鉴定</small><strong>{pending.length}</strong></div>
        <div className="stat stat--alert"><small>已过时</small><strong>{outdated.length}</strong></div>
        <div className="stat"><small>已定稿</small><strong>{finalized.length}</strong></div>
      </div>

      <section className="panel">
        <h3 className="section-title">待鉴定批次</h3>
        {pending.length === 0 ? (
          <EmptyState title="没有待鉴定批次" hint="所有批次均已完成鉴定。" />
        ) : (
          <div className="ident-queue">
            {pending.map(({ batch, caseRec, ident }) => (
              <button
                key={batch.id}
                className="queue-row"
                onClick={() => setSelectedBatchId(batch.id)}
              >
                <div className="queue-row__main">
                  <strong>{batch.batchNo}</strong>
                  <span>{caseRec?.caseNo} · {batch.samplingPoint}</span>
                </div>
                <div className="queue-row__side">
                  <span className="muted">采样 {fmtDateTime(batch.collectedAt)}</span>
                  <Badge tone="amber">{ident?.stage ? "草稿" : "待鉴定"}</Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h3 className="section-title">已定稿批次</h3>
        {finalized.length === 0 && outdated.length === 0 ? (
          <EmptyState title="暂无定稿结论" hint="在详情卡中填写发育阶段、种属与暴露阶段后定稿。" />
        ) : (
          <div className="ident-queue">
            {[...outdated, ...finalized].map(({ batch, caseRec, ident, outdated: isOut }) => (
              <button
                key={batch.id}
                className="queue-row"
                onClick={() => setSelectedBatchId(batch.id)}
              >
                <div className="queue-row__main">
                  <strong>{batch.batchNo}</strong>
                  <span>
                    {caseRec?.caseNo} · {ident?.stage} · {ident?.species}
                  </span>
                </div>
                <div className="queue-row__side">
                  <span className="muted">
                    积温 {ident?.addValue.toFixed(1)} ℃·日 · {fmtDateTime(ident?.finalizedAt)}
                  </span>
                  {isOut ? <Badge tone="red">已过时</Badge> : <Badge tone="green">已定稿</Badge>}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <BatchDetailModal batchId={selectedBatchId} onClose={() => setSelectedBatchId(null)} />
    </div>
  );
}
