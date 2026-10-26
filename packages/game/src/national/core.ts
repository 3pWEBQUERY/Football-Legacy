/** Nationaltrainer: Zustand, Kader, Spielplan und Spiele der Nationalmannschaft. */
import { COUNTRIES, COUNTRY_BY_CODE, FORMATIONS, Rng, STYLE_PRESETS, autoLineup, computeStandings, dateOf, defaultRole, generateSquad, hashString, internationalWindows, playMatch, positionGroup, quickResult, seedFor, type ClubColors, type CountryProfile, type Formation, type MatchResult, type Player, type Tactic, type TeamSetup } from "@fl/sim";
import type pg from "pg";
import { one, query, type Db } from "../db";
import { addArticle } from "../media";
import { addInbox, getPlayersByIds, savePlayers, type CareerRow } from "../repo";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const SQUAD_SIZE = 23;

export type ObjectiveLevel = "group2" | "qualify" | "semi";

export interface NationalState {
  code: string;
  since: number;
  squad: number[];
  starters: number[];
  formation: Formation;
  preset: string;
  objective: { level: ObjectiveLevel; text: string };
  qualified: boolean;
  groupPos: number | null;
  record: { p: number; w: number; d: number; l: number };
  history: { season: number; text: string }[];
}

export interface NationalMatch {
  id: number;
  season: number;
  day: number;
  kind: "qual" | "friendly" | "playoff" | "tournament";
  stage: string;
  home: string;
  away: string;
  home_goals: number | null;
  away_goals: number | null;
  pen_home: number | null;
  pen_away: number | null;
  played: boolean;
  user: boolean;
  data: Record<string, unknown> | null;
}

/* ---------- Grundlagen ---------- */

export const nation = (code: string): CountryProfile => COUNTRY_BY_CODE[code];
export const nationRating = (code: string) => Math.round(40 + (nation(code)?.strength ?? 3) * 5);
/** Nötiger Manager-Ruf für eine Nation. */
export const requiredReputation = (code: string) => Math.round(10 + (nation(code)?.strength ?? 3) * 7);

const PALETTE: [string, string][] = [
  ["#c8102e", "#ffffff"], ["#003399", "#ffffff"], ["#ffffff", "#1d2c5e"], ["#008c45", "#ffffff"], ["#ffcd00", "#00205b"],
  ["#ef7d00", "#ffffff"], ["#6cace4", "#ffffff"], ["#111111", "#ffd100"], ["#7a0019", "#ffffff"], ["#00843d", "#ffcd00"],
];
const FIXED: Record<string, [string, string]> = {
  GER: ["#ffffff", "#111111"], ENG: ["#ffffff", "#1d2c5e"], FRA: ["#1d2c5e", "#ffffff"], ESP: ["#c8102e", "#ffcd00"], ITA: ["#1f5fbf", "#ffffff"],
  NED: ["#ef7d00", "#ffffff"], BRA: ["#ffdf00", "#009b3a"], ARG: ["#75aadb", "#ffffff"], POR: ["#a50021", "#006600"], SUI: ["#d52b1e", "#ffffff"],
  BEL: ["#c8102e", "#000000"], CRO: ["#ffffff", "#c8102e"], USA: ["#ffffff", "#1d2c5e"], MEX: ["#006847", "#ffffff"], JPN: ["#000080", "#ffffff"],
};
export function nationColors(code: string): ClubColors {
  const [primary, secondary] = FIXED[code] ?? PALETTE[hashString(code) % PALETTE.length];
  return { primary, secondary };
}

export function tournamentName(season: number, code: string): string {
  const year = season + 1;
  if (year % 2 === 0) return `Weltmeisterschaft ${year}`;
  const confed = nation(code)?.confed;
  const name = { UEFA: "Europameisterschaft", CONMEBOL: "Südamerikameisterschaft", CONCACAF: "Nord- und Mittelamerikameisterschaft", AFC: "Asienmeisterschaft", CAF: "Afrikameisterschaft", OFC: "Ozeanienmeisterschaft" }[confed ?? "UEFA"];
  return `${name} ${year}`;
}

