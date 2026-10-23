"use client";
import { useRef, useState } from "react";

/** Liniendiagramm (eine Serie) mit Fadenkreuz und Tooltip. */
export function LineChart({ points, format, height = 200, label }: {
  points: { x: number; y: number }[];
  format: (v: number) => string;
  height?: number;
  label: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 92, r: 12, t: 12, b: 26 };
  if (points.length < 2) return <div className="empty">Noch zu wenige Daten – spiele ein paar Wochen.</div>;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(...ys) * 1.05 || 1;
  const sx = (x: number) => pad.l + ((x - xs[0]) / Math.max(1, xs[xs.length - 1] - xs[0])) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y - minY) / (maxY - minY || 1)) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const area = `${d} L${sx(xs[xs.length - 1])},${sy(minY)} L${sx(xs[0])},${sy(minY)} Z`;
  const ticks = [minY, (minY + maxY) / 2, maxY];
  const hp = hover !== null ? points[hover] : null;

  function move(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(sx(points[i].x) - x) < Math.abs(sx(points[best].x) - x)) best = i;
    setHover(best);
  }

  return (
    <div style={{ position: "relative" }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} onPointerMove={move} onPointerLeave={() => setHover(null)} style={{ touchAction: "none" }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={pad.l - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--text-faint)">{format(t)}</text>
          </g>
        ))}
        {minY < 0 && <line x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} stroke="var(--text-faint)" strokeDasharray="3 3" />}
        <path d={area} fill="var(--accent-soft)" />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {[points[0], points[points.length - 1]].map((p, i) => (
          <text key={i} x={sx(p.x)} y={H - 8} textAnchor={i ? "end" : "start"} fontSize="11" fill="var(--text-faint)">Woche {p.x}</text>
        ))}
        {hp && (
          <g>
            <line x1={sx(hp.x)} x2={sx(hp.x)} y1={pad.t} y2={H - pad.b} stroke="var(--text-faint)" strokeWidth="1" />
            <circle cx={sx(hp.x)} cy={sy(hp.y)} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hp && (
        <div className="card" style={{ position: "absolute", top: 4, left: `${(sx(hp.x) / W) * 100}%`, transform: "translateX(-50%)", padding: "6px 10px", pointerEvents: "none", fontSize: 12 }}>
          <div className="faint">Woche {hp.x}</div>
          <b>{format(hp.y)}</b>
        </div>
      )}
    </div>
  );
}

/** Horizontale Balken mit Beschriftung (sortiert), ein Farbton pro Liste. */
export function BarList({ rows, format, color = "var(--accent)" }: { rows: { label: string; value: number }[]; format: (v: number) => string; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="stack-sm">
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${format(r.value)}`}>
          <div className="between small"><span className="dim">{r.label}</span><b className="num">{format(r.value)}</b></div>
          <div style={{ height: 8, background: "var(--surface-3)", borderRadius: 4, overflow: "hidden", marginTop: 3 }}>
            <div style={{ width: `${(Math.abs(r.value) / max) * 100}%`, height: "100%", background: color, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
