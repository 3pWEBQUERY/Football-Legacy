/** Matchengine: Spielablauf je Tick, Ausdauer, Verletzungen, Wechsel, Taktikänderungen und Ergebnis. */
import { Rng, clamp } from "../rng";
import { FORMATIONS, ROLE_BY_ID, defaultRole, mentalityStyle } from "../tactics";
import type { Duty, Formation, MatchEvent, PlayerInstruction, Tactic, TacticStyle } from "../types";
import { dribble, pass } from "./actions";
import { createMatch } from "./setup";
import { clearance, cross, penalty, shoot } from "./shots";
import { EnginePlayer, EngineTeam, ShotRecord, EngineTeamStats, Frame, HALF_TICK, MatchSetup, MatchState, PITCH_H, PITCH_W, Side, TICKS } from "./types";
import { ax, ay, dist, eff, fromA, giveBall, kickoff, minuteOf, moveTeams, nearestOf, nearestOpponent, onPitch, pushEvent, roleMod, slotDef } from "./util";

// ---------------------------------------------------------------- Ein Tick: Entscheidung des Ballführenden

export function tick(state: MatchState, rng: Rng) {
  const side = state.possession;
  const opp: Side = side === 0 ? 1 : 0;
  const team = state.teams[side];
  team.stats.possession++;

  moveTeams(state, rng);

  const carrier = team.players[state.carrier];
  if (!carrier || carrier.slot < 0) {
    // Ballführender nicht mehr auf dem Platz (z. B. Platzverweis)
    const idx = nearestOf(state, side, state.ball.x, state.ball.y);
    if (idx >= 0) giveBall(state, side, idx);
    return;
  }
  carrier.x = state.ball.x;
  carrier.y = state.ball.y;

  const cA = ax(side, carrier.x);
  const cB = ay(side, carrier.y);
  const goalDist = dist(cA * PITCH_W, cB * PITCH_H, PITCH_W, PITCH_H / 2);
  const pressure = nearestOpponent(state, side, carrier.x, carrier.y);
  const style = team.style;
  const isGk = slotDef(team, carrier.slot).position === "GK";
  const mod = roleMod(team, carrier.slot);

  if (state.pendingPenalty) {
    state.pendingPenalty = false;
    penalty(state, rng, side);
    return;
  }

  // Aktionsgewichte
  const wShoot = isGk || goalDist > 33
    ? 0
    : Math.pow((33 - goalDist) / 33, 2) * 4.2 * mod.shoot *
      (0.55 + eff(state, side, carrier, goalDist < 18 ? "finishing" : "longShots") / 22) *
      (0.75 + (style.risk / 100) * 0.5) * (goalDist < 13 ? 2.2 : 1);
  const wPass = 2.4 * mod.pass * (0.5 + eff(state, side, carrier, "passing") / 20) * (isGk ? 3 : 1) * (1.2 - style.tempo / 250);
  const wDribble = isGk ? 0 : 1.0 * mod.dribble * (0.3 + eff(state, side, carrier, "dribbling") / 20) * (pressure.d > 8 ? 1.7 : 1) * (0.8 + style.tempo / 250);
  const wide = Math.abs(cB - 0.5) > 0.24;
  const wCross = !isGk && cA > 0.72 && wide ? 2.2 * mod.cross * (eff(state, side, carrier, "crossing") / 20) * (0.6 + style.width / 100) : 0;
  const wClear = cA < 0.28 && pressure.d < 3.5 && !isGk ? 1.2 * (1.3 - eff(state, side, carrier, "composure") / 20) * (1.2 - style.risk / 100) : 0;

  const choice = rng.weighted([wShoot, wPass, wDribble, wCross, wClear]);
  switch (choice) {
    case 0: shoot(state, rng, side, carrier, goalDist, cB, pressure.d, "open"); break;
    case 1: pass(state, rng, side, carrier, pressure.d); break;
    case 2: dribble(state, rng, side, carrier, pressure); break;
    case 3: cross(state, rng, side, carrier); break;
    case 4: clearance(state, rng, side, carrier); break;
  }
  void opp;
}

// ---------------------------------------------------------------- Ausdauer, Verletzungen, Wechsel

