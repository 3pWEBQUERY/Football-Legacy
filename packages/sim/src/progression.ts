/** Training, Entwicklung, Alterung, Form, Moral, Verletzungen. */
import { Rng, clamp } from "./rng";
import { POSITION_WEIGHTS, marketValue, ratingAt } from "./player";
import type { AttrKey, Player } from "./types";
import { MENTAL, PHYSICAL, TECHNICAL } from "./types";
import { declineFactor, growthFactor, hasTrait, injuryFactor, moraleChange } from "./traits";

export type TrainingFocus = "balanced" | "attack" | "defense" | "physical" | "technical" | "mental" | "recovery";
export type TrainingIntensity = "low" | "normal" | "high";

export interface TrainingPlan {
  focus: TrainingFocus;
  intensity: TrainingIntensity;
  youthFocus: boolean; // Talente bekommen mehr Einheiten
}

export const DEFAULT_TRAINING: TrainingPlan = { focus: "balanced", intensity: "normal", youthFocus: false };

export const FOCUS_LABEL: Record<TrainingFocus, string> = {
  balanced: "Ausgewogen",
  attack: "Angriff",
  defense: "Abwehr",
  physical: "Physis",
  technical: "Technik",
  mental: "Taktik & Mentalität",
  recovery: "Regeneration",
};

const FOCUS_ATTRS: Record<TrainingFocus, AttrKey[]> = {
  balanced: [],
  attack: ["finishing", "offTheBall", "dribbling", "crossing", "longShots", "composure"],
  defense: ["tackling", "marking", "positioning", "heading", "anticipation"],
  physical: [...PHYSICAL],
  technical: ["technique", "firstTouch", "passing", "dribbling", "freeKicks", "corners"],
  mental: [...MENTAL],
  recovery: [],
};

export interface WeeklyContext {
  minutesLastWeek: number; // Spielminuten in dieser Woche
  coachQuality: number; // 1–20
  physioQuality: number; // 1–20
  /** Kondition wird täglich erholt (eigener Verein), nicht wöchentlich */
  skipFitness?: boolean;
  /** Trainingsverletzungen entstehen täglich im Trainingsbetrieb (eigener Verein), nicht zusätzlich wöchentlich */
  skipTrainingInjury?: boolean;
}

/** Wöchentliche Erholung bei diesem Trainingsplan. */
export function weeklyRecovery(plan: TrainingPlan, physioQuality: number): number {
  const recover = plan.focus === "recovery" ? 32 : plan.intensity === "high" ? 16 : plan.intensity === "low" ? 26 : 21;
  return recover + physioQuality * 0.3;
}

/** Tägliche Erholung der Kondition; Regenerationstage zählen doppelt. */
export function dailyRecovery(p: Player, plan: TrainingPlan, physioQuality: number, factor = 1) {
  if (p.fitness >= 100) return;
  const gain = (weeklyRecovery(plan, physioQuality) / 6) * factor;
  p.fitness = clamp(Math.round(p.fitness + gain), 30, 100);
}

/**
 * Wöchentliche Entwicklung eines Spielers. Liefert true, wenn sich die Stärke geändert hat.
 */
export function weeklyDevelopment(rng: Rng, p: Player, plan: TrainingPlan, ctx: WeeklyContext): { injured: boolean } {
  // Fitness erholt sich, Regeneration schneller
  if (!ctx.skipFitness) p.fitness = clamp(Math.round(p.fitness + weeklyRecovery(plan, ctx.physioQuality)), 30, 100);
  if (p.injuryWeeks > 0) {
    p.injuryWeeks = Math.max(0, p.injuryWeeks - (rng.chance(ctx.physioQuality / 40) ? 2 : 1));
  }
  if (p.suspendedWeeks > 0) p.suspendedWeeks--;

  // Trainingsverletzungen bei hoher Intensität
  let injured = false;
  const injuryRisk = plan.intensity === "high" ? 0.008 : plan.intensity === "low" ? 0.0015 : 0.004;
  if (!ctx.skipTrainingInjury && p.injuryWeeks === 0 && rng.chance(injuryRisk * (1.2 - ctx.physioQuality / 40) * injuryFactor(p))) {
    p.injuryWeeks = rng.int(1, 3);
    injured = true;
  }

  // Wachstum: jung + Potenzial + Spielzeit + Trainer
  const gap = p.potential - p.rating;
  let growth = 0;
  if (gap > 0) {
    const ageF = p.age <= 19 ? 1.3 : p.age <= 21 ? 1.1 : p.age <= 23 ? 0.8 : p.age <= 26 ? 0.4 : 0.15;
    const play = 0.6 + Math.min(1, ctx.minutesLastWeek / 90) * 0.6;
    const intensityF = plan.intensity === "high" ? 1.25 : plan.intensity === "low" ? 0.75 : 1;
    const focusF = plan.focus === "recovery" ? 0.4 : 1;
    const youthF = plan.youthFocus && p.age <= 21 ? 1.3 : 1;
    // Weltklasse ist selten: ab 74 wird jeder weitere Schritt mühsamer (bei 80 halb so schnell) – bremst die Inflation an der Spitze
    const eliteF = p.rating >= 74 ? clamp(1 - (p.rating - 74) / 12, 0.2, 1) : 1;
    growth = 0.055 * ageF * play * intensityF * focusF * youthF * eliteF * (0.7 + ctx.coachQuality / 33) * Math.min(1.6, gap / 8) * growthFactor(p);
  }
  // Alterung: Physis lässt ab 30 nach
  let decline = 0;
  if (p.age >= 30) decline = 0.02 * (p.age - 29) * (plan.focus === "physical" ? 0.7 : 1) * declineFactor(p);

  const dev = p.devProgress ?? 0;
  let next = dev + growth - decline;
  while (next >= 1) {
    improveAttribute(rng, p, plan.focus);
    next -= 1;
  }
  while (next <= -1) {
    declineAttribute(rng, p);
    next += 1;
  }
  p.devProgress = Math.round(next * 1000) / 1000;
  // Marktwert immer aktuell halten (auch ohne Stärkeänderung, z. B. nach Anpassungen der Wertformel)
  p.value = marketValue(p);
  return { injured };
}

