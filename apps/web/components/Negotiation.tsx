"use client";
import { useEffect, useState } from "react";
import { api, refreshAll } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { Select } from "./Select";
import { Crest, Icon, Loading, Modal, useNotes, useToast } from "./ui";

const ROLE_OPTIONS = [
  { value: "star", label: "Schlüsselspieler", description: "Spielt fast immer" },
  { value: "important", label: "Wichtiger Spieler", description: "Regelmässig in der Startelf" },
  { value: "regular", label: "Stammspieler", description: "Meistens dabei" },
  { value: "rotation", label: "Rotationsspieler", description: "Wechselnde Einsätze" },
  { value: "backup", label: "Ergänzungsspieler", description: "Selten in der Startelf" },
  { value: "prospect", label: "Talent", description: "Entwicklung und Einsätze im Pokal" },
];
const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((o) => [o.value, o.label]));

interface ClubOffer { fee: number; upfrontPct: number; installmentYears: number; sellOn: number }
interface Terms { wage: number; years: number; signingBonus: number; releaseClause: number | null; role: string; agentFee: number }

export interface NegotiationTarget {
  id: number;
  name: string;
  position: string;
  age: number;
  free: boolean;
  club?: { name: string; colors: { primary: string; secondary: string } } | null;
  askingPrice?: number | null;
  value?: number;
  /** Ausstiegsklausel im aktuellen Vertrag (sofern bekannt) */
  releaseClause?: number | null;
  /** Vertragsverlängerung mit einem eigenen Spieler */
  renew?: boolean;
  /** Vorvertrag: Spieler im letzten Vertragsjahr, Wechsel im Sommer ohne Ablöse */
  pre?: boolean;
}

const STEPS = [{ key: "club", label: "Vereinsangebot" }, { key: "contract", label: "Vertrag" }, { key: "done", label: "Unterschrift" }];

/** Zahl mit Schrittknöpfen und formatierter Anzeige. */
function MoneyField({ label, value, onChange, step, hint, min = 0 }: { label: string; value: number; onChange: (v: number) => void; step: number; hint?: React.ReactNode; min?: number }) {
  return (
    <div className="neg-field">
      <div className="neg-field-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <div className="neg-money">
        <button type="button" className="btn btn-sm" onClick={() => onChange(Math.max(min, value - step))} aria-label={`${label} verringern`}>−</button>
        <input className="input" type="number" min={min} step={step} value={value} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))} aria-label={label} />
        <button type="button" className="btn btn-sm" onClick={() => onChange(value + step)} aria-label={`${label} erhöhen`}>+</button>
        <b className="neg-money-fmt">{money(value)}</b>
      </div>
    </div>
  );
}

function Seg<T extends number | string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="neg-field">
      <div className="neg-field-label"><span>{label}</span></div>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} className={value === o.v ? "active" : ""} onClick={() => onChange(o.v)}>{o.l}</button>)}
      </div>
    </div>
  );
}

const stepFor = (v: number) => (v >= 20_000_000 ? 1_000_000 : v >= 5_000_000 ? 250_000 : v >= 1_000_000 ? 100_000 : 25_000);

/**
 * Verhandlungsfenster im Stil des Manager-Spiels: erst die Einigung mit dem
 * Verein (Ablöse, Raten, Weiterverkauf), dann der Vertrag mit dem Berater.
 */
