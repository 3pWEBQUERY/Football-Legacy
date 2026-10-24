/**
 * Tageweiser Spielablauf: Erholung, Testspiele, Trainingseindrücke,
 * Spielvorbereitung und Monatsberichte zwischen den Spieltagen.
 */
import {
  DAY_TYPE_LABEL, Rng, dailyRecovery, dateOf, dayType, formatMoney, playMatch, seedFor, squadRanks, validateTactic,
  type DayType, type Player, type SeasonCalendar,
} from "@fl/sim";
import type pg from "pg";
import { windowFor } from "./window";
import { type Db, query } from "./db";
import { type CareerRow, type FixtureRow, addInbox, getClub, getClubs, getPlayers, saveCareer, savePlayers } from "./repo";
import { aiTactic, teamSetup } from "./setup";
import { competitionOf } from "./cup";
import { checkPromises } from "./talk";

export interface DayResult {
  day: number;
  type: DayType;
  label: string;
  events: string[];
}

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function fmt(season: number, day: number) {
  const d = dateOf(season, day);
  return `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]}`;
}

/** Tage mit eigenen Pflichtspielen dieser Saison → Spiel. */
export async function userMatchDays(db: Db, career: CareerRow): Promise<Map<number, FixtureRow>> {
  const out = new Map<number, FixtureRow>();
  if (!career.club_id || !career.calendar) return out;
  const rows = await query<FixtureRow>(
    db, "select * from fixtures where career_id = $1 and season = $2 and $3 in (home_id, away_id)", [career.id, career.season, career.club_id],
  );
  for (const f of rows) {
    const slot = career.calendar.slots[f.week - 1];
    if (slot) out.set(slot.day, f);
  }
  return out;
}

/** Tag der nächsten zu verarbeitenden Spielrunde. */
export function nextSlotDay(career: CareerRow): number | null {
  return career.calendar?.slots[career.week]?.day ?? null;
}

export async function advanceDay(db: pg.PoolClient, career: CareerRow): Promise<DayResult> {
  career.day += 1;
  await query(db, "update careers set day = $2 where id = $1", [career.id, career.day]);
  const cal = career.calendar as SeasonCalendar;
  const day = career.day;
  const fixtures = await userMatchDays(db, career);
  const type = dayType(cal, day, new Set(fixtures.keys()));
  const events: string[] = [];
  if (!career.club_id) return { day, type, label: DAY_TYPE_LABEL[type], events };

  const squad = await getPlayers(db, career.id, [career.club_id]);
  const rng = new Rng(seedFor(career.seed, "day", career.season, day));

  // Kondition: Regeneration und freie Tage erholen stärker
  const factor = type === "recovery" ? 1.6 : type === "off" || type === "holiday" ? 1.3 : type === "match" || type === "friendly" ? 0.4 : 1;
  for (const p of squad) dailyRecovery(p, career.training, career.staff.physio, factor);

  if (type === "friendly") events.push(await playFriendly(db, career, squad, rng));
  if (type === "training") {
    const e = await trainingEvent(db, career, squad, rng);
    if (e) events.push(e);
  }
  events.push(...(await completeScouting(db, career)));
  events.push(...(await checkPromises(db, career, squad)));
  const upcoming = fixtures.get(day + 2);
  if (upcoming && !upcoming.played) events.push(await opponentReport(db, career, upcoming, day + 2));

  const date = dateOf(career.season, day);
  if (date.getUTCDate() === 1) {
    const e = await monthlyReport(db, career, date);
    if (e) events.push(e);
  }
  if (cal.winterBreak && day === cal.winterBreak[0]) {
    await addInbox(db, career.id, career.season, career.week, "board", "Winterpause",
      "Die Hinrunde ist beendet. Die Mannschaft hat zwei Wochen frei, danach beginnt die Vorbereitung auf die Rückrunde. " +
        "Nutze die Zeit für Verträge und das Winter-Transferfenster.");
    events.push("Winterpause");
  }
  if (cal.winterBreak && day === cal.winterBreak[0] + 14) {
    await addInbox(db, career.id, career.season, career.week, "board", "Trainingsauftakt zur Rückrunde",
      "Die Spieler sind aus dem Urlaub zurück. Ab heute wird wieder trainiert.");
    events.push("Trainingsauftakt");
  }
  // Transferfenster: Öffnung, Woche vor Schluss, Deadline Day
  const win = windowFor(career, day);
  if (win.open && !windowFor(career, day - 1).open) {
    await addInbox(db, career.id, career.season, career.week, "transfer", `${win.label} geöffnet`,
      `Ab heute sind wieder Transfers und Leihen möglich. Das Fenster schliesst am ${fmt(career.season, win.closes!)}.`);
    events.push(`${win.label} geöffnet`);
  } else if (win.open && win.closes === day + 7) {
    await addInbox(db, career.id, career.season, career.week, "transfer", "Transferfenster: noch eine Woche",
      `Das ${win.label} schliesst am ${fmt(career.season, win.closes)}. Prüfe deinen Kader und offene Verhandlungen.`);
  } else if (win.open && win.closes === day) {
    await addInbox(db, career.id, career.season, career.week, "transfer", "Deadline Day",
      "Heute ist der letzte Tag des Transferfensters. Ab morgen sind keine Transfers mehr möglich.");
    events.push("Deadline Day");
  }

  await savePlayers(db, career.id, squad);
  await saveCareer(db, career);
  return { day, type, label: DAY_TYPE_LABEL[type], events };
}

