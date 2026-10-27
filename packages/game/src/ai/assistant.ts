/**
 * Co-Trainer-Chat: Du fragst, dein Co-Trainer antwortet auf Basis der echten
 * Daten deiner Karriere (Tabelle, Form, Kader, Finanzen, nächster Gegner).
 */
import { SQUAD_STATUS_LABEL, formatMoney, squadRanks, wageBill } from "@fl/sim";
import { one, pool, query } from "../db";
import { readCareer } from "../career";
import { GameError } from "../errors";
import { staffSender } from "../news";
import { getClub, getPlayers, type CareerRow, type FixtureRow } from "../repo";
import { standings } from "../views/common";
import { philosophyLabel } from "../philosophy";
import { STYLE_RULES, aiStatus, generate } from "./claude";

export const QUESTION_MAX = 500;
const HISTORY = 12;

interface ChatMessage { role: "user" | "assistant"; content: string; at: string }

async function history(careerId: string): Promise<ChatMessage[]> {
  return (await one<{ messages: ChatMessage[] }>(pool(), "select messages from ai_chats where career_id = $1", [careerId]))?.messages ?? [];
}

export const assistantSystem = (coach: string, club: string) => `Du bist ${coach}, Co-Trainer von ${club} im Fussballmanager-Spiel "Football Legacy". Der Spieler ist dein Cheftrainer und fragt dich um Rat.
Antworte kurz und konkret (höchstens 130 Wörter), wie ein erfahrener Co-Trainer im Gespräch: mit Bezug auf die Daten, mit klaren Empfehlungen, aber die Entscheidung trifft der Cheftrainer.
Wenn die Daten eine Frage nicht beantworten, sag das ehrlich. Bei Fragen ausserhalb des Spiels lenkst du freundlich zurück zum Fussball.
Nutze keine Überschriften oder Tabellen, höchstens eine kurze Aufzählung.
${STYLE_RULES}`;