export function NegotiationModal({ careerId, target, negotiationId, onClose, onChanged }: {
  careerId: string;
  target: NegotiationTarget;
  negotiationId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const showNotes = useNotes();
  const [nid, setNid] = useState<number | null>(negotiationId);
  const [n, setN] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState<ClubOffer>({ fee: target.free ? 0 : Math.round(((target.askingPrice ?? target.value ?? 0) * 0.9) / 25_000) * 25_000, upfrontPct: 100, installmentYears: 2, sellOn: 0 });
  const [terms, setTerms] = useState<Terms | null>(null);
  const [revise, setRevise] = useState(false);

  async function load(id = nid) {
    if (!id) return;
    const r = await api<any>(`careers/${careerId}/negotiations/${id}`);
    setN(r);
    if (r.offer && r.stage === "club") setOffer({ fee: r.counter?.fee ?? r.offer.fee, upfrontPct: r.offer.upfrontPct, installmentYears: r.offer.installmentYears || 2, sellOn: r.offer.sellOn });
    if (r.stage === "contract" && r.demand) setTerms((t) => (t && r.status === "countered" ? { ...t, wage: Math.max(t.wage, Math.round(r.demand.wage * 0.97 / 100) * 100) } : t ?? { ...r.demand, wage: Math.max(r.kind === "renew" ? r.currentWage : 0, Math.round((r.demand.wage * 0.9) / 100) * 100) }));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function post(body: Record<string, unknown>, path = `negotiations/${nid}`) {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${careerId}/${path}`, { body });
      if (r.notes) showNotes(r.notes);
      if (r.status === "completed") toast(r.message, "success");
      else if (r.message) toast(r.message, r.status === "failed" ? "error" : "info");
      const id = r.id ?? nid;
      if (r.id) setNid(r.id);
      setRevise(false);
      await load(id);
      onChanged?.();
      if (r.status === "completed") refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const pre = !!target.pre || n?.kind === "pre";
  const noClub = target.free || !!target.renew || n?.kind === "renew" || pre;
  const stage = n?.stage ?? (nid ? null : noClub ? "contract" : "club");
  const ended = n && ["done", "failed", "withdrawn", "expired"].includes(n.stage);
  const stepIdx = stage === "done" ? 2 : stage === "contract" ? 1 : 0;
  const budget = n?.budget;
  const upfront = offer.fee * (offer.upfrontPct / 100);
  const clause = target.releaseClause ?? n?.releaseClause ?? null;
  // Bei einer Verlängerung ersetzt das neue Gehalt das bisherige
  const billWith = (wage: number) => (budget ? budget.wageBill - (noClub && !target.free && !pre ? n?.currentWage ?? 0 : 0) + wage : 0);
  const showOfferForm = !noClub && (!nid || (n?.stage === "club" && (n.status === "rejected" || revise)));

  return (
    <Modal open onClose={onClose} wide>
      <div className="neg">
        <div className="neg-head">
          {target.club ? <Crest colors={target.club.colors} name={target.club.name} size={40} /> : <span className="neg-free"><Icon name="contract" size={20} /></span>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="faint small up">{pre ? `Vorvertrag${target.club ? ` · noch bei ${target.club.name}` : ""} · ablösefrei im Sommer` : noClub && !target.free ? "Vertragsverlängerung" : target.club ? `Verhandlung mit ${target.club.name}` : "Vereinsloser Spieler"}</div>
            <h2 className="truncate">{target.name} <span className="faint" style={{ fontSize: 15 }}>{target.position} · {target.age} J.</span></h2>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Schliessen"><Icon name="close" size={16} /></button>
        </div>

        <ol className="neg-steps" aria-label="Ablauf">
          {STEPS.filter((s) => !(noClub && s.key === "club")).map((s) => {
            const i = STEPS.findIndex((x) => x.key === s.key);
            const failed = ended && n.stage !== "done" && i === stepIdx;
            return <li key={s.key} className={`${i < stepIdx || n?.stage === "done" ? "done" : ""} ${i === stepIdx ? "current" : ""} ${failed ? "failed" : ""}`}><span>{i < stepIdx || n?.stage === "done" ? <Icon name="check" size={12} /> : failed ? <Icon name="close" size={12} /> : STEPS.filter((x) => !(noClub && x.key === "club")).indexOf(s) + 1}</span><em>{s.label}</em></li>;
          })}
        </ol>

        {nid && !n && <Loading />}

        {n?.message && (
          <div className={`neg-status ${n.stage === "done" ? "ok" : ended ? "bad" : n.status === "countered" ? "warn" : ""}`}>
            <Icon name={n.stage === "done" ? "check" : ended ? "close" : n.status === "pending" ? "calendar" : "info"} size={16} />
            <span>{n.message}{n.waitingDays > 0 && <b> Antwort in {n.waitingDays} {n.waitingDays === 1 ? "Tag" : "Tagen"}.</b>}{n.status === "pending" && n.waitingDays === 0 && <b> Antwort am nächsten Tag.</b>}</span>
          </div>
        )}

        {n?.rival && !ended && (
          <div className="neg-status bad">
            <Icon name="transfer" size={16} />
            <span><b>Konkurrenz:</b> {n.rival.name} bietet {money(n.rival.wage)} pro Woche. Entscheidung {n.rival.daysLeft === 0 ? "heute" : `in ${n.rival.daysLeft} ${n.rival.daysLeft === 1 ? "Tag" : "Tagen"}`}.</span>
          </div>
        )}

        <div className="neg-body">
          <div className="neg-main">
            {/* Gegenangebot des Vereins */}
            {n?.stage === "club" && n.status === "countered" && n.counter && !revise && (
              <div className="neg-box">
                <h4>Forderung von {n.from?.name}</h4>
                <dl className="msg-kv">
                  <div><dt>Ablöse</dt><dd>{money(n.counter.fee)}</dd></div>
                  <div><dt>Zahlung</dt><dd>{n.counter.upfrontPct === 100 ? "Sofort, komplett" : `${n.counter.upfrontPct} % sofort, Rest in ${n.counter.installmentYears} Jahresraten`}</dd></div>
                  <div><dt>Weiterverkauf</dt><dd>{n.counter.sellOn ? `${n.counter.sellOn} %` : "–"}</dd></div>
                </dl>
                <div className="row-wrap">
                  <button className="btn btn-primary" disabled={busy} onClick={() => post({ action: "accept" })}>Forderung annehmen</button>
                  <button className="btn" disabled={busy || n.attempts >= 4} onClick={() => setRevise(true)}>Neues Angebot</button>
                </div>
              </div>
            )}

            {/* Vereinsangebot */}
            {showOfferForm && (
              <div className="neg-box">
                <h4>{nid ? "Verbessertes Angebot" : "Angebot an den Verein"}</h4>
                <MoneyField label="Ablösesumme" value={offer.fee} step={stepFor(offer.fee)} onChange={(fee) => setOffer({ ...offer, fee })}
                  hint={target.askingPrice ? <>Forderung ca. <b>{money(target.askingPrice)}</b></> : undefined} />
                {target.askingPrice || clause ? (
                  <div className="row-wrap neg-quick">
                    {target.askingPrice ? [0.8, 0.9, 1, 1.1].map((f) => <button key={f} type="button" className="btn btn-sm btn-ghost" onClick={() => setOffer({ ...offer, fee: Math.round((target.askingPrice! * f) / 25_000) * 25_000 })}>{f === 1 ? "Forderung" : `${Math.round(f * 100)} %`}</button>) : null}
                    {clause ? <button type="button" className="btn btn-sm neg-clause" onClick={() => setOffer({ ...offer, fee: clause, upfrontPct: 100 })} title="Bei Zahlung der Klausel kann der Verein nicht ablehnen">Ausstiegsklausel {money(clause)}</button> : null}
                  </div>
                ) : null}
                {clause && offer.fee >= clause && offer.upfrontPct === 100 && <p className="small pos-text">Du zahlst die Ausstiegsklausel – der Verein kann nicht ablehnen, du sprichst direkt mit dem Spieler.</p>}
                <Seg label="Sofortzahlung" value={offer.upfrontPct} onChange={(upfrontPct) => setOffer({ ...offer, upfrontPct })}
                  options={[100, 75, 50, 25].map((v) => ({ v, l: `${v} %` }))} />
                {offer.upfrontPct < 100 && (
                  <Seg label="Restbetrag in Jahresraten" value={offer.installmentYears} onChange={(installmentYears) => setOffer({ ...offer, installmentYears })}
                    options={[1, 2, 3].map((v) => ({ v, l: `${v} ${v === 1 ? "Jahr" : "Jahre"}` }))} />
                )}
                <div className="neg-field">
                  <div className="neg-field-label"><span>Weiterverkaufsbeteiligung</span><small><b>{offer.sellOn} %</b> eines künftigen Verkaufs</small></div>
                  <input type="range" min={0} max={30} step={5} value={offer.sellOn} onChange={(e) => setOffer({ ...offer, sellOn: Number(e.target.value) })} aria-label="Weiterverkaufsbeteiligung in Prozent" />
                </div>
                <div className="neg-sum">
                  <span>Jetzt fällig <b>{money(upfront)}</b></span>
                  {offer.upfrontPct < 100 && <span>Raten {offer.installmentYears} × <b>{money((offer.fee - upfront) / offer.installmentYears)}</b></span>}
                </div>
                <div className="row-wrap">
                  <button className="btn btn-primary" disabled={busy || offer.fee <= 0} onClick={() => (nid ? post({ action: "offer", ...offer }) : post({ playerId: target.id, ...offer }, "negotiations"))}>
                    <Icon name="mail" size={15} /> Angebot abschicken
                  </button>
                  {revise && <button className="btn btn-ghost" onClick={() => setRevise(false)}>Zurück</button>}
                </div>
                <p className="faint small">Der Verein antwortet in ein bis zwei Tagen per Nachricht. Raten und eine Beteiligung machen ein Angebot für ihn attraktiver als die reine Summe.</p>
              </div>
            )}

            {/* Vereinsloser Spieler: Gespräche eröffnen */}
            {target.free && !nid && (
              <div className="neg-box">
                <h4>Gespräche mit dem Berater</h4>
                <p className="dim small">Der Spieler ist vereinslos – es fällt keine Ablöse an. Eröffne die Gespräche, um die Forderungen seines Beraters zu erfahren.</p>
                <button className="btn btn-primary" disabled={busy} onClick={() => post({ playerId: target.id, fee: 0 }, "negotiations")}><Icon name="contract" size={15} /> Gespräche eröffnen</button>
              </div>
            )}

            {/* Vertrag */}
            {n?.stage === "contract" && terms && n.demand && (
              <div className="neg-box">
                <div className="between"><h4>Vertragsangebot</h4><span className="neg-patience" title="Geduld des Beraters">Geduld {[0, 1, 2].map((i) => <i key={i} className={i < n.patience ? "on" : ""} />)}</span></div>
                <MoneyField label="Gehalt pro Woche" value={terms.wage} step={terms.wage >= 20_000 ? 1000 : 100} onChange={(wage) => setTerms({ ...terms, wage })}
                  hint={<>Forderung <b>{money(n.demand.wage)}</b> · bisher {money(n.currentWage)}</>} />
                <Seg label={`Laufzeit (Wunsch: ${n.demand.years} Jahre)`} value={terms.years} onChange={(years) => setTerms({ ...terms, years })}
                  options={[1, 2, 3, 4, 5].map((v) => ({ v, l: `${v} J.` }))} />
                <div className="neg-field">
                  <div className="neg-field-label"><span>Kaderrolle</span><small>Erwartet: <b>{ROLE_LABEL[n.demand.role]}</b></small></div>
                  <Select label="Kaderrolle" value={terms.role} options={ROLE_OPTIONS} onChange={(role) => setTerms({ ...terms, role })} menuWidth={280} />
                </div>
                <MoneyField label="Handgeld" value={terms.signingBonus} step={terms.signingBonus >= 1_000_000 ? 100_000 : 10_000} onChange={(signingBonus) => setTerms({ ...terms, signingBonus })}
                  hint={<>Forderung <b>{money(n.demand.signingBonus)}</b></>} />
                <MoneyField label="Beraterhonorar" value={terms.agentFee} step={terms.agentFee >= 1_000_000 ? 100_000 : 5_000} onChange={(agentFee) => setTerms({ ...terms, agentFee })}
                  hint={<>Forderung <b>{money(n.demand.agentFee)}</b></>} />
                <div className="neg-field">
                  <label className="row small"><input type="checkbox" checked={terms.releaseClause !== null} onChange={(e) => setTerms({ ...terms, releaseClause: e.target.checked ? (n.demand.releaseClause ?? Math.round((n.value * 3) / 100_000) * 100_000) : null })} />
                    Ausstiegsklausel {n.demand.releaseClause ? <span className="faint">(gewünscht: {money(n.demand.releaseClause)})</span> : <span className="faint">(nicht gefordert)</span>}</label>
                  {terms.releaseClause !== null && <MoneyField label="Klauselhöhe" value={terms.releaseClause} step={stepFor(terms.releaseClause)} onChange={(releaseClause) => setTerms({ ...terms, releaseClause })} />}
                </div>
                {budget && (
                  <div className="neg-budget">
                    <div className="between small"><span>Gehaltsbudget</span><b className={billWith(terms.wage) > budget.wage ? "neg-text" : ""}>{money(billWith(terms.wage))} / {money(budget.wage)}</b></div>
                    <div className={`progress ${billWith(terms.wage) > budget.wage ? "danger" : billWith(terms.wage) > budget.wage * 0.95 ? "warn" : ""}`}><span style={{ width: `${Math.min(100, (billWith(terms.wage) / budget.wage) * 100)}%` }} /></div>
                    <div className="between small faint"><span>Einmalzahlungen jetzt ({noClub ? "Handgeld, Berater" : "Ablöse, Handgeld, Berater"})</span><b>{money((n.offer?.fee ?? 0) * ((n.offer?.upfrontPct ?? 100) / 100) + terms.signingBonus + terms.agentFee)}</b></div>
                  </div>
                )}
                <div className="row-wrap">
                  <button className="btn btn-primary" disabled={busy} onClick={() => post({ action: "contract", ...terms })}><Icon name="contract" size={15} /> Vertrag anbieten</button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => setTerms({ ...n.demand })}>Forderung übernehmen</button>
                </div>
              </div>
            )}

            {n?.stage === "done" && (
              <div className="neg-box neg-done">
                <Icon name="check" size={28} />
                <h4>{target.name} {n.kind === "renew" ? "hat verlängert!" : n.kind === "pre" ? "hat einen Vorvertrag unterschrieben!" : "hat unterschrieben!"}</h4>
                <p className="dim small">{money(n.terms?.wage)} pro Woche bis Sommer {n.contractUntil !== null ? n.contractUntil + 1 : n.season + (n.terms?.years ?? 1)} · Rolle {ROLE_LABEL[n.terms?.role]}</p>
              </div>
            )}

            {nid && n && !ended && (
              <button className="btn btn-ghost btn-sm neg-withdraw" disabled={busy} onClick={() => post({ action: "withdraw" })}><Icon name="close" size={13} /> Verhandlung abbrechen</button>
            )}
          </div>

          <aside className="neg-side">
            {budget && (
              <div className="neg-box">
                <h4>Dein Budget</h4>
                <dl className="msg-kv">
                  <div><dt>Transferbudget</dt><dd>{money(budget.transfer)}</dd></div>
                  <div><dt>Gehälter</dt><dd>{money(budget.wageBill)} / {money(budget.wage)}</dd></div>
                  <div><dt>Kontostand</dt><dd>{money(budget.balance)}</dd></div>
                </dl>
              </div>
            )}
            {n?.log?.length > 0 && (
              <div className="neg-box">
                <h4>Verlauf</h4>
                <ol className="neg-log">
                  {[...n.log].reverse().map((l: any, i: number) => (
                    <li key={i} className={`who-${l.who}`}><b>{l.who === "du" ? "Du" : l.who === "verein" ? n.from?.name ?? "Verein" : "Berater"}</b><span>{l.text}</span></li>
                  ))}
                </ol>
              </div>
            )}
            {!nid && !noClub && (
              <div className="neg-box">
                <h4>So läuft es ab</h4>
                <ol className="neg-how">
                  <li>Angebot an den Verein: Summe, Raten, Beteiligung.</li>
                  <li>Der Verein antwortet nach ein bis zwei Tagen – mit Zusage, Gegenforderung oder Absage.</li>
                  <li>Danach verhandelst du mit dem Berater: Gehalt, Laufzeit, Rolle, Handgeld.</li>
                </ol>
              </div>
            )}
          </aside>
        </div>
      </div>
    </Modal>
  );
}
