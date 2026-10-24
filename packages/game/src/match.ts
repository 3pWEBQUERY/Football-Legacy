/** Spieltag des Nutzers: Vorschau, erste Halbzeit, Halbzeitpause, zweite Halbzeit. */
import {
  FORMATIONS, HALF_TICK, TICKS, applyChange, createMatch, currentFrame, isUnlocked, result, seedFor, simulate,
  validateTactic, type MatchState, type Side, type TacticChange,
} from "@fl/sim";
import type pg from "pg";
import { windowFor } from "./window";
import { one, query } from "./db";
import { withCareer } from "./career";
import { GameError } from "./errors";
import { type CareerRow, type FixtureRow, getClub, getPlayers, saveCareer } from "./repo";
import { aiTactic, teamSetup } from "./setup";
import { processWeek, type WeekSummary } from "./week";
import { advanceDay, nextSlotDay, type DayResult } from "./day";
import { competitionOf } from "./cup";
import { assistantAdvice } from "./advice";

async function nextUserFixture(db: pg.PoolClient | import("pg").Pool, career: CareerRow): Promise<FixtureRow | null> {
  if (!career.club_id) return null;
  return one<FixtureRow>(
    db,
    `select * from fixtures where career_id = $1 and season = $2 and week = $3 and not played and ($4 in (home_id, away_id))`,
    [career.id, career.season, career.week + 1, career.club_id],
  );
}

function ensurePlayable(career: CareerRow) {
  if (career.status !== "active" || !career.club_id) throw new GameError("Du hast aktuell keinen Verein. Nimm zuerst ein Jobangebot an.");
}

export type AdvanceResult =
  | { kind: "match"; fixtureId: number }
  | { kind: "week"; summary: WeekSummary }
  | { kind: "day"; day: DayResult };

/** Ist heute Spieltag (Tag der nächsten Spielrunde erreicht)? */
function isMatchday(career: CareerRow): boolean {
  const d = nextSlotDay(career);
  return d === null || career.day >= d;
}

function ensureMatchday(career: CareerRow) {
  if (!isMatchday(career)) throw new GameError("Das nächste Spiel findet erst später statt. Klicke auf „Weiter“, bis der Spieltag erreicht ist.");
}

/** "Weiter": spielfreie Woche simulieren oder zum Spieltag führen. */
export async function advance(careerId: string, accountId: string): Promise<AdvanceResult> {
  return withCareer(careerId, accountId, async (db, career) => {
    // Ohne Verein läuft die Zeit trotzdem weiter (Stellensuche)
    if (career.club_id) ensurePlayable(career);
    if (career.pending_match) return { kind: "match", fixtureId: career.pending_match.fixtureId };
    // Bis zum nächsten Spieltag geht es Tag für Tag weiter
    if (!isMatchday(career)) return { kind: "day", day: await advanceDay(db, career) };
    const fixture = await nextUserFixture(db, career);
    if (fixture) return { kind: "match", fixtureId: fixture.id };
    const summary = await processWeek(db, career);
    return { kind: "week", summary };
  });
}

/** Eigenes Spiel ohne Ansicht simulieren. */
export async function quickMatch(careerId: string, accountId: string): Promise<WeekSummary> {
  return withCareer(careerId, accountId, async (db, career) => {
    ensurePlayable(career);
    if (career.pending_match) {
      // Laufendes Spiel zu Ende simulieren
      return finishPending(db, career);
    }
    ensureMatchday(career);
    const fixture = await nextUserFixture(db, career);
    if (!fixture) throw new GameError("Heute hast du kein Spiel.");
    return processWeek(db, career, { quickUserMatch: true });
  });
}

function sideOf(career: CareerRow, f: FixtureRow): Side {
  return f.home_id === career.club_id ? 0 : 1;
}

async function buildMatch(db: pg.PoolClient, career: CareerRow, f: FixtureRow): Promise<MatchState> {
  const home = (await getClub(db, career.id, f.home_id))!;
  const away = (await getClub(db, career.id, f.away_id))!;
  const players = await getPlayers(db, career.id, [home.id, away.id]);
  const hs = players.filter((p) => p.clubId === home.id);
  const as = players.filter((p) => p.clubId === away.id);
  const userIsHome = home.id === career.club_id;
  const userClub = userIsHome ? home : away;
  const userSquad = userIsHome ? hs : as;
  const userTactic = userClub.tactic ? validateTactic(userClub.tactic, userSquad) : aiTactic(userClub, userSquad);
  const autoSubs = career.manager.autoSubs ?? true;
  return createMatch({
    seed: seedFor(career.seed, "match", f.id),
    home: teamSetup(home, hs, userIsHome ? userTactic : aiTactic(home, hs), userIsHome ? autoSubs : true),
    away: teamSetup(away, as, userIsHome ? aiTactic(away, as) : userTactic, userIsHome ? true : autoSubs),
  });
}

