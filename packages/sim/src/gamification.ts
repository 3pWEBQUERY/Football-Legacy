/**
 * Gamification: Manager-Level, Erfolge, Tagesmissionen, Serien, Sammlungen.
 * Belohnungen sind kosmetisch oder geben kleine Komfortvorteile – nie Siege.
 */
import { Rng, seedFor } from "./rng";

export interface ManagerProfile {
  level: number;
  xp: number;
  points: number; // Manager-Punkte (Spielwährung)
  reputation: number; // 1–100, steigt mit Erfolg
  achievements: Record<string, string>; // id → Datum
  winStreak: number;
  unbeaten: number;
  bestWinStreak: number;
  totals: { wins: number; draws: number; losses: number; goals: number; conceded: number; titles: number; promotions: number; seasons: number; youthDebuts: number; signings: number; bigSigning: number; cups?: number };
  missions: { date: string; items: MissionState[] };
  cards: CollectedCard[];
  skins: string[];
  activeSkin: string;
  titleBadge: string | null;
  trainingBoostWeeks: number;
  history: SeasonRecord[];
  autoSubs?: boolean;
  streakRewardDay?: string;
  pressDone?: number;
}

export interface SeasonRecord {
  season: number;
  clubName: string;
  leagueName: string;
  position: number;
  points: number;
  played: number;
  champion: boolean;
  promoted: boolean;
  relegated: boolean;
  cup?: string;
}

export interface CollectedCard {
  playerId: number;
  name: string;
  position: string;
  rating: number;
  nationality: string;
  rarity: Rarity;
  season: number;
  reason: string;
}

export type Rarity = "common" | "rare" | "epic" | "legendary";

export const RARITY_LABEL: Record<Rarity, string> = { common: "Gewöhnlich", rare: "Selten", epic: "Episch", legendary: "Legendär" };

export function rarityFor(rating: number, wonderkid: boolean): Rarity {
  if (rating >= 82 || (wonderkid && rating >= 70)) return "legendary";
  if (rating >= 74 || wonderkid) return "epic";
  if (rating >= 64) return "rare";
  return "common";
}

export function newManagerProfile(): ManagerProfile {
  return {
    level: 1,
    xp: 0,
    points: 100,
    reputation: 30,
    achievements: {},
    winStreak: 0,
    unbeaten: 0,
    bestWinStreak: 0,
    totals: { wins: 0, draws: 0, losses: 0, goals: 0, conceded: 0, titles: 0, promotions: 0, seasons: 0, youthDebuts: 0, signings: 0, bigSigning: 0 },
    missions: { date: "", items: [] },
    cards: [],
    skins: ["classic"],
    activeSkin: "classic",
    titleBadge: null,
    trainingBoostWeeks: 0,
    history: [],
  };
}

/** Benötigte Gesamt-XP für ein Level. */
export function xpForLevel(level: number): number {
  return Math.round(150 * Math.pow(level - 1, 1.6));
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (xp >= xpForLevel(level + 1) && level < 50) level++;
  return level;
}

export const LEVEL_TITLES: { level: number; title: string }[] = [
  { level: 1, title: "Co-Trainer" },
  { level: 3, title: "Interimstrainer" },
  { level: 5, title: "Cheftrainer" },
  { level: 8, title: "Taktikfuchs" },
  { level: 12, title: "Erfolgstrainer" },
  { level: 16, title: "Meistermacher" },
  { level: 20, title: "Trainerlegende" },
];

export function titleForLevel(level: number): string {
  return [...LEVEL_TITLES].reverse().find((t) => level >= t.level)!.title;
}

export interface Unlock {
  level: number;
  id: string;
  name: string;
  description: string;
}

export const UNLOCKS: Unlock[] = [
  { level: 2, id: "card_packs", name: "Kartenpakete", description: "Spielerkarten-Pakete im Shop (transparente Chancen)." },
  { level: 3, id: "skins", name: "Stadion-Skins", description: "Kosmetische Rasen- und Stadionlooks für die 2D-Ansicht." },
  { level: 4, id: "analysis", name: "Gegner-Analyse", description: "Vor dem Spiel: Formation und Stärken des Gegners." },
  { level: 5, id: "scouting_network", name: "Scouting-Netzwerk", description: "Ligen im Ausland scouten und deren Spieler auf dem Transfermarkt sehen." },
  { level: 7, id: "staff_upgrade", name: "Trainerstab ausbauen", description: "Co-Trainer, Physio und Scout verbessern." },
  { level: 10, id: "legend_badge", name: "Legenden-Abzeichen", description: "Goldenes Abzeichen neben deinem Namen in den Ranglisten." },
];

