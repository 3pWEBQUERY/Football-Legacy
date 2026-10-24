/**
 * Scouting-Zentrale: Aufträge nach Land, Position und Alter. Nach einigen
 * Tagen liefert der Scout Empfehlungen mit Bericht.
 */
import { COUNTRIES, COUNTRY_BY_CODE, Rng, dateOf, formatMoney, seedFor, type Player } from "@fl/sim";
import type pg from "pg";
import { pool, query } from "./db";
import { activateClubs, readCareer, withCareer } from "./career";
import { GameError } from "./errors";
import { type CareerRow, addFinance, addInbox, getClub, getClubs, getLeagues, saveCareer, saveClubs } from "./repo";
import { buildScoutReport } from "./actions";

export interface ScoutAssignment {
  id: number;
  country: string;
  position: string | null;
  maxAge: number | null;
  season: number;
  start: number;
  due: number;
  cost: number;
}

export interface Scouting {
  next: number;
  assignments: ScoutAssignment[];
  done: { id: number; country: string; position: string | null; maxAge: number | null; season: number; day: number; playerIds: number[] }[];
}

const POS_LABEL: Record<string, string> = { GK: "Torhüter", DR: "Rechtsverteidiger", DC: "Innenverteidiger", DL: "Linksverteidiger", DM: "Defensives Mittelfeld", MR: "Rechtes Mittelfeld", MC: "Zentrales Mittelfeld", ML: "Linkes Mittelfeld", AMR: "Rechtsaussen", AMC: "Offensives Mittelfeld", AML: "Linksaussen", ST: "Stürmer" };
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function scoutingOf(career: CareerRow): Scouting {
  return career.scouting ?? { next: 1, assignments: [], done: [] };
}

/** Parallele Aufträge nach Qualität des Scouts (1–3). */
function maxAssignments(career: CareerRow) {
  return 1 + Math.floor(career.staff.scout / 7);
}

function costAndDays(career: CareerRow, country: string) {
  const home = country === career.country_code;
  const strength = COUNTRY_BY_CODE[country]?.strength ?? 5;
  return {
    cost: home ? 10_000 : Math.round((25_000 + strength * 6_000) / 1000) * 1000,
    days: Math.max(5, 16 - Math.floor(career.staff.scout / 2)) + (home ? 0 : 6),
  };
}

function title(a: { country: string; position: string | null; maxAge: number | null }) {
  return `${COUNTRY_BY_CODE[a.country]?.name ?? a.country}${a.position ? ` · ${POS_LABEL[a.position]}` : ""}${a.maxAge ? ` · bis ${a.maxAge} Jahre` : ""}`;
}

const fmtDay = (season: number, day: number) => {
  const d = dateOf(season, day);
  return `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]}`;
};

export async function scoutingView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const s = scoutingOf(career);
  const ids = [...new Set(s.done.flatMap((d) => d.playerIds))];
  const rows = ids.length
    ? await query<{ data: Player; club_id: number | null; club_name: string | null; club_colors: unknown; report: Record<string, unknown> | null }>(pool(),
      `select p.data, p.club_id, c.name as club_name, c.colors as club_colors, sl.report from players p left join clubs c on c.id = p.club_id
        left join shortlist sl on sl.career_id = p.career_id and sl.player_id = p.id where p.career_id = $1 and p.id = any($2::int[])`, [career.id, ids])
    : [];
  const byId = new Map(rows.map((r) => [r.data.id, r]));
  return {
    staffScout: career.staff.scout,
    maxAssignments: maxAssignments(career),
    assignments: s.assignments.map((a) => ({ ...a, title: title(a), dueLabel: fmtDay(a.season, a.due), daysLeft: Math.max(0, a.due - career.day) })),
    reports: [...s.done].reverse().map((d) => ({
      id: d.id, title: title(d), dateLabel: fmtDay(d.season, d.day),
      players: d.playerIds.map((pid) => byId.get(pid)).filter(Boolean).map((r) => ({
        id: r!.data.id, name: `${r!.data.firstName} ${r!.data.lastName}`, age: r!.data.age, position: r!.data.position, nationality: r!.data.nationality,
        clubId: r!.club_id, clubName: r!.club_name, kit: r!.club_colors ?? null, value: r!.data.value, rating: r!.report?.rating ?? null,
        potentialMin: r!.report?.potentialMin ?? null, potentialMax: r!.report?.potentialMax ?? null, verdict: r!.report?.verdict ?? null,
        own: r!.club_id === career.club_id,
      })),
    })),
    countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name, strength: c.strength, confed: c.confed, ...costAndDays(career, c.code) }))
      .sort((a, b) => (a.code === career.country_code ? -1 : b.code === career.country_code ? 1 : b.strength - a.strength || a.name.localeCompare(b.name))),
  };
}

