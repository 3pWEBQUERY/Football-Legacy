"use client";
import Link from "next/link";
import { fmtDate } from "@/lib/client/format";
import { NationBadge } from "./NationBadge";

/** Zeile eines Länderspiels (Datum, Wettbewerb, Paarung, Ergebnis). */
export function MatchRow({ m, own, base }: { m: any; own: string; base: string }) {
  const res = m.played ? `${m.homeGoals}:${m.awayGoals}${m.penHome !== null ? ` (${m.penHome}:${m.penAway} i. E.)` : ""}` : "–:–";
  const mine = m.home.code === own ? 0 : 1;
  const gf = mine === 0 ? m.homeGoals : m.awayGoals;
  const ga = mine === 0 ? m.awayGoals : m.homeGoals;
  const tone = !m.played ? "" : gf > ga || (gf === ga && m.penHome !== null && (mine === 0 ? m.penHome > m.penAway : m.penAway > m.penHome)) ? "pos" : gf === ga && m.penHome === null ? "" : "neg";
  return (
    <div className="nat-match">
      <span className="faint small nowrap" style={{ width: 64 }}>{fmtDate(m.date, { year: false })}</span>
      <span className="faint small truncate" style={{ width: 170 }}>{m.stage.replace(/^Qualifikation .*/, "Qualifikation")}</span>
      <span className={`row truncate ${m.home.code === own ? "nat-own" : ""}`} style={{ flex: 1, justifyContent: "flex-end", gap: 6 }}>{m.home.name}<NationBadge code={m.home.code} colors={m.home.colors} size={16} /></span>
      <span className={`nat-score ${tone}`}>{res}</span>
      <span className={`row truncate ${m.away.code === own ? "nat-own" : ""}`} style={{ flex: 1, gap: 6 }}><NationBadge code={m.away.code} colors={m.away.colors} size={16} />{m.away.name}</span>
      <span style={{ width: 70, textAlign: "right" }}>{m.hasReport && <Link href={`${base}/national/matches?m=${m.id}`} className="small">Bericht</Link>}</span>
    </div>
  );
}

