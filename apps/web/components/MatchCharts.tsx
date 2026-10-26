"use client";
import { useMemo, useState } from "react";

/**
 * Spielbericht-Grafiken: kumulierter xG-Verlauf (Stufenlinie je Team mit Toren)
 * und Torschusskarte (Grösse = xG, gefüllt = Tor, Ring = gehalten, blass = daneben).
 * Jede Grafik hat Legende, Tooltip und darunter eine Tabelle.
 */

export interface Shot { tick: number; side: 0 | 1; playerId: number; xg: number; x: number; y: number; kind: string; outcome: "goal" | "saved" | "off" }
interface TeamInfo { name: string; short?: string; color: string }

const OUTCOME: Record<Shot["outcome"], string> = { goal: "Tor", saved: "gehalten", off: "daneben" };
const KIND: Record<string, string> = { open: "aus dem Spiel", header: "Kopfball", freekick: "Freistoss", corner: "nach Ecke", penalty: "Elfmeter" };
const minute = (tick: number) => Math.min(90, Math.floor(tick / 6) + 1);

const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/**
 * Zwei Vereinsfarben, die sich sicher unterscheiden und auf hellem wie dunklem
 * Hintergrund sichtbar sind (mittlere Helligkeit); sonst neutrale Ausweichfarben.
 */
export function teamColors(home: { primary: string; secondary: string }, away: { primary: string; secondary: string }): [string, string] {
  const lum = (c: string) => { const [r, g, b] = rgb(c); return (r * 299 + g * 587 + b * 114) / 1000; };
  const d = (a: string, b: string) => { const [r1, g1, b1] = rgb(a); const [r2, g2, b2] = rgb(b); return Math.hypot(r1 - r2, g1 - g2, b1 - b2); };
  const usable = (c: string) => lum(c) >= 70 && lum(c) <= 215;
  const pick = (t: { primary: string; secondary: string }, fallback: string, avoid?: string) =>
    [t.primary, t.secondary].find((c) => usable(c) && (!avoid || d(c, avoid) >= 90)) ?? fallback;
  const h = pick(home, "#3b82f6");
  const a = pick(away, d(h, "#f59e0b") >= 90 ? "#f59e0b" : "#a855f7", h);
  return [h, a];
}

export function XgTimeline({ shots, teams }: { shots: Shot[]; teams: [TeamInfo, TeamInfo] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 220, L = 34, R = 14, T = 14, B = 26;
  const series = useMemo(() => [0, 1].map((side) => {
    let sum = 0;
    const pts: { m: number; v: number; goal: boolean; xg: number; pid: number }[] = [{ m: 0, v: 0, goal: false, xg: 0, pid: 0 }];
    for (const s of shots.filter((x) => x.side === side).sort((a, b) => a.tick - b.tick)) {
      sum += s.xg;
      pts.push({ m: minute(s.tick), v: sum, goal: s.outcome === "goal", xg: s.xg, pid: s.playerId });
    }
    return pts;
  }), [shots]);
  const max = Math.max(1, ...series.map((p) => p[p.length - 1].v));
  const yMax = Math.ceil(max * 2) / 2;
  const x = (m: number) => L + (m / 90) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const path = (pts: typeof series[0]) => {
    let d = `M${x(0)},${y(0)}`;
    for (const p of pts.slice(1)) d += ` H${x(p.m)} V${y(p.v)}`;
    return d + ` H${x(90)}`;
  };
  const at = (side: number, m: number) => [...series[side]].reverse().find((p) => p.m <= m)?.v ?? 0;
  const ticks = Array.from({ length: Math.floor(yMax / 0.5) + 1 }, (_, i) => i * 0.5);
  return (
    <div className="chart">
      <div className="chart-legend">
        {teams.map((t, i) => <span key={i}><i style={{ background: t.color }} />{t.name} <b>{series[i][series[i].length - 1].v.toFixed(2)} xG</b></span>)}
        <span className="faint"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor" /></svg> Tor</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Kumulierte erwartete Tore im Spielverlauf"
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const m = Math.round(((e.clientX - r.left) / r.width * W - L) / (W - L - R) * 90); setHover(m >= 0 && m <= 90 ? m : null); }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="chart-grid" /><text x={L - 6} y={y(v) + 4} className="chart-axis" textAnchor="end">{v.toFixed(1)}</text></g>
        ))}
        {[0, 15, 30, 45, 60, 75, 90].map((m) => <text key={m} x={x(m)} y={H - 8} className="chart-axis" textAnchor="middle">{m}'</text>)}
        <line x1={x(45)} x2={x(45)} y1={T} y2={H - B} className="chart-half" />
        {series.map((pts, i) => <path key={i} d={path(pts)} fill="none" stroke={teams[i].color} strokeWidth={2} strokeLinejoin="round" />)}
        {series.map((pts, i) => pts.filter((p) => p.goal).map((p, j) => (
          <circle key={`${i}-${j}`} cx={x(p.m)} cy={y(p.v)} r={5} fill={teams[i].color} className="chart-ring" />
        )))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="chart-cross" />
            {[0, 1].map((i) => <circle key={i} cx={x(hover)} cy={y(at(i, hover))} r={3.5} fill={teams[i].color} className="chart-ring" />)}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{hover}. Minute</b>
          {teams.map((t, i) => <span key={i}><i style={{ background: t.color }} />{t.short ?? t.name}: {at(i, hover).toFixed(2)} xG</span>)}
        </div>
      )}
    </div>
  );
}