export function objectiveFor(code: string): NationalState["objective"] {
  const n = nation(code);
  const rank = COUNTRIES.filter((c) => c.confed === n.confed).sort((a, b) => b.strength - a.strength).findIndex((c) => c.code === code) + 1;
  if (rank <= 3) return { level: "semi", text: "Endrunde erreichen und mindestens ins Halbfinale kommen" };
  if (rank <= 10) return { level: "qualify", text: "Qualifikation für die Endrunde" };
  return { level: "group2", text: "Mindestens Platz 2 in der Qualifikationsgruppe" };
}

export async function getNational(db: Db, careerId: string): Promise<NationalState | null> {
  const row = await one<{ data: NationalState }>(db, "select data from national_teams where career_id = $1", [careerId]);
  return row?.data ?? null;
}

export async function saveNational(db: Db, careerId: string, st: NationalState) {
  await query(db, "insert into national_teams(career_id, data) values ($1,$2) on conflict (career_id) do update set data = excluded.data", [careerId, JSON.stringify(st)]);
}

export const fmtDay = (season: number, day: number) => {
  const d = dateOf(season, day);
  return `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]}`;
};

export function windowsOf(career: CareerRow): [number, number][] {
  return career.calendar ? internationalWindows(career.calendar, career.season) : [];
}

/* ---------- Spielerpool ---------- */

export async function nationPool(db: Db, career: CareerRow, code: string, limit = 120): Promise<(Player & { clubName: string | null })[]> {
  const rows = await query<{ data: Player; club_id: number | null; club_name: string | null }>(db,
    `select p.data, p.club_id, c.name as club_name from players p left join clubs c on c.id = p.club_id and c.career_id = p.career_id
      where p.career_id = $1 and p.nationality = $2 order by p.rating desc limit $3`, [career.id, code, limit]);
  return rows.map((r) => ({ ...r.data, clubId: r.club_id, clubName: r.club_name }));
}

/** Gegnerkader: echte Nationalspieler, ergänzt um einen generierten Kader in passender Stärke. */
async function opponentSquad(db: Db, career: CareerRow, code: string): Promise<Player[]> {
  const real = (await nationPool(db, career, code, 30)).filter((p) => p.injuryWeeks === 0);
  let next = -1_000_000 - (hashString(code) % 100_000) * 30;
  const virtual = generateSquad(seedFor(career.seed, "nation", code, career.season), { id: -1 - (hashString(code) % 9999), countryCode: code, rating: nationRating(code), reputation: 50 }, career.season, () => next--)
    .map((p) => ({ ...p, nationality: code, fitness: 100, injuryWeeks: 0, suspendedWeeks: 0 }));
  return [...real, ...virtual];
}

function tacticFor(players: Player[], formation: Formation, preset: string, starters: number[] = []): Tactic {
  const prefer = new Set(starters);
  const ordered = [...players].sort((a, b) => Number(prefer.has(b.id)) - Number(prefer.has(a.id)));
  // Gewählte Stammspieler zuerst einplanen, dann mit den Besten auffüllen
  const first = autoLineup(ordered.filter((p) => prefer.has(p.id)).length >= 11 ? ordered.filter((p) => prefer.has(p.id)) : ordered, formation);
  const lineup = first.lineup;
  const used = new Set(lineup.filter((x): x is number => x !== null));
  if (used.size < 11) {
    const fill = autoLineup(players.filter((p) => !used.has(p.id)), formation).lineup;
    for (let i = 0; i < lineup.length; i++) if (lineup[i] === null) lineup[i] = fill[i];
  }
  const inXi = new Set(lineup.filter((x): x is number => x !== null));
  const bench = players.filter((p) => !inXi.has(p.id)).sort((a, b) => b.rating - a.rating).slice(0, 12).map((p) => p.id);
  return {
    formation, style: { ...(STYLE_PRESETS[preset] ?? STYLE_PRESETS.balanced).style }, lineup, bench,
    roles: FORMATIONS[formation].map((s) => defaultRole(s.position)),
    setPieces: { corners: "far", cornerTaker: null, freeKickTaker: null, penaltyTaker: null },
  };
}

