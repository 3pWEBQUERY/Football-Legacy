/**
 * Monatsauszeichnungen der eigenen Liga: Spieler, Talent und Trainer des
 * Monats sowie die Elf des Monats. Grundlage sind die Spielberichte.
 */
import { coachName, dateOf, positionGroup, type Player, type PositionGroup } from "@fl/sim";
import type pg from "pg";
import { pool, query } from "./db";
import { readCareer } from "./career";
import { type CareerRow, addInbox, getClub, getClubs, getLeague, getPlayersByIds, savePlayers } from "./repo";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

interface AwardPlayer {
  id: number;
  name: string;
  age: number;
  nationality: string;
  position: string;
  clubId: number;
  club: string;
  apps: number;
  goals: number;
  assists: number;
  avg: number;
}

export interface MonthlyAwardData {
  player: AwardPlayer | null;
  young: AwardPlayer | null;
  manager: { clubId: number; club: string; name: string; points: number; record: string; user: boolean } | null;
  team: AwardPlayer[];
  rounds: number;
}

/** Am Monatsersten: Auszeichnungen für den Vormonat vergeben. */
export async function monthlyAwards(db: pg.PoolClient, career: CareerRow, date: Date): Promise<string | null> {
  if (!career.club_id || !career.calendar) return null;
  const prevMonth = (date.getUTCMonth() + 11) % 12;
  const weeks = career.calendar.slots
    .filter((s) => s.kind === "league" && s.day < career.day && dateOf(career.season, s.day).getUTCMonth() === prevMonth)
    .map((s) => s.week);
  if (weeks.length < 2) return null;
  const own = (await getClub(db, career.id, career.club_id))!;
  const league = await getLeague(db, career.id, own.league_id);
  if (!league) return null;
  const done = await query(db, "select 1 from monthly_awards where career_id = $1 and season = $2 and month = $3 and league_id = $4",
    [career.id, career.season, prevMonth, league.id]);
  if (done.length) return null;

  const fixtures = await query<{ id: number; home_id: number; away_id: number; home_goals: number; away_goals: number }>(db,
    "select id, home_id, away_id, home_goals, away_goals from fixtures where career_id = $1 and season = $2 and league_id = $3 and cup_id is null and played and week = any($4::int[])",
    [career.id, career.season, league.id, weeks]);
  if (!fixtures.length) return null;
  const reports = await query<{ fixture_id: number; players: { playerId: number; side: 0 | 1; rating: number; goals: number; assists: number; minutes: number }[] }>(db,
    "select fixture_id, data->'players' as players from match_reports where fixture_id = any($1::bigint[])", [fixtures.map((f) => f.id)]);
  const byFixture = new Map(fixtures.map((f) => [Number(f.id), f]));
  const agg = new Map<number, { clubId: number; apps: number; sum: number; goals: number; assists: number }>();
  for (const r of reports) {
    const f = byFixture.get(Number(r.fixture_id));
    if (!f || !Array.isArray(r.players)) continue;
    for (const l of r.players) {
      if (l.minutes < 30) continue;
      const a = agg.get(l.playerId) ?? { clubId: l.side === 0 ? f.home_id : f.away_id, apps: 0, sum: 0, goals: 0, assists: 0 };
      a.apps++;
      a.sum += l.rating;
      a.goals += l.goals;
      a.assists += l.assists;
      agg.set(l.playerId, a);
    }
  }
  const minApps = Math.max(2, Math.ceil(weeks.length * 0.6));
  const eligibleIds = [...agg.entries()].filter(([, a]) => a.apps >= minApps).map(([id]) => id);
  const players = await getPlayersByIds(db, career.id, eligibleIds);
  const clubs = new Map((await getClubs(db, career.id, "league_id = $2", [league.id])).map((c) => [c.id, c]));
  const entry = (p: Player): AwardPlayer => {
    const a = agg.get(p.id)!;
    return {
      id: p.id, name: `${p.firstName} ${p.lastName}`, age: p.age, nationality: p.nationality, position: p.position,
      clubId: a.clubId, club: clubs.get(a.clubId)?.name ?? "", apps: a.apps, goals: a.goals, assists: a.assists,
      avg: Math.round((a.sum / a.apps) * 100) / 100,
    };
  };
  const score = (x: AwardPlayer) => x.avg + x.goals * 0.12 + x.assists * 0.07;
  const ranked = players.map(entry).sort((a, b) => score(b) - score(a));
  const player = ranked[0] ?? null;
  const young = ranked.find((x) => x.age <= 21 && x.id !== player?.id) ?? null;

  // Elf des Monats im 4-4-2
  const need: Record<PositionGroup, number> = { GK: 1, DEF: 4, MID: 4, ATT: 2 };
  const team: AwardPlayer[] = [];
  for (const g of ["GK", "DEF", "MID", "ATT"] as PositionGroup[]) {
    team.push(...[...ranked].filter((x) => positionGroup(x.position as Player["position"]) === g).sort((a, b) => b.avg - a.avg).slice(0, need[g]));
  }

  // Trainer des Monats: meiste Punkte, dann Tordifferenz
  const table = new Map<number, { pts: number; gd: number; w: number; d: number; l: number }>();
  for (const f of fixtures) {
    for (const [id, gf, ga] of [[f.home_id, f.home_goals, f.away_goals], [f.away_id, f.away_goals, f.home_goals]] as const) {
      const t = table.get(id) ?? { pts: 0, gd: 0, w: 0, d: 0, l: 0 };
      t.pts += gf > ga ? 3 : gf === ga ? 1 : 0;
      t.gd += gf - ga;
      if (gf > ga) t.w++; else if (gf === ga) t.d++; else t.l++;
      table.set(id, t);
    }
  }
  const best = [...table.entries()].sort((a, b) => b[1].pts - a[1].pts || b[1].gd - a[1].gd)[0];
  const manager = best ? {
    clubId: best[0], club: clubs.get(best[0])?.name ?? "", points: best[1].pts, record: `${best[1].w}-${best[1].d}-${best[1].l}`,
    user: best[0] === career.club_id, name: best[0] === career.club_id ? career.manager_name : coachName(best[0], clubs.get(best[0])?.country_code ?? league.country_code),
  } : null;

  const data: MonthlyAwardData = { player, young, manager, team, rounds: weeks.length };
  await query(db, "insert into monthly_awards(career_id, season, month, league_id, data) values ($1,$2,$3,$4,$5)",
    [career.id, career.season, prevMonth, league.id, JSON.stringify(data)]);

  // Auszeichnungen in den Spielerprofilen vermerken
  const marks = new Map<number, string[]>();
  if (player) marks.set(player.id, ["player"]);
  if (young) marks.set(young.id, [...(marks.get(young.id) ?? []), "young"]);
  for (const t of team) marks.set(t.id, [...(marks.get(t.id) ?? []), "team"]);
  const marked = players.filter((p) => marks.has(p.id));
  for (const p of marked) {
    p.awards = [...(p.awards ?? []), ...marks.get(p.id)!.map((kind) => ({ season: career.season, month: prevMonth, kind, league: league.name }))];
  }
  await savePlayers(db, career.id, marked);

  const ownPlayers = team.filter((t) => t.clubId === career.club_id);
  const involved = manager?.user || player?.clubId === career.club_id || young?.clubId === career.club_id || ownPlayers.length > 0;
  const m = MONTHS[prevMonth];
  const line = (label: string, x: AwardPlayer | null) => (x ? `${label}: ${x.name} (${x.club}) – Ø ${x.avg.toFixed(2)}, ${x.goals} Tore, ${x.assists} Vorlagen` : null);
  const body = [
    line("Spieler des Monats", player),
    line("Talent des Monats", young),
    manager ? `Trainer des Monats: ${manager.name} (${manager.club}) – ${manager.points} Punkte aus ${manager.record.split("-").reduce((s, v) => s + Number(v), 0)} Spielen` : null,
    "",
    `Elf des Monats: ${team.map((t) => `${t.name.split(" ").slice(-1)[0]} (${t.club})`).join(", ")}`,
    ownPlayers.length ? `\nAus deiner Mannschaft in der Elf des Monats: ${ownPlayers.map((t) => t.name).join(", ")}.` : "",
    manager?.user ? "\nGlückwunsch: Du bist Trainer des Monats!" : "",
    "\nAlle Auszeichnungen findest du unter Wettbewerb → Auszeichnungen.",
  ].filter((x) => x !== null).join("\n");
  const title = manager?.user ? `Du bist Trainer des Monats ${m}` : `Auszeichnungen ${m}: ${league.name}`;
  await addInbox(db, career.id, career.season, career.week, involved ? "award" : "news", title, body, { type: "awards" });
  return title;
}

