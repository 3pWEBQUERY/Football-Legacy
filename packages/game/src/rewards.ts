/** Gamification auf Spielstand-Ebene: XP, Level, Erfolge, Missionen. */
import {
  ACHIEVEMENT_BY_ID, CARD_PACK, MISSIONS, type ManagerProfile, type MissionKind, type Player, type Rarity, Rng, UNLOCKS,
  dailyMissions, levelFromXp, rarityFor, seedFor, titleForLevel,
} from "@fl/sim";
import type { Db } from "./db";
import { addInbox, type CareerRow } from "./repo";
import { todayKey } from "./career";

export interface RewardNote {
  kind: "xp" | "level" | "achievement" | "mission" | "card" | "points";
  text: string;
  icon?: string;
}

export function ensureMissions(career: CareerRow) {
  const today = todayKey();
  if (career.manager.missions?.date !== today) {
    career.manager.missions = { date: today, items: dailyMissions(career.seed, today) };
  }
}

/** XP gutschreiben und Level-Ups melden. */
export function grantXp(career: CareerRow, xp: number, notes: RewardNote[]) {
  const m = career.manager;
  const before = m.level;
  m.xp += xp;
  m.level = levelFromXp(m.xp);
  if (xp > 0) notes.push({ kind: "xp", text: `+${xp} XP` });
  if (m.level > before) {
    notes.push({ kind: "level", text: `Level ${m.level} erreicht – ${titleForLevel(m.level)}!`, icon: "⭐" });
    for (const u of UNLOCKS.filter((x) => x.level > before && x.level <= m.level)) {
      notes.push({ kind: "level", text: `Freigeschaltet: ${u.name}`, icon: "🔓" });
    }
    if (m.level >= 5) unlockAchievement(career, "level_5", notes);
    if (m.level >= 10) unlockAchievement(career, "level_10", notes);
  }
}

export function unlockAchievement(career: CareerRow, id: string, notes: RewardNote[]) {
  const m = career.manager;
  if (m.achievements[id]) return;
  const def = ACHIEVEMENT_BY_ID[id];
  if (!def) return;
  m.achievements[id] = todayKey();
  m.points += def.points;
  notes.push({ kind: "achievement", text: `Erfolg freigeschaltet: ${def.name}`, icon: def.icon });
  if (def.xp) grantXp(career, def.xp, notes);
}

export function completeMission(career: CareerRow, kind: MissionKind, notes: RewardNote[]) {
  ensureMissions(career);
  const item = career.manager.missions.items.find((i) => i.kind === kind && !i.done);
  if (!item) return;
  item.done = true;
  const def = MISSIONS.find((m) => m.kind === kind)!;
  career.manager.points += def.points;
  notes.push({ kind: "mission", text: `Mission erfüllt: ${def.name} (+${def.points} MP)`, icon: "🎯" });
  grantXp(career, def.xp, notes);
}

/** Spielerkarte für die Sammlung (keine Duplikate pro Spieler). */
export function awardCard(career: CareerRow, p: Player, reason: string, notes: RewardNote[], rarityOverride?: Rarity) {
  const m = career.manager;
  if (m.cards.some((c) => c.playerId === p.id)) return false;
  const rarity = rarityOverride ?? rarityFor(p.rating, p.wonderkid);
  m.cards.push({
    playerId: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, rating: p.rating, nationality: p.nationality,
    rarity, season: career.season, reason,
  });
  notes.push({ kind: "card", text: `Neue Spielerkarte: ${p.firstName} ${p.lastName}`, icon: "🃏" });
  if (m.cards.length >= 25) unlockAchievement(career, "collector", notes);
  if (rarity === "legendary") unlockAchievement(career, "legendary_card", notes);
  return true;
}