/** Testspiel in der Vorbereitung: keine Statistik, aber Spielpraxis und Eindrücke. */
async function playFriendly(db: pg.PoolClient, career: CareerRow, squad: Player[], rng: Rng): Promise<string> {
  const own = (await getClub(db, career.id, career.club_id!))!;
  const first = career.calendar!.friendlies[0] === career.day;
  const pool = await getClubs(db, career.id, "players_generated and id <> $2 and country_code = $3 and rating between $4 and $5",
    [own.id, own.country_code, own.rating - (first ? 14 : 6), own.rating + (first ? -3 : 4)]);
  const fallback = pool.length ? pool : await getClubs(db, career.id, "players_generated and id <> $2 and country_code = $3", [own.id, own.country_code]);
  const opp = fallback[rng.int(0, fallback.length - 1)];
  const oppSquad = await getPlayers(db, career.id, [opp.id]);
  const ownTactic = own.tactic ? validateTactic(own.tactic, squad) : aiTactic(own, squad);
  const home = rng.chance(0.5);
  const ownSetup = teamSetup(own, squad, ownTactic, true);
  const oppSetup = teamSetup(opp, oppSquad, aiTactic(opp, oppSquad), true);
  const r = playMatch({ seed: seedFor(career.seed, "friendly", career.season, career.day), home: home ? ownSetup : oppSetup, away: home ? oppSetup : ownSetup });
  const side = home ? 0 : 1;
  const byId = new Map(squad.map((p) => [p.id, p]));
  for (const line of r.players) {
    const p = byId.get(line.playerId);
    if (!p) continue;
    p.fitness = Math.max(30, Math.min(p.fitness, Math.round(line.staminaEnd + 15)));
    p.form = Math.round((p.form * 0.85 + line.rating * 0.15) * 10) / 10;
  }
  const scorers = r.events.filter((e) => e.type.includes("goal")).map((e) => `${e.minute}' ${e.playerName ?? ""} (${e.side === "home" ? (home ? own.short_name : opp.short_name) : home ? opp.short_name : own.short_name})`);
  const gf = side === 0 ? r.homeGoals : r.awayGoals;
  const ga = side === 0 ? r.awayGoals : r.homeGoals;
  const best = r.players.filter((l) => l.side === side).sort((a, b) => b.rating - a.rating)[0];
  const title = `Testspiel: ${home ? own.short_name : opp.short_name} ${r.homeGoals}:${r.awayGoals} ${home ? opp.short_name : own.short_name}`;
  await addInbox(db, career.id, career.season, career.week, "match", title,
    `${home ? own.name : opp.name} – ${home ? opp.name : own.name} ${r.homeGoals}:${r.awayGoals}\n\n` +
      (scorers.length ? `Tore:\n${scorers.map((s) => `• ${s}`).join("\n")}\n\n` : "Keine Tore.\n\n") +
      (best ? `Bester Spieler: ${best.name} (Note ${best.rating.toFixed(1)})\n` : "") +
      `${gf > ga ? "Ein gelungener Test." : gf === ga ? "Ein ausgeglichener Test." : "Der Trainerstab sieht noch Arbeit."} Testspiele zählen nicht in der Statistik, bringen aber Spielpraxis.`);
  return title;
}

