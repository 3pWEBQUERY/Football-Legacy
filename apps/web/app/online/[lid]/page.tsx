"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { AccountTop } from "@/components/AccountTop";
import { StatRows } from "@/components/MatchStats";
import { Crest, Empty, ErrorBox, EventIcon, FormChips, Icon, Loading, Modal, Panel, useToast } from "@/components/ui";
import { confirmFrom, useConfirm } from "@/components/Dialog";

const STATUS_LABEL: Record<string, string> = { open: "Anmeldung offen", running: "Saison läuft", finished: "Saison beendet" };

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "gleich";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `in ${h} Std. ${m} Min.` : `in ${m} Min.`;
}

export default function OnlineLeaguePage() {
  const { lid } = useParams<{ lid: string }>();
  const router = useRouter();
  const toast = useToast();
  const ask = useConfirm();
  const { data, error, reload } = useApi<any>(`online/${lid}`);
  const overview = useApi<any>("online");
  const blocks = useApi<{ blocked: { id: string; name: string }[] }>("account/blocks");
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState<number | null>(null);
  const [report, setReport] = useState<any | null>(null);
  const [msg, setMsg] = useState("");
  const [bots, setBots] = useState(1);
  const [careerId, setCareerId] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  // Mitspieler sehen neue Ergebnisse und Chat ohne Neuladen
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") reload(); }, 15_000);
    return () => clearInterval(t);
  }, [reload]);
  useEffect(() => {
    if (data && round === null) setRound(Math.max(1, data.status === "running" ? data.round + 1 : data.round || 1));
  }, [data, round]);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [data?.posts?.length]);
  useEffect(() => {
    if (!careerId && overview.data?.careers.length) setCareerId(data?.me?.careerId ?? overview.data.careers[0].id);
  }, [overview.data, data, careerId]);

  if (error) return <div className="landing"><AccountTop /><div className="content"><ErrorBox message={error} /><Link href="/online" className="btn btn-ghost" style={{ marginTop: 12 }}>Zurück zu den Online-Ligen</Link></div></div>;
  if (!data) return <div className="landing"><AccountTop /><div className="content"><Loading /></div></div>;

  async function act(path: string, body: unknown = {}, confirmText?: string, after?: (r: any) => void) {
    if (confirmText && !(await ask(confirmFrom(confirmText)))) return;
    setBusy(true);
    try {
      const r = await api<any>(`online/${lid}/${path}`, { body });
      toast(r.message, "success");
      if (after) after(r);
      else {
        reload();
        // nach einem Spieltag dessen Ergebnisse zeigen, nach dem Saisonstart den ersten
        if (r.played || path === "play") setRound(data.round + 1);
        else if (path === "start") setRound(1);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    setBusy(true);
    try {
      const r = await api<any>("online/join", { body: { leagueId: lid, careerId } });
      toast(r.message, "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function moderate(p: any, kind: "report" | "block" | "delete") {
    const text = {
      report: { title: "Nachricht melden?", message: `Die Nachricht von ${p.author} wird gemeldet. Ab zwei Meldungen wird sie für alle ausgeblendet; der Gründer der Liga wird informiert.`, confirmLabel: "Melden" },
      block: { title: `${p.author} blockieren?`, message: "Du siehst seine Nachrichten in allen Ligen nicht mehr und bekommst dazu keine Mitteilungen. Das lässt sich jederzeit aufheben.", confirmLabel: "Blockieren" },
      delete: { title: "Nachricht löschen?", message: "Die Nachricht wird für alle entfernt.", confirmLabel: "Löschen", danger: true },
    }[kind];
    if (!(await ask(text))) return;
    await act(`posts/${p.id}/${kind}`, {}, undefined, () => { reload(); if (kind === "block") blocks.reload(); });
  }

  async function sendMsg(e: React.FormEvent) {
    e.preventDefault();
    if (!msg.trim()) return;
    await act("posts", { body: msg }, undefined, () => { setMsg(""); reload(); });
  }

  const openReport = async (fid: number) => {
    try { setReport(await api<any>(`online/${lid}/matches/${fid}`)); } catch (e) { toast((e as Error).message, "error"); }
  };

  const shown = data.schedule.find((r: any) => r.round === round);
  const free = data.maxMembers - data.members.length;
  const humans = data.members.filter((m: any) => !m.bot).length;

  return (
    <div className="landing">
      <AccountTop />
      <div className="content" style={{ maxWidth: 1200 }}>
        <div className="page-head">
          <div>
            <div className="faint small up"><Link href="/online">Online-Ligen</Link> / {data.public ? "öffentlich" : "privat"}</div>
            <h1>{data.name}</h1>
            <p>
              <span className={`badge ${data.status === "running" ? "badge-accent" : data.status === "open" ? "badge-blue" : ""}`}>{STATUS_LABEL[data.status]}</span>{" "}
              {data.status !== "open" ? `Saison ${data.season} · Spieltag ${data.round} von ${data.rounds}` : `${data.members.length}/${data.maxMembers} Teams`}
              {" · "}{data.rhythm === "daily" ? "täglicher Spieltag" : "Spieltag, wenn alle bereit sind"}
            </p>
          </div>
          {data.code && (
            <button className="invite-code" onClick={() => { navigator.clipboard?.writeText(data.code); toast("Einladungscode kopiert"); }} title="Code kopieren">
              <span className="faint small">Einladungscode</span>
              <b className="mono">{data.code}</b>
            </button>
          )}
        </div>

        {/* Aktionsleiste je nach Phase */}
        {!data.me ? (
          <div className="card online-bar">
            <span style={{ flex: 1 }}>Diese Liga sucht noch Mitspieler. Tritt mit einem Verein aus deinen Karrieren an:</span>
            {overview.data?.careers.length ? (
              <>
                <select className="input" value={careerId} onChange={(e) => setCareerId(e.target.value)} aria-label="Karriere wählen">
                  {overview.data.careers.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button className="btn btn-primary" disabled={busy || free <= 0} onClick={join}>{free <= 0 ? "Liga voll" : "Beitreten"}</button>
              </>
            ) : <Link className="btn btn-primary" href="/careers/new">Erst eine Karriere starten</Link>}
          </div>
        ) : data.status === "open" ? (
          <div className="card online-bar">
            <span style={{ flex: 1 }}>
              {data.isOwner
                ? `Lade Freunde mit dem Code ${data.code} ein${free > 0 ? ` oder fülle die ${free} freien Plätze mit CPU-Teams` : ""}. Ab 2 Teams kannst du die Saison starten.`
                : "Warte, bis der Gründer die Saison startet. Bis dahin kannst du dein Team wechseln."}
            </span>
            {data.isOwner && free > 0 && (
              <span className="row" style={{ gap: 6 }}>
                <input className="input" type="number" min={1} max={free} value={bots} onChange={(e) => setBots(Number(e.target.value))} style={{ width: 64 }} aria-label="Anzahl CPU-Teams" />
                <button className="btn btn-ghost" disabled={busy} onClick={() => act("bots", { count: bots })}><Icon name="plus" size={14} /> CPU-Teams</button>
              </span>
            )}
            {data.isOwner && <button className="btn btn-primary" disabled={busy || data.members.length < 2} onClick={() => act("start")}><Icon name="play" size={14} /> Saison starten</button>}
            <button className="btn btn-ghost" disabled={busy} onClick={() => act("leave", {}, data.isOwner && humans === 1 ? "Du bist der einzige Manager – die Liga wird aufgelöst. Fortfahren?" : "Liga wirklich verlassen?", () => router.push("/online"))}>Verlassen</button>
          </div>
        ) : data.status === "running" ? (
          <div className="card online-bar">
            {data.myNext && (
              data.myNext.bye ? <span className="dim">Am {data.nextRound}. Spieltag hast du spielfrei.</span> : (
                <span className="row next-online" style={{ gap: 10 }}>
                  <span className="faint small up">{data.nextRound}. Spieltag</span>
                  <Crest colors={data.myNext.home.colors} name={data.myNext.home.name} size={24} /><b className={data.myNext.home.mine ? "" : "dim"}>{data.myNext.home.name}</b>
                  <span className="faint">–</span>
                  <b className={data.myNext.away.mine ? "" : "dim"}>{data.myNext.away.name}</b><Crest colors={data.myNext.away.colors} name={data.myNext.away.name} size={24} />
                </span>
              )
            )}
            <span className="faint small" style={{ flex: 1 }}>
              {data.waitingFor.length ? `Warten auf: ${data.waitingFor.join(", ")}` : "Alle bereit"}
              {data.rhythm === "daily" && data.nextAt ? ` · automatisch ${timeLeft(data.nextAt)}` : ""}
            </span>
            {data.me.careerId && <Link className="btn btn-ghost" href={`/c/${data.me.careerId}/team/tactic`}><Icon name="team" size={14} /> Taktik</Link>}
            <button className={`btn ${data.me.ready ? "btn-ghost" : "btn-primary"}`} disabled={busy} onClick={() => act("ready", { ready: !data.me.ready })}>
              <Icon name="check" size={14} /> {data.me.ready ? "Bereit zurücknehmen" : "Bereit"}
            </button>
            {data.isOwner && <button className="btn btn-ghost" disabled={busy} onClick={() => act("play", {}, data.waitingFor.length ? `Noch nicht alle bereit (${data.waitingFor.join(", ")}). Spieltag trotzdem spielen?` : undefined)}><Icon name="fast" size={14} /> Jetzt spielen</button>}
          </div>
        ) : (
          <div className="card online-bar">
            <span style={{ flex: 1 }}><Icon name="trophy" size={16} /> Saison {data.season} beendet – Meister: <b>{data.table[0]?.team?.name}</b> ({data.table[0]?.team?.manager}).</span>
            {data.isOwner && <button className="btn btn-primary" disabled={busy} onClick={() => act("start")}><Icon name="play" size={14} /> Saison {data.season + 1} starten</button>}
          </div>
        )}

        <div className="grid grid-main" style={{ alignItems: "start" }}>
          <div className="stack">
            <section className="card card-flush">
              <div className="card-head"><h3>Tabelle</h3><span className="faint small">Saison {data.season}</span></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th className="c">#</th><th>Verein</th><th className="hide-sm">Manager</th><th className="c">Sp</th><th className="c">S</th><th className="c">U</th><th className="c">N</th><th className="c">Tore</th><th className="c">Pkt</th><th className="hide-sm">Form</th></tr></thead>
                  <tbody>
                    {data.table.map((r: any) => (
                      <tr key={r.memberId} className={r.team?.mine ? "highlight" : ""}>
                        <td className="c num">{r.pos}</td>
                        <td><span className="row" style={{ gap: 8 }}><Crest colors={r.team.colors} name={r.team.name} size={18} /><b className="truncate">{r.team.name}</b></span></td>
                        <td className="hide-sm dim truncate">{r.team.manager}</td>
                        <td className="c num">{r.p}</td><td className="c num">{r.w}</td><td className="c num">{r.d}</td><td className="c num">{r.l}</td>
                        <td className="c num">{r.gf}:{r.ga}</td>
                        <td className="c num"><b>{r.pts}</b></td>
                        <td className="hide-sm"><FormChips form={r.form} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <Panel title="Spielplan" icon="calendar" flush actions={data.schedule.length > 0 && round !== null ? (
              <span className="row" style={{ gap: 4 }}>
                <button className="btn btn-ghost btn-sm" disabled={round <= 1} onClick={() => setRound(round - 1)} aria-label="Vorheriger Spieltag"><Icon name="back" size={14} /></button>
                <span className="cond small" style={{ minWidth: 86, textAlign: "center" }}>{round}. Spieltag</span>
                <button className="btn btn-ghost btn-sm" disabled={round >= data.rounds} onClick={() => setRound(round + 1)} aria-label="Nächster Spieltag"><Icon name="next" size={14} /></button>
              </span>
            ) : undefined}>
              {!shown ? <Empty>Der Spielplan entsteht beim Saisonstart.</Empty> : shown.matches.map((m: any) => (
                <div key={m.id} className={`online-match ${m.hasReport ? "clickable" : ""} ${m.home.mine || m.away.mine ? "mine" : ""}`} role={m.hasReport ? "button" : undefined} tabIndex={m.hasReport ? 0 : undefined}
                  onClick={() => m.hasReport && openReport(m.id)} onKeyDown={(e) => e.key === "Enter" && m.hasReport && openReport(m.id)}>
                  <span className="truncate r" style={{ flex: 1 }}>{m.home.name}</span>
                  <Crest colors={m.home.colors} name={m.home.name} size={20} />
                  <span className="nat-score">{m.played ? `${m.homeGoals}:${m.awayGoals}` : "–:–"}</span>
                  <Crest colors={m.away.colors} name={m.away.name} size={20} />
                  <span className="truncate" style={{ flex: 1 }}>{m.away.name}</span>
                </div>
              ))}
            </Panel>
          </div>

          <div className="stack">
            <Panel title={`Teilnehmer (${data.members.length}/${data.maxMembers})`} icon="users" flush>
              {data.members.map((m: any) => (
                <div key={m.id} className="online-member">
                  <Crest colors={m.team.colors} name={m.team.name} size={28} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b className="truncate" style={{ display: "block" }}>{m.team.name}</b>
                    <span className="dim small">{m.manager}{m.owner ? " · Gründer" : ""}{m.mine ? " · Du" : ""}{m.orphan ? " · Karriere gelöscht" : ""}</span>
                  </span>
                  <span className="rating" title="Stärke der ersten Elf">{m.team.rating}</span>
                  {data.status === "running" && !m.bot && <span className={m.ready ? "ready-dot on" : "ready-dot"} title={m.ready ? "bereit" : "noch nicht bereit"} />}
                  {data.isOwner && data.status === "open" && !m.mine && (
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("kick", { memberId: m.id }, `${m.team.name} aus der Liga entfernen?`)} aria-label="Entfernen"><Icon name="close" size={14} /></button>
                  )}
                </div>
              ))}
              {data.me && data.status !== "running" && (overview.data?.careers.length ?? 0) > 1 && (
                <div className="row" style={{ gap: 6, padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
                  <select className="input" style={{ flex: 1, minWidth: 0 }} value={careerId} onChange={(e) => setCareerId(e.target.value)} aria-label="Anderes Team wählen">
                    {overview.data.careers.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <button className="btn btn-ghost btn-sm" disabled={busy || careerId === data.me.careerId} onClick={() => act("team", { careerId })}>Team wechseln</button>
                </div>
              )}
            </Panel>

            {data.me && (
              <Panel title="Liga-Chat" icon="mail" flush>
                <div className="online-chat" ref={chatRef}>
                  {data.posts.length === 0 ? <Empty>Noch keine Nachrichten.</Empty> : data.posts.map((p: any) => (
                    <div key={p.id} className={`chat-msg ${p.system ? "system" : ""} ${p.mine ? "mine" : ""}`}>
                      <span className="chat-head">
                        {!p.system ? <span className="chat-author">{p.author}</span> : <span />}
                        {(!p.system || p.canDelete) && (
                          <span className="chat-actions">
                            {!p.mine && !p.system && <button type="button" title="Nachricht melden" aria-label={`Nachricht von ${p.author} melden`} onClick={() => moderate(p, "report")}>Melden</button>}
                            {!p.mine && !p.system && <button type="button" title="Verfasser blockieren" aria-label={`${p.author} blockieren`} onClick={() => moderate(p, "block")}>Blockieren</button>}
                            {p.canDelete && <button type="button" title="Nachricht löschen" aria-label="Nachricht löschen" onClick={() => moderate(p, "delete")}>Löschen</button>}
                          </span>
                        )}
                      </span>
                      <span translate={p.system ? undefined : "no"}>{p.body}</span>
                      <span className="chat-time">{new Date(p.at).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  ))}
                </div>
                {!!blocks.data?.blocked.length && (
                  <div className="chat-blocked faint small">
                    Blockiert: {blocks.data.blocked.map((b: any) => (
                      <button key={b.id} type="button" className="btn btn-ghost btn-sm" onClick={async () => {
                        try { toast((await api<any>(`account/blocks/${b.id}/remove`, { body: {} })).message, "success"); blocks.reload(); reload(); } catch (e) { toast((e as Error).message, "error"); }
                      }}>{b.name} ✕</button>
                    ))}
                  </div>
                )}
                <form className="row chat-form" onSubmit={sendMsg}>
                  <input className="input" style={{ flex: 1, minWidth: 0 }} maxLength={400} placeholder="Nachricht an die Liga …" value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Nachricht" />
                  <button className="btn btn-primary" disabled={busy || !msg.trim()}>Senden</button>
                </form>
              </Panel>
            )}
          </div>
        </div>
      </div>

      <Modal open={!!report} onClose={() => setReport(null)} wide>
        {report && <Report r={report} />}
      </Modal>
    </div>
  );
}

function Report({ r }: { r: any }) {
  const d = r.report;
  const lines = (side: 0 | 1) => (d?.players ?? []).filter((p: any) => p.side === side).sort((a: any, b: any) => Number(b.started) - Number(a.started) || b.minutes - a.minutes);
  return (
    <div className="stack">
      <div className="faint small up">Saison {r.season} · {r.round}. Spieltag</div>
      <div className="row" style={{ justifyContent: "center", gap: 18, flexWrap: "wrap" }}>
        <span className="row" style={{ gap: 8 }}><span className="r"><b style={{ fontSize: 20 }}>{r.home.name}</b><span className="faint small" style={{ display: "block" }}>{r.home.manager}</span></span><Crest colors={r.home.colors} name={r.home.name} size={34} /></span>
        <span className="cond" style={{ fontSize: 34, fontWeight: 700 }}>{r.homeGoals}:{r.awayGoals}</span>
        <span className="row" style={{ gap: 8 }}><Crest colors={r.away.colors} name={r.away.name} size={34} /><span><b style={{ fontSize: 20 }}>{r.away.name}</b><span className="faint small" style={{ display: "block" }}>{r.away.manager}</span></span></span>
      </div>
      {d ? (
        <>
          <div className="stack-sm">
            {d.events.map((e: any, i: number) => (
              <div key={i} className="row small" style={{ gap: 8, justifyContent: e.side === "away" ? "flex-end" : "flex-start", textAlign: e.side === "away" ? "right" : "left" }}>
                <span className="cond faint" style={{ width: 34 }}>{e.minute}&apos;</span><EventIcon type={e.type} /><span>{e.text}</span>
              </div>
            ))}
          </div>
          <StatRows stats={d.stats} names={[r.home.name, r.away.name]} mine={r.home.mine ? 0 : r.away.mine ? 1 : undefined} />
          <div className="grid grid-2" style={{ gap: 16 }}>
            {[0, 1].map((side) => (
              <table key={side} className="table">
                <thead><tr><th>{side === 0 ? r.home.name : r.away.name}</th><th className="c">Min</th><th className="c">Note</th></tr></thead>
                <tbody>
                  {lines(side as 0 | 1).map((p: any) => (
                    <tr key={p.playerId}><td className="truncate">{p.name}{p.goals ? <span className="faint small"> · {p.goals} T</span> : null}{p.playerId === d.motm ? <span className="badge badge-gold" style={{ marginLeft: 6 }}>Bester Spieler</span> : null}</td><td className="c">{p.minutes}</td><td className="c cond" style={{ fontWeight: 700 }}>{p.rating.toFixed(1)}</td></tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </>
      ) : <p className="dim">Dieses Spiel wurde am grünen Tisch gewertet (kein spielfähiger Kader).</p>}
    </div>
  );
}
