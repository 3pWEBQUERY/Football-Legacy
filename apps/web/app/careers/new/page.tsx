"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { Crest, Icon, Loading, Rating, useToast } from "@/components/ui";

const CONFED_LABEL: Record<string, string> = { UEFA: "Europa", CONMEBOL: "Südamerika", CONCACAF: "Nord- & Mittelamerika", AFC: "Asien & Australien", CAF: "Afrika", OFC: "Ozeanien" };

export default function NewCareer() {
  const router = useRouter();
  const toast = useToast();
  const world = useApi<{ countries: any[] }>("world");
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [country, setCountry] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState<any[] | null>(null);
  const [club, setClub] = useState<any | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!country) return;
    setPreview(null);
    setClub(null);
    api(`world/preview?country=${country}&seed=${seed}`).then(setPreview).catch((e) => toast(e.message, "error"));
  }, [country, seed, toast]);

  const grouped = useMemo(() => {
    const list = (world.data?.countries ?? []).filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));
    const g: Record<string, any[]> = {};
    for (const c of list) (g[c.confed] ??= []).push(c);
    for (const k of Object.keys(g)) g[k].sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
    return g;
  }, [world.data, filter]);

  async function create() {
    if (!country || !club) return;
    setBusy(true);
    try {
      const res = await api<{ id: string }>("careers", { body: { managerName: name || "Manager", countryCode: country, clubIndex: club.index, seed } });
      router.push(`/c/${res.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  }

  const countryInfo = world.data?.countries.find((c) => c.code === country);

  return (
    <div className="content" style={{ maxWidth: 1200 }}>
      <div className="page-head">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push("/careers")}><Icon name="back" size={16} /> Zurück</button>
          <h1 style={{ marginTop: 8 }}>Neue Karriere</h1>
          <p>Du startest als Co-Trainer, der kurzfristig die Mannschaft übernimmt. Wähle ein Land und einen Verein.</p>
        </div>
      </div>
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="card stack">
          <div className="between">
            <h3>1. Land wählen</h3>
            <input className="input" placeholder="Land suchen …" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 220 }} />
          </div>
          {world.loading && <Loading lines={3} />}
          {Object.entries(grouped).map(([confed, list]) => (
            <div key={confed} className="stack-sm">
              <div className="faint small" style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{CONFED_LABEL[confed] ?? confed}</div>
              <div className="row-wrap">
                {list.map((c) => (
                  <button key={c.code} className={`btn btn-sm ${country === c.code ? "btn-primary" : ""}`} onClick={() => setCountry(c.code)} title={`Stärke ${c.strength}/10 · ${c.tiers} Liga(en)`}>
                    <span>{c.flag}</span> {c.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="stack" style={{ position: "sticky", top: 16 }}>
          <div className="card stack">
            <h3>2. Verein wählen {countryInfo && <span className="dim">· {countryInfo.flag} {countryInfo.name}</span>}</h3>
            {!country && <p className="dim">Wähle links ein Land.</p>}
            {country && !preview && <Loading lines={3} />}
            {preview?.map((league) => (
              <div key={league.key} className="stack-sm">
                <div className="between"><strong>{league.name}</strong><span className="badge">Stufe {league.tier} · {league.size} Vereine</span></div>
                <div className="stack-sm" style={{ maxHeight: 260, overflowY: "auto" }}>
                  {league.clubs.map((c: any) => (
                    <button key={c.index} className="card-soft row" style={{ cursor: "pointer", textAlign: "left", borderColor: club?.index === c.index ? "var(--accent)" : undefined }} onClick={() => setClub(c)}>
                      <Crest colors={c.colors} name={c.name} size={24} />
                      <span className="truncate" style={{ flex: 1 }}>{c.name}</span>
                      <span className="faint small">Erw. Platz {c.expected}</span>
                      <Rating value={c.rating} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="card stack">
            <h3>3. Dein Name</h3>
            <input className="input" placeholder="Name des Managers" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            {club && (
              <div className="card-soft row">
                <Crest colors={club.colors} name={club.name} size={36} />
                <div>
                  <strong>{club.name}</strong>
                  <div className="dim small">Stärke {club.rating} · {club.capacity.toLocaleString("de-CH")} Plätze · erwarteter Platz {club.expected}</div>
                </div>
              </div>
            )}
            <button className="btn btn-primary btn-lg" disabled={!club || busy} onClick={create}>
              {busy ? "Die Welt wird erschaffen …" : "Karriere starten"}
            </button>
            {busy && <p className="faint small">155 Länder, über 3000 Vereine und tausende Spieler werden erzeugt. Das dauert nur einen Moment.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
