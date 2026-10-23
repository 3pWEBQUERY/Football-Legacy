/**
 * Matchengine: simuliert ein Spiel als Folge von 540 Ticks (je ~10 Spielsekunden).
 * Reines TypeScript ohne UI. Gleicher Seed + gleiche Eingaben => gleiches Ergebnis.
 *
 * Koordinaten in Metern: Spielfeld 105 x 68. Die Heimmannschaft spielt nach rechts
 * (Tor bei x = 105), die Gäste nach links.
 */
import { Rng, clamp } from "./rng";
import { FORMATIONS, ROLE_BY_ID, defaultRole } from "./tactics";
import { shortName } from "./player";
import type {
  AttrKey, ClubColors, Formation, MatchEvent, MatchEventType, Player, Position, Tactic, TacticStyle,
} from "./types";

export const PITCH_W = 105;
export const PITCH_H = 68;
export const TICKS = 540;
export const HALF_TICK = 270;
export const TICKS_PER_MINUTE = 6;

export type Side = 0 | 1; // 0 = Heim, 1 = Gast
const SIDE_NAME = ["home", "away"] as const;
/** Stauchung der Attributunterschiede (1 = volle Unterschiede). */
const SPREAD = 0.5;

export interface EnginePlayerStats {
  goals: number;
  assists: number;
  shots: number;
  onTarget: number;
  passes: number;
  passesOk: number;
  tackles: number;
  dribbles: number;
  saves: number;
  fouls: number;
  keyPasses: number;
  rating: number;
}

export interface EnginePlayer {
  id: number;
  name: string;
  short: string;
  position: Position;
  attrs: Record<AttrKey, number>;
  fitness: number;
  form: number;
  morale: number;
  age: number;
  slot: number; // >=0 auf dem Platz, -1 Bank, -2 ausgewechselt/vom Platz
  x: number;
  y: number;
  stamina: number;
  yellow: number;
  red: boolean;
  injured: boolean;
  minIn: number | null;
  minOut: number | null;
  st: EnginePlayerStats;
}

export interface EngineTeamStats {
  shots: number;
  onTarget: number;
  xg: number;
  possession: number; // Ticks
  passes: number;
  passesOk: number;
  fouls: number;
  corners: number;
  yellow: number;
  red: number;
}

export interface EngineTeam {
  clubId: number;
  name: string;
  short: string;
  colors: ClubColors;
  formation: Formation;
  style: TacticStyle;
  roles: string[];
  slotOffsets: ({ x: number; y: number } | null)[];
  setPieces: Tactic["setPieces"];
  slots: (number | null)[]; // Index in players je Formations-Slot
  players: EnginePlayer[];
  subsUsed: number;
  autoSubs: boolean;
  goals: number;
  stats: EngineTeamStats;
}

export interface MatchState {
  seed: number;
  rng: number;
  tick: number;
  ball: { x: number; y: number };
  possession: Side;
  carrier: number; // Index in players der ballführenden Mannschaft
  teams: [EngineTeam, EngineTeam];
  events: MatchEvent[];
  homeAdvantage: number;
  level: number; // durchschnittliches Attributniveau beider Teams
  finished: boolean;
  lastPasser: number | null;
  pendingPenalty: boolean;
  lineupHistory: { tick: number; side: Side; slot: number; playerId: number }[];
}

export interface TeamSetup {
  clubId: number;
  name: string;
  shortName: string;
  colors: ClubColors;
  tactic: Tactic;
  players: Player[]; // Kader (mindestens Startelf + Bank)
  autoSubs?: boolean;
}

export interface MatchSetup {
  seed: number;
  home: TeamSetup;
  away: TeamSetup;
  homeAdvantage?: number;
}

/** Ein Frame: [ballX, ballY, ballführende Seite, 11x Heim (x,y), 11x Gast (x,y)] in Dezimetern, -1 = leer. */
export type Frame = number[];

function newStats(): EnginePlayerStats {
  return { goals: 0, assists: 0, shots: 0, onTarget: 0, passes: 0, passesOk: 0, tackles: 0, dribbles: 0, saves: 0, fouls: 0, keyPasses: 0, rating: 6.0 };
}

function newTeamStats(): EngineTeamStats {
  return { shots: 0, onTarget: 0, xg: 0, possession: 0, passes: 0, passesOk: 0, fouls: 0, corners: 0, yellow: 0, red: 0 };
}

function buildTeam(setup: TeamSetup): EngineTeam {
  const t = setup.tactic;
  const byId = new Map(setup.players.map((p) => [p.id, p]));
  const players: EnginePlayer[] = [];
  const add = (p: Player, slot: number): number => {
    players.push({
      id: p.id,
      name: `${p.firstName} ${p.lastName}`,
      short: shortName(p),
      position: p.position,
      attrs: { ...p.attrs },
      fitness: p.fitness,
      form: p.form,
      morale: p.morale,
      age: p.age,
      slot,
      x: 0,
      y: 0,
      stamina: clamp(p.fitness, 30, 100),
      yellow: 0,
      red: false,
      injured: false,
      minIn: slot >= 0 ? 0 : null,
      minOut: null,
      st: newStats(),
    });
    return players.length - 1;
  };
  const slots: (number | null)[] = FORMATIONS[t.formation].map((_, i) => {
    const id = t.lineup[i];
    const p = id != null ? byId.get(id) : undefined;
    return p ? add(p, i) : null;
  });
  for (const id of t.bench) {
    const p = byId.get(id);
    if (p && !players.some((e) => e.id === id)) add(p, -1);
  }
  return {
    clubId: setup.clubId,
    name: setup.name,
    short: setup.shortName,
    colors: setup.colors,
    formation: t.formation,
    style: { ...t.style },
    roles: FORMATIONS[t.formation].map((s, i) => t.roles[i] ?? defaultRole(s.position)),
    slotOffsets: t.slotOffsets ?? [],
    setPieces: { ...t.setPieces },
    slots,
    players,
    subsUsed: 0,
    autoSubs: setup.autoSubs ?? true,
    goals: 0,
    stats: newTeamStats(),
  };
}

