"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { ErrorBox, Icon, Loading, Nat, Pos, Rating, useToast } from "@/components/ui";
import { PlayerFace } from "@/components/PlayerFace";
import { Select } from "@/components/Select";
import { Stars } from "@/components/PitchBoard";
import { NegotiationModal, type NegotiationTarget } from "@/components/Negotiation";

const POS_OPTIONS = [
  { value: "", label: "Alle Positionen" }, { value: "GK", label: "Torwart" }, { value: "DR", label: "Rechter Verteidiger" }, { value: "DC", label: "Innenverteidiger" },
  { value: "DL", label: "Linker Verteidiger" }, { value: "DM", label: "Defensives Mittelfeld" }, { value: "MR", label: "Rechtes Mittelfeld" }, { value: "MC", label: "Zentrales Mittelfeld" },
  { value: "ML", label: "Linkes Mittelfeld" }, { value: "AMR", label: "Rechtsaussen" }, { value: "AMC", label: "Offensives Mittelfeld" }, { value: "AML", label: "Linksaussen" }, { value: "ST", label: "Stürmer" },
];
const SORT_OPTIONS = [
  { value: "rating", label: "Stärke" }, { value: "potential", label: "Potenzial" }, { value: "value", label: "Marktwert" },
  { value: "wage", label: "Gehalt" }, { value: "contract", label: "Vertragsende" }, { value: "age", label: "Alter (jüngste)" },
];
const AGE_OPTIONS = [
  { value: "", label: "Jedes Alter" }, { value: "-21", label: "bis 21" }, { value: "-23", label: "bis 23" }, { value: "24-29", label: "24–29" }, { value: "30-", label: "ab 30" },
];
const VALUE_OPTIONS = [
  { value: "", label: "Jeder Marktwert" }, { value: "500000", label: "bis 500k €" }, { value: "1000000", label: "bis 1 Mio. €" }, { value: "3000000", label: "bis 3 Mio. €" },
  { value: "10000000", label: "bis 10 Mio. €" }, { value: "30000000", label: "bis 30 Mio. €" }, { value: "budget", label: "Innerhalb Budget" },
];
const CHIPS = [
  { key: "free", label: "Vereinslos" }, { key: "listed", label: "Transferliste" }, { key: "expiring", label: "Vertrag läuft aus" }, { key: "shortlist", label: "Beobachtet" },
] as const;
const NEG_LABEL: Record<string, string> = { pending: "Angebot offen", countered: "Gegenangebot", rejected: "Abgelehnt", open: "Vertragsgespräche" };

type Chip = (typeof CHIPS)[number]["key"];

