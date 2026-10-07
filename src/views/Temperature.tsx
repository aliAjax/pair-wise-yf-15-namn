// 温度记录视图：按案件查看温度过程，补录/编辑/删除读数，展示乱序与断档
import { useMemo, useState } from "react";
import {
  calcADD,
  deleteReading,
  findGaps,
  readingsForCase,
  useStore,
} from "../store";
import { fmtDateTime } from "../utils";
import { TemperatureChart } from "../components/TemperatureChart";
import { ReadingFormModal } from "../components/forms";
import { Badge, EmptyState } from "../components/ui";
import type { TempReading } from "../types";

export function TemperatureView() {
  const { cases, readings } = useStore();
  const [caseId, setCaseId] = useState<string>(cases[0]?.id ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TempReading | undefined>();

  const activeCaseId = caseId || cases[0]?.id || "";
  const caseReadings = useMemo(
    () => readingsForCase(readings, activeCaseId),
    [readings, activeCaseId]
  );
  const gaps = useMemo(() => findGaps(readings, activeCaseId), [readings, activeCaseId]);
  const add = useMemo(() => calcADD(readings, activeCaseId, 10), [readings, activeCaseId]);

  // 乱序：在“录入顺序”中时间戳小于上一条的读数
  const disorderIds = useMemo(() => {
    const stored = readings
      .filter((r) => r.caseId === activeCaseId)
      .sort((a, b) => a.updatedAt - b.updatedAt);
    const set = new Set<string>();
    for (let i = 1; i < stored.length; i++) {
      if (stored[i].ts < stored[i - 1].ts) set.add(stored[i].id);
    }
    return set;
  }, [readings, activeCaseId]);

  if (cases.length === 0) {
    return (
      <div className="view">
        <EmptyState title="暂无案件" hint="请先新增案件，再登记温度记录。" />
      </div>
    );
  }

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <h2>温度记录</h2>
          <p>传感器读数偶尔乱序或断档；联网合并后按时间重排，断档在图中断开标注。</p>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
        >
          + 补录温度
        </button>
      </div>

      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-group__label">案件</span>
          <select value={activeCaseId} onChange={(e) => setCaseId(e.target.value)}>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>{c.caseNo} · {c.title}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="detail__stats">
        <div className="stat"><small>读数</small><strong>{caseReadings.length}</strong></div>
        <div className="stat"><small>平均温度</small><strong>{add.avgTemp.toFixed(1)} ℃</strong></div>
        <div className="stat"><small>记录时长</small><strong>{add.hours.toFixed(0)} h</strong></div>
        <div className="stat"><small>断档</small><strong>{gaps.length} 处</strong></div>
        <div className="stat"><small>乱序读数</small><strong>{disorderIds.size} 条</strong></div>
      </div>

      <section className="panel">
        <TemperatureChart readings={caseReadings} gaps={gaps} baseTemp={10} height={300} />
      </section>

      <section className="panel">
        <div className="view__head">
          <h3>读数明细</h3>
          <span className="muted">按时间排序展示；乱序读数已在合并时归位。</span>
        </div>
        {caseReadings.length === 0 ? (
          <EmptyState title="暂无温度记录" hint="点击右上角“补录温度”添加第一条读数。" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>温度</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {caseReadings.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDateTime(r.ts)}</td>
                    <td><b>{r.value} ℃</b></td>
                    <td>
                      {r.source === "manual" ? (
                        <Badge tone="amber">人工补录</Badge>
                      ) : (
                        <Badge tone="blue">传感器</Badge>
                      )}
                    </td>
                    <td>
                      <div className="row-badges">
                        {!r.synced ? <Badge tone="gray">待同步</Badge> : null}
                        {disorderIds.has(r.id) ? <Badge tone="purple">乱序归位</Badge> : null}
                      </div>
                    </td>
                    <td className="row-actions">
                      <button
                        className="link-btn"
                        onClick={() => {
                          setEditing(r);
                          setFormOpen(true);
                        }}
                      >
                        编辑
                      </button>
                      <button
                        className="link-btn link-btn--danger"
                        onClick={() => {
                          if (confirm("删除这条温度读数？")) deleteReading(r.id);
                        }}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ReadingFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        caseId={activeCaseId}
        editing={editing}
      />
    </div>
  );
}
