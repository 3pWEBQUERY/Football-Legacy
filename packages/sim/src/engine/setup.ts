/** Matchengine: Aufbau von Teams und Spielstand aus der Aufstellung. */
import { shortName } from "../player";
import { clamp } from "../rng";
import { FORMATIONS, defaultRole, mentalityStyle } from "../tactics";
import type { Player } from "../types";
import { EnginePlayer, EnginePlayerStats, EngineTeam, EngineTeamStats, MatchSetup, MatchState, PITCH_H, PITCH_W, Side, TeamSetup } from "./types";
import { basePosition, kickoff, pushEvent } from "./util";

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
    style: mentalityStyle({ ...t.style }, t.mentality ?? 0),
    baseStyle: { ...t.style },
    mentality: t.mentality ?? 0,
    duties: t.duties ? [...t.duties] : [],
    instructions: t.instructions ? t.instructions.map((x) => [...(x ?? [])]) : [],
    familiarity: setup.familiarity ?? 85,
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
