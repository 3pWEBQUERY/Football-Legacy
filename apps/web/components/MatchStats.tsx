"use client";
import { matchRatingColor } from "@/lib/client/format";

export function StatRows({ stats }: { stats: [any, any] }) {
  const [h, a] = stats;
  const total = Math.max(1, h.possession + a.possession);
  const rows: [string, number | string, number | string, number, number][] = [
    ["Ballbesitz", `${Math.round((h.possession / total) * 100)}%`, `${Math.round((a.possession / total) * 100)}%`, h.possession, a.possession],
    ["Schüsse", h.shots, a.shots, h.shots, a.shots],
    ["Aufs Tor", h.onTarget, a.onTarget, h.onTarget, a.onTarget],
    ["Erwartete Tore (xG)", h.xg.toFixed(2), a.xg.toFixed(2), h.xg, a.xg],
    ["Passquote", `${Math.round((h.passesOk / Math.max(1, h.passes)) * 100)}%`, `${Math.round((a.passesOk / Math.max(1, a.passes)) * 100)}%`, h.passesOk / Math.max(1, h.passes), a.passesOk / Math.max(1, a.passes)],
    ["Ecken", h.corners, a.corners, h.corners, a.corners],
    ["Fouls", h.fouls, a.fouls, h.fouls, a.fouls],
    ["Gelbe Karten", h.yellow, a.yellow, h.yellow, a.yellow],
  ];
  return (
    <div className="stack-sm">
      {rows.map(([label, hv, av, hn, an]) => {
        const sum = Math.max(0.0001, hn + an);
        return (
          <div key={label}>
            <div className="between small"><b className="num">{hv}</b><span className="dim">{label}</span><b className="num">{av}</b></div>
            <div className="row" style={{ gap: 3, marginTop: 3 }}>
              <div style={{ flex: hn / sum || 0.001, height: 6, background: "var(--accent)", borderRadius: 3 }} />
              <div style={{ flex: an / sum || 0.001, height: 6, background: "var(--blue)", borderRadius: 3 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RatingList({ players, side, title, motm }: { players: any[]; side: number; title: string; motm?: number | null }) {
  const list = players.filter((p) => p.side === side).sort((a, b) => Number(b.started) - Number(a.started) || b.rating - a.rating);
  return (
    <div className="stack-sm">
      <h3>{title}</h3>
      {list.map((p) => (
        <div key={p.playerId} className="between small">
          <span className="truncate">
            {!p.started && <span className="faint">↑ </span>}{p.name}
            {p.goals > 0 && <span> {"⚽".repeat(Math.min(p.goals, 4))}</span>}
            {p.assists > 0 && <span className="faint"> 🅰️{p.assists > 1 ? p.assists : ""}</span>}
            {p.yellow > 0 && !p.red && <span> 🟨</span>}{p.red && <span> 🟥</span>}{p.injured && <span> 🩺</span>}
            {motm === p.playerId && <span className="badge badge-gold" style={{ marginLeft: 6 }}>Spieler des Spiels</span>}
          </span>
          <b className="num" style={{ color: matchRatingColor(p.rating) }}>{p.rating.toFixed(1)}</b>
        </div>
      ))}
    </div>
  );
}

export const EVENT_ICON: Record<string, string> = {
  goal: "⚽", penalty_goal: "⚽", own_goal: "⚽", penalty_miss: "❌", save: "🧤", miss: "↗️", yellow: "🟨", red: "🟥", sub: "🔁",
  injury: "🩺", corner: "🚩", freekick: "🎯", kickoff: "🟢", halftime: "⏸️", fulltime: "🏁", tactic: "📋", foul: "⚠️", chance: "💥", shot: "👟",
};