export function ShotMap({ shots, teams, names }: { shots: Shot[]; teams: [TeamInfo, TeamInfo]; names: Map<number, string> }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 414; // 105 x 68 m
  const px = (s: Shot) => (s.side === 0 ? s.x : 1 - s.x) * W;
  const py = (s: Shot) => (s.side === 0 ? s.y : 1 - s.y) * H;
  const h = hover !== null ? shots[hover] : null;
  return (
    <div className="chart">
      <div className="chart-legend">
        {teams.map((t, i) => <span key={i}><i style={{ background: t.color }} />{t.name} {i === 0 ? "→" : "←"}</span>)}
        <span className="faint"><svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="currentColor" /></svg> Tor</span>
        <span className="faint"><svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg> gehalten</span>
        <span className="faint"><svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.2" fill="currentColor" opacity="0.3" /></svg> daneben</span>
        <span className="faint">Grösse = xG</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg shotmap" role="img" aria-label="Torschusskarte">
        <rect x={0} y={0} width={W} height={H} className="sm-pitch" />
        <line x1={W / 2} x2={W / 2} y1={0} y2={H} className="sm-line" />
        <circle cx={W / 2} cy={H / 2} r={56} className="sm-line" fill="none" />
        {[0, 1].map((side) => {
          const bx = side === 0 ? W - (16.5 / 105) * W : 0;
          const sx = side === 0 ? W - (5.5 / 105) * W : 0;
          return (
            <g key={side}>
              <rect x={bx} y={(13.84 / 68) * H} width={(16.5 / 105) * W} height={(40.32 / 68) * H} className="sm-line" fill="none" />
              <rect x={sx} y={(24.84 / 68) * H} width={(5.5 / 105) * W} height={(18.32 / 68) * H} className="sm-line" fill="none" />
            </g>
          );
        })}
        {shots.map((s, i) => {
          const r = 4 + Math.sqrt(s.xg) * 16;
          const c = teams[s.side].color;
          return (
            <circle key={i} cx={px(s)} cy={py(s)} r={r} className="sm-shot"
              fill={s.outcome === "goal" ? c : s.outcome === "off" ? c : "none"} fillOpacity={s.outcome === "off" ? 0.3 : 1}
              stroke={s.outcome === "off" ? "none" : s.outcome === "goal" ? "var(--panel)" : c} strokeWidth={s.outcome === "goal" ? 2 : 2.4}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          );
        })}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(px(h) / W) * 100}%`, top: `${(py(h) / H) * 100}%` }}>
          <b>{minute(h.tick)}' · {names.get(h.playerId) ?? "Spieler"}</b>
          <span>{KIND[h.kind] ?? h.kind} · {OUTCOME[h.outcome]}</span>
          <span>xG {h.xg.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

/** Tabelle aller Torschüsse (Zugänglichkeit und Details). */
export function ShotTable({ shots, teams, names }: { shots: Shot[]; teams: [TeamInfo, TeamInfo]; names: Map<number, string> }) {
  return (
    <div className="table-wrap shot-table">
      <table className="table">
        <thead><tr><th>Min.</th><th>Team</th><th>Spieler</th><th className="hide-sm">Art</th><th className="r">xG</th><th>Ergebnis</th></tr></thead>
        <tbody>
          {[...shots].sort((a, b) => a.tick - b.tick).map((s, i) => (
            <tr key={i} className={s.outcome === "goal" ? "highlight" : ""}>
              <td className="num">{minute(s.tick)}'</td>
              <td><span className="row" style={{ gap: 6 }}><i className="shot-swatch" style={{ background: teams[s.side].color }} />{teams[s.side].short ?? teams[s.side].name}</span></td>
              <td className="truncate" style={{ maxWidth: 160 }}>{names.get(s.playerId) ?? "–"}</td>
              <td className="small dim hide-sm">{KIND[s.kind] ?? s.kind}</td>
              <td className="r num">{s.xg.toFixed(2)}</td>
              <td>{s.outcome === "goal" ? <b className="pos-text">Tor</b> : <span className="dim">{OUTCOME[s.outcome]}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
