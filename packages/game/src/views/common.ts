/** Sichten: gemeinsame Bausteine (Spieler- und Vereinsdarstellung, Scouting-Wissen, Tabellen, Karriere-Kopf). */
import { ALL_ATTRS, Rng, UNLOCKS, computeStandings, flagEmoji, seedFor, titleForLevel, trainingAverage, xpForLevel, type Player, type Position } from "@fl/sim";
import { isoDate } from "../calendar-view";
import { pool, query } from "../db";
import { getClubs, type CareerRow, type ClubRow, type FixtureRow } from "../repo";
import { DEFAULT_STOP_ON } from "../settings";

export function clubSummary(c: ClubRow) {
  return {
    id: c.id, name: c.name, short: c.short_name, city: c.city, colors: c.colors, rating: c.rating, reputation: c.reputation,
    countryCode: c.country_code, leagueId: c.league_id, capacity: c.capacity, founded: c.founded,
  };
}

type Knowledge = "exact" | "good" | "rough";

/** Spieler für die Oberfläche; fremde Spieler nur so genau, wie das Scouting reicht. */
export function playerView(p: Player, knowledge: Knowledge, extra: Record<string, unknown> = {}) {
  const base = {
    id: p.id, firstName: p.firstName, lastName: p.lastName, name: `${p.firstName} ${p.lastName}`, age: p.age,
    nationality: p.nationality, flag: flagEmoji(p.nationality), position: p.position, altPositions: p.altPositions,
    foot: p.foot, archetype: p.archetype, form: p.form, fitness: p.fitness, morale: p.morale, value: p.value,
    contract: p.contract, injuryWeeks: p.injuryWeeks, suspendedWeeks: p.suspendedWeeks, stats: p.stats, listed: p.listed,
    youth: p.youth, clubId: p.clubId, history: p.history ?? [], loan: p.loan ?? null, promise: p.promise ?? null, talk: p.talk ?? null, trainingAvg: trainingAverage(p), individual: p.individual ?? null, injury: p.injury ?? null, caps: p.caps ?? 0, intlGoals: p.intlGoals ?? 0, away: p.away ?? null, squadStatus: p.squadStatus ?? null, playing: p.playing ?? null, transferRequest: !!p.transferRequest, awards: p.awards ?? [], knowledge, ...extra,
  };
  if (knowledge === "exact") {
    return { ...base, rating: p.rating, potential: p.potential, wonderkid: p.wonderkid, attrs: p.attrs, ratingRange: [p.rating, p.rating], attrRanges: null };
  }
  const rng = new Rng(seedFor("scout-noise", p.id));
  const spread = knowledge === "good" ? 1 : 3;
  const attrRanges: Record<string, [number, number]> = {};
  for (const k of ALL_ATTRS) {
    const center = p.attrs[k] + Math.round(rng.normal(0, spread / 2));
    attrRanges[k] = [Math.max(1, center - spread), Math.min(20, center + spread)];
  }
  const rs = knowledge === "good" ? 2 : 5;
  const rc = p.rating + Math.round(rng.normal(0, rs / 2));
  return {
    ...base, rating: null, potential: null, wonderkid: false, attrs: null, attrRanges,
    ratingRange: [Math.max(1, rc - rs), Math.min(100, rc + rs)],
  };
}

export async function knowledgeFor(career: CareerRow, players: Player[], userLeagueId: number | null) {
  const shortlist = await query<{ player_id: number; report: unknown }>(pool(), "select player_id, report from shortlist where career_id = $1", [career.id]);
  const reported = new Set(shortlist.filter((s) => s.report && !(s.report as { pending?: boolean }).pending).map((s) => s.player_id));
  const listed = new Set(shortlist.map((s) => s.player_id));
  const clubLeague = new Map<number, number>();
  const clubIds = [...new Set(players.map((p) => p.clubId).filter((x): x is number => x !== null))];
  if (clubIds.length) {
    const rows = await query<{ id: number; league_id: number }>(pool(), "select id, league_id from clubs where career_id = $1 and id = any($2::int[])", [career.id, clubIds]);
    for (const r of rows) clubLeague.set(r.id, r.league_id);
  }
  return {
    of(p: Player): Knowledge {
      if (p.clubId === career.club_id || reported.has(p.id)) return "exact";
      if (p.clubId !== null && clubLeague.get(p.clubId) === userLeagueId) return "good";
      return "rough";
    },
    shortlisted: listed,
    reported,
  };
}

