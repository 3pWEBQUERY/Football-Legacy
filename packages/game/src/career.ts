/** Karriere anlegen, Ligen aktivieren, Saison planen, Vorstandsziele. */
import {
  COUNTRY_BY_CODE, DEFAULT_TRAINING, Rng, STYLE_PRESETS, createSchedule, dailyMissions, defaultTactic, expectedPosition,
  cupName, cupRoundName, cupWeekPositions, drawCupRound, financeProfile, generateSquad, generateWorld, initialBudget, newManagerProfile, planCup, roundsFor, seedFor, teamRating, wageBill,
  type Player,
} from "@fl/sim";
import type pg from "pg";
import { type Db, lockCareer, one, pool, query, tx } from "./db";
import { GameError } from "./errors";
import {
  type Board, type CareerRow, type ClubRow, type LeagueRow, addInbox, getCareer, getClubs, getLeagues, getPlayers,
  insertFixtures, insertPlayers, saveCareer, saveClubs,
} from "./repo";

export const START_SEASON = 2026;

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Vorschau der Vereine eines Landes für die Vereinswahl (ohne Datenbank). */
export function previewClubs(seed: number, countryCode: string) {
  const country = COUNTRY_BY_CODE[countryCode];
  if (!country) throw new GameError("Unbekanntes Land");
  const world = generateWorld(seed, START_SEASON, [country]);
  return world.leagues.map((l) => {
    const clubs = world.clubs
      .map((c, index) => ({ ...c, index }))
      .filter((c) => c.leagueKey === l.key)
      .sort((a, b) => b.rating - a.rating)
      .map((c, rank) => ({
        index: c.index,
        name: c.name,
        city: c.city,
        rating: c.rating,
        reputation: c.reputation,
        colors: c.colors,
        capacity: c.capacity,
        expected: rank + 1,
      }));
    return { key: l.key, name: l.name, tier: l.tier, size: l.size, clubs };
  });
}

function aiStyle(rng: Rng, strengthRank: number, size: number) {
  const rel = strengthRank / size;
  const options = rel < 0.25 ? ["possession", "gegenpress", "balanced", "wing_play"]
    : rel > 0.75 ? ["counter", "park_bus", "balanced", "counter"]
    : ["balanced", "wing_play", "counter", "gegenpress", "possession"];
  return STYLE_PRESETS[rng.pick(options)].style;
}

const FORMATION_CHOICES = ["4-4-2", "4-3-3", "4-2-3-1", "4-1-4-1", "3-5-2", "4-4-1-1"] as const;

/**
 * Erzeugt die Kader der angegebenen Vereine (falls noch nicht geschehen) und
 * setzt Taktik, Stärke und Finanzen. Gibt die neuen Spieler zurück.
 */
export async function activateClubs(db: Db, career: CareerRow, clubs: ClubRow[], leagues: Map<number, LeagueRow>): Promise<Player[]> {
  const todo = clubs.filter((c) => !c.players_generated);
  if (!todo.length) return [];
  const created: Player[] = [];
  let nextId = career.next_player_id;
  const byLeague = new Map<number, ClubRow[]>();
  for (const c of todo) byLeague.set(c.league_id, [...(byLeague.get(c.league_id) ?? []), c]);
  const leagueClubs = await getClubs(db, career.id, "league_id = any($2::int[])", [[...byLeague.keys()]]);
  for (const club of todo) {
    const squad = generateSquad(career.seed, { id: club.id, countryCode: club.country_code, rating: club.rating, reputation: club.reputation }, career.season, () => nextId++);
    created.push(...squad);
    const rng = new Rng(seedFor(career.seed, "club-setup", club.id));
    const peers = leagueClubs.filter((c) => c.league_id === club.league_id).sort((a, b) => b.rating - a.rating);
    const rank = peers.findIndex((c) => c.id === club.id);
    club.tactic = defaultTactic(squad, rng.pick(FORMATION_CHOICES), aiStyle(rng, rank, peers.length || 18));
    club.rating = teamRating(squad);
    const tier = leagues.get(club.league_id)?.tier ?? 1;
    const wages = wageBill(squad);
    club.finance = financeProfile({ countryCode: club.country_code, reputation: club.reputation, capacity: club.capacity }, wages, tier);
    const budget = initialBudget(wages, club.reputation);
    club.balance = budget.balance;
    club.transfer_budget = budget.transferBudget;
    club.wage_budget = Math.round(wages * 1.1);
    club.players_generated = true;
  }
  career.next_player_id = nextId;
  await insertPlayers(db, career.id, created);
  await saveClubs(db, career.id, todo);
  await query(db, "update careers set next_player_id = $2 where id = $1", [career.id, nextId]);
  return created;
}

