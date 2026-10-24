/** Kalender der Saison aus Sicht des eigenen Vereins. */
import { DAY_TYPE_LABEL, dateOf, dayType, marketWindow } from "@fl/sim";
import { pool, query } from "./db";
import { readCareer } from "./career";
import { userMatchDays } from "./day";
import type { CareerRow } from "./repo";

export function isoDate(season: number, day: number) {
  return dateOf(season, day).toISOString().slice(0, 10);
}

/** Tage, an denen das Transferfenster offen ist. */
function windowDays(career: CareerRow): Set<number> {
  const out = new Set<number>();
  const cal = career.calendar;
  if (!cal?.slots.length) return out;
  const last = cal.slots[cal.slots.length - 1].day;
  for (let d = 0; d <= last; d++) if (marketWindow(cal, d).open) out.add(d);
  return out;
}

export async function calendarView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const cal = career.calendar!;
  const fixtures = await userMatchDays(pool(), career);
  const matchDays = new Set(fixtures.keys());
  const ids = [...new Set([...fixtures.values()].flatMap((f) => [f.home_id, f.away_id]))];
  const clubs = ids.length
    ? await query<{ id: number; name: string; short_name: string; colors: unknown }>(pool(), "select id, name, short_name, colors from clubs where career_id = $1 and id = any($2::int[])", [career.id, ids])
    : [];
  const byId = new Map(clubs.map((c) => [c.id, c]));
  const cupNames = new Map((await query<{ id: number; name: string; kind: string; rounds: { round: number; name: string }[] }>(pool(),
    "select id, name, kind, rounds from cups where career_id = $1 and season = $2", [career.id, career.season])).map((c) => [c.id, c]));
  const last = cal.slots.length ? cal.slots[cal.slots.length - 1].day : 0;
  const window = windowDays(career);
  const days = [];
  for (let d = 0; d <= last; d++) {
    const f = fixtures.get(d);
    const type = dayType(cal, d, matchDays);
    let match = null;
    if (f) {
      const home = f.home_id === career.club_id;
      const opp = byId.get(home ? f.away_id : f.home_id);
      const cup = f.cup_id ? cupNames.get(f.cup_id) : null;
      match = {
        fixtureId: f.id, home, played: f.played, opponent: opp ? { id: opp.id, name: opp.name, short: opp.short_name, colors: opp.colors } : null,
        competition: cup ? `${cup.name} · ${cup.rounds.find((r) => r.round === f.cup_round)?.name ?? ""}` : `${f.round}. Spieltag`,
        cup: !!f.cup_id,
        continental: cup?.kind === "continental",
        goalsFor: f.played ? (home ? f.home_goals : f.away_goals) : null,
        goalsAgainst: f.played ? (home ? f.away_goals : f.home_goals) : null,
      };
    }
    days.push({ day: d, date: isoDate(career.season, d), type, label: DAY_TYPE_LABEL[type], window: window.has(d), match });
  }
  return {
    season: career.season,
    today: career.day,
    todayDate: isoDate(career.season, career.day),
    trainingFocus: career.training.focus,
    winterBreak: cal.winterBreak,
    days,
  };
}

/** Die nächsten Tage für Büro und Kopfleiste. */
export async function upcomingDays(career: CareerRow, count = 7) {
  if (!career.calendar) return [];
  const fixtures = await userMatchDays(pool(), career);
  const matchDays = new Set(fixtures.keys());
  const out = [];
  for (let d = career.day; d < career.day + count; d++) {
    const type = dayType(career.calendar, d, matchDays);
    out.push({ day: d, date: isoDate(career.season, d), type, label: DAY_TYPE_LABEL[type], fixtureId: fixtures.get(d)?.id ?? null });
  }
  return out;
}
