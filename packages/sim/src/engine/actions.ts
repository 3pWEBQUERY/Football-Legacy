/** Matchengine: Pässe, Dribblings, Konter, Fouls, Platzverweise, Freistösse. */
import { Rng, clamp } from "../rng";
import { bestOnPitch, shoot } from "./shots";
import { EnginePlayer, MatchState, PITCH_H, PITCH_W, Side } from "./types";
import { ax, ay, dist, eff, fromA, giveBall, minuteOf, nearestOf, nearestOpponent, onPitch, pushEvent, roleMod, slotDef } from "./util";

export function pass(state: MatchState, rng: Rng, side: Side, carrier: EnginePlayer, pressureD: number) {
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
  if (through && offside(state, rng, side, target, lineHigh)) return;
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

/**
 * Abseits bei Steilpässen: je höher die gegnerische Linie, desto öfter steht
 * der Empfänger zu weit vorne. Gutes Timing (Antizipation, Laufwege) hilft.
 */
function offside(state: MatchState, rng: Rng, side: Side, target: EnginePlayer, lineHigh: number): boolean {
  const timing = (eff(state, side, target, "offTheBall") + eff(state, side, target, "anticipation") - 24) / 80;
  if (!rng.chance(clamp(0.05 + lineHigh * 0.14 - timing * 0.6, 0.015, 0.18))) return false;
  const team = state.teams[side];
  const oppSide: Side = side === 0 ? 1 : 0;
  team.stats.offsides = (team.stats.offsides ?? 0) + 1;
  target.st.rating -= 0.02;
  pushEvent(state, "offside", side, `Abseits! ${target.short} startet zu früh.`, { playerId: target.id, playerName: target.name });
  // Indirekter Freistoss für die verteidigende Mannschaft
  const keeper = nearestOf(state, oppSide, target.x, target.y);
  if (keeper >= 0) giveBall(state, oppSide, keeper, target.x, target.y);
  state.lastPasser = null;
  return true;
}

export function dribble(state: MatchState, rng: Rng, side: Side, carrier: EnginePlayer, pressure: { idx: number; d: number }) {
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
  // „Hart angehen“ als Gegneranweisung: deutlich mehr Fouls am markierten Spieler
  const hardMark = defTeam.marks?.[carrier.id] === "hard" ? 1.6 : 1;
  const foulP = 0.1 * (0.4 + eff(state, oppSide, def, "aggression") / 14) * (0.5 + hard) * hardMark;
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
  // Strenge Schiedsrichter zücken öfter Karten
  const strict = state.conditions?.referee.strictness ?? 1;
  const pYellow = (0.3 + hard * 0.16 + (eff(state, oppSide, offender, "aggression") - 12) / 60) * (inBox ? 1.4 : 1) * strict;
  const pRed = (0.003 + hard * 0.005) * strict;
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
