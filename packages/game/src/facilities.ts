/**
 * Vereinsanlagen und Anfragen an den Vorstand: Transferbudget, Ausbau von
 * Trainingszentrum, Jugendakademie und Stadion. Bauprojekte dauern einige
 * Wochen und werden täglich geprüft.
 */
import { dateOf, formatMoney } from "@fl/sim";
import type pg from "pg";
import { query } from "./db";
import { readCareer, withCareer } from "./career";
import { GameError } from "./errors";
import { type CareerRow, type ClubRow, addFinance, addInbox, getClub, saveCareer, saveClubs } from "./repo";
import { pool } from "./db";

export type ProjectKind = "training" | "youth" | "stadium";
export type RequestKind = "budget" | ProjectKind;

export interface Project {
  kind: ProjectKind;
  /** Saison und Tag der Fertigstellung */
  season: number;
  done: number;
  /** Neue Stufe bzw. zusätzliche Plätze */
  target: number;
}

export interface Facilities {
  training: number;
  youth: number;
  projects: Project[];
  /** Letzte Anfrage je Art (für die Wartezeit) */
  requests: Partial<Record<RequestKind, { season: number; day: number }>>;
}

export function facilitiesOf(career: CareerRow): Facilities {
  const f = career.facilities;
  return { training: f?.training ?? 1, youth: f?.youth ?? 1, projects: f?.projects ?? [], requests: f?.requests ?? {} };
}

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const fmtDay = (season: number, day: number) => {
  const d = dateOf(season, day);
  return `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const COOLDOWN: Record<RequestKind, number> = { budget: 60, training: 21, youth: 21, stadium: 60 };
const LEVEL_TEXT: Record<"training" | "youth", string[]> = {
  training: ["Einfacher Trainingsplatz", "Ordentliches Trainingsgelände", "Modernes Trainingszentrum", "Leistungszentrum", "Spitzenzentrum mit Sportwissenschaft"],
  youth: ["Jugendabteilung", "Nachwuchsleistungszentrum", "Akademie mit Internat", "Elite-Akademie", "Weltklasse-Akademie"],
};

interface Offer {
  kind: RequestKind;
  title: string;
  description: string;
  cost: number;
  amount: number;
  days: number;
  available: boolean;
  reason: string | null;
}

function lastSlotDay(career: CareerRow) {
  const s = career.calendar?.slots ?? [];
  return s.length ? s[s.length - 1].day : 200;
}

function offers(career: CareerRow, club: ClubRow): Offer[] {
  const fac = facilitiesOf(career);
  const tv = club.finance?.tvWeekly ?? 50_000;
  const conf = career.board.confidence;
  const spare = club.balance - career.board.financeTarget;
  const waiting = (kind: RequestKind) => {
    const r = fac.requests[kind];
    if (!r) return null;
    const passed = r.season === career.season ? career.day - r.day : 999;
    return passed < COOLDOWN[kind] ? COOLDOWN[kind] - passed : null;
  };
  const running = (kind: ProjectKind) => fac.projects.find((p) => p.kind === kind);
  const list: Offer[] = [];

  const budget = Math.max(250_000, Math.round((club.balance * 0.1) / 10_000) * 10_000);
  list.push({
    kind: "budget", title: "Transferbudget erhöhen",
    description: `Der Vorstand gibt ${formatMoney(budget)} aus dem Vereinsvermögen für Transfers frei.`,
    cost: 0, amount: budget, days: 0, available: false, reason: null,
  });
  for (const kind of ["training", "youth"] as const) {
    const level = fac[kind];
    list.push({
      kind, title: kind === "training" ? "Trainingszentrum ausbauen" : "Jugendakademie ausbauen",
      description: level >= 5 ? "Höchste Stufe erreicht." : `Stufe ${level + 1}: ${LEVEL_TEXT[kind][level]}. ${kind === "training" ? "Bessere Entwicklung aller Profis." : "Grössere und stärkere Jahrgänge, bessere Entwicklung der Talente."}`,
      cost: Math.round((tv * 15 * level) / 10_000) * 10_000, amount: level + 1, days: 42 + level * 14, available: false, reason: null,
    });
  }
  const seats = Math.max(2000, Math.round((club.capacity * 0.15) / 500) * 500);
  list.push({
    kind: "stadium", title: "Stadion ausbauen",
    description: `${seats.toLocaleString("de-CH")} zusätzliche Plätze (heute ${club.capacity.toLocaleString("de-CH")}). Mehr Zuschauer, mehr Ticketeinnahmen.`,
    cost: seats * 1800, amount: seats, days: 150, available: false, reason: null,
  });

  for (const o of list) {
    const wait = waiting(o.kind);
    if (wait) o.reason = `Der Vorstand möchte erst in ${wait} Tagen wieder darüber sprechen.`;
    else if (o.kind !== "budget" && running(o.kind)) o.reason = "Der Ausbau läuft bereits.";
    else if ((o.kind === "training" || o.kind === "youth") && fac[o.kind] >= 5) o.reason = "Höchste Stufe erreicht.";
    else if (o.kind === "budget" && conf < 55) o.reason = "Dafür ist das Vertrauen des Vorstands zu gering (mindestens 55 %).";
    else if (o.kind === "stadium" && conf < 60) o.reason = "Dafür ist das Vertrauen des Vorstands zu gering (mindestens 60 %).";
    else if (o.kind !== "budget" && o.kind !== "stadium" && conf < 50) o.reason = "Dafür ist das Vertrauen des Vorstands zu gering (mindestens 50 %).";
    else if (o.kind === "stadium" && club.capacity > 25_000 + club.reputation * 800) o.reason = "Der Vorstand sieht beim aktuellen Zuschauerinteresse keinen Bedarf.";
    else if ((o.kind === "budget" ? o.amount : o.cost) > spare) o.reason = "Die Finanzen lassen das derzeit nicht zu.";
    o.available = !o.reason;
  }
  return list;
}

export async function boardView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Kein Verein");
  const club = (await getClub(pool(), career.id, career.club_id))!;
  const fac = facilitiesOf(career);
  return {
    board: career.board,
    club: { name: club.name, balance: club.balance, transferBudget: club.transfer_budget, capacity: club.capacity, reputation: club.reputation },
    facilities: {
      training: { level: fac.training, label: LEVEL_TEXT.training[fac.training - 1] },
      youth: { level: fac.youth, label: LEVEL_TEXT.youth[fac.youth - 1] },
    },
    projects: fac.projects.map((p) => ({
      ...p,
      label: p.kind === "stadium" ? `Stadionausbau (+${p.target.toLocaleString("de-CH")} Plätze)` : `${p.kind === "training" ? "Trainingszentrum" : "Jugendakademie"} Stufe ${p.target}`,
      doneLabel: fmtDay(p.season, p.done),
      daysLeft: p.season === career.season ? Math.max(0, p.done - career.day) : p.done + (lastSlotDay(career) - career.day),
    })),
    offers: offers(career, club),
  };
}

export async function boardRequest(careerId: string, accountId: string, kind: RequestKind) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) throw new GameError("Kein Verein");
    const club = (await getClub(db, career.id, career.club_id))!;
    const o = offers(career, club).find((x) => x.kind === kind);
    if (!o) throw new GameError("Unbekannte Anfrage");
    const fac = facilitiesOf(career);
    if (!o.available) {
      // Abgelehnte Anfragen: kurze Wartezeit, bevor erneut gefragt werden kann
      if (!o.reason?.startsWith("Der Vorstand möchte")) {
        fac.requests[kind] = { season: career.season, day: career.day - COOLDOWN[kind] + 14 };
        career.facilities = fac;
        await saveCareer(db, career);
      }
      return { status: "rejected", message: o.reason };
    }
    fac.requests[kind] = { season: career.season, day: career.day };
    if (kind === "budget") {
      club.transfer_budget += o.amount;
      await saveClubs(db, career.id, [club]);
      await addInbox(db, career.id, career.season, career.week, "board", "Vorstand erhöht das Transferbudget",
        `Der Vorstand stellt zusätzlich ${formatMoney(o.amount)} für Transfers bereit. Er erwartet, dass das Geld sinnvoll eingesetzt wird.`);
    } else {
      club.balance -= o.cost;
      await saveClubs(db, career.id, [club]);
      await addFinance(db, career.id, club.id, career.season, career.week, [{ kind: "other", amount: -o.cost, label: o.title }]);
      let done = career.day + o.days;
      let season = career.season;
      const last = lastSlotDay(career);
      if (done > last) {
        season += 1;
        done -= last;
      }
      fac.projects.push({ kind, season, done, target: o.amount });
      await addInbox(db, career.id, career.season, career.week, "board", `Vorstand genehmigt: ${o.title}`,
        `Der Vorstand hat den Ausbau genehmigt. Kosten: ${formatMoney(o.cost)}. Fertigstellung voraussichtlich am ${fmtDay(season, done)}.`);
    }
    career.facilities = fac;
    await saveCareer(db, career);
    return { status: "approved", message: kind === "budget" ? `Das Transferbudget steigt um ${formatMoney(o.amount)}.` : `${o.title}: genehmigt.` };
  });
}

/** Täglich: fertige Bauprojekte übernehmen. */
export async function checkProjects(db: pg.PoolClient, career: CareerRow): Promise<string[]> {
  const fac = facilitiesOf(career);
  const out: string[] = [];
  const due = fac.projects.filter((p) => career.season > p.season || (career.season === p.season && career.day >= p.done));
  if (!due.length || !career.club_id) return out;
  for (const p of due) {
    let text: string;
    if (p.kind === "stadium") {
      await query(db, "update clubs set capacity = capacity + $3 where career_id = $1 and id = $2", [career.id, career.club_id, p.target]);
      text = `Der Stadionausbau ist abgeschlossen. ${p.target.toLocaleString("de-CH")} zusätzliche Plätze stehen ab sofort zur Verfügung.`;
    } else {
      fac[p.kind] = p.target;
      text = `${p.kind === "training" ? "Das Trainingszentrum" : "Die Jugendakademie"} ist fertig: ${LEVEL_TEXT[p.kind][p.target - 1]} (Stufe ${p.target}).`;
    }
    await addInbox(db, career.id, career.season, career.week, "board", "Bauprojekt abgeschlossen", text);
    out.push("Bauprojekt abgeschlossen");
  }
  fac.projects = fac.projects.filter((p) => !due.includes(p));
  career.facilities = fac;
  return out;
}
