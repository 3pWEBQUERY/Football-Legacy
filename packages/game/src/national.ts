/**
 * Nationaltrainer: Neben (oder ohne) Verein betreust du eine Nationalmannschaft.
 * In den Länderspielpausen nominierst du den Kader, spielst die Qualifikation
 * (Gruppe mit vier Nationen, Playoffs im März) und am Saisonende die Endrunde
 * (abwechselnd Weltmeisterschaft und Kontinentalmeisterschaft).
 */
import {
  COUNTRIES, COUNTRY_BY_CODE, FORMATIONS, Rng, STYLE_PRESETS, autoLineup, computeStandings, dateOf, defaultRole, generateSquad,
  hashString, internationalWindows, playMatch, positionGroup, quickResult, seedFor,
  type ClubColors, type CountryProfile, type Formation, type MatchResult, type Player, type Tactic, type TeamSetup,
} from "@fl/sim";
import type pg from "pg";
import { type Db, one, pool, query } from "./db";
import { activateClubs, readCareer, withCareer } from "./career";
import { GameError } from "./errors";
import { addArticle } from "./media";
import { type CareerRow, addInbox, getClubs, getLeagues, getPlayersByIds, saveCareer, savePlayers } from "./repo";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const SQUAD_SIZE = 23;

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

interface NationalMatch {
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

const nation = (code: string): CountryProfile => COUNTRY_BY_CODE[code];
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

function objectiveFor(code: string): NationalState["objective"] {
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

async function saveNational(db: Db, careerId: string, st: NationalState) {
  await query(db, "insert into national_teams(career_id, data) values ($1,$2) on conflict (career_id) do update set data = excluded.data", [careerId, JSON.stringify(st)]);
}

const fmtDay = (season: number, day: number) => {
  const d = dateOf(season, day);
  return `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]}`;
};

function windowsOf(career: CareerRow): [number, number][] {
  return career.calendar ? internationalWindows(career.calendar, career.season) : [];
}

/* ---------- Spielerpool ---------- */

async function nationPool(db: Db, career: CareerRow, code: string, limit = 120): Promise<(Player & { clubName: string | null })[]> {
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
function autoSquad(pool: Player[], keep: number[] = []): number[] {
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

async function insertMatch(db: Db, career: CareerRow, m: { season: number; day: number; kind: NationalMatch["kind"]; stage: string; home: string; away: string; user: boolean }) {
  const r = await one<{ id: number }>(db,
    "insert into national_matches(career_id, season, day, kind, stage, home, away, user_match) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [career.id, m.season, m.day, m.kind, m.stage, m.home, m.away, m.user]);
  return r!.id;
}

/** Qualifikationsgruppe für die nächste Endrunde in den ersten drei Länderspielpausen. */
async function createQualification(db: Db, career: CareerRow, st: NationalState): Promise<boolean> {
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
async function scheduleFriendlies(db: Db, career: CareerRow, st: NationalState, window: [number, number]) {
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

async function playUserMatch(db: pg.PoolClient, career: CareerRow, st: NationalState, m: NationalMatch, clubSquad: Player[], knockout: boolean): Promise<Played> {
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

function quickNational(career: CareerRow, m: NationalMatch, knockout: boolean): Played {
  const rng = new Rng(seedFor(career.seed, "national-quick", m.id));
  const [h, a] = quickResult(rng, nationRating(m.home) + (m.kind === "tournament" ? 0 : 2), nationRating(m.away));
  const out: Played = { home: h, away: a };
  if (knockout && h === a) {
    out.penHome = rng.int(3, 5);
    out.penAway = out.penHome + (rng.chance(nationRating(m.home) / (nationRating(m.home) + nationRating(m.away))) ? -1 : 1);
  }
  return out;
}

async function storeResult(db: Db, m: NationalMatch, r: Played) {
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

const winnerOf = (m: { home: string; away: string; home_goals: number | null; away_goals: number | null; pen_home: number | null; pen_away: number | null }) =>
  (m.home_goals ?? 0) > (m.away_goals ?? 0) || ((m.home_goals === m.away_goals) && (m.pen_home ?? 0) > (m.pen_away ?? 0)) ? m.home : m.away;

function scoreText(m: NationalMatch) {
  return `${nation(m.home).name} – ${nation(m.away).name} ${m.home_goals}:${m.away_goals}${m.pen_home !== null ? ` (${m.pen_home}:${m.pen_away} i. E.)` : ""}`;
}

async function reportUserMatch(db: Db, career: CareerRow, st: NationalState, m: NationalMatch, r: Played) {
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
function groupTable(codes: string[], matches: NationalMatch[]) {
  const t = computeStandings(codes.map((_, i) => i), matches.filter((m) => m.played).map((m) => ({
    homeId: codes.indexOf(m.home), awayId: codes.indexOf(m.away), homeGoals: m.home_goals ?? 0, awayGoals: m.away_goals ?? 0, round: 0,
  })));
  return t.map((r) => ({ code: codes[r.clubId], name: nation(codes[r.clubId]).name, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, gf: r.goalsFor, ga: r.goalsAgainst, points: r.points }));
}

async function qualMatches(db: Db, career: CareerRow): Promise<NationalMatch[]> {
  return query<NationalMatch>(db, "select *, user_match as user from national_matches where career_id = $1 and season = $2 and kind = 'qual' order by day, id", [career.id, career.season]);
}

/* ---------- Tageslauf ---------- */

/** Täglich: Erinnerung, Nominierung, Spiele und Auswertung der Länderspielpausen. */
export async function nationalDay(db: pg.PoolClient, career: CareerRow, clubSquad: Player[]): Promise<string[]> {
  const st = await getNational(db, career.id);
  if (!st) return [];
  const out: string[] = [];
  const windows = windowsOf(career);
  const day = career.day;
  for (const [i, w] of windows.entries()) {
    if (day === w[0] - 5) {
      await addInbox(db, career.id, career.season, career.week, "international", `${nation(st.code).name}: Kader nominieren`,
        `Am ${fmtDay(career.season, w[0])} beginnt die Länderspielpause. Nominiere bis dahin deinen Kader (${SQUAD_SIZE} Spieler) unter Nationalteam → Kader. Sonst stellt der Co-Trainer den Kader zusammen.`,
        { type: "national" });
      out.push("Nominierung");
    }
    if (day === w[0]) {
      // März: Playoff für Gruppenzweite, sonst Testspiele
      if (i === 3 && st.groupPos === 2 && !st.qualified) {
        const pool = COUNTRIES.filter((c) => c.confed === nation(st.code).confed && c.code !== st.code);
        const rng = new Rng(seedFor(career.seed, "nation-playoff", career.season));
        const opp = pool.sort((a, b) => Math.abs(a.strength - nation(st.code).strength) - Math.abs(b.strength - nation(st.code).strength))[rng.int(0, Math.min(5, pool.length - 1))];
        await insertMatch(db, career, { season: career.season, day: w[0] + 1, kind: "playoff", stage: "Playoff-Halbfinale", home: st.code, away: opp.code, user: true });
      } else {
        await scheduleFriendlies(db, career, st, w);
      }
      const pool = await nationPool(db, career, st.code);
      const own = new Map(clubSquad.map((p) => [p.id, p]));
      const current = pool.map((p) => own.get(p.id) ?? p);
      const before = st.squad.length;
      st.squad = autoSquad(current, st.squad);
      await addInbox(db, career.id, career.season, career.week, "international", `${nation(st.code).name}: Der Kader steht`,
        before >= SQUAD_SIZE ? `Dein Kader mit ${st.squad.length} Spielern ist angereist.` : `Der Co-Trainer hat den Kader auf ${st.squad.length} Spieler ergänzt.`, { type: "national" });
      // Eigene Vereinsspieler sind abgestellt
      for (const p of clubSquad) if (st.squad.includes(p.id)) p.away = { season: career.season, until: w[1] };
      out.push("Länderspielpause");
    }
  }

  const today = await query<NationalMatch>(db, "select *, user_match as user from national_matches where career_id = $1 and season = $2 and day = $3 and not played order by id", [career.id, career.season, day]);
  for (const m of today) {
    const knockout = m.kind === "playoff";
    const r = m.user ? await playUserMatch(db, career, st, m, clubSquad, knockout) : quickNational(career, m, knockout);
    await storeResult(db, m, r);
    if (m.user) {
      await reportUserMatch(db, career, st, m, r);
      out.push(m.stage);
      if (m.kind === "playoff") {
        const win = winnerOf(m) === st.code;
        if (win && m.stage === "Playoff-Halbfinale") {
          const w = windows.find(([a, b]) => day >= a && day <= b)!;
          const pool = COUNTRIES.filter((c) => c.confed === nation(st.code).confed && ![st.code, m.away].includes(c.code));
          const opp = pool[new Rng(seedFor(career.seed, "nation-playoff-final", career.season)).int(0, pool.length - 1)];
          await insertMatch(db, career, { season: career.season, day: w[0] + 3, kind: "playoff", stage: "Playoff-Finale", home: opp.code, away: st.code, user: true });
        } else if (win) {
          st.qualified = true;
          await addInbox(db, career.id, career.season, career.week, "international", `${nation(st.code).name} fährt zur Endrunde!`,
            `Über die Playoffs hat sich ${nation(st.code).name} für die ${tournamentName(career.season, st.code)} qualifiziert. Die Endrunde findet nach Saisonende statt.`, { type: "national" });
        } else if (await missedQualification(db, career, st, "in den Playoffs")) {
          return out;
        }
      }
    }
  }

  // Nach der dritten Pause: Qualifikationsgruppe auswerten
  const third = windows[2];
  if (third && day === third[1] + 1) {
    const qm = await qualMatches(db, career);
    if (qm.length && qm.every((m) => m.played)) {
      const codes = [...new Set(qm.flatMap((m) => [m.home, m.away]))];
      const table = groupTable(codes, qm);
      st.groupPos = table.findIndex((r) => r.code === st.code) + 1;
      if (st.groupPos === 1) {
        st.qualified = true;
        await addInbox(db, career.id, career.season, career.week, "international", `Gruppensieg! ${nation(st.code).name} ist qualifiziert`,
          `${nation(st.code).name} gewinnt die Qualifikationsgruppe mit ${table[0].points} Punkten und fährt zur ${tournamentName(career.season, st.code)}.`, { type: "national" });
        await addArticle(db, career, { kind: "league", title: `${nation(st.code).name} löst das Ticket zur Endrunde`, body: `Mit ${table[0].points} Punkten aus ${table[0].played} Spielen gewinnt ${nation(st.code).name} unter ${career.manager_name} die Qualifikationsgruppe.`, own: true, importance: 3 });
      } else if (st.groupPos === 2) {
        await addInbox(db, career.id, career.season, career.week, "international", `${nation(st.code).name}: Platz 2 – Playoffs im März`,
          "Der zweite Platz reicht nicht direkt. In der Länderspielpause im März geht es in den Playoffs um die letzten Tickets zur Endrunde.", { type: "national" });
      } else if (await missedQualification(db, career, st, `als Gruppen${st.groupPos}.`)) {
        return out;
      }
    }
  }
  await saveNational(db, career.id, st);
  return out;
}

/** Liefert true, wenn der Verband dich entlässt. */
async function missedQualification(db: Db, career: CareerRow, st: NationalState, how: string): Promise<boolean> {
  const dismissed = st.objective.level !== "group2" || (st.groupPos ?? 4) > 2;
  st.history.push({ season: career.season, text: `Qualifikation verpasst (${how})` });
  if (dismissed) {
    await addInbox(db, career.id, career.season, career.week, "international", `Der Verband trennt sich von dir`,
      `${nation(st.code).name} hat die Endrunde ${how} verpasst. Das Ziel „${st.objective.text}“ wurde nicht erreicht – der Verband beendet die Zusammenarbeit.`);
    await addArticle(db, career, { kind: "league", title: `${nation(st.code).name} entlässt ${career.manager_name}`, body: `Nach der verpassten Qualifikation trennt sich der Verband von Nationaltrainer ${career.manager_name}.`, own: true, importance: 3 });
    await query(db, "delete from national_teams where career_id = $1", [career.id]);
    await query(db, "delete from national_matches where career_id = $1 and not played", [career.id]);
    career.manager.reputation = Math.max(1, career.manager.reputation - 5);
    return true;
  }
  {
    await addInbox(db, career.id, career.season, career.week, "international", `${nation(st.code).name}: Endrunde verpasst`,
      `Die Qualifikation ist ${how} gescheitert. Der Verband ist trotzdem zufrieden, da das Ziel erreicht wurde.`);
  }
  return false;
}

/* ---------- Endrunde ---------- */

/** Nach Saisonende: Endrunde mit 16 (bzw. 8) Nationen. Liefert eine Zusammenfassung oder null. */
export async function nationalTournament(db: pg.PoolClient, career: CareerRow): Promise<string | null> {
  const st = await getNational(db, career.id);
  if (!st) return null;
  if (!st.qualified) {
    await saveNational(db, career.id, st);
    return null;
  }
  const name = tournamentName(career.season, st.code);
  const world = name.startsWith("Weltmeisterschaft");
  const rng = new Rng(seedFor(career.seed, "nation-tournament", career.season));
  const candidates = COUNTRIES.filter((c) => c.code !== st.code && (world || c.confed === nation(st.code).confed));
  const size = candidates.length + 1 >= 16 ? 16 : candidates.length + 1 >= 8 ? 8 : 4;
  const field = [st.code, ...candidates.map((c) => ({ c, s: c.strength + rng.next() * 3 })).sort((a, b) => b.s - a.s).slice(0, size - 1).map((x) => x.c.code)];
  // Töpfe nach Stärke, Gruppen zu viert
  const pots = [...field].sort((a, b) => nation(b).strength - nation(a).strength);
  const groupCount = size / 4;
  const groups: string[][] = Array.from({ length: groupCount }, () => []);
  for (let p = 0; p < 4; p++) {
    const pot = rng.shuffle(pots.slice(p * groupCount, (p + 1) * groupCount));
    pot.forEach((code, i) => groups[i].push(code));
  }
  const baseDay = (career.calendar?.slots.at(-1)?.day ?? 320) + 14;
  const letters = "ABCD";
  const squad = await getPlayersByIds(db, career.id, st.squad);
  // Vor der Endrunde: Kader ohne Verletzte, aufgefüllt
  st.squad = autoSquad((await nationPool(db, career, st.code)).filter((p) => p.injuryWeeks === 0), squad.filter((p) => p.injuryWeeks === 0).map((p) => p.id));
  const lines: string[] = [];
  let userAlive = true;
  let reached = "Gruppenphase";

  const play = async (m: NationalMatch, knockout: boolean) => {
    const r = m.user ? await playUserMatch(db, career, st, m, [], knockout) : quickNational(career, m, knockout);
    await storeResult(db, m, r);
    if (m.user) await reportUserMatch(db, career, st, m, r);
    return m;
  };
  const make = async (day: number, stage: string, home: string, away: string): Promise<NationalMatch> => {
    const id = await insertMatch(db, career, { season: career.season, day, kind: "tournament", stage: `${name} · ${stage}`, home, away, user: home === st.code || away === st.code });
    return { id, season: career.season, day, kind: "tournament", stage: `${name} · ${stage}`, home, away, home_goals: null, away_goals: null, pen_home: null, pen_away: null, played: false, user: home === st.code || away === st.code, data: null };
  };

  // Gruppenphase
  const qualifiedFrom: string[][] = [];
  for (const [gi, g] of groups.entries()) {
    const ms: NationalMatch[] = [];
    const rounds: [number, number][][] = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
    for (const [ri, r] of rounds.entries()) for (const [h, a] of r) ms.push(await play(await make(baseDay + ri * 4, `Gruppe ${letters[gi]}`, g[h], g[a]), false));
    const table = groupTable(g, ms);
    qualifiedFrom.push(table.slice(0, 2).map((t) => t.code));
    if (g.includes(st.code)) {
      const pos = table.findIndex((t) => t.code === st.code) + 1;
      lines.push(`Gruppe ${letters[gi]}: Platz ${pos} (${table[pos - 1].points} Punkte)`);
      if (pos > 2) userAlive = false;
    }
  }
  // K.-o.-Runden
  let bracket: string[] = [];
  if (groupCount === 4) bracket = [qualifiedFrom[0][0], qualifiedFrom[1][1], qualifiedFrom[2][0], qualifiedFrom[3][1], qualifiedFrom[1][0], qualifiedFrom[0][1], qualifiedFrom[3][0], qualifiedFrom[2][1]];
  else if (groupCount === 2) bracket = [qualifiedFrom[0][0], qualifiedFrom[1][1], qualifiedFrom[1][0], qualifiedFrom[0][1]];
  else bracket = qualifiedFrom[0];
  const roundNames = bracket.length === 8 ? ["Viertelfinale", "Halbfinale", "Finale"] : bracket.length === 4 ? ["Halbfinale", "Finale"] : ["Finale"];
  let day = baseDay + 14;
  for (const rn of roundNames) {
    const next: string[] = [];
    for (let i = 0; i < bracket.length; i += 2) {
      const m = await play(await make(day, rn, bracket[i], bracket[i + 1]), true);
      const w = winnerOf(m);
      next.push(w);
      if (m.user) {
        lines.push(`${rn}: ${scoreText(m)}`);
        if (w === st.code) reached = rn === "Finale" ? "Turniersieg" : roundNames[roundNames.indexOf(rn) + 1];
        else {
          userAlive = false;
          reached = rn;
        }
      }
    }
    bracket = next;
    day += 5;
  }
  const champion = bracket[0];
  if (userAlive && champion === st.code) reached = "Turniersieg";
  if (reached === "Gruppenphase" && userAlive === false && !lines.some((l) => l.startsWith("Viertel") || l.startsWith("Halb"))) reached = "Gruppenphase";

  // Bewertung
  const order = ["Gruppenphase", "Viertelfinale", "Halbfinale", "Finale", "Turniersieg"];
  const reachedIdx = order.indexOf(reached);
  const failed = st.objective.level === "semi" && reachedIdx < order.indexOf("Halbfinale");
  st.history.push({ season: career.season, text: `${name}: ${reached === "Turniersieg" ? "Turniersieger" : `Aus im ${reached === "Gruppenphase" ? "Gruppenspiel" : reached}`}` });
  st.qualified = false;
  st.groupPos = null;
  career.manager.reputation = Math.max(1, Math.min(100, career.manager.reputation + [-2, 2, 4, 6, 12][reachedIdx]));
  const summary = `${name}: ${reached === "Turniersieg" ? `${nation(st.code).name} ist Turniersieger!` : `${nation(st.code).name} scheidet ${reached === "Gruppenphase" ? "in der Gruppenphase" : `im ${reached}`} aus.`} Sieger: ${nation(champion).name}.`;
  await addInbox(db, career.id, career.season, career.week, "international", reached === "Turniersieg" ? `${nation(st.code).name} gewinnt die ${name}!` : `${name} beendet`,
    `${lines.map((l) => `• ${l}`).join("\n")}\n\nTurniersieger: ${nation(champion).name}.` + (failed ? `\n\nDas Ziel „${st.objective.text}“ wurde verfehlt. Der Verband trennt sich von dir.` : ""), { type: "national" });
  await addArticle(db, career, { kind: "league", title: reached === "Turniersieg" ? `${nation(st.code).name} gewinnt die ${name}` : `${name}: ${nation(champion).name} holt den Titel`, body: summary, own: true, importance: 3 });
  if (failed) {
    await query(db, "delete from national_teams where career_id = $1", [career.id]);
    return summary;
  }
  await saveNational(db, career.id, st);
  return summary;
}

/** Neue Saison: Qualifikation für die nächste Endrunde ansetzen. */
export async function nationalNewSeason(db: pg.PoolClient, career: CareerRow) {
  const st = await getNational(db, career.id);
  if (!st) return;
  if (await createQualification(db, career, st)) {
    await addInbox(db, career.id, career.season, 0, "international", `${nation(st.code).name}: Qualifikation ausgelost`,
      `Die Qualifikation zur ${tournamentName(career.season, st.code)} beginnt in der Länderspielpause im September. Gruppengegner findest du unter Nationalteam.`, { type: "national" });
  }
  await saveNational(db, career.id, st);
}

/* ---------- Aktionen und Ansichten ---------- */

export async function nationalJobs(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const st = await getNational(pool(), career.id);
  const rep = Math.round(career.manager.reputation);
  const all = COUNTRIES.map((c) => ({ code: c.code, name: c.name, confed: c.confed, strength: c.strength, required: requiredReputation(c.code), rating: nationRating(c.code) }));
  // Die stärksten erreichbaren Posten, dazu die nächsten, die bald erreichbar sind, und das Heimatland
  const open = all.filter((c) => c.required <= rep).sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name)).slice(0, 20);
  const soon = all.filter((c) => c.required > rep).sort((a, b) => a.required - b.required || b.strength - a.strength).slice(0, 8);
  const home = all.find((c) => c.code === career.country_code);
  const list = [...new Map([...soon, ...open, ...(home ? [home] : [])].map((c) => [c.code, c])).values()]
    .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
  return {
    reputation: rep,
    current: st ? { code: st.code, name: nation(st.code).name } : null,
    jobs: list.map((c) => ({ ...c, colors: nationColors(c.code), available: rep >= c.required, home: c.code === career.country_code })),
  };
}

export async function takeNationalJob(careerId: string, accountId: string, code: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!nation(code)) throw new GameError("Unbekannte Nation");
    if (await getNational(db, career.id)) throw new GameError("Du betreust bereits eine Nationalmannschaft. Trete zuerst zurück.");
    if (career.manager.reputation < requiredReputation(code)) throw new GameError(`Für ${nation(code).name} brauchst du einen Manager-Ruf von mindestens ${requiredReputation(code)}.`);
    // Spieler der Nation verfügbar machen: oberste Liga des Landes simulieren
    const leagues = await getLeagues(db, career.id);
    const top = leagues.find((l) => l.country_code === code && l.tier === 1);
    if (top) {
      const clubs = await getClubs(db, career.id, "league_id = $2 and not players_generated", [top.id]);
      if (clubs.length) await activateClubs(db, career, clubs, new Map(leagues.map((l) => [l.id, l])));
    }
    const st: NationalState = {
      code, since: career.season, squad: [], starters: [], formation: "4-3-3", preset: "balanced",
      objective: objectiveFor(code), qualified: false, groupPos: null, record: { p: 0, w: 0, d: 0, l: 0 }, history: [],
    };
    st.squad = autoSquad(await nationPool(db, career, code));
    const qual = await createQualification(db, career, st);
    await saveNational(db, career.id, st);
    await addInbox(db, career.id, career.season, career.week, "international", `Neuer Job: Nationaltrainer von ${nation(code).name}`,
      `Der Verband von ${nation(code).name} stellt dich als Nationaltrainer vor. Ziel: ${st.objective.text}.\n\n` +
        (qual ? `Die Qualifikation zur ${tournamentName(career.season, code)} beginnt in der nächsten Länderspielpause.` : "In dieser Saison stehen nur noch Testspiele an; die Qualifikation beginnt nächste Saison."),
      { type: "national" });
    await addArticle(db, career, { kind: "league", title: `${career.manager_name} wird Nationaltrainer von ${nation(code).name}`, body: `Der Verband von ${nation(code).name} hat ${career.manager_name} verpflichtet. Ziel: ${st.objective.text}.`, own: true, importance: 3 });
    await saveCareer(db, career);
    return { message: `Du bist jetzt Nationaltrainer von ${nation(code).name}.` };
  });
}

export async function resignNationalJob(careerId: string, accountId: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    const st = await getNational(db, career.id);
    if (!st) throw new GameError("Du betreust keine Nationalmannschaft.");
    await query(db, "delete from national_teams where career_id = $1", [career.id]);
    await query(db, "delete from national_matches where career_id = $1 and not played", [career.id]);
    career.manager.reputation = Math.max(1, career.manager.reputation - 2);
    await saveCareer(db, career);
    await addInbox(db, career.id, career.season, career.week, "international", `Rücktritt als Nationaltrainer`, `Du hast dein Amt bei ${nation(st.code).name} niedergelegt.`);
    return { message: `Du bist als Nationaltrainer von ${nation(st.code).name} zurückgetreten.` };
  });
}

export async function nationalView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const st = await getNational(pool(), career.id);
  if (!st) return { coach: false as const, jobs: await nationalJobs(careerId, accountId) };
  const matches = await query<NationalMatch>(pool(), "select *, user_match as user from national_matches where career_id = $1 order by season desc, day desc, id desc limit 200", [career.id]);
  const season = matches.filter((m) => m.season === career.season);
  const qual = season.filter((m) => m.kind === "qual").sort((a, b) => a.day - b.day || a.id - b.id);
  const qualCodes = [...new Set(qual.flatMap((m) => [m.home, m.away]))];
  const windows = windowsOf(career);
  const nextWindow = windows.find(([, b]) => b >= career.day) ?? null;
  const fmt = (m: NationalMatch) => ({
    id: m.id, season: m.season, day: m.day, date: dateOf(m.season, m.day).toISOString().slice(0, 10), kind: m.kind, stage: m.stage,
    home: { code: m.home, name: nation(m.home)?.name ?? m.home, colors: nationColors(m.home) },
    away: { code: m.away, name: nation(m.away)?.name ?? m.away, colors: nationColors(m.away) },
    homeGoals: m.home_goals, awayGoals: m.away_goals, penHome: m.pen_home, penAway: m.pen_away, played: m.played, user: m.user, hasReport: !!m.data,
  });
  const lastTournament = matches.filter((m) => m.kind === "tournament");
  const tSeason = lastTournament[0]?.season ?? null;
  return {
    coach: true as const,
    career: { season: career.season, day: career.day },
    nation: { code: st.code, name: nation(st.code).name, confed: nation(st.code).confed, strength: nation(st.code).strength, colors: nationColors(st.code), rating: nationRating(st.code) },
    objective: st.objective,
    tournament: tournamentName(career.season, st.code),
    qualified: st.qualified,
    groupPos: st.groupPos,
    record: st.record,
    history: st.history,
    since: st.since,
    squadSize: st.squad.length,
    nextWindow: nextWindow ? { start: nextWindow[0], end: nextWindow[1], label: `${fmtDay(career.season, nextWindow[0])} – ${fmtDay(career.season, nextWindow[1])}`, deadline: fmtDay(career.season, nextWindow[0]) } : null,
    group: qualCodes.length ? { name: qual[0].stage, table: groupTable(qualCodes, qual).map((r) => ({ ...r, own: r.code === st.code, colors: nationColors(r.code) })) } : null,
    upcoming: season.filter((m) => !m.played && m.user).sort((a, b) => a.day - b.day).map(fmt),
    results: matches.filter((m) => m.played && m.user).slice(0, 30).map(fmt),
    qualMatches: qual.map(fmt),
    lastTournament: tSeason !== null ? { season: tSeason, matches: lastTournament.filter((m) => m.season === tSeason).sort((a, b) => a.day - b.day || a.id - b.id).map(fmt) } : null,
  };
}

export async function nationalSquadView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const st = await getNational(pool(), career.id);
  if (!st) throw new GameError("Du betreust keine Nationalmannschaft.");
  const pool_ = await nationPool(pool(), career, st.code, 150);
  const selected = new Set(st.squad);
  const clubs = new Map((await getClubs(pool(), career.id, "id = any($2::int[])", [[...new Set(pool_.map((p) => p.clubId).filter((x): x is number => x !== null))]])).map((c) => [c.id, c]));
  return {
    nation: { code: st.code, name: nation(st.code).name, colors: nationColors(st.code) },
    formation: st.formation, preset: st.preset, starters: st.starters,
    formations: Object.keys(FORMATIONS), presets: Object.fromEntries(Object.entries(STYLE_PRESETS).map(([k, v]) => [k, v.name])),
    max: SQUAD_SIZE,
    players: pool_.map((p) => ({
      id: p.id, name: `${p.firstName} ${p.lastName}`, age: p.age, nationality: p.nationality, position: p.position, rating: p.rating, form: p.form,
      fitness: p.fitness, injuryWeeks: p.injuryWeeks, caps: p.caps ?? 0, intlGoals: p.intlGoals ?? 0,
      club: p.clubName, clubId: p.clubId, kit: p.clubId !== null ? clubs.get(p.clubId)?.colors ?? null : null, own: p.clubId === career.club_id,
      selected: selected.has(p.id), starter: st.starters.includes(p.id),
    })),
  };
}

export async function saveNationalSquad(careerId: string, accountId: string, input: { squad?: unknown; starters?: unknown; formation?: unknown; preset?: unknown; auto?: unknown }) {
  return withCareer(careerId, accountId, async (db, career) => {
    const st = await getNational(db, career.id);
    if (!st) throw new GameError("Du betreust keine Nationalmannschaft.");
    const poolPlayers = await nationPool(db, career, st.code, 400);
    const valid = new Set(poolPlayers.map((p) => p.id));
    if (input.auto === true) st.squad = autoSquad(poolPlayers);
    else if (Array.isArray(input.squad)) {
      const ids = [...new Set(input.squad.map(Number).filter((id) => valid.has(id)))];
      if (ids.length > SQUAD_SIZE) throw new GameError(`Höchstens ${SQUAD_SIZE} Spieler.`);
      st.squad = ids;
    }
    if (Array.isArray(input.starters)) st.starters = [...new Set(input.starters.map(Number))].filter((id) => st.squad.includes(id)).slice(0, 11);
    st.starters = st.starters.filter((id) => st.squad.includes(id));
    if (typeof input.formation === "string" && input.formation in FORMATIONS) st.formation = input.formation as Formation;
    if (typeof input.preset === "string" && input.preset in STYLE_PRESETS) st.preset = input.preset;
    await saveNational(db, career.id, st);
    const gks = poolPlayers.filter((p) => st.squad.includes(p.id) && p.position === "GK").length;
    return { squad: st.squad, starters: st.starters, formation: st.formation, preset: st.preset, warning: gks < 2 ? "Nominiere mindestens zwei Torhüter." : null };
  });
}

export async function nationalMatchReport(careerId: string, accountId: string, matchId: number) {
  const career = await readCareer(careerId, accountId);
  const m = await one<NationalMatch>(pool(), "select *, user_match as user from national_matches where career_id = $1 and id = $2", [career.id, matchId]);
  if (!m) throw new GameError("Spiel nicht gefunden", 404);
  return {
    id: m.id, stage: m.stage, date: dateOf(m.season, m.day).toISOString().slice(0, 10),
    home: { code: m.home, name: nation(m.home).name, colors: nationColors(m.home) }, away: { code: m.away, name: nation(m.away).name, colors: nationColors(m.away) },
    homeGoals: m.home_goals, awayGoals: m.away_goals, penHome: m.pen_home, penAway: m.pen_away, data: m.data,
  };
}
