/**
 * Relegation im Land des Nutzers: Zwischen zwei Ligen mit mindestens zwei
 * Auf-/Absteigern steigen n−1 Vereine direkt auf bzw. ab; der letzte
 * Absteigerplatz der oberen und der letzte Aufstiegsplatz der unteren Liga
 * spielen in Hin- und Rückspiel um den Platz in der oberen Liga (bei
 * Gleichstand Elfmeterschiessen). Die Spiele liegen nach dem letzten Spieltag.
 */
import { computeStandings } from "@fl/sim";
import { one, query, type Db } from "./db";
import { type CareerRow, type FixtureRow, type LeagueRow, addInbox } from "./repo";

export interface PlayoffPair { upperLeague: number; lowerLeague: number; upperId: number; lowerId: number; winnerId: number | null }
interface PlayoffCup { id: number; groups: PlayoffPair[] | null; rounds: { round: number; name: string }[] }

/** Paare benachbarter Ligen, zwischen denen eine Relegation stattfindet (obere Liga zuerst). */
export function playoffLeagues(leagues: LeagueRow[], country: string): { upper: LeagueRow; lower: LeagueRow; n: number }[] {
  const own = leagues.filter((l) => l.country_code === country && l.active).sort((a, b) => a.tier - b.tier);
  const out: { upper: LeagueRow; lower: LeagueRow; n: number }[] = [];
  for (let i = 0; i < own.length - 1; i++) {
    const n = Math.min(own[i].relegation, own[i + 1].promotion);
    if (n >= 2 && own[i + 1].tier === own[i].tier + 1) out.push({ upper: own[i], lower: own[i + 1], n });
  }
  return out;
}

async function playoffCup(db: Db, career: CareerRow): Promise<PlayoffCup | null> {
  return one<PlayoffCup>(db, "select id, groups, rounds from cups where career_id = $1 and season = $2 and kind = 'playoff'", [career.id, career.season]);
}

/** Alle Relegationspaarungen der laufenden Saison (für Auf- und Abstieg am Saisonende). */
export async function seasonPlayoffs(db: Db, career: CareerRow): Promise<PlayoffPair[]> {
  return (await playoffCup(db, career))?.groups ?? [];
}

/**
 * Nach dem letzten Ligaspieltag: Paarungen aus den Abschlusstabellen ziehen und
 * Hin- und Rückspiel in die beiden Relegationswochen legen.
 */
export async function createPlayoffs(db: Db, career: CareerRow, week: number) {
  const slots = career.calendar?.slots ?? [];
  const lastLeague = Math.max(...slots.filter((s) => s.kind === "league").map((s) => s.week));
  const legs = slots.filter((s) => s.kind === "playoff").map((s) => s.week);
  if (week !== lastLeague || legs.length < 2 || (await playoffCup(db, career))) return;
  const leagues = await query<LeagueRow>(db, "select * from leagues where career_id = $1", [career.id]);
  const userLeague = career.club_id ? (await one<{ league_id: number }>(db, "select league_id from clubs where career_id = $1 and id = $2", [career.id, career.club_id]))?.league_id : null;
  const country = leagues.find((l) => l.id === userLeague)?.country_code ?? career.country_code;
  const pairs: PlayoffPair[] = [];
  for (const { upper, lower, n } of playoffLeagues(leagues, country)) {
    const table = async (l: LeagueRow) => {
      const ids = (await query<{ id: number }>(db, "select id from clubs where career_id = $1 and league_id = $2", [career.id, l.id])).map((r) => r.id);
      const fx = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and season = $2 and league_id = $3", [career.id, career.season, l.id]);
      return computeStandings(ids, fx.map((f) => ({ homeId: f.home_id, awayId: f.away_id, homeGoals: f.home_goals, awayGoals: f.away_goals, round: f.round }))).map((r) => r.clubId);
    };
    const up = await table(upper);
    const low = await table(lower);
    const upperId = up[upper.size - n];
    const lowerId = low[n - 1];
    if (upperId && lowerId) pairs.push({ upperLeague: upper.id, lowerLeague: lower.id, upperId, lowerId, winnerId: null });
  }
  if (!pairs.length) return;
  const cup = await one<{ id: number }>(db,
    "insert into cups(career_id, season, country_code, name, rounds, byes, kind, groups) values ($1,$2,$3,'Relegation',$4,'[]','playoff',$5) returning id",
    [career.id, career.season, country, JSON.stringify([{ round: 1, name: "Relegation Hinspiel" }, { round: 2, name: "Relegation Rückspiel" }]), JSON.stringify(pairs)]);
  for (const [i, p] of pairs.entries()) {
    // Hinspiel beim Zweitligisten, Rückspiel beim Erstligisten
    await query(db,
      `insert into fixtures(career_id, season, league_id, week, round, home_id, away_id, cup_id, cup_round, group_no)
       values ($1,$2,0,$3,1,$4,$5,$6,1,$7), ($1,$2,0,$8,2,$5,$4,$6,2,$7)`,
      [career.id, career.season, legs[0], p.lowerId, p.upperId, cup!.id, i, legs[1]]);
  }
  const names = await clubNames(db, career, pairs.flatMap((p) => [p.upperId, p.lowerId]));
  const own = pairs.find((p) => p.upperId === career.club_id || p.lowerId === career.club_id);
  await addInbox(db, career.id, career.season, week, "match", own ? "Relegation! Zwei Spiele um die Liga" : "Relegation steht fest",
    (own
      ? `${names.get(own.upperId)} und ${names.get(own.lowerId)} spielen in Hin- und Rückspiel um den Platz in der oberen Liga. Bei Gleichstand nach beiden Spielen entscheidet das Elfmeterschiessen.\n\n`
      : "") + pairs.map((p) => `• ${names.get(p.lowerId)} – ${names.get(p.upperId)}`).join("\n"));
}