/** Spielerverzeichnis und Aufstellungsverlauf für die 2D-Ansicht. */
function presentation(state: MatchState) {
  return {
    teams: state.teams.map((t) => ({
      clubId: t.clubId,
      name: t.name,
      short: t.short,
      colors: t.colors,
      formation: t.formation,
      style: t.style,
      roles: t.roles,
      subsUsed: t.subsUsed,
      goals: t.goals,
      stats: t.stats,
      players: t.players.map((p) => ({
        id: p.id, name: p.name, short: p.short, position: p.position, slot: p.slot, stamina: Math.round(p.stamina),
        rating: p.st.rating, goals: p.st.goals, yellow: p.yellow, red: p.red, injured: p.injured,
      })),
    })),
    lineupHistory: state.lineupHistory,
    tick: state.tick,
    finished: state.finished,
  };
}

/** Länge eines Simulationsabschnitts: 30 Ticks = 5 Spielminuten. */
const SEGMENT = 30;

/**
 * Anpfiff oder Fortsetzen: liefert den aktuellen Stand und – bei einem neuen
 * Spiel – den ersten Abschnitt mit Positionsdaten.
 */
export async function startMatch(careerId: string, accountId: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    ensurePlayable(career);
    let state: MatchState;
    let frames: number[][];
    let fromTick: number;
    if (career.pending_match) {
      state = career.pending_match.state as MatchState;
      fromTick = state.tick;
      frames = [currentFrame(state)];
    } else {
      ensureMatchday(career);
      const f = await nextUserFixture(db, career);
      if (!f) throw new GameError("Heute hast du kein Spiel.");
      state = await buildMatch(db, career, f);
      fromTick = 0;
      frames = simulate(state, SEGMENT, { frames: true });
      career.pending_match = { fixtureId: f.id, side: sideOf(career, f), state, half: 1 };
      await saveCareer(db, career);
    }
    return {
      fixtureId: career.pending_match!.fixtureId,
      side: career.pending_match!.side,
      fromTick,
      frames,
      events: state.events,
      ...presentation(state),
      formations: Object.keys(FORMATIONS),
    };
  });
}

/**
 * Nächster Abschnitt. Optional mit Taktik-/Personaländerungen, die ab dem
 * aktuellen Serverstand gelten. Die Simulation stoppt immer zur Halbzeit.
 */
export async function stepMatch(careerId: string, accountId: string, input: { change?: TacticChange; until?: number }) {
  return withCareer(careerId, accountId, async (db, career) => {
    ensurePlayable(career);
    const pending = career.pending_match;
    if (!pending) throw new GameError("Kein laufendes Spiel.");
    const state = pending.state as MatchState;
    const side = pending.side;
    const fromTick = state.tick;
    if (input.change) applyChange(state, side, sanitizeChange(input.change));
    if (state.tick >= HALF_TICK && !pending.aiHalftimeDone) {
      aiHalftime(state, side === 0 ? 1 : 0);
      pending.aiHalftimeDone = true;
    }
    const limit = state.tick < HALF_TICK ? HALF_TICK : TICKS;
    const wanted = typeof input.until === "number" && Number.isFinite(input.until) ? input.until : state.tick + SEGMENT;
    const target = Math.max(state.tick + 1, Math.min(limit, Math.round(wanted)));
    const frames = simulate(state, target, { frames: true });
    const view = presentation(state);
    if (state.finished) {
      const summary = await finishPending(db, career, state);
      return { fromTick, frames, events: state.events, ...view, done: true as const, summary, result: result(state) };
    }
    pending.half = state.tick >= HALF_TICK ? 2 : 1;
    await saveCareer(db, career);
    return { fromTick, frames, events: state.events, ...view, done: false as const };
  });
}

/** Kompatibilität: zweite Halbzeit in einem Schritt bis zum Abpfiff. */
export async function continueMatch(careerId: string, accountId: string, change: TacticChange) {
  return stepMatch(careerId, accountId, { change, until: TICKS });
}

