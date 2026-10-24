/**
 * Jugendakademie: eigener U19-Kader neben der ersten Mannschaft. Einmal im
 * Jahr kommt am Jugendtag ein neuer Jahrgang; die Talente entwickeln sich
 * wöchentlich und können hochgezogen oder freigegeben werden.
 */
import {
  Rng, dateOf, generatePlayer, seasonAging, seedFor, weeklyDevelopment,
  type Player, type Position, type SeasonCalendar,
} from "@fl/sim";
import type pg from "pg";
import { type Db, pool, query } from "./db";
import { readCareer, withCareer } from "./career";
import { GameError } from "./errors";
import { type CareerRow, addInbox, getClub, getPlayers, insertPlayers, saveCareer } from "./repo";
import { type RewardNote, announceNotes, awardCard } from "./rewards";
import { facilitiesOf } from "./facilities";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** Jugendtag: erster Montag nach 70 % der Saison. */
export function youthIntakeDay(cal: SeasonCalendar): number {
  const last = cal.slots.length ? cal.slots[cal.slots.length - 1].day : 200;
  let d = Math.round(last * 0.7);
  while (d % 7 !== 0) d++;
  return d;
}

export async function getAcademy(db: Db, careerId: string): Promise<Player[]> {
  const rows = await query<{ data: Player }>(db, "select data from academy where career_id = $1 order by id", [careerId]);
  return rows.map((r) => r.data);
}

async function saveAcademy(db: Db, careerId: string, players: Player[]) {
  for (const p of players) {
    await query(db, "insert into academy(career_id, id, data) values ($1,$2,$3) on conflict (career_id, id) do update set data = excluded.data", [careerId, p.id, JSON.stringify(p)]);
  }
}

/** Neuer Jahrgang: Anzahl und Qualität hängen von Jugendtrainer und Akademie ab. */
export async function runYouthIntake(db: pg.PoolClient, career: CareerRow): Promise<string | null> {
  if (!career.club_id) return null;
  const club = (await getClub(db, career.id, career.club_id))!;
  const fac = facilitiesOf(career);
  const rng = new Rng(seedFor(career.seed, "academy-intake", career.season));
  const count = Math.min(10, 4 + Math.floor(career.staff.youth / 6) + (fac.youth - 1));
  const positions: Position[] = ["GK", "DC", "DC", "DR", "DL", "DM", "MC", "MC", "AMC", "AMR", "AML", "ST", "ST", "MR", "ML"];
  const created: Player[] = [];
  let nextId = career.next_player_id;
  for (let i = 0; i < count; i++) {
    const p = generatePlayer(rng, {
      id: nextId++,
      clubId: club.id,
      nationality: club.country_code,
      position: i === 0 ? "GK" : rng.pick(positions),
      targetRating: Math.max(18, Math.min(62, Math.round(club.rating - 27 + rng.normal(0, 5) + career.staff.youth / 4 + fac.youth * 1.5))),
      age: rng.int(15, 16),
      season: career.season,
      reputation: club.reputation,
      youth: true,
    });
    p.contract = null;
    p.listed = false;
    created.push(p);
  }
  career.next_player_id = nextId;
  await saveAcademy(db, career.id, created);
  const notes: RewardNote[] = [];
  for (const p of created) if (p.wonderkid) awardCard(career, p, "Wunderkind aus der eigenen Jugend", notes, "epic");
  await saveCareer(db, career);
  await announceNotes(db, career, notes);
  const best = [...created].sort((a, b) => b.potential - a.potential)[0];
  await addInbox(db, career.id, career.season, career.week, "youth", "Jugendtag: Der neue Jahrgang ist da",
    `${created.length} Talente stossen zur Akademie:\n${created.map((p) => `• ${p.firstName} ${p.lastName} (${p.position}, ${p.age} J.)`).join("\n")}\n\n` +
      `Der Jugendkoordinator hält ${best.firstName} ${best.lastName} für das grösste Talent des Jahrgangs.` +
      (created.some((p) => p.wonderkid) ? "\nUnter den Neuen ist ein aussergewöhnliches Talent." : "") +
      "\n\nDie Einschätzungen findest du unter Team → Jugend.",
    { type: "academy" });
  return "Jugendtag";
}

/** Wöchentliches Training der Akademie (nur an Ligaspieltagen). */
export async function academyWeek(db: pg.PoolClient, career: CareerRow, rng: Rng) {
  const players = await getAcademy(db, career.id);
  if (!players.length) return;
  const fac = facilitiesOf(career);
  for (const p of players) {
    weeklyDevelopment(rng, p, { focus: "balanced", intensity: "normal", youthFocus: true }, {
      minutesLastWeek: 60, coachQuality: career.staff.youth + (fac.youth - 1) * 2, physioQuality: 8,
    });
  }
  await saveAcademy(db, career.id, players);
}