async function clubNames(db: Db, career: CareerRow, ids: number[]) {
  const rows = await query<{ id: number; name: string }>(db, "select id, name from clubs where career_id = $1 and id = any($2::int[])", [career.id, ids]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Rückspiel: Gesamtergebnis aus Hin- und Rückspiel (aus Sicht des Rückspiel-Heimteams). */
export async function firstLegs(db: Db, career: CareerRow): Promise<Map<number, FixtureRow>> {
  const cup = await playoffCup(db, career);
  if (!cup) return new Map();
  const legs = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and cup_id = $2 and cup_round = 1", [career.id, cup.id]);
  return new Map(legs.map((f) => [f.group_no!, f]));
}

/** Nach dem Rückspiel: Sieger festhalten und melden. */
export async function resolvePlayoffs(db: Db, career: CareerRow) {
  const cup = await playoffCup(db, career);
  if (!cup?.groups || cup.groups.every((p) => p.winnerId)) return;
  const legs = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and cup_id = $2", [career.id, cup.id]);
  if (legs.some((f) => !f.played)) return;
  const names = await clubNames(db, career, cup.groups.flatMap((p) => [p.upperId, p.lowerId]));
  const lines: string[] = [];
  for (const [i, p] of cup.groups.entries()) {
    const first = legs.find((f) => f.group_no === i && f.cup_round === 1)!;
    const second = legs.find((f) => f.group_no === i && f.cup_round === 2)!;
    // Hinspiel: Zweitligist zu Hause; Rückspiel: Erstligist zu Hause
    const upper = (first.away_goals ?? 0) + (second.home_goals ?? 0);
    const lower = (first.home_goals ?? 0) + (second.away_goals ?? 0);
    const pens = second.pen_home !== null && second.pen_away !== null ? second.pen_home > second.pen_away : null;
    p.winnerId = upper > lower ? p.upperId : lower > upper ? p.lowerId : pens ? p.upperId : p.lowerId;
    const stays = p.winnerId === p.upperId;
    lines.push(`${names.get(p.upperId)} – ${names.get(p.lowerId)} ${upper}:${lower}${upper === lower ? ` (i. E. ${second.pen_home}:${second.pen_away})` : ""}: ` +
      (stays ? `${names.get(p.upperId)} bleibt oben` : `${names.get(p.lowerId)} steigt auf, ${names.get(p.upperId)} steigt ab`));
    if (p.upperId === career.club_id || p.lowerId === career.club_id) {
      const won = p.winnerId === career.club_id;
      await addInbox(db, career.id, career.season, career.week, "match", won ? (p.upperId === career.club_id ? "Klassenerhalt in der Relegation!" : "Aufstieg über die Relegation!") : (p.upperId === career.club_id ? "Abstieg nach der Relegation" : "Aufstieg in der Relegation verpasst"),
        `Gesamtergebnis ${upper}:${lower}${upper === lower ? `, Elfmeterschiessen ${second.pen_home}:${second.pen_away}` : ""}.`);
    }
  }
  await query(db, "update cups set groups = $2 where id = $1", [cup.id, JSON.stringify(cup.groups)]);
  await addInbox(db, career.id, career.season, career.week, "news", "Relegation entschieden", lines.join("\n"));
}
