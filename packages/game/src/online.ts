/**
 * Online-Ligen: mehrere Accounts treten mit dem Verein aus ihrer Karriere in
 * einer gemeinsamen Liga gegeneinander an. Kader und Taktik werden zu jedem
 * Spieltag frisch aus der jeweiligen Karriere geladen (Stand: was der Spieler
 * dort gerade aufgebaut hat). Gespielt wird mit derselben Engine wie im Spiel.
 */
import crypto from "node:crypto";
import type pg from "pg";
import { type MatchEvent, type Player, type Tactic, type TeamSetup, Rng, playMatch, seedFor, teamRating, validateTactic } from "@fl/sim";
import { type Db, one, pool, query, tx } from "./db";
import { GameError } from "./errors";
import { getCareer, getClub, getClubs, getPlayers } from "./repo";
import { aiTactic } from "./setup";
import { pushChat, pushJoin, pushRound, pushSeason } from "./online-push";
import { requireVerified } from "./account/verify";

export type Rhythm = "manual" | "daily";
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 20;
const KEY_EVENTS = new Set(["goal", "penalty_goal", "own_goal", "red", "penalty_miss"]);

interface LeagueRow {
  id: string; name: string; code: string; owner_id: string; status: "open" | "running" | "finished"; max_members: number; public: boolean;
  rhythm: Rhythm; season: number; round: number; rounds: number; next_at: Date | null; created_at: Date;
}
export interface OnlineTeam { name: string; short: string; colors: { primary: string; secondary: string }; city: string; rating: number }
interface MemberRow {
  id: number; league_id: string; account_id: string | null; career_id: string | null; club_id: number | null; bot: boolean;
  manager: string; team: OnlineTeam; snapshot: Snapshot | null; ready: boolean;
}
interface Snapshot { clubId: number; players: Player[]; tactic: Tactic }
interface FixtureRow { id: number; season: number; round: number; home_id: number; away_id: number; home_goals: number | null; away_goals: number | null; played: boolean; report: Report | null }
interface Report { events: Pick<MatchEvent, "minute" | "type" | "text" | "side">[]; stats: unknown; players: { playerId: number; name: string; side: number; minutes: number; rating: number; goals: number; started: boolean }[]; motm: number | null }

async function lockLeague(db: pg.PoolClient, id: string) {
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [`online:${id}`]);
}

async function getLeague(db: Db, id: string): Promise<LeagueRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new GameError("Liga nicht gefunden", 404);
  const l = await one<LeagueRow>(db, "select * from online_leagues where id = $1", [id]);
  if (!l) throw new GameError("Liga nicht gefunden", 404);
  return l;
}

const members = (db: Db, leagueId: string) => query<MemberRow>(db, "select * from online_members where league_id = $1 order by id", [leagueId]);

async function displayName(db: Db, accountId: string) {
  return (await one<{ display_name: string }>(db, "select display_name from accounts where id = $1", [accountId]))?.display_name ?? "Manager";
}

async function post(db: Db, leagueId: string, body: string, author?: { id: string; name: string }) {
  await query(db, "insert into online_posts(league_id, account_id, author, system, body) values ($1,$2,$3,$4,$5)", [leagueId, author?.id ?? null, author?.name ?? "Liga", !author, body]);
}

function inviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(6), (b) => chars[b % chars.length]).join("");
}

// ------------------------------------------------------------ Teams laden

/** Lädt Kader und Taktik eines Mitglieds aus seiner Karriere; fällt auf den letzten Stand zurück. */
async function memberTeam(db: Db, m: MemberRow): Promise<{ snapshot: Snapshot; team: OnlineTeam } | null> {
  const career = m.career_id ? await getCareer(db, m.career_id) : null;
  const clubId = m.bot ? m.club_id : career?.club_id ?? null;
  const club = career && clubId ? await getClub(db, career.id, clubId) : null;
  if (career && club) {
    const players = (await getPlayers(db, career.id, [club.id])).map((p) => ({ ...p, fitness: 100, suspendedWeeks: 0 }));
    if (players.length >= 11) {
      // Eigene Mannschaft: gespeicherte Taktik des Spielers, sonst KI-Aufstellung
      const own = !m.bot && career.club_id === club.id && club.tactic;
      const tactic = own ? validateTactic(club.tactic!, players) : aiTactic(club, players);
      const xi = players.filter((p) => tactic.lineup.includes(p.id));
      return {
        snapshot: { clubId: club.id, players, tactic },
        team: { name: club.name, short: club.short_name, colors: club.colors, city: club.city, rating: Math.round(teamRating(xi.length >= 11 ? xi : players)) },
      };
    }
  }
  return m.snapshot ? { snapshot: m.snapshot, team: m.team } : null;
}

