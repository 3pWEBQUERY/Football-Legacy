/** Gemeinsame, datenbankunabhängige Datenobjekte der Simulation. */

export type Position =
  | "GK" | "DR" | "DC" | "DL" | "DM" | "MR" | "MC" | "ML" | "AMR" | "AMC" | "AML" | "ST";

export const POSITIONS: Position[] = ["GK", "DR", "DC", "DL", "DM", "MR", "MC", "ML", "AMR", "AMC", "AML", "ST"];

export const POSITION_LABEL: Record<Position, string> = {
  GK: "TW", DR: "RV", DC: "IV", DL: "LV", DM: "DM", MR: "RM", MC: "ZM", ML: "LM",
  AMR: "RA", AMC: "ZOM", AML: "LA", ST: "ST",
};

export type PositionGroup = "GK" | "DEF" | "MID" | "ATT";

export function positionGroup(p: Position): PositionGroup {
  if (p === "GK") return "GK";
  if (p === "DR" || p === "DC" || p === "DL") return "DEF";
  if (p === "ST" || p === "AMR" || p === "AML") return "ATT";
  return "MID";
}

/** 14 technische Werte (Skala 1–20). */
export const TECHNICAL = [
  "corners", "crossing", "dribbling", "finishing", "firstTouch", "freeKicks", "heading",
  "longShots", "marking", "passing", "penalties", "tackling", "technique", "goalkeeping",
] as const;
/** 8 mentale Werte. */
export const MENTAL = [
  "aggression", "anticipation", "composure", "decisions", "offTheBall", "positioning", "vision", "workRate",
] as const;
/** 6 physische Werte. */
export const PHYSICAL = ["acceleration", "agility", "jumping", "pace", "stamina", "strength"] as const;

export type TechnicalAttr = (typeof TECHNICAL)[number];
export type MentalAttr = (typeof MENTAL)[number];
export type PhysicalAttr = (typeof PHYSICAL)[number];
export type AttrKey = TechnicalAttr | MentalAttr | PhysicalAttr;
export type Attributes = Record<AttrKey, number>;

export const ALL_ATTRS: AttrKey[] = [...TECHNICAL, ...MENTAL, ...PHYSICAL];

export const ATTR_LABEL: Record<AttrKey, string> = {
  corners: "Ecken", crossing: "Flanken", dribbling: "Dribbling", finishing: "Abschluss",
  firstTouch: "Ballannahme", freeKicks: "Freistösse", heading: "Kopfball", longShots: "Fernschüsse",
  marking: "Manndeckung", passing: "Passen", penalties: "Elfmeter", tackling: "Tackling",
  technique: "Technik", goalkeeping: "Torwartspiel",
  aggression: "Aggressivität", anticipation: "Antizipation", composure: "Nervenstärke",
  decisions: "Entscheidungen", offTheBall: "Laufwege", positioning: "Stellungsspiel",
  vision: "Übersicht", workRate: "Einsatz",
  acceleration: "Antritt", agility: "Beweglichkeit", jumping: "Sprungkraft", pace: "Tempo",
  stamina: "Ausdauer", strength: "Kraft",
};

export type Foot = "R" | "L" | "B";

export interface Contract {
  wage: number; // pro Woche
  untilSeason: number; // läuft bis Ende dieser Saison
  releaseClause: number | null;
  goalBonus: number;
}

export interface SeasonStats {
  apps: number;
  goals: number;
  assists: number;
  ratingSum: number;
  yellow: number;
  red: number;
  cleanSheets: number;
}

