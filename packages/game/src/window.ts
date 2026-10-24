/** Transferfenster der Karriere nach Datum (ältere Spielstände ohne Kalender: nach Spielrunde). */
import { marketWindow, transferWindow, type MarketWindow } from "@fl/sim";
import type { CareerRow } from "./repo";

export function windowFor(career: CareerRow, day = career.day): MarketWindow {
  if (career.calendar?.slots?.length) return marketWindow(career.calendar, day);
  return { ...transferWindow(career.week, career.season_weeks), closes: null, opens: null };
}