function updateCondition(state: MatchState, rng: Rng) {
  for (const side of [0, 1] as Side[]) {
    const team = state.teams[side];
    const intensity = 0.7 + (team.style.pressing / 100) * 0.6 + (team.style.tempo / 100) * 0.2;
    for (const idx of onPitch(team)) {
      const p = team.players[idx];
      const isGk = slotDef(team, p.slot).position === "GK";
      const drain = (isGk ? 0.012 : 0.07) * intensity * (1.25 - p.attrs.stamina / 40) * (1.1 - p.attrs.workRate / 100) * (state.staminaFactor ?? 1);
      p.stamina = Math.max(15, p.stamina - drain);
      // Verletzungsgefahr: Müdigkeit und die Härte des Gegners (nicht die eigene) erhöhen sie
      const opp = state.teams[side === 0 ? 1 : 0];
      if (!isGk && rng.chance(0.000024 * (1 + (100 - p.stamina) / 60) * (0.8 + opp.style.hardness / 250) * (p.fragile ?? 1))) {
        injure(state, side, p);
      }
    }
  }
}

function injure(state: MatchState, side: Side, p: EnginePlayer) {
  p.injured = true;
  pushEvent(state, "injury", side, `${p.short} verletzt sich und kann nicht weiterspielen.`, { playerId: p.id, playerName: p.name });
  const team = state.teams[side];
  const sub = bestSubFor(team, p.slot);
  if (sub !== null && team.subsUsed < 5) {
    substitute(state, side, p.slot, sub);
  } else {
    if (p.slot >= 0) team.slots[p.slot] = null;
    p.slot = -2;
    p.minOut = minuteOf(state.tick);
  }
}

