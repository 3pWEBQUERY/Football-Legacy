"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, refreshAll } from "@/lib/client/api";
import { dayIso, fmtDate, money, weekdayShort } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { CategoryIcon, Crest, Empty, FormChips, Icon, Loading, Panel, Progress, Rating, useToast } from "@/components/ui";
import { useConfirm, usePrompt } from "@/components/Dialog";
import { Inbox } from "@/components/Inbox";

export default function Office() {
  const { id, shell: d, advance, busy, pendingMessage, clearPendingMessage } = useGame();
  const toast = useToast();
  const ask = useConfirm();
  const askText = usePrompt();
  const [openId, setOpenId] = useState<number | null>(null);
  const base = `/c/${id}`;

  useEffect(() => {
    if (d?.inbox?.length && openId === null) setOpenId(d.inbox[0].id);
  }, [d, openId]);

  // Aus dem Tagesbericht gewählte Nachricht öffnen
  useEffect(() => {
    if (pendingMessage === null || !d?.inbox) return;
    const m = d.inbox.find((x: any) => x.id === pendingMessage);
    // Die Nachricht kann erst mit dem nächsten Laden des Büros ankommen
    if (!m) return;
    setOpenId(m.id);
    if (!m.read) {
      m.read = true;
      api(`careers/${id}/inbox`, { body: { ids: [m.id] } }).catch(() => {});
    }
    clearPendingMessage();
  }, [pendingMessage, d, id, clearPendingMessage]);

  if (!d) return <Loading />;
  const c = d.career;
  const board = d.board;
  const next = d.next;

  async function select(m: any) {
    setOpenId(m.id);
    if (!m.read) {
      m.read = true;
      await api(`careers/${id}/inbox`, { body: { ids: [m.id] } }).catch(() => {});
    }
  }

  async function respond(transferId: number, decision: "accept" | "reject" | "counter") {
    let counterFee: number | undefined;
    if (decision === "counter") {
      const v = await askText({ title: "Gegenangebot", message: "Welche Ablöse forderst du (in Mio. €)?", placeholder: "z. B. 12,5", inputMode: "decimal", confirmLabel: "Gegenangebot senden" });
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

  async function acceptJob(clubId: number, name: string) {
    if (c.status !== "unemployed" && !(await ask({ title: `Zu ${name} wechseln?`, message: "Du verlässt deinen aktuellen Verein sofort.", confirmLabel: "Wechseln" }))) return;
    try {
      await api(`careers/${id}/job`, { body: { clubId } });
      toast("Neuer Verein übernommen.", "success");
      refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const offerFor = (m: any) => (m?.action?.type === "transfer_offer" ? d.offers.find((o: any) => o.id === m.action.transferId) : null);

  return (
    <>
      {(c.status === "unemployed" || d.jobOffers?.length > 0) && (
        <Panel title={c.status === "unemployed" ? "Du bist vereinslos" : "Jobangebote"} icon="board" actions={<Link className="btn btn-ghost btn-sm" href={`${base}/career/jobs`}>Freie Stellen</Link>}>
          <p className="dim" style={{ marginTop: 0, marginBottom: d.jobOffers?.length ? 10 : 0 }}>
            {c.status === "unemployed"
              ? d.jobOffers?.length ? "Diese Vereine wollen dich. Oder bewirb dich selbst auf offene Stellen – die Zeit läuft weiter." : "Noch keine Angebote. Bewirb dich unter Karriere → Freie Stellen oder lass die Zeit laufen und warte auf Anfragen."
              : "Andere Vereine haben Interesse an dir. Du kannst jederzeit wechseln."}
          </p>
          {d.jobOffers?.length > 0 && (
            <table className="table">
              <tbody>
                {d.jobOffers.map((o: any) => (
                  <tr key={o.clubId}>
                    <td className="name">{o.colors && <Crest colors={o.colors} name={o.clubName} size={18} />} {o.clubName}</td>
                    <td className="dim hide-sm">{o.leagueName}</td>
                    <td className="r"><button className="btn btn-primary btn-sm" onClick={() => acceptJob(o.clubId, o.clubName)}>Übernehmen</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {d.schedule?.length > 0 && (
        <section className="card card-flush">
          <div className="card-head">
            <h3><Icon name="calendar" size={15} /> Diese Woche</h3>
            <Link href={`${base}/calendar`} className="btn btn-ghost btn-sm">Kalender</Link>
          </div>
          <div className="week-strip">
            {d.schedule.map((s: any, i: number) => {
              const isNext = next && s.fixtureId === next.fixtureId;
              const opp = isNext ? (next.home.id === c.clubId ? next.away : next.home) : null;
              return (
                <div key={s.day} className={`week-day t-${s.type} ${i === 0 ? "today" : ""}`}>
                  <span className="wd">{i === 0 ? "Heute" : weekdayShort(s.date)}</span>
                  <span className="dt">{fmtDate(s.date, { year: false }).slice(3)}</span>
                  {opp ? (
                    <span className="row ty" style={{ gap: 6 }}><Crest colors={opp.colors} name={opp.name} size={16} /><span className="truncate">{opp.short} ({next.home.id === c.clubId ? "H" : "A"})</span></span>
                  ) : <span className="ty">{s.label}</span>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
        {next ? (
          <Panel title={`Nächstes Spiel · ${next.competition?.label ?? ""}`} icon={next.competition?.kind !== "league" ? "trophy" : "calendar"} actions={next.window?.open && <span className="badge badge-accent">{next.window.label}</span>}>
            <div className="fixture-row">
              <Link href={`${base}/club/${next.home.id}`} className="row" style={{ gap: 12, minWidth: 0 }}>
                <Crest colors={next.home.colors} name={next.home.name} size={48} />
                <div style={{ minWidth: 0 }}>
                  <div className="cond up truncate" style={{ fontSize: 20, fontWeight: 700 }}>{next.home.name}</div>
                  <div className="faint small">Heim · Stärke {next.home.rating}</div>
                </div>
              </Link>
              <div className="cond faint" style={{ fontSize: 22, fontWeight: 700 }}>VS</div>
              <Link href={`${base}/club/${next.away.id}`} className="row" style={{ gap: 12, justifyContent: "flex-end", textAlign: "right", minWidth: 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="cond up truncate" style={{ fontSize: 20, fontWeight: 700 }}>{next.away.name}</div>
                  <div className="faint small">Gast · Stärke {next.away.rating}</div>
                </div>
                <Crest colors={next.away.colors} name={next.away.name} size={48} />
              </Link>
            </div>
            {next.analysis && (
              <div className="card-soft" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "auto auto 1fr", gap: "6px 16px", alignItems: "center" }}>
                <span className="faint small up">Formation</span><b>{next.analysis.formation}</b><span />
                <span className="faint small up">Form</span><FormChips form={next.analysis.form} /><span />
                <span className="faint small up">Schlüsselspieler</span>
                <span style={{ gridColumn: "2 / -1" }} className="small">{next.analysis.keyPlayers.map((p: any) => `${p.name} (${p.rating})`).join(" · ")}</span>
              </div>
            )}
            <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
              <span className="dim small" style={{ marginRight: "auto" }}>
                {next.day !== null && <><b style={{ color: "var(--text)" }}>{fmtDate(dayIso(c.season, next.day), { long: true })}</b> · {next.day - c.day === 0 ? "heute" : next.day - c.day === 1 ? "morgen" : `in ${next.day - c.day} Tagen`}</>}
              </span>
              <Link className="btn" href={`${base}/team/tactic`}><Icon name="board" size={15} /> Taktik</Link>
              {next.today && <button className="btn btn-primary" onClick={advance} disabled={busy}><Icon name="whistle" size={15} /> Zum Spiel</button>}
            </div>
          </Panel>
        ) : (
          <Panel title="Nächstes Spiel" icon="calendar"><p className="dim">Aktuell ist kein Pflichtspiel angesetzt.</p></Panel>
        )}

        <Inbox careerId={id} today={{ season: c.season, day: c.day }} openId={openId} onSelect={select} initialUnread={d.unread}
          actions={(m: any) => {
            const offer = offerFor(m);
            return (
              <>
                {m.action?.type === "fixture" && <Link className="btn" href={`${base}/report/${m.action.fixtureId}`}>Spielbericht öffnen</Link>}
                {m.action?.type === "scouting" && <Link className="btn" href={`${base}/market/scouting`}>Zur Scouting-Zentrale</Link>}
                {m.action?.type === "academy" && <Link className="btn" href={`${base}/team/youth`}>Zur Jugendakademie</Link>}
                {m.action?.type === "club" && <Link className="btn" href={`${base}/verein`}>Zu Verein & Fans</Link>}
                {m.action?.type === "jobs" && <Link className="btn" href={`${base}/career/jobs`}>Zu den freien Stellen</Link>}
                {m.action?.type === "awards" && <Link className="btn" href={`${base}/competition/awards`}>Zu den Auszeichnungen</Link>}
                {m.action?.type === "tactic" && <Link className="btn" href={`${base}/team/tactic`}>Zur Taktik</Link>}
                {m.action?.type === "national" && <><Link className="btn" href={`${base}/national`}>Zum Nationalteam</Link><Link className="btn btn-ghost" href={`${base}/national/squad`}>Kader nominieren</Link></>}
                {m.action?.type === "transfers" && <Link className="btn btn-primary" href={`${base}/market`}>Zur Transfer-Zentrale</Link>}
                {m.action?.type === "negotiation" && <Link className="btn btn-primary" href={`${base}/market?neg=${m.action.negotiationId}`}>Zur Verhandlung</Link>}
                {m.action?.type === "player" && <Link className="btn" href={`${base}/player/${m.action.playerId}`}>Spielerprofil öffnen</Link>}
                {m.category === "medical" && m.action?.type !== "tactic" && <Link className="btn btn-ghost" href={`${base}/team/medical`}>Zur Medizin</Link>}
                {offer && (
                  <>
                    <button className="btn btn-primary" onClick={() => respond(offer.id, "accept")}>Angebot annehmen</button>
                    <button className="btn" onClick={() => respond(offer.id, "counter")}>Mehr fordern</button>
                    <button className="btn btn-ghost" onClick={() => respond(offer.id, "reject")}>Ablehnen</button>
                  </>
                )}
              </>
            );
          }} />

        {d.headlines?.length > 0 && (
          <Panel title="Schlagzeilen" icon="news" flush actions={<Link href={`${base}/media`} className="btn btn-ghost btn-sm">Alle Meldungen</Link>}>
            {d.headlines.map((h: any) => (
              <Link key={h.id} href={`${base}/media`} className="headline-row">
                <span className="news-kicker" style={{ minWidth: 92 }}>{h.kindLabel}</span>
                <span className="truncate" style={{ flex: 1, fontWeight: h.own ? 700 : 500 }}>{h.title}</span>
                <span className="faint small nowrap">{fmtDate(h.date, { year: false })}</span>
              </Link>
            ))}
          </Panel>
        )}
        </div>
        <div className="stack">
        {d.club && (
        <Panel title="Vorstand" icon="board" actions={<Link href={`${base}/board`} className="btn btn-ghost btn-sm">Anfragen</Link>}>
          <p style={{ fontWeight: 600, marginBottom: 10 }}>{board.objective}</p>
          <div className="stack-sm" style={{ marginBottom: 6 }}>
            <div className="between small"><span className="faint up">Vertrauen</span><b className="cond" style={{ fontSize: 16 }}>{board.confidence}%</b></div>
            <Progress value={board.confidence} tone={board.confidence < 35 ? "danger" : board.confidence < 55 ? "warn" : undefined} />
          </div>
          <div className="kv"><span className="k">Erwarteter Platz</span><span className="v">{board.expectedPosition}.</span></div>
          <div className="kv"><span className="k">Zielplatz</span><span className="v">{board.targetPosition}. oder besser</span></div>
          <div className="kv"><span className="k">Kontostand mindestens</span><span className="v">{money(board.financeTarget)}</span></div>
        </Panel>
        )}
          {d.table?.length > 0 && (
            <Panel title="Tabelle" icon="trophy" flush actions={<Link href={`${base}/competition`} className="btn btn-ghost btn-sm">Vollständig</Link>}>
              <table className="table">
                <thead><tr><th className="c">#</th><th>Verein</th><th className="c">Sp</th><th className="c">Diff</th><th className="c">Pkt</th></tr></thead>
                <tbody>
                  {d.table.map((r: any) => (
                    <tr key={r.clubId} className={r.clubId === c.clubId ? "highlight" : ""}>
                      <td className="c cond" style={{ fontWeight: 700 }}>{r.position}</td>
                      <td><Link href={`${base}/club/${r.clubId}`} className="row" style={{ gap: 8 }}><Crest colors={r.club.colors} name={r.club.name} size={16} /><span className="truncate name">{r.club.name}</span></Link></td>
                      <td className="c">{r.played}</td>
                      <td className="c">{r.goalsFor - r.goalsAgainst > 0 ? "+" : ""}{r.goalsFor - r.goalsAgainst}</td>
                      <td className="c cond" style={{ fontWeight: 700, fontSize: 15 }}>{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          {d.offers?.length > 0 && (
            <Panel title="Angebote für deine Spieler" icon="transfer" flush>
              <table className="table">
                <tbody>
                  {d.offers.map((o: any) => (
                    <tr key={o.id}>
                      <td><div className="name">{o.player_name}</div><div className="faint small">{o.message}</div></td>
                      <td className="r cond" style={{ fontWeight: 700, fontSize: 15 }}>{money(o.fee)}</td>
                      <td className="r nowrap">
                        <button className="btn btn-primary btn-sm" onClick={() => respond(o.id, "accept")} title="Annehmen"><Icon name="check" size={14} /></button>{" "}
                        <button className="btn btn-ghost btn-sm" onClick={() => respond(o.id, "reject")} title="Ablehnen"><Icon name="close" size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          <Panel title="Tagesziele" icon="target" actions={<span className="faint small">Serie: {d.loginStreak} {d.loginStreak === 1 ? "Tag" : "Tage"}</span>}>
            {d.missions.map((m: any) => (
              <div key={m.kind} className="row" style={{ padding: "7px 0", borderBottom: "1px solid var(--line)", opacity: m.done ? 0.55 : 1 }}>
                <span style={{ width: 16, height: 16, border: "1.5px solid var(--line-2)", borderRadius: 2, display: "grid", placeItems: "center", background: m.done ? "var(--pos)" : "transparent", color: "#fff", flex: "none" }}>
                  {m.done && <Icon name="check" size={12} stroke={3} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, textDecoration: m.done ? "line-through" : undefined }}>{m.name}</div>
                  <div className="faint small">{m.description}</div>
                </div>
                <span className="cond faint nowrap" style={{ fontWeight: 700 }}>+{m.points} MP</span>
              </div>
            ))}
          </Panel>

          {d.recent?.length > 0 && (
            <Panel title="Letzte Ergebnisse" icon="ball" flush>
              <table className="table">
                <tbody>
                  {d.recent.map((r: any) => {
                    const res = r.goalsFor > r.goalsAgainst ? "W" : r.goalsFor < r.goalsAgainst ? "L" : r.won === null ? "D" : r.won ? "W" : "L";
                    return (
                      <tr key={r.fixtureId} className="clickable" onClick={() => (window.location.href = `${base}/report/${r.fixtureId}`)}>
                        <td style={{ width: 28 }}><FormChips form={[res]} /></td>
                        <td className="faint small" style={{ width: 44 }}>{r.home ? "H" : "A"}{r.cup && <span className="badge" style={{ marginLeft: 4 }} title={r.continental ? "Kontinentalpokal" : "Pokal"}>{r.continental ? "K" : "P"}</span>}</td>
                        <td className="truncate name">{r.opponent}</td>
                        <td className="r cond" style={{ fontWeight: 700, fontSize: 15 }}>{r.goalsFor}–{r.goalsAgainst}{r.pens && <span className="faint small"> ({r.pens} i.E.)</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}

          {d.club && (
            <Panel title="Verein" icon="stadium">
              <div className="kv"><span className="k">Mannschaftsstärke</span><span className="v"><Rating value={d.club.rating} /></span></div>
              <div className="kv"><span className="k">Ruf</span><span className="v">{d.club.reputation} / 100</span></div>
              <div className="kv"><span className="k">Stadion</span><span className="v">{d.club.capacity.toLocaleString("de-CH")} Plätze</span></div>
              <div className="kv"><span className="k">Gegründet</span><span className="v">{d.club.founded}</span></div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