export async function standings(career: CareerRow, leagueId: number, season = career.season) {
  const clubs = await getClubs(pool(), career.id, "league_id = $2", [leagueId]);
  const fixtures = await query<FixtureRow>(pool(), "select * from fixtures where career_id = $1 and season = $2 and league_id = $3", [career.id, season, leagueId]);
  // Nach Saisonwechsel enthält die Liga andere Vereine; Tabelle aus den Spielen der Saison
  const ids = season === career.season ? clubs.map((c) => c.id) : [...new Set(fixtures.flatMap((f) => [f.home_id, f.away_id]))];
  const table = computeStandings(ids, fixtures.map((f) => ({ homeId: f.home_id, awayId: f.away_id, homeGoals: f.home_goals, awayGoals: f.away_goals, round: f.round })));
  const byId = new Map(clubs.map((c) => [c.id, c]));
  const extra = ids.filter((id) => !byId.has(id));
  if (extra.length) for (const c of await getClubs(pool(), career.id, "id = any($2::int[])", [extra])) byId.set(c.id, c);
  return {
    rows: table.map((r, i) => ({ ...r, position: i + 1, club: clubSummary(byId.get(r.clubId)!) })),
    fixtures,
    clubs: byId,
  };
}


export function careerSummary(career: CareerRow) {
  const m = career.manager;
  return {
    id: career.id,
    managerName: career.manager_name,
    season: career.season,
    week: career.week,
    seasonWeeks: career.season_weeks,
    day: career.day,
    date: isoDate(career.season, career.day),
    nextMatchday: career.calendar?.slots[career.week]?.day ?? null,
    status: career.status,
    clubId: career.club_id,
    countryCode: career.country_code,
    pendingMatch: !!career.pending_match,
    level: m.level,
    title: titleForLevel(m.level),
    xp: m.xp,
    xpLevelStart: xpForLevel(m.level),
    xpNextLevel: xpForLevel(m.level + 1),
    points: m.points,
    reputation: Math.round(m.reputation),
    winStreak: m.winStreak,
    activeSkin: m.activeSkin,
    trainingBoostWeeks: m.trainingBoostWeeks,
    autoSubs: m.autoSubs ?? true,
    stopOn: { ...DEFAULT_STOP_ON, ...(m.stopOn ?? {}) },
    unlocked: UNLOCKS.filter((u) => m.level >= u.level).map((u) => u.id),
  };
}


/** Laufende Beobachtungen zeigen nur das Datum des Berichts, keine Werte. */
export function scoutReport(career: CareerRow, r: unknown) {
  const rep = r as { pending?: boolean; due?: number } | null | undefined;
  if (!rep) return null;
  if (rep.pending) return { pending: true, dueDate: isoDate(career.season, rep.due ?? career.day) };
  return rep;
}

/** Eigene Spieler, die derzeit an andere Vereine verliehen sind. */
export async function loanedOut(careerId: string, clubId: number): Promise<Player[]> {
  const rows = await query<{ data: Player; club_id: number | null }>(pool(),
    "select data, club_id from players where career_id = $1 and (data->'loan'->>'parentClubId')::int = $2", [careerId, clubId]);
  return rows.map((r) => ({ ...r.data, clubId: r.club_id }));
}

export async function clubNames(careerId: string, ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await query<{ id: number; name: string }>(pool(), "select id, name from clubs where career_id = $1 and id = any($2::int[])", [careerId, ids]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

export const ORDER: Position[] = ["GK", "DR", "DC", "DL", "DM", "MR", "MC", "ML", "AMR", "AMC", "AML", "ST"];
export function positionOrder(p: Position) {
  return ORDER.indexOf(p);
}