/** Spieler-IDs sind nur pro Karriere eindeutig: Gastteam bei Überschneidung verschieben. */
function shiftIds(s: Snapshot, offset: number): Snapshot {
  const f = (id: number | null) => (id === null ? null : id + offset);
  return {
    clubId: s.clubId,
    players: s.players.map((p) => ({ ...p, id: p.id + offset })),
    tactic: {
      ...s.tactic,
      lineup: s.tactic.lineup.map(f),
      bench: s.tactic.bench.map((id) => id + offset),
      setPieces: { ...s.tactic.setPieces, cornerTaker: f(s.tactic.setPieces.cornerTaker), freeKickTaker: f(s.tactic.setPieces.freeKickTaker), penaltyTaker: f(s.tactic.setPieces.penaltyTaker) },
    },
  };
}

function setupOf(s: Snapshot, team: OnlineTeam, memberId: number): TeamSetup {
  return { clubId: memberId, name: team.name, shortName: team.short, colors: team.colors, tactic: s.tactic, players: s.players, autoSubs: true };
}

// ------------------------------------------------------------ Spielplan

/** Doppelrunde nach dem Kreisverfahren; bei ungerader Zahl hat pro Runde ein Team spielfrei. */
export function roundRobin(ids: number[]): [number, number][][] {
  const list: number[] = [...ids];
  if (list.length % 2) list.push(-1);
  const n = list.length;
  const first: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a === -1 || b === -1) continue;
      pairs.push(i === 0 ? (r % 2 === 0 ? [a, b] : [b, a]) : [a, b]);
    }
    first.push(pairs);
    list.splice(1, 0, list.pop()!);
  }
  return [...first, ...first.map((rd) => rd.map(([a, b]) => [b, a] as [number, number]))];
}

async function schedule(db: Db, l: LeagueRow, season: number) {
  const ms = await members(db, l.id);
  if (ms.length < MIN_MEMBERS) throw new GameError(`Mindestens ${MIN_MEMBERS} Teams nötig`);
  const order = new Rng(seedFor("online-schedule", l.id, season)).shuffle(ms.map((m) => m.id));
  const rounds = roundRobin(order);
  for (let r = 0; r < rounds.length; r++) {
    for (const [h, a] of rounds[r]) {
      await query(db, "insert into online_fixtures(league_id, season, round, home_id, away_id) values ($1,$2,$3,$4,$5)", [l.id, season, r + 1, h, a]);
    }
  }
  await query(db, "update online_members set ready = false where league_id = $1", [l.id]);
  await query(db, "update online_leagues set status = 'running', season = $2, round = 0, rounds = $3, next_at = $4 where id = $1", [
    l.id, season, rounds.length, l.rhythm === "daily" ? new Date(Date.now() + 86_400_000) : null,
  ]);
  return rounds.length;
}

// ------------------------------------------------------------ Spieltag

interface Standing { memberId: number; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number; form: string[] }

function standings(ms: MemberRow[], fixtures: FixtureRow[]): Standing[] {
  const rows = new Map(ms.map((m) => [m.id, { memberId: m.id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] as string[] }]));
  for (const f of fixtures.filter((x) => x.played).sort((a, b) => a.round - b.round)) {
    const h = rows.get(f.home_id);
    const a = rows.get(f.away_id);
    if (!h || !a) continue;
    const hg = f.home_goals!;
    const ag = f.away_goals!;
    h.p++; a.p++; h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    if (hg > ag) { h.w++; a.l++; h.pts += 3; h.form.push("W"); a.form.push("L"); }
    else if (hg < ag) { a.w++; h.l++; a.pts += 3; a.form.push("W"); h.form.push("L"); }
    else { h.d++; a.d++; h.pts++; a.pts++; h.form.push("D"); a.form.push("D"); }
  }
  const name = new Map(ms.map((m) => [m.id, m.team.name]));
  return [...rows.values()]
    .map((r) => ({ ...r, form: r.form.slice(-5) }))
    .sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || name.get(x.memberId)!.localeCompare(name.get(y.memberId)!));
}

