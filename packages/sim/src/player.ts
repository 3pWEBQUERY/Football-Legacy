import { NAME_POOLS } from "./data/names";
import { COUNTRY_BY_CODE } from "./data/countries";
import { Rng, clamp } from "./rng";
import {
  ALL_ATTRS, type AttrKey, type Attributes, type Contract, type Foot, type Player, type Position, type SeasonStats,
} from "./types";

/** Gewichtung der Attribute je Position für die Stärkeberechnung. */
export const POSITION_WEIGHTS: Record<Position, Partial<Record<AttrKey, number>>> = {
  GK: { goalkeeping: 8, positioning: 3, anticipation: 2, composure: 2, decisions: 2, agility: 3, jumping: 1, passing: 1, firstTouch: 1 },
  DC: { tackling: 4, marking: 4, heading: 3, positioning: 4, strength: 3, jumping: 2, anticipation: 2, composure: 1, pace: 1, decisions: 1, passing: 1 },
  DR: { tackling: 3, marking: 2, crossing: 2, pace: 3, stamina: 2, positioning: 2, acceleration: 2, dribbling: 1, passing: 1, workRate: 2, anticipation: 1 },
  DL: { tackling: 3, marking: 2, crossing: 2, pace: 3, stamina: 2, positioning: 2, acceleration: 2, dribbling: 1, passing: 1, workRate: 2, anticipation: 1 },
  DM: { tackling: 3, positioning: 3, passing: 3, anticipation: 3, decisions: 2, workRate: 2, stamina: 2, strength: 1, marking: 2, composure: 1 },
  MC: { passing: 4, vision: 3, decisions: 3, firstTouch: 2, technique: 2, stamina: 2, workRate: 2, tackling: 1, composure: 2, offTheBall: 1, longShots: 1 },
  MR: { crossing: 3, dribbling: 3, pace: 3, acceleration: 2, stamina: 2, passing: 2, technique: 1, workRate: 2, offTheBall: 1, firstTouch: 1 },
  ML: { crossing: 3, dribbling: 3, pace: 3, acceleration: 2, stamina: 2, passing: 2, technique: 1, workRate: 2, offTheBall: 1, firstTouch: 1 },
  AMC: { passing: 3, vision: 4, technique: 3, dribbling: 2, firstTouch: 3, decisions: 2, offTheBall: 2, longShots: 2, finishing: 1, composure: 1 },
  AMR: { dribbling: 4, pace: 3, acceleration: 3, crossing: 2, technique: 2, finishing: 2, offTheBall: 2, firstTouch: 1, agility: 2 },
  AML: { dribbling: 4, pace: 3, acceleration: 3, crossing: 2, technique: 2, finishing: 2, offTheBall: 2, firstTouch: 1, agility: 2 },
  ST: { finishing: 5, offTheBall: 3, composure: 3, firstTouch: 2, heading: 2, pace: 2, acceleration: 2, strength: 1, dribbling: 1, anticipation: 1 },
};

/** Archetypen geben jedem Spieler eine erkennbare Identität. */
export const ARCHETYPES: Record<Position, { name: string; boost: AttrKey[] }[]> = {
  GK: [
    { name: "Reflexkeeper", boost: ["goalkeeping", "agility", "anticipation"] },
    { name: "Mitspielender Keeper", boost: ["passing", "firstTouch", "composure"] },
    { name: "Strafraumbeherrscher", boost: ["jumping", "strength", "positioning"] },
  ],
  DC: [
    { name: "Zweikampfmonster", boost: ["tackling", "strength", "aggression"] },
    { name: "Ballspielender IV", boost: ["passing", "composure", "vision"] },
    { name: "Kopfballturm", boost: ["heading", "jumping", "strength"] },
  ],
  DR: [
    { name: "Offensiver AV", boost: ["crossing", "stamina", "pace"] },
    { name: "Defensiver AV", boost: ["tackling", "marking", "positioning"] },
  ],
  DL: [
    { name: "Offensiver AV", boost: ["crossing", "stamina", "pace"] },
    { name: "Defensiver AV", boost: ["tackling", "marking", "positioning"] },
  ],
  DM: [
    { name: "Abräumer", boost: ["tackling", "aggression", "workRate"] },
    { name: "Tiefer Spielmacher", boost: ["passing", "vision", "composure"] },
  ],
  MC: [
    { name: "Spielmacher", boost: ["passing", "vision", "technique"] },
    { name: "Box-to-Box", boost: ["stamina", "workRate", "offTheBall"] },
    { name: "Taktgeber", boost: ["decisions", "firstTouch", "passing"] },
  ],
  MR: [
    { name: "Flügelflitzer", boost: ["pace", "acceleration", "dribbling"] },
    { name: "Flankengeber", boost: ["crossing", "passing", "stamina"] },
  ],
  ML: [
    { name: "Flügelflitzer", boost: ["pace", "acceleration", "dribbling"] },
    { name: "Flankengeber", boost: ["crossing", "passing", "stamina"] },
  ],
  AMC: [
    { name: "Zehner", boost: ["vision", "passing", "technique"] },
    { name: "Schattenstürmer", boost: ["offTheBall", "finishing", "longShots"] },
  ],
  AMR: [
    { name: "Inverser Flügel", boost: ["dribbling", "finishing", "longShots"] },
    { name: "Flügelflitzer", boost: ["pace", "acceleration", "crossing"] },
  ],
  AML: [
    { name: "Inverser Flügel", boost: ["dribbling", "finishing", "longShots"] },
    { name: "Flügelflitzer", boost: ["pace", "acceleration", "crossing"] },
  ],
  ST: [
    { name: "Knipser", boost: ["finishing", "composure", "offTheBall"] },
    { name: "Zielspieler", boost: ["heading", "strength", "jumping"] },
    { name: "Konterstürmer", boost: ["pace", "acceleration", "finishing"] },
    { name: "Falsche Neun", boost: ["passing", "vision", "technique"] },
  ],
};

