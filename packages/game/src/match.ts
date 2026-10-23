/** Spieltag des Nutzers: Vorschau, erste Halbzeit, Halbzeitpause, zweite Halbzeit. */
import {
  FORMATIONS, HALF_TICK, TICKS, applyChange, createMatch, isUnlocked, result, seedFor, simulate, transferWindow,
  validateTactic, type MatchState, type Side, type TacticChange,
} from "@fl/sim";
import type pg from "pg";
import { one, query } from "./db";
import { withCareer } from "./career";
import { GameError } from "./errors";
import { type CareerRow, type FixtureRow, getClub, getPlayers, saveCareer } from "./repo";
import { aiTactic, teamSetup } from "./setup";
import { processWeek, type WeekSummary } from "./week";

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
  | { kind: "week"; summary: WeekSummary };

/** "Weiter": spielfreie Woche simulieren oder zum Spieltag führen. */
export async function advance(careerId: string, accountId: string): Promise<AdvanceResult> {
  return withCareer(careerId, accountId, async (db, career) => {
    ensurePlayable(career);
    if (career.pending_match) return { kind: "match", fixtureId: career.pending_match.fixtureId };
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
      return finishPending(db, career, {});
    }
    const fixture = await nextUserFixture(db, career);
    if (!fixture) throw new GameError("Diese Woche hast du kein Spiel.");
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

export async function startMatch(careerId: string, accountId: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    ensurePlayable(career);
    let state: MatchState;
    let frames: number[][] = [];
    let fixtureId: number;
    if (career.pending_match) {
      // Bereits angepfiffen (z. B. Seite neu geladen): Stand der Halbzeit liefern
      state = career.pending_match.state as MatchState;
      fixtureId = career.pending_match.fixtureId;
    } else {
      const f = await nextUserFixture(db, career);
      if (!f) throw new GameError("Diese Woche hast du kein Spiel.");
      fixtureId = f.id;
      state = await buildMatch(db, career, f);
      frames = simulate(state, HALF_TICK, { frames: true });
      career.pending_match = { fixtureId: f.id, side: sideOf(career, f), state, half: 1 };
      await saveCareer(db, career);
    }
    return {
      fixtureId,
      side: career.pending_match!.side,
      frames,
      events: state.events,
      ...presentation(state),
      formations: Object.keys(FORMATIONS),
    };
  });
}

/** Zweite Halbzeit mit den Änderungen aus der Kabine. */
export async function continueMatch(careerId: string, accountId: string, change: TacticChange) {
  return withCareer(careerId, accountId, async (db, career) => {
    ensurePlayable(career);
    if (!career.pending_match) throw new GameError("Kein laufendes Spiel.");
    const state = career.pending_match.state as MatchState;
    const side = career.pending_match.side;
    const eventsBefore = state.events.length;
    applyChange(state, side, sanitizeChange(change));
    aiHalftime(state, side === 0 ? 1 : 0);
    const frames = simulate(state, TICKS, { frames: true });
    const view = presentation(state);
    const newEvents = state.events.slice(eventsBefore);
    const summary = await finishPending(db, career, {}, state);
    return { frames, events: state.events, newEvents, ...view, summary, result: result(state) };
  });
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

async function finishPending(db: pg.PoolClient, career: CareerRow, change: TacticChange, simulated?: MatchState): Promise<WeekSummary> {
  const pending = career.pending_match!;
  const state = simulated ?? (pending.state as MatchState);
  if (!simulated) {
    applyChange(state, pending.side, change);
    aiHalftime(state, pending.side === 0 ? 1 : 0);
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
      keyPlayers: top.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, rating: p.rating })),
      form: recent.map((r) => {
        const gf = r.home_id === oppId ? r.home_goals! : r.away_goals!;
        const ga = r.home_id === oppId ? r.away_goals! : r.home_goals!;
        return gf > ga ? "W" : gf === ga ? "D" : "L";
      }),
    };
  }
  return {
    fixtureId: f.id,
    week: f.week,
    home: { id: home.id, name: home.name, short: home.short_name, colors: home.colors, rating: home.rating },
    away: { id: away.id, name: away.name, short: away.short_name, colors: away.colors, rating: away.rating },
    analysis,
    window: transferWindow(career.week + 1, career.season_weeks),
  };
}
