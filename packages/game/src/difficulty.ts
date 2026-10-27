/** Schwierigkeitsgrad: Startkapital, Einnahmen, Geduld des Vorstands und Vermächtnis-Faktor. */
import { financeProfile } from "@fl/sim";
import type { CareerRow, ClubRow } from "./repo";

export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTY: Record<Difficulty, {
  label: string; text: string;
  /** Startkapital und Transferbudget */ money: number;
  /** Überschuss der laufenden Einnahmen: (margin − 1) × Gehälter */ margin: number;
  /** Verschiebt den Vertrauenswert, auf den der Vorstand zusteuert */ board: number;
  /** Entlassung während der Saison / am Saisonende unter diesem Vertrauen */ sackSeason: number; sackEnd: number;
  /** Faktor für Vermächtnis-Punkte in der Ruhmeshalle */ legacy: number;
}> = {
  easy: {
    label: "Leicht", text: "Mehr Geld, ein geduldiger Vorstand. Ideal zum Kennenlernen.",
    money: 1.4, margin: 1.14, board: 10, sackSeason: 6, sackEnd: 12, legacy: 0.75,
  },
  normal: {
    label: "Normal", text: "Ausgewogen – so ist das Spiel gedacht.",
    money: 1, margin: 1.06, board: 0, sackSeason: 12, sackEnd: 20, legacy: 1,
  },
  hard: {
    label: "Schwer", text: "Knappe Kassen, ungeduldiger Vorstand. Für erfahrene Manager.",
    money: 0.75, margin: 1.0, board: -8, sackSeason: 18, sackEnd: 26, legacy: 1.25,
  },
};

export const difficultyOf = (career: Pick<CareerRow, "manager">): Difficulty => career.manager.difficulty ?? "normal";
export const difficultySettings = (career: Pick<CareerRow, "manager">) => DIFFICULTY[difficultyOf(career)];

export function parseDifficulty(v: unknown): Difficulty {
  return v === "easy" || v === "hard" ? v : "normal";
}

/** Startbedingungen des eigenen Vereins je nach Schwierigkeitsgrad. */
export function applyDifficultyStart(club: ClubRow, tier: number, d: Difficulty) {
  const s = DIFFICULTY[d];
  club.balance = Math.round((club.balance * s.money) / 10_000) * 10_000;
  club.transfer_budget = Math.round((club.transfer_budget * s.money) / 10_000) * 10_000;
  const f = club.finance;
  if (f?.baseWages) {
    club.finance = { ...financeProfile({ countryCode: club.country_code, reputation: club.reputation, capacity: club.capacity }, f.baseWages, tier, s.margin), ticketPrice: f.ticketPrice };
  }
}