function setupFor(code: string, players: Player[], tactic: Tactic): TeamSetup {
  return { clubId: -1 - (hashString(code) % 9999), name: nation(code).name, shortName: code, colors: nationColors(code), tactic, players, autoSubs: true };
}

/** Automatische Nominierung: 3 Torhüter, 8 Abwehr, 7 Mittelfeld, 5 Angriff. */
export function autoSquad(pool: Player[], keep: number[] = []): number[] {
  const fit = pool.filter((p) => p.injuryWeeks === 0);
  const keepSet = new Set(keep.filter((id) => fit.some((p) => p.id === id)));
  const need = { GK: 3, DEF: 8, MID: 7, ATT: 5 };
  const chosen: number[] = [...keepSet];
  for (const p of fit.filter((x) => keepSet.has(x.id))) need[positionGroup(p.position)]--;
  for (const p of fit) {
    if (chosen.length >= SQUAD_SIZE) break;
    if (keepSet.has(p.id)) continue;
    const g = positionGroup(p.position);
    if (need[g] > 0) {
      chosen.push(p.id);
      need[g]--;
    }
  }
  for (const p of fit) {
    if (chosen.length >= SQUAD_SIZE) break;
    if (!chosen.includes(p.id)) chosen.push(p.id);
  }
  return chosen.slice(0, SQUAD_SIZE);
}

/* ---------- Spielplan ---------- */

