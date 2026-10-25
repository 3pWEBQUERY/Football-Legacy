/**
 * Mehrere Taktiken (bis zu drei) und taktische Vertrautheit. Die aktive Taktik
 * liegt wie bisher in clubs.tactic und wird in Spielen verwendet; Vertrautheit
 * wächst durch Training und Spiele und wirkt in der Engine.
 */
import type pg from "pg";
import { FORMATIONS, type Formation, type Tactic, type TacticStyle, STYLE_PRESETS, validateTactic } from "@fl/sim";
import { type Db, query } from "./db";
import { GameError } from "./errors";
import { withCareer } from "./career";
import { type CareerRow, type ClubRow, getClub, getPlayers, saveClubs } from "./repo";

export const MAX_TACTICS = 3;

export interface TacticsState {
  slots: { name: string; tactic: Tactic }[];
  active: number;
  /** Vertrautheit je Formation 0–100 */
  formation: Record<string, number>;
  /** Vertrautheit mit Spielweise und Mentalität 0–100 */
  style: number;
  styleRef: TacticStyle | null;
  mentalityRef: number;
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));

export function presetName(t: Tactic): string {
  const hit = Object.values(STYLE_PRESETS).find((p) => (Object.keys(p.style) as (keyof TacticStyle)[]).every((k) => p.style[k] === t.style[k]));
  return hit?.name ?? "Individuell";
}

export async function getTactics(db: Db, career: CareerRow, club: ClubRow | null): Promise<TacticsState> {
  const rows = await query<{ tactics: TacticsState | null }>(db, "select tactics from careers where id = $1", [career.id]);
  const st = rows[0]?.tactics;
  const current = club?.tactic ?? null;
  if (st && st.slots?.length) {
    // Die aktive Taktik ist immer die des Vereins (z. B. nach Änderungen im Spiel)
    if (current) st.slots[Math.min(st.active, st.slots.length - 1)].tactic = current;
    return st;
  }
  const formation: Record<string, number> = {};
  for (const f of Object.keys(FORMATIONS)) formation[f] = 30;
  if (current) formation[current.formation] = 70;
  return {
    slots: current ? [{ name: "Taktik 1", tactic: current }] : [],
    active: 0, formation, style: 70, styleRef: current?.style ?? null, mentalityRef: current?.mentality ?? 0,
  };
}

export async function saveTactics(db: Db, careerId: string, st: TacticsState) {
  await query(db, "update careers set tactics = $2 where id = $1", [careerId, JSON.stringify(st)]);
}

/** Gesamtvertrautheit der Taktik: Formation zählt etwas mehr als die Spielweise. */
export function familiarityOf(st: TacticsState, t: Tactic | null): { total: number; formation: number; style: number } {
  const formation = t ? st.formation[t.formation] ?? 30 : 0;
  const style = st.style;
  return { total: Math.round(formation * 0.6 + style * 0.4), formation: Math.round(formation), style: Math.round(style) };
}

export async function userFamiliarity(db: Db, career: CareerRow, club: ClubRow): Promise<number> {
  const st = await getTactics(db, career, club);
  return familiarityOf(st, club.tactic).total;
}

/** Neue Regler/Mentalität kosten Vertrautheit (je stärker die Änderung, desto mehr). */
export function applyStyleChange(st: TacticsState, t: Tactic) {
  if (st.styleRef) {
    const keys = Object.keys(t.style) as (keyof TacticStyle)[];
    const diff = keys.reduce((s, k) => s + Math.abs((t.style[k] ?? 50) - (st.styleRef![k] ?? 50)), 0) / keys.length;
    const ment = Math.abs((t.mentality ?? 0) - (st.mentalityRef ?? 0));
    st.style = clamp(Math.max(20, st.style - diff * 0.9 - ment * 4));
  }
  st.styleRef = { ...t.style };
  st.mentalityRef = t.mentality ?? 0;
}

/** Täglich: Training festigt die aktive Taktik, ungenutzte Formationen verblassen langsam. */
export async function familiarityTick(db: pg.PoolClient, career: CareerRow, kind: "training" | "match" | "rest") {
  if (!career.club_id || kind === "rest") return;
  const club = await getClub(db, career.id, career.club_id);
  if (!club?.tactic) return;
  const st = await getTactics(db, career, club);
  const active = club.tactic.formation;
  const coach = 0.8 + (career.staff?.coach ?? 3) / 20; // besserer Trainerstab lernt schneller
  for (const f of Object.keys(st.formation)) {
    if (f === active) st.formation[f] = clamp(st.formation[f] + (kind === "match" ? 2.5 : 1.4) * coach);
    else st.formation[f] = clamp(Math.max(20, st.formation[f] - 0.15));
  }
  st.style = clamp(st.style + (kind === "match" ? 1.8 : 1.0) * coach);
  await saveTactics(db, career.id, st);
}

// ------------------------------------------------------------ Aktionen

export async function tacticSlotAction(careerId: string, accountId: string, input: { action: string; index?: number; name?: string }) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) throw new GameError("Kein Verein");
    if (career.pending_match) throw new GameError("Während eines laufenden Spiels nicht möglich.");
    const club = (await getClub(db, career.id, career.club_id))!;
    const squad = await getPlayers(db, career.id, [club.id]);
    const st = await getTactics(db, career, club);
    const i = Math.round(Number(input.index ?? st.active));
    if (input.action === "add") {
      if (st.slots.length >= MAX_TACTICS) throw new GameError(`Höchstens ${MAX_TACTICS} Taktiken`);
      const base = st.slots[st.active]?.tactic ?? club.tactic;
      if (!base) throw new GameError("Keine Taktik vorhanden");
      st.slots.push({ name: `Taktik ${st.slots.length + 1}`, tactic: structuredClone(base) });
      st.active = st.slots.length - 1;
    } else if (input.action === "select") {
      if (!st.slots[i]) throw new GameError("Unbekannte Taktik");
      st.active = i;
    } else if (input.action === "delete") {
      if (st.slots.length <= 1) throw new GameError("Die letzte Taktik kann nicht gelöscht werden.");
      if (!st.slots[i]) throw new GameError("Unbekannte Taktik");
      st.slots.splice(i, 1);
      st.active = Math.min(st.active === i ? 0 : st.active > i ? st.active - 1 : st.active, st.slots.length - 1);
    } else if (input.action === "rename") {
      const name = (input.name ?? "").trim().slice(0, 30);
      if (name.length < 1) throw new GameError("Name fehlt");
      if (!st.slots[i]) throw new GameError("Unbekannte Taktik");
      st.slots[i].name = name;
    } else throw new GameError("Unbekannte Aktion");
    const chosen = validateTactic(st.slots[st.active].tactic, squad);
    if (!FORMATIONS[chosen.formation as Formation]) throw new GameError("Unbekannte Formation");
    club.tactic = chosen;
    st.slots[st.active].tactic = chosen;
    // Wechsel zwischen bekannten Taktiken kostet keine Stil-Vertrautheit, nur die Formation zählt
    st.styleRef = { ...chosen.style };
    st.mentalityRef = chosen.mentality ?? 0;
    await saveClubs(db, career.id, [club]);
    await saveTactics(db, career.id, st);
    return { message: input.action === "add" ? "Neue Taktik angelegt" : input.action === "delete" ? "Taktik gelöscht" : input.action === "rename" ? "Umbenannt" : `${st.slots[st.active].name} ist aktiv` };
  });
}
