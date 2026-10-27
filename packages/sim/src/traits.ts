/**
 * Charakterzüge: höchstens zwei feste Eigenschaften je Spieler. Sie werden
 * beim ersten Bedarf deterministisch aus Spieler-ID und Attributen bestimmt
 * und danach mit dem Spieler gespeichert (bestehende Spielstände brauchen
 * daher keine Migration).
 */
import { Rng, clamp, seedFor } from "./rng";
import type { Player } from "./types";

export type Trait = "ambitious" | "professional" | "moody" | "leader" | "bigGame" | "nervous" | "loyal" | "mercenary" | "injuryProne";

export const TRAITS: Record<Trait, { label: string; text: string; tone: "pos" | "neg" | "neutral" }> = {
  ambitious: { label: "Ehrgeizig", text: "Entwickelt sich schneller, will aber spielen und nach oben – auf der Bank sinkt die Moral stärker.", tone: "pos" },
  professional: { label: "Profi", text: "Trainiert vorbildlich: schnellere Entwicklung, späterer Abbau, seltener verletzt, ausgeglichene Moral.", tone: "pos" },
  moody: { label: "Launisch", text: "Stimmungsschwankungen: Siege und Niederlagen wirken deutlich stärker auf die Moral.", tone: "neg" },
  leader: { label: "Führungsspieler", text: "Hat in der Kabine Gewicht und führt als Kapitän die Mannschaft besonders gut.", tone: "pos" },
  bigGame: { label: "Wettkampftyp", text: "Wächst in Derbys, Pokal- und Relegationsspielen über sich hinaus.", tone: "pos" },
  nervous: { label: "Nervös", text: "Wird in grossen Spielen (Derbys, Pokal, Relegation) schwächer.", tone: "neg" },
  loyal: { label: "Vereinstreu", text: "Verlängert zu bescheideneren Bedingungen und will seltener weg.", tone: "pos" },
  mercenary: { label: "Geldorientiert", text: "Fordert deutlich mehr Gehalt.", tone: "neg" },
  injuryProne: { label: "Verletzungsanfällig", text: "Verletzt sich im Training und im Spiel häufiger.", tone: "neg" },
};

/** Paare, die sich ausschliessen. */
const CONFLICTS: [Trait, Trait][] = [["professional", "moody"], ["bigGame", "nervous"], ["loyal", "mercenary"], ["professional", "injuryProne"]];

function chances(p: Player): Record<Trait, number> {
  const a = p.attrs;
  return {
    ambitious: 0.08 + clamp((p.potential - p.rating) / 120, 0, 0.15) + (p.age <= 23 ? 0.04 : 0),
    professional: 0.05 + clamp((a.workRate + a.decisions - 24) / 120, 0, 0.12),
    moody: 0.05 + clamp((a.aggression - a.composure) / 80, 0, 0.12),
    leader: 0.02 + clamp((a.composure + a.decisions + a.workRate - 42) / 90, 0, 0.16) + (p.age >= 27 ? 0.04 : 0),
    bigGame: 0.05 + clamp((a.composure - 12) / 60, 0, 0.1),
    nervous: 0.04 + clamp((10 - a.composure) / 50, 0, 0.12),
    loyal: 0.08,
    mercenary: 0.07,
    injuryProne: 0.05 + (a.stamina <= 9 ? 0.04 : 0),
  };
}

function derive(p: Player): Trait[] {
  const rng = new Rng(seedFor("traits", p.id, p.birthYear, p.lastName));
  const c = chances(p);
  const order = Object.keys(c) as Trait[];
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out: Trait[] = [];
  for (const t of order) {
    if (out.length >= 2) break;
    if (CONFLICTS.some(([x, y]) => (t === x && out.includes(y)) || (t === y && out.includes(x)))) continue;
    if (rng.chance(c[t])) out.push(t);
  }
  return out;
}

/** Charakterzüge eines Spielers (beim ersten Aufruf bestimmt und am Spieler abgelegt). */
export function traitsOf(p: Player): Trait[] {
  if (!p.traits) p.traits = derive(p);
  return p.traits;
}

export const hasTrait = (p: Player, t: Trait) => traitsOf(p).includes(t);

/** Entwicklungstempo (Wachstum). */
export function growthFactor(p: Player): number {
  return (hasTrait(p, "ambitious") ? 1.15 : 1) * (hasTrait(p, "professional") ? 1.1 : 1);
}

/** Altersbedingter Abbau. */
export function declineFactor(p: Player): number {
  return hasTrait(p, "professional") ? 0.7 : 1;
}

/** Wie stark Ereignisse auf die Moral wirken. */
export function moraleSwing(p: Player): number {
  return hasTrait(p, "moody") ? 1.5 : hasTrait(p, "professional") ? 0.8 : 1;
}

/** Verletzungsrisiko. */
export function injuryFactor(p: Player): number {
  return hasTrait(p, "injuryProne") ? 1.5 : hasTrait(p, "professional") ? 0.85 : 1;
}

/** Leistung in grossen Spielen (Derby, Pokal, Relegation, Kontinentalpokal). */
export function bigGameFactor(p: Player): number {
  return hasTrait(p, "bigGame") ? 1.03 : hasTrait(p, "nervous") ? 0.97 : 1;
}

/** Gehaltsforderung: neue Verträge und Verlängerungen. */
export function wageFactor(p: Player, renewal = false): number {
  return (hasTrait(p, "mercenary") ? 1.15 : 1) * (renewal && hasTrait(p, "loyal") ? 0.9 : 1);
}

/** Bereitschaft, um einen Wechsel zu bitten. */
export function restlessness(p: Player): number {
  return hasTrait(p, "loyal") ? 0.5 : hasTrait(p, "ambitious") || hasTrait(p, "mercenary") ? 1.4 : 1;
}

/** Moraländerung unter Berücksichtigung des Charakters. */
export function moraleChange(p: Player, delta: number, min = 5, max = 100): void {
  p.morale = clamp(Math.round(p.morale + delta * moraleSwing(p)), min, max);
}
