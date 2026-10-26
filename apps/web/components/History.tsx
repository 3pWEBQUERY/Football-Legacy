"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { money, seasonLabel } from "@/lib/client/format";
import { Icon, Nat, Pos } from "./ui";

/** Bausteine für Vereinsgeschichte und Ruhmeshalle. */

const TROPHY_TONE: Record<string, string> = { league: "gold", continental: "gold", cup: "silver", lower: "silver", promotion: "bronze" };

export function TrophyShelf({ items, empty }: { items: { season: number; kind: string; title: string; club?: string }[]; empty: string }) {
  if (!items.length) return <p className="faint small">{empty}</p>;
  return (
    <div className="trophy-shelf">
      {items.map((t, i) => (
        <div key={i} className={`trophy t-${TROPHY_TONE[t.kind] ?? "bronze"}`} title={`${t.title} ${seasonLabel(t.season)}${t.club ? ` mit ${t.club}` : ""}`}>
          <span className="trophy-icon"><Icon name={t.kind === "promotion" ? "up" : "trophy"} size={18} /></span>
          <span className="trophy-text"><b>{t.title}</b><small>{seasonLabel(t.season)}{t.club ? ` · ${t.club}` : ""}</small></span>
        </div>
      ))}
    </div>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <div className="hist-kpi"><span className="label">{label}</span><span className="value">{value}</span>{sub && <span className="faint small">{sub}</span>}</div>;
}

export interface RecordRow { playerId: number; name: string; position: string; nationality: string; apps: number; goals: number; assists: number; seasons: number; current?: boolean; retired?: number | null }

/** Rangliste mit Platz, Name und hervorgehobenem Wert. */
export function RecordList({ title, rows, value, unit, base }: { title: string; rows: RecordRow[]; value: (r: RecordRow) => number; unit: string; base: string }) {
  return (
    <div className="record-list">
      <div className="record-head">{title}</div>
      {rows.length === 0 && <p className="faint small" style={{ padding: "8px 12px" }}>Noch keine Einträge.</p>}
      <ol>
        {rows.map((r, i) => (
          <li key={r.playerId}>
            <span className="rank cond">{i + 1}</span>
            <Pos p={r.position} />
            <Nat code={r.nationality} />
            <Link href={`${base}/player/${r.playerId}`} className="name truncate">{r.name}</Link>
            {r.current ? <span className="badge badge-accent" title="Steht im aktuellen Kader">aktiv</span> : r.retired ? <span className="badge" title={`Karriereende ${seasonLabel(r.retired)}`}>a. D.</span> : null}
            <b className="cond val">{value(r)}<small> {unit}</small></b>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function MatchMarks({ title, rows, tone }: { title: string; rows: { season: number; oppName: string; gf: number; ga: number; home: boolean; competition: string }[]; tone: "pos" | "neg" }) {
  return (
    <div className="record-list">
      <div className="record-head">{title}</div>
      {rows.length === 0 && <p className="faint small" style={{ padding: "8px 12px" }}>Noch keine Einträge.</p>}
      <ol>
        {rows.map((m, i) => (
          <li key={i}>
            <span className={`score cond ${tone}-text`}>{m.gf}:{m.ga}</span>
            <span className="truncate" style={{ flex: 1 }}>{m.home ? "gegen" : "bei"} <b>{m.oppName}</b></span>
            <span className="faint small nowrap">{m.competition} · {seasonLabel(m.season)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TransferRecords({ title, rows, base }: { title: string; rows: { player_id: number; player_name: string; fee: number; season: number; other: string | null }[]; base: string }) {
  return (
    <div className="record-list">
      <div className="record-head">{title}</div>
      {rows.length === 0 && <p className="faint small" style={{ padding: "8px 12px" }}>Noch keine Transfers mit Ablöse.</p>}
      <ol>
        {rows.map((t, i) => (
          <li key={i}>
            <span className="rank cond">{i + 1}</span>
            <Link href={`${base}/player/${t.player_id}`} className="name truncate">{t.player_name}</Link>
            <span className="faint small truncate">{t.other ?? "–"} · {seasonLabel(t.season)}</span>
            <b className="cond val">{money(t.fee)}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LegendCard({ l, base, sub }: { l: RecordRow & { avgRating?: number | null; firstSeason?: number; lastSeason?: number; club?: string | null; clubs?: number; peak?: number }; base: string; sub?: string }) {
  return (
    <Link href={`${base}/player/${l.playerId}`} className="legend-card">
      <span className="legend-star"><Icon name="star" size={16} /></span>
      <span className="legend-body">
        <span className="row" style={{ gap: 6 }}><Pos p={l.position} /><Nat code={l.nationality} /><b className="truncate">{l.name}</b></span>
        <span className="faint small">{sub ?? (l.firstSeason ? `${seasonLabel(l.firstSeason)} – ${l.current ? "heute" : seasonLabel(l.lastSeason!)}` : "")}</span>
        <span className="legend-stats">
          <span><b>{l.apps}</b> Spiele</span><span><b>{l.goals}</b> Tore</span><span><b>{l.assists}</b> Vorl.</span>
          {l.avgRating ? <span><b>{l.avgRating.toFixed(1)}</b> Ø</span> : l.peak ? <span><b>{l.peak}</b> Top-Stärke</span> : null}
        </span>
      </span>
      {l.current ? <span className="badge badge-accent">aktiv</span> : l.retired ? <span className="badge">Ruhestand</span> : null}
    </Link>
  );
}
