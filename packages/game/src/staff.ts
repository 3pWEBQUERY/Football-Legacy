/**
 * Trainerstab als Personen: Co-Trainer, Physiotherapeut, Chefscout und
 * Jugendtrainer mit Namen, Stärke, Gehalt und Vertrag. Neue Leute kommen vom
 * Personalmarkt; ihre Stärke bestimmt die Wirkung im Spiel (career.staff).
 */
import { COUNTRIES, COUNTRY_BY_CODE, NAME_POOLS, Rng, formatMoney, seedFor } from "@fl/sim";
import type pg from "pg";
import { type Db, pool, query } from "./db";
import { readCareer, withCareer } from "./career";
import { GameError } from "./errors";
import { addArticle } from "./media";
import { type CareerRow, type ClubRow, type Staff, addFinance, addInbox, getClub, saveCareer, saveClubs } from "./repo";

export type StaffRole = keyof Staff;
export const STAFF_ROLES: StaffRole[] = ["coach", "physio", "scout", "youth"];

export const ROLE_LABEL: Record<StaffRole, string> = { coach: "Co-Trainer", physio: "Physiotherapeut", scout: "Chefscout", youth: "Jugendtrainer" };
export const ROLE_EFFECT: Record<StaffRole, string> = {
  coach: "Beschleunigt die Entwicklung im Training und verbessert die Trainingsnoten.",
  physio: "Verkürzt Ausfallzeiten, beschleunigt die Erholung und senkt das Verletzungsrisiko.",
  scout: "Genauere Berichte, mehr Beobachtungen und schnellere Scouting-Aufträge.",
  youth: "Grössere und stärkere Jugendjahrgänge, genauere Talenteinschätzung.",
};
const TRAITS: Record<StaffRole, string[]> = {
  coach: ["Angriffstraining", "Abwehrtraining", "Fitness", "Taktik"],
  physio: ["Prävention", "Rehabilitation", "Sportwissenschaft"],
  scout: ["Spielerbeurteilung", "Potenzialeinschätzung", "Netzwerk"],
  youth: ["Talentförderung", "Menschenführung", "Disziplin"],
};
const STYLES = ["Methodiker", "Motivator", "Detailversessen", "Ruhiger Analytiker", "Fordernd", "Väterlicher Typ", "Innovativ", "Erfahrener Praktiker"];
/** Wirkung bei unbesetzter Stelle */
const VACANT_QUALITY = 3;

export interface StaffMember {
  id: number;
  role: StaffRole;
  name: string;
  age: number;
  nationality: string;
  quality: number;
  traits: Record<string, number>;
  style: string;
  wage: number;
  until: number;
  joined: number;
}

export interface StaffTeam {
  members: StaffMember[];
  market: { season: number; day: number; candidates: StaffMember[] };
  nextId: number;
}

const clampQ = (q: number) => Math.max(1, Math.min(20, Math.round(q)));

/** Wochengehalt nach Stärke und Ruf des Vereins */
export function staffWage(quality: number, reputation: number) {
  return Math.round(((quality * quality * 55 + 400) * (0.6 + reputation / 100)) / 100) * 100;
}

function makeMember(rng: Rng, id: number, role: StaffRole, quality: number, club: ClubRow, season: number): StaffMember {
  const home = rng.chance(0.65);
  const country = COUNTRY_BY_CODE[club.country_code];
  const pool = COUNTRIES.filter((c) => c.confed === country?.confed);
  const nationality = home || !pool.length ? club.country_code : pool[rng.int(0, pool.length - 1)].code;
  const names = NAME_POOLS[COUNTRY_BY_CODE[nationality]?.region ?? "en"] ?? NAME_POOLS.en;
  const q = clampQ(quality);
  const traits = Object.fromEntries(TRAITS[role].map((t) => [t, clampQ(q + rng.normal(0, 2.4))]));
  return {
    id, role, name: `${rng.pick(names.first)} ${rng.pick(names.last)}`, age: rng.int(31, 63), nationality, quality: q, traits,
    style: rng.pick(STYLES), wage: staffWage(q, club.reputation), until: season + rng.int(1, 3), joined: season,
  };
}

/** Bestehende Karrieren: Stab aus den bisherigen Stufen anlegen. */
function initialTeam(career: CareerRow, club: ClubRow): StaffTeam {
  const rng = new Rng(seedFor(career.seed, "staff-init", club.id));
  let id = 1;
  const members = STAFF_ROLES.map((role) => makeMember(rng, id++, role, career.staff[role] + rng.int(-2, 2), club, career.season));
  return { members, market: { season: -1, day: 0, candidates: [] }, nextId: id };
}

