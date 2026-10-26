"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Crest, Empty, ErrorBox, Icon, Loading, Pos, useToast } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { usePrompt } from "@/components/Dialog";
import { NegotiationModal, type NegotiationTarget } from "@/components/Negotiation";
import { SaleModal } from "@/components/SaleNegotiation";

const STAGE: Record<string, { label: string; cls: string }> = {
  club: { label: "Verein", cls: "badge-blue" }, contract: { label: "Vertrag", cls: "badge-warn" }, done: { label: "Unterschrieben", cls: "badge-accent" },
  failed: { label: "Gescheitert", cls: "badge-danger" }, withdrawn: { label: "Abgebrochen", cls: "" }, expired: { label: "Abgelaufen", cls: "" },
};
const STATUS: Record<string, string> = { pending: "Antwort ausstehend", countered: "Gegenforderung", rejected: "Abgelehnt", open: "Gespräche laufen", agreed: "Einigung", withdrawn: "Abgebrochen", expired: "Fenster geschlossen" };

export default function TransferHub() {
  const { id } = useGame();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const prompt = usePrompt();
  const { data, error, reload } = useApi<any>(`careers/${id}/transfers`);
  const [neg, setNeg] = useState<{ target: NegotiationTarget; id: number } | null>(null);
  const [sale, setSale] = useState<number | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [wage, setWage] = useState(0);
  const budgetBtn = useRef<HTMLButtonElement>(null);

  // Aus dem Posteingang direkt in eine Verhandlung springen
  useEffect(() => {
    const nid = Number(params.get("neg"));
    if (!data || !nid || neg || sale) return;
    const n = data.negotiations.find((x: any) => x.id === nid);
    if (n) openNeg(n);
    else if (data.sales.some((x: any) => x.id === nid)) setSale(nid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, params]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const b = data.budget;
  const w = data.window;
  const active = data.negotiations.filter((n: any) => n.stage === "club" || n.stage === "contract");
  const closed = data.negotiations.filter((n: any) => n.stage !== "club" && n.stage !== "contract");
  const wageShare = b.wage > 0 ? (b.wageBill / b.wage) * 100 : 0;

  function openNeg(n: any) {
    const renew = n.kind === "renew";
    setNeg({ id: n.id, target: { id: n.playerId, name: n.player, position: n.position, age: n.age, free: !n.from && !renew, renew, club: n.from && !renew ? { name: n.from.name, colors: n.from.colors } : null, askingPrice: null } });
  }
  const openSales = data.sales.filter((n: any) => n.stage === "club" || n.stage === "contract");

  async function respond(o: any, decision: "accept" | "reject" | "counter") {
    let counterFee: number | undefined;
    if (decision === "counter") {
      const v = await prompt({ title: `Gegenforderung für ${o.player}`, message: `${o.club} bietet ${money(o.fee)}. Wie viel verlangst du (in Mio. €)?`, defaultValue: String(Math.round((o.fee * 1.25) / 100_000) / 10), inputMode: "decimal", confirmLabel: "Fordern" });
      if (v === null) return;
      counterFee = Math.round(Number(v.replace(",", ".")) * 1_000_000);
      if (!Number.isFinite(counterFee) || counterFee <= 0) return toast("Ungültiger Betrag", "error");
    }
    try {
      const r = await api<any>(`careers/${id}/offers/${o.id}`, { body: { decision, counterFee } });
      toast(r.message, r.status === "completed" ? "success" : "info");
      reload();
      refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function saveBudget() {
    try {
      const r = await api<any>(`careers/${id}/transfers/budget`, { body: { wageBudget: wage } });
      toast(r.message, "success");
      setBudgetOpen(false);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const wageDelta = wage - b.wage;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Transfer-Zentrale</h1>
          <p>Verhandlungen, Angebote für deine Spieler, Budget und die Transfers der Liga.</p>
        </div>
        <div className="row-wrap">
          <Link className="btn btn-primary" href={`/c/${id}/market/search`}><Icon name="search" size={15} /> Spielersuche</Link>
          <Link className="btn" href={`/c/${id}/market/scouting`}><Icon name="eye" size={15} /> Scouting</Link>
        </div>
      </div>

      {data.deadline && (
        <div className="hub-deadline" role="status">
          <Icon name="fire" size={18} />
          <div><b>Deadline Day!</b> Heute um Mitternacht schliesst das Transferfenster. Vereine antworten sofort – was heute nicht unterschrieben ist, platzt.</div>
        </div>
      )}
      <div className="hub-kpis">
        <div className={`hub-kpi window ${w.open ? "open" : "closed"}`}>
          <span className="hub-kpi-label"><Icon name="calendar" size={14} /> Transferfenster</span>
          <b>{w.open ? "Geöffnet" : "Geschlossen"}</b>
          <small>{w.open ? (w.daysLeft !== null ? `${w.label} · noch ${w.daysLeft} Tage` : w.label) : w.daysToOpen ? `öffnet in ${w.daysToOpen} Tagen · Vereinslose jederzeit` : "Vereinslose jederzeit verpflichtbar"}</small>
        </div>
        <div className="hub-kpi">
          <span className="hub-kpi-label"><Icon name="euro" size={14} /> Transferbudget</span>
          <b>{money(b.transfer)}</b>
          <small>Kontostand {money(b.balance)}</small>
        </div>
        <div className="hub-kpi">
          <span className="hub-kpi-label"><Icon name="contract" size={14} /> Gehaltsbudget / Woche</span>
          <b>{money(b.wageBill)} <span className="faint">/ {money(b.wage)}</span></b>
          <div className={`progress ${wageShare > 100 ? "danger" : wageShare > 95 ? "warn" : ""}`}><span style={{ width: `${Math.min(100, wageShare)}%` }} /></div>
        </div>
        <div className="hub-kpi action">
          <span className="hub-kpi-label"><Icon name="swap" size={14} /> Budget</span>
          <button ref={budgetBtn} className="btn btn-sm" onClick={() => { setWage(b.wage); setBudgetOpen(true); }}>Budget umschichten</button>
          <small>1 € Wochengehalt = {b.ratio} € Transferbudget</small>
        </div>
      </div>

      <Sheet open={budgetOpen} anchor={budgetBtn.current} title="Budget umschichten" onClose={() => setBudgetOpen(false)} width={360}>
        <div className="stack-sm">
          <p className="dim small">Verschiebe Mittel zwischen Transfer- und Gehaltsbudget, wie im Gespräch mit dem Vorstand.</p>
          <input type="range" min={Math.ceil(b.minWage / 100) * 100} max={Math.floor(b.maxWage / 100) * 100} step={100} value={wage} onChange={(e) => setWage(Number(e.target.value))} aria-label="Gehaltsbudget pro Woche" />
          <dl className="msg-kv">
            <div><dt>Gehaltsbudget</dt><dd>{money(wage)} / Woche {wageDelta !== 0 && <span className={wageDelta > 0 ? "pos-text" : "neg-text"}>({wageDelta > 0 ? "+" : ""}{money(wageDelta)})</span>}</dd></div>
            <div><dt>Transferbudget</dt><dd>{money(b.transfer - wageDelta * b.ratio)}</dd></div>
          </dl>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setWage(b.wage)}>Zurücksetzen</button>
            <button className="btn btn-primary" disabled={wageDelta === 0} onClick={saveBudget}>Übernehmen</button>
          </div>
        </div>
      </Sheet>

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <section className="card card-flush">
            <div className="card-head"><h3><Icon name="transfer" size={15} /> Laufende Verhandlungen {active.length > 0 && <span className="badge badge-blue">{active.length}</span>}</h3></div>
            {active.length === 0 ? <Empty>Keine laufenden Verhandlungen. Finde Verstärkungen in der <Link href={`/c/${id}/market/search`}>Spielersuche</Link>.</Empty> : (
              <div className="hub-negs">
                {active.map((n: any) => (
                  <button key={n.id} className={`hub-neg ${n.status === "countered" || (n.stage === "contract" && n.status === "open") ? "attention" : ""}`} onClick={() => openNeg(n)}>
                    {n.from ? <Crest colors={n.from.colors} name={n.from.name} size={30} /> : <span className="neg-free sm"><Icon name="contract" size={15} /></span>}
                    <span className="hub-neg-main">
                      <b>{n.player} <Pos p={n.position} /></b>
                      <small>{n.from?.name ?? "vereinslos"} · {n.offer?.fee ? money(n.offer.fee) : "ablösefrei"}</small>
                    </span>
                    <span className="hub-neg-state">
                      <span className={`badge ${STAGE[n.stage].cls}`}>{STAGE[n.stage].label}</span>
                      <small>{n.waitingDays > 0 ? `Antwort in ${n.waitingDays} T.` : STATUS[n.status] ?? n.status}</small>
                    </span>
                    <Icon name="next" size={14} />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="card card-flush">
            <div className="card-head"><h3><Icon name="down" size={15} /> Angebote für deine Spieler {openSales.length + data.incoming.length > 0 && <span className="badge badge-warn">{openSales.length + data.incoming.length}</span>}</h3></div>
            {openSales.length + data.incoming.length === 0 ? <Empty>Aktuell liegen keine Angebote vor. Spieler auf der Transferliste wecken eher Interesse.</Empty> : (
              <div className="hub-negs">
                {openSales.map((n: any) => (
                  <button key={n.id} className={`hub-neg ${n.status === "offered" ? "attention" : ""}`} onClick={() => setSale(n.id)}>
                    <Crest colors={n.to.colors} name={n.to.name} size={30} />
                    <span className="hub-neg-main">
                      <b>{n.player} <Pos p={n.position} /></b>
                      <small>{n.to.name} · {money(n.offer?.fee)}{n.offer?.upfrontPct < 100 ? ` (${n.offer.upfrontPct} % sofort)` : ""}</small>
                    </span>
                    <span className="hub-neg-state">
                      <span className={`badge ${n.clause ? "badge-danger" : n.status === "offered" ? "badge-warn" : "badge-blue"}`}>{n.clause ? "Klausel gezogen" : n.status === "offered" ? "Entscheidung" : n.status === "player" ? "Spieler entscheidet" : "Forderung gestellt"}</span>
                      <small>{n.status === "offered" ? (n.waitingDays > 0 ? `Noch ${n.waitingDays} T. gültig` : "Nur noch heute") : n.waitingDays > 0 ? `Antwort in ${n.waitingDays} T.` : "Antwort morgen"}</small>
                    </span>
                    <Icon name="next" size={14} />
                  </button>
                ))}
                {data.incoming.map((o: any) => (
                  <div key={o.id} className="hub-neg static">
                    <Crest colors={o.colors} name={o.club} size={30} />
                    <span className="hub-neg-main">
                      <b><Link href={`/c/${id}/player/${o.playerId}`}>{o.player}</Link></b>
                      <small>{o.club} bietet <b>{money(o.fee)}</b></small>
                    </span>
                    <span className="row-wrap hub-neg-actions">
                      <button className="btn btn-sm btn-primary" onClick={() => respond(o, "accept")}>Annehmen</button>
                      <button className="btn btn-sm" onClick={() => respond(o, "counter")}>Mehr fordern</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => respond(o, "reject")}>Ablehnen</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card card-flush">
            <div className="card-head"><h3><Icon name="trophy" size={15} /> Grösste Transfers der Saison</h3></div>
            {data.world.length === 0 ? <Empty>Noch keine Transfers in dieser Saison.</Empty> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Spieler</th><th className="hide-sm">Von</th><th>Zu</th><th className="r">Ablöse</th></tr></thead>
                  <tbody>
                    {data.world.map((t: any, i: number) => (
                      <tr key={i}>
                        <td className="name">{t.player_name}</td>
                        <td className="small dim hide-sm truncate" style={{ maxWidth: 160 }}>{t.from_name ?? "vereinslos"}</td>
                        <td className="small"><span className="row" style={{ gap: 6 }}><Crest colors={t.to_colors} name={t.to_name} size={18} /><span className="truncate" style={{ maxWidth: 150 }}>{t.to_name}</span></span></td>
                        <td className="r num">{t.fee ? money(t.fee) : "ablösefrei"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card stack-sm">
            <div className="card-head"><h3><Icon name="team" size={15} /> Kader</h3></div>
            <dl className="msg-kv">
              <div><dt>Spieler im Kader</dt><dd>{data.squad.size} / 32</dd></div>
              <div><dt>Auf der Transferliste</dt><dd>{data.squad.listed}</dd></div>
              <div><dt>Vertrag läuft aus</dt><dd className={data.squad.expiring ? "warn-text" : ""}>{data.squad.expiring}</dd></div>
            </dl>
            <Link className="btn btn-sm" href={`/c/${id}/market/contracts`}>Verträge verwalten</Link>
          </section>

          <section className="card card-flush">
            <div className="card-head"><h3><Icon name="eye" size={15} /> Beobachtungsliste</h3><Link className="btn btn-ghost btn-sm" href={`/c/${id}/market/scouting`}>Alle</Link></div>
            {data.shortlist.length === 0 ? <Empty>Noch niemand beobachtet.</Empty> : (
              <div className="hub-list">
                {data.shortlist.map((p: any) => (
                  <button key={p.id} className="hub-list-row" onClick={() => router.push(`/c/${id}/player/${p.id}`)}>
                    <Pos p={p.position} />
                    <span className="truncate"><b>{p.name}</b><small>{p.club ?? "vereinslos"} · {p.age} J.</small></span>
                    <span className="num small">{money(p.value)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {data.installments.length > 0 && (
            <section className="card stack-sm">
              <div className="card-head"><h3><Icon name="euro" size={15} /> Offene Raten</h3></div>
              {data.installments.map((r: any, i: number) => (
                <div key={i} className="between small"><span className="truncate">{r.label}</span><span className="num">{money(r.amount)} <span className="faint">· {r.due_season}/{String(r.due_season + 1).slice(2)}</span></span></div>
              ))}
            </section>
          )}

          {closed.length > 0 && (
            <section className="card card-flush">
              <div className="card-head"><h3>Abgeschlossen</h3></div>
              <div className="hub-list">
                {closed.slice(0, 8).map((n: any) => (
                  <button key={n.id} className="hub-list-row" onClick={() => openNeg(n)}>
                    <Pos p={n.position} />
                    <span className="truncate"><b>{n.player}</b><small>{n.from?.name ?? "vereinslos"}</small></span>
                    <span className={`badge ${STAGE[n.stage].cls}`}>{STAGE[n.stage].label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {sale && <SaleModal careerId={id} negotiationId={sale} onClose={() => { setSale(null); if (params.get("neg")) router.replace(`/c/${id}/market`); }} onChanged={reload} />}
      {neg && <NegotiationModal careerId={id} target={neg.target} negotiationId={neg.id} onClose={() => { setNeg(null); if (params.get("neg")) router.replace(`/c/${id}/market`); }} onChanged={reload} />}
    </>
  );
}