/** Aktiviert eine ganze Liga für die Detailsimulation. */
export async function activateLeague(db: Db, career: CareerRow, leagueId: number) {
  const leagues = new Map((await getLeagues(db, career.id)).map((l) => [l.id, l]));
  const clubs = await getClubs(db, career.id, "league_id = $2", [leagueId]);
  await activateClubs(db, career, clubs, leagues);
  await query(db, "update leagues set active = true where career_id = $1 and id = $2", [career.id, leagueId]);
}

/**
 * Plant die Saison: Ligaspielpläne aller Ligen und den Landespokal im Land des
 * Nutzers. Pokalrunden bekommen eigene Kalenderwochen zwischen den Spieltagen.
 */
export async function scheduleSeason(db: Db, career: CareerRow) {
  const leagues = await getLeagues(db, career.id);
  const leagueById = new Map(leagues.map((l) => [l.id, l]));
  const clubs = await query<{ id: number; league_id: number; rating: number }>(db, "select id, league_id, rating from clubs where career_id = $1", [career.id]);
  const byLeague = new Map<number, number[]>();
  for (const c of clubs) byLeague.set(c.league_id, [...(byLeague.get(c.league_id) ?? []), c.id]);
  const userClub = clubs.find((c) => c.id === career.club_id);
  const userLeague = userClub ? leagueById.get(userClub.league_id) : undefined;
  const leagueWeeks = userLeague ? roundsFor(userLeague.size) : career.season_weeks;

  // Pokal: alle Vereine aus dem Land des Nutzers
  const cupCountry = userLeague?.country_code ?? career.country_code;
  const entrants = clubs
    .filter((c) => leagueById.get(c.league_id)?.country_code === cupCountry)
    .map((c) => ({ id: c.id, tier: leagueById.get(c.league_id)!.tier, rating: c.rating }));
  const plan = entrants.length >= 4 ? planCup(entrants) : null;
  const positions = plan ? cupWeekPositions(plan.rounds, leagueWeeks) : [];

  // Kalender: Liga-Woche → Kalenderwoche, Pokalwochen dazwischen
  const leagueToCal = new Map<number, number>();
  const cupWeeks: number[] = [];
  let cal = 0;
  let r = 0;
  for (let w = 1; w <= leagueWeeks; w++) {
    cal++;
    leagueToCal.set(w, cal);
    while (r < positions.length && positions[r] === w) {
      cal++;
      cupWeeks.push(cal);
      r++;
    }
  }
  career.season_weeks = cal;
  await query(db, "update careers set season_weeks = $2 where id = $1", [career.id, cal]);

  const fixtures: { leagueId: number; week: number; round: number; homeId: number; awayId: number }[] = [];
  for (const l of leagues) {
    const ids = (byLeague.get(l.id) ?? []).sort((a, b) => a - b);
    if (ids.length < 2) continue;
    const rng = new Rng(seedFor(career.seed, "schedule", career.season, l.key));
    for (const m of createSchedule(ids, leagueWeeks, rng)) fixtures.push({ leagueId: l.id, ...m, week: leagueToCal.get(m.week) ?? m.week });
  }
  await insertFixtures(db, career.id, career.season, fixtures);

  if (plan) {
    const rounds = cupWeeks.map((week, i) => ({ round: i + 1, name: cupRoundName(i + 1, plan.rounds), week }));
    const cup = await one<{ id: number }>(
      db,
      "insert into cups(career_id, season, country_code, name, rounds, byes) values ($1,$2,$3,$4,$5,$6) returning id",
      [career.id, career.season, cupCountry, cupName(cupCountry), JSON.stringify(rounds), JSON.stringify(plan.byes)],
    );
    const pairs = drawCupRound(new Rng(seedFor(career.seed, "cup", career.season, 1)), plan.prelim);
    await insertCupFixtures(db, career.id, career.season, cup!.id, 1, rounds[0].week, pairs);
  }
}

