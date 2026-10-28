"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtDate, money } from "@/lib/client/format";
import { Crest, Icon, Nat, Pos } from "./ui";
import { PlayerFace } from "./PlayerFace";

type Club = { id: number; name: string; short: string; colors: { primary: string; secondary: string }; own: boolean } | null;
export interface WorldItem {
  id: number;
  kind: "match" | "league" | "transfer" | "rumour" | "interview";
  type: "transfer" | "loan" | "interest" | "unrest" | null;
  label: string;
  title: string;
  body: string;
  own: boolean;
  importance: number;
  date: string;
  fee: number | null;
  from: Club;
  to: Club;
  club: Club;
  player: { id: number; name: string; age: number; nationality: string; position: string; value: number; kit: { primary: string; secondary: string } | null } | null;
}
export interface WorldNewsData { total: number; latestId: number; items: WorldItem[] }

type Filter = "all" | "transfers" | "rumours" | "matches" | "own";
const FILTERS: { value: Filter; label: string; test: (i: WorldItem) => boolean }[] = [
  { value: "all", label: "Alle", test: () => true },
  { value: "transfers", label: "Transfers", test: (i) => i.kind === "transfer" },
  { value: "rumours", label: "Gerüchte", test: (i) => i.kind === "rumour" },
  { value: "matches", label: "Spiele & Ligen", test: (i) => i.kind === "match" || i.kind === "league" || i.kind === "interview" },
  { value: "own", label: "Dein Verein", test: (i) => i.own },
];
const AUTO_KEY = "fl-worldnews-auto";

export function worldNewsAuto(): boolean {
  try { return localStorage.getItem(AUTO_KEY) !== "off"; } catch { return true; }
}

/** „Neuigkeiten aus aller Welt“ nach dem Weiterklicken – wie die Nachrichtenübersicht im Football Manager. */
export function WorldNewsView({ data, base, onClose }: { data: WorldNewsData; base: string; onClose: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [auto, setAuto] = useState(worldNewsAuto);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, data.items.filter(f.test).length])), [data.items]);
  const items = data.items.filter(FILTERS.find((f) => f.value === filter)!.test);
  // Aufmacher: wichtigste Meldung (eigener Verein zuerst), sonst die neueste
  const lead = [...items].sort((a, b) => b.importance + (b.own ? 0.5 : 0) - (a.importance + (a.own ? 0.5 : 0)) || b.id - a.id)[0];
  const rest = items.filter((i) => i !== lead);
  const dates = data.items.map((i) => i.date).sort();
  const span = dates.length ? (dates[0] === dates[dates.length - 1] ? fmtDate(dates[0], { year: false }) : `${fmtDate(dates[0], { year: false })} – ${fmtDate(dates[dates.length - 1], { year: false })}`) : "";

  function toggleAuto(v: boolean) {
    setAuto(v);
    try { localStorage.setItem(AUTO_KEY, v ? "on" : "off"); } catch { /* nur Komfort */ }
  }

  return (
    <div className="wn" aria-labelledby="wn-title">
      <header className="wn-head">
        <div className="wn-heading">
          <span className="wn-icon"><Icon name="news" size={20} /></span>
          <div>
            <h2 id="wn-title">Neuigkeiten aus aller Welt</h2>
            <p>{data.total} {data.total === 1 ? "neue Meldung" : "neue Meldungen"}{span && <> · {span}</>}</p>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm wn-close" onClick={onClose} aria-label="Schliessen"><Icon name="close" size={16} /></button>
      </header>
      <nav className="wn-filter" aria-label="Meldungen filtern">
        {FILTERS.filter((f) => f.value === "all" || counts[f.value] > 0).map((f) => (
          <button key={f.value} className={filter === f.value ? "active" : ""} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label} <span className="wn-count">{counts[f.value]}</span>
          </button>
        ))}
      </nav>

      <div className="wn-body">
        {lead && <Story item={lead} base={base} lead onNavigate={onClose} />}
        {rest.length > 0 && <div className="wn-grid">{rest.map((i) => <Story key={i.id} item={i} base={base} onNavigate={onClose} />)}</div>}
        {data.total > data.items.length && <p className="faint small wn-more">Ältere Meldungen findest du im Medienbereich.</p>}
      </div>

      <footer className="wn-foot">
        <label className="row small dim" style={{ gap: 8 }}>
          <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} />
          Nach „Weiter“ automatisch anzeigen
        </label>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn-ghost btn-sm" href={`${base}/media`} onClick={onClose}>Medienbereich</Link>
          <button className="btn btn-primary" onClick={onClose} autoFocus>Weiter</button>
        </div>
      </footer>
    </div>
  );
}

