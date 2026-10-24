/** Kontinentalpokal im Spielbetrieb: Qualifikation, Gruppen, Tabellen, Übersicht. */
import {
  COUNTRY_BY_CODE, GROUP_ROUNDS, Rng, allocateSlots, computeStandings, continentalName, continentalRoundName, continentalSize,
  continentalWeekPositions, drawGroups, groupMatchdays, seedFor,
} from "@fl/sim";
import { type Db, one, pool, query } from "./db";
import { activateClubs, readCareer } from "./career";
import { type CareerRow, type FixtureRow, type LeagueRow, getClubs } from "./repo";
import { fixtureWinner } from "./cup";

export interface ContinentalPlan {
  name: string;
  confed: string;
  totalRounds: number;
  positions: number[];
  groups: number[][];
}

/**
 * Teilnehmer bestimmen und Gruppen auslosen. In der ersten Saison entscheidet
 * der Ruf, danach die Abschlusstabelle der Vorsaison.
 */
export async function planContinental(db: Db, career: CareerRow, countryCode: string, leagues: LeagueRow[], leagueWeeks: number, avoid: number[]): Promise<ContinentalPlan | null> {
  const confed = COUNTRY_BY_CODE[countryCode]?.confed;
  if (!confed) return null;
  const top = leagues.filter((l) => l.tier === 1 && COUNTRY_BY_CODE[l.country_code]?.confed === confed);
  const countries = top.map((l) => ({ code: l.country_code, strength: COUNTRY_BY_CODE[l.country_code].strength, leagueSize: l.size }));
  const size = continentalSize(countries);
  if (!size) return null;
  const slots = allocateSlots(countries, size);
  const clubs = await getClubs(db, career.id, "league_id = any($2::int[])", [top.map((l) => l.id)]);
  const tables = career.qualifiers?.season === career.season ? career.qualifiers.tables : {};
  const teams: { id: number; rating: number; country: string }[] = [];
  for (const l of top) {
    const n = slots.get(l.country_code) ?? 0;
    if (!n) continue;
    const own = clubs.filter((c) => c.league_id === l.id);
    const ranking = tables[l.country_code]?.filter((id) => own.some((c) => c.id === id))
      ?? [...own].sort((a, b) => b.reputation - a.reputation || b.rating - a.rating).map((c) => c.id);
    for (const id of ranking.slice(0, n)) {
      const c = own.find((x) => x.id === id)!;
      teams.push({ id, rating: c.rating, country: l.country_code });
    }
  }
  if (teams.length !== size) return null;
  // Teilnehmer aus anderen Ländern brauchen echte Kader
  const leagueMap = new Map(leagues.map((l) => [l.id, l]));
  await activateClubs(db, career, clubs.filter((c) => teams.some((t) => t.id === c.id)), leagueMap);
  const rated = await getClubs(db, career.id, "id = any($2::int[])", [teams.map((t) => t.id)]);
  for (const t of teams) t.rating = rated.find((c) => c.id === t.id)?.rating ?? t.rating;
  const groups = drawGroups(new Rng(seedFor(career.seed, "continental", career.season)), teams);
  const totalRounds = GROUP_ROUNDS + Math.log2(groups.length * 2);
  return { name: continentalName(confed), confed, totalRounds, positions: continentalWeekPositions(totalRounds, leagueWeeks, avoid), groups };
}