export async function insertMatch(db: Db, career: CareerRow, m: { season: number; day: number; kind: NationalMatch["kind"]; stage: string; home: string; away: string; user: boolean }) {
  const r = await one<{ id: number }>(db,
    "insert into national_matches(career_id, season, day, kind, stage, home, away, user_match) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [career.id, m.season, m.day, m.kind, m.stage, m.home, m.away, m.user]);
  return r!.id;
}

/** Qualifikationsgruppe für die nächste Endrunde in den ersten drei Länderspielpausen. */
export async function createQualification(db: Db, career: CareerRow, st: NationalState): Promise<boolean> {
  const windows = windowsOf(career).filter(([a]) => a > career.day);
  if (windows.length < 3) return false;
  const rng = new Rng(seedFor(career.seed, "nation-qual", st.code, career.season));
  const me = nation(st.code);
  const others = COUNTRIES.filter((c) => c.confed === me.confed && c.code !== st.code)
    .map((c) => ({ c, d: Math.abs(c.strength - me.strength) + rng.next() * 2.5 }))
    .sort((a, b) => a.d - b.d).slice(0, 9);
  const group = [st.code, ...rng.shuffle(others).slice(0, 3).map((x) => x.c.code)];
  const pairs: [number, number][][] = [[[0, 1], [2, 3]], [[2, 0], [1, 3]], [[0, 3], [1, 2]]];
  const rounds = [...pairs, ...pairs.map((r) => r.map(([h, a]) => [a, h] as [number, number]))];
  const days = windows.slice(0, 3).flatMap(([a]) => [a + 1, a + 3]);
  const stage = `Qualifikation ${tournamentName(career.season, st.code)}`;
  for (let i = 0; i < 6; i++) {
    for (const [h, a] of rounds[i]) {
      await insertMatch(db, career, { season: career.season, day: days[i], kind: "qual", stage, home: group[h], away: group[a], user: h === 0 || a === 0 });
    }
  }
  st.qualified = false;
  st.groupPos = null;
  return true;
}

/** Testspiele gegen Nationen ähnlicher Stärke, falls das Fenster sonst leer ist. */
export async function scheduleFriendlies(db: Db, career: CareerRow, st: NationalState, window: [number, number]) {
  const existing = await query<{ day: number }>(db, "select day from national_matches where career_id = $1 and season = $2 and user_match and day between $3 and $4", [career.id, career.season, window[0], window[1]]);
  const rng = new Rng(seedFor(career.seed, "nation-friendly", career.season, window[0]));
  const me = nation(st.code);
  const pool = COUNTRIES.filter((c) => c.code !== st.code && Math.abs(c.strength - me.strength) <= 2.5);
  for (const day of [window[0] + 1, window[0] + 3]) {
    if (existing.some((e) => e.day === day) || !pool.length) continue;
    const opp = pool[rng.int(0, pool.length - 1)];
    const home = rng.chance(0.5);
    await insertMatch(db, career, { season: career.season, day, kind: "friendly", stage: "Testspiel", home: home ? st.code : opp.code, away: home ? opp.code : st.code, user: true });
  }
}

/* ---------- Spiele ---------- */

interface Played { home: number; away: number; penHome?: number; penAway?: number; result?: MatchResult }

export async function playUserMatch(db: pg.PoolClient, career: CareerRow, st: NationalState, m: NationalMatch, clubSquad: Player[], knockout: boolean): Promise<Played> {
  const own = new Map(clubSquad.map((p) => [p.id, p]));
  const fromDb = await getPlayersByIds(db, career.id, st.squad);
  let available = st.squad.map((id) => own.get(id) ?? fromDb.find((p) => p.id === id)).filter((p): p is Player => !!p && p.injuryWeeks === 0);
  if (available.length < 18) {
    // Ausfälle aus dem Spielerpool ersetzen
    const extra = (await nationPool(db, career, st.code, 60)).filter((p) => p.injuryWeeks === 0 && !available.some((a) => a.id === p.id));
    available = [...available, ...extra.slice(0, 18 - available.length)];
  }
  // Länderspiele nach Anreise und Erholung: ausgeruhte Spieler (Kopie nur für die Simulation)
  const players = available.map((p) => ({ ...p, fitness: Math.max(p.fitness, 92) }));
  const userHome = m.home === st.code;
  const oppCode = userHome ? m.away : m.home;
  const opp = await opponentSquad(db, career, oppCode);
  const mine = setupFor(st.code, players, tacticFor(players, st.formation, st.preset, st.starters));
  const theirs = setupFor(oppCode, opp, tacticFor(opp, "4-4-2", "balanced"));
  const result = playMatch({ seed: seedFor(career.seed, "national-match", m.id), home: userHome ? mine : theirs, away: userHome ? theirs : mine, homeAdvantage: m.kind === "tournament" ? 1 : undefined });
  const out: Played = { home: result.homeGoals, away: result.awayGoals, result };
  if (knockout && result.homeGoals === result.awayGoals) {
    const rng = new Rng(seedFor(career.seed, "national-pens", m.id));
    const ph = rng.int(3, 5);
    let pa = rng.int(3, 5);
    if (pa === ph) pa = rng.chance(0.5) ? ph + 1 : ph - 1;
    out.penHome = ph;
    out.penAway = pa;
  }
  // Länderspiele und Tore für die eigenen Nominierten
  const mySide = userHome ? 0 : 1;
  const touched: Player[] = [];
  for (const line of result.players) {
    if (line.side !== mySide || line.minutes <= 0) continue;
    const p = own.get(line.playerId) ?? fromDb.find((x) => x.id === line.playerId) ?? available.find((x) => x.id === line.playerId);
    if (!p) continue;
    p.caps = (p.caps ?? 0) + 1;
    p.intlGoals = (p.intlGoals ?? 0) + line.goals;
    if (line.injured) p.injuryWeeks = Math.max(p.injuryWeeks, 1);
    if (!own.has(p.id)) touched.push(p);
  }
  if (touched.length) await savePlayers(db, career.id, touched);
  return out;
}

export function quickNational(career: CareerRow, m: NationalMatch, knockout: boolean): Played {
  const rng = new Rng(seedFor(career.seed, "national-quick", m.id));
  const [h, a] = quickResult(rng, nationRating(m.home) + (m.kind === "tournament" ? 0 : 2), nationRating(m.away));
  const out: Played = { home: h, away: a };
  if (knockout && h === a) {
    out.penHome = rng.int(3, 5);
    out.penAway = out.penHome + (rng.chance(nationRating(m.home) / (nationRating(m.home) + nationRating(m.away))) ? -1 : 1);
  }
  return out;
}

export async function storeResult(db: Db, m: NationalMatch, r: Played) {
  const data = r.result ? {
    events: r.result.events.filter((e) => !["foul", "corner", "freekick"].includes(e.type)),
    stats: r.result.stats, players: r.result.players, motm: r.result.motm,
  } : null;
  await query(db, "update national_matches set home_goals = $2, away_goals = $3, pen_home = $4, pen_away = $5, played = true, data = $6 where id = $1",
    [m.id, r.home, r.away, r.penHome ?? null, r.penAway ?? null, data ? JSON.stringify(data) : null]);
  m.home_goals = r.home;
  m.away_goals = r.away;
  m.pen_home = r.penHome ?? null;
  m.pen_away = r.penAway ?? null;
  m.played = true;
}

export const winnerOf = (m: { home: string; away: string; home_goals: number | null; away_goals: number | null; pen_home: number | null; pen_away: number | null }) =>
  (m.home_goals ?? 0) > (m.away_goals ?? 0) || ((m.home_goals === m.away_goals) && (m.pen_home ?? 0) > (m.pen_away ?? 0)) ? m.home : m.away;

export function scoreText(m: NationalMatch) {
  return `${nation(m.home).name} – ${nation(m.away).name} ${m.home_goals}:${m.away_goals}${m.pen_home !== null ? ` (${m.pen_home}:${m.pen_away} i. E.)` : ""}`;
}

export async function reportUserMatch(db: Db, career: CareerRow, st: NationalState, m: NationalMatch, r: Played) {
  const mine = m.home === st.code;
  const gf = mine ? m.home_goals! : m.away_goals!;
  const ga = mine ? m.away_goals! : m.home_goals!;
  const won = winnerOf(m) === st.code && !(gf === ga && m.pen_home === null);
  const draw = gf === ga && m.pen_home === null;
  st.record.p++;
  if (draw) st.record.d++; else if (won) st.record.w++; else st.record.l++;
  const scorers = (r.result?.players ?? []).filter((l) => l.side === (mine ? 0 : 1) && l.goals > 0).map((l) => (l.goals > 1 ? `${l.name} (${l.goals})` : l.name));
  const opp = nation(mine ? m.away : m.home).name;
  const title = `${m.stage}: ${scoreText(m)}`;
  await addInbox(db, career.id, career.season, career.week, "international", title,
    `${m.stage} – ${scoreText(m)}.${scorers.length ? `\nTore für ${nation(st.code).name}: ${scorers.join(", ")}.` : ""}\n\nDen Spielbericht findest du unter Nationalteam → Spiele.`,
    { type: "national" });
  const headline = draw ? `${nation(st.code).name} und ${opp} trennen sich ${gf}:${ga}` : won ? `${nation(st.code).name} besiegt ${opp}` : `${nation(st.code).name} verliert gegen ${opp}`;
  await addArticle(db, career, { kind: "match", title: headline, body: `${m.stage}: ${scoreText(m)}.${scorers.length ? ` Torschützen: ${scorers.join(", ")}.` : ""} Nationaltrainer ist ${career.manager_name}.`, own: true, importance: m.kind === "tournament" ? 3 : 2 });
}

/** Gruppentabelle aus gespielten Partien. */
export function groupTable(codes: string[], matches: NationalMatch[]) {
  const t = computeStandings(codes.map((_, i) => i), matches.filter((m) => m.played).map((m) => ({
    homeId: codes.indexOf(m.home), awayId: codes.indexOf(m.away), homeGoals: m.home_goals ?? 0, awayGoals: m.away_goals ?? 0, round: 0,
  })));
  return t.map((r) => ({ code: codes[r.clubId], name: nation(codes[r.clubId]).name, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, gf: r.goalsFor, ga: r.goalsAgainst, points: r.points }));
}

export async function qualMatches(db: Db, career: CareerRow): Promise<NationalMatch[]> {
  return query<NationalMatch>(db, "select *, user_match as user from national_matches where career_id = $1 and season = $2 and kind = 'qual' order by day, id", [career.id, career.season]);
}
