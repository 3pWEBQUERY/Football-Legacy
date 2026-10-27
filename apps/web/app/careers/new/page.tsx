"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { Crest, Icon, Loading, Rating, useToast } from "@/components/ui";

const CONFED: Record<string, string> = { UEFA: "Europa", CONMEBOL: "Südamerika", CONCACAF: "Nord-/Mittelamerika", AFC: "Asien", CAF: "Afrika", OFC: "Ozeanien" };

export default function NewCareer() {
  const router = useRouter();
  const toast = useToast();
  const world = useApi<{ countries: any[] }>("world");
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [country, setCountry] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [confed, setConfed] = useState<string>("UEFA");
  const [preview, setPreview] = useState<any[] | null>(null);
  const [leagueKey, setLeagueKey] = useState<string | null>(null);
  const [club, setClub] = useState<any | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [own, setOwn] = useState(false);
  const [difficulty, setDifficulty] = useState("normal");
  const levels = useApi<Record<string, { label: string; text: string; legacy: number }>>("difficulties");
  const [custom, setCustom] = useState({ name: "", shortName: "", city: "", primary: "#1f4e9c", secondary: "#ffffff", founded: 2026, stadiumName: "" });

  useEffect(() => {
    if (!country) return;
    setPreview(null);
    setClub(null);
    api<any[]>(`world/preview?country=${country}&seed=${seed}`).then((p) => { setPreview(p); setLeagueKey(p[0]?.key ?? null); }).catch((e) => toast(e.message, "error"));
  }, [country, seed, toast]);

  const countries = useMemo(() => (world.data?.countries ?? [])
    .filter((c) => (filter ? c.name.toLowerCase().includes(filter.toLowerCase()) : c.confed === confed))
    .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name, "de")), [world.data, filter, confed]);

  async function create() {
    if (!country || !club) return;
    setBusy(true);
    try {
      const res = await api<{ id: string }>("careers", { body: { managerName: name || "Manager", countryCode: country, clubIndex: club.index, seed, custom: own ? custom : null, difficulty } });
      router.push(`/c/${res.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  }

  const league = preview?.find((l) => l.key === leagueKey);
  const countryInfo = world.data?.countries.find((c) => c.code === country);

  return (
    <div className="landing">
      <header className="landing-top">
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push("/careers")}><Icon name="back" size={15} /></button>
          <div className="brand-mark">FL</div>
          <div className="brand-name">Neue Karriere<small>Land und Verein wählen</small></div>
        </div>
        <div className="row">
          <input className="input" placeholder="Name des Managers" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} style={{ width: 220 }} aria-label="Name des Managers" />
          <button className="btn btn-primary" disabled={!club || busy} onClick={create}>{busy ? "Welt wird erstellt …" : "Karriere starten"}</button>
        </div>
      </header>
      <div className="content" style={{ maxWidth: 1400 }}>
        <div className="grid" style={{ gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.3fr)", alignItems: "start" }}>
          <section className="card card-flush">
            <div className="card-head">
              <h3><Icon name="flag" size={15} /> Land</h3>
              <input className="input" placeholder="Suchen …" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ height: 26, width: 160 }} aria-label="Land suchen" />
            </div>
            {!filter && (
              <div className="tabs" style={{ padding: "0 8px" }}>
                {Object.entries(CONFED).map(([k, v]) => <button key={k} className={`tab ${confed === k ? "active" : ""}`} onClick={() => setConfed(k)}>{v}</button>)}
              </div>
            )}
            {world.loading ? <div style={{ padding: 14 }}><Loading lines={3} /></div> : (
              <div style={{ maxHeight: 620, overflowY: "auto" }}>
                <table className="table">
                  <thead><tr><th>Land</th><th className="c">Niveau</th><th className="c">Ligen</th></tr></thead>
                  <tbody>
                    {countries.map((c) => (
                      <tr key={c.code} className={`clickable ${country === c.code ? "highlight" : ""}`} onClick={() => setCountry(c.code)}>
                        <td className="name">{c.name}</td>
                        <td className="c"><Stars value={c.strength} /></td>
                        <td className="c">{c.tiers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="stack">
            <section className="card card-flush">
              <div className="card-head"><h3><Icon name="trophy" size={15} /> Verein {countryInfo && <span className="faint">· {countryInfo.name}</span>}</h3></div>
              {!country && <div className="empty">Wähle links ein Land.</div>}
              {country && !preview && <div style={{ padding: 14 }}><Loading lines={3} /></div>}
              {preview && (
                <>
                  <div className="tabs" style={{ padding: "0 8px" }}>
                    {preview.map((l) => <button key={l.key} className={`tab ${leagueKey === l.key ? "active" : ""}`} onClick={() => setLeagueKey(l.key)}>{l.tier}. {l.name}</button>)}
                  </div>
                  <div style={{ maxHeight: 460, overflowY: "auto" }}>
                    <table className="table">
                      <thead><tr><th>Verein</th><th className="c">Stärke</th><th className="c">Erwartung</th><th className="r">Stadion</th></tr></thead>
                      <tbody>
                        {league?.clubs.map((c: any) => (
                          <tr key={c.index} className={`clickable ${club?.index === c.index ? "highlight" : ""}`} onClick={() => setClub(c)}>
                            <td><span className="row" style={{ gap: 8 }}><Crest colors={c.colors} name={c.name} size={18} /><span className="name">{c.name}</span></span></td>
                            <td className="c"><Rating value={c.rating} /></td>
                            <td className="c">{c.expected}.</td>
                            <td className="r">{c.capacity.toLocaleString("de-CH")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
            {club && (
              <section className="card" style={{ boxShadow: `inset 6px 0 0 ${club.colors.primary}` }}>
                <div className="row" style={{ gap: 14, paddingLeft: 6 }}>
                  <Crest colors={club.colors} name={club.name} size={52} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cond up" style={{ fontSize: 24, fontWeight: 700 }}>{club.name}</div>
                    <div className="dim small">{club.city} · {club.capacity.toLocaleString("de-CH")} Plätze · erwarteter Platz {club.expected}</div>
                  </div>
                  <button className="btn btn-primary btn-lg" disabled={busy || (own && (custom.name.trim().length < 3 || custom.shortName.trim().length < 2 || custom.city.trim().length < 2))} onClick={create}>{busy ? "Welt wird erstellt …" : own ? "Verein gründen" : "Übernehmen"}</button>
                </div>
                {levels.data && (
                  <div className="difficulty-pick" role="radiogroup" aria-label="Schwierigkeitsgrad">
                    {Object.entries(levels.data).map(([k, v]) => (
                      <button key={k} role="radio" aria-checked={difficulty === k} className={`difficulty-opt ${difficulty === k ? "active" : ""}`} onClick={() => setDifficulty(k)}>
                        <b>{v.label}</b><small>{v.text}</small>
                        {v.legacy !== 1 && <span className="faint">Vermächtnis ×{String(v.legacy).replace(".", ",")}</span>}
                      </button>
                    ))}
                  </div>
                )}
                <label className="row" style={{ gap: 8, marginTop: 14, paddingLeft: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
                  <span><b>Eigenen Verein gründen</b> <span className="dim small">– dein Verein übernimmt Ligaplatz, Kader und Stadion von {club.name}</span></span>
                </label>
                {own && (
                  <div className="custom-club">
                    <div className="row" style={{ gap: 12 }}>
                      <Crest colors={{ primary: custom.primary, secondary: custom.secondary }} name={custom.name || "Neu"} size={56} />
                      <div className="dim small">So sieht dein Wappen aus.</div>
                    </div>
                    <div className="custom-grid">
                      <div className="field"><label htmlFor="ccn">Vereinsname</label><input id="ccn" className="input" maxLength={40} placeholder="z. B. FC Seeblick" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} /></div>
                      <div className="field"><label htmlFor="ccs">Kürzel</label><input id="ccs" className="input" maxLength={4} placeholder="FCS" value={custom.shortName} onChange={(e) => setCustom({ ...custom, shortName: e.target.value.toUpperCase() })} /></div>
                      <div className="field"><label htmlFor="ccc">Stadt</label><input id="ccc" className="input" maxLength={40} placeholder={club.city} value={custom.city} onChange={(e) => setCustom({ ...custom, city: e.target.value })} /></div>
                      <div className="field"><label htmlFor="ccst">Stadion</label><input id="ccst" className="input" maxLength={40} placeholder={`${custom.city || club.city}-Arena`} value={custom.stadiumName} onChange={(e) => setCustom({ ...custom, stadiumName: e.target.value })} /></div>
                      <div className="field"><label htmlFor="ccf">Gründungsjahr</label><input id="ccf" className="input" type="number" min={1850} max={2026} value={custom.founded} onChange={(e) => setCustom({ ...custom, founded: Number(e.target.value) })} /></div>
                      <div className="row" style={{ gap: 12 }}>
                        <div className="field"><label htmlFor="ccp">Hauptfarbe</label><input id="ccp" type="color" className="color-input" value={custom.primary} onChange={(e) => setCustom({ ...custom, primary: e.target.value })} /></div>
                        <div className="field"><label htmlFor="ccz">Zweitfarbe</label><input id="ccz" type="color" className="color-input" value={custom.secondary} onChange={(e) => setCustom({ ...custom, secondary: e.target.value })} /></div>
                      </div>
                    </div>
                  </div>
                )}
                {busy && <p className="faint small" style={{ marginTop: 10 }}>155 Länder, über 3000 Vereine und tausende Spieler werden erzeugt.</p>}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stars({ value }: { value: number }) {
  const full = Math.round(value / 2);
  return (
    <span className="cond" style={{ letterSpacing: 1, fontWeight: 700, fontSize: 13 }} title={`Niveau ${value}/10`}>
      {Array.from({ length: 5 }).map((_, i) => <span key={i} style={{ color: i < full ? "var(--gold)" : "var(--line-2)" }}>■</span>)}
    </span>
  );
}
