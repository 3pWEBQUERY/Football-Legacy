"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { ATTR_GROUPS, POS_LABEL, attrColor, money } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Radar } from "@/components/Radar";
import { Crest, ErrorBox, Icon, Loading, Modal, Pos, Progress, Rating, useNotes, useToast } from "@/components/ui";

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

  const season = data.career.season;
  const isGk = p.position === "GK";
  const startOffer = () => {
    setMsg(null);
    setOffer({ fee: p.clubId === null ? 0 : data.askingPrice ?? p.value, wage: Math.max(500, Math.round(((p.contract?.wage ?? 1000) * 1.1) / 100) * 100), years: 3 });
  };

  return (
    <>
      <div className="row"><button className="btn btn-ghost btn-sm" onClick={() => router.back()}><Icon name="back" size={16} /> Zurück</button></div>
      <div className="card">
        <div className="between" style={{ flexWrap: "wrap", gap: 16 }}>
          <div className="row" style={{ gap: 16 }}>
            <div className="rating" style={{ width: 64, height: 64, fontSize: 24, borderRadius: 16 }}>
              <Rating value={p.rating} range={p.ratingRange} />
            </div>
            <div className="stack-sm">
              <h1>{p.flag} {p.name} {p.wonderkid && <span className="badge badge-gold">★ Wunderkind</span>}</h1>
              <div className="row-wrap dim">
                <Pos p={p.position} />
                {p.altPositions.map((x: string) => <span key={x} className="badge">{POS_LABEL[x]}</span>)}
                <span>{p.age} Jahre</span>·<span>{p.archetype}</span>·<span>Fuss {p.foot === "L" ? "links" : p.foot === "R" ? "rechts" : "beidfüssig"}</span>
              </div>
              {data.club ? (
                <Link href={`/c/${id}/club/${data.club.id}`} className="row small"><Crest colors={data.club.colors} name={data.club.name} size={18} /> {data.club.name} <span className="faint">· {data.league?.name}</span></Link>
              ) : <span className="badge badge-blue">Vereinslos</span>}
            </div>
          </div>
          <div className="row-wrap">
            {data.own ? (
              <>
                <button className="btn" disabled={busy} onClick={openRenew}>Vertrag verlängern</button>
                <button className="btn" disabled={busy} onClick={async () => { const r = await action("list"); if (r) { toast(r.listed ? "Auf die Transferliste gesetzt" : "Von der Transferliste genommen"); reload(); } }}>
                  {p.listed ? "Von Transferliste nehmen" : "Auf Transferliste"}
                </button>
                <button className="btn btn-danger" disabled={busy} onClick={async () => {
                  if (!confirm(`Vertrag mit ${p.name} auflösen? Es wird eine Abfindung fällig.`)) return;
                  const r = await action("release");
                  if (r) { toast(`Vertrag aufgelöst. Abfindung: ${money(r.compensation)}`); router.push(`/c/${id}/team`); refreshAll(); }
                }}>Vertrag auflösen</button>
              </>
            ) : (
              <>
                <button className="btn" disabled={busy} onClick={async () => { const r = await action("shortlist"); if (r) { toast(r.shortlisted ? "Zur Beobachtungsliste hinzugefügt" : "Von der Beobachtungsliste entfernt"); reload(); } }}>
                  {data.shortlisted ? "★ Beobachtet" : "☆ Beobachten"}
                </button>
                <button className="btn" disabled={busy} onClick={async () => { const r = await action("scout"); if (r) { toast("Scoutbericht erstellt", "success"); reload(); } }}>🔍 Scouten</button>
                <button className="btn btn-primary" disabled={busy || (!data.window.open && p.clubId !== null)} onClick={startOffer} title={!data.window.open && p.clubId !== null ? "Transferfenster geschlossen" : ""}>
                  {p.clubId === null ? "Verpflichten" : "Angebot abgeben"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="card stack">
          <div className="between">
            <h3>Attribute</h3>
            {!exact && <span className="badge badge-warn">Geschätzt – Genauigkeit: {p.knowledge === "good" ? "gut (gleiche Liga)" : "grob"}. Scouten für exakte Werte.</span>}
          </div>
          <div className="grid grid-3">
            {ATTR_GROUPS.map((g) => (
              <div key={g.title}>
                <div className="faint small" style={{ fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>{g.title}</div>
                {g.keys.map(([k, label]) => {
                  const v = val(k);
                  return (
                    <div key={k} className="attr">
                      <span className="dim">{label}</span>
                      <span className="attr-v" style={{ color: attrColor(v) }}>{exact ? p.attrs[k] : `${p.attrRanges[k][0]}–${p.attrRanges[k][1]}`}</span>
                      <div className="bar"><span style={{ width: `${(v / 20) * 100}%`, background: attrColor(v) }} /></div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="stack">
          <div className="card" style={{ display: "grid", placeItems: "center" }}><Radar value={val} gk={isGk} /></div>
          <div className="card stack-sm">
            <div className="between"><span className="dim">Marktwert</span><b>{money(p.value)}</b></div>
            {data.askingPrice && <div className="between"><span className="dim">Ablöseforderung ca.</span><b>{money(data.askingPrice)}</b></div>}
            <div className="between"><span className="dim">Potenzial</span><b>{exact ? p.potential : data.report ? `${data.report.potentialMin}–${data.report.potentialMax}` : "?"}</b></div>
            <div className="between"><span className="dim">Gehalt</span><b>{p.contract ? `${money(p.contract.wage)}/Woche` : "–"}</b></div>
            <div className="between"><span className="dim">Vertrag bis</span><b>{p.contract?.untilSeason ?? "–"}</b></div>
            {p.contract?.releaseClause && <div className="between"><span className="dim">Ausstiegsklausel</span><b>{money(p.contract.releaseClause)}</b></div>}
            <div className="divider" />
            <div className="stack-sm">
              <div className="between small"><span className="dim">Fitness</span><span>{p.fitness}%</span></div><Progress value={p.fitness} />
              <div className="between small"><span className="dim">Moral</span><span>{p.morale}%</span></div><Progress value={p.morale} tone={p.morale < 35 ? "danger" : p.morale < 55 ? "warn" : undefined} />
              <div className="between small"><span className="dim">Form</span><span>{p.form.toFixed(1)} / 10</span></div><Progress value={p.form} max={10} />
            </div>
            {p.injuryWeeks > 0 && <span className="badge badge-danger">Verletzt: noch {p.injuryWeeks} Wochen</span>}
            {data.report && <div className="card-soft small"><b>Scoutbericht:</b> {data.report.verdict}</div>}
          </div>
          <div className="card stack-sm">
            <h3>Saison {season}</h3>
            <div className="grid grid-4" style={{ gap: 8, gridTemplateColumns: "repeat(4, 1fr)" }}>
              <div className="stat"><span className="label">Spiele</span><span className="value">{p.stats.apps}</span></div>
              <div className="stat"><span className="label">Tore</span><span className="value">{p.stats.goals}</span></div>
              <div className="stat"><span className="label">Vorl.</span><span className="value">{p.stats.assists}</span></div>
              <div className="stat"><span className="label">Ø Note</span><span className="value">{p.stats.apps ? (p.stats.ratingSum / p.stats.apps).toFixed(1) : "–"}</span></div>
            </div>
            {p.history.length > 0 && (
              <table className="table small">
                <thead><tr><th>Saison</th><th>Verein</th><th className="c">Sp</th><th className="c">T</th><th className="c">Ø</th></tr></thead>
                <tbody>{[...p.history].reverse().map((h: any) => <tr key={h.season}><td>{h.season}</td><td className="truncate">{h.clubName}</td><td className="c">{h.apps}</td><td className="c">{h.goals}</td><td className="c">{h.avgRating}</td></tr>)}</tbody>
              </table>
            )}
          </div>
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
