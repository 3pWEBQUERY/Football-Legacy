/** Landespokal: Rundenplanung, Auslosung, Elfmeterschiessen. */
import { NAME_POOLS } from "./data/names";
import { COUNTRY_BY_CODE } from "./data/countries";
import { Rng, clamp } from "./rng";
import type { Player } from "./types";

export interface CupEntrant {
  id: number;
  tier: number;
  rating: number;
}

export interface CupPlan {
  rounds: number; // Anzahl Runden inkl. Vorrunde
  prelim: CupEntrant[]; // Vereine in der Vorrunde (gerade Anzahl)
  byes: number[]; // steigen erst in Runde 2 ein
}

/** Teilt die Teilnehmer in Vorrunde und Freilose, sodass ab Runde 2 eine Zweierpotenz bleibt. */
export function planCup(entrants: CupEntrant[]): CupPlan {
  const n = entrants.length;
  let p = 1;
  while (p * 2 <= n) p *= 2;
  const prelimMatches = n - p;
  // Tiefere Ligen und schwächere Vereine spielen die Vorrunde
  const sorted = [...entrants].sort((a, b) => b.tier - a.tier || a.rating - b.rating);
  const prelim = prelimMatches > 0 ? sorted.slice(0, prelimMatches * 2) : sorted;
  const byes = prelimMatches > 0 ? sorted.slice(prelimMatches * 2).map((e) => e.id) : [];
  const rounds = Math.log2(p) + (prelimMatches > 0 ? 1 : 0);
  return { rounds, prelim, byes };
}

export function cupRoundName(round: number, total: number): string {
  const fromEnd = total - round;
  if (fromEnd === 0) return "Finale";
  if (fromEnd === 1) return "Halbfinale";
  if (fromEnd === 2) return "Viertelfinale";
  if (fromEnd === 3) return "Achtelfinale";
  return `${round}. Runde`;
}

/** Zufällige Paarungen; der klassentiefere Verein hat Heimrecht. */
export function drawCupRound(rng: Rng, entrants: CupEntrant[]): [number, number][] {
  const pool = rng.shuffle([...entrants]);
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < pool.length; i += 2) {
    const a = pool[i];
    const b = pool[i + 1];
    if (a.tier > b.tier) pairs.push([a.id, b.id]);
    else if (b.tier > a.tier) pairs.push([b.id, a.id]);
    else pairs.push(rng.chance(0.5) ? [a.id, b.id] : [b.id, a.id]);
  }
  return pairs;
}

/** Wochen der Pokalrunden, verteilt über die Ligasaison (Positionen in Liga-Wochen). */
export function cupWeekPositions(rounds: number, leagueWeeks: number): number[] {
  if (rounds <= 0) return [];
  const out: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const f = rounds === 1 ? 0.9 : 0.1 + (0.82 * i) / (rounds - 1);
    out.push(clamp(Math.round(leagueWeeks * f), 1, leagueWeeks));
  }
  return out;
}

export function cupName(countryCode: string): string {
  const country = COUNTRY_BY_CODE[countryCode];
  const region = country?.region ?? "en";
  const names: Record<string, string> = {
    de: "Verbandspokal", en: "Association Cup", es: "Copa Nacional", latam: "Copa Nacional", pt: "Taça Nacional", br: "Copa Nacional",
    it: "Coppa Nazionale", fr: "Coupe Nationale", nl: "Bekertoernooi", nordic: "Cupen", slavicW: "Puchar Krajowy", slavicE: "Kubok",
    balkan: "Kup", hu: "Magyar Kupa", ro: "Cupa Națională", gr: "Kypello", tr: "Kupası", arab: "Kings Cup", persian: "Hazfi Cup",
    waf: "FA Cup", eaf: "Knockout Cup", jp: "Emperor Shield", kr: "FA Cup", cn: "FA Cup", sea: "Piala", in: "Super Cup", caucasus: "Taszi",
  };
  void NAME_POOLS;
  return `${country?.name ?? ""} ${names[region] ?? "Pokal"}`.trim();
}

export interface Shooter {
  penalties: number;
  composure: number;
}

/** Elfmeterschiessen: fünf Schützen, danach K.-o.-Modus. */
export function penaltyShootout(rng: Rng, home: Shooter[], away: Shooter[], homeKeeper: number, awayKeeper: number): [number, number] {
  const kick = (s: Shooter, keeper: number) =>
    rng.chance(clamp(0.73 + ((s.penalties - 10) / 20) * 0.16 + ((s.composure - 10) / 20) * 0.06 - ((keeper - 10) / 20) * 0.1, 0.5, 0.93));
  const order = (list: Shooter[]) => (list.length ? [...list].sort((a, b) => b.penalties - a.penalties) : [{ penalties: 10, composure: 10 }]);
  const hs = order(home);
  const as = order(away);
  let h = 0;
  let a = 0;
  for (let i = 0; i < 5; i++) {
    if (kick(hs[i % hs.length], awayKeeper)) h++;
    if (h > a + (5 - i) || a > h + (4 - i)) break; // nicht mehr einholbar
    if (kick(as[i % as.length], homeKeeper)) a++;
    if (h > a + (4 - i) || a > h + (4 - i)) break;
  }
  let i = 5;
  while (h === a && i < 40) {
    const hk = kick(hs[i % hs.length], awayKeeper);
    const ak = kick(as[i % as.length], homeKeeper);
    if (hk) h++;
    if (ak) a++;
    i++;
  }
  if (h === a) h++;
  return [h, a];
}

export function shootersFrom(players: Player[]): { shooters: Shooter[]; keeper: number } {
  const fit = players.filter((p) => p.injuryWeeks <= 0 && p.suspendedWeeks <= 0);
  const keeper = fit.filter((p) => p.position === "GK").sort((a, b) => b.attrs.goalkeeping - a.attrs.goalkeeping)[0];
  const shooters = fit.filter((p) => p.position !== "GK").sort((a, b) => b.rating - a.rating).slice(0, 11)
    .map((p) => ({ penalties: p.attrs.penalties, composure: p.attrs.composure }));
  return { shooters, keeper: keeper?.attrs.goalkeeping ?? 8 };
}
