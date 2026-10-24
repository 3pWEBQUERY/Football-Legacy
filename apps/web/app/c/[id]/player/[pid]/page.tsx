"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { ATTR_GROUPS, POS_LABEL, attrColor, dayIso, fmtDate, money } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Radar } from "@/components/Radar";
import { Condition, Crest, ErrorBox, Icon, Loading, Modal, Nat, Panel, Pos, moraleLabel, useNotes, useToast } from "@/components/ui";
import { PositionMap } from "@/components/PositionMap";

const POS_LONG: Record<string, string> = { GK: "Torwart", DR: "Rechter Verteidiger", DC: "Innenverteidiger", DL: "Linker Verteidiger", DM: "Defensives Mittelfeld", MR: "Rechtes Mittelfeld", MC: "Zentrales Mittelfeld", ML: "Linkes Mittelfeld", AMR: "Rechtsaussen", AMC: "Offensives Mittelfeld", AML: "Linksaussen", ST: "Stürmer" };

export default function PlayerPage() {
  const { id } = useGame();
  const { pid } = useParams<{ pid: string }>();
  const router = useRouter();
  const toast = useToast();
  const showNotes = useNotes();
  const { data, error, reload } = useApi<any>(`careers/${id}/players/${pid}`);
  const [offer, setOffer] = useState<{ fee: number; wage: number; years: number } | null>(null);
  const [renew, setRenew] = useState<{ wage: number; years: number; demand: number } | null>(null);
  const [msg, setMsg] = useState<any | null>(null);
  const [loan, setLoan] = useState<{ share: number; msg: any | null } | null>(null);
  const [talk, setTalk] = useState<{ result: any | null } | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const p = data.player;
  const exact = p.knowledge === "exact";
  const val = (k: string) => (exact ? p.attrs[k] : (p.attrRanges[k][0] + p.attrRanges[k][1]) / 2);

  async function action(a: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${id}/players/${pid}`, { body: { action: a, ...extra } });
      showNotes(r.notes);
      return r;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function sendOffer() {
    if (!offer) return;
    setBusy(true);
    try {
      const r = await api<any>(`careers/${id}/offers`, { body: { playerId: p.id, ...offer } });
      setMsg(r);
      if (r.status === "completed") {
        showNotes(r.notes);
        toast(r.message, "success");
        setOffer(null);
        reload();
        refreshAll();
      }
      if (r.status === "countered") setOffer({ ...offer, fee: r.counterFee ?? offer.fee, wage: r.counterWage ?? offer.wage });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function openRenew() {
    const d = await action("demand");
    if (d) setRenew({ wage: d.wage, years: d.years, demand: d.wage });
  }

  async function sendRenew() {
    if (!renew) return;
    const r = await action("renew", { wage: renew.wage, years: renew.years });
    if (!r) return;
    if (r.status === "completed") {
      toast(r.message, "success");
      setRenew(null);
      reload();
    } else {
      toast(r.message, "info");
      if (r.counterWage) setRenew({ ...renew, wage: r.counterWage });
    }
  }

  async function sendLoan() {
    if (!loan) return;
    const r = await action("loan_in", { wageShare: loan.share / 100 });
    if (!r) return;
    if (r.status === "completed") {
      toast(r.message, "success");
      setLoan(null);
      reload();
      refreshAll();
    } else {
      setLoan({ share: r.minShare ? Math.round(r.minShare * 100) : loan.share, msg: r });
    }
  }

  async function sendTalk(topic: string) {
    const r = await action("talk", { topic });
    if (r) {
      setTalk({ result: r });
      reload();
    }
  }

  async function lendOut() {
    if (!confirm(`${p.name} bis Saisonende verleihen?`)) return;
    const r = await action("loan_out");
    if (!r) return;
    toast(r.message, r.status === "completed" ? "success" : "info");
    if (r.status === "completed") { reload(); refreshAll(); }
  }

  const season = data.career.season;
  const isGk = p.position === "GK";
  const startOffer = () => {
    setMsg(null);
    setOffer({ fee: p.clubId === null ? 0 : data.askingPrice ?? p.value, wage: Math.max(500, Math.round(((p.contract?.wage ?? 1000) * 1.1) / 100) * 100), years: 3 });
  };

  return (
    <>
      <div className="row"><button className="btn btn-ghost btn-sm" onClick={() => router.back()}><Icon name="back" size={16} /> Zurück</button></div>
      <section className="card card-flush">
        <div style={{ display: "flex", flexWrap: "wrap", boxShadow: `inset 6px 0 0 ${data.club?.colors.primary ?? "var(--line-2)"}` }}>
          <div style={{ padding: "16px 20px 14px 24px", flex: "1 1 360px", minWidth: 0 }}>
            <div className="faint small up" style={{ fontWeight: 600 }}>{POS_LONG[p.position]} · {p.archetype}</div>
            <h1 style={{ fontSize: 34, marginTop: 2 }}>{p.name}</h1>
            <div className="row-wrap dim" style={{ marginTop: 6 }}>
              <Pos p={p.position} />
              {p.altPositions.map((x: string) => <span key={x} className="badge">{POS_LABEL[x]}</span>)}
              <Nat code={p.nationality} />
              <span>{p.age} Jahre</span>
              <span className="faint">·</span>
              <span>Fuss {p.foot === "L" ? "links" : p.foot === "R" ? "rechts" : "beidfüssig"}</span>
              {p.wonderkid && <span className="badge badge-gold">Ausnahmetalent</span>}
              {p.injuryWeeks > 0 && <span className="badge badge-danger">Verletzt · {p.injuryWeeks} W</span>}
              {p.away && data.career.day <= p.away.until && <span className="badge badge-blue">Bei der Nationalmannschaft</span>}
              {p.caps > 0 && <span className="faint">{p.caps} Länderspiele{p.intlGoals ? ` · ${p.intlGoals} Tore` : ""}</span>}
              {p.promise && <span className="badge badge-warn" title="Versprochene Einsatzzeit">Versprechen · {p.promise.starts}/{p.promise.needed} Startelf bis {fmtDate(dayIso(data.career.season, p.promise.until), { year: false })}</span>}
              {p.loan && <span className="badge badge-accent">{data.loanedOutByUser ? "Von dir verliehen" : `Leihe von ${data.loanParent ?? "Stammverein"}`} · bis Saisonende</span>}
            </div>
            <div style={{ marginTop: 8 }}>
              {data.club ? (
                <Link href={`/c/${id}/club/${data.club.id}`} className="row small" style={{ gap: 8 }}><Crest colors={data.club.colors} name={data.club.name} size={18} /> <b>{data.club.name}</b> <span className="faint">{data.league?.name}</span></Link>
              ) : <span className="badge badge-blue">Vereinslos</span>}
            </div>
          </div>
          <div style={{ display: "flex", borderLeft: "1px solid var(--line)" }}>
            {[
              ["Stärke", p.rating ?? `${p.ratingRange[0]}–${p.ratingRange[1]}`],
              ["Potenzial", exact ? p.potential : data.report && !data.report.pending ? `${data.report.potentialMin}–${data.report.potentialMax}` : "?"],
              ["Marktwert", money(p.value)],
            ].map(([k, v]) => (
              <div key={k as string} style={{ padding: "16px 20px", borderRight: "1px solid var(--line)", minWidth: 110 }} className="stat">
                <span className="label">{k}</span><span className="value">{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="row-wrap" style={{ padding: "10px 16px", borderTop: "1px solid var(--line)", background: "var(--panel-2)" }}>
          {data.own && p.loan ? (
            <span className="dim small">Leihspieler von <b>{data.loanParent}</b> – kehrt zum Saisonende zurück. Du zahlst {Math.round(p.loan.wageShare * 100)} % des Gehalts ({money((p.contract?.wage ?? 0) * p.loan.wageShare)} pro Woche).</span>
          ) : data.loanedOutByUser ? (
            <span className="dim small">An <b>{data.club?.name}</b> verliehen – kehrt zum Saisonende zurück. {data.club?.name} zahlt {Math.round(p.loan.wageShare * 100)} % des Gehalts.</span>
          ) : data.own ? (
            <>
              <button className="btn" disabled={busy} onClick={() => setTalk({ result: null })}><Icon name="mail" size={15} /> Gespräch</button>
              <button className="btn" disabled={busy} onClick={openRenew}><Icon name="contract" size={15} /> Vertrag verlängern</button>
              <button className="btn" disabled={busy} onClick={async () => { const r = await action("list"); if (r) { toast(r.listed ? "Auf die Transferliste gesetzt" : "Von der Transferliste genommen"); reload(); } }}>
                <Icon name="transfer" size={15} /> {p.listed ? "Von Transferliste nehmen" : "Auf Transferliste"}
              </button>
              <button className="btn" disabled={busy || !data.window.open} onClick={lendOut} title={!data.window.open ? "Transferfenster geschlossen" : "Bis Saisonende an einen passenden Verein verleihen"}>Verleihen</button>
              <button className="btn btn-danger ml-auto" disabled={busy} onClick={async () => {
                if (!confirm(`Vertrag mit ${p.name} auflösen? Es wird eine Abfindung fällig.`)) return;
                const r = await action("release");
                if (r) { toast(`Vertrag aufgelöst. Abfindung: ${money(r.compensation)}`); router.push(`/c/${id}/team`); refreshAll(); }
              }}>Vertrag auflösen</button>
            </>
          ) : (
            <>
              <button className="btn" disabled={busy} onClick={async () => { const r = await action("shortlist"); if (r) { toast(r.shortlisted ? "Zur Beobachtungsliste hinzugefügt" : "Von der Beobachtungsliste entfernt"); reload(); } }}>
                <Icon name="eye" size={15} /> {data.shortlisted ? "Beobachtet" : "Beobachten"}
              </button>
              <button className="btn" disabled={busy || data.report?.pending} onClick={async () => { const r = await action("scout"); if (r) { toast("Der Scout beobachtet den Spieler. Der Bericht kommt in den Posteingang.", "success"); reload(); } }}><Icon name="search" size={15} /> {data.report?.pending ? "Scout unterwegs" : "Scouten"}</button>
              <button className="btn btn-primary" disabled={busy || (!data.window.open && p.clubId !== null)} onClick={startOffer} title={!data.window.open && p.clubId !== null ? "Transferfenster geschlossen" : ""}>
                {p.clubId === null ? "Vertrag anbieten" : "Angebot abgeben"}
              </button>
              {p.clubId !== null && !p.loan && (
                <button className="btn" disabled={busy || !data.window.open} onClick={() => setLoan({ share: 75, msg: null })} title={!data.window.open ? "Transferfenster geschlossen" : "Bis Saisonende ausleihen"}>Ausleihen</button>
              )}
              {data.askingPrice && <span className="faint small ml-auto">Ablöseforderung ca. <b style={{ color: "var(--text)" }}>{money(data.askingPrice)}</b></span>}
            </>
          )}
        </div>
      </section>

      <div className="grid grid-side" style={{ alignItems: "start" }}>
        <Panel title="Attribute" icon="chart" actions={!exact && <span className="badge badge-warn">{p.knowledge === "good" ? "Geschätzt (gleiche Liga)" : "Grob geschätzt"} – scouten für exakte Werte</span>}>
          <div className="grid grid-3" style={{ gap: 18 }}>
            {ATTR_GROUPS.map((g) => (
              <div key={g.title}>
                <div className="attr-group-title">{g.title}</div>
                {g.keys.map(([k, label]) => {
                  const v = val(k);
                  return (
                    <div key={k} className="attr">
                      <span className="dim">{label}</span>
                      <span className="attr-v" style={{ color: attrColor(v) }}>{exact ? p.attrs[k] : `${p.attrRanges[k][0]}-${p.attrRanges[k][1]}`}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {data.report && !data.report.pending && <div className="card-soft small" style={{ marginTop: 12 }}><span className="faint up">Scoutbericht</span> · {data.report.verdict}</div>}
          {data.report?.pending && <div className="card-soft small" style={{ marginTop: 12 }}><span className="faint up">Beobachtung läuft</span> · Der Bericht deines Scouts kommt am {fmtDate(data.report.dueDate, { long: true })}.</div>}
        </Panel>
        <div className="stack">
          <Panel title="Positionen & Profil" icon="board">
            <div style={{ display: "grid", gridTemplateColumns: "0.8fr 1.2fr", gap: 10, alignItems: "center" }}>
              <PositionMap natural={p.position} alt={p.altPositions} />
              <Radar value={val} gk={isGk} size={260} />
            </div>
          </Panel>
          {data.own && !p.loan && <IndividualTraining player={p} careerId={id} onSaved={reload} />}
          <Panel title="Vertrag" icon="contract">
            <div className="kv"><span className="k">Gehalt</span><span className="v">{p.contract ? `${money(p.contract.wage)} / Woche` : "–"}</span></div>
            <div className="kv"><span className="k">Vertrag bis</span><span className="v">{p.contract?.untilSeason ?? "–"}</span></div>
            <div className="kv"><span className="k">Ausstiegsklausel</span><span className="v">{p.contract?.releaseClause ? money(p.contract.releaseClause) : "–"}</span></div>
            <div className="kv"><span className="k">Torprämie</span><span className="v">{p.contract?.goalBonus ? money(p.contract.goalBonus) : "–"}</span></div>
          </Panel>
          <Panel title="Zustand" icon="medical">
            <div className="kv"><span className="k">Kondition</span><span className="v"><Condition value={p.fitness} /></span></div>
            <div className="kv"><span className="k">Moral</span><span className="v" style={{ color: moraleLabel(p.morale).color }}>{moraleLabel(p.morale).text}</span></div>
            <div className="kv"><span className="k">Form</span><span className="v">{p.form.toFixed(1)} / 10</span></div>
          </Panel>
          <Panel title={`Saison ${season}`} icon="calendar" flush>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: 12, gap: 8 }}>
              <div className="stat"><span className="label">Spiele</span><span className="value">{p.stats.apps}</span></div>
              <div className="stat"><span className="label">Tore</span><span className="value">{p.stats.goals}</span></div>
              <div className="stat"><span className="label">Vorl.</span><span className="value">{p.stats.assists}</span></div>
              <div className="stat"><span className="label">Ø Note</span><span className="value">{p.stats.apps ? (p.stats.ratingSum / p.stats.apps).toFixed(2) : "–"}</span></div>
            </div>
            {p.history.length > 0 && (
              <table className="table">
                <thead><tr><th>Saison</th><th>Verein</th><th className="c">Sp</th><th className="c">T</th><th className="c">Ø</th></tr></thead>
                <tbody>{[...p.history].reverse().map((h: any) => <tr key={h.season}><td>{h.season}</td><td className="truncate">{h.clubName}</td><td className="c">{h.apps}</td><td className="c">{h.goals}</td><td className="c">{h.avgRating}</td></tr>)}</tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>

      <Modal open={!!offer} onClose={() => setOffer(null)}>
        {offer && (
          <div className="stack">
            <h2>{p.clubId === null ? "Vertragsangebot" : "Transferangebot"}: {p.name}</h2>
            {p.clubId !== null && (
              <div className="field">
                <label>Ablöse (€) – Forderung ca. {money(data.askingPrice)}</label>
                <input className="input" type="number" min={0} step={50000} value={offer.fee} onChange={(e) => setOffer({ ...offer, fee: Number(e.target.value) })} />
              </div>
            )}
            <div className="field">
              <label>Gehalt pro Woche (€) – aktuell {money(p.contract?.wage)}</label>
              <input className="input" type="number" min={0} step={100} value={offer.wage} onChange={(e) => setOffer({ ...offer, wage: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Vertragslaufzeit: {offer.years} {offer.years === 1 ? "Jahr" : "Jahre"}</label>
              <input type="range" min={1} max={5} value={offer.years} onChange={(e) => setOffer({ ...offer, years: Number(e.target.value) })} />
            </div>
            <div className="card-soft small dim">Dein Transferbudget: <b>{money(data.budget)}</b> · Gehalt über die Laufzeit: {money(offer.wage * 52 * offer.years)}</div>
            {msg && msg.status !== "completed" && (
              <div className={`badge ${msg.status === "rejected" ? "badge-danger" : "badge-warn"}`} style={{ whiteSpace: "normal", padding: "8px 10px" }}>{msg.message}</div>
            )}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setOffer(null)}>Abbrechen</button>
              <button className="btn btn-primary" disabled={busy} onClick={sendOffer}>{msg?.status === "countered" ? "Gegenangebot annehmen" : "Angebot senden"}</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!talk} onClose={() => setTalk(null)}>
        {talk && (
          <div className="stack">
            <h2>Gespräch mit {p.name}</h2>
            <div className="row-wrap small dim">
              <span>Moral: <b style={{ color: moraleLabel(p.morale).color }}>{moraleLabel(p.morale).text}</b></span>
              <span>Form: <b>{p.form.toFixed(1)}</b></span>
            </div>
            {talk.result ? (
              <div className="card-soft stack-sm" style={{ borderLeft: `3px solid ${talk.result.tone === "positive" ? "var(--pos)" : talk.result.tone === "negative" ? "var(--neg)" : "var(--line-2)"}` }}>
                <span>„{talk.result.reaction}“</span>
                <span className="faint small">Moral {talk.result.moraleChange >= 0 ? "+" : ""}{talk.result.moraleChange}</span>
              </div>
            ) : (
              <div className="stack-sm">
                {[
                  ["praise", "Loben", "Für gute Leistungen – wirkt nur, wenn die Form stimmt."],
                  ["criticize", "Kritisieren", "Fordert eine Reaktion. Riskant bei Spielern mit wenig Nervenstärke."],
                  ["encourage", "Zuspruch geben", "Hilft vor allem Spielern mit schlechter Moral."],
                  ["promise", "Einsatzzeit versprechen", "Zwei Startelfeinsätze in den nächsten vier Wochen. Gebrochene Versprechen schaden stark."],
                ].map(([topic, label, desc]) => (
                  <button key={topic} className="card-soft row" style={{ textAlign: "left", cursor: "pointer", gap: 12, border: "1px solid var(--line-2)" }} disabled={busy} onClick={() => sendTalk(topic)}>
                    <span style={{ flex: 1 }}><b>{label}</b><span className="faint small" style={{ display: "block" }}>{desc}</span></span>
                    <Icon name="next" size={14} />
                  </button>
                ))}
              </div>
            )}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setTalk(null)}>Schliessen</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!loan} onClose={() => setLoan(null)}>
        {loan && (
          <div className="stack">
            <h2>Leihanfrage: {p.name}</h2>
            <p className="dim">Leihe bis zum Saisonende ohne Ablöse. {data.club?.name} gibt in der Regel nur Ergänzungsspieler und junge Spieler ab.</p>
            <div className="field">
              <label>Dein Gehaltsanteil: {loan.share} % ({money((p.contract?.wage ?? 0) * loan.share / 100)} pro Woche)</label>
              <input type="range" min={0} max={100} step={5} value={loan.share} onChange={(e) => setLoan({ ...loan, share: Number(e.target.value) })} />
            </div>
            {loan.msg && <div className={`badge ${loan.msg.status === "rejected" ? "badge-danger" : "badge-warn"}`} style={{ whiteSpace: "normal", padding: "8px 10px" }}>{loan.msg.message}</div>}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setLoan(null)}>Abbrechen</button>
              <button className="btn btn-primary" disabled={busy || loan.msg?.status === "rejected"} onClick={sendLoan}>Anfrage senden</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!renew} onClose={() => setRenew(null)}>
        {renew && (
          <div className="stack">
            <h2>Vertragsverlängerung: {p.name}</h2>
            <p className="dim">Forderung des Spielers: <b>{money(renew.demand)}</b> pro Woche. Aktuell: {money(p.contract?.wage)}.</p>
            <div className="field">
              <label>Gehalt pro Woche (€)</label>
              <input className="input" type="number" step={100} value={renew.wage} onChange={(e) => setRenew({ ...renew, wage: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Verlängern um {renew.years} {renew.years === 1 ? "Jahr" : "Jahre"} (bis {season + renew.years})</label>
              <input type="range" min={1} max={5} value={renew.years} onChange={(e) => setRenew({ ...renew, years: Number(e.target.value) })} />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setRenew(null)}>Abbrechen</button>
              <button className="btn btn-primary" disabled={busy} onClick={sendRenew}>Angebot machen</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

const FOCUS_OPTIONS: [string, string][] = [["", "Mannschaftsplan"], ["attack", "Angriff"], ["defense", "Abwehr"], ["physical", "Athletik"], ["technical", "Technik"], ["mental", "Mental"], ["recovery", "Regeneration"]];
const ALL_POS = ["GK", "DR", "DC", "DL", "DM", "MR", "MC", "ML", "AMR", "AMC", "AML", "ST"];

/** Individueller Trainingsschwerpunkt und Umschulung auf eine neue Position. */
function IndividualTraining({ player: p, careerId, onSaved }: { player: any; careerId: string; onSaved: () => void }) {
  const toast = useToast();
  const [focus, setFocus] = useState<string>(p.individual?.focus ?? "");
  const [position, setPosition] = useState<string>(p.individual?.position ?? "");
  const [busy, setBusy] = useState(false);
  const options = ALL_POS.filter((x) => x !== p.position && !p.altPositions.includes(x) && (x === "GK") === (p.position === "GK"));
  const changed = focus !== (p.individual?.focus ?? "") || position !== (p.individual?.position ?? "");
  async function save() {
    setBusy(true);
    try {
      await api(`careers/${careerId}/players/${p.id}`, { body: { action: "individual", focus: focus || null, position: position || null } });
      toast("Individuelles Training gespeichert.", "success");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Individuelles Training" icon="team">
      <div className="field">
        <label>Schwerpunkt</label>
        <select className="select" value={focus} onChange={(e) => setFocus(e.target.value)}>
          {FOCUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label>Neue Position lernen</label>
        <select className="select" value={position} onChange={(e) => setPosition(e.target.value)}>
          <option value="">Keine Umschulung</option>
          {options.map((x) => <option key={x} value={x}>{POS_LONG[x]} ({POS_LABEL[x]})</option>)}
        </select>
      </div>
      {p.individual?.position && (
        <div className="stack-sm" style={{ marginTop: 10 }}>
          <div className="between small"><span className="faint">Umschulung {POS_LABEL[p.individual.position]}</span><b>{p.individual.progress} %</b></div>
          <div className="progress"><span style={{ width: `${p.individual.progress}%` }} /></div>
        </div>
      )}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn btn-primary btn-sm" disabled={busy || !changed} onClick={save}>Speichern</button>
      </div>
    </Panel>
  );
}