export async function insertContinental(db: Db, career: CareerRow, plan: ContinentalPlan, weeks: number[]) {
  const rounds = weeks.map((week, i) => ({ round: i + 1, name: continentalRoundName(i + 1, plan.totalRounds), week }));
  const cup = await one<{ id: number }>(
    db,
    "insert into cups(career_id, season, country_code, name, rounds, byes, kind, groups) values ($1,$2,$3,$4,$5,'[]','continental',$6) returning id",
    [career.id, career.season, plan.confed, plan.name, JSON.stringify(rounds), JSON.stringify(plan.groups)],
  );
  const rows: { h: number; a: number; round: number; week: number; group: number }[] = [];
  plan.groups.forEach((g, gi) => {
    groupMatchdays(g).forEach((pairs, md) => {
      for (const [h, a] of pairs) rows.push({ h, a, round: md + 1, week: rounds[md].week, group: gi });
    });
  });
  await query(
    db,
    `insert into fixtures(career_id, season, league_id, week, round, home_id, away_id, cup_id, cup_round, group_no)
     select $1, $2, 0, w, r, h, a, $3, r, g from unnest($4::int[], $5::int[], $6::int[], $7::int[], $8::int[]) as t(h, a, r, w, g)`,
    [career.id, career.season, cup!.id, rows.map((x) => x.h), rows.map((x) => x.a), rows.map((x) => x.round), rows.map((x) => x.week), rows.map((x) => x.group)],
  );
}

/** Tabelle einer Gruppe aus den gespielten Partien. */
export function groupTable(group: number[], fixtures: FixtureRow[], groupNo: number) {
  return computeStandings(group, fixtures.filter((f) => f.group_no === groupNo && f.played).map((f) => ({
    homeId: f.home_id, awayId: f.away_id, homeGoals: f.home_goals, awayGoals: f.away_goals, round: f.cup_round ?? 0,
  })));
}

/** Übersicht für die Oberfläche: Gruppen mit Tabellen, K.-o.-Runden. */
export async function continentalView(careerId: string, accountId: string, season?: number) {
  const career = await readCareer(careerId, accountId);
  const s = season ?? career.season;
  const cup = await one<{ id: number; name: string; season: number; rounds: { round: number; name: string; week: number }[]; groups: number[][]; current_round: number; winner_club_id: number | null }>(
    pool(), "select * from cups where career_id = $1 and season = $2 and kind = 'continental' order by id desc limit 1", [career.id, s],
  );
  if (!cup) return { cup: null, groups: [], rounds: [], userClubId: career.club_id };
  const fixtures = await query<FixtureRow>(pool(), "select * from fixtures where career_id = $1 and cup_id = $2 order by cup_round, id", [career.id, cup.id]);
  const ids = [...new Set(cup.groups.flat())];
  const clubs = await getClubs(pool(), career.id, "id = any($2::int[])", [ids]);
  const byId = new Map(clubs.map((c) => [c.id, { id: c.id, name: c.name, short: c.short_name, colors: c.colors, rating: c.rating, countryCode: c.country_code }]));
  const slotDay = (week: number) => career.season === s ? career.calendar?.slots[week - 1]?.day ?? null : null;
  const groups = cup.groups.map((g, gi) => ({
    name: `Gruppe ${String.fromCharCode(65 + gi)}`,
    table: groupTable(g, fixtures, gi).map((r, i) => ({ ...r, position: i + 1, club: byId.get(r.clubId)! })),
    matches: fixtures.filter((f) => f.group_no === gi).map((f) => matchView(f, byId)),
  }));
  const rounds = cup.rounds.map((r) => ({
    ...r,
    day: slotDay(r.week),
    current: r.round === cup.current_round && !cup.winner_club_id,
    group: r.round <= GROUP_ROUNDS,
    matches: fixtures.filter((f) => f.cup_round === r.round && f.group_no === null).map((f) => matchView(f, byId)),
  }));
  return {
    cup: { id: cup.id, name: cup.name, season: cup.season, currentRound: cup.current_round, winner: cup.winner_club_id ? byId.get(cup.winner_club_id) : null, size: ids.length },
    groups,
    rounds,
    userClubId: career.club_id,
    participating: ids.includes(career.club_id ?? -1),
  };
}

function matchView(f: FixtureRow, byId: Map<number, unknown>) {
  return {
    id: f.id, round: f.cup_round, played: f.played, homeGoals: f.home_goals, awayGoals: f.away_goals, penHome: f.pen_home, penAway: f.pen_away,
    home: byId.get(f.home_id), away: byId.get(f.away_id), winnerId: f.played && f.group_no === null ? fixtureWinner(f) : null,
  };
}
