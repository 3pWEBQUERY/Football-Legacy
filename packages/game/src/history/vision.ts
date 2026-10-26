/**
 * Vorstandsvision: ein Dreijahresplan neben dem Saisonziel. Der Vorstand legt
 * ein sportliches Ziel und zwei Vereinsziele (Jugend, Finanzen, Ruf, Pokal)
 * fest. Jedes Saisonende wird der Fortschritt bewertet; erreichte Ziele und
 * das Gesamturteil nach drei Jahren wirken auf das Vertrauen.
 */
import { Rng, formatMoney, seedFor } from "@fl/sim";
import { query, type Db } from "../db";
import type { CareerRow, ClubRow, LeagueRow } from "../repo";

export type VisionKind = "promotion" | "title" | "position" | "youth" | "finance" | "reputation" | "cup";

export interface VisionGoal {
  kind: VisionKind;
  text: string;
  target: number;
  /** Bester bzw. aktueller Wert (je nach Ziel) */
  current: number;
  /** Ausgangswert beim Start der Vision (Finanzen, Ruf) */
  base?: number;
  met: boolean;
}

export interface VisionReview { season: number; met: number; total: number; delta: number; text: string }

export interface Vision {
  clubId: number;
  startSeason: number;
  endSeason: number;
  headline: string;
  goals: VisionGoal[];
  reviews: VisionReview[];
}

export const VISION_YEARS = 3;

/** Bilanz einer abgeschlossenen Vision. */
export interface VisionResult { clubId: number; startSeason: number; endSeason: number; headline: string; met: number; total: number; text: string }

/** Stand der Saison, nach dem die Vision bewertet wird. */
export interface VisionSeason {
  season: number;
  /** Liga-Stufe der kommenden Saison (nach Auf- und Abstieg) */
  nextTier: number;
  position: number;
  champion: boolean;
  /** Pokalabschneiden ("Sieger", "Finale", Rundenname) */
  cup: string | null;
  /** Eigengewächse mit mindestens 10 Einsätzen */
  youthRegulars: number;
  balance: number;
  reputation: number;
}

const round = (v: number, step: number) => Math.round(v / step) * step;

export async function createVision(db: Db, career: CareerRow, club: ClubRow, league: LeagueRow, expected: number): Promise<Vision> {
  const rng = new Rng(seedFor(career.seed, "vision", club.id, career.season));
  const end = career.season + VISION_YEARS - 1;
  const goals: VisionGoal[] = [];
  let headline: string;
  if (league.tier > 1) {
    const upper = (await query<{ name: string }>(db, "select name from leagues where career_id = $1 and country_code = $2 and tier = $3", [career.id, league.country_code, league.tier - 1]))[0];
    goals.push({ kind: "promotion", text: `Aufstieg in die ${upper?.name ?? "höhere Liga"} bis ${end}`, target: league.tier - 1, current: league.tier, met: false });
    headline = "Der Weg nach oben";
  } else if (expected <= 2) {
    goals.push({ kind: "title", text: `Mindestens ein Meistertitel bis ${end}`, target: 1, current: 0, met: false });
    headline = "Eine Ära prägen";
  } else {
    const target = Math.max(1, Math.min(league.size, expected <= 6 ? 3 : expected - 4));
    goals.push({ kind: "position", text: `Einmal Platz ${target} oder besser bis ${end}`, target, current: 0, met: false });
    headline = expected >= league.size - league.relegation - 1 ? "Fest in der Liga ankommen" : "Den nächsten Schritt machen";
  }
  const extras: VisionGoal[] = [
    { kind: "youth", text: "3 Eigengewächse als Stammkräfte (je mindestens 10 Einsätze in einer Saison)", target: 3, current: 0, met: false },
    {
      kind: "finance", text: "", target: round(Math.max(club.balance * 1.25, club.balance + 2_000_000), 100_000), current: club.balance, base: club.balance, met: false,
    },
    { kind: "reputation", text: `Vereinsruf auf ${Math.min(100, club.reputation + 6)} steigern`, target: Math.min(100, club.reputation + 6), current: club.reputation, base: club.reputation, met: false },
    { kind: "cup", text: "Ein Pokalfinale erreichen", target: 1, current: 0, met: false },
  ];
  const fin = extras.find((g) => g.kind === "finance")!;
  fin.text = `Kontostand bis ${end} auf ${formatMoney(fin.target)} steigern`;
  goals.push(...rng.shuffle(extras).slice(0, 2));
  return { clubId: club.id, startSeason: career.season, endSeason: end, headline, goals, reviews: [] };
}

