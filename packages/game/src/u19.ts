/**
 * U19-Liga: Die Akademie spielt eine eigene Saison gegen die Nachwuchsteams
 * der Ligakonkurrenten – eine Runde pro Ligaspieltag. Die eigenen Spiele laufen
 * durch die echte Matchengine (Torschützen, Noten), die übrigen werden nach
 * Stärke ausgelost. Spielminuten treiben die Entwicklung der Talente an.
 */
import { Rng, defaultTactic, generatePlayer, generateSquad, playMatch, seedFor, type Player, type Position } from "@fl/sim";
import type pg from "pg";
import { type Db, one, pool, query } from "./db";
import { type CareerRow, addInbox, getClub, getClubs, saveCareer } from "./repo";
import { facilitiesOf } from "./facilities";
import { roundRobin } from "./online";

export interface U19Team { clubId: number; name: string; short: string; colors: { primary: string; secondary: string }; strength: number }
export interface U19Fixture { round: number; home: number; away: number; hg: number | null; ag: number | null }
export interface U19Scorer { id: number; name: string; position: string; apps: number; goals: number; assists: number; ratingSum: number }
export interface U19Season { teams: U19Team[]; fixtures: U19Fixture[]; round: number; scorers: Record<number, U19Scorer>; minutes: Record<number, number>; champion?: number | null }

/** Mindestgrösse des Akademiekaders, damit die U19 antreten kann. */
export const U19_MIN_SQUAD = 16;
const POSITIONS: Position[] = ["GK", "DR", "DC", "DC", "DL", "DM", "MC", "MC", "MR", "ML", "AMC", "ST", "ST", "GK", "DC", "MC"];

async function load(db: Db, career: CareerRow): Promise<U19Season | null> {
  return (await one<{ data: U19Season }>(db, "select data from u19_seasons where career_id = $1 and season = $2", [career.id, career.season]))?.data ?? null;
}

async function save(db: Db, career: CareerRow, s: U19Season) {
  await query(db, "insert into u19_seasons(career_id, season, data) values ($1,$2,$3) on conflict (career_id, season) do update set data = excluded.data",
    [career.id, career.season, JSON.stringify(s)]);
}

/** Bestehender Nachwuchs: füllt eine leere oder kleine Akademie auf (z. B. beim Karrierestart). */
async function ensureSquad(db: pg.PoolClient, career: CareerRow, players: Player[]): Promise<Player[]> {
  if (players.length >= U19_MIN_SQUAD || !career.club_id) return players;
  const club = (await getClub(db, career.id, career.club_id))!;
  const fac = facilitiesOf(career);
  const rng = new Rng(seedFor(career.seed, "u19-fill", career.season));
  const added: Player[] = [];
  let nextId = career.next_player_id;
  const have = new Map<string, number>();
  for (const p of players) have.set(p.position, (have.get(p.position) ?? 0) + 1);
  for (const pos of POSITIONS) {
    if (players.length + added.length >= U19_MIN_SQUAD) break;
    if ((have.get(pos) ?? 0) > 0) { have.set(pos, have.get(pos)! - 1); continue; }
    const age = rng.int(16, 18);
    const p = generatePlayer(rng, {
      id: nextId++, clubId: club.id, nationality: club.country_code, position: pos, age, season: career.season, reputation: club.reputation, youth: true,
      targetRating: Math.max(20, Math.min(64, Math.round(club.rating - 27 + (age - 16) * 3 + rng.normal(0, 4) + career.staff.youth / 5 + fac.youth))),
    });
    p.contract = null;
    p.listed = false;
    added.push(p);
  }
  career.next_player_id = nextId;
  for (const p of added) await query(db, "insert into academy(career_id, id, data) values ($1,$2,$3) on conflict do nothing", [career.id, p.id, JSON.stringify(p)]);
  await saveCareer(db, career);
  return [...players, ...added];
}

