/** Matchengine: Aufbau von Teams und Spielstand aus der Aufstellung. */
import { shortName } from "../player";
import { clamp } from "../rng";
import { FORMATIONS, defaultRole, mentalityStyle } from "../tactics";
import type { Player } from "../types";
import { EnginePlayer, EnginePlayerStats, EngineTeam, EngineTeamStats, MatchSetup, MatchState, PITCH_H, PITCH_W, Side, TeamSetup } from "./types";
import { basePosition, kickoff, leadership, pushEvent } from "./util";
import { bigGameFactor, hasTrait, injuryFactor } from "../traits";
import { WEATHER_MODS, WEATHER_STAMINA } from "../conditions";

function newStats(): EnginePlayerStats {
  return { goals: 0, assists: 0, shots: 0, onTarget: 0, passes: 0, passesOk: 0, tackles: 0, dribbles: 0, saves: 0, fouls: 0, keyPasses: 0, rating: 6.0 };
}

function newTeamStats(): EngineTeamStats {
  return { shots: 0, onTarget: 0, xg: 0, possession: 0, passes: 0, passesOk: 0, fouls: 0, corners: 0, yellow: 0, red: 0, offsides: 0 };
}

/** Kapitän und Stellvertreter: gewählt oder die besten Anführer der Startelf. Wirkung bis +1,6 % auf alle Aktionen. */
function leaders(t: TeamSetup["tactic"], players: EnginePlayer[], slots: (number | null)[]): EngineTeam["lead"] {
  const idxOf = (id: number | null | undefined) => (id == null ? -1 : players.findIndex((p) => p.id === id));
  const starters = slots.filter((x): x is number => x !== null).sort((a, b) => leadership(players[b]) - leadership(players[a]));
  let cap = idxOf(t.captain);
  if (cap < 0) cap = starters[0] ?? -1;
  let vice = idxOf(t.viceCaptain);
  if (vice < 0 || vice === cap) vice = starters.find((i) => i !== cap) ?? -1;
  const boost = (i: number) => (i >= 0 ? 0.004 + 0.012 * leadership(players[i]) : 0);
  return { cap: cap >= 0 ? cap : null, vice: vice >= 0 ? vice : null, capBoost: boost(cap), viceBoost: boost(vice) * 0.7 };
}

function buildTeam(setup: TeamSetup, opponentId: number, big: boolean): EngineTeam {
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
      clutch: big && bigGameFactor(p) !== 1 ? bigGameFactor(p) : undefined,
      leader: hasTrait(p, "leader") || undefined,
      fragile: injuryFactor(p) !== 1 ? injuryFactor(p) : undefined,
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
    lead: leaders(t, players, slots),
    marks: t.opposition && t.opposition.clubId === opponentId
      ? Object.fromEntries(t.opposition.items.slice(0, 3).map((o) => [o.playerId, o.kind]))
      : undefined,
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
    teams: [buildTeam(setup.home, setup.away.clubId, !!setup.big), buildTeam(setup.away, setup.home.clubId, !!setup.big)],
    events: [],
    homeAdvantage: setup.homeAdvantage ?? 1.06,
    level: 10,
    finished: false,
    lastPasser: null,
    pendingPenalty: false,
    lineupHistory: [],
  };
  if (setup.conditions) {
    state.conditions = { weather: setup.conditions.weather, temperature: setup.conditions.temperature, referee: setup.conditions.referee };
    const mods = WEATHER_MODS[setup.conditions.weather];
    if (Object.keys(mods).length) state.weatherMods = { ...mods };
    if (WEATHER_STAMINA[setup.conditions.weather] !== 1) state.staminaFactor = WEATHER_STAMINA[setup.conditions.weather];
  }
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
