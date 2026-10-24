/** Medizinische Abteilung: Verletzte mit Rückkehrdatum und Verletzungsrisiko. */
import { dateOf } from "@fl/sim";
import { pool } from "./db";
import { readCareer } from "./career";
import { GameError } from "./errors";
import { getClub, getPlayers } from "./repo";

const iso = (season: number, day: number) => dateOf(season, day).toISOString().slice(0, 10);

export async function medicalView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Kein Verein");
  const squad = await getPlayers(pool(), career.id, [career.club_id]);
  const injured = squad
    .filter((p) => p.injuryWeeks > 0)
    .sort((a, b) => b.injuryWeeks - a.injuryWeeks)
    .map((p) => ({
      id: p.id, name: `${p.firstName} ${p.lastName}`, age: p.age, nationality: p.nationality, position: p.position, rating: p.rating,
      injury: p.injury?.name ?? "Verletzung",
      since: p.injury ? iso(p.injury.season, p.injury.day) : null,
      weeksLeft: p.injuryWeeks,
      expectedReturn: iso(career.season, career.day + p.injuryWeeks * 7),
      longTerm: p.injuryWeeks >= 8,
    }));
  const intensity = career.training.intensity;
  const risk = squad
    .filter((p) => p.injuryWeeks === 0)
    .map((p) => {
      let score = 0;
      const reasons: string[] = [];
      if (p.fitness < 70) { score += 3; reasons.push(`Kondition ${p.fitness} %`); }
      else if (p.fitness < 80) { score += 1; reasons.push(`Kondition ${p.fitness} %`); }
      if (p.age >= 31) { score += 1; reasons.push(`${p.age} Jahre`); }
      if (p.attrs.stamina <= 9) { score += 1; reasons.push("geringe Ausdauer"); }
      if (intensity === "high") score += 1;
      return { id: p.id, name: `${p.firstName} ${p.lastName}`, age: p.age, nationality: p.nationality, position: p.position, fitness: p.fitness, score, reasons };
    })
    .filter((r) => r.score >= 2 && r.reasons.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((r) => ({ ...r, level: r.score >= 4 ? "hoch" : r.score >= 3 ? "erhöht" : "mittel" }));
  const club = await getClub(pool(), career.id, career.club_id);
  return {
    kit: club?.colors ?? null,
    physio: career.staff.physio,
    intensity,
    squadSize: squad.length,
    available: squad.filter((p) => p.injuryWeeks === 0 && p.suspendedWeeks === 0).length,
    suspended: squad.filter((p) => p.suspendedWeeks > 0).map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, age: p.age, nationality: p.nationality, position: p.position, matches: p.suspendedWeeks })),
    injured,
    risk,
  };
}