/** Kartenpaket öffnen: zieht Karten mit transparenten Chancen aus der Spielwelt. */
export function openPack(career: CareerRow, pool: Player[], notes: RewardNote[]): { name: string; rarity: Rarity; rating: number }[] {
  const rng = new Rng(seedFor(career.seed, "pack", career.manager.cards.length, career.manager.points, Date.now()));
  const byRarity: Record<Rarity, Player[]> = { common: [], rare: [], epic: [], legendary: [] };
  for (const p of pool) byRarity[rarityFor(p.rating, p.wonderkid)].push(p);
  const odds = CARD_PACK.odds;
  const order: Rarity[] = ["common", "rare", "epic", "legendary"];
  const drawn: { name: string; rarity: Rarity; rating: number }[] = [];
  for (let i = 0; i < CARD_PACK.size; i++) {
    let rarity = order[rng.weighted(order.map((r) => odds[r]))];
    // Falls es keine Spieler dieser Seltenheit gibt, eine Stufe darunter
    while (!byRarity[rarity].filter((p) => !career.manager.cards.some((c) => c.playerId === p.id)).length && rarity !== "common") {
      rarity = order[order.indexOf(rarity) - 1];
    }
    const candidates = byRarity[rarity].filter((p) => !career.manager.cards.some((c) => c.playerId === p.id));
    if (!candidates.length) continue;
    const p = rng.pick(candidates);
    awardCard(career, p, "Kartenpaket", notes, rarity);
    drawn.push({ name: `${p.firstName} ${p.lastName}`, rarity, rating: p.rating });
  }
  return drawn;
}

export interface UserMatchInfo {
  goalsFor: number;
  goalsAgainst: number;
  home: boolean;
  ownRating: number;
  oppRating: number;
  starters: Player[];
}

/** Belohnungen nach einem eigenen Spiel. */
export function rewardMatch(career: CareerRow, info: UserMatchInfo, notes: RewardNote[]) {
  const m: ManagerProfile = career.manager;
  const win = info.goalsFor > info.goalsAgainst;
  const draw = info.goalsFor === info.goalsAgainst;
  m.totals.goals += info.goalsFor;
  m.totals.conceded += info.goalsAgainst;
  if (win) {
    m.totals.wins++;
    m.winStreak++;
    m.unbeaten++;
    m.bestWinStreak = Math.max(m.bestWinStreak, m.winStreak);
  } else if (draw) {
    m.totals.draws++;
    m.winStreak = 0;
    m.unbeaten++;
  } else {
    m.totals.losses++;
    m.winStreak = 0;
    m.unbeaten = 0;
  }
  let xp = win ? 30 : draw ? 12 : 4;
  xp += info.goalsFor * 2;
  if (info.goalsAgainst === 0) xp += 6;
  const diff = info.ownRating - info.oppRating;
  if (win && diff < -5) xp += 20;
  // Siegesserie: steigende Boni
  if (win && m.winStreak >= 3) xp += Math.min(30, m.winStreak * 3);
  grantXp(career, xp, notes);
  // Reputation des Managers
  m.reputation = Math.max(1, Math.min(100, m.reputation + (win ? 0.4 : draw ? 0.05 : -0.25) + (win && diff < -5 ? 0.5 : 0)));

  if (win) unlockAchievement(career, "first_win", notes);
  if (info.goalsAgainst === 0) unlockAchievement(career, "clean_sheet", notes);
  if (info.goalsFor >= 5) unlockAchievement(career, "goal_fest", notes);
  if (m.winStreak >= 5) unlockAchievement(career, "streak_5", notes);
  if (m.winStreak >= 10) unlockAchievement(career, "streak_10", notes);
  if (m.unbeaten >= 15) unlockAchievement(career, "unbeaten_15", notes);
  if (win && diff <= -8) unlockAchievement(career, "giant_killer", notes);
  if (info.starters.some((p) => p.age < 19)) unlockAchievement(career, "youth_debut", notes);

  if (win && info.home) completeMission(career, "win_home", notes);
  if (win) completeMission(career, "win_any", notes);
  if (info.goalsAgainst === 0) completeMission(career, "clean_sheet", notes);
  if (info.goalsFor >= 3) completeMission(career, "score_3", notes);
  if (!win && !draw) {
    // keine Mission
  } else {
    completeMission(career, "unbeaten", notes);
  }
  if (info.starters.some((p) => p.age < 21)) completeMission(career, "youth_start", notes);
  const youthStarters = info.starters.filter((p) => p.age <= 21).length;
  career.board.youthApps = (career.board.youthApps ?? 0) + youthStarters;
}

export async function announceNotes(db: Db, career: CareerRow, notes: RewardNote[]) {
  const important = notes.filter((n) => n.kind === "level" || n.kind === "achievement");
  if (!important.length) return;
  await addInbox(
    db, career.id, career.season, career.week, "career", important.length === 1 ? important[0].text : "Neue Erfolge und Freischaltungen",
    important.map((n) => `${n.icon ?? "•"} ${n.text}`).join("\n"),
  );
}