/** Spielt den nächsten Spieltag einer laufenden Liga. Erwartet gesperrte Liga. */
async function playRound(db: pg.PoolClient, l: LeagueRow): Promise<string> {
  if (l.status !== "running") throw new GameError("Die Liga läuft gerade nicht");
  const round = l.round + 1;
  const ms = await members(db, l.id);
  const byId = new Map(ms.map((m) => [m.id, m]));
  const fixtures = await query<FixtureRow>(db, "select * from online_fixtures where league_id = $1 and season = $2 and round = $3 and not played order by id", [l.id, l.season, round]);
  const loaded = new Map<number, { snapshot: Snapshot; team: OnlineTeam } | null>();
  for (const m of ms) {
    const t = await memberTeam(db, m);
    loaded.set(m.id, t);
    if (t) await query(db, "update online_members set team = $2, snapshot = $3 where id = $1", [m.id, JSON.stringify(t.team), JSON.stringify(t.snapshot)]);
  }
  const lines: string[] = [];
  const results: { home_id: number; away_id: number; hg: number; ag: number }[] = [];
  for (const f of fixtures) {
    const home = loaded.get(f.home_id);
    const away = loaded.get(f.away_id);
    let hg: number;
    let ag: number;
    let report: Report | null = null;
    if (!home || !away) {
      // Team ohne spielfähigen Kader: Wertung 3:0 für den Gegner
      [hg, ag] = home ? [3, 0] : [0, 3];
    } else {
      const homeIds = new Set(home.snapshot.players.map((p) => p.id));
      const awaySnap = away.snapshot.players.some((p) => homeIds.has(p.id)) ? shiftIds(away.snapshot, 100_000_000) : away.snapshot;
      const res = playMatch({ seed: seedFor("online-match", l.id, l.season, f.id), home: setupOf(home.snapshot, home.team, f.home_id), away: setupOf(awaySnap, away.team, f.away_id) });
      hg = res.homeGoals;
      ag = res.awayGoals;
      report = {
        events: res.events.filter((e) => KEY_EVENTS.has(e.type)).map((e) => ({ minute: e.minute, type: e.type, text: e.text, side: e.side })),
        stats: res.stats,
        players: res.players.map((p) => ({ playerId: p.playerId, name: p.name, side: p.side, minutes: p.minutes, rating: p.rating, goals: p.goals, started: p.started })),
        motm: res.motm,
      };
    }
    await query(db, "update online_fixtures set home_goals = $2, away_goals = $3, played = true, report = $4 where id = $1", [f.id, hg, ag, report ? JSON.stringify(report) : null]);
    lines.push(`${byId.get(f.home_id)?.team.name} ${hg}:${ag} ${byId.get(f.away_id)?.team.name}`);
    results.push({ home_id: f.home_id, away_id: f.away_id, hg, ag });
  }
  await query(db, "update online_members set ready = false where league_id = $1", [l.id]);
  const done = round >= l.rounds;
  await query(db, "update online_leagues set round = $2, status = $3, next_at = $4 where id = $1", [
    l.id, round, done ? "finished" : "running", // fester Tagestakt: verpasste Spieltage werden beim nächsten Aufruf nachgeholt
    !done && l.rhythm === "daily" ? new Date((l.next_at?.getTime() ?? Date.now()) + 86_400_000) : null,
  ]);
  l.round = round;
  if (done) l.status = "finished";
  await post(db, l.id, `${round}. Spieltag gespielt: ${lines.join(" · ") || "keine Partien"}`);
  let champion: string | null = null;
  if (done) {
    const all = await query<FixtureRow>(db, "select * from online_fixtures where league_id = $1 and season = $2", [l.id, l.season]);
    const top = standings(ms, all)[0];
    const champ = byId.get(top.memberId)!;
    champion = champ.team.name;
    await post(db, l.id, `🏆 ${champ.team.name} (${champ.bot ? "CPU" : champ.manager}) ist Meister der Saison ${l.season} mit ${top.pts} Punkten!`);
  }
  pushRound(l, round, ms, results, champion);
  return `${round}. Spieltag gespielt`;
}

