/** Hinweise des Co-Trainers vor dem Spiel: Ausfälle, Müdigkeit, Positionen, Alternativen. */
import { FORMATIONS, ratingForSlot, type Player, type Position } from "@fl/sim";
import type { Db } from "./db";
import { type CareerRow, getClub, getPlayers } from "./repo";

export interface Advice {
  level: "high" | "medium" | "low";
  text: string;
}

const POS: Record<string, string> = { GK: "TW", DR: "RV", DC: "IV", DL: "LV", DM: "DM", MR: "RM", MC: "ZM", ML: "LM", AMR: "RA", AMC: "ZOM", AML: "LA", ST: "ST" };

export async function assistantAdvice(db: Db, career: CareerRow): Promise<Advice[]> {
  if (!career.club_id) return [];
  const club = await getClub(db, career.id, career.club_id);
  if (!club) return [];
  const squad = await getPlayers(db, career.id, [club.id]);
  const out: Advice[] = [];
  const t = club.tactic;
  if (!t) return [{ level: "medium", text: "Du hast noch keine Aufstellung gespeichert. Der Co-Trainer stellt die Mannschaft selbst auf." }];
  const slots = FORMATIONS[t.formation];
  const byId = new Map(squad.map((p) => [p.id, p]));
  const starters = new Set(t.lineup.filter((x): x is number => x !== null));
  const available = (p: Player) => p.injuryWeeks === 0 && p.suspendedWeeks === 0;
  slots.forEach((slot, i) => {
    const id = t.lineup[i];
    const pos = slot.position as Position;
    if (id === null || !byId.has(id)) {
      out.push({ level: "high", text: `Die Position ${POS[pos]} ist nicht besetzt.` });
      return;
    }
    const p = byId.get(id)!;
    const name = `${p.firstName.charAt(0)}. ${p.lastName}`;
    if (p.injuryWeeks > 0) out.push({ level: "high", text: `${name} ist verletzt, steht aber in der Startelf (${POS[pos]}).` });
    else if (p.suspendedWeeks > 0) out.push({ level: "high", text: `${name} ist gesperrt, steht aber in der Startelf (${POS[pos]}).` });
    else {
      if (p.fitness < 75) out.push({ level: "medium", text: `${name} hat nur ${p.fitness} % Kondition.` });
      const here = ratingForSlot(p, pos);
      if (here < p.rating - 6) out.push({ level: "medium", text: `${name} spielt als ${POS[pos]} nicht auf seiner Position (Stärke dort ${here} statt ${p.rating}).` });
      if (p.morale < 30) out.push({ level: "low", text: `${name} ist unzufrieden – das kann seine Leistung drücken.` });
    }
    // Bessere Alternative auf dieser Position?
    const current = available(p) ? ratingForSlot(p, pos) : 0;
    const alt = squad
      .filter((x) => !starters.has(x.id) && available(x) && x.fitness >= 80)
      .map((x) => ({ x, r: ratingForSlot(x, pos) }))
      .sort((a, b) => b.r - a.r)[0];
    if (alt && alt.r >= current + 5) {
      out.push({ level: "low", text: `${alt.x.firstName.charAt(0)}. ${alt.x.lastName} wäre als ${POS[pos]} stärker (${alt.r} statt ${current}).` });
    }
  });
  const bench = t.bench.filter((id) => byId.has(id) && available(byId.get(id)!));
  if (bench.length < 5) out.push({ level: "low", text: `Nur ${bench.length} einsatzfähige Spieler auf der Bank.` });
  if (!bench.some((id) => byId.get(id)!.position === "GK")) out.push({ level: "low", text: "Kein Ersatztorhüter auf der Bank." });
  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]).slice(0, 8);
}