const ALT_POSITIONS: Record<Position, Position[]> = {
  GK: [], DC: ["DM"], DR: ["MR", "DC"], DL: ["ML", "DC"], DM: ["MC", "DC"], MC: ["DM", "AMC"],
  MR: ["AMR", "DR"], ML: ["AML", "DL"], AMC: ["MC", "ST"], AMR: ["MR", "ST"], AML: ["ML", "ST"], ST: ["AMC"],
};

export function emptyStats(): SeasonStats {
  return { apps: 0, goals: 0, assists: 0, ratingSum: 0, yellow: 0, red: 0, cleanSheets: 0 };
}

export function ratingAt(attrs: Attributes, position: Position): number {
  const w = POSITION_WEIGHTS[position];
  let sum = 0;
  let total = 0;
  for (const key of ALL_ATTRS) {
    const weight = (w[key] ?? 0) + 0.25; // alle Werte zählen ein wenig
    sum += attrs[key] * weight;
    total += weight;
  }
  return clamp(Math.round((sum / total) * 5), 1, 100);
}

export function ageValueFactor(age: number, rating: number, potential: number): number {
  if (age <= 23) return 1 + Math.max(0, potential - rating) / 25;
  if (age <= 29) return 1;
  return Math.pow(0.82, age - 29);
}

/** Grenze, ab der die Wertkurve abflacht: Weltklasse kostet viel, aber nicht unbegrenzt. */
const VALUE_KNEE = 78;

export function marketValue(p: Pick<Player, "rating" | "age" | "potential">): number {
  // Bis zur Grenze rund +21 % je Stärkepunkt, darüber +15 %: Stärke 85 ≈ 40 Mio., 90 ≈ 80 Mio., 94 ≈ 150 Mio.
  const base = p.rating <= VALUE_KNEE
    ? 10_000 * Math.exp((p.rating - 40) / 5.2)
    : 10_000 * Math.exp((VALUE_KNEE - 40) / 5.2) * Math.exp((p.rating - VALUE_KNEE) / 7);
  const v = base * ageValueFactor(p.age, p.rating, p.potential);
  return roundMoney(v);
}

export function roundMoney(v: number): number {
  if (v >= 1_000_000) return Math.round(v / 50_000) * 50_000;
  if (v >= 100_000) return Math.round(v / 5_000) * 5_000;
  return Math.max(1_000, Math.round(v / 1_000) * 1_000);
}

/** Wochengehalt, das ein Spieler erwartet (abhängig von Wert und Vereinsruf). */
export function wageDemand(p: Pick<Player, "rating" | "age" | "potential">, reputation: number): number {
  const v = 10_000 * Math.exp((p.rating - 40) / 5.2);
  const w = v * 0.0028 * (0.75 + reputation / 200);
  return Math.max(500, Math.round(w / 100) * 100);
}

export interface GenerateOptions {
  id: number;
  clubId: number | null;
  nationality: string;
  position: Position;
  targetRating: number; // 1–100
  age?: number;
  season: number;
  reputation?: number;
  youth?: boolean;
}

