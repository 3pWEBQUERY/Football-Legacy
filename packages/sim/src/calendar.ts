/**
 * Saisonkalender: ordnet jeder Spielrunde ein echtes Datum zu. Tag 0 ist der
 * Montag, an dem die Saisonvorbereitung beginnt. Ligaspiele finden samstags
 * statt, der Kontinentalpokal dienstags und der Landespokal mittwochs danach.
 * Lange Ligen machen eine Winterpause.
 */

export type SlotKind = "league" | "cup" | "intl";

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
/** Winterpause (Tage seit Saisonbeginn): etwa 19. Dezember bis 23. Januar. */
const WINTER_FROM = 166;
const WINTER_TO = 201;
/** Letzter regulärer Ligasamstag: Ende Mai. */
const LAST_MATCHDAY = 320;

/**
 * Ligasamstage von Ende Juli bis Mai. Kurze Ligen bekommen freie Wochenenden
 * (Länderspielpausen), Ligen ab 16 Spieltagen pausieren über den Jahreswechsel.
 */
function leagueSaturdays(count: number): number[] {
  const withBreak = count >= 16;
  const available: number[] = [];
  for (let d = FIRST_MATCHDAY; d <= LAST_MATCHDAY; d += 7) {
    if (withBreak && d >= WINTER_FROM && d <= WINTER_TO) continue;
    available.push(d);
  }
  if (count >= available.length) {
    const out = [...available];
    let d = available[available.length - 1];
    while (out.length < count) out.push((d += 7));
    return out;
  }
  if (count <= 1) return available.slice(0, count);
  return Array.from({ length: count }, (_, i) => available[Math.round((i * (available.length - 1)) / (count - 1))]);
}

/** Baut den Kalender aus der Reihenfolge der Runden (Liga/Pokal). */
export function buildCalendar(kinds: SlotKind[]): SeasonCalendar {
  const leagueCount = kinds.filter((k) => k === "league").length;
  const saturdays = leagueSaturdays(leagueCount);
  const slots: CalendarSlot[] = [];
  let leagueNo = 0;
  let lastLeagueDay = FIRST_MATCHDAY - 7;
  let lastDay = FRIENDLY_DAYS[FRIENDLY_DAYS.length - 1];
  kinds.forEach((kind, i) => {
    let day: number;
    if (kind === "league") {
      day = saturdays[leagueNo++];
      lastLeagueDay = day;
    } else if (kind === "intl") {
      // Dienstag nach dem letzten Ligaspieltag
      day = leagueNo === 0 ? FIRST_MATCHDAY - 4 : lastLeagueDay + 3;
    } else {
      // Mittwoch nach dem letzten Ligaspieltag; vor dem ersten Spieltag am Mittwoch davor
      day = leagueNo === 0 ? FIRST_MATCHDAY - 3 : lastLeagueDay + 4;
    }
    if (day <= lastDay) day = lastDay + 1;
    slots.push({ week: i + 1, day, kind });
    lastDay = day;
  });
  // Winterpause: längste Lücke über den Jahreswechsel
  let winterBreak: [number, number] | null = null;
  const league = slots.filter((s) => s.kind === "league");
  for (let i = 1; i < league.length; i++) {
    const a = league[i - 1].day;
    const b = league[i].day;
    if (b - a > 21 && a < WINTER_TO && b > WINTER_FROM) winterBreak = [a + 1, b - 8];
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

export interface MarketWindow {
  open: boolean;
  label: string;
  /** Letzter Tag des Fensters */
  closes: number | null;
  /** Erster Tag des nächsten Fensters */
  opens: number | null;
}

/**
 * Transferfenster nach Datum: Sommer bis Ende August, Winter rund um die
 * Winterpause (ohne Pause rund um die Saisonmitte).
 */
export function marketWindow(cal: SeasonCalendar, day: number): MarketWindow {
  const league = cal.slots.filter((s) => s.kind === "league");
  const summerEnd = (league[0]?.day ?? FIRST_MATCHDAY) + 37;
  let ws: number;
  let we: number;
  if (cal.winterBreak) {
    ws = cal.winterBreak[0] + 7;
    we = cal.winterBreak[1] + 22;
  } else {
    const mid = league[Math.floor(league.length / 2)]?.day ?? summerEnd + 90;
    ws = mid - 10;
    we = mid + 18;
  }
  if (day <= summerEnd) return { open: true, label: "Sommer-Transferfenster", closes: summerEnd, opens: null };
  if (day >= ws && day <= we) return { open: true, label: "Winter-Transferfenster", closes: we, opens: null };
  return { open: false, label: "Transferfenster geschlossen", closes: null, opens: day < ws ? ws : null };
}