/** Tägliche Ligen: fällige Spieltage beim Aufruf nachholen. */
async function catchUp(db: pg.PoolClient, l: LeagueRow) {
  let guard = 0;
  while (l.status === "running" && l.rhythm === "daily" && l.next_at && l.next_at.getTime() <= Date.now() && guard++ < 60) {
    await playRound(db, l);
    l.next_at = (await getLeague(db, l.id)).next_at;
  }
}

/** Hintergrunddienst: fällige Spieltage aller täglichen Ligen spielen (auch wenn niemand die Seite öffnet). */
export async function playDueOnlineLeagues(): Promise<number> {
  const due = await query<{ id: string }>(pool(), "select id from online_leagues where status = 'running' and rhythm = 'daily' and next_at <= now() order by next_at limit 20");
  let played = 0;
  for (const { id } of due) {
    played += await inLeague(id, async (db, l) => {
      const before = l.round;
      await catchUp(db, l);
      return l.round - before;
    });
  }
  return played;
}

async function inLeague<T>(leagueId: string, fn: (db: pg.PoolClient, l: LeagueRow) => Promise<T>): Promise<T> {
  return tx(async (db) => {
    await lockLeague(db, leagueId);
    const l = await getLeague(db, leagueId);
    return fn(db, l);
  });
}

function ownerOnly(l: LeagueRow, accountId: string) {
  if (l.owner_id !== accountId) throw new GameError("Nur der Ligagründer kann das", 403);
}

async function myMember(db: Db, l: LeagueRow, accountId: string) {
  return one<MemberRow>(db, "select * from online_members where league_id = $1 and account_id = $2 and not bot", [l.id, accountId]);
}

async function careerTeam(db: Db, accountId: string, careerId: string) {
  const career = await getCareer(db, careerId, accountId);
  if (!career) throw new GameError("Karriere nicht gefunden", 404);
  if (!career.club_id) throw new GameError("In dieser Karriere betreust du gerade keinen Verein");
  const m = { id: 0, league_id: "", account_id: accountId, career_id: career.id, club_id: career.club_id, bot: false, manager: career.manager_name, team: null as never, snapshot: null, ready: false };
  const t = await memberTeam(db, m);
  if (!t) throw new GameError("Der Kader dieser Karriere ist nicht spielfähig");
  return { career, ...t };
}

// ------------------------------------------------------------ Aktionen

export async function createOnlineLeague(accountId: string, input: { name: string; careerId: string; maxMembers: number; rhythm: string; public: boolean }) {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 40) throw new GameError("Der Liganame muss 3 bis 40 Zeichen lang sein");
  const max = Math.round(input.maxMembers);
  if (!(max >= MIN_MEMBERS && max <= MAX_MEMBERS)) throw new GameError(`Die Liga braucht ${MIN_MEMBERS} bis ${MAX_MEMBERS} Plätze`);
  const rhythm: Rhythm = input.rhythm === "daily" ? "daily" : "manual";
  if (input.public) await requireVerified(accountId);
  return tx(async (db) => {
    const owned = await one<{ n: number }>(db, "select count(*)::int as n from online_leagues where owner_id = $1 and status <> 'finished'", [accountId]);
    if ((owned?.n ?? 0) >= 5) throw new GameError("Du kannst höchstens 5 aktive Ligen gründen");
    const t = await careerTeam(db, accountId, input.careerId);
    let code = inviteCode();
    while (await one(db, "select 1 from online_leagues where code = $1", [code])) code = inviteCode();
    const l = await one<{ id: string }>(db, "insert into online_leagues(name, code, owner_id, max_members, rhythm, public) values ($1,$2,$3,$4,$5,$6) returning id", [name, code, accountId, max, rhythm, input.public]);
    await query(db, "insert into online_members(league_id, account_id, career_id, club_id, manager, team, snapshot) values ($1,$2,$3,$4,$5,$6,$7)", [
      l!.id, accountId, t.career.id, t.career.club_id, await displayName(db, accountId), JSON.stringify(t.team), JSON.stringify(t.snapshot),
    ]);
    await post(db, l!.id, `Liga „${name}“ gegründet. Einladungscode: ${code}`);
    return { id: l!.id, code, message: `Liga „${name}“ gegründet` };
  });
}

