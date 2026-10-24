/** Lesende Sichten für die Oberfläche. */
import { windowFor } from "./window";
import {
  ACHIEVEMENTS, ALL_ATTRS, CARD_PACK, COUNTRIES, COUNTRY_BY_CODE, FINANCE_LABEL, FORMATIONS, LEVEL_TITLES, MISSIONS, ROLES,
  Rng, SKINS, STYLE_LABEL, STYLE_PRESETS, UNLOCKS, askingPrice, computeStandings, defaultTactic, flagEmoji, formatMoney, isUnlocked,
  EXPECTED_SHARE, defaultStatuses, statusOf, type SquadStatus,
  ratingAt, seedFor, squadRanks, streakReward, titleForLevel, trainingAverage, validateTactic, wageBill, xpForLevel,
  type Player, type Position,
} from "@fl/sim";
import { one, pool, query } from "./db";
import { readCareer, todayKey, withCareer } from "./career";
import { GameError } from "./errors";
import { matchPreview } from "./match";
import { isoDate, upcomingDays } from "./calendar-view";
import {
  type CareerRow, type ClubRow, type FixtureRow, type LeagueRow, getClub, getClubs, getLeague, getLeagues, getPlayer, getPlayers,
  saveCareer,
} from "./repo";
import { type RewardNote, announceNotes, ensureMissions, unlockAchievement } from "./rewards";
import { scoutLimit, staffUpgradeCost } from "./actions";

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

async function knowledgeFor(career: CareerRow, players: Player[], userLeagueId: number | null) {
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

async function standings(career: CareerRow, leagueId: number, season = career.season) {
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

// ---------------------------------------------------------------- Büro

export async function checkin(careerId: string, accountId: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    ensureMissions(career);
    const notes: RewardNote[] = [];
    const account = await one<{ login_streak: number }>(db, "select login_streak from accounts where id = $1", [accountId]);
    const streak = account?.login_streak ?? 0;
    const today = todayKey();
    if (career.manager.streakRewardDay !== today) {
      career.manager.streakRewardDay = today;
      const reward = streakReward(streak);
      if (reward) {
        career.manager.points += reward.points;
        career.manager.trainingBoostWeeks += reward.trainingBoost;
        notes.push({ kind: "points", text: `${streak}-Tage-Serie: +${reward.points} MP${reward.trainingBoost ? `, Trainingsbonus für ${reward.trainingBoost} Wochen` : ""}`, icon: "🔥" });
      }
      if (streak >= 7) unlockAchievement(career, "login_7", notes);
    }
    await saveCareer(db, career);
    await announceNotes(db, career, notes);
    return { notes, streak };
  });
}

