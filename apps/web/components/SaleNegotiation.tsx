"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, refreshAll } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { Crest, Icon, Loading, Modal, useToast } from "./ui";

interface ClubOffer { fee: number; upfrontPct: number; installmentYears: number; sellOn: number }

function describe(o: ClubOffer) {
  return `${money(o.fee)}${o.upfrontPct < 100 ? ` · ${o.upfrontPct} % sofort, Rest in ${o.installmentYears} Jahresrate${o.installmentYears > 1 ? "n" : ""}` : " · sofort"}${o.sellOn ? ` · ${o.sellOn} % Weiterverkauf` : ""}`;
}

const STATUS_TEXT: Record<string, string> = {
  offered: "Angebot liegt vor – deine Entscheidung",
  pending: "Der Verein prüft deine Forderung",
  player: "Einigung erzielt – der Spieler entscheidet",
};

/**
 * Angebot eines anderen Vereins für einen eigenen Spieler: annehmen, mehr fordern
 * (Summe, Zahlungsweise, Beteiligung) oder ablehnen. Bei einer gezogenen
 * Ausstiegsklausel bleibt nur abwarten, wie sich der Spieler entscheidet.
 */
export function SaleModal({ careerId, negotiationId, onClose, onChanged }: { careerId: string; negotiationId: number; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const [n, setN] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [counter, setCounter] = useState<ClubOffer | null>(null);

  async function load() {
    const r = await api<any>(`careers/${careerId}/negotiations/${negotiationId}`);
    setN(r);
    if (r.offer) setCounter({ fee: Math.round((r.offer.fee * 1.2) / 50_000) * 50_000, upfrontPct: 100, installmentYears: 0, sellOn: r.offer.sellOn ?? 0 });
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [negotiationId]);

  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${careerId}/negotiations/${negotiationId}`, { body: { action, ...body } });
      toast(r.message, r.status === "completed" ? "success" : r.status === "failed" || r.status === "rejected" ? "info" : "info");
      await load();
      onChanged?.();
      if (r.status === "completed") refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const ended = n && ["done", "failed", "withdrawn", "expired"].includes(n.stage);
  const upfront = n?.offer ? n.offer.fee * (n.offer.upfrontPct / 100) : 0;
  const ratio = n?.offer && n.value ? n.offer.fee / n.value : 0;

  return (
    <Modal open onClose={onClose} wide>
      <div className="neg">
        <div className="neg-head">
          {n?.to ? <Crest colors={n.to.colors} name={n.to.name} size={40} /> : <span className="neg-free"><Icon name="transfer" size={20} /></span>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="faint small up">{n?.clause ? "Ausstiegsklausel gezogen" : `Angebot von ${n?.to?.name ?? "…"}`}</div>
            <h2 className="truncate">{n?.player ?? "…"} {n && <span className="faint" style={{ fontSize: 15 }}>{n.position} · {n.age} J.</span>}</h2>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Schliessen"><Icon name="close" size={16} /></button>
        </div>
        {!n ? <Loading /> : (
          <>
            <div className={`neg-status ${n.stage === "done" ? "ok" : ended ? "bad" : n.status === "offered" ? "warn" : ""}`}>
              <Icon name={n.stage === "done" ? "check" : ended ? "close" : n.status === "offered" ? "info" : "calendar"} size={16} />
              <span>{n.message}{!ended && STATUS_TEXT[n.status] && <b> {STATUS_TEXT[n.status]}{n.status === "offered" ? (n.waitingDays > 0 ? ` – gültig noch ${n.waitingDays} ${n.waitingDays === 1 ? "Tag" : "Tage"}` : " – nur noch heute") : n.waitingDays > 0 ? ` (in ${n.waitingDays} ${n.waitingDays === 1 ? "Tag" : "Tagen"})` : " (morgen)"}.</b>}</span>
            </div>
            <div className="neg-body">
              <div className="neg-main">
                <div className="neg-box">
                  <h4>Angebot</h4>
                  <dl className="msg-kv">
                    <div><dt>Ablöse</dt><dd>{money(n.offer?.fee)} <span className={ratio >= 1.1 ? "pos-text" : ratio < 0.9 ? "neg-text" : "faint"}>({Math.round(ratio * 100)} % des Marktwerts)</span></dd></div>
                    <div><dt>Zahlung</dt><dd>{n.offer?.upfrontPct === 100 ? "Komplett sofort" : `${money(upfront)} sofort, Rest in ${n.offer?.installmentYears} ${n.offer?.installmentYears === 1 ? "Jahresrate" : "Jahresraten"}`}</dd></div>
                    <div><dt>Weiterverkauf für dich</dt><dd>{n.offer?.sellOn ? `${n.offer.sellOn} %` : "–"}</dd></div>
                    <div><dt>Marktwert</dt><dd>{money(n.value)}</dd></div>
                    <div><dt>Vertrag bis</dt><dd>{n.contractUntil !== null ? `Sommer ${n.contractUntil + 1}` : "–"}</dd></div>
                    {n.releaseClause && <div><dt>Ausstiegsklausel</dt><dd>{money(n.releaseClause)}</dd></div>}
                  </dl>
                  {n.stage === "club" && n.status === "offered" && (
                    <div className="row-wrap">
                      <button className="btn btn-primary" disabled={busy} onClick={() => act("sale_accept")}><Icon name="check" size={15} /> Annehmen</button>
                      <button className="btn btn-ghost" disabled={busy} onClick={() => act("sale_reject")}>Ablehnen</button>
                    </div>
                  )}
                </div>

                {n.stage === "club" && n.status === "offered" && counter && n.attempts < 3 && (
                  <div className="neg-box">
                    <h4>Mehr fordern</h4>
                    <div className="neg-field">
                      <div className="neg-field-label"><span>Ablöse</span><small>Marktwert <b>{money(n.value)}</b></small></div>
                      <div className="neg-money">
                        <button type="button" className="btn btn-sm" onClick={() => setCounter({ ...counter, fee: Math.max(0, counter.fee - 250_000) })} aria-label="Ablöse verringern">−</button>
                        <input className="input" type="number" step={50_000} value={counter.fee} onChange={(e) => setCounter({ ...counter, fee: Number(e.target.value) || 0 })} aria-label="Geforderte Ablöse" />
                        <button type="button" className="btn btn-sm" onClick={() => setCounter({ ...counter, fee: counter.fee + 250_000 })} aria-label="Ablöse erhöhen">+</button>
                        <b className="neg-money-fmt">{money(counter.fee)}</b>
                      </div>
                    </div>
                    <div className="neg-field">
                      <div className="neg-field-label"><span>Zahlung</span></div>
                      <div className="seg" role="radiogroup" aria-label="Zahlung">
                        {[100, 75, 50].map((v) => <button key={v} type="button" role="radio" aria-checked={counter.upfrontPct === v} className={counter.upfrontPct === v ? "active" : ""} onClick={() => setCounter({ ...counter, upfrontPct: v, installmentYears: v === 100 ? 0 : Math.max(1, counter.installmentYears || 2) })}>{v} % sofort</button>)}
                      </div>
                    </div>
                    <div className="neg-field">
                      <div className="neg-field-label"><span>Weiterverkaufsbeteiligung für dich</span><small><b>{counter.sellOn} %</b></small></div>
                      <input type="range" min={0} max={30} step={5} value={counter.sellOn} onChange={(e) => setCounter({ ...counter, sellOn: Number(e.target.value) })} aria-label="Weiterverkaufsbeteiligung in Prozent" />
                    </div>
                    <div className="row-wrap">
                      <button className="btn" disabled={busy || counter.fee <= 0} onClick={() => act("sale_counter", counter as unknown as Record<string, unknown>)}><Icon name="mail" size={15} /> Forderung schicken</button>
                      <span className="faint small">Noch {3 - n.attempts} {3 - n.attempts === 1 ? "Runde" : "Runden"} – danach zieht der Verein ab.</span>
                    </div>
                  </div>
                )}
                {n.clause && !ended && <p className="faint small">Bei einer gezogenen Ausstiegsklausel kannst du den Wechsel nicht verhindern – ob er geht, entscheidet der Spieler. Zufriedene Leistungsträger bleiben eher.</p>}
                <Link className="btn btn-ghost btn-sm" href={`/c/${careerId}/player/${n.playerId}`} style={{ alignSelf: "flex-start" }}><Icon name="users" size={13} /> Spielerprofil</Link>
              </div>
              <aside className="neg-side">
                {n.log?.length > 0 && (
                  <div className="neg-box">
                    <h4>Verlauf</h4>
                    <ol className="neg-log">
                      {[...n.log].reverse().map((l: any, i: number) => (
                        <li key={i} className={`who-${l.who}`}><b>{l.who === "du" ? "Du" : l.who === "verein" ? n.to?.name ?? "Verein" : "Spieler"}</b><span>{l.text}</span></li>
                      ))}
                    </ol>
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
