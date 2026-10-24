/**
 * Tägliche Trainingseinheiten: Inhalt nach Wochentag und Schwerpunkt,
 * Trainingsnoten je Spieler. Die Trainingsform wirkt leicht auf die Spielform.
 */
import type { TrainingFocus, TrainingPlan } from "./progression";
import type { Rng } from "./rng";
import type { Player } from "./types";

const SESSIONS: Record<TrainingFocus, string[]> = {
  balanced: ["Kondition", "Taktik", "Technik", "Spielformen", "Taktik", "Abschluss"],
  attack: ["Angriffsmuster", "Abschluss", "Kombinationsspiel", "Flanken und Kopfball", "Spielformen", "Abschluss"],
  defense: ["Defensivverhalten", "Zweikämpfe", "Pressing", "Defensive Organisation", "Spielformen", "Standards defensiv"],
  physical: ["Ausdauer", "Schnelligkeit", "Kraft", "Kondition", "Spielformen", "Athletik"],
  technical: ["Ballkontrolle", "Passspiel", "Dribbling", "Abschluss", "Spielformen", "Kombinationsspiel"],
  mental: ["Spielintelligenz", "Entscheidungen unter Druck", "Positionsspiel", "Videoanalyse", "Spielformen", "Umschaltspiel"],
  recovery: ["Leichtes Training", "Regeneration", "Leichtes Training", "Technik locker", "Spielformen", "Leichtes Training"],
};

export function sessionName(plan: TrainingPlan, weekday: number, prep: boolean): string {
  if (prep) return "Spielvorbereitung: Taktik und Standards";
  return SESSIONS[plan.focus][Math.min(5, Math.max(0, weekday))];
}

/** Trainingsnote 1–10 (Durchschnitt um 6,5). */
export function trainingRating(rng: Rng, p: Player, plan: TrainingPlan): number {
  let r = 6.4 + (p.attrs.workRate - 10) * 0.05 + (p.morale - 60) * 0.008 + (p.form - 6.5) * 0.25;
  if (p.fitness < 70) r -= 0.3;
  r += rng.normal(0, plan.intensity === "high" ? 0.65 : 0.5);
  return Math.round(Math.max(4, Math.min(9.6, r)) * 10) / 10;
}

/** Note speichern (letzte fünf Einheiten) und Spielform leicht anpassen. */
export function applyTrainingRating(p: Player, rating: number) {
  p.training = [...(p.training ?? []).slice(-4), rating];
  p.form = Math.round(Math.max(1, Math.min(10, p.form + (rating - 6.5) * 0.04)) * 100) / 100;
}

export function trainingAverage(p: Pick<Player, "training">): number | null {
  const t = p.training ?? [];
  return t.length ? Math.round((t.reduce((a, b) => a + b, 0) / t.length) * 10) / 10 : null;
}