/** Legt die U19-Saison an: Gegner sind die Nachwuchsteams der eigenen Liga. */
async function createSeason(db: pg.PoolClient, career: CareerRow): Promise<U19Season | null> {
  if (!career.club_id) return null;
  const user = (await getClub(db, career.id, career.club_id))!;
  const slots = career.calendar?.slots.filter((s) => s.kind === "league").length ?? career.season_weeks;
  const size = Math.max(4, Math.min(18, Math.floor(slots / 2) + 1));
  const rng = new Rng(seedFor(career.seed, "u19-teams", career.season));
  const rivals = (await getClubs(db, career.id)).filter((c) => c.league_id === user.league_id && c.id !== user.id)
    .sort((a, b) => b.reputation - a.reputation).slice(0, size - 1);
  const teams: U19Team[] = [user, ...rivals].map((c) => ({
    clubId: c.id, name: `${c.name} U19`, short: c.short_name, colors: c.colors,
    strength: Math.round(c.rating - 20 + rng.normal(0, 3)),
  }));
  const fixtures: U19Fixture[] = roundRobin(teams.map((t) => t.clubId)).flatMap((pairs, i) => pairs.map(([home, away]) => ({ round: i + 1, home, away, hg: null, ag: null })));
  return { teams, fixtures, round: 0, scorers: {}, minutes: {} };
}

/** Poisson-Ziehung für die Spiele ohne eigene Beteiligung. */
function poisson(rng: Rng, lambda: number) {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= rng.next(); } while (p > l);
  return k - 1;
}

/**
 * Eine U19-Runde (an Ligaspieltagen). Gibt die Spielminuten der eigenen
 * Talente zurück, damit das Akademietraining sie berücksichtigt.
 */
export async function u19Round(db: pg.PoolClient, career: CareerRow, academy: Player[]): Promise<{ minutes: Map<number, number>; players: Player[] }> {
  const minutes = new Map<number, number>();
  if (!career.club_id) return { minutes, players: academy };
  let s = await load(db, career);
  if (!s) {
    s = await createSeason(db, career);
    if (!s) return { minutes, players: academy };
  }
  if (s.teams[0]?.clubId !== career.club_id) return { minutes, players: academy }; // Vereinswechsel: Saison ohne dich zu Ende
  const players = await ensureSquad(db, career, academy);
  const round = s.round + 1;
  const games = s.fixtures.filter((f) => f.round === round);
  if (!games.length) {
    await finish(db, career, s);
    return { minutes, players };
  }
  const rng = new Rng(seedFor(career.seed, "u19-round", career.season, round));
  const team = (id: number) => s!.teams.find((t) => t.clubId === id)!;
  for (const f of games) {
    if (f.home === career.club_id || f.away === career.club_id) {
      const own = ownSetup(career, players, team(career.club_id));
      const other = team(f.home === career.club_id ? f.away : f.home);
      const opp = opponentSetup(career, other);
      const home = f.home === career.club_id;
      const res = playMatch({ seed: seedFor(career.seed, "u19-match", career.season, round), home: home ? own : opp, away: home ? opp : own });
      f.hg = res.homeGoals;
      f.ag = res.awayGoals;
      for (const line of res.players) {
        if (line.side !== (home ? 0 : 1)) continue;
        const p = players.find((x) => x.id === line.playerId);
        if (!p) continue;
        minutes.set(p.id, line.minutes);
        s.minutes[p.id] = (s.minutes[p.id] ?? 0) + line.minutes;
        const sc = s.scorers[p.id] ?? { id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, apps: 0, goals: 0, assists: 0, ratingSum: 0 };
        sc.apps++;
        sc.goals += line.goals;
        sc.assists += line.assists;
        sc.ratingSum += line.rating;
        s.scorers[p.id] = sc;
        p.stats = { ...p.stats, apps: p.stats.apps + 1, goals: p.stats.goals + line.goals, assists: p.stats.assists + line.assists };
      }
    } else {
      const diff = (team(f.home).strength - team(f.away).strength) / 12;
      f.hg = poisson(rng, Math.max(0.3, 1.5 + diff * 0.5 + 0.15));
      f.ag = poisson(rng, Math.max(0.3, 1.5 - diff * 0.5 - 0.15));
    }
  }
  s.round = round;
  await save(db, career, s);
  if (!s.fixtures.some((f) => f.hg === null)) await finish(db, career, s);
  return { minutes, players };
}

