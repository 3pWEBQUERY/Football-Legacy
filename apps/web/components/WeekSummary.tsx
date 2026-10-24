"use client";
import Link from "next/link";
import { seasonLabel } from "@/lib/client/format";
import { Icon } from "./ui";

export function WeekSummaryView({ summary, base, onClose }: { summary: any; base: string; onClose: () => void }) {
  const end = summary.seasonEnd;
  return (
    <div className="stack">
      <div className="between">
        <h2 className="up">{end ? `Saison ${seasonLabel(end.season)} – Abschluss` : `Woche ${summary.week} abgeschlossen`}</h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Schliessen"><Icon name="close" size={16} /></button>
      </div>
      {end && (
        <div className="card-soft stack-sm" style={{ borderLeft: `3px solid ${end.champion ? "var(--gold)" : end.promoted ? "var(--pos)" : end.relegated ? "var(--neg)" : "var(--accent)"}` }}>
          <span className="faint small up">Abschlussplatzierung</span>
          <strong className="cond" style={{ fontSize: 28 }}>
            {end.champion ? "Meister" : end.promoted ? "Aufstieg" : end.relegated ? "Abstieg" : `Platz ${end.position}`} · {end.points} Punkte
          </strong>
          <span className="dim">Saisonziel {end.objectiveMet ? "erfüllt" : "verfehlt"}</span>
          {end.dismissed && <span className="badge badge-danger">Entlassen – wähle im Büro ein Jobangebot</span>}
          {end.champions?.length > 0 && <span className="faint small">Meister: {end.champions.slice(0, 6).map((c: any) => `${c.clubName} (${c.leagueName})`).join(" · ")}</span>}
        </div>
      )}
      {summary.results?.length > 0 && (
        <div className="card card-flush">
          <div className="card-head"><h3>Ergebnisse deiner Liga</h3></div>
          <table className="table">
            <tbody>
              {summary.results.map((r: any) => (
                <tr key={r.fixtureId}>
                  <td className="r name">{r.homeName}</td>
                  <td className="c" style={{ width: 70 }}>
                    <Link href={`${base}/report/${r.fixtureId}`} onClick={onClose} className="cond" style={{ fontWeight: 700, fontSize: 16 }}>{r.homeGoals} – {r.awayGoals}</Link>
                  </td>
                  <td className="name">{r.awayName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {summary.results?.length === 0 && !end && <p className="dim">Spielfreie Woche. Die Mannschaft hat trainiert.</p>}
      {summary.notes?.length > 0 && (
        <div className="stack-sm">
          <span className="faint small up">Belohnungen</span>
          <div className="row-wrap">{summary.notes.map((n: any, i: number) => <span key={i} className={`badge ${n.kind === "xp" ? "" : "badge-blue"}`}>{n.text}</span>)}</div>
        </div>
      )}
      {summary.news?.length > 0 && (
        <div className="stack-sm">
          <span className="faint small up">Transfermeldungen</span>
          {summary.news.slice(0, 8).map((n: string, i: number) => <div key={i} className="small dim" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 4 }}>{n}</div>)}
        </div>
      )}
    </div>
  );
}