/** Höchstens ein Ereignis pro Trainingstag. */
async function trainingEvent(db: pg.PoolClient, career: CareerRow, squad: Player[], rng: Rng): Promise<string | null> {
  const fit = squad.filter((p) => p.injuryWeeks === 0);
  if (!fit.length) return null;
  const intensity = career.training.intensity;
  const injuryChance = (intensity === "high" ? 0.05 : intensity === "low" ? 0.015 : 0.03) * (1.2 - career.staff.physio / 40);
  if (rng.chance(injuryChance)) {
    const p = fit[rng.int(0, fit.length - 1)];
    p.injuryWeeks = rng.chance(0.65) ? 1 : 2;
    await addInbox(db, career.id, career.season, career.week, "medical", `Verletzung im Training: ${p.firstName} ${p.lastName}`,
      `${p.firstName} ${p.lastName} hat sich im Training verletzt und fällt voraussichtlich ${p.injuryWeeks === 1 ? "eine Woche" : "zwei Wochen"} aus.` +
        (intensity === "high" ? "\n\nDie medizinische Abteilung weist auf die hohe Trainingsintensität hin." : ""));
    return `Verletzung: ${p.lastName}`;
  }
  if (rng.chance(0.05)) {
    const young = fit.filter((p) => p.age <= 23);
    const list = young.length && rng.chance(0.6) ? young : fit;
    const p = list[rng.int(0, list.length - 1)];
    p.morale = Math.min(100, p.morale + 6);
    p.form = Math.min(10, Math.round((p.form + 0.3) * 10) / 10);
    await addInbox(db, career.id, career.season, career.week, "training", `Trainingseindruck: ${p.firstName} ${p.lastName}`,
      `Der Co-Trainer berichtet: ${p.firstName} ${p.lastName} (${p.age}) zeigt im Training seit Tagen starke Leistungen und drängt sich für einen Einsatz auf.`);
    return `Trainingseindruck: ${p.lastName}`;
  }
  const ranks = squadRanks(squad);
  const unhappy = fit.filter((p) => p.morale < 30 && (ranks.get(p.id) ?? 30) <= 16);
  if (unhappy.length && rng.chance(0.15)) {
    const p = unhappy[rng.int(0, unhappy.length - 1)];
    await addInbox(db, career.id, career.season, career.week, "contract", `${p.firstName} ${p.lastName} ist unzufrieden`,
      `${p.firstName} ${p.lastName} hat um ein Gespräch gebeten. Er ist mit seiner Situation unzufrieden und erwartet mehr Einsatzzeit. ` +
        "Bleibt die Lage so, leidet die Stimmung in der Kabine. Ein Gespräch unter vier Augen kann helfen.", { type: "player", playerId: p.id });
    return `Unzufrieden: ${p.lastName}`;
  }
  return null;
}

