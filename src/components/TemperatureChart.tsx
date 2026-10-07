// 温度过程曲线图：SVG 折线，断档处断开并标注，含积温基线
import { useMemo, useRef, useState, useEffect } from "react";
import type { Gap, TempReading } from "../types";
import { fmtDateTime, fmtTime } from "../utils";

interface Props {
  readings: TempReading[]; // 已按时间排序
  gaps: Gap[];
  baseTemp?: number;
  height?: number;
}

const M = { top: 24, right: 28, bottom: 44, left: 52 };

export function TemperatureChart({ readings, gaps, baseTemp, height = 260 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 720));
    ro.observe(el);
    setWidth(el.clientWidth || 720);
    return () => ro.disconnect();
  }, []);

  const { xFor, yFor, minTs, maxTs, minV, maxV } = useMemo(() => {
    const w = width - M.left - M.right;
    const h = height - M.top - M.bottom;
    if (readings.length === 0) {
      return { xFor: () => 0, yFor: () => 0, minTs: 0, maxTs: 0, minV: 0, maxV: 0 };
    }
    const minTs = readings[0].ts;
    const maxTs = readings[readings.length - 1].ts;
    let minV = Math.min(...readings.map((r) => r.value));
    let maxV = Math.max(...readings.map((r) => r.value));
    if (baseTemp !== undefined) {
      minV = Math.min(minV, baseTemp);
      maxV = Math.max(maxV, baseTemp);
    }
    const pad = (maxV - minV) * 0.15 || 2;
    minV -= pad;
    maxV += pad;
    const xFor = (ts: number) => M.left + ((ts - minTs) / (maxTs - minTs || 1)) * w;
    const yFor = (v: number) => M.top + (1 - (v - minV) / (maxV - minV || 1)) * h;
    return { xFor, yFor, minTs, maxTs, minV, maxV };
  }, [readings, width, height, baseTemp]);

  const gapKey = (a: number, b: number) => `${a}-${b}`;

  // 折线段：遇到断档则断开
  const segments = useMemo(() => {
    const segs: { d: string; key: string }[] = [];
    let cur: string[] = [];
    for (let i = 0; i < readings.length; i++) {
      const r = readings[i];
      const x = xFor(r.ts);
      const y = yFor(r.value);
      if (cur.length === 0) cur.push(`M${x.toFixed(1)},${y.toFixed(1)}`);
      else cur.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
      const next = readings[i + 1];
      if (next) {
        const isGap = gaps.some(
          (g) => g.startTs === r.ts && g.endTs === next.ts
        );
        if (isGap) {
          segs.push({ d: cur.join(" "), key: gapKey(r.ts, next.ts) });
          cur = [];
        }
      }
    }
    if (cur.length) segs.push({ d: cur.join(" "), key: "tail" });
    return segs;
  }, [readings, gaps, xFor, yFor]);

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = niceStep((maxV - minV) / 4);
    for (let v = Math.ceil(minV / step) * step; v <= maxV; v += step) {
      ticks.push(Math.round(v * 10) / 10);
    }
    return ticks;
  }, [minV, maxV]);

  const xTicks = useMemo(() => {
    if (readings.length < 2) return [];
    const span = maxTs - minTs;
    const desired = 5;
    const step = niceMs(span / desired);
    const ticks: number[] = [];
    for (let t = Math.ceil(minTs / step) * step; t <= maxTs; t += step) ticks.push(t);
    return ticks;
  }, [minTs, maxTs, readings.length]);

  if (readings.length === 0) {
    return (
      <div className="chart chart--empty" ref={wrapRef}>
        <p>暂无温度记录</p>
      </div>
    );
  }

  const hoverReading = hover ? readings[hover.i] : null;

  return (
    <div className="chart" ref={wrapRef}>
      <svg
        width={width}
        height={height}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = e.clientX - rect.left;
          // 找最近读数
          let best = 0;
          let bestD = Infinity;
          for (let i = 0; i < readings.length; i++) {
            const d = Math.abs(xFor(readings[i].ts) - px);
            if (d < bestD) { bestD = d; best = i; }
          }
          setHover({ x: xFor(readings[best].ts), i: best });
        }}
        onMouseLeave={() => setHover(null)}
      >
        {/* 断档区域 */}
        {gaps.map((g) => {
          const x1 = xFor(g.startTs);
          const x2 = xFor(g.endTs);
          return (
            <g key={`gap-${g.startTs}`}>
              <rect
                x={x1}
                y={M.top}
                width={Math.max(2, x2 - x1)}
                height={height - M.top - M.bottom}
                fill="rgba(220,38,38,0.08)"
                stroke="rgba(220,38,38,0.35)"
                strokeDasharray="3 3"
              />
              <text
                x={(x1 + x2) / 2}
                y={M.top + 14}
                fontSize="10"
                fill="#dc2626"
                textAnchor="middle"
              >
                断档 {Math.round(g.hours)}h
              </text>
            </g>
          );
        })}

        {/* 网格 + Y 轴刻度 */}
        {yTicks.map((v) => (
          <g key={`y-${v}`}>
            <line
              x1={M.left}
              x2={width - M.right}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="#e2e8f0"
            />
            <text x={M.left - 8} y={yFor(v) + 3} fontSize="10" fill="#64748b" textAnchor="end">
              {v}℃
            </text>
          </g>
        ))}

        {/* X 轴刻度 */}
        {xTicks.map((t) => (
          <text key={`x-${t}`} x={xFor(t)} y={height - M.bottom + 18} fontSize="10" fill="#64748b" textAnchor="middle">
            {fmtTime(t)}
          </text>
        ))}

        {/* 积温基线 */}
        {baseTemp !== undefined && baseTemp >= minV && baseTemp <= maxV ? (
          <g>
            <line
              x1={M.left}
              x2={width - M.right}
              y1={yFor(baseTemp)}
              y2={yFor(baseTemp)}
              stroke="#a16207"
              strokeDasharray="6 4"
            />
            <text x={width - M.right} y={yFor(baseTemp) - 4} fontSize="10" fill="#a16207" textAnchor="end">
              发育起点 {baseTemp}℃
            </text>
          </g>
        ) : null}

        {/* 折线 */}
        {segments.map((s) => (
          <path key={s.key} d={s.d} fill="none" stroke="#365314" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {/* 数据点 */}
        {readings.map((r) => (
          <circle
            key={r.id}
            cx={xFor(r.ts)}
            cy={yFor(r.value)}
            r={r.source === "manual" ? 3.5 : 2.5}
            fill={r.source === "manual" ? "#a16207" : "#365314"}
            stroke="#fff"
            strokeWidth={1}
          />
        ))}

        {/* hover 引导线 */}
        {hover && hoverReading ? (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={M.top}
            y2={height - M.bottom}
            stroke="#94a3b8"
            strokeDasharray="3 3"
          />
        ) : null}
      </svg>

      {hover && hoverReading ? (
        <div
          className="chart__tooltip"
          style={{ left: Math.min(hover.x + 12, width - 150), top: M.top + 6 }}
        >
          <strong>{hoverReading.value}℃</strong>
          <span>{fmtDateTime(hoverReading.ts)}</span>
          <em>{hoverReading.source === "manual" ? "人工补录" : "传感器"}</em>
        </div>
      ) : null}

      <div className="chart__legend">
        <span><i className="dot dot--sensor" />传感器读数</span>
        <span><i className="dot dot--manual" />人工补录</span>
        <span><i className="dot dot--gap" />断档</span>
      </div>
    </div>
  );
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return step * pow;
}

function niceMs(raw: number): number {
  const hour = 3600_000;
  const day = 24 * hour;
  if (raw >= day) return day;
  if (raw >= 6 * hour) return 6 * hour;
  if (raw >= 3 * hour) return 3 * hour;
  return hour;
}
