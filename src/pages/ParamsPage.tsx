import { useState } from "react";
import { store, useStore } from "../data/store";
import { STAGES } from "../domain/thermal";
import { fmtDT } from "../domain/selectors";
import type { SpeciesDoc, StageCode } from "../types";
import { Badge, Card, Field } from "../components/ui";

export default function ParamsPage() {
  const s = useStore();
  const settings = s.settings;
  const [editing, setEditing] = useState<string | null>(null);

  if (!settings) return null;

  return (
    <div className="page params-page">
      <Card title="联网与本地合并">
        <div className="sync-panel">
          <div className="sync-state">
            <Badge tone={settings.online ? "green" : "amber"}>
              {settings.online ? "● 在线（变更自动合并）" : "○ 离线（变更只记本机）"}
            </Badge>
            <div className="muted small">
              待合并变更 <strong className={s.pendingCount ? "pending-num" : ""}>{s.pendingCount}</strong> 条 ·
              上次合并 {fmtDT(s.lastSyncAt)}
            </div>
            <div className="muted small">
              中继为同浏览器存储（可开两个标签页模拟多端）：离线时编辑 → 发件箱积压 →
              切回在线 → 自动推送并按 updatedAt 合并；删除以墓碑同步。
            </div>
          </div>
          <div className="btn-row">
            <button onClick={() => void store.setOnline(!settings.online)}>
              {settings.online ? "切换为离线（模拟断网）" : "切换为在线并合并"}
            </button>
            <button
              disabled={!settings.online}
              onClick={() => void store.flushOutbox(true)}
            >
              立即手动合并
            </button>
          </div>
        </div>
      </Card>

      <Card title="积温计算设置">
        <div className="form-grid">
          <Field
            label="断档判定阈值（分钟）"
            hint="相邻读数超过该间隔视为断档：该时段不积分，覆盖率下降、虫龄区间放宽"
          >
            <input
              type="number"
              min={5}
              step={5}
              value={settings.gapThresholdMin}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) void store.setGapThreshold(v);
              }}
            />
          </Field>
        </div>
        <p className="muted small">
          阈值修改会影响全部批次的重算结果；已定稿鉴定若所用阈值变化，会显示"已过时"。
        </p>
      </Card>

      <Card title="种属发育参数（实验室校准）">
        <div className="species-list">
          {s.species.map((sp) => (
            <SpeciesEditor
              key={sp.id}
              sp={sp}
              open={editing === sp.id}
              onToggle={() => setEditing(editing === sp.id ? null : sp.id)}
            />
          ))}
        </div>
      </Card>

      <Card title="演示数据">
        <div className="sync-panel">
          <p className="muted small">
            清空本机 IndexedDB 与中继，恢复含乱序、重复、断档及"定稿后补录温度"的初始案例。
          </p>
          <button
            className="link-danger"
            onClick={() => {
              if (confirm("将清空全部本机记录与中继数据并恢复演示数据，确定？")) {
                void store.resetDemo();
              }
            }}
          >
            重置全部演示数据
          </button>
        </div>
      </Card>
    </div>
  );
}

function SpeciesEditor({
  sp,
  open,
  onToggle,
}: {
  sp: SpeciesDoc;
  open: boolean;
  onToggle: () => void;
}) {
  const patch = (p: Partial<SpeciesDoc>) =>
    store.mutate({ ...sp, ...p }, "种属参数已更新，相关批次积温已重算");

  return (
    <article className="species-item">
      <header className="species-head" onClick={onToggle}>
        <div>
          <b>{sp.commonName}</b>{" "}
          <em className="muted">{sp.scientificName}</em>
          <div className="muted small">{sp.family} · 起点温度 {sp.baseTempC} ℃</div>
        </div>
        <button className="btn-small">{open ? "收起" : "校准参数"}</button>
      </header>
      {open && (
        <div className="species-body">
          <div className="form-grid">
            <Field label="中文名">
              <input value={sp.commonName} onChange={(e) => patch({ commonName: e.target.value })} />
            </Field>
            <Field label="学名">
              <input value={sp.scientificName} onChange={(e) => patch({ scientificName: e.target.value })} />
            </Field>
            <Field label="发育起点温度 ℃">
              <input
                type="number"
                step="0.1"
                value={sp.baseTempC}
                onChange={(e) => patch({ baseTempC: Number(e.target.value) })}
              />
            </Field>
            <Field label="科属">
              <input value={sp.family} onChange={(e) => patch({ family: e.target.value })} />
            </Field>
          </div>
          <div className="target-grid">
            {STAGES.map((st) => (
              <label className="field" key={st.code}>
                <span className="field-label">{st.label} 目标 ADH</span>
                <input
                  type="number"
                  value={sp.stageTargetsADH[st.code as StageCode] ?? ""}
                  placeholder="—"
                  onChange={(e) =>
                    patch({
                      stageTargetsADH: {
                        ...sp.stageTargetsADH,
                        [st.code]: e.target.value === "" ? null : Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <Field label="参考说明">
            <textarea
              rows={2}
              value={sp.referenceNote}
              onChange={(e) => patch({ referenceNote: e.target.value })}
            />
          </Field>
        </div>
      )}
    </article>
  );
}
