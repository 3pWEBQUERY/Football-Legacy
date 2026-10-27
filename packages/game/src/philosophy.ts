/**
 * Spielideen der KI-Trainer: Jeder neue Trainer bringt Formation und Stil
 * mit. Ein Trainerwechsel stellt die Mannschaft also tatsächlich um.
 */
import { Rng, STYLE_PRESETS, defaultTactic, seedFor, type Formation, type Tactic, type TacticStyle } from "@fl/sim";
import { type Db } from "./db";
import { getClub, getPlayers, saveClubs, type CareerRow } from "./repo";

export interface Philosophy { preset: string; formation: Formation }

const FORMATIONS: Formation[] = ["4-4-2", "4-3-3", "4-2-3-1", "4-1-4-1", "3-5-2", "4-4-1-1", "5-3-2", "3-4-3"];

/** Spielidee eines neuen Trainers; Spitzenvereine holen eher Ballbesitz- und Pressingtrainer. */
export function philosophyFor(seed: number, clubId: number, gen: number, rel: number): Philosophy {
  const rng = new Rng(seedFor(seed, "philosophy", clubId, gen));
  const presets = rel < 0.25 ? ["possession", "gegenpress", "tiki_taka", "high_press", "vertical_tiki", "wing_play"]
    : rel > 0.7 ? ["counter", "park_bus", "catenaccio", "route_one", "fluid_counter", "balanced"]
    : ["balanced", "wing_play", "counter", "gegenpress", "fluid_counter", "possession", "route_one"];
  const preset = rng.pick(presets);
  const defensive = ["park_bus", "catenaccio"].includes(preset);
  const formation = defensive ? rng.pick<Formation>(["5-3-2", "4-1-4-1", "4-4-1-1"]) : rng.pick(FORMATIONS.slice(0, 7));
  return { preset, formation };
}

/** Name der Spielidee, die einem Stil am nächsten kommt. */
export function philosophyLabel(style: TacticStyle | undefined): string {
  if (!style) return STYLE_PRESETS.balanced.name;
  let best = "balanced";
  let bestDist = Infinity;
  for (const [key, p] of Object.entries(STYLE_PRESETS)) {
    const d = (Object.keys(p.style) as (keyof TacticStyle)[]).reduce((s, k) => s + (p.style[k] - (style[k] ?? 50)) ** 2, 0);
    if (d < bestDist) { bestDist = d; best = key; }
  }
  return STYLE_PRESETS[best].name;
}

/** Neuer Trainer: Formation und Stil übernehmen (Aufstellung wählt die KI vor jedem Spiel neu). */
export async function applyPhilosophy(db: Db, career: CareerRow, clubId: number, ph: Philosophy): Promise<Tactic | null> {
  const club = await getClub(db, career.id, clubId);
  if (!club?.players_generated) return null;
  const squad = await getPlayers(db, career.id, [club.id]);
  const preset = STYLE_PRESETS[ph.preset] ?? STYLE_PRESETS.balanced;
  club.tactic = { ...defaultTactic(squad, ph.formation, { ...preset.style }), mentality: preset.mentality ?? 0 };
  await saveClubs(db, career.id, [club]);
  return club.tactic;
}