function Story({ item: i, base, lead = false, onNavigate }: { item: WorldItem; base: string; lead?: boolean; onNavigate: () => void }) {
  const p = i.player;
  return (
    <article className={`wn-story ${lead ? "lead" : ""} ${i.own ? "own" : ""} t-${i.type ?? i.kind}`}>
      <Visual item={i} lead={lead} />
      <div className="wn-copy">
        <p className="wn-kicker">
          <span className="wn-label">{i.label}</span>
          <span>{fmtDate(i.date, { year: false })}</span>
          {i.own && <span className="badge badge-accent">Dein Verein</span>}
        </p>
        <h3>{i.title}</h3>
        {i.body !== i.title && <p className="wn-text">{i.body}</p>}
        {p && (
          <div className="wn-facts">
            <Pos p={p.position} />
            <span>{`${p.age} Jahre`}</span>
            <Nat code={p.nationality} />
            <span title="Marktwert">{money(p.value)}</span>
            {i.fee !== null && i.type === "transfer" && <span className="wn-fee">{i.fee ? `Ablöse ${money(i.fee)}` : "ablösefrei"}</span>}
          </div>
        )}
        <div className="wn-links">
          {p && <Link href={`${base}/player/${p.id}`} onClick={onNavigate}>Profil ansehen</Link>}
          {(i.to ?? i.club) && <Link href={`${base}/club/${(i.to ?? i.club)!.id}`} onClick={onNavigate}>{(i.to ?? i.club)!.name}</Link>}
        </div>
      </div>
    </article>
  );
}

/** Bildteil: Spielergesicht mit Vereinswappen (Wechsel: abgebend → aufnehmend). */
function Visual({ item: i, lead }: { item: WorldItem; lead: boolean }) {
  const p = i.player;
  const a = i.from ?? i.club;
  const b = i.to;
  const bg = { "--c1": (a ?? b)?.colors.primary ?? "var(--panel-h)", "--c2": (b ?? a)?.colors.primary ?? "var(--panel-h)" } as React.CSSProperties;
  const crest = lead ? 44 : 32;
  const icon = i.type === "interest" ? "eye" : i.type === "unrest" ? "fire" : i.type === "loan" ? "swap" : i.kind === "match" ? "ball" : i.kind === "interview" ? "mail" : i.kind === "league" ? "trophy" : "transfer";
  return (
    <div className="wn-visual" style={bg} aria-hidden="true">
      {p ? (
        <>
          {a && <span className="wn-crest left"><Crest colors={a.colors} name={a.name} size={crest} /></span>}
          <PlayerFace player={p} kit={p.kit} size={lead ? 132 : 84} className="wn-face" />
          {b && b.id !== a?.id && (
            <span className="wn-crest right">
              <span className="wn-arrow"><Icon name={i.type === "interest" ? "eye" : "next"} size={14} stroke={2.4} /></span>
              <Crest colors={b.colors} name={b.name} size={crest} />
            </span>
          )}
        </>
      ) : a ? (
        <span className="wn-crest center"><Crest colors={a.colors} name={a.name} size={lead ? 84 : 56} /></span>
      ) : (
        <span className="wn-glyph"><Icon name={icon} size={lead ? 40 : 28} /></span>
      )}
      <span className="wn-tag"><Icon name={icon} size={12} /> {i.label}</span>
    </div>
  );
}
