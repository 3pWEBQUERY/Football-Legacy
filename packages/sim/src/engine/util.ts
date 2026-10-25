/** Matchengine: Geometrie, Hilfsfunktionen und Bewegung der Spieler. */
import { Rng, clamp } from "../rng";
import { FORMATIONS, familiarityFactor, slotMod } from "../tactics";
import type { AttrKey, MatchEvent, MatchEventType } from "../types";
import { tick } from "./flow";
import { EnginePlayer, EngineTeam, MatchState, PITCH_H, PITCH_W, SIDE_NAME, SPREAD, Side, TICKS_PER_MINUTE } from "./types";

// ---------------------------------------------------------------- Hilfsfunktionen

/** Wandelt Feldkoordinaten in die Angriffsrichtung einer Seite um (0 = eigenes Tor, 1 = gegnerisches). */
export function ax(side: Side, x: number): number {
  return side === 0 ? x / PITCH_W : 1 - x / PITCH_W;
}
export function ay(side: Side, y: number): number {
  return side === 0 ? y / PITCH_H : 1 - y / PITCH_H;
}
export function fromA(side: Side, a: number, b: number): { x: number; y: number } {
  return side === 0 ? { x: a * PITCH_W, y: b * PITCH_H } : { x: (1 - a) * PITCH_W, y: (1 - b) * PITCH_H };
}
export function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

export function minuteOf(tick: number): number {
  return Math.min(90, Math.floor(tick / TICKS_PER_MINUTE) + 1);
}

export function slotDef(team: EngineTeam, slot: number) {
  const base = FORMATIONS[team.formation][slot];
  const off = team.slotOffsets[slot];
  return off ? { position: base.position, x: clamp(off.x, 0.02, 0.95), y: clamp(off.y, 0.03, 0.97) } : base;
}

export function basePosition(team: EngineTeam, side: Side, slot: number) {
  const s = slotDef(team, slot);
  // Anstoss: eigene Hälfte
  return fromA(side, s.x * 0.5, s.y);
}

export function onPitch(team: EngineTeam): number[] {
  const out: number[] = [];
  for (const idx of team.slots) if (idx !== null) out.push(idx);
  return out;
}

/** Effektiver Attributwert unter Berücksichtigung von Ausdauer, Form, Moral und Heimvorteil. */
export function eff(state: MatchState, side: Side, p: EnginePlayer, key: AttrKey): number {
  const condition = (0.7 + 0.3 * (p.stamina / 100)) * (0.95 + (p.form / 10) * 0.1) * (0.97 + (p.morale / 100) * 0.06);
  // Unterschiede werden um das Spielniveau gestaucht, damit Favoriten gewinnen, aber nicht immer
  const raw = p.attrs[key] * condition * (side === 0 ? state.homeAdvantage : 1) * familiarityFactor(state.teams[side].familiarity);
  return 12 + (raw - state.level) * SPREAD;
}

export function pushEvent(
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

export function nearestOpponent(state: MatchState, side: Side, x: number, y: number): { idx: number; d: number } {
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

export function keeperOf(team: EngineTeam): EnginePlayer | null {
  const idx = team.slots[0];
  if (idx !== null && slotDef(team, 0).position === "GK") return team.players[idx];
  for (const i of onPitch(team)) if (team.players[i].position === "GK") return team.players[i];
  const any = onPitch(team)[0];
  return any !== undefined ? team.players[any] : null;
}

export function roleMod(team: EngineTeam, slot: number) {
  return slotMod(team.roles[slot], slotDef(team, slot).position, team.duties?.[slot], team.instructions?.[slot], team.mentality ?? 0);
}

export function kickoff(state: MatchState, side: Side) {
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

export function giveBall(state: MatchState, side: Side, idx: number, x?: number, y?: number) {
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
export function nearestOf(state: MatchState, side: Side, x: number, y: number, exclude = -1): number {
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

export function moveTeams(state: MatchState, rng: Rng) {
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
