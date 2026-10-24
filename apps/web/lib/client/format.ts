export function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toLocaleString("de-CH", { maximumFractionDigits: a >= 10_000_000 ? 1 : 2 })} Mio. €`;
  if (a >= 1_000) return `${sign}${Math.round(a / 1_000).toLocaleString("de-CH")}k €`;
  return `${sign}${Math.round(a)} €`;
}

export function int(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return Math.round(v).toLocaleString("de-CH");
}

export function ratingClass(r: number | null | undefined): string {
  if (r === null || r === undefined) return "r-3";
  if (r >= 80) return "r-5";
  if (r >= 70) return "r-4";
  if (r >= 60) return "r-3";
  if (r >= 50) return "r-2";
  return "r-1";
}

export function attrColor(v: number): string {
  if (v >= 16) return "var(--a4)";
  if (v >= 11) return "var(--a3)";
  if (v >= 6) return "var(--a2)";
  return "var(--a1)";
}

export function matchRatingColor(v: number): string {
  if (v >= 8) return "var(--a4)";
  if (v >= 7) return "var(--a3)";
  if (v >= 6.3) return "var(--text)";
  if (v >= 5.5) return "var(--warn)";
  return "var(--neg)";
}

export const POS_LABEL: Record<string, string> = {
  GK: "TW", DR: "RV", DC: "IV", DL: "LV", DM: "DM", MR: "RM", MC: "ZM", ML: "LM", AMR: "RA", AMC: "ZOM", AML: "LA", ST: "ST",
};

export function posGroup(p: string): "GK" | "DEF" | "MID" | "ATT" {
  if (p === "GK") return "GK";
  if (p === "DR" || p === "DC" || p === "DL") return "DEF";
  if (p === "ST" || p === "AMR" || p === "AML") return "ATT";
  return "MID";
}

export const ATTR_GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Technik",
    keys: [["corners", "Ecken"], ["crossing", "Flanken"], ["dribbling", "Dribbling"], ["finishing", "Abschluss"], ["firstTouch", "Ballannahme"],
      ["freeKicks", "Freistösse"], ["heading", "Kopfball"], ["longShots", "Fernschüsse"], ["marking", "Manndeckung"], ["passing", "Passen"],
      ["penalties", "Elfmeter"], ["tackling", "Tackling"], ["technique", "Technik"], ["goalkeeping", "Torwartspiel"]],
  },
  {
    title: "Mental",
    keys: [["aggression", "Aggressivität"], ["anticipation", "Antizipation"], ["composure", "Nervenstärke"], ["decisions", "Entscheidungen"],
      ["offTheBall", "Laufwege"], ["positioning", "Stellungsspiel"], ["vision", "Übersicht"], ["workRate", "Einsatz"]],
  },
  {
    title: "Physis",
    keys: [["acceleration", "Antritt"], ["agility", "Beweglichkeit"], ["jumping", "Sprungkraft"], ["pace", "Tempo"], ["stamina", "Ausdauer"], ["strength", "Kraft"]],
  },
];


export function seasonLabel(season: number) {
  return `${season}/${String((season + 1) % 100).padStart(2, "0")}`;
}

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function parseIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Sa 25.07.2026" */
export function fmtDate(iso: string | null | undefined, opts: { year?: boolean; long?: boolean } = {}): string {
  if (!iso) return "–";
  const d = parseIso(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (opts.long) return `${WD_LONG[d.getUTCDay()]}, ${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${WD[d.getUTCDay()]} ${dd}.${mm}.${opts.year === false ? "" : d.getUTCFullYear()}`;
}

export function weekdayShort(iso: string): string {
  return WD[parseIso(iso).getUTCDay()];
}

export function isoParts(iso: string) {
  const d = parseIso(iso);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate(), weekday: (d.getUTCDay() + 6) % 7 };
}

/** Datum eines Saisontags (Tag 0 = Montag der ersten Juliwoche), wie auf dem Server. */
export function dayIso(season: number, day: number): string {
  const d = new Date(Date.UTC(season, 6, 1));
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7) + day);
  return d.toISOString().slice(0, 10);
}
