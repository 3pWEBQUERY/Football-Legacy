/** Sichten: Liga-Wettbewerb und Spielberichte. */
import { COUNTRIES, flagEmoji, type Player } from "@fl/sim";
import { isoDate } from "../calendar-view";
import { readCareer } from "../career";
import { one, pool, query } from "../db";
import { GameError } from "../errors";
import { getClub, getLeagues, type FixtureRow } from "../repo";
import { careerSummary, clubSummary, standings } from "./common";

// ---------------------------------------------------------------- Wettbewerb

export async function competitionView(careerId: string, accountId: string, leagueId?: number) {
  const career = await readCareer(careerId, accountId);
  const leagues = await getLeagues(pool(), career.id);
  const userClub = career.club_id ? await getClub(pool(), career.id, career.club_id) : null;
  const league = leagues.find((l) => l.id === leagueId) ?? leagues.find((l) => l.id === userClub?.league_id) ?? leagues[0];
  const s = await standings(career, league.id);
  const weeks = new Map<number, unknown[]>();
  for (const f of s.fixtures.sort((a, b) => a.week - b.week || a.id - b.id)) {
    const list = weeks.get(f.week) ?? [];
    list.push({
      id: f.id, week: f.week, round: f.round, played: f.played, homeGoals: f.home_goals, awayGoals: f.away_goals,
      home: clubSummary(s.clubs.get(f.home_id)!), away: clubSummary(s.clubs.get(f.away_id)!),
    });
    weeks.set(f.week, list);
  }
  const countries = COUNTRIES.map((c) => ({
    code: c.code, name: c.name, flag: flagEmoji(c.code), strength: c.strength, confed: c.confed,
    leagues: leagues.filter((l) => l.country_code === c.code).map((l) => ({ id: l.id, name: l.name, tier: l.tier, active: l.active })),
  }));
  let scorers: unknown[] = [];
  if (league.active) {
    const rows = await query<{ data: Player; club_id: number }>(
      pool(),
      `select p.data, p.club_id from players p join clubs c on c.id = p.club_id and c.career_id = p.career_id
        where p.career_id = $1 and c.league_id = $2 and (p.data->'stats'->>'apps')::int > 0
        order by (p.data->'stats'->>'goals')::int desc, (p.data->'stats'->>'assists')::int desc limit 60`,
      [career.id, league.id],
    );
    scorers = rows.map((r) => ({
      id: r.data.id, name: `${r.data.firstName} ${r.data.lastName}`, age: r.data.age, nationality: r.data.nationality, clubId: r.club_id, club: s.clubs.get(r.club_id)?.short_name,
      colors: s.clubs.get(r.club_id)?.colors, position: r.data.position, apps: r.data.stats.apps, goals: r.data.stats.goals, assists: r.data.stats.assists,
      avgRating: r.data.stats.apps ? Math.round((r.data.stats.ratingSum / r.data.stats.apps) * 100) / 100 : 0,
    }));
  }
  return {
    career: careerSummary(career),
    league: { id: league.id, name: league.name, tier: league.tier, countryCode: league.country_code, flag: flagEmoji(league.country_code), active: league.active, promotion: league.promotion, relegation: league.relegation, size: league.size },
    table: s.rows,
    weeks: [...weeks.entries()].map(([week, matches]) => {
      const day = career.calendar?.slots[week - 1]?.day;
      return { week, matches, round: (matches[0] as { round?: number } | undefined)?.round ?? week, date: day !== undefined ? isoDate(career.season, day) : null };
    }),
    countries,
    scorers,
    userClubId: career.club_id,
  };
}

export async function matchReport(careerId: string, accountId: string, fixtureId: number) {
  const career = await readCareer(careerId, accountId);
  const f = await one<FixtureRow>(pool(), "select * from fixtures where career_id = $1 and id = $2", [career.id, fixtureId]);
  if (!f) throw new GameError("Spiel nicht gefunden", 404);
  const report = await one<{ data: unknown }>(pool(), "select data from match_reports where fixture_id = $1 and career_id = $2", [fixtureId, career.id]);
  const home = (await getClub(pool(), career.id, f.home_id))!;
  const away = (await getClub(pool(), career.id, f.away_id))!;
  return { career: careerSummary(career), fixture: f, home: clubSummary(home), away: clubSummary(away), report: report?.data ?? null };
}