export async function startAssignment(careerId: string, accountId: string, input: { country: string; position: string | null; maxAge: number | null }) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) throw new GameError("Kein Verein");
    if (!COUNTRY_BY_CODE[input.country]) throw new GameError("Unbekanntes Land");
    if (input.position && !POS_LABEL[input.position]) throw new GameError("Unbekannte Position");
    const s = scoutingOf(career);
    if (s.assignments.length >= maxAssignments(career)) throw new GameError(`Dein Scoutingteam schafft höchstens ${maxAssignments(career)} Aufträge gleichzeitig.`);
    const { cost, days } = costAndDays(career, input.country);
    const club = (await getClub(db, career.id, career.club_id))!;
    if (club.balance < cost) throw new GameError("Dafür reicht das Geld nicht.");
    club.balance -= cost;
    await saveClubs(db, career.id, [club]);
    await addFinance(db, career.id, club.id, career.season, career.week, [{ kind: "staff", amount: -cost, label: `Scouting: ${COUNTRY_BY_CODE[input.country].name}` }]);
    const a: ScoutAssignment = {
      id: s.next, country: input.country, position: input.position, maxAge: input.maxAge,
      season: career.season, start: career.day, due: career.day + days, cost,
    };
    s.next += 1;
    s.assignments.push(a);
    career.scouting = s;
    await saveCareer(db, career);
    return { message: `Der Scout ist unterwegs (${title(a)}). Bericht am ${fmtDay(a.season, a.due)}.`, cost };
  });
}

export async function cancelAssignment(careerId: string, accountId: string, assignmentId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const s = scoutingOf(career);
    s.assignments = s.assignments.filter((a) => a.id !== assignmentId);
    career.scouting = s;
    await saveCareer(db, career);
    return { ok: true };
  });
}

/** Täglich: fällige Aufträge abschliessen. */
export async function completeAssignments(db: pg.PoolClient, career: CareerRow): Promise<string[]> {
  const s = scoutingOf(career);
  const due = s.assignments.filter((a) => a.season < career.season || a.due <= career.day);
  if (!due.length || !career.club_id) return [];
  const out: string[] = [];
  for (const a of due) {
    // Kader der Topliga des Landes bei Bedarf erzeugen
    const leagues = await getLeagues(db, career.id);
    const top = leagues.find((l) => l.country_code === a.country && l.tier === 1);
    if (top) {
      const clubs = await getClubs(db, career.id, "league_id = $2 and not players_generated", [top.id]);
      if (clubs.length) await activateClubs(db, career, clubs, new Map(leagues.map((l) => [l.id, l])));
    }
    const params: unknown[] = [career.id, a.country, career.club_id];
    let where = "c.country_code = $2 and p.club_id <> $3";
    if (a.position) {
      params.push(a.position);
      where += ` and p.position = $${params.length}`;
    }
    if (a.maxAge) {
      params.push(a.maxAge);
      where += ` and p.age <= $${params.length}`;
    }
    const rows = await query<{ data: Player; club_id: number }>(db,
      `select p.data, p.club_id from players p join clubs c on c.id = p.club_id and c.career_id = p.career_id
        where p.career_id = $1 and ${where} order by (p.rating + p.potential) desc limit 80`, params);
    const rng = new Rng(seedFor(career.seed, "scout-assignment", a.id, career.season));
    const noise = Math.max(1, 8 - career.staff.scout / 3);
    const picks = rows
      .map((r) => ({ p: { ...r.data, clubId: r.club_id }, score: r.data.rating * 0.6 + r.data.potential * 0.4 + rng.normal(0, noise) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, 5)
      .map((x) => x.p);
    for (const p of picks) {
      await query(db,
        "insert into shortlist(career_id, player_id, report) values ($1,$2,$3) on conflict (career_id, player_id) do update set report = excluded.report",
        [career.id, p.id, JSON.stringify(buildScoutReport(career, p))]);
    }
    s.done = [...s.done.slice(-11), { id: a.id, country: a.country, position: a.position, maxAge: a.maxAge, season: career.season, day: career.day, playerIds: picks.map((p) => p.id) }];
    const clubNames = new Map((picks.length ? await getClubs(db, career.id, "id = any($2::int[])", [picks.map((p) => p.clubId)]) : []).map((c) => [c.id, c.name]));
    await addInbox(db, career.id, career.season, career.week, "scout", `Scouting: ${title(a)}`,
      picks.length
        ? `Dein Scout empfiehlt:\n${picks.map((p) => `• ${p.firstName} ${p.lastName} (${p.age}, ${p.position}) – ${clubNames.get(p.clubId!) ?? ""}, Marktwert ${formatMoney(p.value)}`).join("\n")}\n\nDie Berichte findest du unter Transfers → Scouting.`
        : "Der Scout hat keine passenden Spieler gefunden.",
      { type: "scouting" });
    out.push(`Scouting: ${title(a)}`);
  }
  s.assignments = s.assignments.filter((a) => !due.includes(a));
  career.scouting = s;
  return out;
}
