/**
 * Kaderstatus und Teamdynamik: Jeder Spieler erwartet Einsatzzeit gemäss
 * seinem Status. Die Hierarchie ergibt sich aus Alter, Erfahrung, Stärke und
 * Persönlichkeit; der Zusammenhalt wächst mit gemeinsamer Zeit im Verein.
 */
import { COUNTRY_BY_CODE } from "./data/countries";
import { NAME_POOLS } from "./data/names";
import { Rng, hashString } from "./rng";
import { autoLineup } from "./tactics";
import type { Formation, Player } from "./types";

export type SquadStatus = "star" | "important" | "regular" | "rotation" | "backup" | "prospect";

export const SQUAD_STATUS: SquadStatus[] = ["star", "important", "regular", "rotation", "backup", "prospect"];

export const SQUAD_STATUS_LABEL: Record<SquadStatus, string> = {
  star: "Starspieler",
  important: "Wichtiger Spieler",
  regular: "Stammspieler",
  rotation: "Rotationsspieler",
  backup: "Ergänzungsspieler",
  prospect: "Talent",
};

/** Erwarteter Anteil an Startelfeinsätzen */
export const EXPECTED_SHARE: Record<SquadStatus, number> = {
  star: 0.8, important: 0.65, regular: 0.5, rotation: 0.3, backup: 0.1, prospect: 0.1,
};

const ORDER: Record<SquadStatus, number> = { star: 0, important: 1, regular: 2, rotation: 3, backup: 4, prospect: 5 };

/**
 * Status, den jeder Spieler aufgrund seiner Stellung im Kader erwartet: wer
 * in der besten Elf der eigenen Formation steht, will regelmässig spielen;
 * dahinter folgen Rotation und Ergänzung, junge Spieler mit Potenzial sind Talente.
 */
export function defaultStatuses(players: Player[], formation: Formation = "4-4-2"): Map<number, SquadStatus> {
  const healthy = players.map((p) => ({ ...p, injuryWeeks: 0, suspendedWeeks: 0 }));
  const { lineup } = autoLineup(healthy, formation);
  const xi = new Set(lineup.filter((x): x is number => x !== null));
  const byRating = (a: Player, b: Player) => b.rating - a.rating;
  const out = new Map<number, SquadStatus>();
  players.filter((p) => xi.has(p.id)).sort(byRating).forEach((p, i) => out.set(p.id, i < 2 ? "star" : i < 6 ? "important" : "regular"));
  let rotation = 0;
  for (const p of players.filter((x) => !xi.has(x.id)).sort(byRating)) {
    if (p.age <= 20 && p.potential - p.rating >= 8) out.set(p.id, "prospect");
    else if (p.position !== "GK" && rotation < 6) {
      out.set(p.id, "rotation");
      rotation++;
    } else out.set(p.id, "backup");
  }
  return out;
}

export function statusOf(p: Player, defaults: Map<number, SquadStatus>): SquadStatus {
  return p.squadStatus ?? defaults.get(p.id) ?? "backup";
}

/** Name eines KI-Trainers (fest je Verein). */
export function coachName(clubId: number, countryCode: string): string {
  const pool = NAME_POOLS[COUNTRY_BY_CODE[countryCode]?.region ?? "en"] ?? NAME_POOLS.en;
  const rng = new Rng(hashString(`coach|${clubId}`));
  return `${rng.pick(pool.first)} ${rng.pick(pool.last)}`;
}

/** Ist der neue Status eine Herabstufung gegenüber dem erwarteten? */
export function statusChange(from: SquadStatus, to: SquadStatus): number {
  return ORDER[from] - ORDER[to];
}

/** Zufriedenheit mit der Einsatzzeit: -1 (viel zu wenig) bis +1 (mehr als erwartet). */
export function playingTimeHappiness(p: Player, status: SquadStatus, season: number): number | null {
  const pl = p.playing;
  if (!pl || pl.season !== season || pl.matches < 4) return null;
  const diff = pl.starts / pl.matches - EXPECTED_SHARE[status];
  // Etwas weniger als erwartet wird toleriert
  if (diff >= 0) return Math.min(1, diff / 0.35);
  if (diff >= -0.1) return 0;
  return Math.max(-1, (diff + 0.1) / 0.3);
}

/** Einfluss in der Kabine (0–100): Alter, Länderspiele, Stärke, Persönlichkeit, Zeit im Verein. */
export function influence(p: Player, season: number): number {
  const age = Math.max(0, Math.min(1, (p.age - 19) / 12));
  const caps = Math.min(1, (p.caps ?? 0) / 40);
  const quality = Math.max(0, Math.min(1, (p.rating - 50) / 40));
  const personality = (p.attrs.composure + p.attrs.decisions + p.attrs.workRate + p.attrs.aggression * 0.5) / (3.5 * 20);
  const tenure = p.joined ? Math.min(1, (season - p.joined.season) / 4) : 0.75;
  const lead = p.traits?.includes("leader") ? 0.12 : 0;
  return Math.min(100, Math.round(100 * (age * 0.28 + caps * 0.14 + quality * 0.26 + personality * 0.17 + tenure * 0.15 + lead)));
}

export type HierarchyLevel = "leader" | "influential" | "other";

export const HIERARCHY_LABEL: Record<HierarchyLevel, string> = {
  leader: "Mannschaftsführer",
  influential: "Einflussreiche Spieler",
  other: "Weitere Spieler",
};

export function hierarchy(players: Player[], season: number): { player: Player; influence: number; level: HierarchyLevel }[] {
  return players
    .map((p) => ({ player: p, influence: influence(p, season) }))
    .sort((a, b) => b.influence - a.influence)
    .map((x, i) => ({ ...x, level: (i < 3 ? "leader" : i < 8 ? "influential" : "other") as HierarchyLevel }));
}

/**
 * Zusammenhalt (0–100): Anteil der Stammkräfte, die schon länger im Verein
 * sind, plus gemeinsame Pflichtspiele in dieser Saison.
 */
export function cohesion(players: Player[], season: number, matchesPlayed: number): number {
  const core = [...players].sort((a, b) => b.rating - a.rating).slice(0, 16);
  if (!core.length) return 50;
  const settled = core.filter((p) => !p.joined || p.joined.season < season).length / core.length;
  return Math.round(Math.max(5, Math.min(100, 25 + settled * 50 + Math.min(25, matchesPlayed * 1.4))));
}

export function cohesionLabel(v: number): string {
  return v >= 80 ? "Eingespielt" : v >= 65 ? "Gut" : v >= 50 ? "Durchschnittlich" : v >= 35 ? "Gering" : "Sehr gering";
}

export function moodLabel(avgMorale: number): string {
  return avgMorale >= 80 ? "Ausgezeichnet" : avgMorale >= 65 ? "Gut" : avgMorale >= 50 ? "Durchwachsen" : avgMorale >= 35 ? "Angespannt" : "Schlecht";
}