export default function MarketSearch() {
  const { id } = useGame();
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [position, setPosition] = useState("");
  const [age, setAge] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [sort, setSort] = useState("rating");
  const [chips, setChips] = useState<Set<Chip>>(new Set());
  const [page, setPage] = useState(0);
  const [neg, setNeg] = useState<{ target: NegotiationTarget; id: number | null } | null>(null);
  const [scoutCountry, setScoutCountry] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(0), [debounced, position, age, maxValue, sort, chips]);

  const { data: hub } = useApi<any>(`careers/${id}/transfers`);
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set("q", debounced);
    if (position) p.set("position", position);
    if (age) {
      const [a, b] = age.split("-");
      if (a) p.set("minAge", a);
      if (b) p.set("maxAge", b);
    }
    if (maxValue) p.set("maxValue", maxValue === "budget" ? String(hub?.budget.transfer ?? 0) : maxValue);
    for (const c of chips) p.set(c, "1");
    p.set("sort", sort);
    p.set("page", String(page));
    return p.toString();
  }, [debounced, position, age, maxValue, sort, chips, page, hub]);
  const { data, error, reload } = useApi<any>(`careers/${id}/market?${query}`);

  const toggle = (c: Chip) => setChips((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const open = (p: any) => setNeg({
    id: null,
    target: { id: p.id, name: p.name, position: p.position, age: p.age, free: p.clubId === null, club: p.clubName ? { name: p.clubName, colors: p.kit } : null, value: p.value },
  });

  async function openNegotiation(p: any) {
    // Forderung und laufende Verhandlung aus dem Spielerprofil
    try {
      const d = await api<any>(`careers/${id}/players/${p.id}`);
      const active = d.negotiation && ["club", "contract"].includes(d.negotiation.stage) ? d.negotiation.id : null;
      setNeg({ id: active, target: { id: p.id, name: p.name, position: p.position, age: p.age, free: p.clubId === null, club: d.club ? { name: d.club.name, colors: d.club.colors } : null, askingPrice: d.askingPrice, value: p.value, releaseClause: p.contract?.releaseClause ?? null } });
    } catch {
      open(p);
    }
  }

  async function activate() {
    if (!scoutCountry) return;
    try {
      const r = await api<any>(`careers/${id}/scouting`, { body: { countryCode: scoutCountry } });
      toast(r.message, "success");
      setScoutCountry("");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const season = data?.career.season;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Spielersuche</h1>
          <p>{hub ? <><span className={`badge ${hub.window.open ? "badge-accent" : "badge-danger"}`}>{hub.window.label}</span> · Transferbudget <b>{money(hub.budget.transfer)}</b> · Gehälter {money(hub.budget.wageBill)} / {money(hub.budget.wage)}</> : " "}</p>
        </div>
      </div>

      <div className="card search-filters">
        <div className="search-row">
          <div className="search-input">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Spieler suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Name" />
          </div>
          <Select label="Position" value={position} options={POS_OPTIONS} onChange={setPosition} width={200} menuWidth={240} />
          <Select label="Alter" value={age} options={AGE_OPTIONS} onChange={setAge} width={140} />
          <Select label="Marktwert" value={maxValue} options={VALUE_OPTIONS} onChange={setMaxValue} width={170} menuWidth={200} />
          <Select label="Sortierung" value={sort} options={SORT_OPTIONS} onChange={setSort} width={170} suffix="Sortierung" menuWidth={200} />
        </div>
        <div className="inbox-filters search-chips" role="group" aria-label="Schnellfilter">
          {CHIPS.map((c) => (
            <button key={c.key} type="button" aria-pressed={chips.has(c.key)} className={`inbox-filter ${chips.has(c.key) ? "active" : ""}`} onClick={() => toggle(c.key)}>
              {chips.has(c.key) && <Icon name="check" size={12} />}{c.label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBox message={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="card card-flush">
          <div className="table-wrap">
            <table className="table search-table">
              <thead>
                <tr>
                  <th>Pos</th><th>Name</th><th className="hide-sm">Nat</th><th className="c">Alter</th><th>Stärke</th><th className="hide-sm">Potenzial</th>
                  <th className="hide-sm">Verein</th><th className="c hide-sm">Vertrag</th><th className="r hide-sm">Gehalt</th><th className="r hide-sm">Wert</th><th className="r"><span className="sr-only">Aktion</span></th>
                </tr>
              </thead>
              <tbody>
                {data.players.map((p: any) => (
                  <tr key={p.id} className="clickable" onClick={() => router.push(`/c/${id}/player/${p.id}`)}>
                    <td><Pos p={p.position} /></td>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <PlayerFace player={p} kit={p.kit} size={28} />
                        <span style={{ minWidth: 0 }}>
                          <span className="name">{p.name}</span>
                          <span className="search-tags">
                            {p.shortlisted && <span className="tag-eye" title="Beobachtet"><Icon name="eye" size={12} /></span>}
                            {p.listed && <span className="badge badge-blue">Transferliste</span>}
                            {p.negotiation && <span className="badge badge-warn">{NEG_LABEL[p.negotiation.status] ?? "Verhandlung"}</span>}
                            {p.loan && <span className="badge">Leihe</span>}
                            <span className="search-value-sm">{money(p.value)}</span>
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="hide-sm"><Nat code={p.nationality} /></td>
                    <td className="c">{p.age}</td>
                    <td>
                      <span className="search-stars" title={p.stars?.exact ? "Gescoutet" : "Ungefähre Einschätzung"}>
                        {p.stars && <span className={p.stars.exact ? "" : "rough"}><Stars value={p.stars.current} /></span>}
                        <Rating value={p.rating} range={p.ratingRange} />
                      </span>
                    </td>
                    <td className="hide-sm">{p.stars?.potential ? <Stars value={p.stars.potential} /> : <span className="faint small">scouten</span>}</td>
                    <td className="small dim truncate hide-sm" style={{ maxWidth: 190 }}>{p.clubName ?? <span className="badge badge-accent">vereinslos</span>}</td>
                    <td className="c small hide-sm">{p.contract ? <span className={p.contract.untilSeason <= season ? "warn-text" : ""}>{p.contract.untilSeason + 1}</span> : "–"}</td>
                    <td className="r num small hide-sm">{p.contract ? money(p.contract.wage) : "–"}</td>
                    <td className="r num hide-sm">{money(p.value)}</td>
                    <td className="r" onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-sm" disabled={!!p.loan || (p.clubId !== null && !hub?.window.open)} onClick={() => openNegotiation(p)}
                        title={p.clubId !== null && !hub?.window.open ? "Transferfenster geschlossen" : p.clubId === null ? "Vertrag anbieten" : "Angebot abgeben"}>
                        <Icon name={p.clubId === null ? "contract" : "transfer"} size={14} /><span className="hide-sm">{p.negotiation ? "Verhandlung" : p.clubId === null ? "Vertrag" : "Angebot"}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.players.length === 0 && <div className="empty">Keine Spieler gefunden.</div>}
          <div className="between" style={{ padding: 12 }}>
            <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Zurück</button>
            <span className="faint small">Seite {page + 1}</span>
            <button className="btn btn-sm" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>Weiter</button>
          </div>
        </div>
      )}

      {data && (
        <div className="card stack-sm">
          <div className="card-head"><h3><Icon name="flag" size={15} /> Scouting-Netzwerk</h3></div>
          <p className="dim small">In der Suche erscheinen Spieler aus Ländern, die detailliert simuliert werden. Mit dem Netzwerk fügst du weitere Länder hinzu.</p>
          <div className="row-wrap">{data.activeCountries.map((c: string) => <span key={c} className="badge">{data.countries.find((x: any) => x.code === c)?.name}</span>)}</div>
          {data.scoutingNetwork ? (
            <div className="row-wrap">
              <Select label="Land" value={scoutCountry} placeholder="Land hinzufügen …" width={240} onChange={setScoutCountry}
                options={data.countries.filter((c: any) => !data.activeCountries.includes(c.code)).sort((a: any, b: any) => b.strength - a.strength).map((c: any) => ({ value: c.code, label: c.name }))} />
              <button className="btn btn-primary" onClick={activate} disabled={!scoutCountry}>Scouten</button>
            </div>
          ) : <span className="badge badge-blue" style={{ whiteSpace: "normal" }}>Freischaltung mit Manager-Level 5</span>}
        </div>
      )}

      {neg && <NegotiationModal careerId={id} target={neg.target} negotiationId={neg.id} onClose={() => setNeg(null)} onChanged={reload} />}
    </>
  );
}