export async function insertCupFixtures(db: Db, careerId: string, season: number, cupId: number, round: number, week: number, pairs: [number, number][]) {
  if (!pairs.length) return;
  await query(
    db,
    `insert into fixtures(career_id, season, league_id, week, round, home_id, away_id, cup_id, cup_round)
     select $1, $2, 0, $3, $4, h, a, $5, $4 from unnest($6::int[], $7::int[]) as t(h, a)`,
    [careerId, season, week, round, cupId, pairs.map((p) => p[0]), pairs.map((p) => p[1])],
  );
}

export async function boardObjectives(db: Db, career: CareerRow, club: ClubRow, league: LeagueRow): Promise<Board> {
  const peers = await getClubs(db, career.id, "league_id = $2", [league.id]);
  const expected = expectedPosition(club.id, peers.map((c) => ({ clubId: c.id, rating: c.rating })));
  let target: number;
  let objective: string;
  if (expected <= 2 && league.tier === 1) {
    target = expected === 1 ? 1 : 2;
    objective = target === 1 ? "Gewinne die Meisterschaft." : "Spiele um die Meisterschaft mit (Top 2).";
  } else if (league.promotion > 0 && expected <= league.promotion + 2) {
    target = league.promotion;
    objective = `Steige auf (Platz ${league.promotion} oder besser).`;
  } else if (league.relegation > 0 && expected >= league.size - league.relegation - 1) {
    target = league.size - league.relegation;
    objective = `Sichere den Klassenerhalt (Platz ${target} oder besser).`;
  } else {
    target = Math.min(league.size, expected + 2);
    objective = `Beende die Saison auf Platz ${target} oder besser.`;
  }
  const financeTarget = Math.round(Math.min(club.balance * 0.7, club.balance - 500_000) / 10_000) * 10_000;
  return {
    expectedPosition: expected,
    targetPosition: target,
    objective,
    financeTarget,
    confidence: career.board?.confidence ?? 60,
    startBalance: club.balance,
    youthTarget: 5,
    youthApps: 0,
  };
}

export interface CreateCareerInput {
  managerName: string;
  countryCode: string;
  clubIndex: number;
  seed?: number;
}