export async function joinOnlineLeague(accountId: string, input: { code?: string; leagueId?: string; careerId: string }) {
  const code = (input.code ?? "").trim().toUpperCase();
  const found = code
    ? await one<{ id: string }>(pool(), "select id from online_leagues where code = $1", [code])
    : input.leagueId ? await one<{ id: string }>(pool(), "select id from online_leagues where id::text = $1 and public", [input.leagueId]) : null;
  if (!found) throw new GameError("Keine Liga mit diesem Code gefunden", 404);
  return inLeague(found.id, async (db, l) => {
    if (l.status !== "open") throw new GameError("Diese Liga hat bereits begonnen");
    if (await myMember(db, l, accountId)) throw new GameError("Du bist bereits in dieser Liga");
    const ms = await members(db, l.id);
    if (ms.length >= l.max_members) throw new GameError("Die Liga ist voll");
    const t = await careerTeam(db, accountId, input.careerId);
    if (ms.some((m) => m.career_id === t.career.id && m.club_id === t.career.club_id)) throw new GameError("Dieser Verein spielt bereits in der Liga");
    const manager = await displayName(db, accountId);
    await query(db, "insert into online_members(league_id, account_id, career_id, club_id, manager, team, snapshot) values ($1,$2,$3,$4,$5,$6,$7)", [
      l.id, accountId, t.career.id, t.career.club_id, manager, JSON.stringify(t.team), JSON.stringify(t.snapshot),
    ]);
    await post(db, l.id, `${manager} ist mit ${t.team.name} beigetreten.`);
    pushJoin(l, manager, t.team.name);
    return { id: l.id, message: `Willkommen in „${l.name}“` };
  });
}

export async function leaveOnlineLeague(accountId: string, leagueId: string) {
  return inLeague(leagueId, async (db, l) => {
    const me = await myMember(db, l, accountId);
    if (!me) throw new GameError("Du bist nicht in dieser Liga");
    if (l.status === "running") throw new GameError("Während der Saison kannst du die Liga nicht verlassen");
    const humans = (await members(db, l.id)).filter((m) => !m.bot && m.id !== me.id);
    if (l.owner_id === accountId && humans.length === 0) {
      await query(db, "delete from online_leagues where id = $1", [l.id]);
      return { deleted: true, message: "Liga aufgelöst" };
    }
    if (l.status === "finished") {
      // Ergebnisse bleiben erhalten: nur das Konto vom Platz lösen
      await query(db, "update online_members set account_id = null, bot = true where id = $1", [me.id]);
    } else {
      await query(db, "delete from online_members where id = $1", [me.id]);
    }
    if (l.owner_id === accountId) await query(db, "update online_leagues set owner_id = $2 where id = $1", [l.id, humans[0].account_id]);
    await post(db, l.id, `${me.manager} hat die Liga verlassen.`);
    return { deleted: false, message: "Liga verlassen" };
  });
}

export async function kickOnlineMember(accountId: string, leagueId: string, memberId: number) {
  return inLeague(leagueId, async (db, l) => {
    ownerOnly(l, accountId);
    if (l.status !== "open") throw new GameError("Nur vor dem Saisonstart möglich");
    const m = await one<MemberRow>(db, "select * from online_members where id = $1 and league_id = $2", [memberId, l.id]);
    if (!m) throw new GameError("Teilnehmer nicht gefunden", 404);
    if (m.account_id === accountId) throw new GameError("Du kannst dich nicht selbst entfernen");
    await query(db, "delete from online_members where id = $1", [m.id]);
    await post(db, l.id, `${m.bot ? `CPU-Team ${m.team.name}` : m.manager} wurde aus der Liga entfernt.`);
    return { message: "Teilnehmer entfernt" };
  });
}