export interface Player {
  id: number;
  clubId: number | null;
  firstName: string;
  lastName: string;
  birthYear: number;
  age: number;
  nationality: string; // ISO-Code
  position: Position;
  altPositions: Position[];
  foot: Foot;
  archetype: string;
  attrs: Attributes;
  potential: number; // 1–100
  rating: number; // aktuelle Stärke 1–100
  form: number; // 1–10
  fitness: number; // 0–100
  morale: number; // 0–100
  value: number;
  contract: Contract | null;
  injuryWeeks: number;
  suspendedWeeks: number;
  stats: SeasonStats;
  listed: boolean; // auf der Transferliste
  youth: boolean;
  wonderkid: boolean;
  /** Angesammelter Trainingsfortschritt (ab 1 steigt ein Attribut). */
  devProgress: number;
  /** Abgeschlossene Saisons. */
  history?: PlayerSeason[];
  /** Leihe: clubId ist der aufnehmende Verein, parentClubId der Stammverein. */
  loan?: { parentClubId: number; untilSeason: number; wageShare: number } | null;
  /** Letztes Gespräch mit dem Trainer (Saison, Tag) */
  talk?: { season: number; day: number } | null;
  /** Versprochene Einsatzzeit: Startelfeinsätze bis zum Tag `until` */
  promise?: { season: number; until: number; needed: number; starts: number } | null;
  /** Trainingsnoten der letzten Einheiten */
  training?: number[];
  /** Individuelles Training: eigener Schwerpunkt und Umschulung auf eine neue Position (Fortschritt 0–100) */
  individual?: { focus: import("./progression").TrainingFocus | null; position: Position | null; progress: number } | null;
  /** Länderspiele und Tore für die Nationalmannschaft */
  caps?: number;
  intlGoals?: number;
  /** Abgestellt zur Nationalmannschaft bis zu diesem Tag */
  away?: { season: number; until: number } | null;
}

export interface PlayerSeason {
  season: number;
  clubName: string;
  apps: number;
  goals: number;
  assists: number;
  avgRating: number;
}

export interface ClubColors {
  primary: string;
  secondary: string;
}

export type Formation = "4-4-2" | "4-3-3" | "4-2-3-1" | "3-5-2" | "4-1-4-1" | "5-3-2" | "4-4-1-1" | "3-4-3";

export interface TacticStyle {
  tempo: number; // 0–100
  passLength: number; // 0–100 kurz → lang
  width: number; // 0–100 eng → breit
  risk: number; // 0–100 sicher → riskant
  pressing: number; // 0–100 Pressinghöhe
  defensiveLine: number; // 0–100 tief → hoch
  hardness: number; // 0–100 fair → hart
}

export type CornerRoutine = "near" | "far" | "short";

export interface Tactic {
  formation: Formation;
  style: TacticStyle;
  /** Spieler-IDs in Reihenfolge der Formations-Slots (11). */
  lineup: (number | null)[];
  bench: number[];
  /** Rolle pro Slot. */
  roles: string[];
  /** Slot-Positionen frei verschiebbar (normiert 0..1, eigene Hälfte links). */
  slotOffsets?: ({ x: number; y: number } | null)[];
  setPieces: {
    corners: CornerRoutine;
    cornerTaker: number | null;
    freeKickTaker: number | null;
    penaltyTaker: number | null;
  };
}

export interface Club {
  id: number;
  leagueId: number;
  countryCode: string;
  name: string;
  shortName: string;
  city: string;
  reputation: number; // 1–100
  rating: number; // Mannschaftsstärke 1–100
  balance: number;
  transferBudget: number;
  wageBudget: number;
  capacity: number;
  colors: ClubColors;
  founded: number;
  tactic: Tactic | null;
  playersGenerated: boolean;
}

export interface League {
  id: number;
  countryCode: string;
  tier: number;
  name: string;
  size: number;
  promotion: number;
  relegation: number;
  active: boolean; // Detailsimulation
}

export type MatchEventType =
  | "goal" | "own_goal" | "penalty_goal" | "penalty_miss" | "shot" | "save" | "miss" | "chance"
  | "yellow" | "red" | "foul" | "sub" | "injury" | "corner" | "freekick" | "kickoff" | "halftime" | "fulltime" | "tactic";

export interface MatchEvent {
  minute: number;
  tick: number;
  type: MatchEventType;
  side: "home" | "away" | null;
  playerId?: number;
  playerName?: string;
  assistId?: number;
  assistName?: string;
  otherId?: number;
  otherName?: string;
  text: string;
  xg?: number;
  score?: [number, number];
}

export interface Fixture {
  id: number;
  leagueId: number;
  season: number;
  week: number;
  round: number;
  homeId: number;
  awayId: number;
  homeGoals: number | null;
  awayGoals: number | null;
  played: boolean;
}

export interface StandingRow {
  clubId: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: ("W" | "D" | "L")[];
}