export async function awardsView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const own = career.club_id ? await getClub(pool(), career.id, career.club_id) : null;
  const leagueId = own?.league_id ?? null;
  const rows = leagueId
    ? await query<{ season: number; month: number; data: MonthlyAwardData }>(pool(),
      "select season, month, data from monthly_awards where career_id = $1 and league_id = $2 order by season desc, id desc", [career.id, leagueId])
    : [];
  const all = await query<{ data: MonthlyAwardData }>(pool(), "select data from monthly_awards where career_id = $1", [career.id]);
  const clubIds = [...new Set(rows.flatMap((r) => [r.data.manager?.clubId, ...r.data.team.map((t) => t.clubId), r.data.player?.clubId, r.data.young?.clubId]).filter((x): x is number => !!x))];
  const colors = clubIds.length ? new Map((await getClubs(pool(), career.id, "id = any($2::int[])", [clubIds])).map((c) => [c.id, c.colors])) : new Map();
  const league = leagueId ? await getLeague(pool(), career.id, leagueId) : null;
  return {
    career: { season: career.season, clubId: career.club_id },
    league: league ? { id: league.id, name: league.name } : null,
    managerAwards: all.filter((r) => r.data.manager?.user).length,
    months: rows.map((r) => ({
      season: r.season, month: r.month, label: `${MONTHS[r.month]} ${dateOf(r.season, 0).getUTCFullYear() + (r.month < 6 ? 1 : 0)}`,
      ...r.data,
    })),
    colors: Object.fromEntries(colors.entries()),
  };
}
