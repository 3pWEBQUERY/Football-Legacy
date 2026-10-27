/** Matchengine: Konstanten und Datentypen (Spieler, Teams, Spielstand, Frames). */
import type { AttrKey, ClubColors, Duty, Formation, MatchEvent, OppInstructionKind, Player, PlayerInstruction, Position, Tactic, TacticStyle } from "../types";

export const PITCH_W = 105;
export const PITCH_H = 68;
export const TICKS = 540;
export const HALF_TICK = 270;
export const TICKS_PER_MINUTE = 6;

export type Side = 0 | 1; // 0 = Heim, 1 = Gast
export const SIDE_NAME = ["home", "away"] as const;
/** Stauchung der Attributunterschiede (1 = volle Unterschiede). */
export const SPREAD = 0.5;

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
  /** Charakter: Faktor in grossen Spielen, Führungsspieler, Verletzungsanfälligkeit */
  clutch?: number;
  leader?: boolean;
  fragile?: number;
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
  /** Wirksame Spielweise (inkl. Mentalität) */
  style: TacticStyle;
  /** Eingestellte Regler ohne Mentalität */
  baseStyle?: TacticStyle;
  mentality?: number;
  duties?: (Duty | null)[];
  instructions?: PlayerInstruction[][];
  /** Taktische Vertrautheit 0–100 */
  familiarity?: number;
  roles: string[];
  slotOffsets: ({ x: number; y: number } | null)[];
  setPieces: Tactic["setPieces"];
  slots: (number | null)[]; // Index in players je Formations-Slot
  players: EnginePlayer[];
  subsUsed: number;
  autoSubs: boolean;
  goals: number;
  stats: EngineTeamStats;
  /** Einstellung der Mannschaft aus der Halbzeitansprache (−0,04 … +0,04, wirkt auf alle Aktionen) */
  spirit?: number;
  /** Aktueller Zuruf von der Seitenlinie: Wirkung bis zum Tick `until` */
  shout?: { kind: string; until: number; boost: number } | null;
  /** Frühester Tick für den nächsten Zuruf */
  shoutReady?: number;
  /** Kapitän und Stellvertreter (Index in players) mit ihrer Führungswirkung */
  lead?: { cap: number | null; vice: number | null; capBoost: number; viceBoost: number; tick?: number; value?: number };
  /** Gegneranweisungen dieses Teams: gegnerische Spieler-ID → Art */
  marks?: Record<number, OppInstructionKind>;
}

/** Ein Torschuss für Schusskarte und xG-Verlauf (x: 0 eigene Torlinie → 1 gegnerische, y: 0 links → 1 rechts). */
export interface ShotRecord {
  tick: number;
  side: Side;
  playerId: number;
  xg: number;
  x: number;
  y: number;
  kind: "open" | "header" | "freekick" | "corner" | "penalty";
  outcome: "goal" | "saved" | "off";
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
  shots?: ShotRecord[];
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
  /** Taktische Vertrautheit 0–100 (KI-Teams: 85) */
  familiarity?: number;
}

export interface MatchSetup {
  seed: number;
  home: TeamSetup;
  away: TeamSetup;
  homeAdvantage?: number;
  /** Grosses Spiel (Derby, Pokal-K.-o., Relegation, Kontinentalpokal): Wettkampftypen legen zu, Nervöse lassen nach */
  big?: boolean;
}

/** Ein Frame: [ballX, ballY, ballführende Seite, 11x Heim (x,y), 11x Gast (x,y)] in Dezimetern, -1 = leer. */
export type Frame = number[];
