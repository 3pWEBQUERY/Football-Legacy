"use client";
import Link from "next/link";
import { seasonLabel } from "@/lib/client/format";

export function WeekSummaryView({ summary, base, onClose }: { summary: any; base: string; onClose: () => void }) {
  const end = summary.seasonEnd;
  return (
    <div className="stack">
      <div className="between">
        <h2>{end ? `Saison ${seasonLabel(end.season)} beendet` : `Woche ${summary.week} abgeschlossen`}</h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Schliessen</button>
      </div>
      {end && (
        <div className="card-soft stack-sm" style={{ borderColor: end.champion ? "var(--gold)" : undefined }}>
          <div style={{ fontSize: 28 }}>{end.champion ? "🏆" : end.promoted ? "📈" : end.relegated ? "📉" : "📅"}</div>
          <strong style={{ fontSize: 17 }}>
            {end.champion ? "Meister!" : end.promoted ? "Aufstieg geschafft!" : end.relegated ? "Abgestiegen." : `Platz ${end.position}`} – {end.points} Punkte
          </strong>
          <span className="dim">Saisonziel {end.objectiveMet ? "erfüllt ✅" : "verfehlt ❌"}</span>
          {end.dismissed && <span className="badge badge-danger">Der Vorstand hat dich entlassen – wähle im Büro ein Jobangebot.</span>}
          {end.champions?.length > 0 && (
            <span className="faint small">Meister der Topligen: {end.champions.slice(0, 6).map((c: any) => `${c.clubName} (${c.leagueName})`).join(" · ")}</span>
          )}
        </div>
      )}
      {summary.results?.length > 0 && (
        <div className="stack-sm">
          <h3>Ergebnisse deiner Liga</h3>
          <div className="grid grid-2" style={{ gap: 6 }}>
            {summary.results.map((r: any) => (
              <Link key={r.fixtureId} href={`${base}/report/${r.fixtureId}`} onClick={onClose} className="card-soft between small" style={{ padding: "8px 10px" }}>
                <span className="truncate" style={{ flex: 1 }}>{r.homeName}</span>
                <b className="num" style={{ padding: "0 10px" }}>{r.homeGoals}:{r.awayGoals}</b>
                <span className="truncate" style={{ flex: 1, textAlign: "right" }}>{r.awayName}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {summary.results?.length === 0 && !end && <p className="dim">Spielfreie Woche – dein Team hat trainiert.</p>}
      {summary.notes?.length > 0 && (
        <div className="stack-sm">
          <h3>Belohnungen</h3>
          <div className="row-wrap">
            {summary.notes.map((n: any, i: number) => <span key={i} className="badge badge-accent">{n.icon ?? "✨"} {n.text}</span>)}
          </div>
        </div>
      )}
      {summary.news?.length > 0 && (
        <div className="stack-sm">
          <h3>Transfernews</h3>
          <ul className="dim small" style={{ margin: 0, paddingLeft: 18 }}>
            {summary.news.slice(0, 8).map((n: string, i: number) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
