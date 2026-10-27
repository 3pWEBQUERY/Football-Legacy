/**
 * Mannschaftsrat: Kapitän und die vier einflussreichsten Spieler. Ihre
 * Stimmung färbt auf die Kabine ab. Einmal im Monat trifft sich der Rat mit
 * dir und bringt ein Anliegen vor – deine Antwort wirkt auf die Moral.
 */
import { dateOf, hierarchy, playingTimeHappiness, defaultStatuses, statusOf, wageBill, type Player } from "@fl/sim";
import type pg from "pg";
import { type Db, one, pool, query } from "./db";
import { readCareer, withCareer } from "./career";
import { GameError } from "./errors";
import { addFinance, getClub, getPlayers, savePlayers, saveClubs, type CareerRow } from "./repo";
import { clubSender, send } from "./news";

export type CouncilTopic = "playing_time" | "training" | "results" | "bonus" | "contracts" | "harmony";
interface Option { key: string; label: string; text: string }
export interface Concern { topic: CouncilTopic; title: string; text: string; by: number; options: Option[]; season: number; day: number; playerIds: number[] }
interface CouncilState { month: string | null; pending: Concern | null; history: { season: number; day: number; topic: CouncilTopic; title: string; choice: string; outcome: string }[] }

/** Unbeantwortete Anliegen verfallen nach so vielen Tagen. */
export const CONCERN_DAYS = 14;
const clamp = (v: number) => Math.max(5, Math.min(100, Math.round(v)));

async function load(db: Db, careerId: string): Promise<CouncilState> {
  return (await one<{ data: CouncilState }>(db, "select data from council where career_id = $1", [careerId]))?.data ?? { month: null, pending: null, history: [] };
}

async function save(db: Db, careerId: string, s: CouncilState) {
  await query(db, "insert into council(career_id, data) values ($1,$2) on conflict (career_id) do update set data = excluded.data", [careerId, JSON.stringify(s)]);
}

/** Mitglieder: Kapitän (gewählt oder einflussreichster Spieler) und vier weitere. */
export function councilMembers(squad: Player[], season: number, captainId: number | null | undefined): Player[] {
  const hier = hierarchy(squad.filter((p) => !p.loan), season).map((h) => h.player);
  const captain = hier.find((p) => p.id === captainId) ?? hier[0];
  if (!captain) return [];
  return [captain, ...hier.filter((p) => p.id !== captain.id).slice(0, 4)];
}

/** Stimmung des Rats (Kapitän zählt doppelt). */
export function councilMood(members: Player[]): number {
  if (!members.length) return 50;
  const w = members.reduce((s, p, i) => s + p.morale * (i === 0 ? 2 : 1), 0);
  return Math.round(w / (members.length + 1));
}

async function recentPoints(db: Db, career: CareerRow): Promise<{ games: number; points: number }> {
  const rows = await query<{ home_id: number; home_goals: number; away_goals: number }>(db,
    "select home_id, home_goals, away_goals from fixtures where career_id = $1 and season = $2 and played and (home_id = $3 or away_id = $3) order by week desc limit 5",
    [career.id, career.season, career.club_id]);
  const points = rows.reduce((s, r) => {
    const own = r.home_id === career.club_id ? r.home_goals - r.away_goals : r.away_goals - r.home_goals;
    return s + (own > 0 ? 3 : own === 0 ? 1 : 0);
  }, 0);
  return { games: rows.length, points };
}