function improveAttribute(rng: Rng, p: Player, focus: TrainingFocus) {
  const weights = POSITION_WEIGHTS[p.position];
  const focusAttrs = FOCUS_ATTRS[focus];
  const keys = [...TECHNICAL, ...MENTAL, ...PHYSICAL].filter((k) => p.attrs[k] < 20 && !(k === "goalkeeping" && p.position !== "GK"));
  if (!keys.length) return;
  const w = keys.map((k) => (weights[k] ?? 0.3) + (focusAttrs.includes(k) ? 2.5 : 0));
  const key = keys[rng.weighted(w)];
  p.attrs[key] = clamp(p.attrs[key] + 1, 1, 20);
  refresh(p);
}

function declineAttribute(rng: Rng, p: Player) {
  const keys: AttrKey[] = rng.chance(0.7) ? ["pace", "acceleration", "stamina", "agility", "jumping"] : ["strength", "dribbling", "firstTouch"];
  const key = rng.pick(keys);
  p.attrs[key] = clamp(p.attrs[key] - 1, 1, 20);
  refresh(p);
}

export function refresh(p: Player) {
  p.rating = ratingAt(p.attrs, p.position);
  if (p.potential < p.rating) p.potential = p.rating;
  p.value = marketValue(p);
}

/** Form und Moral nach einem Spiel. */
export function afterMatch(p: Player, matchRating: number, minutes: number, result: "W" | "D" | "L", staminaEnd: number) {
  p.form = clamp(Math.round((p.form * 0.6 + matchRating * 0.4) * 10) / 10, 1, 10);
  p.fitness = clamp(Math.round(Math.min(p.fitness, staminaEnd + 10)), 30, 100);
  moraleChange(p, (result === "W" ? 5 : result === "D" ? 0 : -5) + (matchRating >= 7.5 ? 3 : matchRating < 5.5 ? -3 : 0));
  p.stats.apps++;
  p.stats.ratingSum += matchRating;
  void minutes;
}

/** Spieler ohne Einsatz verlieren Moral, wenn sie zu den Besseren gehören. */
export function benchMorale(p: Player, squadRank: number) {
  // Ehrgeizige Stammkräfte vertragen die Bank besonders schlecht
  if (squadRank <= 14) moraleChange(p, -(squadRank <= 11 ? 4 : 2) * (hasTrait(p, "ambitious") ? 1.3 : 1));
  else p.morale = clamp(p.morale + 1, 5, 75);
  p.form = clamp(Math.round((p.form * 0.9 + 6 * 0.1) * 10) / 10, 1, 10);
}

/** Saisonende: Alterung und gelegentliche Potenzial-Überraschungen. */
export function seasonAging(rng: Rng, p: Player) {
  p.age += 1;
  // Spätzünder: Potenzialsprünge, bei ohnehin hohem Potenzial seltener
  if (p.age <= 23 && rng.chance(p.potential >= 84 ? 0.03 : 0.08)) p.potential = clamp(p.potential + rng.int(2, 6), p.rating, 96);
  if (p.age >= 24 && p.potential > p.rating && rng.chance(0.3)) p.potential = Math.max(p.rating, p.potential - rng.int(1, 3));
  p.value = marketValue(p);
}

export function retirementChance(p: Player): number {
  if (p.age < 33) return 0;
  return clamp(0.15 + (p.age - 33) * 0.2 + (p.clubId === null ? 0.25 : 0) - (p.rating - 60) / 200, 0, 0.95);
}
