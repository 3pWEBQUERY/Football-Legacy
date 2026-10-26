/** Datenzugriff: wandelt Datenbankzeilen in die einfachen Objekte der Simulation um. */
import type { ClubFinanceProfile, ManagerProfile, Player, SeasonCalendar, Tactic, TrainingPlan } from "@fl/sim";
import { type Db, one, query } from "./db";

export interface CareerRow {
  id: string;
  account_id: string;
  manager_name: string;
  seed: number;
  club_id: number | null;
  country_code: string;
  season: number;
  week: number;
  season_weeks: number;
  /** Tag seit Saisonbeginn (0 = erster Vorbereitungstag) */
  day: number;
  calendar: SeasonCalendar | null;
  /** Abschlusstabellen der Topligen für die Qualifikation zum Kontinentalpokal */
  qualifiers: { season: number; tables: Record<string, number[]> } | null;
  /** Trainingszentrum, Akademie, Bauprojekte, Vorstandsanfragen */
  facilities: import("./facilities").Facilities | null;
  /** Scouting-Aufträge und Berichte */
  scouting: import("./scouting").Scouting | null;
  status: "active" | "unemployed";
  manager: ManagerProfile;
  board: Board;
  training: TrainingPlan;
  staff: Staff;
  next_player_id: number;
  pending_match: PendingMatch | null;
  job_offers: JobOffer[];
  created_at: string;
  updated_at: string;
}

export interface Board {
  expectedPosition: number;
  targetPosition: number;
  objective: string;
  financeTarget: number; // Kontostand darf nicht unter diesen Wert fallen
  confidence: number; // 0–100
  startBalance: number;
  youthTarget: number;
  youthApps: number;
  /** Mehrjährige Vorstandsvision */
  vision?: import("./history/vision").Vision;
  /** Abgeschlossene Visionen */
  visionHistory?: import("./history/vision").VisionResult[];
}

export interface Staff {
  coach: number;
  physio: number;
  scout: number;
  youth: number;
}

export interface PendingMatch {
  fixtureId: number;
  side: 0 | 1;
  state: unknown;
  half: 1 | 2;
  aiHalftimeDone?: boolean;
}

export interface JobOffer {
  clubId: number;
  clubName: string;
  leagueName: string;
  countryCode: string;
  reputation: number;
  expires: number; // Saison
  /** Frist als fortlaufender Tag (Saison * 1000 + Tag) */
  expiresDay?: number;
  kind?: "angebot" | "bewerbung";
  wage?: number; // pro Jahr
  years?: number;
  expectation?: string;
  tier?: number;
  colors?: { primary: string; secondary: string };
}

export interface LeagueRow {
  id: number;
  career_id: string;
  key: string;
  country_code: string;
  tier: number;
  name: string;
  size: number;
  promotion: number;
  relegation: number;
  active: boolean;
}

export interface ClubRow {
  id: number;
  career_id: string;
  league_id: number;
  country_code: string;
  name: string;
  short_name: string;
  city: string;
  reputation: number;
  rating: number;
  balance: number;
  transfer_budget: number;
  wage_budget: number;
  capacity: number;
  colors: { primary: string; secondary: string };
  founded: number;
  tactic: Tactic | null;
  finance: ClubFinanceProfile | null;
  players_generated: boolean;
}

export interface FixtureRow {
  id: number;
  career_id: string;
  season: number;
  league_id: number;
  week: number;
  round: number;
  home_id: number;
  away_id: number;
  home_goals: number | null;
  away_goals: number | null;
  played: boolean;
  cup_id: number | null;
  cup_round: number | null;
  pen_home: number | null;
  pen_away: number | null;
  group_no: number | null;
}

export async function getCareer(db: Db, careerId: string, accountId?: string): Promise<CareerRow | null> {
  if (accountId) return one<CareerRow>(db, "select * from careers where id = $1 and account_id = $2", [careerId, accountId]);
  return one<CareerRow>(db, "select * from careers where id = $1", [careerId]);
}