export function createMatch(setup: MatchSetup): MatchState {
  const state: MatchState = {
    seed: setup.seed,
    rng: setup.seed >>> 0,
    tick: 0,
    ball: { x: PITCH_W / 2, y: PITCH_H / 2 },
    possession: 0,
    carrier: 0,
    teams: [buildTeam(setup.home), buildTeam(setup.away)],
    events: [],
    homeAdvantage: setup.homeAdvantage ?? 1.06,
    level: 10,
    finished: false,
    lastPasser: null,
    pendingPenalty: false,
    lineupHistory: [],
  };
  let sum = 0;
  let n = 0;
  for (const team of state.teams) {
    for (const idx of team.slots) {
      if (idx === null) continue;
      for (const v of Object.values(team.players[idx].attrs)) {
        sum += v;
        n++;
      }
    }
  }
  state.level = n ? sum / n : 10;
  for (const side of [0, 1] as Side[]) {
    const team = state.teams[side];
    team.slots.forEach((idx, slot) => {
      if (idx === null) return;
      const p = team.players[idx];
      const pos = basePosition(team, side, slot);
      p.x = pos.x;
      p.y = pos.y;
      state.lineupHistory.push({ tick: 0, side, slot, playerId: p.id });
    });
  }
  kickoff(state, 0);
  pushEvent(state, "kickoff", null, "Anpfiff!", {});
  return state;
}

// ---------------------------------------------------------------- Hilfsfunktionen

/** Wandelt Feldkoordinaten in die Angriffsrichtung einer Seite um (0 = eigenes Tor, 1 = gegnerisches). */
function ax(side: Side, x: number): number {
  return side === 0 ? x / PITCH_W : 1 - x / PITCH_W;
}
function ay(side: Side, y: number): number {
  return side === 0 ? y / PITCH_H : 1 - y / PITCH_H;
}
function fromA(side: Side, a: number, b: number): { x: number; y: number } {
  return side === 0 ? { x: a * PITCH_W, y: b * PITCH_H } : { x: (1 - a) * PITCH_W, y: (1 - b) * PITCH_H };
}
function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

function minuteOf(tick: number): number {
  return Math.min(90, Math.floor(tick / TICKS_PER_MINUTE) + 1);
}

function slotDef(team: EngineTeam, slot: number) {
  const base = FORMATIONS[team.formation][slot];
  const off = team.slotOffsets[slot];
  return off ? { position: base.position, x: clamp(off.x, 0.02, 0.95), y: clamp(off.y, 0.03, 0.97) } : base;
}

function basePosition(team: EngineTeam, side: Side, slot: number) {
  const s = slotDef(team, slot);
  // Anstoss: eigene Hälfte
  return fromA(side, s.x * 0.5, s.y);
}

function onPitch(team: EngineTeam): number[] {
  const out: number[] = [];
  for (const idx of team.slots) if (idx !== null) out.push(idx);
  return out;
}

/** Effektiver Attributwert unter Berücksichtigung von Ausdauer, Form, Moral und Heimvorteil. */
function eff(state: MatchState, side: Side, p: EnginePlayer, key: AttrKey): number {
  const condition = (0.7 + 0.3 * (p.stamina / 100)) * (0.95 + (p.form / 10) * 0.1) * (0.97 + (p.morale / 100) * 0.06);
  // Unterschiede werden um das Spielniveau gestaucht, damit Favoriten gewinnen, aber nicht immer
  const raw = p.attrs[key] * condition * (side === 0 ? state.homeAdvantage : 1);
  return 12 + (raw - state.level) * SPREAD;
}

function pushEvent(
  state: MatchState,
  type: MatchEventType,
  side: Side | null,
  text: string,
  extra: Partial<MatchEvent>,
) {
  state.events.push({
    minute: minuteOf(state.tick),
    tick: state.tick,
    type,
    side: side === null ? null : SIDE_NAME[side],
    text,
    score: [state.teams[0].goals, state.teams[1].goals],
    ...extra,
  });
}

function nearestOpponent(state: MatchState, side: Side, x: number, y: number): { idx: number; d: number } {
  const opp = state.teams[side === 0 ? 1 : 0];
  let best = -1;
  let bestD = Infinity;
  for (const idx of opp.slots) {
    if (idx === null) continue;
    const p = opp.players[idx];
    const d = dist(p.x, p.y, x, y);
    if (d < bestD) {
      bestD = d;
      best = idx;
    }
  }
  return { idx: best, d: bestD };
}

function keeperOf(team: EngineTeam): EnginePlayer | null {
  const idx = team.slots[0];
  if (idx !== null && slotDef(team, 0).position === "GK") return team.players[idx];
  for (const i of onPitch(team)) if (team.players[i].position === "GK") return team.players[i];
  const any = onPitch(team)[0];
  return any !== undefined ? team.players[any] : null;
}

function roleMod(team: EngineTeam, slot: number) {
  return (ROLE_BY_ID[team.roles[slot]] ?? ROLE_BY_ID[defaultRole(slotDef(team, slot).position)]).mod;
}

function kickoff(state: MatchState, side: Side) {
  state.possession = side;
  state.ball = { x: PITCH_W / 2, y: PITCH_H / 2 };
  const team = state.teams[side];
  // Stürmer oder zentralster Spieler stösst an
  let best = onPitch(team)[0];
  let bestScore = -Infinity;
  for (const idx of onPitch(team)) {
    const s = slotDef(team, team.players[idx].slot);
    const score = s.x - Math.abs(s.y - 0.5);
    if (score > bestScore) {
      bestScore = score;
      best = idx;
    }
  }
  state.carrier = best;
  state.lastPasser = null;
  for (const t of [0, 1] as Side[]) {
    const tm = state.teams[t];
    for (const idx of onPitch(tm)) {
      const p = tm.players[idx];
      const pos = basePosition(tm, t, p.slot);
      p.x = pos.x;
      p.y = pos.y;
    }
  }
  const c = team.players[best];
  c.x = state.ball.x;
  c.y = state.ball.y;
}

