/** Verletzungsarten: Name passend zur Ausfalldauer in Wochen. */
import type { Rng } from "./rng";
import type { Player } from "./types";

const BY_LENGTH: [number, string[]][] = [
  [1, ["Prellung", "Leichte Zerrung", "Pferdekuss", "Verstauchter Knöchel", "Rückenprobleme"]],
  [2, ["Muskelzerrung", "Bänderdehnung", "Oberschenkelzerrung", "Wadenzerrung", "Adduktorenprobleme"]],
  [4, ["Muskelfaserriss", "Leistenzerrung", "Sprunggelenksverletzung", "Rippenprellung", "Kapselverletzung"]],
  [8, ["Muskelbündelriss", "Innenbandverletzung", "Schambeinentzündung", "Knochenödem"]],
  [15, ["Meniskusriss", "Mittelfussbruch", "Syndesmoseriss", "Wadenbeinbruch"]],
  [99, ["Kreuzbandriss", "Achillessehnenriss"]],
];

export function injuryName(rng: Rng, weeks: number): string {
  const group = BY_LENGTH.find(([max]) => weeks <= max) ?? BY_LENGTH[BY_LENGTH.length - 1];
  return rng.pick(group[1]);
}

/** Verletzung eintragen (Dauer in Wochen, Datum für die Anzeige). */
export function injure(rng: Rng, p: Player, weeks: number, season: number, day: number) {
  p.injuryWeeks = Math.max(p.injuryWeeks, weeks);
  p.injury = { name: injuryName(rng, weeks), season, day, weeks };
}

/** Ausfalldauer nach einer Verletzung im Spiel, selten auch langfristig. */
export function matchInjuryLength(rng: Rng, physio: number): number {
  // Meist kurze Ausfälle, wenige mittlere, selten lange (Kreuzband, Bruch)
  if (rng.chance(0.015)) return rng.int(18, 30);
  const base = [1, 1, 1, 2, 2, 3, 4, 6, 10][rng.weighted([24, 20, 16, 12, 10, 8, 5, 3, 2])];
  return Math.max(1, Math.round(base * (1.15 - physio / 40)));
}