/** Behält die laufende Vision, solange sie zum Verein passt und nicht abgelaufen ist. */
export async function visionFor(db: Db, career: CareerRow, club: ClubRow, league: LeagueRow, expected: number): Promise<Vision> {
  const v = career.board?.vision;
  if (v && v.clubId === club.id && v.endSeason >= career.season) return v;
  return createVision(db, career, club, league, expected);
}

/**
 * Bewertet die Vision nach einer Saison. Liefert die Veränderung des
 * Vertrauens und einen Text für den Posteingang.
 */
export function reviewVision(v: Vision, s: VisionSeason): VisionReview {
  const before = new Set(v.goals.filter((g) => g.met).map((g) => g.kind));
  const final = s.season >= v.endSeason;
  for (const g of v.goals) {
    switch (g.kind) {
      case "promotion": g.current = Math.min(g.current, s.nextTier); g.met = g.current <= g.target; break;
      case "title": g.current += s.champion ? 1 : 0; g.met = g.current >= g.target; break;
      case "position": g.current = g.current ? Math.min(g.current, s.position) : s.position; g.met = g.current <= g.target; break;
      case "youth": g.current = Math.max(g.current, s.youthRegulars); g.met = g.current >= g.target; break;
      case "cup": g.current += s.cup === "Sieger" || s.cup === "Finale" ? 1 : 0; g.met = g.current >= g.target; break;
      // Finanzen und Ruf zählen beim Stand am Ende, nicht als einmaliger Ausschlag
      case "finance": g.current = s.balance; g.met = g.current >= g.target; break;
      case "reputation": g.current = s.reputation; g.met = g.current >= g.target; break;
    }
  }
  const met = v.goals.filter((g) => g.met).length;
  const fresh = v.goals.filter((g) => g.met && !before.has(g.kind) && g.kind !== "finance" && g.kind !== "reputation");
  let delta = fresh.length * 4;
  let text: string;
  if (final) {
    const share = met / v.goals.length;
    delta += share >= 2 / 3 ? 10 : share > 0 ? -4 : -15;
    text = share === 1 ? `Vision „${v.headline}“ vollständig erfüllt – der Vorstand ist begeistert.`
      : share >= 2 / 3 ? `Vision „${v.headline}“ grösstenteils erfüllt (${met}/${v.goals.length}).`
      : share > 0 ? `Vision „${v.headline}“ nur teilweise erreicht (${met}/${v.goals.length}).`
      : `Vision „${v.headline}“ klar verfehlt – der Vorstand ist enttäuscht.`;
  } else {
    const left = v.endSeason - s.season;
    text = met === v.goals.length ? "Alle Ziele der Vision sind bereits erreicht."
      : `${met} von ${v.goals.length} Zielen der Vision erreicht – noch ${left} ${left === 1 ? "Saison" : "Saisons"}.`;
    if (fresh.length) text += ` Neu erreicht: ${fresh.map((g) => g.text).join("; ")}.`;
  }
  const review = { season: s.season, met, total: v.goals.length, delta, text };
  v.reviews = [...v.reviews, review];
  return review;
}

/** Fortschritt eines Ziels in Prozent (für die Anzeige). */
export function goalProgress(g: VisionGoal): number {
  if (g.met) return 100;
  if (g.kind === "promotion" || g.kind === "position") return 0;
  if (g.base !== undefined && g.target > g.base) return Math.max(0, Math.min(99, Math.round(((g.current - g.base) / (g.target - g.base)) * 100)));
  return Math.max(0, Math.min(99, Math.round((g.current / Math.max(1, g.target)) * 100)));
}

/** Aufbereitung für die Vorstandsseite. */
export function visionPayload(v: Vision, season: number) {
  const year = Math.min(VISION_YEARS, season - v.startSeason + 1);
  const met = v.goals.filter((g) => g.met).length;
  const share = met / v.goals.length;
  const status = met === v.goals.length ? "erfüllt" : share >= 2 / 3 ? "auf Kurs" : year === 1 ? "am Anfang" : year >= VISION_YEARS ? "in Gefahr" : "Rückstand";
  return {
    ...v, year, years: VISION_YEARS, met, status,
    goals: v.goals.map((g) => ({ ...g, progress: goalProgress(g) })),
  };
}
