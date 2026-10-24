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
