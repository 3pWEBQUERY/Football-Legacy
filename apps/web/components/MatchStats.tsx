"use client";
import { matchRatingColor } from "@/lib/client/format";
import { EventIcon, Icon } from "./ui";

export function StatRows({ stats, names, mine }: { stats: [any, any]; names?: [string, string]; mine?: number }) {
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
      {names && (
        <div className="between small stat-names">
          <b className={mine === 0 ? "mine" : "opp"}>{names[0]}{mine === 0 && " · Du"}</b>
          <b className={mine === 1 ? "mine" : "opp"}>{mine === 1 && "Du · "}{names[1]}</b>
        </div>
      )}
      {rows.map(([label, hv, av, hn, an]) => {
        const sum = Math.max(0.0001, hn + an);
        return (
          <div key={label}>
            <div className="between small"><b className="num" style={mine === 0 ? { color: "var(--text)" } : mine === 1 ? { color: "var(--text-3)" } : undefined}>{hv}</b><span className="dim">{label}</span><b className="num" style={mine === 1 ? { color: "var(--text)" } : mine === 0 ? { color: "var(--text-3)" } : undefined}>{av}</b></div>
            <div className="row" style={{ gap: 3, marginTop: 3 }}>
              <div style={{ flex: hn / sum || 0.001, height: 5, background: "var(--home, var(--accent))" }} />
              <div style={{ flex: an / sum || 0.001, height: 5, background: "var(--away, var(--text-3))" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RatingList({ players, side, title, motm, mine }: { players: any[]; side: number; title: string; motm?: number | null; mine?: boolean }) {
  const list = players.filter((p) => p.side === side).sort((a, b) => Number(b.started) - Number(a.started) || b.rating - a.rating);
  return (
    <table className={`table ${mine ? "ratings-mine" : ""}`}>
      <thead><tr><th>{title}{mine && <span className="mine-tag">Dein Team</span>}</th><th className="c">Min</th><th className="r">Note</th></tr></thead>
      <tbody>
        {list.map((p) => (
          <tr key={p.playerId}>
            <td>
              <span className="row" style={{ gap: 6 }}>
                {!p.started && <span className="faint" title="Eingewechselt"><Icon name="up" size={12} stroke={2.4} /></span>}
                <span className="name truncate">{p.name}</span>
                {Array.from({ length: Math.min(p.goals, 4) }).map((_, i) => <EventIcon key={i} type="goal" />)}
                {p.assists > 0 && <span className="badge" title="Vorlagen">V{p.assists > 1 ? p.assists : ""}</span>}
                {p.yellow > 0 && !p.red && <EventIcon type="yellow" />}
                {p.red && <EventIcon type="red" />}
                {p.injured && <EventIcon type="injury" />}
                {motm === p.playerId && <span className="badge badge-gold">Spieler des Spiels</span>}
              </span>
            </td>
            <td className="c faint">{p.minutes}</td>
            <td className="r cond" style={{ fontWeight: 700, fontSize: 15, color: matchRatingColor(p.rating) }}>{p.rating.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
