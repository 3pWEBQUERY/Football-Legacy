"use client";
import Link from "next/link";
import { useState } from "react";
import { api, refreshAll } from "@/lib/client/api";
import { CATEGORY_ICON, money } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Crest, Empty, FormChips, Icon, Loading, Progress, Rating, useToast } from "@/components/ui";

export default function Office() {
  const { id, shell: d, advance, busy } = useGame();
  const toast = useToast();
  const [open, setOpen] = useState<number | null>(null);
  const base = `/c/${id}`;
  if (!d) return <Loading />;

  async function read(item: any) {
    setOpen(open === item.id ? null : item.id);
    if (!item.read) {
      await api(`careers/${id}/inbox`, { body: { ids: [item.id] } }).catch(() => {});
      item.read = true;
    }
  }

  async function respond(transferId: number, decision: "accept" | "reject" | "counter") {
    let counterFee: number | undefined;
    if (decision === "counter") {
      const v = prompt("Welche Ablöse forderst du (in Mio. €)?");
      if (!v) return;
      counterFee = Math.round(parseFloat(v.replace(",", ".")) * 1_000_000);
      if (!Number.isFinite(counterFee)) return;
    }
    try {
      const r = await api<any>(`careers/${id}/offers/${transferId}`, { body: { decision, counterFee } });
      toast(r.message, r.status === "completed" ? "success" : "info");
      refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function acceptJob(clubId: number) {
    try {
      await api(`careers/${id}/job`, { body: { clubId } });
      toast("Neuer Verein – viel Erfolg!", "success");
      refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const c = d.career;
  const board = d.board;
  const next = d.next;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Büro</h1>
          <p>Guten Tag, {c.managerName}. {c.week === 0 ? "Die Saisonvorbereitung läuft." : `Woche ${c.week} von ${c.seasonWeeks}.`}</p>
        </div>
      </div>

      {c.status === "unemployed" && (
        <div className="card stack" style={{ borderColor: "var(--warn)" }}>
          <h3>Du bist aktuell ohne Verein</h3>
          <p className="dim">Wähle eines der Jobangebote, um weiterzumachen.</p>
          {d.jobOffers.map((o: any) => (
            <div key={o.clubId} className="card-soft between">
              <div><strong>{o.clubName}</strong> <span className="dim">· {o.leagueName}</span></div>
              <button className="btn btn-primary btn-sm" onClick={() => acceptJob(o.clubId)}>Annehmen</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          {next && (
            <div className="card stack">
              <div className="card-head" style={{ marginBottom: 0 }}>
                <h3><Icon name="whistle" /> Nächstes Spiel · {next.week}. Spieltag</h3>
                {next.window?.open && <span className="badge badge-accent">{next.window.label}</span>}
              </div>
              <div className="between" style={{ padding: "8px 0" }}>
                <Link href={`${base}/club/${next.home.id}`} className="row" style={{ flex: 1 }}>
                  <Crest colors={next.home.colors} name={next.home.name} size={42} />
                  <div><strong>{next.home.name}</strong><div className="faint small">Heim · Stärke {next.home.rating}</div></div>
                </Link>
                <span className="faint" style={{ fontWeight: 800, fontSize: 18 }}>vs</span>
                <Link href={`${base}/club/${next.away.id}`} className="row" style={{ flex: 1, justifyContent: "flex-end", textAlign: "right" }}>
                  <div><strong>{next.away.name}</strong><div className="faint small">Gast · Stärke {next.away.rating}</div></div>
                  <Crest colors={next.away.colors} name={next.away.name} size={42} />
                </Link>
              </div>
              {next.analysis && (
                <div className="card-soft stack-sm">
                  <div className="between small"><b>Gegner-Analyse</b><span className="dim">Formation {next.analysis.formation}</span></div>
                  <div className="row-wrap small">
                    <span className="dim">Form:</span> <FormChips form={next.analysis.form} />
                    <span className="dim" style={{ marginLeft: 8 }}>Gefährlich:</span>
                    {next.analysis.keyPlayers.map((p: any) => <span key={p.id} className="badge">{p.name} ({p.rating})</span>)}
                  </div>
                </div>
              )}
              <div className="row-wrap">
                <Link className="btn" href={`${base}/team/tactic`}><Icon name="team" size={16} /> Aufstellung prüfen</Link>
                <button className="btn btn-primary" onClick={advance} disabled={busy}><Icon name="whistle" size={16} /> Zum Spiel</button>
              </div>
            </div>
          )}

          {d.offers?.length > 0 && (
            <div className="card stack">
              <h3>🔁 Offene Angebote für deine Spieler</h3>
              {d.offers.map((o: any) => (
                <div key={o.id} className="card-soft between">
                  <div><strong>{o.player_name}</strong> <span className="dim">· {o.message} · {money(o.fee)}</span></div>
                  <div className="row">
                    <button className="btn btn-primary btn-sm" onClick={() => respond(o.id, "accept")}>Annehmen</button>
                    <button className="btn btn-sm" onClick={() => respond(o.id, "counter")}>Mehr fordern</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => respond(o.id, "reject")}>Ablehnen</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card card-flush">
            <div className="card-head" style={{ paddingBottom: 12 }}>
              <h3><Icon name="mail" /> Posteingang {d.unread > 0 && <span className="badge badge-accent">{d.unread} neu</span>}</h3>
              {d.unread > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={async () => { await api(`careers/${id}/inbox`, { body: { ids: "all" } }); refreshAll(); }}>Alle gelesen</button>
              )}
            </div>
            {d.inbox.length === 0 && <Empty>Keine Nachrichten.</Empty>}
            {d.inbox.map((m: any) => (
              <div key={m.id} className={`inbox-item ${m.read ? "" : "unread"}`} onClick={() => read(m)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && read(m)}>
                <div className="inbox-icon">{CATEGORY_ICON[m.category] ?? "✉️"}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="between">
                    <span className="inbox-title truncate">{m.title}</span>
                    <span className="faint small nowrap">{m.week === 0 ? "Vorbereitung" : `Woche ${m.week}`}</span>
                  </div>
                  {open === m.id ? (
                    <div className="stack-sm" style={{ marginTop: 6 }}>
                      <p className="inbox-body">{m.body}</p>
                      {m.action?.type === "fixture" && <Link className="btn btn-sm" href={`${base}/report/${m.action.fixtureId}`} onClick={(e) => e.stopPropagation()}>Spielbericht</Link>}
                    </div>
                  ) : (
                    <p className="faint small truncate">{m.body.split("\n")[0]}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="stack">
          <div className="card stack">
            <h3>🏛️ Vorstand</h3>
            <p>{board.objective}</p>
            <div className="stack-sm">
              <div className="between small"><span className="dim">Vertrauen</span><b>{board.confidence}/100</b></div>
              <Progress value={board.confidence} tone={board.confidence < 35 ? "danger" : board.confidence < 55 ? "warn" : undefined} />
            </div>
            <div className="between small"><span className="dim">Kontostand mindestens</span><b>{money(board.financeTarget)}</b></div>
            <div className="between small"><span className="dim">Erwarteter Platz</span><b>{board.expectedPosition}</b></div>
          </div>

          <div className="card stack">
            <div className="between"><h3>🎯 Tagesmissionen</h3><span className="faint small">neu jeden Tag</span></div>
            {d.missions.map((m: any) => (
              <div key={m.kind} className="row" style={{ opacity: m.done ? 0.6 : 1 }}>
                <span style={{ fontSize: 18 }}>{m.done ? "✅" : "⬜"}</span>
                <div style={{ flex: 1 }}>
                  <strong style={{ textDecoration: m.done ? "line-through" : undefined }}>{m.name}</strong>
                  <div className="faint small">{m.description}</div>
                </div>
                <span className="badge badge-gold">+{m.points} MP</span>
              </div>
            ))}
            <div className="between small"><span className="dim">🔥 Login-Serie</span><b>{d.loginStreak} {d.loginStreak === 1 ? "Tag" : "Tage"}</b></div>
          </div>

          {d.table?.length > 0 && (
            <div className="card card-flush">
              <div className="card-head" style={{ paddingBottom: 6 }}>
                <h3>📊 Tabelle</h3>
                <Link href={`${base}/competition`} className="btn btn-ghost btn-sm">Ganze Tabelle</Link>
              </div>
              <table className="table">
                <tbody>
                  {d.table.map((r: any) => (
                    <tr key={r.clubId} className={r.clubId === c.clubId ? "highlight" : ""}>
                      <td className="num" style={{ width: 28 }}>{r.position}.</td>
                      <td><Link href={`${base}/club/${r.clubId}`} className="row" style={{ gap: 8 }}><Crest colors={r.club.colors} name={r.club.name} size={16} /><span className="truncate">{r.club.name}</span></Link></td>
                      <td className="r num faint">{r.played}</td>
                      <td className="r num faint">{r.goalsFor - r.goalsAgainst > 0 ? "+" : ""}{r.goalsFor - r.goalsAgainst}</td>
                      <td className="r num"><b>{r.points}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {d.recent?.length > 0 && (
            <div className="card stack-sm">
              <h3>Letzte Spiele</h3>
              {d.recent.map((r: any) => {
                const res = r.goalsFor > r.goalsAgainst ? "W" : r.goalsFor === r.goalsAgainst ? "D" : "L";
                return (
                  <Link key={r.fixtureId} href={`${base}/report/${r.fixtureId}`} className="between small">
                    <span className="row" style={{ gap: 8 }}><FormChips form={[res]} /> <span className="truncate">{r.home ? "vs" : "@"} {r.opponent}</span></span>
                    <b className="num">{r.goalsFor}:{r.goalsAgainst}</b>
                  </Link>
                );
              })}
            </div>
          )}

          {d.club && (
            <div className="card grid grid-2">
              <div className="stack-sm"><span className="faint small">Kontostand</span><b>{money(d.club.balance)}</b></div>
              <div className="stack-sm"><span className="faint small">Transferbudget</span><b>{money(d.club.transferBudget)}</b></div>
              <div className="stack-sm"><span className="faint small">Mannschaftsstärke</span><Rating value={d.club.rating} /></div>
              <div className="stack-sm"><span className="faint small">Stadion</span><b>{d.club.capacity.toLocaleString("de-CH")}</b></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
