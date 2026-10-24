/**
 * Kontinentalpokal: die besten Vereine eines Kontinentalverbands spielen eine
 * Gruppenphase (Vierergruppen, Hin- und Rückspiel) und danach K.-o.-Runden
 * in einem Spiel. Bei Unentschieden in der K.-o.-Phase entscheidet das
 * Elfmeterschiessen.
 */
import { cupRoundName } from "./cup";
import type { CountryProfile } from "./data/countries";
import type { Rng } from "./rng";

export const GROUP_ROUNDS = 6;

const CONFED_NAME: Record<CountryProfile["confed"], string> = {
  UEFA: "Kontinentalpokal Europa",
  CONMEBOL: "Kontinentalpokal Südamerika",
  CONCACAF: "Kontinentalpokal Nordamerika",
  AFC: "Kontinentalpokal Asien",
  CAF: "Kontinentalpokal Afrika",
  OFC: "Kontinentalpokal Ozeanien",
};

export function continentalName(confed: CountryProfile["confed"]): string {
  return CONFED_NAME[confed];
}

export interface SlotCountry {
  code: string;
  strength: number;
  leagueSize: number;
}

/** Teilnehmerfeld: 32, 16 oder 8 Vereine je nach Grösse des Verbands. */
export function continentalSize(countries: SlotCountry[]): number {
  const capacity = countries.reduce((s, c) => s + Math.min(4, c.leagueSize), 0);
  return capacity >= 32 ? 32 : capacity >= 16 ? 16 : capacity >= 8 ? 8 : 0;
}

/** Startplätze je Land: starke Ligen bekommen bis zu vier Plätze. */
export function allocateSlots(countries: SlotCountry[], size: number): Map<string, number> {
  const quota = [4, 4, 4, 4, 3, 3, 2, 2, 2];
  const sorted = [...countries].sort((a, b) => b.strength - a.strength || a.code.localeCompare(b.code));
  const slots = new Map<string, number>();
  let total = 0;
  sorted.forEach((c, i) => {
    if (total >= size) return;
    const n = Math.min(quota[i] ?? 1, c.leagueSize, size - total);
    slots.set(c.code, n);
    total += n;
  });
  // Kleine Verbände: weitere Plätze reihum an die stärksten Länder
  while (total < size) {
    let added = false;
    for (const c of sorted) {
      if (total >= size) break;
      const cur = slots.get(c.code) ?? 0;
      if (cur < c.leagueSize) {
        slots.set(c.code, cur + 1);
        total++;
        added = true;
      }
    }
    if (!added) break;
  }
  return slots;
}

export interface ContinentalTeam {
  id: number;
  rating: number;
  country: string;
}

/** Auslosung der Gruppen über Lostöpfe; Vereine eines Landes möglichst getrennt. */
export function drawGroups(rng: Rng, teams: ContinentalTeam[]): number[][] {
  const groupCount = teams.length / 4;
  const sorted = [...teams].sort((a, b) => b.rating - a.rating);
  const groups: ContinentalTeam[][] = Array.from({ length: groupCount }, () => []);
  for (let pot = 0; pot < 4; pot++) {
    const potTeams = rng.shuffle(sorted.slice(pot * groupCount, (pot + 1) * groupCount));
    for (const t of potTeams) {
      const open = groups.filter((g) => g.length === pot);
      const clean = open.filter((g) => !g.some((x) => x.country === t.country));
      const target = (clean.length ? clean : open)[rng.int(0, (clean.length ? clean : open).length - 1)];
      target.push(t);
    }
  }
  return groups.map((g) => g.map((t) => t.id));
}

/** Sechs Spieltage einer Vierergruppe: jeder gegen jeden mit Hin- und Rückspiel. */
export function groupMatchdays(g: number[]): [number, number][][] {
  const [a, b, c, d] = g;
  return [
    [[a, b], [c, d]],
    [[d, a], [b, c]],
    [[a, c], [b, d]],
    [[b, a], [d, c]],
    [[a, d], [c, b]],
    [[c, a], [d, b]],
  ];
}

/** Erste K.-o.-Runde: Gruppensieger gegen Gruppenzweite anderer Gruppen, Sieger mit Heimrecht. */
export function drawKnockout(rng: Rng, winners: { id: number; group: number }[], runners: { id: number; group: number }[]): [number, number][] {
  for (let attempt = 0; attempt < 50; attempt++) {
    const pool = rng.shuffle([...runners]);
    const pairs: [number, number][] = [];
    let ok = true;
    for (const w of rng.shuffle([...winners])) {
      const idx = pool.findIndex((r) => r.group !== w.group);
      if (idx < 0) {
        ok = false;
        break;
      }
      pairs.push([w.id, pool[idx].id]);
      pool.splice(idx, 1);
    }
    if (ok) return pairs;
  }
  return winners.map((w, i) => [w.id, runners[i].id]);
}

export function continentalRoundName(round: number, totalRounds: number): string {
  if (round <= GROUP_ROUNDS) return `Gruppenphase · ${round}. Spieltag`;
  return cupRoundName(round - GROUP_ROUNDS, totalRounds - GROUP_ROUNDS);
}

/** Positionen der Runden in Liga-Wochen: Gruppen in der Hinrunde, K.-o.-Phase in der Rückrunde. */
export function continentalWeekPositions(totalRounds: number, leagueWeeks: number, avoid: number[]): number[] {
  const ko = totalRounds - GROUP_ROUNDS;
  const out: number[] = [];
  const used = new Set(avoid);
  const place = (f: number) => {
    let w = Math.max(2, Math.min(leagueWeeks - 1, Math.round(leagueWeeks * f)));
    while ((used.has(w) || out.includes(w)) && w < leagueWeeks - 1) w++;
    out.push(w);
  };
  for (let i = 0; i < GROUP_ROUNDS; i++) place(0.1 + (0.36 * i) / (GROUP_ROUNDS - 1));
  for (let i = 0; i < ko; i++) place(ko === 1 ? 0.9 : 0.6 + (0.32 * i) / (ko - 1));
  return out.sort((a, b) => a - b);
}