/** Das dringendste Anliegen des Rats. */
async function pickConcern(db: Db, career: CareerRow, squad: Player[], members: Player[], formation?: string): Promise<Concern> {
  const base = { season: career.season, day: career.day, by: members[0].id };
  const name = (p: Player) => `${p.firstName} ${p.lastName}`;
  const defaults = defaultStatuses(squad, formation as never);
  const unhappy = squad.filter((p) => !p.loan && (playingTimeHappiness(p, statusOf(p, defaults), career.season) ?? 0) <= -0.4);
  const memberUnhappy = unhappy.filter((p) => members.includes(p));
  if (unhappy.length >= 3 || memberUnhappy.length) {
    return { ...base, topic: "playing_time", title: "Unmut über die Einsatzzeiten", playerIds: unhappy.map((p) => p.id),
      text: `Der Rat spricht für mehrere Spieler, die sich übergangen fühlen: ${unhappy.slice(0, 4).map(name).join(", ")}. Sie wollen wissen, ob sie noch eine Chance bekommen.`,
      options: [
        { key: "promise", label: "Mehr Rotation zusagen", text: "Die Betroffenen schöpfen Hoffnung, die Stammspieler sind skeptisch." },
        { key: "merit", label: "Leistung entscheidet", text: "Klare Ansage: Wer spielen will, muss sich im Training aufdrängen." },
      ] };
  }
  const tired = squad.filter((p) => !p.loan && p.fitness < 75).length;
  if (career.training.intensity === "high" && tired >= 5) {
    return { ...base, topic: "training", title: "Die Belastung ist zu hoch", playerIds: [],
      text: `${tired} Spieler gehen auf dem Zahnfleisch. Der Rat bittet darum, das Training etwas zurückzufahren.`,
      options: [
        { key: "ease", label: "Training auf normal stellen", text: "Die Mannschaft ist erleichtert." },
        { key: "keep", label: "Es bleibt dabei", text: "Der Rat akzeptiert zähneknirschend." },
      ] };
  }
  const form = await recentPoints(db, career);
  if (form.games >= 4 && form.points <= 4) {
    return { ...base, topic: "results", title: "Die Ergebnisse stimmen nicht", playerIds: [],
      text: `Nur ${form.points} Punkte aus den letzten ${form.games} Spielen. Der Rat will wissen, wie es weitergeht.`,
      options: [
        { key: "trust", label: "Vertrauen aussprechen", text: "Du stärkst der Mannschaft den Rücken." },
        { key: "demand", label: "Mehr Einsatz fordern", text: "Du nimmst die Spieler in die Pflicht." },
      ] };
  }
  if (form.games >= 4 && form.points >= 12) {
    return { ...base, topic: "bonus", title: "Wunsch nach einer Prämie", playerIds: [],
      text: `${form.points} Punkte aus ${form.games} Spielen – die Mannschaft ist in Topform. Der Rat fragt nach einer Sonderprämie für die Serie.`,
      options: [
        { key: "pay", label: "Prämie zahlen", text: "Eine Wochengage extra für den ganzen Kader." },
        { key: "refuse", label: "Ablehnen", text: "Erfolg ist Lohn genug." },
      ] };
  }
  const expiring = members.filter((p) => p.contract && p.contract.untilSeason === career.season && !p.precontract);
  if (expiring.length) {
    return { ...base, topic: "contracts", title: "Offene Vertragsfragen", playerIds: expiring.map((p) => p.id),
      text: `${expiring.map(name).join(" und ")} ${expiring.length > 1 ? "warten" : "wartet"} auf ein Signal zur Zukunft. Das sorgt für Unruhe im Rat.`,
      options: [
        { key: "talks", label: "Gespräche zusagen", text: "Du kündigst Verhandlungen an (unter Spielerprofil → Vertrag verlängern)." },
        { key: "later", label: "Später entscheiden", text: "Erst sportlich, dann Verträge." },
      ] };
  }
  return { ...base, topic: "harmony", title: "Alles im grünen Bereich", playerIds: [],
    text: "Der Rat ist zufrieden mit der Stimmung in der Kabine und hat keine besonderen Anliegen.",
    options: [{ key: "thanks", label: "Danke für die Rückmeldung", text: "Ein kurzes Lob für den Zusammenhalt." }] };
}

/**
 * Wöchentlich (an Ligaspieltagen): Die Stimmung des Rats färbt auf den Kader
 * ab; zu Monatsbeginn trifft sich der Rat, verfallene Anliegen kosten Moral.
 */
export async function councilWeek(db: pg.PoolClient, career: CareerRow, squad: Player[]): Promise<string[]> {
  if (!career.club_id || squad.length < 11) return [];
  const club = (await getClub(db, career.id, career.club_id))!;
  const members = councilMembers(squad, career.season, club.tactic?.captain);
  const mood = councilMood(members);
  for (const p of squad) {
    if (members.includes(p)) continue;
    if (mood >= 72 && p.morale < mood) p.morale = clamp(p.morale + 1);
    else if (mood <= 40) p.morale = clamp(p.morale - 1);
  }
  const s = await load(db, career.id);
  const out: string[] = [];
  if (s.pending && (s.pending.season !== career.season || career.day - s.pending.day > CONCERN_DAYS)) {
    for (const p of members) p.morale = clamp(p.morale - 3);
    s.history = [{ season: s.pending.season, day: career.day, topic: s.pending.topic, title: s.pending.title, choice: "Ignoriert", outcome: "Der Rat fühlt sich übergangen (Moral −3)." }, ...s.history].slice(0, 12);
    s.pending = null;
    out.push("Mannschaftsrat übergangen");
  }
  const d = career.calendar ? dateOf(career.season, career.day) : null;
  const month = d ? `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}` : `w${Math.floor(career.week / 4)}`;
  if (s.month !== month && !s.pending) {
    s.month = month;
    s.pending = await pickConcern(db, career, squad, members, club.tactic?.formation);
    await send(db, career, {
      category: "board", title: `Mannschaftsrat: ${s.pending.title}`,
      sender: { name: `${members[0].firstName} ${members[0].lastName}`, role: "Kapitän · Mannschaftsrat", kind: "player", face: { id: members[0].id, name: `${members[0].firstName} ${members[0].lastName}`, age: members[0].age, nationality: members[0].nationality } },
      blocks: [{ t: "p", text: s.pending.text }, { t: "p", text: `Antworte unter Team → Dynamik innerhalb von ${CONCERN_DAYS} Tagen.` }],
      priority: s.pending.topic === "harmony" ? 1 : 2, kind: "council", action: { type: "dynamics" },
    });
    out.push("Sitzung des Mannschaftsrats");
  }
  await save(db, career.id, s);
  return out;
}