function bestSubFor(team: EngineTeam, slot: number): number | null {
  const pos = slotDef(team, slot).position;
  let best: number | null = null;
  let bestScore = -Infinity;
  team.players.forEach((p, i) => {
    if (p.slot !== -1 || p.injured) return;
    const fit = p.position === pos ? 1 : pos === "GK" || p.position === "GK" ? 0.3 : 0.85;
    const score = averageCore(p) * fit;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function averageCore(p: EnginePlayer): number {
  const a = p.attrs;
  return (a.passing + a.technique + a.decisions + a.pace + a.finishing + a.tackling + a.positioning + a.goalkeeping * (p.position === "GK" ? 4 : 0)) / 7;
}

/** Wechsel: Bankspieler (Index) ersetzt den Spieler im Slot. */
export function substitute(state: MatchState, side: Side, slot: number, benchIdx: number): boolean {
  const team = state.teams[side];
  if (team.subsUsed >= 5) return false;
  const incoming = team.players[benchIdx];
  if (!incoming || incoming.slot !== -1) return false;
  const outIdx = team.slots[slot];
  const minute = minuteOf(state.tick);
  if (outIdx !== null) {
    const out = team.players[outIdx];
    out.slot = -2;
    out.minOut = minute;
    if (state.possession === side && state.carrier === outIdx) state.carrier = benchIdx;
    incoming.x = out.x;
    incoming.y = out.y;
  } else {
    const pos = fromA(side, 0.4, 0.5);
    incoming.x = pos.x;
    incoming.y = pos.y;
  }
  incoming.slot = slot;
  incoming.minIn = minute;
  team.slots[slot] = benchIdx;
  team.subsUsed++;
  state.lineupHistory.push({ tick: state.tick, side, slot, playerId: incoming.id });
  const outName = outIdx !== null ? team.players[outIdx].short : "–";
  pushEvent(state, "sub", side, `Wechsel bei ${team.short}: ${incoming.short} kommt für ${outName}.`, {
    playerId: incoming.id, playerName: incoming.name,
    otherId: outIdx !== null ? team.players[outIdx].id : undefined, otherName: outIdx !== null ? team.players[outIdx].name : undefined,
  });
  return true;
}

function aiSubstitutions(state: MatchState, side: Side) {
  const team = state.teams[side];
  if (!team.autoSubs || team.subsUsed >= 5) return;
  const windows = [360, 400, 440, 480];
  if (!windows.includes(state.tick)) return;
  const oppGoals = state.teams[side === 0 ? 1 : 0].goals;
  const losing = team.goals < oppGoals;
  const candidates = onPitch(team)
    .map((i) => team.players[i])
    .filter((p) => slotDef(team, p.slot).position !== "GK")
    .sort((a, b) => a.stamina + a.st.rating * 5 - (b.stamina + b.st.rating * 5));
  const maxNow = state.tick === 360 ? 2 : 1;
  let made = 0;
  for (const p of candidates) {
    if (made >= maxNow || team.subsUsed >= 5) break;
    if (p.stamina > 62 && p.st.rating > 6.2 && !(losing && state.tick >= 400)) continue;
    const sub = bestSubFor(team, p.slot);
    if (sub === null) break;
    substitute(state, side, p.slot, sub);
    made++;
  }
}

/**
 * KI-Trainer: bei Rückstand ab der 60. Minute mehr Risiko, ab der 80. alles
 * nach vorne; knappe Führungen ab der 75. Minute absichern.
 */
const MENTALITY_TICKS = new Set([360, 420, 450, 480, 510]);
export function aiMentalityTarget(base: number, diff: number, minute: number): number {
  let m = base;
  if (diff < 0 && minute >= 60) m = base + 1 + (minute >= 80 ? 1 : 0);
  else if (diff === 1 && minute >= 75) m = base - 1 - (minute >= 85 ? 1 : 0);
  return Math.max(-3, Math.min(3, m));
}

function aiMentality(state: MatchState, side: Side) {
  const team = state.teams[side];
  if (!team.aiCoach || !MENTALITY_TICKS.has(state.tick)) return;
  const diff = team.goals - state.teams[side === 0 ? 1 : 0].goals;
  const target = aiMentalityTarget(team.aiCoach.base, diff, minuteOf(state.tick));
  if (target === (team.mentality ?? 0)) return;
  const more = target > (team.mentality ?? 0);
  applyChange(state, side, { mentality: target, quiet: true });
  pushEvent(state, "tactic", side, more ? `${team.name} riskiert jetzt mehr und rückt auf.` : `${team.name} zieht sich zurück und verteidigt das Ergebnis.`, {});
}

// ---------------------------------------------------------------- Ablauf

/** Aktuelle Positionen als einzelner Frame (z. B. beim Fortsetzen nach Neuladen). */
export function currentFrame(state: MatchState): Frame {
  const out: Frame[] = [];
  recordFrame(state, out);
  return out[0];
}

function recordFrame(state: MatchState, frames: Frame[]) {
  const f: number[] = [Math.round(state.ball.x * 10), Math.round(state.ball.y * 10), state.possession];
  for (const team of state.teams) {
    for (let s = 0; s < 11; s++) {
      const idx = team.slots[s];
      if (idx === null || idx === undefined) {
        f.push(-1, -1);
      } else {
        const p = team.players[idx];
        f.push(Math.round(p.x * 10), Math.round(p.y * 10));
      }
    }
  }
  frames.push(f);
}

/**
 * Simuliert bis zum angegebenen Tick (exklusiv). Gibt optional Positionsdaten
 * pro Tick zurück. Der Zustand ist danach serialisierbar (JSON), damit z. B. die
 * Halbzeit auf dem Server gespeichert werden kann.
 */
export function simulate(state: MatchState, untilTick: number, opts: { frames?: boolean } = {}): Frame[] {
  const frames: Frame[] = [];
  const rng = new Rng(0);
  rng.state = state.rng;
  if (opts.frames && state.tick === 0) recordFrame(state, frames);
  while (state.tick < untilTick && state.tick < TICKS) {
    if (state.tick === HALF_TICK) {
      kickoff(state, 1);
    }
    tick(state, rng);
    updateCondition(state, rng);
    aiSubstitutions(state, 0);
    aiSubstitutions(state, 1);
    aiMentality(state, 0);
    aiMentality(state, 1);
    state.tick++;
    if (opts.frames) recordFrame(state, frames);
    if (state.tick === HALF_TICK) {
      pushEvent(state, "halftime", null, `Halbzeit: ${state.teams[0].short} ${state.teams[0].goals}:${state.teams[1].goals} ${state.teams[1].short}`, {});
    }
  }
  state.rng = rng.state;
  if (state.tick >= TICKS && !state.finished) finish(state);
  return frames;
}

function finish(state: MatchState) {
  state.finished = true;
  const [h, a] = state.teams;
  pushEvent(state, "fulltime", null, `Abpfiff: ${h.short} ${h.goals}:${a.goals} ${a.short}`, {});
  for (const side of [0, 1] as Side[]) {
    const team = state.teams[side];
    const conceded = state.teams[side === 0 ? 1 : 0].goals;
    const won = team.goals > conceded;
    const lost = team.goals < conceded;
    for (const p of team.players) {
      if (p.minIn === null) continue;
      if (won) p.st.rating += 0.25;
      if (lost) p.st.rating -= 0.2;
      const pos = p.position;
      if (conceded === 0 && (pos === "GK" || pos === "DC" || pos === "DL" || pos === "DR")) p.st.rating += 0.4;
      p.st.rating = clamp(Math.round(p.st.rating * 10) / 10, 3, 10);
    }
  }
}

/** Taktik- und Personaländerungen (z. B. in der Halbzeitpause). */
export interface TacticChange {
  formation?: Formation;
  style?: Partial<TacticStyle>;
  roles?: string[];
  mentality?: number;
  duties?: (Duty | null)[];
  instructions?: PlayerInstruction[][];
  setPieces?: Partial<Tactic["setPieces"]>;
  /** Wechsel: Slot → ID des Bankspielers */
  subs?: { slot: number; playerId: number }[];
  autoSubs?: boolean;
  /** Ohne eigene Tickermeldung (der Aufrufer schreibt eine passendere) */
  quiet?: boolean;
}

export function applyChange(state: MatchState, side: Side, change: TacticChange) {
  const team = state.teams[side];
  let changed = false;
  let newFormation = false;
  if (change.formation && change.formation !== team.formation) {
    newFormation = true;
    // Spieler behalten ihre Slot-Nummer; neue Formation ordnet die Positionen neu zu
    team.formation = change.formation;
    team.roles = FORMATIONS[change.formation].map((s) => defaultRole(s.position));
    team.slotOffsets = [];
    team.duties = [];
    team.instructions = [];
    changed = true;
  }
  const base = team.baseStyle ?? team.style;
  if (change.style && (Object.keys(change.style) as (keyof TacticStyle)[]).some((k) => change.style![k] !== undefined && change.style![k] !== base[k])) {
    team.baseStyle = { ...base, ...change.style };
    changed = true;
  }
  if (change.mentality !== undefined && change.mentality !== (team.mentality ?? 0)) {
    team.mentality = Math.max(-3, Math.min(3, Math.round(change.mentality)));
    changed = true;
  }
  if (changed) team.style = mentalityStyle(team.baseStyle ?? team.style, team.mentality ?? 0);
  if (change.duties) { team.duties = [...change.duties]; changed = true; }
  if (change.instructions) { team.instructions = change.instructions.map((x) => [...(x ?? [])]); changed = true; }
  if (change.roles) {
    team.roles = FORMATIONS[team.formation].map((s, i) => {
      const r = change.roles?.[i];
      return r && ROLE_BY_ID[r]?.positions.includes(s.position) ? r : team.roles[i];
    });
    changed = true;
  }
  if (change.setPieces) team.setPieces = { ...team.setPieces, ...change.setPieces };
  if (change.autoSubs !== undefined) team.autoSubs = change.autoSubs;
  for (const sub of change.subs ?? []) {
    const benchIdx = team.players.findIndex((p) => p.id === sub.playerId && p.slot === -1);
    if (benchIdx >= 0) substitute(state, side, sub.slot, benchIdx);
  }
  if (changed && !change.quiet) pushEvent(state, "tactic", side, newFormation ? `${team.short} stellt um auf ${team.formation}.` : `${team.short} passt die taktische Ausrichtung an.`, {});
}

export interface PlayerMatchLine {
  playerId: number;
  name: string;
  side: Side;
  minutes: number;
  rating: number;
  goals: number;
  assists: number;
  yellow: number;
  red: boolean;
  injured: boolean;
  staminaEnd: number;
  started: boolean;
}

export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  events: MatchEvent[];
  stats: [EngineTeamStats, EngineTeamStats];
  players: PlayerMatchLine[];
  motm: number | null;
  /** Alle Torschüsse (Schusskarte, xG-Verlauf) */
  shots?: ShotRecord[];
  /** Wetter und Schiedsrichter */
  conditions?: MatchState["conditions"];
}

export function result(state: MatchState): MatchResult {
  const players: PlayerMatchLine[] = [];
  for (const side of [0, 1] as Side[]) {
    const team = state.teams[side];
    for (const p of team.players) {
      if (p.minIn === null) continue;
      const end = p.minOut ?? 90;
      players.push({
        playerId: p.id,
        name: p.name,
        side,
        minutes: Math.max(1, end - p.minIn),
        rating: p.st.rating,
        goals: p.st.goals,
        assists: p.st.assists,
        yellow: p.yellow,
        red: p.red,
        injured: p.injured,
        staminaEnd: Math.round(p.stamina),
        started: p.minIn === 0,
      });
    }
  }
  const motm = players.length ? players.reduce((a, b) => (b.rating > a.rating ? b : a)).playerId : null;
  return {
    homeGoals: state.teams[0].goals,
    awayGoals: state.teams[1].goals,
    events: state.events,
    stats: [state.teams[0].stats, state.teams[1].stats],
    conditions: state.conditions,
    players,
    motm,
    shots: state.shots ?? [],
  };
}

/** Komplettes Spiel in einem Schritt (für KI-Partien). */
export function playMatch(setup: MatchSetup): MatchResult {
  const state = createMatch(setup);
  simulate(state, TICKS);
  return result(state);
}