/** Erzeugt einen Spieler deterministisch aus dem übergebenen Zufallsgenerator. */
export function generatePlayer(rng: Rng, o: GenerateOptions): Player {
  const country = COUNTRY_BY_CODE[o.nationality];
  const pool = NAME_POOLS[country?.region ?? "en"];
  const age = o.age ?? clamp(Math.round(rng.normal(25.5, 4.2)), 17, 36);
  const archetype = rng.pick(ARCHETYPES[o.position]);

  // Grundniveau 1–20, Positionsgewichte und Archetyp heben Kernwerte an
  const level = o.targetRating / 5;
  const attrs = {} as Attributes;
  const weights = POSITION_WEIGHTS[o.position];
  for (const key of ALL_ATTRS) {
    const importance = weights[key] ?? 0;
    let v = level + rng.normal(0, 2.1) + (importance - 1.4) * 0.75;
    if (archetype.boost.includes(key)) v += 2;
    if (key === "goalkeeping" && o.position !== "GK") v = rng.range(1, 5);
    if (o.position === "GK" && ["finishing", "dribbling", "crossing", "heading", "longShots", "tackling", "marking"].includes(key)) {
      v = rng.range(2, 8);
    }
    attrs[key] = clamp(Math.round(v), 1, 20);
  }
  // Physis abhängig vom Alter
  if (age >= 31) {
    attrs.pace = clamp(attrs.pace - (age - 30), 1, 20);
    attrs.acceleration = clamp(attrs.acceleration - (age - 30), 1, 20);
  }
  // Feinjustierung, damit die Stärke nahe am Ziel liegt
  let rating = ratingAt(attrs, o.position);
  for (let i = 0; i < 8 && Math.abs(rating - o.targetRating) > 1; i++) {
    const delta = rating < o.targetRating ? 1 : -1;
    for (const key of Object.keys(weights) as AttrKey[]) attrs[key] = clamp(attrs[key] + delta, 1, 20);
    rating = ratingAt(attrs, o.position);
  }

  const wonderkid = age <= 19 && rng.chance(o.youth ? 0.04 : 0.012);
  let potential: number;
  if (age <= 21) potential = rating + Math.max(0, rng.normal(14, 7)) + (wonderkid ? 18 : 0);
  else if (age <= 24) potential = rating + Math.max(0, rng.normal(6, 4));
  else if (age <= 28) potential = rating + Math.max(0, rng.normal(1.5, 2));
  else potential = rating;
  potential = clamp(Math.round(potential), rating, 96);

  const foot: Foot = o.position.endsWith("L") ? (rng.chance(0.8) ? "L" : "B") : rng.chance(0.08) ? "B" : rng.chance(0.2) ? "L" : "R";
  const altPositions = ALT_POSITIONS[o.position].filter(() => rng.chance(0.45));

  const base = { rating, age, potential };
  const reputation = o.reputation ?? 50;
  const contract: Contract | null = o.clubId === null
    ? null
    : {
      wage: wageDemand(base, reputation),
      untilSeason: o.season + rng.int(0, age < 22 ? 4 : 3),
      releaseClause: rng.chance(0.25) ? roundMoney(marketValue(base) * rng.range(1.8, 3.5)) : null,
      goalBonus: positionGoalBonus(o.position, wageDemand(base, reputation)),
    };

  return {
    id: o.id,
    clubId: o.clubId,
    firstName: rng.pick(pool.first),
    lastName: rng.pick(pool.last),
    birthYear: o.season - age,
    age,
    nationality: o.nationality,
    position: o.position,
    altPositions,
    foot,
    archetype: archetype.name,
    attrs,
    potential,
    rating,
    form: 6,
    fitness: 100,
    morale: 70,
    value: marketValue(base),
    contract,
    injuryWeeks: 0,
    suspendedWeeks: 0,
    stats: emptyStats(),
    listed: false,
    youth: !!o.youth,
    wonderkid,
    devProgress: 0,
  };
}

function positionGoalBonus(p: Position, wage: number): number {
  if (p === "ST" || p === "AMC" || p === "AMR" || p === "AML") return Math.round(wage * 0.1 / 100) * 100;
  return 0;
}

/** Kaderschablone: 25 Spieler mit sinnvoller Positionsverteilung. */
export const SQUAD_TEMPLATE: Position[] = [
  "GK", "GK", "GK",
  "DC", "DC", "DC", "DC", "DR", "DR", "DL", "DL",
  "DM", "DM", "MC", "MC", "MC", "MR", "ML",
  "AMC", "AMR", "AML",
  "ST", "ST", "ST", "MC",
];

export function displayName(p: Pick<Player, "firstName" | "lastName">): string {
  return `${p.firstName} ${p.lastName}`;
}

export function shortName(p: Pick<Player, "firstName" | "lastName">): string {
  return `${p.firstName.charAt(0)}. ${p.lastName}`;
}

/** Beste Position eines Spielers inkl. Alternativpositionen. */
export function ratingForSlot(p: Player, slot: Position): number {
  if (p.position === slot) return p.rating;
  if (p.altPositions.includes(slot)) return Math.round(ratingAt(p.attrs, slot) * 0.97);
  if (slot === "GK" || p.position === "GK") return Math.round(ratingAt(p.attrs, slot) * 0.5);
  return Math.round(ratingAt(p.attrs, slot) * 0.85);
}
