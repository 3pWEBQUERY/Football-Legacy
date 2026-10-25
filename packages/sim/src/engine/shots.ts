/** Matchengine: Torschüsse, Flanken, Kopfballduelle, Ecken, Befreiungsschläge, Elfmeter. */
import { Rng, clamp } from "../rng";
import type { AttrKey } from "../types";
import { EnginePlayer, EngineTeam, MatchState, PITCH_H, PITCH_W, Side } from "./types";
import { ax, ay, dist, eff, fromA, giveBall, keeperOf, kickoff, nearestOf, onPitch, pushEvent, slotDef } from "./util";

export function bestOnPitch(team: EngineTeam, key: AttrKey): number {
  let best = onPitch(team)[0];
  for (const idx of onPitch(team)) if (team.players[idx].attrs[key] > team.players[best].attrs[key]) best = idx;
  return best;
}

type ShotKind = "open" | "header" | "freekick" | "corner";

export function shoot(
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
    pushEvent(state, "goal", side, `TOR für ${team.short}! ${shooter.short} trifft${where ? ` ${where}` : ""}.${assistText}`, {
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
      pushEvent(state, "miss", side, `${shooter.short} vergibt${where ? ` ${where}` : ""} – knapp vorbei.`, {
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

export function cross(state: MatchState, rng: Rng, side: Side, carrier: EnginePlayer) {
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

export function clearance(state: MatchState, rng: Rng, side: Side, carrier: EnginePlayer) {
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

export function penalty(state: MatchState, rng: Rng, side: Side) {
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
