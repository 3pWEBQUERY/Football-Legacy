/**
 * Spielerstatus im Stil des Manager-Spiels: kleine Symbole für Verletzung,
 * Sperre, Gelbe Karten (inkl. drohender Gelbsperre), Erschöpfung,
 * Länderspielreise und Unzufriedenheit – auf der Taktiktafel und in Listen.
 */
import { dayIso, fmtDate } from "@/lib/client/format";

export type StatusKind = "injury" | "susp" | "ban-risk" | "yellow" | "tired" | "away" | "unhappy";
export interface StatusBadge { kind: StatusKind; text: string; count?: number }

/** Ab der fünften Gelben Karte (und jeder weiteren fünften) folgt ein Spiel Sperre. */
const YELLOW_LIMIT = 5;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function playerStatus(p: any): StatusBadge[] {
  if (!p) return [];
  const out: StatusBadge[] = [];
  if (p.injuryWeeks > 0) {
    out.push({ kind: "injury", text: `Verletzt: ${p.injury?.name ?? "Verletzung"} – fällt noch ${plural(p.injuryWeeks, "Woche", "Wochen")} aus` });
  }
  if (p.suspendedWeeks > 0) {
    out.push({ kind: "susp", text: `Gesperrt – noch ${plural(p.suspendedWeeks, "Spiel", "Spiele")}`, count: p.suspendedWeeks });
  }
  const yellow = p.stats?.yellow ?? 0;
  if (yellow > 0 && p.suspendedWeeks === 0) {
    if (yellow % YELLOW_LIMIT === YELLOW_LIMIT - 1) out.push({ kind: "ban-risk", text: `${yellow} Gelbe Karten – bei der nächsten Gelben ein Spiel gesperrt`, count: yellow });
    else out.push({ kind: "yellow", text: `${plural(yellow, "Gelbe Karte", "Gelbe Karten")} in dieser Saison (Sperre nach jeder ${YELLOW_LIMIT}.)`, count: yellow });
  }
  if (p.away) out.push({ kind: "away", text: `Bei der Nationalmannschaft – zurück am ${fmtDate(dayIso(p.away.season, p.away.until + 1))}` });
  if (p.injuryWeeks === 0 && typeof p.fitness === "number" && p.fitness < 75) out.push({ kind: "tired", text: `Erschöpft – Kondition ${Math.round(p.fitness)} %` });
  if (typeof p.morale === "number" && p.morale < 35) out.push({ kind: "unhappy", text: `Unzufrieden – Moral ${Math.round(p.morale)}` });
  return out;
}

/** Nicht einsatzfähig (verletzt, gesperrt oder auf Länderspielreise)? */
export function unavailable(p: any) {
  return !!p && (p.injuryWeeks > 0 || p.suspendedWeeks > 0 || !!p.away);
}

function Glyph({ b }: { b: StatusBadge }) {
  switch (b.kind) {
    case "injury":
      return <svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="3" fill="#e5484d" /><path d="M6.4 3.5h3.2v2.9h2.9v3.2H9.6v2.9H6.4V9.6H3.5V6.4h2.9z" fill="#fff" /></svg>;
    case "susp":
      return <svg viewBox="0 0 16 16"><rect x="3.5" y="1" width="9" height="14" rx="1.6" fill="#e5484d" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" transform="rotate(8 8 8)" /></svg>;
    case "ban-risk":
    case "yellow":
      return (
        <svg viewBox="0 0 16 16">
          <rect x="3.5" y="1" width="9" height="14" rx="1.6" fill="#f5c518" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" transform="rotate(8 8 8)" />
          <text x="8.4" y="11.3" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#1b1b1b" fontFamily="var(--font-cond)">{b.kind === "ban-risk" ? "!" : b.count}</text>
        </svg>
      );
    case "tired":
      return <svg viewBox="0 0 16 16"><rect x="1" y="4" width="12" height="8" rx="1.6" fill="none" stroke="#f59e0b" strokeWidth="1.6" /><rect x="13.4" y="6.3" width="1.8" height="3.4" rx="0.6" fill="#f59e0b" /><rect x="2.8" y="5.8" width="3" height="4.4" rx="0.6" fill="#f59e0b" /></svg>;
    case "away":
      return <svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="3" fill="#3b82f6" /><path d="M5 12.5V3.5M5 4h6.2l-1.4 2.2L11.2 8.4H5" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
    case "unhappy":
      return <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#f59e0b" /><circle cx="5.6" cy="6.3" r="1" fill="#1b1b1b" /><circle cx="10.4" cy="6.3" r="1" fill="#1b1b1b" /><path d="M5 11.6c1.7-1.6 4.3-1.6 6 0" fill="none" stroke="#1b1b1b" strokeWidth="1.3" strokeLinecap="round" /></svg>;
  }
}

/** Reihe der Statussymbole; `vertical` stapelt sie (Taktiktafel). */
export function StatusIcons({ badges, vertical, max = 4 }: { badges: StatusBadge[]; vertical?: boolean; max?: number }) {
  if (!badges.length) return null;
  return (
    <span className={`pstatus ${vertical ? "vertical" : ""}`}>
      {badges.slice(0, max).map((b) => (
        <span key={b.kind} className={`pstatus-i k-${b.kind}`} title={b.text} role="img" aria-label={b.text}><Glyph b={b} /></span>
      ))}
    </span>
  );
}