export async function saveCareer(db: Db, c: CareerRow) {
  await query(
    db,
    `update careers set club_id = $2, season = $3, week = $4, season_weeks = $5, status = $6, manager = $7, board = $8,
       training = $9, staff = $10, next_player_id = $11, pending_match = $12, job_offers = $13, day = $14, calendar = $15, qualifiers = $16, facilities = $17, scouting = $18, updated_at = now()
     where id = $1`,
    [
      c.id, c.club_id, c.season, c.week, c.season_weeks, c.status, JSON.stringify(c.manager), JSON.stringify(c.board),
      JSON.stringify(c.training), JSON.stringify(c.staff), c.next_player_id,
      c.pending_match ? JSON.stringify(c.pending_match) : null, JSON.stringify(c.job_offers), c.day, c.calendar ? JSON.stringify(c.calendar) : null,
      c.qualifiers ? JSON.stringify(c.qualifiers) : null, c.facilities ? JSON.stringify(c.facilities) : null,
      c.scouting ? JSON.stringify(c.scouting) : null,
    ],
  );
}

export async function getLeagues(db: Db, careerId: string): Promise<LeagueRow[]> {
  return query<LeagueRow>(db, "select * from leagues where career_id = $1 order by country_code, tier", [careerId]);
}

export async function getLeague(db: Db, careerId: string, leagueId: number): Promise<LeagueRow | null> {
  return one<LeagueRow>(db, "select * from leagues where career_id = $1 and id = $2", [careerId, leagueId]);
}

export async function getClub(db: Db, careerId: string, clubId: number): Promise<ClubRow | null> {
  return one<ClubRow>(db, "select * from clubs where career_id = $1 and id = $2", [careerId, clubId]);
}

export async function getClubs(db: Db, careerId: string, where = "true", params: unknown[] = []): Promise<ClubRow[]> {
  return query<ClubRow>(db, `select * from clubs where career_id = $1 and (${where})`, [careerId, ...params]);
}

export async function saveClubs(db: Db, careerId: string, clubs: ClubRow[]) {
  if (!clubs.length) return;
  const rows = clubs.map((c) => ({
    id: c.id, league_id: c.league_id, reputation: c.reputation, rating: c.rating, balance: Math.round(c.balance),
    transfer_budget: Math.round(c.transfer_budget), wage_budget: Math.round(c.wage_budget), tactic: c.tactic, finance: c.finance,
    players_generated: c.players_generated, colors: c.colors,
  }));
  await query(
    db,
    `update clubs c set league_id = v.league_id, reputation = v.reputation, rating = v.rating, balance = v.balance,
        transfer_budget = v.transfer_budget, wage_budget = v.wage_budget, tactic = v.tactic, finance = v.finance,
        players_generated = v.players_generated, colors = v.colors
       from jsonb_to_recordset($2::jsonb) as v(id int, league_id int, reputation int, rating int, balance bigint,
            transfer_budget bigint, wage_budget bigint, tactic jsonb, finance jsonb, players_generated boolean, colors jsonb)
      where c.career_id = $1 and c.id = v.id`,
    [careerId, JSON.stringify(rows)],
  );
}

export async function getPlayers(db: Db, careerId: string, clubIds: number[]): Promise<Player[]> {
  if (!clubIds.length) return [];
  const rows = await query<{ data: Player; club_id: number | null }>(
    db,
    "select data, club_id from players where career_id = $1 and club_id = any($2::int[])",
    [careerId, clubIds],
  );
  return rows.map((r) => ({ ...r.data, clubId: r.club_id }));
}

export async function getPlayer(db: Db, careerId: string, playerId: number): Promise<Player | null> {
  const r = await one<{ data: Player; club_id: number | null }>(db, "select data, club_id from players where career_id = $1 and id = $2", [careerId, playerId]);
  return r ? { ...r.data, clubId: r.club_id } : null;
}

export async function getPlayersByIds(db: Db, careerId: string, ids: number[]): Promise<Player[]> {
  if (!ids.length) return [];
  const rows = await query<{ data: Player; club_id: number | null }>(db, "select data, club_id from players where career_id = $1 and id = any($2::int[])", [careerId, ids]);
  return rows.map((r) => ({ ...r.data, clubId: r.club_id }));
}

function playerRecord(p: Player) {
  return {
    id: p.id, club_id: p.clubId, data: p, position: p.position, rating: p.rating, potential: p.potential, age: p.age,
    value: Math.round(p.value), nationality: p.nationality, listed: p.listed,
  };
}

export async function insertPlayers(db: Db, careerId: string, players: Player[]) {
  for (let i = 0; i < players.length; i += 2000) {
    const chunk = players.slice(i, i + 2000).map(playerRecord);
    await query(
      db,
      `insert into players(career_id, id, club_id, data, position, rating, potential, age, value, nationality, listed)
       select $1, v.id, v.club_id, v.data, v.position, v.rating, v.potential, v.age, v.value, v.nationality, v.listed
         from jsonb_to_recordset($2::jsonb) as v(id int, club_id int, data jsonb, position text, rating int, potential int,
              age int, value bigint, nationality text, listed boolean)`,
      [careerId, JSON.stringify(chunk)],
    );
  }
}