export async function createCareer(accountId: string, input: CreateCareerInput): Promise<string> {
  const country = COUNTRY_BY_CODE[input.countryCode];
  if (!country) throw new GameError("Unbekanntes Land");
  const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31);
  const world = generateWorld(seed, START_SEASON);
  const ownWorld = generateWorld(seed, START_SEASON, [country]);
  const chosen = ownWorld.clubs[input.clubIndex];
  if (!chosen) throw new GameError("Unbekannter Verein");
  const count = await one<{ n: number }>(pool(), "select count(*)::int as n from careers where account_id = $1", [accountId]);
  if ((count?.n ?? 0) >= 5) throw new GameError("Du kannst höchstens fünf Karrieren parallel führen.");

  return tx(async (db) => {
    const manager = newManagerProfile();
    manager.missions = { date: todayKey(), items: dailyMissions(seed, todayKey()) };
    const career = await one<CareerRow>(
      db,
      `insert into careers(account_id, manager_name, seed, country_code, season, week, season_weeks, manager, board, training, staff)
       values ($1, $2, $3, $4, $5, 0, 34, $6, '{}', $7, $8) returning *`,
      [
        accountId, input.managerName.trim().slice(0, 40) || "Manager", seed, country.code, START_SEASON,
        JSON.stringify(manager), JSON.stringify(DEFAULT_TRAINING), JSON.stringify({ coach: 8, physio: 8, scout: 8, youth: 8 }),
      ],
    );
    if (!career) throw new Error("Karriere konnte nicht angelegt werden");
    await lockCareer(db, career.id);

    // Ligen
    const leagueRows = await query<{ id: number; key: string }>(
      db,
      `insert into leagues(career_id, key, country_code, tier, name, size, promotion, relegation, active)
       select $1, v.key, v.country_code, v.tier, v.name, v.size, v.promotion, v.relegation, v.active
         from jsonb_to_recordset($2::jsonb) as v(key text, country_code text, tier int, name text, size int, promotion int, relegation int, active boolean)
       returning id, key`,
      [career.id, JSON.stringify(world.leagues.map((l) => ({ ...l, countryCode: undefined, country_code: l.countryCode, active: l.countryCode === country.code })))],
    );
    const leagueId = new Map(leagueRows.map((l) => [l.key, l.id]));

    // Vereine
    const clubRows = await query<{ id: number; league_id: number; name: string }>(
      db,
      `insert into clubs(career_id, league_id, country_code, name, short_name, city, reputation, rating, capacity, colors, founded)
       select $1, v.league_id, v.country_code, v.name, v.short_name, v.city, v.reputation, v.rating, v.capacity, v.colors, v.founded
         from jsonb_to_recordset($2::jsonb) as v(league_id int, country_code text, name text, short_name text, city text,
              reputation int, rating int, capacity int, colors jsonb, founded int)
       returning id, league_id, name`,
      [
        career.id,
        JSON.stringify(world.clubs.map((c) => ({
          league_id: leagueId.get(c.leagueKey), country_code: c.countryCode, name: c.name, short_name: c.shortName, city: c.city,
          reputation: c.reputation, rating: c.rating, capacity: c.capacity, colors: c.colors, founded: c.founded,
        }))),
      ],
    );
    const userClubRow = clubRows.find((c) => c.league_id === leagueId.get(chosen.leagueKey) && c.name === chosen.name);
    if (!userClubRow) throw new Error("Verein nicht gefunden");

    // Heimatland aktivieren (alle Stufen mit Detailsimulation)
    const leagues = new Map((await getLeagues(db, career.id)).map((l) => [l.id, l]));
    const homeClubs = await getClubs(db, career.id, "country_code = $2", [country.code]);
    await activateClubs(db, career, homeClubs, leagues);

    const userLeague = leagues.get(userClubRow.league_id)!;
    career.club_id = userClubRow.id;
    const userClub = homeClubs.find((c) => c.id === userClubRow.id)!;
    career.board = await boardObjectives(db, career, userClub, userLeague);
    await saveCareer(db, career);
    await scheduleSeason(db, career);

    await addInbox(
      db, career.id, career.season, 0, "board", `Willkommen bei ${userClub.name}!`,
      `Der bisherige Trainer ist überraschend zurückgetreten – und der Vorstand vertraut dir, dem bisherigen Co-Trainer, die Mannschaft an.\n\n` +
        `Saisonziel: ${career.board.objective}\nFinanzen: Der Kontostand soll nicht unter ${Math.round(career.board.financeTarget / 1000).toLocaleString("de-CH")}k € fallen.\n\n` +
        `Das Sommer-Transferfenster ist geöffnet. Stelle deine Mannschaft ein und klicke auf „Weiter“, wenn du bereit bist.`,
    );
    await addInbox(
      db, career.id, career.season, 0, "tips", "Dein Assistent: die ersten Schritte",
      "1. Team → Aufstellung: Wähle Formation und Startelf.\n2. Team → Taktik: Stelle Tempo, Pressing und Risiko ein.\n" +
        "3. Markt: Suche nach Verstärkungen und behalte das Budget im Blick.\n4. Büro: Erledige die Tagesmissionen für Erfahrung und Manager-Punkte.",
    );
    return career.id;
  });
}

export async function deleteCareer(accountId: string, careerId: string) {
  await query(pool(), "delete from careers where id = $1 and account_id = $2", [careerId, accountId]);
}

export async function listCareers(accountId: string) {
  return query<{
    id: string; manager_name: string; season: number; week: number; season_weeks: number; club_name: string | null;
    league_name: string | null; country_code: string; level: number; colors: unknown; status: string; updated_at: string;
  }>(
    pool(),
    `select c.id, c.manager_name, c.season, c.week, c.season_weeks, cl.name as club_name, l.name as league_name, c.country_code,
            (c.manager->>'level')::int as level, cl.colors, c.status, c.updated_at
       from careers c left join clubs cl on cl.id = c.club_id left join leagues l on l.id = cl.league_id
      where c.account_id = $1 order by c.updated_at desc`,
    [accountId],
  );
}

/** Lädt Karriere mit Sperre innerhalb einer Transaktion. */
export async function withCareer<T>(careerId: string, accountId: string, fn: (db: pg.PoolClient, career: CareerRow) => Promise<T>): Promise<T> {
  return tx(async (db) => {
    await lockCareer(db, careerId);
    const career = await getCareer(db, careerId, accountId);
    if (!career) throw new GameError("Karriere nicht gefunden", 404);
    const result = await fn(db, career);
    return result;
  });
}

export async function readCareer(careerId: string, accountId: string): Promise<CareerRow> {
  const career = await getCareer(pool(), careerId, accountId);
  if (!career) throw new GameError("Karriere nicht gefunden", 404);
  return career;
}

export async function userSquad(db: Db, career: CareerRow): Promise<Player[]> {
  if (!career.club_id) return [];
  return getPlayers(db, career.id, [career.club_id]);
}