/** Wirkung des Stabs: Stärke der Personen, bei unbesetzter Stelle eine Notlösung. */
function sync(career: CareerRow, team: StaffTeam) {
  for (const role of STAFF_ROLES) career.staff[role] = team.members.find((m) => m.role === role)?.quality ?? VACANT_QUALITY;
}

async function teamOf(db: Db, career: CareerRow, club: ClubRow): Promise<StaffTeam> {
  const rows = await query<{ staff_team: StaffTeam | null }>(db, "select staff_team from careers where id = $1", [career.id]);
  return rows[0]?.staff_team ?? initialTeam(career, club);
}

async function saveTeam(db: Db, career: CareerRow, team: StaffTeam) {
  sync(career, team);
  await query(db, "update careers set staff_team = $2 where id = $1", [career.id, JSON.stringify(team)]);
}

/** Personalmarkt: vier Kandidaten je Rolle, alle vier Wochen neu. */
function refreshMarket(career: CareerRow, club: ClubRow, team: StaffTeam) {
  const m = team.market;
  if (m.season === career.season && career.day - m.day < 28 && m.candidates.length) return;
  const rng = new Rng(seedFor(career.seed, "staff-market", career.season, Math.floor(career.day / 28)));
  const candidates: StaffMember[] = [];
  const level = 4 + club.reputation / 9;
  for (const role of STAFF_ROLES) {
    const current = team.members.find((x) => x.role === role)?.quality ?? VACANT_QUALITY;
    const qs = [current + rng.int(1, 3), level + rng.normal(0, 2.5), level + rng.normal(1, 3), current + rng.normal(-1, 2.5)];
    for (const q of qs) candidates.push(makeMember(rng, team.nextId++, role, q, club, career.season));
  }
  team.market = { season: career.season, day: career.day, candidates };
}

/** Abfindung bei Entlassung: Restlaufzeit, höchstens ein halbes Jahresgehalt. */
function severance(member: StaffMember, season: number) {
  const weeks = Math.min(26, Math.max(4, (member.until - season) * 20 + 8));
  return member.wage * weeks;
}

/** Vereinsruf, den ein Kandidat mindestens erwartet. */
const requiredReputation = (quality: number) => Math.max(0, quality * 4 - 14);

export async function staffView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Kein Verein");
  const club = (await getClub(pool(), career.id, career.club_id))!;
  const team = await teamOf(pool(), career, club);
  const before = JSON.stringify(team.market);
  refreshMarket(career, club, team);
  if (JSON.stringify(team.market) !== before) await saveTeam(pool(), career, team);
  const view = (m: StaffMember) => ({
    ...m, roleLabel: ROLE_LABEL[m.role], faceId: 800_000 + m.id, severance: severance(m, career.season),
    requiredReputation: requiredReputation(m.quality), interested: club.reputation >= requiredReputation(m.quality),
  });
  return {
    season: career.season,
    club: { reputation: club.reputation, balance: club.balance, colors: club.colors, name: club.name },
    roles: STAFF_ROLES.map((role) => {
      const member = team.members.find((m) => m.role === role);
      return { role, label: ROLE_LABEL[role], effect: ROLE_EFFECT[role], member: member ? view(member) : null, effective: member?.quality ?? VACANT_QUALITY };
    }),
    candidates: team.market.candidates.map(view),
    marketRefresh: team.market.day + 28,
    weeklyTotal: team.members.reduce((s, m) => s + m.wage, 0),
  };
}

export async function hireStaff(careerId: string, accountId: string, candidateId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) throw new GameError("Kein Verein");
    const club = (await getClub(db, career.id, career.club_id))!;
    const team = await teamOf(db, career, club);
    refreshMarket(career, club, team);
    const cand = team.market.candidates.find((c) => c.id === candidateId);
    if (!cand) throw new GameError("Dieser Kandidat ist nicht mehr verfügbar.");
    if (club.reputation < requiredReputation(cand.quality)) {
      throw new GameError(`${cand.name} hält ${club.name} für zu klein (Vereinsruf mindestens ${requiredReputation(cand.quality)}).`);
    }
    const old = team.members.find((m) => m.role === cand.role);
    const pay = old ? severance(old, career.season) : 0;
    const signing = cand.wage * 4;
    if (club.balance < pay + signing) throw new GameError("Dafür reicht das Geld nicht.");
    club.balance -= pay + signing;
    if (club.finance) club.finance.staffWeekly = Math.max(0, club.finance.staffWeekly + cand.wage - (old?.wage ?? 0));
    await saveClubs(db, career.id, [club]);
    await addFinance(db, career.id, club.id, career.season, career.week, [
      { kind: "staff", amount: -signing, label: `Handgeld ${ROLE_LABEL[cand.role]} ${cand.name}` },
      ...(pay ? [{ kind: "staff" as const, amount: -pay, label: `Abfindung ${old!.name}` }] : []),
    ]);
    const hired: StaffMember = { ...cand, joined: career.season, until: career.season + 2 };
    team.members = [...team.members.filter((m) => m.role !== cand.role), hired];
    team.market.candidates = team.market.candidates.filter((c) => c.id !== cand.id);
    await saveTeam(db, career, team);
    await saveCareer(db, career);
    await addInbox(db, career.id, career.season, career.week, "board", `Neuer ${ROLE_LABEL[cand.role]}: ${cand.name}`,
      `${cand.name} (${cand.age}) übernimmt ab sofort als ${ROLE_LABEL[cand.role]}. Stärke ${cand.quality}/20, Gehalt ${formatMoney(cand.wage)} pro Woche, Vertrag bis ${hired.until}.` +
        (old ? `\n\n${old.name} verlässt den Verein (Abfindung ${formatMoney(pay)}).` : ""));
    await addArticle(db, career, { kind: "transfer", title: `${club.name} holt ${cand.name} als ${ROLE_LABEL[cand.role]}`, body: `${club.name} verstärkt den Trainerstab: ${cand.name} wird neuer ${ROLE_LABEL[cand.role]}.`, clubId: club.id, own: true });
    return { message: `${cand.name} ist dein neuer ${ROLE_LABEL[cand.role]}.` };
  });
}