export async function dashboard(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const club = career.club_id ? await getClub(pool(), career.id, career.club_id) : null;
  const league = club ? await getLeague(pool(), career.id, club.league_id) : null;
  const inbox = await query(pool(), "select id, season, week, day, category, title, body, read, action, created_at from inbox where career_id = $1 order by id desc limit 40", [career.id]);
  const unread = await one<{ n: number }>(pool(), "select count(*)::int as n from inbox where career_id = $1 and not read", [career.id]);
  const next = await matchPreview(pool(), career);
  let table: unknown[] = [];
  let recent: unknown[] = [];
  if (club && league) {
    const s = await standings(career, league.id);
    const pos = s.rows.findIndex((r) => r.clubId === club.id);
    table = s.rows.slice(Math.max(0, Math.min(pos - 3, s.rows.length - 7)), Math.max(7, pos + 4));
    const own = await query<FixtureRow & { opponent: string; cup_kind: string | null }>(
      pool(),
      `select f.*, o.name as opponent, cu.kind as cup_kind from fixtures f join clubs o on o.id = case when f.home_id = $3 then f.away_id else f.home_id end
        left join cups cu on cu.id = f.cup_id
        where f.career_id = $1 and f.season = $2 and f.played and $3 in (f.home_id, f.away_id) order by f.week desc limit 5`,
      [career.id, career.season, club.id],
    );
    recent = own.map((f) => ({
      fixtureId: f.id, week: f.week, home: f.home_id === club.id, opponent: f.opponent, cup: !!f.cup_id, continental: f.cup_kind === "continental",
      goalsFor: f.home_id === club.id ? f.home_goals : f.away_goals, goalsAgainst: f.home_id === club.id ? f.away_goals : f.home_goals,
      pens: f.pen_home !== null ? (f.home_id === club.id ? `${f.pen_home}:${f.pen_away}` : `${f.pen_away}:${f.pen_home}`) : null,
      won: f.pen_home !== null ? (f.home_id === club.id ? f.pen_home! > f.pen_away! : f.pen_away! > f.pen_home!) : null,
    }));
  }
  const offers = await query(pool(), "select * from transfers where career_id = $1 and kind = 'offer_in' and status = 'pending' order by id desc", [career.id]);
  ensureMissions(career);
  const account = await one<{ login_streak: number; best_login_streak: number }>(pool(), "select login_streak, best_login_streak from accounts where id = $1", [accountId]);
  return {
    career: careerSummary(career),
    club: club ? { ...clubSummary(club), balance: club.balance, transferBudget: club.transfer_budget } : null,
    league: league ? { id: league.id, name: league.name, tier: league.tier, countryCode: league.country_code, flag: flagEmoji(league.country_code) } : null,
    next,
    inbox,
    unread: unread?.n ?? 0,
    table,
    recent,
    offers,
    missions: career.manager.missions.items.map((i) => ({ ...MISSIONS.find((m) => m.kind === i.kind)!, done: i.done })),
    board: career.board,
    window: windowFor(career),
    loginStreak: account?.login_streak ?? 0,
    bestLoginStreak: account?.best_login_streak ?? 0,
    jobOffers: career.job_offers,
    schedule: await upcomingDays(career, 7),
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
    unlocked: UNLOCKS.filter((u) => m.level >= u.level).map((u) => u.id),
  };
}

// ---------------------------------------------------------------- Team

export async function squadView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) return { players: [], club: null, career: careerSummary(career) };
  const club = (await getClub(pool(), career.id, career.club_id))!;
  const players = await getPlayers(pool(), career.id, [club.id]);
  const ranks = squadRanks(players);
  const out = await loanedOut(career.id, club.id);
  const parentIds = [...new Set(players.map((p) => p.loan?.parentClubId).filter((x): x is number => !!x))];
  const names = await clubNames(career.id, [...parentIds, ...out.map((p) => p.clubId!)]);
  return {
    career: careerSummary(career),
    club: { ...clubSummary(club), balance: club.balance, transferBudget: club.transfer_budget },
    players: players
      .sort((a, b) => positionOrder(a.position) - positionOrder(b.position) || b.rating - a.rating)
      .map((p) => playerView(p, "exact", { squadRank: ranks.get(p.id), loanFrom: p.loan ? names.get(p.loan.parentClubId) ?? null : null })),
    loanedOut: out.map((p) => playerView(p, "exact", { loanTo: names.get(p.clubId!) ?? null })),
  };
}

/** Laufende Beobachtungen zeigen nur das Datum des Berichts, keine Werte. */
function scoutReport(career: CareerRow, r: unknown) {
  const rep = r as { pending?: boolean; due?: number } | null | undefined;
  if (!rep) return null;
  if (rep.pending) return { pending: true, dueDate: isoDate(career.season, rep.due ?? career.day) };
  return rep;
}

/** Eigene Spieler, die derzeit an andere Vereine verliehen sind. */
async function loanedOut(careerId: string, clubId: number): Promise<Player[]> {
  const rows = await query<{ data: Player; club_id: number | null }>(pool(),
    "select data, club_id from players where career_id = $1 and (data->'loan'->>'parentClubId')::int = $2", [careerId, clubId]);
  return rows.map((r) => ({ ...r.data, clubId: r.club_id }));
}