/** Füllt freie Plätze mit CPU-Vereinen aus der Liga der Gründer-Karriere. */
export async function addOnlineBots(accountId: string, leagueId: string, count: number) {
  return inLeague(leagueId, async (db, l) => {
    ownerOnly(l, accountId);
    if (l.status !== "open") throw new GameError("Nur vor dem Saisonstart möglich");
    const ms = await members(db, l.id);
    const free = l.max_members - ms.length;
    const n = Math.min(free, Math.max(1, Math.round(count)));
    if (n <= 0) throw new GameError("Keine freien Plätze");
    const owner = ms.find((m) => m.account_id === accountId && !m.bot);
    const career = owner?.career_id ? await getCareer(db, owner.career_id) : null;
    if (!career?.club_id) throw new GameError("Deine Karriere hat keinen Verein, aus dessen Liga CPU-Teams kommen könnten");
    const own = await getClub(db, career.id, career.club_id);
    const taken = new Set(ms.filter((m) => m.career_id === career.id).map((m) => m.club_id));
    taken.add(career.club_id);
    const pool_ = (await getClubs(db, career.id, "league_id = $2", [own!.league_id])).filter((c) => !taken.has(c.id));
    const extra = pool_.length < n ? (await getClubs(db, career.id, "country_code = $2", [own!.country_code])).filter((c) => !taken.has(c.id) && !pool_.some((p) => p.id === c.id)) : [];
    const picks = [...pool_.sort((a, b) => b.reputation - a.reputation), ...extra.sort((a, b) => b.reputation - a.reputation)].slice(0, n);
    let added = 0;
    for (const c of picks) {
      const m = { id: 0, league_id: l.id, account_id: null, career_id: career.id, club_id: c.id, bot: true, manager: "CPU", team: null as never, snapshot: null, ready: true };
      const t = await memberTeam(db, m);
      if (!t) continue;
      await query(db, "insert into online_members(league_id, account_id, career_id, club_id, bot, manager, team, snapshot, ready) values ($1,null,$2,$3,true,'CPU',$4,$5,true)", [
        l.id, career.id, c.id, JSON.stringify(t.team), JSON.stringify(t.snapshot),
      ]);
      added++;
    }
    if (!added) throw new GameError("Keine passenden CPU-Vereine gefunden");
    await post(db, l.id, `${added} CPU-${added === 1 ? "Team" : "Teams"} aufgefüllt.`);
    return { message: `${added} CPU-${added === 1 ? "Team" : "Teams"} hinzugefügt` };
  });
}

export async function startOnlineLeague(accountId: string, leagueId: string) {
  return inLeague(leagueId, async (db, l) => {
    ownerOnly(l, accountId);
    if (l.status === "running") throw new GameError("Die Saison läuft bereits");
    const season = l.status === "finished" ? l.season + 1 : l.season;
    const rounds = await schedule(db, l, season);
    await post(db, l.id, `Saison ${season} gestartet: ${rounds} Spieltage${l.rhythm === "daily" ? ", ein Spieltag pro Tag" : ""}.`);
    pushSeason(l, season, rounds, await members(db, l.id), accountId);
    return { message: `Saison ${season} gestartet` };
  });
}

export async function playOnlineRound(accountId: string, leagueId: string) {
  return inLeague(leagueId, async (db, l) => {
    ownerOnly(l, accountId);
    return { message: await playRound(db, l) };
  });
}

/** "Bereit" melden: sind alle menschlichen Teilnehmer bereit, wird sofort gespielt. */
export async function setOnlineReady(accountId: string, leagueId: string, ready: boolean) {
  return inLeague(leagueId, async (db, l) => {
    const me = await myMember(db, l, accountId);
    if (!me) throw new GameError("Du bist nicht in dieser Liga");
    if (l.status !== "running") throw new GameError("Die Liga läuft gerade nicht");
    await query(db, "update online_members set ready = $2 where id = $1", [me.id, ready]);
    const waiting = await one<{ n: number }>(db, "select count(*)::int as n from online_members where league_id = $1 and not bot and not ready", [l.id]);
    if (ready && (waiting?.n ?? 0) === 0) return { played: true, message: `Alle bereit · ${await playRound(db, l)}` };
    return { played: false, message: ready ? "Bereit gemeldet" : "Bereit-Meldung zurückgenommen" };
  });
}