export async function fireStaff(careerId: string, accountId: string, memberId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) throw new GameError("Kein Verein");
    const club = (await getClub(db, career.id, career.club_id))!;
    const team = await teamOf(db, career, club);
    const m = team.members.find((x) => x.id === memberId);
    if (!m) throw new GameError("Diese Person gehört nicht zum Stab.");
    const pay = severance(m, career.season);
    if (club.balance < pay) throw new GameError("Die Abfindung kann der Verein derzeit nicht zahlen.");
    club.balance -= pay;
    if (club.finance) club.finance.staffWeekly = Math.max(0, club.finance.staffWeekly - m.wage);
    await saveClubs(db, career.id, [club]);
    await addFinance(db, career.id, club.id, career.season, career.week, [{ kind: "staff", amount: -pay, label: `Abfindung ${m.name}` }]);
    team.members = team.members.filter((x) => x.id !== memberId);
    await saveTeam(db, career, team);
    await saveCareer(db, career);
    return { message: `${m.name} wurde entlassen (Abfindung ${formatMoney(pay)}). Die Stelle ist unbesetzt.` };
  });
}

export async function renewStaff(careerId: string, accountId: string, memberId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) throw new GameError("Kein Verein");
    const club = (await getClub(db, career.id, career.club_id))!;
    const team = await teamOf(db, career, club);
    const m = team.members.find((x) => x.id === memberId);
    if (!m) throw new GameError("Diese Person gehört nicht zum Stab.");
    if (m.until > career.season + 1) throw new GameError(`Der Vertrag von ${m.name} läuft noch bis ${m.until}.`);
    if (m.age >= 66) throw new GameError(`${m.name} geht in den Ruhestand und verlängert nicht mehr.`);
    const newWage = Math.round((m.wage * 1.1) / 100) * 100;
    if (club.finance) club.finance.staffWeekly += newWage - m.wage;
    await saveClubs(db, career.id, [club]);
    m.wage = newWage;
    m.until = Math.max(m.until, career.season) + 2;
    await saveTeam(db, career, team);
    await saveCareer(db, career);
    return { message: `${m.name} verlängert bis ${m.until} (${formatMoney(newWage)} pro Woche).` };
  });
}

/** Saisonwechsel: Alterung, auslaufende Verträge, Ruhestand. */
export async function staffSeasonEnd(db: pg.PoolClient, career: CareerRow) {
  if (!career.club_id) return;
  const club = await getClub(db, career.id, career.club_id);
  if (!club) return;
  const team = await teamOf(db, career, club);
  const leaving: StaffMember[] = [];
  for (const m of team.members) {
    m.age += 1;
    if (m.until < career.season || m.age >= 68) leaving.push(m);
  }
  if (leaving.length) {
    team.members = team.members.filter((m) => !leaving.includes(m));
    if (club.finance) {
      club.finance.staffWeekly = Math.max(0, club.finance.staffWeekly - leaving.reduce((s, m) => s + m.wage, 0));
      await saveClubs(db, career.id, [club]);
    }
    await addInbox(db, career.id, career.season, 0, "board", "Abgänge im Trainerstab",
      `Diese Mitarbeiter haben den Verein verlassen:\n${leaving.map((m) => `• ${m.name} (${ROLE_LABEL[m.role]}) – ${m.age >= 68 ? "Ruhestand" : "Vertrag ausgelaufen"}`).join("\n")}\n\nBesetze die Stellen unter Team → Stab neu.`);
  }
  await saveTeam(db, career, team);
}