async function clubNames(careerId: string, ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await query<{ id: number; name: string }>(pool(), "select id, name from clubs where career_id = $1 and id = any($2::int[])", [careerId, ids]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

const ORDER: Position[] = ["GK", "DR", "DC", "DL", "DM", "MR", "MC", "ML", "AMR", "AMC", "AML", "ST"];
function positionOrder(p: Position) {
  return ORDER.indexOf(p);
}

export async function tacticView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Kein Verein");
  const club = (await getClub(pool(), career.id, career.club_id))!;
  const players = await getPlayers(pool(), career.id, [club.id]);
  const tactic = validateTactic(club.tactic ?? defaultTactic(players, "4-4-2", STYLE_PRESETS.balanced.style), players);
  return {
    career: careerSummary(career),
    club: clubSummary(club),
    tactic,
    players: players.map((p) => ({
      ...playerView(p, "exact"),
      ratings: Object.fromEntries(ORDER.map((pos) => [pos, ratingAt(p.attrs, pos)])),
    })),
    formations: Object.fromEntries(Object.entries(FORMATIONS).map(([k, v]) => [k, v])),
    roles: ROLES,
    styleLabels: STYLE_LABEL,
    presets: STYLE_PRESETS,
    training: career.training,
  };
}

export async function playerDetail(careerId: string, accountId: string, playerId: number) {
  const career = await readCareer(careerId, accountId);
  const p = await getPlayer(pool(), career.id, playerId);
  if (!p) throw new GameError("Spieler nicht gefunden", 404);
  const userClub = career.club_id ? await getClub(pool(), career.id, career.club_id) : null;
  const k = await knowledgeFor(career, [p], userClub?.league_id ?? null);
  const club = p.clubId !== null ? await getClub(pool(), career.id, p.clubId) : null;
  const league = club ? await getLeague(pool(), career.id, club.league_id) : null;
  const report = await one<{ report: unknown }>(pool(), "select report from shortlist where career_id = $1 and player_id = $2", [career.id, p.id]);
  let ask: number | null = null;
  if (club && club.id !== career.club_id) {
    const squad = await getPlayers(pool(), career.id, [club.id]);
    ask = askingPrice(p, { season: career.season, squadRank: squadRanks(squad).get(p.id) ?? 20, squadSize: squad.length, sellerReputation: club.reputation, isUserClub: false });
  }
  const history = await query(pool(), "select fee, from_club, to_club, season, kind from transfers where career_id = $1 and player_id = $2 and status = 'completed' order by id desc limit 10", [career.id, p.id]);
  let squadStatus: { value: SquadStatus; suggested: SquadStatus; expected: number } | null = null;
  if (p.clubId === career.club_id) {
    const own = await getPlayers(pool(), career.id, [career.club_id!]);
    const defaults = defaultStatuses(own, userClub?.tactic?.formation);
    const value = statusOf(p, defaults);
    squadStatus = { value, suggested: defaults.get(p.id) ?? "backup", expected: Math.round(EXPECTED_SHARE[value] * 100) };
  }
  return {
    squadStatus,
    career: careerSummary(career),
    player: playerView(p, k.of(p)),
    club: club ? clubSummary(club) : null,
    league: league ? { id: league.id, name: league.name, countryCode: league.country_code } : null,
    report: scoutReport(career, report?.report),
    shortlisted: k.shortlisted.has(p.id),
    askingPrice: ask,
    own: p.clubId === career.club_id,
    transfers: history,
    window: windowFor(career),
    scoutLimit: scoutLimit(career),
    budget: userClub?.transfer_budget ?? 0,
    loanParent: p.loan ? (await clubNames(career.id, [p.loan.parentClubId])).get(p.loan.parentClubId) ?? null : null,
    loanedOutByUser: !!p.loan && p.loan.parentClubId === career.club_id,
  };
}

export async function clubView(careerId: string, accountId: string, clubId: number) {
  const career = await readCareer(careerId, accountId);
  const club = await getClub(pool(), career.id, clubId);
  if (!club) throw new GameError("Verein nicht gefunden", 404);
  const league = (await getLeague(pool(), career.id, club.league_id))!;
  const players = await getPlayers(pool(), career.id, [club.id]);
  const userClub = career.club_id ? await getClub(pool(), career.id, career.club_id) : null;
  const k = await knowledgeFor(career, players, userClub?.league_id ?? null);
  return {
    career: careerSummary(career),
    club: clubSummary(club),
    league: { id: league.id, name: league.name, tier: league.tier, countryCode: league.country_code, active: league.active },
    generated: club.players_generated,
    players: players
      .sort((a, b) => positionOrder(a.position) - positionOrder(b.position) || b.rating - a.rating)
      .map((p) => playerView(p, k.of(p))),
    tactic: club.tactic ? { formation: club.tactic.formation } : null,
  };
}

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

// ---------------------------------------------------------------- Markt

export interface MarketFilter {
  q?: string;
  position?: string;
  minAge?: number;
  maxAge?: number;
  maxValue?: number;
  country?: string;
  freeOnly?: boolean;
  listedOnly?: boolean;
  shortlistOnly?: boolean;
  sort?: "rating" | "value" | "age" | "potential";
  page?: number;
}

export async function marketView(careerId: string, accountId: string, f: MarketFilter) {
  const career = await readCareer(careerId, accountId);
  const userClub = career.club_id ? await getClub(pool(), career.id, career.club_id) : null;
  const where: string[] = ["p.career_id = $1", "(p.club_id is distinct from $2)"];
  const params: unknown[] = [career.id, career.club_id ?? -1];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.position) add("p.position = ?", f.position);
  if (f.minAge) add("p.age >= ?", f.minAge);
  if (f.maxAge) add("p.age <= ?", f.maxAge);
  if (f.maxValue) add("p.value <= ?", f.maxValue);
  if (f.country) add("p.nationality = ?", f.country);
  if (f.freeOnly) where.push("p.club_id is null");
  if (f.listedOnly) where.push("p.listed");
  if (f.shortlistOnly) where.push(`p.id in (select player_id from shortlist where career_id = $1)`);
  if (f.q) {
    params.push(`%${f.q}%`);
    where.push(`(p.data->>'lastName' ilike $${params.length} or p.data->>'firstName' ilike $${params.length})`);
  }
  const order = f.sort === "value" ? "p.value desc" : f.sort === "age" ? "p.age asc" : f.sort === "potential" ? "p.potential desc" : "p.rating desc";
  const page = Math.max(0, f.page ?? 0);
  const rows = await query<{ data: Player; club_id: number | null; club_name: string | null; club_colors: unknown; league_name: string | null; country_code: string | null }>(
    pool(),
    `select p.data, p.club_id, c.name as club_name, c.colors as club_colors, l.name as league_name, l.country_code
       from players p left join clubs c on c.id = p.club_id left join leagues l on l.id = c.league_id
      where ${where.join(" and ")}
      order by ${order} limit 51 offset ${page * 50}`,
    params,
  );
  const players = rows.map((r) => ({ ...r.data, clubId: r.club_id }));
  const k = await knowledgeFor(career, players, userClub?.league_id ?? null);
  const transfers = await query(pool(),
    "select * from transfers where career_id = $1 and season = $2 and kind in ('buy','offer_in') order by id desc limit 30", [career.id, career.season]);
  return {
    career: careerSummary(career),
    club: userClub ? { ...clubSummary(userClub), balance: userClub.balance, transferBudget: userClub.transfer_budget } : null,
    window: windowFor(career),
    players: rows.slice(0, 50).map((r, i) => ({
      ...playerView(players[i], k.of(players[i])),
      clubName: r.club_name, kit: r.club_colors ?? null, leagueName: r.league_name, leagueCountry: r.country_code, shortlisted: k.shortlisted.has(players[i].id),
    })),
    hasMore: rows.length > 50,
    page,
    transfers,
    scoutingNetwork: isUnlocked(career.manager, "scouting_network"),
    activeCountries: [...new Set((await getLeagues(pool(), career.id)).filter((l) => l.active).map((l) => l.country_code))],
    countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name, flag: flagEmoji(c.code), strength: c.strength })),
  };
}

