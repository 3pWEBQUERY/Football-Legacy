/**
 * Matchengine: simuliert ein Spiel als Folge von 540 Ticks (je ~10 Spielsekunden).
 * Reines TypeScript ohne UI. Gleicher Seed + gleiche Eingaben => gleiches Ergebnis.
 *
 * Koordinaten in Metern: Spielfeld 105 x 68. Die Heimmannschaft spielt nach rechts
 * (Tor bei x = 105), die Gäste nach links.
 *
 * Aufbau: engine/types (Datentypen), engine/setup (Aufstellung → Spielstand),
 * engine/util (Geometrie, Bewegung), engine/actions (Pass, Dribbling, Foul),
 * engine/shots (Abschluss, Standards), engine/flow (Ablauf, Wechsel, Ergebnis),
 * engine/touchline (Zurufe, Halbzeitansprache).
 */
export { HALF_TICK, PITCH_H, PITCH_W, TICKS, TICKS_PER_MINUTE } from "./engine/types";
export type { EnginePlayer, EnginePlayerStats, EngineTeam, EngineTeamStats, Frame, MatchSetup, MatchState, ShotRecord, Side, TeamSetup } from "./engine/types";
export { HALFTIME_TONES, SHOUTS, SHOUT_COOLDOWN, halftimeTalk, shout } from "./engine/touchline";
export type { HalftimeTone, ShoutKind } from "./engine/touchline";
export { createMatch } from "./engine/setup";
export { applyChange, currentFrame, playMatch, result, simulate, substitute } from "./engine/flow";
export type { MatchResult, PlayerMatchLine, TacticChange } from "./engine/flow";