export async function postOnlineMessage(accountId: string, leagueId: string, body: string) {
  const text = body.trim().replace(/\s+/g, " ");
  if (!text) throw new GameError("Nachricht ist leer");
  if (text.length > 400) throw new GameError("Höchstens 400 Zeichen");
  await requireVerified(accountId);
  return inLeague(leagueId, async (db, l) => {
    const me = await myMember(db, l, accountId);
    if (!me) throw new GameError("Nur Teilnehmer können schreiben", 403);
    const last = await one<{ n: number }>(db, "select count(*)::int as n from online_posts where league_id = $1 and account_id = $2 and created_at > now() - interval '1 minute'", [l.id, accountId]);
    if ((last?.n ?? 0) >= 6) throw new GameError("Langsam – zu viele Nachrichten in kurzer Zeit");
    await post(db, l.id, text, { id: accountId, name: me.manager });
    pushChat(l, await members(db, l.id), { id: accountId, name: me.manager }, text);
    return { message: "Gesendet" };
  });
}

/** Wechselt die Karriere bzw. den Verein, mit dem man antritt (nur vor Saisonstart). */
export async function switchOnlineTeam(accountId: string, leagueId: string, careerId: string) {
  return inLeague(leagueId, async (db, l) => {
    if (l.status === "running") throw new GameError("Während der Saison nicht möglich");
    const me = await myMember(db, l, accountId);
    if (!me) throw new GameError("Du bist nicht in dieser Liga");
    const t = await careerTeam(db, accountId, careerId);
    await query(db, "update online_members set career_id = $2, club_id = $3, team = $4, snapshot = $5 where id = $1", [me.id, t.career.id, t.career.club_id, JSON.stringify(t.team), JSON.stringify(t.snapshot)]);
    await post(db, l.id, `${me.manager} tritt jetzt mit ${t.team.name} an.`);
    return { message: `Du trittst mit ${t.team.name} an` };
  });
}

// ------------------------------------------------------------ Ansichten

export async function onlineOverview(accountId: string) {
  const mine = await query<LeagueRow & { members: number; member_id: number }>(
    pool(),
    `select l.*, (select count(*)::int from online_members x where x.league_id = l.id) as members, m.id as member_id
       from online_leagues l join online_members m on m.league_id = l.id and m.account_id = $1 and not m.bot
      order by l.created_at desc`,
    [accountId],
  );
  const open = await query<LeagueRow & { members: number; owner: string }>(
    pool(),
    `select l.*, (select count(*)::int from online_members x where x.league_id = l.id) as members, a.display_name as owner
       from online_leagues l join accounts a on a.id = l.owner_id
      where l.status = 'open' and l.public
        and not exists (select 1 from online_members x where x.league_id = l.id and x.account_id = $1)
        and (select count(*) from online_members x where x.league_id = l.id) < l.max_members
      order by l.created_at desc limit 12`,
    [accountId],
  );
  const careers = await query<{ id: string; manager_name: string; club_name: string; colors: { primary: string; secondary: string }; league_name: string; season: number }>(
    pool(),
    `select c.id, c.manager_name, cl.name as club_name, cl.colors, lg.name as league_name, c.season
       from careers c join clubs cl on cl.id = c.club_id join leagues lg on lg.id = cl.league_id
      where c.account_id = $1 order by c.updated_at desc`,
    [accountId],
  );
  const myTeams = await query<{ league_id: string; team: OnlineTeam }>(pool(), "select league_id, team from online_members where account_id = $1 and not bot", [accountId]);
  const teamOf = new Map(myTeams.map((t) => [t.league_id, t.team]));
  const card = (l: LeagueRow & { members: number }) => ({
    id: l.id, name: l.name, status: l.status, rhythm: l.rhythm, season: l.season, round: l.round, rounds: l.rounds, members: l.members, maxMembers: l.max_members,
  });
  return {
    leagues: mine.map((l) => ({ ...card(l), owner: l.owner_id === accountId, team: teamOf.get(l.id) ?? null })),
    open: open.map((l) => ({ ...card(l), ownerName: l.owner })),
    careers: careers.map((c) => ({ id: c.id, label: `${c.club_name} · ${c.league_name}`, club: c.club_name, colors: c.colors, season: c.season })),
  };
}