export async function contractsView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Kein Verein");
  const players = await getPlayers(pool(), career.id, [career.club_id]);
  const club = await getClub(pool(), career.id, career.club_id);
  return {
    career: careerSummary(career),
    kit: club?.colors ?? null,
    players: players.sort((a, b) => (a.contract?.untilSeason ?? 0) - (b.contract?.untilSeason ?? 0) || b.rating - a.rating).map((p) => playerView(p, "exact")),
  };
}

export async function financeView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Kein Verein");
  const club = (await getClub(pool(), career.id, career.club_id))!;
  const byKind = await query<{ kind: string; amount: number }>(pool(),
    "select kind, sum(amount)::bigint as amount from finance_log where career_id = $1 and club_id = $2 and season = $3 group by kind order by kind", [career.id, club.id, career.season]);
  const byWeek = await query<{ week: number; amount: number }>(pool(),
    "select week, sum(amount)::bigint as amount from finance_log where career_id = $1 and club_id = $2 and season = $3 group by week order by week", [career.id, club.id, career.season]);
  const recent = await query(pool(),
    "select week, kind, amount, label from finance_log where career_id = $1 and club_id = $2 order by id desc limit 40", [career.id, club.id]);
  const players = await getPlayers(pool(), career.id, [club.id]);
  const wages = wageBill(players, await loanedOut(career.id, club.id));
  // Kontostandsverlauf rückwärts rekonstruieren
  let running = club.balance;
  const balanceSeries: { week: number; balance: number }[] = [];
  for (const w of [...byWeek].reverse()) {
    balanceSeries.unshift({ week: w.week, balance: running });
    running -= w.amount;
  }
  balanceSeries.unshift({ week: 0, balance: running });
  return {
    career: careerSummary(career),
    club: { ...clubSummary(club), balance: club.balance, transferBudget: club.transfer_budget, wageBudget: club.wage_budget },
    profile: club.finance,
    wages,
    byKind: byKind.map((r) => ({ ...r, label: FINANCE_LABEL[r.kind as keyof typeof FINANCE_LABEL] ?? r.kind })),
    balanceSeries,
    recent,
    board: career.board,
    staff: career.staff,
    staffCosts: Object.fromEntries(Object.entries(career.staff).map(([k, v]) => [k, v >= 20 ? null : staffUpgradeCost(v + 1)])),
    training: career.training,
    formatted: { balance: formatMoney(club.balance) },
  };
}