function giveBall(state: MatchState, side: Side, idx: number, x?: number, y?: number) {
  state.possession = side;
  state.carrier = idx;
  const p = state.teams[side].players[idx];
  if (x !== undefined && y !== undefined) {
    p.x = x;
    p.y = y;
  }
  state.ball = { x: p.x, y: p.y };
}

/** Nächster Spieler einer Seite zu einem Punkt. */
function nearestOf(state: MatchState, side: Side, x: number, y: number, exclude = -1): number {
  const team = state.teams[side];
  let best = -1;
  let bestD = Infinity;
  for (const idx of team.slots) {
    if (idx === null || idx === exclude) continue;
    const p = team.players[idx];
    const d = dist(p.x, p.y, x, y);
    if (d < bestD) {
      bestD = d;
      best = idx;
    }
  }
  return best;
}

// ---------------------------------------------------------------- Bewegung

function moveTeams(state: MatchState, rng: Rng) {
  for (const side of [0, 1] as Side[]) {
    const team = state.teams[side];
    const inPossession = state.possession === side;
    const ballA = ax(side, state.ball.x);
    const ballB = ay(side, state.ball.y);
    const style = team.style;
    const widthF = inPossession ? 0.72 + (style.width / 100) * 0.5 : 0.55 + (style.width / 100) * 0.15;
    const shiftY = inPossession ? 0.2 : 0.35;
    const lineAdj = ((style.defensiveLine - 50) / 100) * 0.12;

    // Pressing: die nächsten Spieler laufen den Ballführenden an
    const pressers = new Set<number>();
    if (!inPossession) {
      const ranked = onPitch(team)
        .filter((i) => slotDef(team, team.players[i].slot).position !== "GK")
        .map((i) => ({ i, d: dist(team.players[i].x, team.players[i].y, state.ball.x, state.ball.y) }))
        .sort((a, b) => a.d - b.d);
      const pressHigh = ballA > 1 - (0.35 + (style.pressing / 100) * 0.4); // Ball in welcher Zone angelaufen wird
      const count = pressHigh ? (style.pressing > 65 ? 2 : 1) : ballA < 0.4 ? 2 : 1;
      ranked.slice(0, count).forEach((r) => pressers.add(r.i));
    }

    for (const idx of onPitch(team)) {
      const p = team.players[idx];
      if (inPossession && idx === state.carrier) continue;
      const s = slotDef(team, p.slot);
      const mod = roleMod(team, p.slot);
      let tx: number;
      let ty: number;
      if (s.position === "GK") {
        tx = 0.03 + ballA * 0.1;
        ty = 0.5 + (ballB - 0.5) * 0.25;
      } else if (inPossession) {
        tx = s.x * 0.75 + ballA * 0.42 - 0.02 + mod.forward + lineAdj * 0.5 + ((style.risk - 50) / 100) * 0.04 * s.x;
        ty = 0.5 + (s.y - 0.5) * widthF + (ballB - 0.5) * shiftY;
        // Laufwege: gute Spieler suchen freie Räume
        tx += (eff(state, side, p, "offTheBall") - 10) / 400;
      } else {
        tx = s.x * 0.6 + ballA * 0.38 - 0.06 + lineAdj;
        ty = 0.5 + (s.y - 0.5) * widthF + (ballB - 0.5) * shiftY;
        // Verteidiger bleiben zwischen Ball und Tor
        if (s.x < 0.3 && tx > ballA - 0.03) tx = Math.max(0.06, ballA - 0.03);
      }
      tx = clamp(tx, 0.02, 0.96);
      ty = clamp(ty, 0.03, 0.97);
      let target = fromA(side, tx, ty);
      if (pressers.has(idx)) {
        const pressDist = 1.5 + (1 - style.pressing / 100) * 3;
        const ang = Math.atan2(p.y - state.ball.y, p.x - state.ball.x);
        target = { x: state.ball.x + Math.cos(ang) * pressDist, y: state.ball.y + Math.sin(ang) * pressDist };
      }
      const speed = (3.5 + ((eff(state, side, p, "pace") + eff(state, side, p, "acceleration")) / 40) * 8) * (0.7 + p.stamina / 330);
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const step = Math.min(d, speed);
      if (d > 0.01) {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
      p.x = clamp(p.x + rng.normal(0, 0.35), 0.5, PITCH_W - 0.5);
      p.y = clamp(p.y + rng.normal(0, 0.35), 0.5, PITCH_H - 0.5);
    }
  }
}

// ---------------------------------------------------------------- Aktionen

function tick(state: MatchState, rng: Rng) {
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

function pass(state: MatchState, rng: Rng, side: Side, carrier: EnginePlayer, pressureD: number) {
  const team = state.teams[side];
  const oppSide: Side = side === 0 ? 1 : 0;
  const style = team.style;
  const cA = ax(side, carrier.x);
  const prefLen = 10 + (style.passLength / 100) * 26;
  const candidates: { idx: number; w: number; d: number; fwd: number; open: number }[] = [];
  for (const idx of onPitch(team)) {
    const p = team.players[idx];
    if (p === carrier) continue;
    const d = dist(p.x, p.y, carrier.x, carrier.y);
    if (d < 4 || d > 60) continue;
    const fwd = (ax(side, p.x) - cA) * PITCH_W;
    const open = nearestOpponent(state, side, p.x, p.y).d;
    const isGk = slotDef(team, p.slot).position === "GK";
    const distScore = Math.exp(-Math.pow((d - prefLen) / 20, 2));
    const fScore = Math.max(0.15, 1 + clamp(fwd / 28, -0.7, 1.3) * (0.5 + style.tempo / 110) * (0.7 + style.risk / 170));
    const openScore = clamp(open / 6, 0.15, 1.6);
    const visionBonus = fwd > 15 ? 0.6 + eff(state, side, carrier, "vision") / 25 : 1;
    candidates.push({ idx, w: distScore * fScore * openScore * visionBonus * (isGk ? 0.12 : 1), d, fwd, open });
  }
  if (candidates.length === 0) {
    dribble(state, rng, side, carrier, nearestOpponent(state, side, carrier.x, carrier.y));
    return;
  }
  const pick = candidates[rng.weighted(candidates.map((c) => c.w))];
  const target = team.players[pick.idx];
  team.stats.passes++;
  carrier.st.passes++;

  const defTeam = state.teams[oppSide];
  const lineHigh = (defTeam.style.defensiveLine - 50) / 100;
  let p = 0.92 - (pick.d / PITCH_W) * 0.38
    + ((eff(state, side, carrier, "passing") - 12) / 20) * 0.1
    + ((eff(state, side, carrier, "vision") - 12) / 20) * 0.04
    + ((eff(state, side, carrier, "decisions") - 12) / 20) * 0.03
    - (pressureD < 3 ? 0.1 * (0.6 + defTeam.style.pressing / 120) : 0)
    - (pick.open < 2.5 ? 0.16 : pick.open < 5 ? 0.05 : 0)
    - Math.max(0, pick.fwd / 28) * 0.08 * (0.5 + style.risk / 70)
    - ((style.tempo - 50) / 100) * 0.12
    - (pick.fwd < 14 ? Math.max(0, lineHigh) * 0.05 : 0);
  // Steilpässe hinter eine hohe Abwehrlinie
  const through = pick.fwd > 14 && ax(side, target.x) > 0.6;
  if (through) p += lineHigh * 0.2 * (eff(state, side, target, "pace") / 12) + (style.passLength - 50) / 1000;
  p = clamp(p, 0.25, 0.97);

  if (rng.chance(p)) {
    team.stats.passesOk++;
    carrier.st.passesOk++;
    carrier.st.rating += 0.004;
    if (through) carrier.st.rating += 0.02;
    state.lastPasser = state.carrier;
    // Bei Steilpass gegen hohe Linie startet der Empfänger mit Vorsprung
    let tx = target.x;
    let ty = target.y;
    // Durchbruch hinter die Abwehr: je höher die gegnerische Linie, desto eher
    if (through && rng.chance(clamp(0.06 + lineHigh * 0.4, 0, 0.4) * (eff(state, side, target, "pace") / 12))) {
      const breakaway = fromA(side, rng.range(0.82, 0.9), 0.5 + (ay(side, target.y) - 0.5) * 0.4);
      tx = breakaway.x;
      ty = breakaway.y;
    } else if (pressureD < 3 && defTeam.style.pressing > 50) {
      // Pressing überspielt: Der Empfänger hat Raum, weil die Presser fehlen
      const gain = ((defTeam.style.pressing - 50) / 50) * rng.range(3, 9);
      const goalX = side === 0 ? PITCH_W : 0;
      tx = clamp(target.x + Math.sign(goalX - target.x) * gain, 1, PITCH_W - 1);
    }
    giveBall(state, side, pick.idx, tx, ty);
  } else {
    carrier.st.rating -= 0.03;
    // Abgefangen: Gegner nahe am Zielpunkt
    const t = rng.range(0.45, 0.95);
    const ix = carrier.x + (target.x - carrier.x) * t;
    const iy = carrier.y + (target.y - carrier.y) * t;
    const interceptor = nearestOf(state, oppSide, ix, iy);
    if (interceptor >= 0) {
      const ip = defTeam.players[interceptor];
      ip.st.tackles++;
      ip.st.rating += 0.04;
      state.lastPasser = null;
      giveBall(state, oppSide, interceptor, ix, iy);
      maybeCounter(state, rng, oppSide, style.risk);
    }
  }
}

function dribble(state: MatchState, rng: Rng, side: Side, carrier: EnginePlayer, pressure: { idx: number; d: number }) {
  const team = state.teams[side];
  const oppSide: Side = side === 0 ? 1 : 0;
  const defTeam = state.teams[oppSide];
  const dir = side === 0 ? 1 : -1;
  const cB = ay(side, carrier.y);
  const mod = roleMod(team, carrier.slot);
  // Inverse Flügel ziehen nach innen
  const inward = mod.shoot > 1.3 ? (0.5 - cB) * 0.25 : (0.5 - cB) * 0.06;
  const advance = () => {
    const len = rng.range(7, 15) * (0.7 + eff(state, side, carrier, "pace") / 40);
    const nx = clamp(carrier.x + dir * len, 1, PITCH_W - 1);
    const ny = clamp(carrier.y + (side === 0 ? 1 : -1) * inward * PITCH_H + rng.normal(0, 2.5), 2, PITCH_H - 2);
    state.lastPasser = null;
    giveBall(state, side, state.carrier, nx, ny);
  };
  if (pressure.d > 7 || pressure.idx < 0) {
    advance();
    return;
  }
  const def = defTeam.players[pressure.idx];
  const atk =
    eff(state, side, carrier, "dribbling") + eff(state, side, carrier, "agility") * 0.5 +
    eff(state, side, carrier, "technique") * 0.3 + eff(state, side, carrier, "pace") * 0.4 + eff(state, side, carrier, "strength") * 0.2;
  const hard = defTeam.style.hardness / 100;
  const dfn =
    eff(state, oppSide, def, "tackling") + eff(state, oppSide, def, "positioning") * 0.4 +
    eff(state, oppSide, def, "anticipation") * 0.4 + eff(state, oppSide, def, "strength") * 0.3 + hard * 1.5;
  const pWin = 1 / (1 + Math.exp(-(atk - dfn) / 6)) * 0.95 - 0.02;
  if (rng.chance(pWin)) {
    carrier.st.dribbles++;
    carrier.st.rating += 0.05;
    advance();
    return;
  }
  // Zweikampf verloren – eventuell Foul
  const foulP = 0.1 * (0.4 + eff(state, oppSide, def, "aggression") / 14) * (0.5 + hard);
  if (rng.chance(foulP)) {
    foul(state, rng, side, carrier, oppSide, def);
    return;
  }
  def.st.tackles++;
  def.st.rating += 0.08;
  carrier.st.rating -= 0.03;
  state.lastPasser = null;
  giveBall(state, oppSide, defTeam.players.indexOf(def), def.x, def.y);
  maybeCounter(state, rng, oppSide, team.style.risk);
}

/**
 * Konter: Wer mit hohem Risiko spielt, hat beim Ballverlust Spieler vor dem Ball.
 * Die ballerobernde Mannschaft schaltet dann schnell um.
 */
function maybeCounter(state: MatchState, rng: Rng, side: Side, loserRisk: number) {
  const team = state.teams[side];
  const ballA = ax(side, state.ball.x);
  if (ballA > 0.65) return;
  const p = clamp((loserRisk - 30) / 180, 0, 0.5) * (0.6 + team.style.tempo / 125);
  if (!rng.chance(p)) return;
  // Schnellster vorderer Spieler startet in den freien Raum
  let best = -1;
  let bestScore = -Infinity;
  for (const idx of onPitch(team)) {
    if (idx === state.carrier) continue;
    const pl = team.players[idx];
    const a = ax(side, pl.x);
    const score = a * 2 + eff(state, side, pl, "pace") / 20;
    if (score > bestScore && a > ballA) {
      bestScore = score;
      best = idx;
    }
  }
  if (best < 0) return;
  const runner = team.players[best];
  const pos = fromA(side, clamp(ax(side, runner.x) + rng.range(0.08, 0.2), 0.3, 0.86), ay(side, runner.y));
  state.lastPasser = state.carrier;
  giveBall(state, side, best, pos.x, pos.y);
}

function foul(state: MatchState, rng: Rng, side: Side, victim: EnginePlayer, oppSide: Side, offender: EnginePlayer) {
  const defTeam = state.teams[oppSide];
  const team = state.teams[side];
  defTeam.stats.fouls++;
  offender.st.fouls++;
  offender.st.rating -= 0.05;
  const vA = ax(side, victim.x);
  const vB = ay(side, victim.y);
  const inBox = vA > 0.843 && Math.abs(vB - 0.5) < 0.295 && rng.chance(0.7);
  const hard = defTeam.style.hardness / 100;
  const cardRoll = rng.next();
  const pYellow = (0.3 + hard * 0.16 + (eff(state, oppSide, offender, "aggression") - 12) / 60) * (inBox ? 1.4 : 1);
  const pRed = 0.003 + hard * 0.005;
  if (cardRoll < pRed) {
    sendOff(state, oppSide, offender, "red");
  } else if (cardRoll < pRed + pYellow) {
    offender.yellow++;
    defTeam.stats.yellow++;
    offender.st.rating -= 0.3;
    if (offender.yellow >= 2) {
      sendOff(state, oppSide, offender, "second");
    } else {
      pushEvent(state, "yellow", oppSide, `Gelbe Karte für ${offender.short} nach einem Foul an ${victim.short}.`, {
        playerId: offender.id, playerName: offender.name,
      });
    }
  }
  if (inBox) {
    pushEvent(state, "foul", oppSide, `Elfmeter! ${offender.short} bringt ${victim.short} im Strafraum zu Fall.`, {
      playerId: offender.id, playerName: offender.name, otherId: victim.id, otherName: victim.name,
    });
    state.pendingPenalty = true;
    giveBall(state, side, team.players.indexOf(victim));
    return;
  }
  const goalDist = dist(vA * PITCH_W, vB * PITCH_H, PITCH_W, PITCH_H / 2);
  if (goalDist < 30 && Math.abs(vB - 0.5) < 0.3) {
    freeKick(state, rng, side, goalDist, vB);
    return;
  }
  giveBall(state, side, team.players.indexOf(victim));
}

function sendOff(state: MatchState, side: Side, p: EnginePlayer, kind: "red" | "second") {
  const team = state.teams[side];
  p.red = true;
  team.stats.red++;
  p.st.rating -= 1.5;
  const slot = p.slot;
  if (slot >= 0) team.slots[slot] = null;
  p.slot = -2;
  p.minOut = minuteOf(state.tick);
  pushEvent(state, "red", side, kind === "red" ? `Rote Karte! ${p.short} muss vom Platz.` : `Gelb-Rot für ${p.short}!`, {
    playerId: p.id, playerName: p.name,
  });
  // Wenn der Torwart fliegt, geht ein Feldspieler ins Tor (Slot 0 neu besetzen)
  if (slot === 0) {
    const repl = onPitch(team)[0];
    if (repl !== undefined) {
      const rp = team.players[repl];
      team.slots[rp.slot] = null;
      team.slots[0] = repl;
      rp.slot = 0;
    }
  }
}

function freeKick(state: MatchState, rng: Rng, side: Side, goalDist: number, cB: number) {
  const team = state.teams[side];
  const takerId = team.setPieces.freeKickTaker;
  let takerIdx = team.players.findIndex((p) => p.id === takerId && p.slot >= 0);
  if (takerIdx < 0) takerIdx = bestOnPitch(team, "freeKicks");
  const taker = team.players[takerIdx];
  pushEvent(state, "freekick", side, `Freistoss aus ${Math.round(goalDist)} Metern für ${team.short}.`, {});
  if (goalDist < 28 && rng.chance(0.65)) {
    state.carrier = takerIdx;
    const pos = fromA(side, 1 - goalDist / PITCH_W, cB);
    taker.x = pos.x;
    taker.y = pos.y;
    state.ball = { ...pos };
    shoot(state, rng, side, taker, goalDist, cB, 9, "freekick");
  } else {
    giveBall(state, side, takerIdx);
  }
}

function bestOnPitch(team: EngineTeam, key: AttrKey): number {
  let best = onPitch(team)[0];
  for (const idx of onPitch(team)) if (team.players[idx].attrs[key] > team.players[best].attrs[key]) best = idx;
  return best;
}

type ShotKind = "open" | "header" | "freekick" | "corner";

function shoot(
  state: MatchState, rng: Rng, side: Side, shooter: EnginePlayer, goalDist: number, cB: number, pressureD: number, kind: ShotKind,
) {
  const team = state.teams[side];
  const oppSide: Side = side === 0 ? 1 : 0;
  const defTeam = state.teams[oppSide];
  const keeper = keeperOf(defTeam);
  const angle = clamp(1 - Math.abs(cB - 0.5) * 1.7, 0.22, 1);
  let xg = 0.78 * Math.exp(-goalDist / 7.0) * angle;
  let skill: number;
  if (kind === "header") {
    skill = (eff(state, side, shooter, "heading") * 1.2 + eff(state, side, shooter, "jumping") * 0.5 + eff(state, side, shooter, "composure") * 0.3) / 2;
    xg = 0.2 * angle;
  } else if (kind === "freekick") {
    skill = eff(state, side, shooter, "freeKicks");
    xg = 0.075 * (goalDist < 20 ? 1.3 : 1);
  } else {
    skill = goalDist < 18
      ? (eff(state, side, shooter, "finishing") * 1.3 + eff(state, side, shooter, "composure") * 0.5 + eff(state, side, shooter, "technique") * 0.2) / 2
      : (eff(state, side, shooter, "longShots") * 1.4 + eff(state, side, shooter, "technique") * 0.6) / 2;
  }
  if (pressureD < 2) xg *= 0.7;
  else if (pressureD > 6) xg *= 1.15;
  // Verteidiger zwischen Schütze und Tor (tiefer Block) senken die Qualität der Chance
  if (kind !== "freekick") {
    const goalX = side === 0 ? PITCH_W : 0;
    let blockers = 0;
    for (const idx of onPitch(defTeam)) {
      const d = defTeam.players[idx];
      if (slotDef(defTeam, d.slot).position === "GK") continue;
      const between = side === 0 ? d.x > shooter.x - 1 && d.x < goalX : d.x < shooter.x + 1 && d.x > goalX;
      if (between && Math.abs(d.y - (shooter.y + PITCH_H / 2) / 2) < 9) blockers++;
    }
    xg *= Math.pow(0.9, Math.min(6, blockers)) * 0.92;
  }
  // Schütze gegen Torwart: relativ, damit das Torniveau ligaunabhängig bleibt
  const kq = keeper
    ? (eff(state, oppSide, keeper, "goalkeeping") * 1.4 + eff(state, oppSide, keeper, "positioning") * 0.3 + eff(state, oppSide, keeper, "agility") * 0.3) / 2
    : 3;
  xg *= clamp(1 + (skill - kq) / 22 + (skill - 12) / 60, 0.55, 1.6);
  xg = clamp(xg, 0.01, 0.85);
  team.stats.shots++;
  team.stats.xg += xg;
  shooter.st.shots++;

  const r = rng.next();
  const pOnTargetMiss = clamp(0.25 + skill / 100, 0.2, 0.45); // gehalten
  const assistIdx = state.lastPasser;
  const assist = assistIdx !== null ? team.players[assistIdx] : null;
  const where = kind === "header" ? "per Kopf" : kind === "freekick" ? "per Freistoss" : goalDist > 20 ? "aus der Distanz" : "";

  if (r < xg) {
    team.goals++;
    team.stats.onTarget++;
    shooter.st.goals++;
    shooter.st.onTarget++;
    shooter.st.rating += 1.0;
    if (assist && assist !== shooter) {
      assist.st.assists++;
      assist.st.rating += 0.6;
    }
    if (keeper) keeper.st.rating -= 0.25;
    for (const idx of onPitch(defTeam)) {
      const pos = slotDef(defTeam, defTeam.players[idx].slot).position;
      if (pos === "DC" || pos === "DL" || pos === "DR") defTeam.players[idx].st.rating -= 0.12;
    }
    const assistText = assist && assist !== shooter ? ` Vorlage: ${assist.short}.` : "";
    pushEvent(state, "goal", side, `TOR für ${team.short}! ${shooter.short} trifft ${where}.${assistText}`.replace("  ", " "), {
      playerId: shooter.id, playerName: shooter.name,
      assistId: assist && assist !== shooter ? assist.id : undefined,
      assistName: assist && assist !== shooter ? assist.name : undefined,
      xg: round2(xg),
    });
    kickoff(state, oppSide);
    return;
  }
  if (r < xg + pOnTargetMiss * (1 - xg)) {
    team.stats.onTarget++;
    shooter.st.onTarget++;
    shooter.st.rating += 0.08;
    if (keeper) {
      keeper.st.saves++;
      keeper.st.rating += 0.2 + xg;
    }
    if (xg > 0.12) {
      pushEvent(state, "save", side, `Grosse Chance! ${keeper ? keeper.short : "Der Torwart"} pariert gegen ${shooter.short}.`, {
        playerId: shooter.id, playerName: shooter.name, otherId: keeper?.id, otherName: keeper?.name, xg: round2(xg),
      });
    }
    if (rng.chance(0.32)) {
      corner(state, rng, side);
      return;
    }
  } else {
    if (xg > 0.15) {
      pushEvent(state, "miss", side, `${shooter.short} vergibt ${where} – knapp vorbei.`.replace("  ", " "), {
        playerId: shooter.id, playerName: shooter.name, xg: round2(xg),
      });
    }
    if (rng.chance(0.18)) {
      corner(state, rng, side);
      return;
    }
  }
  // Abstoss / Torwart hat den Ball
  const kIdx = keeper ? defTeam.players.indexOf(keeper) : nearestOf(state, oppSide, state.ball.x, state.ball.y);
  const pos = fromA(oppSide, 0.05, 0.5);
  state.lastPasser = null;
  giveBall(state, oppSide, kIdx, pos.x, pos.y);
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

function aerialDuel(state: MatchState, rng: Rng, side: Side, routineBonus: number): { won: boolean; attacker: number; defender: number } {
  const team = state.teams[side];
  const oppSide: Side = side === 0 ? 1 : 0;
  const defTeam = state.teams[oppSide];
  const aerial = (s: Side, p: EnginePlayer) => eff(state, s, p, "heading") + eff(state, s, p, "jumping") * 0.8 + eff(state, s, p, "strength") * 0.3;
  const atkCands = onPitch(team).filter((i) => slotDef(team, team.players[i].slot).position !== "GK");
  const defCands = onPitch(defTeam).filter((i) => slotDef(defTeam, defTeam.players[i].slot).position !== "GK");
  const attacker = atkCands[rng.weighted(atkCands.map((i) => Math.pow(aerial(side, team.players[i]), 2)))];
  const defender = defCands[rng.weighted(defCands.map((i) => Math.pow(aerial(oppSide, defTeam.players[i]), 2)))];
  if (attacker === undefined || defender === undefined) return { won: false, attacker: atkCands[0] ?? 0, defender: defCands[0] ?? 0 };
  const a = aerial(side, team.players[attacker]) + routineBonus;
  const d = aerial(oppSide, defTeam.players[defender]) + eff(state, oppSide, defTeam.players[defender], "positioning") * 0.4 + 2;
  const won = rng.chance(1 / (1 + Math.exp(-(a - d) / 4)));
  return { won, attacker, defender };
}

function cross(state: MatchState, rng: Rng, side: Side, carrier: EnginePlayer) {
  const team = state.teams[side];
  const oppSide: Side = side === 0 ? 1 : 0;
  const defTeam = state.teams[oppSide];
  team.stats.passes++;
  carrier.st.passes++;
  const quality = eff(state, side, carrier, "crossing");
  if (!rng.chance(0.3 + quality / 50)) {
    // Flanke zu ungenau
    carrier.st.rating -= 0.02;
    const def = nearestOf(state, oppSide, fromA(side, 0.92, 0.5).x, PITCH_H / 2);
    state.lastPasser = null;
    if (rng.chance(0.2)) {
      corner(state, rng, side);
      return;
    }
    giveBall(state, oppSide, def);
    return;
  }
  team.stats.passesOk++;
  carrier.st.passesOk++;
  const duel = aerialDuel(state, rng, side, quality / 10);
  if (duel.won) {
    const header = team.players[duel.attacker];
    const pos = fromA(side, 1 - rng.range(6, 12) / PITCH_W, 0.5 + rng.normal(0, 0.06));
    header.x = pos.x;
    header.y = pos.y;
    state.ball = { ...pos };
    state.carrier = duel.attacker;
    state.lastPasser = team.players.indexOf(carrier);
    carrier.st.keyPasses++;
    carrier.st.rating += 0.06;
    shoot(state, rng, side, header, dist(ax(side, pos.x) * PITCH_W, ay(side, pos.y) * PITCH_H, PITCH_W, PITCH_H / 2), ay(side, pos.y), 1.5, "header");
    return;
  }
  const def = defTeam.players[duel.defender];
  def.st.rating += 0.06;
  state.lastPasser = null;
  if (rng.chance(0.28)) {
    corner(state, rng, side);
    return;
  }
  const pos = fromA(oppSide, rng.range(0.2, 0.4), rng.range(0.2, 0.8));
  giveBall(state, oppSide, duel.defender, pos.x, pos.y);
}

function corner(state: MatchState, rng: Rng, side: Side) {
  const team = state.teams[side];
  const oppSide: Side = side === 0 ? 1 : 0;
  team.stats.corners++;
  const takerId = team.setPieces.cornerTaker;
  let takerIdx = team.players.findIndex((p) => p.id === takerId && p.slot >= 0);
  if (takerIdx < 0) takerIdx = bestOnPitch(team, "corners");
  const taker = team.players[takerIdx];
  const cornerPos = fromA(side, 0.995, rng.chance(0.5) ? 0.01 : 0.99);
  taker.x = cornerPos.x;
  taker.y = cornerPos.y;
  state.ball = { ...cornerPos };
  pushEvent(state, "corner", side, `Ecke für ${team.short}.`, {});
  const routine = team.setPieces.corners;
  if (routine === "short") {
    // Kurz ausgeführt: Ballbesitz bleibt, Angriff wird neu aufgebaut
    const near = nearestOf(state, side, cornerPos.x, cornerPos.y, takerIdx);
    const pos = fromA(side, 0.86, ay(side, cornerPos.y) < 0.5 ? 0.18 : 0.82);
    state.lastPasser = takerIdx;
    giveBall(state, side, near, pos.x, pos.y);
    return;
  }
  const delivery = eff(state, side, taker, "corners");
  const bonus = (routine === "near" ? 0.5 : 1.5) + delivery / 8;
  const duel = aerialDuel(state, rng, side, bonus);
  if (duel.won && rng.chance(0.75)) {
    const header = team.players[duel.attacker];
    const d = routine === "near" ? rng.range(5, 8) : rng.range(8, 12);
    const pos = fromA(side, 1 - d / PITCH_W, 0.5 + rng.normal(0, 0.07));
    header.x = pos.x;
    header.y = pos.y;
    state.ball = { ...pos };
    state.carrier = duel.attacker;
    state.lastPasser = takerIdx;
    shoot(state, rng, side, header, d, ay(side, pos.y), 1.5, "header");
    return;
  }
  const pos = fromA(oppSide, rng.range(0.1, 0.3), rng.range(0.25, 0.75));
  state.lastPasser = null;
  giveBall(state, oppSide, duel.defender, pos.x, pos.y);
}

function clearance(state: MatchState, rng: Rng, side: Side, carrier: EnginePlayer) {
  const oppSide: Side = side === 0 ? 1 : 0;
  const cA = ax(side, carrier.x);
  const target = fromA(side, clamp(cA + rng.range(0.25, 0.45), 0, 0.85), rng.range(0.1, 0.9));
  // Zweiter Ball: wer ist näher?
  const mine = nearestOf(state, side, target.x, target.y, state.carrier);
  const theirs = nearestOf(state, oppSide, target.x, target.y);
  const myD = mine >= 0 ? dist(state.teams[side].players[mine].x, state.teams[side].players[mine].y, target.x, target.y) : 99;
  const theirD = theirs >= 0 ? dist(state.teams[oppSide].players[theirs].x, state.teams[oppSide].players[theirs].y, target.x, target.y) : 99;
  state.lastPasser = null;
  if (rng.chance(myD < theirD ? 0.6 : 0.35) && mine >= 0) giveBall(state, side, mine, target.x, target.y);
  else giveBall(state, oppSide, theirs, target.x, target.y);
}

function penalty(state: MatchState, rng: Rng, side: Side) {
  const team = state.teams[side];
  const oppSide: Side = side === 0 ? 1 : 0;
  const defTeam = state.teams[oppSide];
  const takerId = team.setPieces.penaltyTaker;
  let takerIdx = team.players.findIndex((p) => p.id === takerId && p.slot >= 0);
  if (takerIdx < 0) takerIdx = bestOnPitch(team, "penalties");
  const taker = team.players[takerIdx];
  const keeper = keeperOf(defTeam);
  const pos = fromA(side, 1 - 11 / PITCH_W, 0.5);
  taker.x = pos.x;
  taker.y = pos.y;
  state.ball = { ...pos };
  const p = clamp(
    0.76 + ((eff(state, side, taker, "penalties") - 10) / 20) * 0.14 + ((eff(state, side, taker, "composure") - 10) / 20) * 0.05 -
      (keeper ? ((eff(state, oppSide, keeper, "goalkeeping") - 10) / 20) * 0.1 : 0),
    0.55,
    0.92,
  );
  team.stats.shots++;
  team.stats.xg += 0.76;
  taker.st.shots++;
  if (rng.chance(p)) {
    team.goals++;
    team.stats.onTarget++;
    taker.st.goals++;
    taker.st.onTarget++;
    taker.st.rating += 0.8;
    pushEvent(state, "penalty_goal", side, `TOR für ${team.short}! ${taker.short} verwandelt den Elfmeter sicher.`, {
      playerId: taker.id, playerName: taker.name, xg: 0.76,
    });
    kickoff(state, oppSide);
  } else {
    taker.st.rating -= 0.6;
    if (keeper) {
      keeper.st.rating += 0.8;
      keeper.st.saves++;
    }
    pushEvent(state, "penalty_miss", side, `${taker.short} scheitert vom Punkt! ${keeper ? keeper.short + " hält." : ""}`, {
      playerId: taker.id, playerName: taker.name, otherId: keeper?.id, otherName: keeper?.name, xg: 0.76,
    });
    const kIdx = keeper ? defTeam.players.indexOf(keeper) : nearestOf(state, oppSide, pos.x, pos.y);
    giveBall(state, oppSide, kIdx, fromA(oppSide, 0.05, 0.5).x, PITCH_H / 2);
  }
}

// ---------------------------------------------------------------- Ausdauer, Verletzungen, Wechsel

function updateCondition(state: MatchState, rng: Rng) {
  for (const side of [0, 1] as Side[]) {
    const team = state.teams[side];
    const intensity = 0.7 + (team.style.pressing / 100) * 0.6 + (team.style.tempo / 100) * 0.2;
    for (const idx of onPitch(team)) {
      const p = team.players[idx];
      const isGk = slotDef(team, p.slot).position === "GK";
      const drain = (isGk ? 0.012 : 0.07) * intensity * (1.25 - p.attrs.stamina / 40) * (1.1 - p.attrs.workRate / 100);
      p.stamina = Math.max(15, p.stamina - drain);
      if (!isGk && rng.chance(0.000022 * (1 + (100 - p.stamina) / 40) * (0.8 + team.style.hardness / 250))) {
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

// ---------------------------------------------------------------- Ablauf

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
  setPieces?: Partial<Tactic["setPieces"]>;
  /** Wechsel: Slot → ID des Bankspielers */
  subs?: { slot: number; playerId: number }[];
  autoSubs?: boolean;
}

export function applyChange(state: MatchState, side: Side, change: TacticChange) {
  const team = state.teams[side];
  let changed = false;
  if (change.formation && change.formation !== team.formation) {
    // Spieler behalten ihre Slot-Nummer; neue Formation ordnet die Positionen neu zu
    team.formation = change.formation;
    team.roles = FORMATIONS[change.formation].map((s) => defaultRole(s.position));
    team.slotOffsets = [];
    changed = true;
  }
  if (change.style) {
    team.style = { ...team.style, ...change.style };
    changed = true;
  }
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
  if (changed) pushEvent(state, "tactic", side, `${team.short} stellt um: ${team.formation}.`, {});
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
    players,
    motm,
  };
}

/** Komplettes Spiel in einem Schritt (für KI-Partien). */
export function playMatch(setup: MatchSetup): MatchResult {
  const state = createMatch(setup);
  simulate(state, TICKS);
  return result(state);
}