export async function onlineLeagueView(accountId: string, leagueId: string) {
  return inLeague(leagueId, async (db, l) => {
    await catchUp(db, l);
    const ms = await members(db, l.id);
    const me = ms.find((m) => m.account_id === accountId && !m.bot) ?? null;
    if (!me && !(l.public && l.status === "open")) throw new GameError("Du bist nicht in dieser Liga", 403);
    const fixtures = await query<FixtureRow>(db, "select id, season, round, home_id, away_id, home_goals, away_goals, played, report is not null as report from online_fixtures where league_id = $1 and season = $2 order by round, id", [l.id, l.season]);
    // Ausgeblendete Nachrichten und Nachrichten blockierter Mitglieder erscheinen nicht
    const posts = me ? await query<{ id: number; author: string; system: boolean; body: string; created_at: Date; account_id: string | null }>(db,
      `select id, author, system, body, created_at, account_id from online_posts where league_id = $1 and not hidden
         and (account_id is null or account_id not in (select blocked_id from online_blocks where account_id = $2)) order by id desc limit 60`, [l.id, accountId]) : [];
    const team = (id: number) => {
      const m = ms.find((x) => x.id === id);
      return m ? { memberId: m.id, name: m.team.name, short: m.team.short, colors: m.team.colors, manager: m.bot ? "CPU" : m.manager, mine: m.id === me?.id } : null;
    };
    const rounds = new Map<number, unknown[]>();
    for (const f of fixtures) {
      const list = rounds.get(f.round) ?? [];
      list.push({ id: f.id, home: team(f.home_id), away: team(f.away_id), homeGoals: f.home_goals, awayGoals: f.away_goals, played: f.played, hasReport: !!f.report });
      rounds.set(f.round, list);
    }
    const nextRound = l.status === "running" ? l.round + 1 : null;
    const myNext = me && nextRound ? fixtures.find((f) => f.round === nextRound && (f.home_id === me.id || f.away_id === me.id)) : null;
    return {
      id: l.id, name: l.name, code: me ? l.code : null, status: l.status, rhythm: l.rhythm, public: l.public, season: l.season, round: l.round, rounds: l.rounds,
      maxMembers: l.max_members, nextAt: l.next_at, isOwner: l.owner_id === accountId,
      me: me ? { memberId: me.id, ready: me.ready, careerId: me.career_id } : null,
      members: ms.map((m) => ({ id: m.id, manager: m.bot ? "CPU" : m.manager, bot: m.bot, team: m.team, ready: m.ready, mine: m.id === me?.id, owner: !m.bot && m.account_id === l.owner_id, orphan: !m.career_id })),
      table: standings(ms, fixtures).map((s, i) => ({ pos: i + 1, ...s, team: team(s.memberId) })),
      schedule: [...rounds.entries()].map(([round, matches]) => ({ round, matches })),
      nextRound,
      myNext: myNext ? { home: team(myNext.home_id), away: team(myNext.away_id), bye: false } : nextRound && me ? { bye: true } : null,
      waitingFor: l.status === "running" ? ms.filter((m) => !m.bot && !m.ready).map((m) => m.manager) : [],
      posts: posts.reverse().map((p) => ({ id: p.id, author: p.author, system: p.system, body: p.body, at: p.created_at, mine: p.account_id === accountId, canDelete: p.account_id === accountId || l.owner_id === accountId })),
    };
  });
}

export async function onlineMatchReport(accountId: string, leagueId: string, fixtureId: number) {
  const l = await getLeague(pool(), leagueId);
  const me = await myMember(pool(), l, accountId);
  if (!me) throw new GameError("Du bist nicht in dieser Liga", 403);
  const f = await one<FixtureRow>(pool(), "select * from online_fixtures where id = $1 and league_id = $2", [fixtureId, l.id]);
  if (!f) throw new GameError("Spiel nicht gefunden", 404);
  const ms = await members(pool(), l.id);
  const side = (id: number) => {
    const m = ms.find((x) => x.id === id)!;
    return { name: m.team.name, colors: m.team.colors, manager: m.bot ? "CPU" : m.manager, mine: m.id === me.id };
  };
  return { id: f.id, round: f.round, season: f.season, home: side(f.home_id), away: side(f.away_id), homeGoals: f.home_goals, awayGoals: f.away_goals, report: f.report };
}