/** Saisonwechsel: Alterung; mit 20 Jahren endet die Zeit in der Akademie. */
export async function academySeasonEnd(db: pg.PoolClient, career: CareerRow, rng: Rng, newSeason: number) {
  const players = await getAcademy(db, career.id);
  if (!players.length) return;
  const leaving: Player[] = [];
  const lastYear: Player[] = [];
  for (const p of players) {
    seasonAging(rng, p);
    p.stats = { ...p.stats, apps: 0, goals: 0, assists: 0 };
    if (p.age >= 20) leaving.push(p);
    else if (p.age === 19) lastYear.push(p);
  }
  await saveAcademy(db, career.id, players.filter((p) => !leaving.includes(p)));
  if (leaving.length) {
    await query(db, "delete from academy where career_id = $1 and id = any($2::int[])", [career.id, leaving.map((p) => p.id)]);
    await addInbox(db, career.id, newSeason, 0, "youth", "Abschied aus der Akademie",
      `Diese Spieler sind zu alt für die Akademie und verlassen den Verein:\n${leaving.map((p) => `• ${p.firstName} ${p.lastName} (${p.position})`).join("\n")}`);
  }
  if (lastYear.length) {
    await addInbox(db, career.id, newSeason, 0, "youth", "Letztes Jahr in der Akademie",
      `Diese Talente sind 19 und müssen bis Saisonende hochgezogen werden, sonst verlassen sie den Verein:\n${lastYear.map((p) => `• ${p.firstName} ${p.lastName} (${p.position})`).join("\n")}`);
  }
}

/** Einschätzung des Jugendtrainers: je besser der Trainer, desto enger die Spanne. */
function estimate(career: CareerRow, p: Player) {
  const fac = facilitiesOf(career);
  const spread = Math.max(1, Math.round(7 - career.staff.youth / 3 - fac.youth / 2));
  const rng = new Rng(seedFor("academy-estimate", p.id, career.staff.youth));
  const r = p.rating + Math.round(rng.normal(0, spread / 2));
  const pot = p.potential + Math.round(rng.normal(0, spread));
  const mid = pot;
  return {
    ratingRange: [Math.max(1, r - spread), r + spread],
    potentialRange: [Math.min(95, Math.max(r, pot - spread * 2)), Math.min(99, pot + spread * 2)],
    stars: mid >= 80 ? 5 : mid >= 72 ? 4 : mid >= 64 ? 3 : mid >= 56 ? 2 : 1,
  };
}

export async function academyView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const players = await getAcademy(pool(), career.id);
  const fac = facilitiesOf(career);
  const intakeDay = career.calendar ? youthIntakeDay(career.calendar) : null;
  const intakeDate = intakeDay !== null ? dateOf(career.season, intakeDay) : null;
  return {
    career: { season: career.season, day: career.day, clubId: career.club_id },
    staffYouth: career.staff.youth,
    facilityYouth: fac.youth,
    nextIntake: intakeDay !== null && intakeDay > career.day && intakeDate
      ? { day: intakeDay, label: `${intakeDate.getUTCDate()}. ${MONTHS[intakeDate.getUTCMonth()]} ${intakeDate.getUTCFullYear()}` } : null,
    players: players
      .sort((a, b) => b.potential - a.potential)
      .map((p) => ({
        id: p.id, name: `${p.firstName} ${p.lastName}`, age: p.age, position: p.position, nationality: p.nationality, foot: p.foot,
        archetype: p.archetype, wonderkid: p.wonderkid, attrs: p.attrs, ...estimate(career, p),
      })),
  };
}

export async function promoteYouth(careerId: string, accountId: string, playerId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) throw new GameError("Kein Verein");
    const rows = await query<{ data: Player }>(db, "select data from academy where career_id = $1 and id = $2", [career.id, playerId]);
    const p = rows[0]?.data;
    if (!p) throw new GameError("Spieler nicht in der Akademie.");
    if (p.age < 16) throw new GameError("Spieler müssen mindestens 16 Jahre alt sein, um in die erste Mannschaft zu wechseln.");
    const squad = await getPlayers(db, career.id, [career.club_id]);
    if (squad.length >= 32) throw new GameError("Der Kader ist voll (max. 32 Spieler).");
    p.clubId = career.club_id;
    p.youth = true;
    p.contract = { wage: Math.max(300, Math.round(((p.rating - 25) * 45) / 100) * 100), untilSeason: career.season + 3, releaseClause: null, goalBonus: 0 };
    await insertPlayers(db, career.id, [p]);
    await query(db, "delete from academy where career_id = $1 and id = $2", [career.id, playerId]);
    await addInbox(db, career.id, career.season, career.week, "youth", `${p.firstName} ${p.lastName} rückt auf`,
      `${p.firstName} ${p.lastName} (${p.age}) unterschreibt seinen ersten Profivertrag bis ${p.contract.untilSeason}.`, { type: "player", playerId: p.id });
    return { message: `${p.firstName} ${p.lastName} gehört jetzt zur ersten Mannschaft.`, playerId: p.id };
  });
}

export async function releaseYouth(careerId: string, accountId: string, playerId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const r = await query(db, "delete from academy where career_id = $1 and id = $2 returning id", [career.id, playerId]);
    if (!r.length) throw new GameError("Spieler nicht in der Akademie.");
    return { message: "Der Spieler verlässt die Akademie." };
  });
}