// ---------------------------------------------------------------- Karriere

export async function careerView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const m = career.manager;
  return {
    career: careerSummary(career),
    manager: { ...m, missions: undefined },
    achievements: ACHIEVEMENTS.map((a) => ({ ...a, unlockedAt: m.achievements[a.id] ?? null })),
    unlocks: UNLOCKS.map((u) => ({ ...u, unlocked: m.level >= u.level })),
    levelTitles: LEVEL_TITLES,
    skins: SKINS.map((s) => ({ ...s, owned: m.skins.includes(s.id), active: m.activeSkin === s.id })),
    cardPack: CARD_PACK,
    jobOffers: career.job_offers,
    history: m.history,
  };
}

export async function leaderboards() {
  const best = await query(pool(),
    `select r.season, r.club_name, r.league_name, r.country_code, r.tier, r.position, r.points, r.played, r.ppg, r.champion, r.promoted,
            a.display_name, c.manager_name, (c.manager->>'level')::int as level
       from season_results r join accounts a on a.id = r.account_id join careers c on c.id = r.career_id
      where r.played >= 10 order by r.ppg desc, r.points desc limit 25`);
  const levels = await query(pool(),
    `select c.manager_name, a.display_name, (c.manager->>'level')::int as level, (c.manager->>'xp')::int as xp,
            (c.manager->'totals'->>'titles')::int as titles, cl.name as club_name
       from careers c join accounts a on a.id = c.account_id left join clubs cl on cl.id = c.club_id
      order by (c.manager->>'xp')::int desc limit 25`);
  const titles = await query(pool(),
    `select a.display_name, c.manager_name, count(*) filter (where r.champion)::int as titles, count(*) filter (where r.promoted)::int as promotions, count(*)::int as seasons
       from season_results r join accounts a on a.id = r.account_id join careers c on c.id = r.career_id
      group by a.display_name, c.manager_name having count(*) filter (where r.champion or r.promoted) > 0
      order by titles desc, promotions desc limit 25`);
  return { best, levels, titles };
}

export function worldMeta() {
  return {
    countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name, flag: flagEmoji(c.code), strength: c.strength, confed: c.confed, tiers: c.tiers.length })),
    countryByCode: Object.fromEntries(Object.entries(COUNTRY_BY_CODE).map(([k, v]) => [k, { name: v.name, flag: flagEmoji(k) }])),
  };
}

export type { LeagueRow };