/** Aktuelle Lage des Vereins als kompakter Text für Claude. */
export async function careerContext(career: CareerRow): Promise<string> {
  const club = (await getClub(pool(), career.id, career.club_id!))!;
  const squad = (await getPlayers(pool(), career.id, [club.id])).filter((p) => !p.loan || p.clubId === club.id);
  const table = await standings(career, club.league_id);
  const pos = table.rows.find((r) => r.clubId === club.id);
  const lines: string[] = [`Datum: Saison ${career.season}/${String((career.season + 1) % 100).padStart(2, "0")}, Spieltag ${career.week}`];
  lines.push(`Verein: ${club.name}, Stärke ${club.rating}, Tabellenplatz ${pos?.position ?? "?"} von ${table.rows.length} (${pos?.points ?? 0} Punkte, Tore ${pos?.goalsFor ?? 0}:${pos?.goalsAgainst ?? 0})`);
  const near = table.rows.filter((r) => Math.abs(r.position - (pos?.position ?? 1)) <= 2 || r.position <= 2);
  lines.push(`Tabellenausschnitt: ${near.map((r) => `${r.position}. ${r.club.name} ${r.points}`).join(", ")}`);
  const recent = await query<FixtureRow>(pool(),
    "select * from fixtures where career_id = $1 and season = $2 and played and $3 in (home_id, away_id) order by week desc limit 5", [career.id, career.season, club.id]);
  const names = new Map([...table.clubs.values()].map((c) => [c.id, c.name]));
  if (recent.length) lines.push(`Letzte Spiele: ${recent.map((f) => `${names.get(f.home_id) ?? "?"} ${f.home_goals}:${f.away_goals} ${names.get(f.away_id) ?? "?"}`).join("; ")}`);
  const next = await one<FixtureRow>(pool(),
    "select * from fixtures where career_id = $1 and season = $2 and not played and $3 in (home_id, away_id) order by week limit 1", [career.id, career.season, club.id]);
  if (next) {
    const opp = await getClub(pool(), career.id, next.home_id === club.id ? next.away_id : next.home_id);
    if (opp) lines.push(`Nächster Gegner: ${opp.name} (${next.home_id === club.id ? "Heimspiel" : "Auswärts"}${next.cup_id ? ", Pokal" : ""}), Stärke ${opp.rating}, Spielidee ${philosophyLabel(opp.tactic?.style)} im ${opp.tactic?.formation ?? "4-4-2"}`);
  }
  if (club.tactic) lines.push(`Eigene Taktik: ${club.tactic.formation}, Spielidee ${philosophyLabel(club.tactic.style)}, Mentalität ${club.tactic.mentality ?? 0}`);
  const ranks = squadRanks(squad);
  const top = [...squad].sort((a, b) => (ranks.get(a.id) ?? 99) - (ranks.get(b.id) ?? 99)).slice(0, 18);
  lines.push("Kader (Position, Alter, Stärke, Form, Moral, Fitness, Vertrag bis, Status):");
  for (const p of top) {
    const notes = [p.injuryWeeks > 0 ? `verletzt ${p.injuryWeeks} W.` : "", p.transferRequest ? "Wechselwunsch" : "", p.precontract && p.precontract.clubId !== club.id ? "Vorvertrag woanders" : ""].filter(Boolean).join(", ");
    lines.push(`- ${p.firstName} ${p.lastName}: ${p.position}, ${p.age}, ${p.rating}, Form ${p.form.toFixed(1)}, Moral ${p.morale}, Fitness ${Math.round(p.fitness)}, bis ${(p.contract?.untilSeason ?? career.season) + 1}, ${p.squadStatus ? SQUAD_STATUS_LABEL[p.squadStatus] : "–"}${notes ? ` (${notes})` : ""}`);
  }
  const injured = squad.filter((p) => p.injuryWeeks > 0 && !top.includes(p));
  if (injured.length) lines.push(`Weitere Verletzte: ${injured.map((p) => `${p.lastName} (${p.injuryWeeks} W.)`).join(", ")}`);
  lines.push(`Finanzen: Kontostand ${formatMoney(club.balance)}, Transferbudget ${formatMoney(club.transfer_budget)}, Gehälter ${formatMoney(wageBill(squad))} von ${formatMoney(club.wage_budget)} pro Woche`);
  lines.push(`Vorstand: Vertrauen ${Math.round(career.board.confidence)} %, Ziel: ${career.board.objective}`);
  return `Aktuelle Daten (nur diese verwenden):\n${lines.join("\n")}`;
}

export async function assistantView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Ohne Verein gibt es keinen Co-Trainer.");
  const club = (await getClub(pool(), career.id, career.club_id))!;
  const coach = await staffSender(pool(), career, club, "coach");
  return { status: await aiStatus(accountId), coach: { name: coach.name, face: coach.face ?? null }, messages: await history(career.id) };
}

export async function askAssistant(careerId: string, accountId: string, question: string) {
  const text = question.trim().slice(0, QUESTION_MAX);
  if (!text) throw new GameError("Bitte stelle eine Frage.");
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Ohne Verein gibt es keinen Co-Trainer.");
  const club = (await getClub(pool(), career.id, career.club_id))!;
  const coach = await staffSender(pool(), career, club, "coach");
  const past = (await history(career.id)).slice(-HISTORY);
  const res = await generate({
    accountId, feature: "assistant", system: assistantSystem(coach.name, club.name), context: await careerContext(career),
    messages: [...past.map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content: text }],
    maxTokens: 2500,
  }, true);
  const now = new Date().toISOString();
  const messages = [...past, { role: "user" as const, content: text, at: now }, { role: "assistant" as const, content: res!.text.slice(0, 3000), at: now }].slice(-HISTORY * 2);
  await query(pool(), "insert into ai_chats(career_id, messages) values ($1,$2) on conflict (career_id) do update set messages = excluded.messages, updated_at = now()",
    [career.id, JSON.stringify(messages)]);
  return { reply: res!.text, messages };
}

export async function clearAssistant(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  await query(pool(), "delete from ai_chats where career_id = $1", [career.id]);
  return { ok: true };
}