function ownSetup(career: CareerRow, players: Player[], t: U19Team) {
  const fit = players.filter((p) => p.injuryWeeks <= 0);
  return { clubId: t.clubId, name: t.name, shortName: t.short, colors: t.colors, tactic: defaultTactic(fit), players: fit, autoSubs: true };
}

function opponentSetup(career: CareerRow, t: U19Team) {
  let id = 2_000_000_000;
  const players = generateSquad(seedFor(career.seed, "u19-squad", t.clubId), { id: t.clubId, countryCode: "GER", rating: t.strength, reputation: t.strength }, career.season, () => id++);
  return { clubId: t.clubId, name: t.name, shortName: t.short, colors: t.colors, tactic: defaultTactic(players), players, autoSubs: true };
}

export function u19Table(s: U19Season) {
  const rows = new Map(s.teams.map((t) => [t.clubId, { clubId: t.clubId, name: t.name, colors: t.colors, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }]));
  for (const f of s.fixtures) {
    if (f.hg === null || f.ag === null) continue;
    const h = rows.get(f.home)!;
    const a = rows.get(f.away)!;
    h.played++; a.played++;
    h.gf += f.hg; h.ga += f.ag; a.gf += f.ag; a.ga += f.hg;
    if (f.hg > f.ag) { h.won++; a.lost++; h.points += 3; } else if (f.hg < f.ag) { a.won++; h.lost++; a.points += 3; } else { h.drawn++; a.drawn++; h.points++; a.points++; }
  }
  return [...rows.values()].sort((x, y) => y.points - x.points || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
}

async function finish(db: pg.PoolClient, career: CareerRow, s: U19Season) {
  if (s.champion !== undefined) return;
  const table = u19Table(s);
  s.champion = table[0]?.clubId ?? null;
  await save(db, career, s);
  const pos = table.findIndex((r) => r.clubId === career.club_id) + 1;
  const top = Object.values(s.scorers).sort((a, b) => b.goals - a.goals)[0];
  await addInbox(db, career.id, career.season, career.week, "youth", pos === 1 ? "U19 ist Meister!" : `U19-Saison beendet: Platz ${pos}`,
    (pos === 1 ? "Die U19 holt die Meisterschaft – ein starkes Zeichen für die Arbeit in der Akademie." : `Die U19 schliesst die Saison auf Platz ${pos} von ${table.length} ab.`) +
      (top && top.goals > 0 ? `\nBester Torschütze: ${top.name} (${top.goals} Tore).` : ""),
    { type: "academy" });
}

export async function u19View(career: CareerRow) {
  const s = await load(pool(), career);
  if (!s) return null;
  const name = (id: number) => s.teams.find((t) => t.clubId === id)?.name ?? "?";
  const own = s.fixtures.filter((f) => f.home === career.club_id || f.away === career.club_id);
  return {
    round: s.round,
    rounds: Math.max(...s.fixtures.map((f) => f.round)),
    champion: s.champion ? name(s.champion) : null,
    table: u19Table(s),
    results: own.filter((f) => f.hg !== null).slice(-5).reverse().map((f) => ({ ...f, homeName: name(f.home), awayName: name(f.away) })),
    next: own.filter((f) => f.hg === null).slice(0, 3).map((f) => ({ ...f, homeName: name(f.home), awayName: name(f.away) })),
    scorers: Object.values(s.scorers).filter((x) => x.goals + x.assists > 0)
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists).slice(0, 8)
      .map((x) => ({ ...x, avg: x.apps ? Math.round((x.ratingSum / x.apps) * 10) / 10 : null })),
    minutes: s.minutes,
  };
}
