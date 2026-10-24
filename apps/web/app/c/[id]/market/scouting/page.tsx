"use client";
import Link from "next/link";
import { useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { POS_LABEL, money } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Empty, ErrorBox, Icon, Loading, Nat, Panel, Pos, Rating, useToast } from "@/components/ui";

const POSITIONS = ["", "GK", "DR", "DC", "DL", "DM", "MR", "MC", "ML", "AMR", "AMC", "AML", "ST"];
const AGES = [["", "Alle Altersklassen"], ["19", "bis 19 Jahre"], ["21", "bis 21 Jahre"], ["23", "bis 23 Jahre"], ["27", "bis 27 Jahre"]];

export default function ScoutingPage() {
  const { id } = useGame();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`careers/${id}/scouting`);
  const [country, setCountry] = useState("");
  const [position, setPosition] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const selected = data.countries.find((c: any) => c.code === (country || data.countries[0].code));
  const full = data.assignments.length >= data.maxAssignments;

  async function send() {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${id}/scouting`, { body: { country: selected.code, position: position || null, maxAge: maxAge || null } });
      toast(r.message, "success");
      reload();
      refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(aid: number) {
    await api(`careers/${id}/scouting/${aid}/cancel`, { body: {} }).catch(() => {});
    reload();
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Scouting</h1><p>Chefscout Stufe {data.staffScout} · {data.assignments.length} von {data.maxAssignments} Aufträgen aktiv</p></div>
      </div>
      <div className="grid grid-side" style={{ alignItems: "start" }}>
        <div className="stack">
          {data.reports.length === 0 ? (
            <div className="card"><Empty>Noch keine Berichte. Schicke deinen Scout mit einem Auftrag los.</Empty></div>
          ) : data.reports.map((r: any) => (
            <section key={r.id} className="card card-flush">
              <div className="card-head"><h3><Icon name="search" size={15} /> {r.title}</h3><span className="faint small">{r.dateLabel}</span></div>
              {r.players.length === 0 ? <Empty>Keine passenden Spieler gefunden.</Empty> : (
                <table className="table">
                  <thead><tr><th>Pos</th><th>Name</th><th>Nat</th><th className="c">Alter</th><th>Verein</th><th className="c">Stärke</th><th className="c">Potenzial</th><th className="r">Marktwert</th><th className="hide-sm">Einschätzung</th></tr></thead>
                  <tbody>
                    {r.players.map((p: any) => (
                      <tr key={p.id} className="clickable" onClick={() => (window.location.href = `/c/${id}/player/${p.id}`)}>
                        <td><Pos p={p.position} /></td>
                        <td className="name">{p.name}{p.own && <span className="badge" style={{ marginLeft: 6 }}>Eigener Spieler</span>}</td>
                        <td><Nat code={p.nationality} /></td>
                        <td className="c">{p.age}</td>
                        <td className="truncate">{p.clubId ? <Link href={`/c/${id}/club/${p.clubId}`} onClick={(e) => e.stopPropagation()}>{p.clubName}</Link> : "vereinslos"}</td>
                        <td className="c">{p.rating !== null ? <Rating value={p.rating} /> : "–"}</td>
                        <td className="c cond" style={{ fontWeight: 700 }}>{p.potentialMin !== null ? `${p.potentialMin}–${p.potentialMax}` : "–"}</td>
                        <td className="r">{money(p.value)}</td>
                        <td className="hide-sm dim small">{p.verdict}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </div>
        <div className="stack">
          <Panel title="Neuer Auftrag" icon="search">
            <div className="field"><label>Land</label>
              <select className="select" value={selected.code} onChange={(e) => setCountry(e.target.value)}>
                {data.countries.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginTop: 10 }}><label>Position</label>
              <select className="select" value={position} onChange={(e) => setPosition(e.target.value)}>
                {POSITIONS.map((p) => <option key={p} value={p}>{p ? POS_LABEL[p] : "Alle Positionen"}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginTop: 10 }}><label>Alter</label>
              <select className="select" value={maxAge} onChange={(e) => setMaxAge(e.target.value)}>
                {AGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="kv" style={{ marginTop: 10 }}><span className="k">Kosten</span><span className="v">{money(selected.cost)}</span></div>
            <div className="kv"><span className="k">Dauer</span><span className="v">{selected.days} Tage</span></div>
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} disabled={busy || full} onClick={send}>
              {full ? "Alle Scouts sind unterwegs" : "Scout losschicken"}
            </button>
          </Panel>
          <Panel title="Laufende Aufträge" icon="calendar" flush>
            {data.assignments.length === 0 ? <p className="dim small" style={{ padding: 14 }}>Keine laufenden Aufträge.</p> : (
              <table className="table">
                <tbody>
                  {data.assignments.map((a: any) => (
                    <tr key={a.id}>
                      <td><div className="name">{a.title}</div><div className="faint small">Bericht am {a.dueLabel} · noch {a.daysLeft} Tage</div></td>
                      <td className="r"><button className="btn btn-ghost btn-sm" onClick={() => cancel(a.id)} title="Auftrag abbrechen"><Icon name="close" size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <div className="card small dim"><Icon name="info" size={14} /> Ein besserer Chefscout arbeitet schneller, genauer und kann mehrere Aufträge gleichzeitig übernehmen. Aufträge im Ausland kosten mehr und dauern länger.</div>
        </div>
      </div>
    </>
  );
}