function sanitizeChange(change: TacticChange): TacticChange {
  const out: TacticChange = {};
  if (change.formation && FORMATIONS[change.formation]) out.formation = change.formation;
  if (change.style) {
    out.style = {};
    for (const [k, v] of Object.entries(change.style)) {
      if (typeof v === "number") (out.style as Record<string, number>)[k] = Math.max(0, Math.min(100, Math.round(v)));
    }
  }
  if (Array.isArray(change.roles)) out.roles = change.roles.map(String);
  if (Array.isArray(change.subs)) out.subs = change.subs.slice(0, 5).map((s) => ({ slot: Number(s.slot), playerId: Number(s.playerId) }));
  if (typeof change.autoSubs === "boolean") out.autoSubs = change.autoSubs;
  return out;
}

/** KI reagiert in der Halbzeit auf den Spielstand. */
function aiHalftime(state: MatchState, side: Side) {
  const team = state.teams[side];
  const opp = state.teams[side === 0 ? 1 : 0];
  const diff = team.goals - opp.goals;
  if (diff < 0) applyChange(state, side, { style: { risk: Math.min(100, team.style.risk + 20), tempo: Math.min(100, team.style.tempo + 15), pressing: Math.min(100, team.style.pressing + 10) } });
  else if (diff >= 2) applyChange(state, side, { style: { risk: Math.max(0, team.style.risk - 15), defensiveLine: Math.max(0, team.style.defensiveLine - 10) } });
}

async function finishPending(db: pg.PoolClient, career: CareerRow, simulated?: MatchState): Promise<WeekSummary> {
  const pending = career.pending_match!;
  const state = simulated ?? (pending.state as MatchState);
  if (!simulated) {
    if (!pending.aiHalftimeDone && state.tick <= HALF_TICK) {
      simulate(state, HALF_TICK);
      aiHalftime(state, pending.side === 0 ? 1 : 0);
    }
    simulate(state, TICKS);
  }
  const starters = state.lineupHistory.filter((h) => h.tick === 0 && h.side === pending.side).map((h) => h.playerId);
  career.pending_match = null;
  return processWeek(db, career, { userMatch: { fixtureId: pending.fixtureId, result: result(state), starters } });
}

/** Spielvorschau mit optionaler Gegner-Analyse (ab Level 4). */
export async function matchPreview(db: pg.Pool, career: CareerRow) {
  const f = await nextUserFixture(db, career);
  if (!f) return null;
  const home = (await getClub(db, career.id, f.home_id))!;
  const away = (await getClub(db, career.id, f.away_id))!;
  const oppId = f.home_id === career.club_id ? away.id : home.id;
  const opp = oppId === home.id ? home : away;
  let analysis = null;
  if (isUnlocked(career.manager, "analysis")) {
    const squad = await getPlayers(db, career.id, [oppId]);
    const top = [...squad].sort((a, b) => b.rating - a.rating).slice(0, 3);
    const recent = await query<FixtureRow>(
      db, "select * from fixtures where career_id = $1 and season = $2 and played and $3 in (home_id, away_id) order by week desc limit 5",
      [career.id, career.season, oppId],
    );
    analysis = {
      formation: opp.tactic?.formation ?? "4-4-2",
      style: opp.tactic?.style ?? null,
      keyPlayers: top.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, age: p.age, nationality: p.nationality, position: p.position, rating: p.rating })),
      form: recent.map((r) => {
        const gf = r.home_id === oppId ? r.home_goals! : r.away_goals!;
        const ga = r.home_id === oppId ? r.away_goals! : r.home_goals!;
        return gf > ga ? "W" : gf === ga ? "D" : "L";
      }),
    };
  }
  const competition = await competitionOf(db, f);
  return {
    fixtureId: f.id,
    week: f.week,
    round: f.round,
    competition,
    home: { id: home.id, name: home.name, short: home.short_name, colors: home.colors, rating: home.rating },
    away: { id: away.id, name: away.name, short: away.short_name, colors: away.colors, rating: away.rating },
    analysis,
    window: windowFor(career, career.calendar?.slots[f.week - 1]?.day ?? career.day),
    day: career.calendar?.slots[f.week - 1]?.day ?? null,
    today: isMatchday(career),
    advice: await assistantAdvice(db, career),
  };
}
