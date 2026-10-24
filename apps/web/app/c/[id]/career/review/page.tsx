"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/client/api";
import { seasonLabel } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Empty, ErrorBox, Icon, Loading, Panel, Pos } from "@/components/ui";

export default function ReviewPage() {
  const { id } = useGame();
  const [season, setSeason] = useState<number | null>(null);
  const { data, error } = useApi<any>(`careers/${id}/review${season ? `?season=${season}` : ""}`);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const r = data.review;
  const player = (e: any) => (e ? <Link href={`/c/${id}/player/${e.playerId}`} className="name">{e.name}</Link> : <span className="faint">–</span>);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Saisonrückblick</h1>
          <p>{r ? `${r.leagueName} · Saison ${seasonLabel(r.season)}` : "Nach der ersten abgeschlossenen Saison erscheint hier der Rückblick."}</p>
        </div>
        {data.seasons.length > 0 && (
          <div className="field">
            <label>Saison</label>
            <select className="select" value={r?.season ?? ""} onChange={(e) => setSeason(Number(e.target.value))}>
              {data.seasons.map((s: number) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
            </select>
          </div>
        )}
      </div>
      {!r ? <div className="card"><Empty>Noch kein Rückblick vorhanden. Spiele deine erste Saison zu Ende.</Empty></div> : (
        <>
          <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
            <div className="stat"><span className="label">Platzierung</span><span className="value">{r.club.position}.</span><span className="sub">{r.club.points} Punkte</span></div>
            <div className="stat"><span className="label">Bilanz</span><span className="value" style={{ fontSize: 20 }}>{r.club.record}</span></div>
            <div className="stat"><span className="label">Pokal</span><span className="value" style={{ fontSize: 20 }}>{r.club.cup ?? "–"}</span>{r.cupWinner && <span className="sub">Sieger: {r.cupWinner}</span>}</div>
            <div className="stat"><span className="label">Bester Spieler</span><span className="value" style={{ fontSize: 20 }}>{r.club.bestPlayer?.name ?? "–"}</span>{r.club.bestPlayer?.value && <span className="faint small">{r.club.bestPlayer.value}</span>}</div>
            <div className="stat"><span className="label">Bester Torschütze</span><span className="value" style={{ fontSize: 20 }}>{r.club.topScorer?.name ?? "–"}</span>{r.club.topScorer?.value && <span className="faint small">{r.club.topScorer.value}</span>}</div>
          </div>
          <div className="grid grid-side" style={{ alignItems: "start" }}>
            <div className="stack">
              <Panel title="Auszeichnungen der Liga" icon="trophy" flush>
                <table className="table">
                  <tbody>
                    {r.awards.map((a: any) => (
                      <tr key={a.key} className={a.entry?.own ? "highlight" : ""}>
                        <td className="cond up faint" style={{ fontWeight: 700, width: 190 }}>{a.title}</td>
                        <td>{a.entry && <Pos p={a.entry.position} />}</td>
                        <td>{player(a.entry)}<div className="faint small">{a.entry?.clubName}{a.entry ? ` · ${a.entry.age} J.` : ""}</div></td>
                        <td className="r cond" style={{ fontWeight: 700, fontSize: 15 }}>{a.entry?.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
              <Panel title="Elf der Saison" icon="board" flush>
                <table className="table">
                  <thead><tr><th>Pos</th><th>Spieler</th><th>Verein</th><th className="r">Ø Note</th></tr></thead>
                  <tbody>
                    {r.teamOfSeason.map((e: any) => (
                      <tr key={e.playerId} className={e.own ? "highlight" : ""}>
                        <td><Pos p={e.position} /></td>
                        <td>{player(e)}</td>
                        <td className="dim">{e.clubName}</td>
                        <td className="r cond" style={{ fontWeight: 700, fontSize: 15 }}>{e.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>
            <Panel title="Abschlusstabelle" icon="chart" flush>
              <table className="table">
                <thead><tr><th className="c">#</th><th>Verein</th><th className="c">Sp</th><th className="c">Diff</th><th className="c">Pkt</th></tr></thead>
                <tbody>
                  {r.table.map((t: any) => (
                    <tr key={t.clubId} className={t.clubId === data.userClubId ? "highlight" : ""}>
                      <td className="c cond" style={{ fontWeight: 700 }}>{t.position}</td>
                      <td className="name truncate">{t.position === 1 && <Icon name="trophy" size={13} />} {t.clubName}</td>
                      <td className="c">{t.played}</td>
                      <td className="c">{t.gf - t.ga > 0 ? "+" : ""}{t.gf - t.ga}</td>
                      <td className="c cond" style={{ fontWeight: 700, fontSize: 15 }}>{t.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