export async function answerCouncil(careerId: string, accountId: string, choice: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) throw new GameError("Kein Verein");
    const s = await load(db, career.id);
    const c = s.pending;
    if (!c) throw new GameError("Der Mannschaftsrat hat gerade kein offenes Anliegen.");
    const opt = c.options.find((o) => o.key === choice);
    if (!opt) throw new GameError("Unbekannte Antwort");
    const club = (await getClub(db, career.id, career.club_id))!;
    const squad = await getPlayers(db, career.id, [club.id]);
    const members = councilMembers(squad, career.season, club.tactic?.captain);
    const named = new Set(c.playerIds);
    const all = (d: number) => { for (const p of squad) p.morale = clamp(p.morale + d); };
    const council = (d: number) => { for (const p of members) p.morale = clamp(p.morale + d); };
    let outcome = "";
    switch (`${c.topic}:${choice}`) {
      case "playing_time:promise":
        for (const p of squad) if (named.has(p.id)) p.morale = clamp(p.morale + 8);
        for (const p of squad) if (!named.has(p.id) && (p.squadStatus === "star" || p.squadStatus === "important")) p.morale = clamp(p.morale - 2);
        outcome = "Die Betroffenen sind motivierter (+8), einige Stammspieler skeptisch (−2)."; break;
      case "playing_time:merit":
        for (const p of squad) if (named.has(p.id)) p.morale = clamp(p.morale - 3);
        council(2);
        outcome = "Der Rat trägt die klare Linie mit (+2), die Betroffenen sind enttäuscht (−3)."; break;
      case "training:ease":
        career.training = { ...career.training, intensity: "normal" };
        await query(db, "update careers set training = $2 where id = $1", [career.id, JSON.stringify(career.training)]);
        all(3);
        outcome = "Trainingsintensität auf normal gesetzt, die Mannschaft ist erleichtert (+3)."; break;
      case "training:keep":
        council(-4);
        outcome = "Der Rat ist unzufrieden (−4)."; break;
      case "results:trust": {
        const mood = councilMood(members);
        all(mood >= 50 ? 4 : 1);
        outcome = mood >= 50 ? "Die Mannschaft zieht mit (+4)." : "Der Rat bleibt skeptisch, kaum Wirkung (+1)."; break;
      }
      case "results:demand":
        all(-2);
        for (const p of squad) p.form = Math.min(10, p.form + 0.3);
        outcome = "Die Spieler sind angefasst (−2), wollen es aber beweisen (Form +0,3)."; break;
      case "bonus:pay": {
        const cost = Math.round(wageBill(squad) / 1000) * 1000;
        club.balance -= cost;
        await saveClubs(db, career.id, [club]);
        await addFinance(db, career.id, club.id, career.season, career.week, [{ kind: "bonus", amount: -cost, label: "Sonderprämie für die Siegesserie" }]);
        all(6);
        outcome = `Sonderprämie über ${Math.round(cost / 1000)} Tsd. € gezahlt, grosse Freude (+6).`; break;
      }
      case "bonus:refuse":
        council(-3);
        outcome = "Der Rat hatte mehr erwartet (−3)."; break;
      case "contracts:talks":
        for (const p of squad) if (named.has(p.id)) p.morale = clamp(p.morale + 6);
        outcome = "Die Spieler freuen sich auf die Gespräche (+6)."; break;
      case "contracts:later":
        for (const p of squad) if (named.has(p.id)) p.morale = clamp(p.morale - 4);
        outcome = "Die Unsicherheit bleibt (−4)."; break;
      default:
        all(1);
        outcome = "Kurzes Lob, gute Stimmung (+1).";
    }
    await savePlayers(db, career.id, squad);
    s.history = [{ season: career.season, day: career.day, topic: c.topic, title: c.title, choice: opt.label, outcome }, ...s.history].slice(0, 12);
    s.pending = null;
    await save(db, career.id, s);
    await send(db, career, { category: "board", title: `Mannschaftsrat: ${opt.label}`, sender: clubSender(club, "Mannschaftsrat"), blocks: [{ t: "p", text: outcome }], priority: 1, kind: "council_answer" });
    return { message: outcome };
  });
}

export async function councilView(career: CareerRow, squad: Player[], captainId: number | null | undefined) {
  const members = councilMembers(squad, career.season, captainId);
  const s = await load(pool(), career.id);
  return {
    mood: councilMood(members),
    members: members.map((p, i) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, age: p.age, nationality: p.nationality, position: p.position, morale: p.morale, captain: i === 0 })),
    pending: s.pending ? { ...s.pending, daysLeft: Math.max(0, CONCERN_DAYS - (career.day - s.pending.day)) } : null,
    history: s.history.slice(0, 5),
  };
}

export async function councilFor(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) return null;
  const club = (await getClub(pool(), career.id, career.club_id))!;
  return councilView(career, await getPlayers(pool(), career.id, [club.id]), club.tactic?.captain);
}
