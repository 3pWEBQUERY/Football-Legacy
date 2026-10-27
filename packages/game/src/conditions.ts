/** Wetter und Schiedsrichter je Spiel – aus dem Datum im Kalender und dem Land des Heimteams. */
import { WEATHER, conditionsFor, dateOf, refereeStyle, type MatchConditions } from "@fl/sim";
import type { CareerRow } from "./repo";

export function fixtureConditions(career: Pick<CareerRow, "seed" | "season" | "calendar">, f: { id: number; week: number }, countryCode: string): MatchConditions {
  const slot = career.calendar?.slots?.[f.week - 1];
  const month = slot ? dateOf(career.season, slot.day).getUTCMonth() + 1 : 9;
  return conditionsFor(career.seed, f.id, countryCode, month);
}

/** Für Vorbericht, Spiel und Bericht: verständliche Beschriftung. */
export function conditionsView(c: MatchConditions | null | undefined) {
  if (!c) return null;
  const w = WEATHER[c.weather];
  return {
    weather: c.weather, weatherLabel: w.label, weatherIcon: w.icon, weatherText: w.text, temperature: c.temperature,
    referee: c.referee.name, strictness: c.referee.strictness, refereeStyle: refereeStyle(c.referee.strictness),
  };
}
