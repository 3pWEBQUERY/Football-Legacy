/** Saisonablauf: Spielplan, Tabelle, vereinfachte Simulation, Auf- und Abstieg. */
import { Rng, clamp } from "./rng";
import type { StandingRow } from "./types";

export interface ScheduledMatch {
  round: number;
  week: number;
  homeId: number;
  awayId: number;
}

/** Anzahl Spieltage: Doppelrunde, bei sehr grossen Ligen Einfachrunde. */
export function roundsFor(size: number): number {
  return size <= 24 ? 2 * (size - 1) : size - 1;
}

/**
 * Spielplan nach dem Kreisverfahren. Die Spieltage werden gleichmässig auf die
 * Saisonwochen verteilt (grosse Ligen spielen dann auch unter der Woche).
 */
export function createSchedule(clubIds: number[], weeks: number, rng: Rng): ScheduledMatch[] {
  const ids = rng.shuffle([...clubIds]);
  if (ids.length % 2 === 1) ids.push(-1); // spielfrei
  const n = ids.length;
  const half: { round: number; pairs: [number, number][] }[] = [];
  const arr = [...ids];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === -1 || b === -1) continue;
      // Heimrecht abwechseln
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    half.push({ round: r + 1, pairs });
    arr.splice(1, 0, arr.pop()!);
  }
  const totalRounds = roundsFor(clubIds.length);
  const rounds = [...half];
  if (totalRounds > n - 1) {
    for (const h of half) rounds.push({ round: h.round + (n - 1), pairs: h.pairs.map(([a, b]) => [b, a]) });
  }
  const out: ScheduledMatch[] = [];
  for (const r of rounds) {
    const week = Math.max(1, Math.ceil((r.round * weeks) / totalRounds));
    for (const [homeId, awayId] of r.pairs) out.push({ round: r.round, week, homeId, awayId });
  }
  return out;
}

export interface PlayedFixture {
  homeId: number;
  awayId: number;
  homeGoals: number | null;
  awayGoals: number | null;
  round?: number;
}

export function computeStandings(clubIds: number[], fixtures: PlayedFixture[]): StandingRow[] {
  const rows = new Map<number, StandingRow>();
  for (const id of clubIds) {
    rows.set(id, { clubId: id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, form: [] });
  }
  const sorted = [...fixtures].sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
  for (const f of sorted) {
    if (f.homeGoals === null || f.awayGoals === null) continue;
    const h = rows.get(f.homeId);
    const a = rows.get(f.awayId);
    if (!h || !a) continue;
    h.played++;
    a.played++;
    h.goalsFor += f.homeGoals;
    h.goalsAgainst += f.awayGoals;
    a.goalsFor += f.awayGoals;
    a.goalsAgainst += f.homeGoals;
    if (f.homeGoals > f.awayGoals) {
      h.won++; a.lost++; h.points += 3;
      h.form.push("W"); a.form.push("L");
    } else if (f.homeGoals < f.awayGoals) {
      a.won++; h.lost++; a.points += 3;
      h.form.push("L"); a.form.push("W");
    } else {
      h.drawn++; a.drawn++; h.points++; a.points++;
      h.form.push("D"); a.form.push("D");
    }
  }
  const list = [...rows.values()];
  for (const r of list) r.form = r.form.slice(-5);
  list.sort(
    (x, y) =>
      y.points - x.points ||
      y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) ||
      y.goalsFor - x.goalsFor ||
      x.clubId - y.clubId,
  );
  return list;
}

/**
 * Vereinfachte Ergebnis-Simulation für Ligen ohne Detailsimulation
 * (Poisson-Modell, auf die Matchengine abgestimmt).
 */
export function quickResult(rng: Rng, homeRating: number, awayRating: number): [number, number] {
  const diff = homeRating - awayRating;
  const lh = clamp(1.5 * Math.exp(diff / 22), 0.2, 5);
  const la = clamp(1.18 * Math.exp(-diff / 22), 0.2, 5);
  return [Math.min(9, rng.poisson(lh)), Math.min(9, rng.poisson(la))];
}

/** Erwarteter Tabellenplatz anhand der Stärke-Rangfolge. */
export function expectedPosition(clubId: number, ratings: { clubId: number; rating: number }[]): number {
  const sorted = [...ratings].sort((a, b) => b.rating - a.rating);
  return sorted.findIndex((r) => r.clubId === clubId) + 1;
}

export interface TransferWindow {
  open: boolean;
  label: string;
}

export function transferWindow(week: number, weeks: number): TransferWindow {
  if (week <= 3) return { open: true, label: "Sommer-Transferfenster" };
  const mid = Math.floor(weeks / 2);
  if (week >= mid - 1 && week <= mid + 1) return { open: true, label: "Winter-Transferfenster" };
  return { open: false, label: "Transferfenster geschlossen" };
}

/** Prämien am Saisonende nach Platzierung (Anteil am TV-Topf). */
export function prizeMoney(position: number, size: number, tvPool: number): number {
  const share = (size - position + 1) / ((size * (size + 1)) / 2);
  return Math.round((tvPool * 0.6 * share) / 1000) * 1000;
}
