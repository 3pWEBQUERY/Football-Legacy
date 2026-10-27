/** Baut Engine-Eingaben aus Vereins- und Spielerdaten. */
import { type Player, type Tactic, type TeamSetup, autoLineup, defaultTactic, isAvailable, validateTactic, weekdayOf } from "@fl/sim";
import type { ClubRow } from "./repo";

export interface AiMatchContext {
  /** Stärke des Gegners: gegen Favoriten tiefer, gegen Aussenseiter mutiger */
  opponentRating?: number;
  /** Rotation: Pokal gegen klar Schwächere oder englische Woche – Stammkräfte schonen */
  rotate?: "cup" | "midweek" | false;
}

/** Spielkontext eines KI-Teams gegen diesen Gegner. */
export function aiContext(club: ClubRow, opponent: ClubRow, cup: boolean, slotDay: number | undefined): AiMatchContext {
  // Englische Woche: Spiel von Montag bis Freitag; im Pokal nur gegen klar Schwächere rotieren
  const midweek = slotDay !== undefined && weekdayOf(slotDay) < 5;
  const rotate = cup ? (opponent.rating < club.rating - 8 ? "cup" : false) : midweek ? "midweek" : false;
  return { opponentRating: opponent.rating, rotate };
}

/** Grundmentalität gegen diesen Gegner (−2 … +1 gegenüber der Spielidee des Trainers). */
export function aiMentalityShift(own: number, opponent: number | undefined): number {
  if (opponent === undefined) return 0;
  const diff = opponent - own;
  return diff >= 10 ? -2 : diff >= 5 ? -1 : diff <= -6 ? 1 : 0;
}

/**
 * Wen der KI-Trainer schont: müde Spieler immer (sofern Ersatz da ist), bei
 * Rotation zusätzlich die besten Feldspieler, die nicht ganz frisch sind
 * (Pokal gegen Schwächere: drei, englische Woche: zwei angeschlagene).
 */
export function restedPlayers(squad: Player[], rotate: AiMatchContext["rotate"]): Set<number> {
  const fit = squad.filter(isAvailable);
  const rest = new Set<number>();
  if (fit.length < 16) return rest;
  for (const p of fit) if (p.position !== "GK" && p.fitness < 72) rest.add(p.id);
  if (rotate) {
    const limit = rotate === "cup" ? 97 : 86;
    const stars = fit.filter((p) => p.position !== "GK").sort((a, b) => b.rating - a.rating).slice(0, 5).filter((p) => p.fitness < limit).slice(0, rotate === "cup" ? 3 : 2);
    for (const p of stars) rest.add(p.id);
  }
  // Nie so viele schonen, dass keine Elf mit Bank übrig bleibt
  while (fit.length - rest.size < 16 && rest.size) rest.delete([...rest][rest.size - 1]);
  return rest;
}

/** KI: beste verfügbare Elf in der Formation des Trainers, angepasst an Gegner und Belastung. */
export function aiTactic(club: ClubRow, squad: Player[], ctx: AiMatchContext = {}): Tactic {
  const base = club.tactic ?? defaultTactic(squad);
  const rest = restedPlayers(squad, ctx.rotate);
  const pool = rest.size ? squad.filter((p) => !rest.has(p.id)) : squad;
  const { lineup, bench: poolBench } = autoLineup(pool, base.formation);
  // Geschonte Spieler sitzen auf der Bank (hinter dem Ersatztorwart) und können eingewechselt werden
  const bench = [...new Set([...poolBench.slice(0, 1), ...rest, ...poolBench.slice(1)])].slice(0, 9);
  const mentality = Math.max(-3, Math.min(3, (base.mentality ?? 0) + aiMentalityShift(club.rating, ctx.opponentRating)));
  return validateTactic({ ...base, lineup, bench, mentality, slotOffsets: undefined }, squad);
}

export function teamSetup(club: ClubRow, squad: Player[], tactic: Tactic, autoSubs = true, familiarity?: number, aiCoach = false): TeamSetup {
  return {
    clubId: club.id,
    name: club.name,
    shortName: club.short_name,
    colors: club.colors,
    tactic,
    players: squad,
    autoSubs,
    familiarity,
    aiCoach,
  };
}