/** Zwei Tage vor dem Spiel: Analyse des Gegners durch den Scout. */
async function opponentReport(db: pg.PoolClient, career: CareerRow, f: FixtureRow, matchDay: number): Promise<string> {
  const oppId = f.home_id === career.club_id ? f.away_id : f.home_id;
  const opp = (await getClub(db, career.id, oppId))!;
  const oppSquad = await getPlayers(db, career.id, [opp.id]);
  const key = [...oppSquad].filter((p) => p.injuryWeeks === 0).sort((a, b) => b.rating - a.rating).slice(0, 3);
  const recent = await query<FixtureRow>(
    db, "select * from fixtures where career_id = $1 and season = $2 and played and $3 in (home_id, away_id) order by week desc limit 5",
    [career.id, career.season, opp.id],
  );
  const form = recent.map((r) => {
    const gf = r.home_id === opp.id ? r.home_goals! : r.away_goals!;
    const ga = r.home_id === opp.id ? r.away_goals! : r.home_goals!;
    return gf > ga ? "S" : gf === ga ? "U" : "N";
  });
  const injured = oppSquad.filter((p) => p.injuryWeeks > 0).length;
  const d = dateOf(career.season, matchDay);
  const when = `${["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getUTCDay()]}, ${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]}`;
  const title = `Spielvorbereitung: ${opp.name}`;
  await addInbox(db, career.id, career.season, career.week, "match", title,
    `${(await competitionOf(db, f)).label} am ${when}, ${f.home_id === career.club_id ? "zu Hause" : "auswärts"}.\n\n` +
      `Formation: ${opp.tactic?.formation ?? "unbekannt"}\nStärke: ${opp.rating}\n` +
      `Form (letzte Spiele): ${form.length ? form.join(" ") : "noch keine Pflichtspiele"}\n` +
      `Ausfälle: ${injured === 0 ? "keine" : injured}\n\n` +
      `Schlüsselspieler:\n${key.map((p) => `• ${p.firstName} ${p.lastName} (${p.position}, ${p.age} Jahre)`).join("\n")}\n\n` +
      "Die Pressekonferenz findet am Spieltag vor dem Anpfiff statt.",
    { type: "fixture", fixtureId: f.id });
  return title;
}

/** Am Monatsersten: Einnahmen und Ausgaben des Vormonats. */
async function monthlyReport(db: pg.PoolClient, career: CareerRow, date: Date): Promise<string | null> {
  const cal = career.calendar!;
  const prevMonth = (date.getUTCMonth() + 11) % 12;
  const weeks = cal.slots.filter((s) => dateOf(career.season, s.day).getUTCMonth() === prevMonth && s.day < career.day).map((s) => s.week);
  if (!weeks.length || !career.club_id) return null;
  const rows = await query<{ income: string; expense: string }>(
    db,
    "select coalesce(sum(amount) filter (where amount > 0), 0) as income, coalesce(sum(amount) filter (where amount < 0), 0) as expense from finance_log where career_id = $1 and club_id = $2 and season = $3 and week = any($4::int[])",
    [career.id, career.club_id, career.season, weeks],
  );
  const income = Number(rows[0]?.income ?? 0);
  const expense = Number(rows[0]?.expense ?? 0);
  const club = (await getClub(db, career.id, career.club_id))!;
  const title = `Finanzbericht ${MONTHS[prevMonth]}`;
  await addInbox(db, career.id, career.season, career.week, "finance", title,
    `Einnahmen: ${formatMoney(income)}\nAusgaben: ${formatMoney(expense)}\nSaldo: ${formatMoney(income + expense)}\n\nKontostand: ${formatMoney(club.balance)}`);
  return title;
}

/** Fällige Scoutberichte abschliessen und in den Posteingang legen. */
async function completeScouting(db: pg.PoolClient, career: CareerRow): Promise<string[]> {
  const due = await query<{ player_id: number; report: Record<string, unknown> }>(
    db,
    `select player_id, report from shortlist where career_id = $1 and (report->>'pending')::boolean
       and ((report->>'due')::int <= $2 or (report->>'season')::int < $3)`,
    [career.id, career.day, career.season],
  );
  const out: string[] = [];
  for (const row of due) {
    const report: Record<string, unknown> = { ...row.report, pending: false };
    await query(db, "update shortlist set report = $3 where career_id = $1 and player_id = $2", [career.id, row.player_id, JSON.stringify(report)]);
    const pl = await query<{ data: Player; club_id: number | null }>(db, "select data, club_id from players where career_id = $1 and id = $2", [career.id, row.player_id]);
    if (!pl[0]) continue;
    const player = pl[0].data;
    const club = pl[0].club_id !== null ? await getClub(db, career.id, pl[0].club_id) : null;
    const title = `Scoutbericht: ${player.firstName} ${player.lastName}`;
    await addInbox(db, career.id, career.season, career.week, "scout", title,
      `${player.firstName} ${player.lastName} (${player.age}, ${player.position}) – ${club ? club.name : "vereinslos"}\n\n` +
        `Aktuelle Stärke: ${report.rating}\nPotenzial: ${report.potentialMin}–${report.potentialMax}\n\nEinschätzung: ${report.verdict}`,
      { type: "player", playerId: row.player_id });
    out.push(title);
  }
  return out;
}