export function isUnlocked(profile: Pick<ManagerProfile, "level">, id: string): boolean {
  const u = UNLOCKS.find((x) => x.id === id);
  return !u || profile.level >= u.level;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  xp: number;
  points: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_win", name: "Erster Sieg", description: "Gewinne dein erstes Pflichtspiel.", icon: "🥇", xp: 50, points: 25 },
  { id: "clean_sheet", name: "Zu null", description: "Spiele ohne Gegentor.", icon: "🧤", xp: 40, points: 20 },
  { id: "goal_fest", name: "Torfestival", description: "Erziele fünf oder mehr Tore in einem Spiel.", icon: "🎉", xp: 80, points: 40 },
  { id: "streak_5", name: "Lauf", description: "Gewinne fünf Spiele in Folge.", icon: "🔥", xp: 120, points: 50 },
  { id: "streak_10", name: "Unaufhaltsam", description: "Gewinne zehn Spiele in Folge.", icon: "⚡", xp: 300, points: 120 },
  { id: "unbeaten_15", name: "Bollwerk", description: "Bleibe 15 Spiele in Folge ungeschlagen.", icon: "🛡️", xp: 250, points: 100 },
  { id: "youth_debut", name: "Aus der eigenen Jugend", description: "Setze einen Spieler unter 19 in der Startelf ein.", icon: "🌱", xp: 60, points: 30 },
  { id: "first_signing", name: "Handschlag", description: "Verpflichte deinen ersten Spieler.", icon: "🤝", xp: 50, points: 25 },
  { id: "big_signing", name: "Königstransfer", description: "Verpflichte einen Spieler für mindestens 10 Mio. €.", icon: "💰", xp: 150, points: 60 },
  { id: "season_done", name: "Saison überstanden", description: "Schliesse deine erste Saison ab.", icon: "📅", xp: 100, points: 50 },
  { id: "promotion", name: "Aufstieg!", description: "Steige mit deinem Verein auf.", icon: "📈", xp: 400, points: 150 },
  { id: "cup_winner", name: "Pokalsieger", description: "Gewinne den Landespokal.", icon: "cup", xp: 450, points: 180 },
  { id: "champion", name: "Meister", description: "Gewinne eine Meisterschaft.", icon: "🏆", xp: 600, points: 250 },
  { id: "double_champion", name: "Titelverteidiger", description: "Werde zweimal Meister.", icon: "👑", xp: 800, points: 300 },
  { id: "objective_met", name: "Vorstand zufrieden", description: "Erfülle das Saisonziel des Vorstands.", icon: "✅", xp: 200, points: 80 },
  { id: "level_5", name: "Aufsteiger", description: "Erreiche Manager-Level 5.", icon: "⭐", xp: 0, points: 100 },
  { id: "level_10", name: "Etabliert", description: "Erreiche Manager-Level 10.", icon: "🌟", xp: 0, points: 200 },
  { id: "collector", name: "Sammler", description: "Sammle 25 Spielerkarten.", icon: "🃏", xp: 100, points: 50 },
  { id: "legendary_card", name: "Legendär", description: "Besitze eine legendäre Spielerkarte.", icon: "💎", xp: 150, points: 0 },
  { id: "login_7", name: "Treuer Manager", description: "Melde dich sieben Tage in Folge an.", icon: "📆", xp: 150, points: 70 },
  { id: "giant_killer", name: "Riesentöter", description: "Besiege einen Gegner, der mindestens 8 Stärkepunkte besser ist.", icon: "🗡️", xp: 150, points: 60 },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

export type MissionKind = "win_home" | "win_any" | "clean_sheet" | "score_3" | "youth_start" | "sign_player" | "set_tactic" | "renew_contract" | "scout_report" | "unbeaten";

export interface MissionDef {
  kind: MissionKind;
  name: string;
  description: string;
  xp: number;
  points: number;
}

export const MISSIONS: MissionDef[] = [
  { kind: "win_home", name: "Festung", description: "Gewinne ein Heimspiel.", xp: 60, points: 20 },
  { kind: "win_any", name: "Dreier", description: "Gewinne ein Spiel.", xp: 50, points: 15 },
  { kind: "clean_sheet", name: "Mauer", description: "Spiele zu null.", xp: 60, points: 20 },
  { kind: "score_3", name: "Offensivfeuer", description: "Erziele drei Tore in einem Spiel.", xp: 70, points: 25 },
  { kind: "youth_start", name: "Talentförderung", description: "Stelle einen Spieler unter 21 in die Startelf.", xp: 50, points: 15 },
  { kind: "sign_player", name: "Neuzugang", description: "Verpflichte einen Spieler.", xp: 60, points: 20 },
  { kind: "set_tactic", name: "Matchplan", description: "Passe deine Taktik an.", xp: 30, points: 10 },
  { kind: "renew_contract", name: "Langfristig planen", description: "Verlängere einen Vertrag.", xp: 40, points: 15 },
  { kind: "scout_report", name: "Talentsuche", description: "Lass einen Spieler scouten.", xp: 30, points: 10 },
  { kind: "unbeaten", name: "Ungeschlagen", description: "Verliere dein nächstes Spiel nicht.", xp: 40, points: 15 },
];

export interface MissionState {
  kind: MissionKind;
  done: boolean;
}

/** Drei Tagesmissionen pro Kalendertag (deterministisch pro Karriere). */
export function dailyMissions(careerSeed: number, date: string): MissionState[] {
  const rng = new Rng(seedFor(careerSeed, "missions", date));
  const pool = [...MISSIONS];
  rng.shuffle(pool);
  return pool.slice(0, 3).map((m) => ({ kind: m.kind, done: false }));
}

export const SKINS: { id: string; name: string; price: number; grass: [string, string]; lines: string }[] = [
  { id: "classic", name: "Klassisch", price: 0, grass: ["#2f7d3a", "#2a7134"], lines: "rgba(255,255,255,0.75)" },
  { id: "night", name: "Flutlicht", price: 150, grass: ["#1e4d2b", "#1a4426"], lines: "rgba(220,240,255,0.8)" },
  { id: "retro", name: "Retro", price: 200, grass: ["#6b8e3a", "#628334"], lines: "rgba(255,250,230,0.85)" },
  { id: "tactic", name: "Taktiktafel", price: 250, grass: ["#20303f", "#1c2a37"], lines: "rgba(255,255,255,0.55)" },
  { id: "snow", name: "Winterspiel", price: 300, grass: ["#dfe8ee", "#d3dee6"], lines: "rgba(200,30,30,0.7)" },
  { id: "gold", name: "Champions-Gold", price: 600, grass: ["#3b3420", "#332d1b"], lines: "rgba(240,200,90,0.9)" },
];

export const CARD_PACK = {
  price: 120,
  size: 3,
  /** Transparente Wahrscheinlichkeiten pro Karte. */
  odds: { common: 0.62, rare: 0.28, epic: 0.085, legendary: 0.015 } as Record<Rarity, number>,
};

export interface MatchOutcomeForXp {
  goalsFor: number;
  goalsAgainst: number;
  home: boolean;
  ratingDiff: number; // eigene Stärke minus Gegner
}

export function matchXp(o: MatchOutcomeForXp): number {
  const win = o.goalsFor > o.goalsAgainst;
  const draw = o.goalsFor === o.goalsAgainst;
  let xp = win ? 30 : draw ? 12 : 4;
  xp += o.goalsFor * 2;
  if (o.goalsAgainst === 0) xp += 6;
  if (win && o.ratingDiff < -5) xp += 20; // Überraschungssieg
  return xp;
}

/** Login-Serie: Bonus an Meilensteinen. */
export function streakReward(days: number): { points: number; trainingBoost: number } | null {
  if (days === 3) return { points: 30, trainingBoost: 0 };
  if (days === 7) return { points: 80, trainingBoost: 2 };
  if (days === 14) return { points: 150, trainingBoost: 3 };
  if (days > 0 && days % 30 === 0) return { points: 300, trainingBoost: 4 };
  return null;
}
