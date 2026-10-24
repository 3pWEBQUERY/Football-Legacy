"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/client/api";
import { dayIso, fmtDate } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Crest, Empty, ErrorBox, Icon, Loading, Panel } from "@/components/ui";

export default function CupPage() {
  const { id } = useGame();
  const { data, error } = useApi<any>(`careers/${id}/cup`);
  const [round, setRound] = useState<number | null>(null);
  useEffect(() => {
    if (!data?.cup) return;
    const userRound = [...data.rounds].reverse().find((r: any) => r.matches.some((m: any) => m.home.id === data.userClubId || m.away.id === data.userClubId));
    setRound(data.rounds.find((r: any) => r.current)?.round ?? userRound?.round ?? data.rounds[0].round);
  }, [data]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  if (!data.cup) return <div className="card"><Empty>In dieser Saison gibt es keinen Pokal.</Empty></div>;
  const r = data.rounds.find((x: any) => x.round === round) ?? data.rounds[0];
  const userIn = (m: any) => m.home.id === data.userClubId || m.away.id === data.userClubId;
  const userMatches = data.rounds.flatMap((x: any) => x.matches.filter(userIn).map((m: any) => ({ ...m, roundName: x.name })));
  const eliminated = userMatches.some((m: any) => m.played && m.winnerId !== data.userClubId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{data.cup.name}</h1>
          <p>Saison {data.cup.season} · {data.rounds.length} Runden · K.-o.-Modus, bei Remis Elfmeterschiessen, der klassentiefere Verein hat Heimrecht</p>
        </div>
        {data.cup.winner && (
          <div className="card row" style={{ padding: "8px 14px", gap: 10, borderColor: "var(--gold)" }}>
            <span className="faint small up">Pokalsieger</span>
            <Crest colors={data.cup.winner.colors} name={data.cup.winner.name} size={22} />
            <b className="cond up" style={{ fontSize: 17 }}>{data.cup.winner.name}</b>
          </div>
        )}
      </div>
      <div className="grid grid-side" style={{ alignItems: "start" }}>
        <section className="card card-flush">
          <div className="tabs" style={{ padding: "0 8px", background: "var(--panel-h)" }}>
            {data.rounds.map((x: any) => (
              <button key={x.round} className={`tab ${x.round === r.round ? "active" : ""}`} onClick={() => setRound(x.round)}>
                {x.name}{x.current && <span className="faint" style={{ marginLeft: 6, fontSize: 10 }}>AKTUELL</span>}
              </button>
            ))}
          </div>
          {r.matches.length === 0 ? <Empty>Diese Runde wird noch ausgelost.</Empty> : (
            <table className="table">
              <thead><tr><th className="r">Heim</th><th className="c">Ergebnis</th><th>Gast</th></tr></thead>
              <tbody>
                {r.matches.map((m: any) => (
                  <tr key={m.id} className={userIn(m) ? "highlight" : ""}>
                    <td className="r">
                      <span className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                        <span className={`name ${m.winnerId && m.winnerId !== m.home.id ? "faint" : ""}`}>{m.home.name}</span>
                        <span className="badge">{m.home.tier}. Liga</span>
                        <Crest colors={m.home.colors} name={m.home.name} size={18} />
                      </span>
                    </td>
                    <td className="c nowrap" style={{ width: 110 }}>
                      {m.played ? (
                        <Link href={`/c/${id}/report/${m.id}`} className="cond" style={{ fontWeight: 700, fontSize: 16 }}>
                          {m.homeGoals} – {m.awayGoals}{m.penHome !== null && <span className="faint small"> ({m.penHome}:{m.penAway} i.E.)</span>}
                        </Link>
                      ) : <span className="faint">– : –</span>}
                    </td>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <Crest colors={m.away.colors} name={m.away.name} size={18} />
                        <span className="badge">{m.away.tier}. Liga</span>
                        <span className={`name ${m.winnerId && m.winnerId !== m.away.id ? "faint" : ""}`}>{m.away.name}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="faint small" style={{ padding: "8px 14px", borderTop: "1px solid var(--line)" }}>
            {r.day !== null ? fmtDate(dayIso(data.cup.season, r.day), { long: true }) : `Runde ${r.round}`}{r.round === 1 && data.cup.byes > 0 ? ` · ${data.cup.byes} Vereine mit Freilos steigen in Runde 2 ein` : ""}
          </div>
        </section>
        <Panel title="Dein Pokalweg" icon="trophy">
          {userMatches.length === 0 ? <p className="dim">{data.rounds[0]?.matches.length ? "Dein Verein hat ein Freilos und steigt in Runde 2 ein." : "Noch keine Auslosung."}</p> : (
            <div className="stack-sm">
              {userMatches.map((m: any) => {
                const home = m.home.id === data.userClubId;
                const opp = home ? m.away : m.home;
                const won = m.played && m.winnerId === data.userClubId;
                return (
                  <div key={m.id} className="kv">
                    <span className="k">{m.roundName}</span>
                    <span className="v row" style={{ gap: 6 }}>
                      {home ? "vs" : "@"} {opp.name}
                      {m.played && <span className={`badge ${won ? "badge-accent" : "badge-danger"}`}>{m.homeGoals}:{m.awayGoals}{m.penHome !== null ? " i.E." : ""}</span>}
                    </span>
                  </div>
                );
              })}
              <div className="small" style={{ marginTop: 6, color: eliminated ? "var(--neg)" : data.cup.winner?.id === data.userClubId ? "var(--gold)" : "var(--pos)" }}>
                <Icon name={eliminated ? "close" : "trophy"} size={14} /> {data.cup.winner?.id === data.userClubId ? "Pokalsieger!" : eliminated ? "Ausgeschieden" : "Noch im Wettbewerb"}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
