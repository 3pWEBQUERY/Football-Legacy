"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { MobileSubnav, useGame } from "@/components/GameShell";
import { ErrorBox, Icon, Loading, Nat, Pos, Rating, useToast } from "@/components/ui";

const POSITIONS = ["", "GK", "DR", "DC", "DL", "DM", "MR", "MC", "ML", "AMR", "AMC", "AML", "ST"];
const POS_DE: Record<string, string> = { "": "Alle Positionen", GK: "Torwart", DR: "Rechter Verteidiger", DC: "Innenverteidiger", DL: "Linker Verteidiger", DM: "Defensives Mittelfeld", MR: "Rechtes Mittelfeld", MC: "Zentrales Mittelfeld", ML: "Linkes Mittelfeld", AMR: "Rechtsaussen", AMC: "Offensives Mittelfeld", AML: "Linksaussen", ST: "Stürmer" };

export default function Market() {
  const { id } = useGame();
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ q: "", position: "", minAge: "", maxAge: "", maxValue: "", free: false, listed: false, shortlist: false, sort: "rating", page: 0 });
  const [scoutCountry, setScoutCountry] = useState("");
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.position) p.set("position", f.position);
    if (f.minAge) p.set("minAge", f.minAge);
    if (f.maxAge) p.set("maxAge", f.maxAge);
    if (f.maxValue) p.set("maxValue", String(Math.round(Number(f.maxValue) * 1_000_000)));
    if (f.free) p.set("free", "1");
    if (f.listed) p.set("listed", "1");
    if (f.shortlist) p.set("shortlist", "1");
    p.set("sort", f.sort);
    p.set("page", String(f.page));
    return p.toString();
  }, [f]);
  const { data, error, reload } = useApi<any>(`careers/${id}/market?${query}`);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch, page: patch.page ?? 0 }));

  async function activate() {
    if (!scoutCountry) return;
    try {
      const r = await api<any>(`careers/${id}/scouting`, { body: { countryCode: scoutCountry } });
      toast(r.message, "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <>
      <MobileSubnav section="market" />
      <div className="page-head">
        <div>
          <h1>Spielersuche</h1>
          <p>{data ? <>{data.window.label} · Transferbudget <b>{money(data.club?.transferBudget)}</b> · Kontostand {money(data.club?.balance)}</> : " "}</p>
        </div>
      </div>
      <div className="card stack">
        <div className="row-wrap">
          <input className="input" placeholder="Name suchen …" value={f.q} onChange={(e) => set({ q: e.target.value })} style={{ width: 200 }} aria-label="Name" />
          <select className="select" value={f.position} onChange={(e) => set({ position: e.target.value })} aria-label="Position">
            {POSITIONS.map((p) => <option key={p} value={p}>{POS_DE[p]}</option>)}
          </select>
          <input className="input" type="number" placeholder="Alter von" value={f.minAge} onChange={(e) => set({ minAge: e.target.value })} style={{ width: 100 }} aria-label="Mindestalter" />
          <input className="input" type="number" placeholder="bis" value={f.maxAge} onChange={(e) => set({ maxAge: e.target.value })} style={{ width: 80 }} aria-label="Höchstalter" />
          <input className="input" type="number" placeholder="max. Wert (Mio.)" value={f.maxValue} onChange={(e) => set({ maxValue: e.target.value })} style={{ width: 150 }} aria-label="Maximaler Marktwert in Millionen" />
          <select className="select" value={f.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sortierung">
            <option value="rating">Nach Stärke</option>
            <option value="potential">Nach Potenzial</option>
            <option value="value">Nach Marktwert</option>
            <option value="age">Jüngste zuerst</option>
          </select>
        </div>
        <div className="row-wrap">
          <label className="row small"><input type="checkbox" checked={f.free} onChange={(e) => set({ free: e.target.checked })} /> Nur vereinslose</label>
          <label className="row small"><input type="checkbox" checked={f.listed} onChange={(e) => set({ listed: e.target.checked })} /> Auf Transferliste</label>
          <label className="row small"><input type="checkbox" checked={f.shortlist} onChange={(e) => set({ shortlist: e.target.checked })} /> Beobachtungsliste</label>
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="grid grid-main" style={{ alignItems: "start" }}>
          <div className="card card-flush">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Pos</th><th>Name</th><th>Nat</th><th className="c">Alter</th><th className="c">Stärke</th><th>Verein</th><th className="r">Marktwert</th></tr></thead>
                <tbody>
                  {data.players.map((p: any) => (
                    <tr key={p.id} className="clickable" onClick={() => router.push(`/c/${id}/player/${p.id}`)}>
                      <td><Pos p={p.position} /></td>
                      <td>
                        <span className="row" style={{ gap: 6 }}><span className="name">{p.name}</span>{p.shortlisted && <span title="Beobachtet" style={{ color: "var(--accent)", display: "inline-flex" }}><Icon name="eye" size={14} /></span>}{p.listed && <span className="badge badge-blue">Transferliste</span>}</span>
                      </td>
                      <td><Nat code={p.nationality} /></td>
                      <td className="c">{p.age}</td>
                      <td className="c"><Rating value={p.rating} range={p.ratingRange} /></td>
                      <td className="small dim truncate" style={{ maxWidth: 220 }}>{p.clubName ?? <span className="badge badge-accent">vereinslos</span>}</td>
                      <td className="r num">{money(p.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.players.length === 0 && <div className="empty">Keine Spieler gefunden.</div>}
            <div className="between" style={{ padding: 12 }}>
              <button className="btn btn-sm" disabled={f.page === 0} onClick={() => set({ page: f.page - 1 })}>Zurück</button>
              <span className="faint small">Seite {f.page + 1}</span>
              <button className="btn btn-sm" disabled={!data.hasMore} onClick={() => set({ page: f.page + 1 })}>Weiter</button>
            </div>
          </div>
          <div className="stack">
            <div className="card stack">
              <div className="card-head"><h3>Scouting-Netzwerk</h3></div>
              <p className="dim small">Auf dem Markt erscheinen Spieler aus Ligen, die detailliert simuliert werden: dein Heimatland und Ligen im Netzwerk. Vereine anderer Ligen kannst du über die Tabellen öffnen.</p>
              <div className="row-wrap">{data.activeCountries.map((c: string) => <span key={c} className="badge">{data.countries.find((x: any) => x.code === c)?.name}</span>)}</div>
              {data.scoutingNetwork ? (
                <div className="row">
                  <select className="select" value={scoutCountry} onChange={(e) => setScoutCountry(e.target.value)} style={{ flex: 1 }} aria-label="Land">
                    <option value="">Land hinzufügen …</option>
                    {data.countries.filter((c: any) => !data.activeCountries.includes(c.code)).sort((a: any, b: any) => b.strength - a.strength).map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                  <button className="btn btn-primary" onClick={activate} disabled={!scoutCountry}>Scouten</button>
                </div>
              ) : <span className="badge badge-blue" style={{ whiteSpace: "normal" }}>Freischaltung mit Manager-Level 5</span>}
            </div>
            <div className="card stack-sm">
              <div className="card-head"><h3>Verhandlungen</h3></div>
              {data.transfers.length === 0 && <p className="faint small">Noch keine Angebote in dieser Saison.</p>}
              {data.transfers.slice(0, 12).map((t: any) => (
                <div key={t.id} className="between small">
                  <span className="truncate row" style={{ gap: 6 }}><span className="faint" style={{ display: "inline-flex" }}><Icon name={t.kind === "offer_in" ? "down" : "up"} size={13} /></span>{t.player_name}</span>
                  <span className={`badge ${t.status === "completed" ? "badge-accent" : t.status === "rejected" || t.status === "expired" ? "badge-danger" : "badge-warn"}`}>
                    {({ completed: "abgeschlossen", rejected: "abgelehnt", countered: "Gegenangebot", pending: "offen", expired: "abgelaufen" } as any)[t.status] ?? t.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
