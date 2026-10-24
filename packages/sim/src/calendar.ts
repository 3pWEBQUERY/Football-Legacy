/**
 * Saisonkalender: ordnet jeder Spielrunde ein echtes Datum zu. Tag 0 ist der
 * Montag, an dem die Saisonvorbereitung beginnt. Ligaspiele finden samstags
 * statt, Pokalrunden am Mittwoch danach. Lange Ligen machen eine Winterpause.
 */

export type SlotKind = "league" | "cup";

export interface CalendarSlot {
  /** Spielrunde (entspricht career.week nach der Verarbeitung) */
  week: number;
  /** Tag seit Saisonbeginn */
  day: number;
  kind: SlotKind;
}

export interface SeasonCalendar {
  slots: CalendarSlot[];
  /** Tage mit Testspielen in der Vorbereitung */
  friendlies: number[];
  /** Erster und letzter Tag der Winterpause */
  winterBreak: [number, number] | null;
}

/** Erster Ligaspieltag: Samstag der dritten Vorbereitungswoche. */
export const FIRST_MATCHDAY = 19;
export const FRIENDLY_DAYS = [9, 13];
const WINTER_BREAK_DAYS = 28;

/** Montag der ersten Juliwoche (UTC). */
export function seasonStart(season: number): Date {
  const d = new Date(Date.UTC(season, 6, 1));
  const shift = (8 - d.getUTCDay()) % 7; // auf den nächsten Montag (oder bleibt Montag)
  d.setUTCDate(d.getUTCDate() + shift);
  return d;
}

export function dateOf(season: number, day: number): Date {
  const d = seasonStart(season);
  d.setUTCDate(d.getUTCDate() + day);
  return d;
}

/** 0 = Montag … 6 = Sonntag */
export function weekdayOf(day: number): number {
  return ((day % 7) + 7) % 7;
}

/** Baut den Kalender aus der Reihenfolge der Runden (Liga/Pokal). */
export function buildCalendar(kinds: SlotKind[]): SeasonCalendar {
  const leagueCount = kinds.filter((k) => k === "league").length;
  const mid = Math.ceil(leagueCount / 2);
  const withBreak = leagueCount >= 16;
  const slots: CalendarSlot[] = [];
  let leagueNo = 0;
  let lastLeagueDay = FIRST_MATCHDAY - 7;
  let lastDay = FRIENDLY_DAYS[FRIENDLY_DAYS.length - 1];
  kinds.forEach((kind, i) => {
    let day: number;
    if (kind === "league") {
      leagueNo++;
      day = FIRST_MATCHDAY + (leagueNo - 1) * 7 + (withBreak && leagueNo > mid ? WINTER_BREAK_DAYS : 0);
      lastLeagueDay = day;
    } else {
      // Mittwoch nach dem letzten Ligaspieltag; vor dem ersten Spieltag am Mittwoch davor
      day = leagueNo === 0 ? FIRST_MATCHDAY - 3 : lastLeagueDay + 4;
    }
    if (day <= lastDay) day = lastDay + 1;
    slots.push({ week: i + 1, day, kind });
    lastDay = day;
  });
  let winterBreak: [number, number] | null = null;
  if (withBreak) {
    const before = slots.filter((s) => s.kind === "league")[mid - 1];
    const after = slots.find((s) => s.kind === "league" && s.day > before.day);
    if (before && after) winterBreak = [before.day + 1, after.day - 8];
  }
  return { slots, friendlies: [...FRIENDLY_DAYS], winterBreak };
}

/** Anteil einer Woche, der seit dem letzten Ligaspieltag vergangen ist (für laufende Kosten). */
export function weeksSincePreviousLeague(cal: SeasonCalendar, week: number): number {
  const slot = cal.slots[week - 1];
  if (!slot || slot.kind !== "league") return 0;
  const prev = [...cal.slots.slice(0, week - 1)].reverse().find((s) => s.kind === "league");
  return prev ? (slot.day - prev.day) / 7 : 1;
}

export type DayType = "match" | "friendly" | "recovery" | "prep" | "training" | "off" | "holiday";

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  match: "Spieltag",
  friendly: "Testspiel",
  recovery: "Regeneration",
  prep: "Spielvorbereitung",
  training: "Training",
  off: "Trainingsfrei",
  holiday: "Winterpause",
};

/**
 * Tagesart aus Sicht des eigenen Vereins. `matchDays` sind die Tage mit
 * eigenen Pflichtspielen.
 */
export function dayType(cal: SeasonCalendar, day: number, matchDays: Set<number>): DayType {
  if (matchDays.has(day)) return "match";
  if (cal.friendlies.includes(day)) return "friendly";
  if (matchDays.has(day - 1) || cal.friendlies.includes(day - 1)) return "recovery";
  if (matchDays.has(day + 1) || cal.friendlies.includes(day + 1)) return "prep";
  if (cal.winterBreak && day >= cal.winterBreak[0] && day <= cal.winterBreak[0] + 13) return "holiday";
  if (weekdayOf(day) === 6) return "off";
  return "training";
}
