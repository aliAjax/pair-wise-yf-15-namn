import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { BatchView } from "../domain/selectors";
import { fmtADH, fmtDT, fmtTemp } from "../domain/selectors";
import { hoursLabel, type ThermalResult } from "../domain/thermal";
import { store } from "../data/store";

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?: "neutral" | "green" | "amber" | "red" | "blue" | "ghost";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

export function Card({
  title,
  extra,
  children,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || extra) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {extra}
        </header>
      )}
      {children}
    </section>
  );
}

/** 温度过程图：折线 + 断档虚线 + 采样时刻竖线，悬停读数 */
export function TemperatureChart({
  view,
  height = 230,
}: {
  view: BatchView;
  height?: number;
}) {
  const { points, collectedAt, gapCount, maxGapMin } = view.thermal;
  if (points.length === 0) {
    return (
      <div className="chart-empty">该批次暂无温度读数，请在下方录入或导入传感器记录。</div>
    );
  }
  const W = 760;
  const H = height;
  const padL = 46;
  const padR = 16;
  const padT = 14;
  const padB = 28;
  const tMin = points[0].t;
  const tMax = Math.max(points[points.length - 1].t, collectedAt ?? 0);
  const cMin = Math.floor(Math.min(...points.map((p) => p.c)) - 2);
  const cMax = Math.ceil(Math.max(...points.map((p) => p.c)) + 2);
  const x = (t: number) =>
    padL + ((t - tMin) / Math.max(tMax - tMin, 1)) * (W - padL - padR);
  const y = (c: number) =>
    padT + (1 - (c - cMin) / Math.max(cMax - cMin, 1)) * (H - padT - padB);

  const segs: { d: string; gap: boolean }[] = [];
  for (let i = 1; i < points.length; i++) {
    const minutes = (points[i].t - points[i - 1].t) / 60000;
    const gap = minutes > (store.state.settings?.gapThresholdMin ?? 90);
    segs.push({
      d: `M ${x(points[i - 1].t)} ${y(points[i - 1].c)} L ${x(points[i].t)} ${y(points[i].c)}`,
      gap,
    });
  }
  const areaPath =
    `M ${x(points[0].t)} ${y(points[0].c)} ` +
    points.slice(1).map((p) => `L ${x(p.t)} ${y(p.c)}`).join(" ") +
    ` L ${x(points[points.length - 1].t)} ${H - padB} L ${x(points[0].t)} ${H - padB} Z`;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => cMin + ((cMax - cMin) * i) / ticks);
  const xTickCount = 4;
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => tMin + ((tMax - tMin) * i) / xTickCount);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" className="chart">
        {yTicks.map((c) => (
          <g key={c}>
            <line x1={padL} x2={W - padR} y1={y(c)} y2={y(c)} className="grid" />
            <text x={padL - 6} y={y(c) + 4} textAnchor="end" className="axis-text">
              {Math.round(c)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={H - 8} textAnchor="middle" className="axis-text">
            {fmtDT(new Date(t).toISOString()).slice(5, 16)}
          </text>
        ))}
        <path d={areaPath} className="chart-area" />
        {segs.map((s, i) => (
          <path
            key={i}
            d={s.d}
            className={s.gap ? "line-gap" : "line-temp"}
            markerEnd={undefined}
          />
        ))}
        {points.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.c)} r={p.afterCollect ? 2.2 : 2.6}
            className={p.afterCollect ? "dot-after" : "dot"}>
            <title>
              {fmtDT(new Date(p.t).toISOString())}　{p.c} ℃
              {p.afterCollect ? "（采样后）" : ""}
            </title>
          </circle>
        ))}
        {collectedAt != null && collectedAt >= tMin && collectedAt <= tMax && (
          <g>
            <line x1={x(collectedAt)} x2={x(collectedAt)} y1={padT} y2={H - padB}
              className="line-collect" />
            <text x={x(collectedAt) + 4} y={padT + 12} className="collect-text">
              采样
            </text>
          </g>
        )}
      </svg>
      <div className="chart-legend">
        <span><i className="lg lg-line" /> 有效温度过程</span>
        <span><i className="lg lg-gap" /> 断档（不积分）</span>
        <span><i className="lg lg-collect" /> 采样时刻</span>
        {gapCount > 0 && (
          <Badge tone="amber">断档 {gapCount} 处 · 最长 {Math.round(maxGapMin)} 分钟</Badge>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {sub && <em>{sub}</em>}
    </div>
  );
}

/** 积温结论卡：温度一改即随视图重算 */
export function ThermalPanel({ view }: { view: BatchView }) {
  const t: ThermalResult = view.thermal;
  return (
    <div className="thermal">
      <div className="stat-row">
        <Stat label="累计有效积温" value={fmtADH(t.cumulativeADH)} sub={`起点温度 ${view.species ? view.species.baseTempC : 10} ℃`} />
        <Stat
          label="阶段目标 / 虫龄"
          value={
            t.targetADH != null
              ? `${fmtADH(t.targetADH)} → ${hoursLabel(t.ageHoursMin)} ~ ${hoursLabel(t.ageHoursMax)}`
              : "未指定鉴定"
          }
          sub={t.extrapolated ? "积温不足，上界为外推" : t.ageHoursMin != null ? "按累计积温曲线反推" : undefined}
          tone={t.extrapolated ? "stat-warn" : undefined}
        />
        <Stat label="覆盖时段均温" value={fmtTemp(t.meanTempC)} sub={`覆盖率 ${Math.round(t.coverage * 100)}%`} />
        <Stat
          label="推断定植窗口"
          value={
            t.colonizedFrom
              ? `${fmtDT(t.colonizedFrom).slice(5)} ~ ${fmtDT(t.colonizedTo!).slice(5)}`
              : "—"
          }
          sub="虫龄回推至采样时刻之前"
        />
      </div>
      {(t.outOfOrderCount > 0 || t.duplicateCount > 0) && (
        <div className="data-quality">
          <Badge tone="blue">乱序 {t.outOfOrderCount} 处已重排</Badge>
          {t.duplicateCount > 0 && <Badge tone="blue">重复 {t.duplicateCount} 条已合并</Badge>}
        </div>
      )}
      {t.warnings.length > 0 && (
        <ul className="warnings">
          {t.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 照片附件：仅存本机 IndexedDB，明确提示不参与联网合并 */
export function PhotoAttach({ photoKey }: { photoKey: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    void store.loadPhoto(photoKey).then((p) => {
      if (p && imgRef.current) imgRef.current.src = p.dataUrl;
    });
  }, [photoKey]);
  return (
    <div className="photo-attach">
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () =>
            void store.savePhoto(photoKey, file.name, String(reader.result)).then(() =>
              store.loadPhoto(photoKey).then((p) => {
                if (p && imgRef.current) imgRef.current.src = p.dataUrl;
              }),
            );
          reader.readAsDataURL(file);
        }}
      />
      <img ref={imgRef} alt="样本照片" />
      <button type="button" className="btn-small" onClick={() => ref.current?.click()}>
        上传样本照片
      </button>
      <small>照片只保存在当前设备，不随联网合并上传（笔录数据正常合并）。</small>
    </div>
  );
}