export async function savePlayers(db: Db, careerId: string, players: Player[]) {
  for (let i = 0; i < players.length; i += 2000) {
    const chunk = players.slice(i, i + 2000).map(playerRecord);
    await query(
      db,
      `update players p set club_id = v.club_id, data = v.data, position = v.position, rating = v.rating, potential = v.potential,
              age = v.age, value = v.value, nationality = v.nationality, listed = v.listed
         from jsonb_to_recordset($2::jsonb) as v(id int, club_id int, data jsonb, position text, rating int, potential int,
              age int, value bigint, nationality text, listed boolean)
        where p.career_id = $1 and p.id = v.id`,
      [careerId, JSON.stringify(chunk)],
    );
  }
}

export async function deletePlayers(db: Db, careerId: string, ids: number[]) {
  if (!ids.length) return;
  await query(db, "delete from players where career_id = $1 and id = any($2::int[])", [careerId, ids]);
}

export async function insertFixtures(
  db: Db,
  careerId: string,
  season: number,
  fixtures: { leagueId: number; week: number; round: number; homeId: number; awayId: number }[],
) {
  for (let i = 0; i < fixtures.length; i += 20000) {
    const chunk = fixtures.slice(i, i + 20000);
    await query(
      db,
      `insert into fixtures(career_id, season, league_id, week, round, home_id, away_id)
       select $1, $2, l, w, r, h, a from unnest($3::int[], $4::int[], $5::int[], $6::int[], $7::int[]) as t(l, w, r, h, a)`,
      [careerId, season, chunk.map((f) => f.leagueId), chunk.map((f) => f.week), chunk.map((f) => f.round), chunk.map((f) => f.homeId), chunk.map((f) => f.awayId)],
    );
  }
}

export async function saveFixtureResults(db: Db, careerId: string, results: { id: number; home: number; away: number; penHome?: number; penAway?: number }[]) {
  if (!results.length) return;
  const pens = results.filter((r) => r.penHome !== undefined);
  if (pens.length) {
    await query(
      db,
      `update fixtures f set pen_home = t.h, pen_away = t.a from unnest($2::bigint[], $3::int[], $4::int[]) as t(id, h, a) where f.career_id = $1 and f.id = t.id`,
      [careerId, pens.map((r) => r.id), pens.map((r) => r.penHome), pens.map((r) => r.penAway)],
    );
  }
  await query(
    db,
    `update fixtures f set home_goals = t.h, away_goals = t.a, played = true
       from unnest($2::bigint[], $3::int[], $4::int[]) as t(id, h, a)
      where f.career_id = $1 and f.id = t.id`,
    [careerId, results.map((r) => r.id), results.map((r) => r.home), results.map((r) => r.away)],
  );
}

export async function addInbox(
  db: Db,
  careerId: string,
  season: number,
  week: number,
  category: string,
  title: string,
  body: string,
  action: unknown = null,
  meta: { sender?: unknown; blocks?: unknown[]; priority?: number; kind?: string } = {},
) {
  // Datum: aktueller Tag der Karriere (wird vor Tagesereignissen gespeichert)
  await query(db, "insert into inbox(career_id, season, week, category, title, body, action, day, sender, blocks, priority, kind) values ($1,$2,$3,$4,$5,$6,$7,(select day from careers where id = $1),$8,$9,$10,$11)", [
    careerId, season, week, category, title, body, action ? JSON.stringify(action) : null,
    meta.sender ? JSON.stringify(meta.sender) : null, meta.blocks?.length ? JSON.stringify(meta.blocks) : null, meta.priority ?? 1, meta.kind ?? null,
  ]);
}

export async function addFinance(
  db: Db,
  careerId: string,
  clubId: number,
  season: number,
  week: number,
  entries: { kind: string; amount: number; label: string }[],
) {
  if (!entries.length) return;
  await query(
    db,
    `insert into finance_log(career_id, club_id, season, week, kind, amount, label)
     select $1, $2, $3, $4, k, a, l from unnest($5::text[], $6::bigint[], $7::text[]) as t(k, a, l)`,
    [careerId, clubId, season, week, entries.map((e) => e.kind), entries.map((e) => Math.round(e.amount)), entries.map((e) => e.label)],
  );
}
