"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/client/api";
import { dayIso, fmtDate } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Crest, Empty, ErrorBox, Icon, Loading, Nat, Panel } from "@/components/ui";

type View = "groups" | "ko";

export default function ContinentalPage() {
  const { id, shell } = useGame();
  const { data, error } = useApi<any>(`careers/${id}/continental`);
  const [view, setView] = useState<View | null>(null);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  if (!data.cup) return <div className="card"><Empty>In dieser Saison findet kein Kontinentalpokal statt.</Empty></div>;
  const season = data.cup.season;
  const koRounds = data.rounds.filter((r: any) => !r.group);
  const koStarted = koRounds.some((r: any) => r.matches.length > 0);
  const active: View = view ?? (koStarted ? "ko" : "groups");
  const me = data.userClubId;
  const userIn = (m: any) => m.home?.id === me || m.away?.id === me;
  const myGroup = data.groups.find((g: any) => g.table.some((r: any) => r.clubId === me));
  const myMatches = [
    ...(myGroup?.matches ?? []).filter(userIn).map((m: any) => ({ ...m, roundName: data.rounds.find((r: any) => r.round === m.round)?.name, day: data.rounds.find((r: any) => r.round === m.round)?.day })),
    ...koRounds.flatMap((r: any) => r.matches.filter(userIn).map((m: any) => ({ ...m, roundName: r.name, day: r.day }))),
  ];
  const nextRound = data.rounds.find((r: any) => r.current);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{data.cup.name}</h1>
          <p>Saison {season} · {data.cup.size} Vereine · Gruppenphase mit Hin- und Rückspiel, danach K.-o.-Runden in einem Spiel{nextRound?.day !== null && nextRound ? ` · Nächste Runde: ${nextRound.name}, ${fmtDate(dayIso(season, nextRound.day))}` : ""}</p>
        </div>
        {data.cup.winner && (
          <div className="card row" style={{ padding: "8px 14px", gap: 10, borderColor: "var(--gold)" }}>
            <span className="faint small up">Sieger</span>
            <Crest colors={data.cup.winner.colors} name={data.cup.winner.name} size={22} />
            <b className="cond up" style={{ fontSize: 17 }}>{data.cup.winner.name}</b>
          </div>
        )}
      </div>

      <div className="grid grid-side" style={{ alignItems: "start" }}>
        <section className="card card-flush">
          <div className="tabs" style={{ padding: "0 8px", background: "var(--panel-h)" }}>
            <button className={`tab ${active === "groups" ? "active" : ""}`} onClick={() => setView("groups")}>Gruppenphase</button>
            <button className={`tab ${active === "ko" ? "active" : ""}`} onClick={() => setView("ko")}>K.-o.-Runde</button>
          </div>
          {active === "groups" ? (
            <div className="intl-groups">
              {data.groups.map((g: any) => (
                <div key={g.name} className={`intl-group ${g === myGroup ? "mine" : ""}`}>
                  <div className="intl-group-head">{g.name}</div>
                  <table className="table">
                    <thead><tr><th className="c">#</th><th>Verein</th><th className="c">Sp</th><th className="c">Diff</th><th className="c">Pkt</th></tr></thead>
                    <tbody>
                      {g.table.map((r: any) => (
                        <tr key={r.clubId} className={r.clubId === me ? "highlight" : ""} style={{ boxShadow: r.position <= 2 ? "inset 3px 0 0 var(--pos)" : undefined }}>
                          <td className="c cond" style={{ fontWeight: 700 }}>{r.position}</td>
                          <td>
                            <Link href={`/c/${id}/club/${r.clubId}`} className="row" style={{ gap: 7, minWidth: 0 }}>
                              <Crest colors={r.club.colors} name={r.club.name} size={16} />
                              <span className="truncate name">{r.club.name}</span>
                              <Nat code={r.club.countryCode} />
                            </Link>
                          </td>
                          <td className="c">{r.played}</td>
                          <td className="c">{r.goalsFor - r.goalsAgainst > 0 ? "+" : ""}{r.goalsFor - r.goalsAgainst}</td>
                          <td className="c cond" style={{ fontWeight: 700, fontSize: 15 }}>{r.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : !koStarted ? <Empty>Die K.-o.-Runde wird nach dem letzten Gruppenspieltag ausgelost.</Empty> : (
            <div className="intl-bracket">
              {koRounds.map((r: any) => (
                <div key={r.round} className="intl-round">
                  <div className="intl-round-head">{r.name}{r.day !== null && <span className="faint"> · {fmtDate(dayIso(season, r.day), { year: false })}</span>}</div>
                  {r.matches.length === 0 ? <div className="faint small" style={{ padding: 10 }}>Noch offen</div> : r.matches.map((m: any) => (
                    <Link key={m.id} href={m.played ? `/c/${id}/report/${m.id}` : `/c/${id}/club/${m.home.id === me ? m.away.id : m.home.id}`} className={`intl-tie ${userIn(m) ? "mine" : ""}`}>
                      {[m.home, m.away].map((c: any, i: number) => (
                        <div key={c.id} className={`intl-side ${m.winnerId && m.winnerId !== c.id ? "lost" : ""}`}>
                          <Crest colors={c.colors} name={c.name} size={16} />
                          <span className="truncate" style={{ flex: 1 }}>{c.name}</span>
                          <b className="cond">{m.played ? (i === 0 ? m.homeGoals : m.awayGoals) : ""}{m.played && m.penHome !== null ? <span className="faint" style={{ fontSize: 11 }}> ({i === 0 ? m.penHome : m.penAway})</span> : null}</b>
                        </div>
                      ))}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div className="faint small" style={{ padding: "8px 14px", borderTop: "1px solid var(--line)" }}>
            <span style={{ display: "inline-block", width: 10, height: 10, background: "var(--pos)", marginRight: 6, verticalAlign: "middle" }} />
            Die ersten beiden jeder Gruppe erreichen die K.-o.-Runde. Gruppensieger haben dort Heimrecht.
          </div>
        </section>

        <Panel title="Dein Weg" icon="trophy">
          {!data.participating ? (
            <p className="dim">{shell?.club?.name ?? "Dein Verein"} ist in dieser Saison nicht qualifiziert. Die besten Vereine jeder Topliga qualifizieren sich über die Abschlusstabelle für die nächste Saison.</p>
          ) : (
            <div className="stack-sm">
              {myMatches.map((m: any) => {
                const home = m.home.id === me;
                const opp = home ? m.away : m.home;
                const gf = home ? m.homeGoals : m.awayGoals;
                const ga = home ? m.awayGoals : m.homeGoals;
                const res = !m.played ? null : m.winnerId ? (m.winnerId === me ? "W" : "L") : gf > ga ? "W" : gf < ga ? "L" : "D";
                return (
                  <div key={m.id} className="kv">
                    <span className="k">{m.roundName?.replace("Gruppenphase · ", "")}{m.day !== null && m.day !== undefined ? ` · ${fmtDate(dayIso(season, m.day), { year: false })}` : ""}</span>
                    <span className="v row" style={{ gap: 6 }}>
                      {home ? "vs" : "@"} {opp.short}
                      {m.played && <span className={`badge ${res === "W" ? "badge-accent" : res === "L" ? "badge-danger" : ""}`}>{gf}:{ga}</span>}
                    </span>
                  </div>
                );
              })}
              {myGroup && (
                <div className="small" style={{ marginTop: 6 }}>
                  <Icon name="trophy" size={14} /> {myGroup.name}: Platz {myGroup.table.find((r: any) => r.clubId === me)?.position}
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
