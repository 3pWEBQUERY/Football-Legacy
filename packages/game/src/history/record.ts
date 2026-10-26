/**
 * Vereinsgeschichte: Am Saisonende wird für jeden Verein die Saison archiviert
 * (Platz, Bilanz, Pokale, Trainer, Torschützenkönig, höchster Sieg und höchste
 * Niederlage) und für jeden Spieler die Bilanz je Verein fortgeschrieben – so
 * bleiben Rekorde auch nach Transfers und Karriereende erhalten.
 */
import type { Player, StandingRow } from "@fl/sim";
import { query, type Db } from "../db";
import { coachOf, getMarket } from "../jobs/core";
import { addArticle } from "../media";
import type { CareerRow, FixtureRow, LeagueRow } from "../repo";
import type { WorldState } from "../world-state";

export interface MatchMark { season: number; oppId: number; oppName: string; gf: number; ga: number; home: boolean; competition: string }
export interface TopScorer { playerId: number; name: string; goals: number }

interface CupRow { id: number; kind: string; name: string; rounds: { round: number; name: string }[]; winner_club_id: number | null; runner_up_club_id: number | null }

/** Wer steigt auf, wer ab? Gleiche Regel wie beim Wechsel der Ligen am Saisonende. */
export function movements(w: WorldState, tables: Map<number, number[]>) {
  const up = new Set<number>();
  const down = new Set<number>();
  const byCountry = new Map<string, LeagueRow[]>();
  for (const l of w.leagues.values()) byCountry.set(l.country_code, [...(byCountry.get(l.country_code) ?? []), l]);
  const moves: { upper: LeagueRow; lower: LeagueRow; down: number[]; up: number[] }[] = [];
  for (const leagues of byCountry.values()) {
    leagues.sort((a, b) => a.tier - b.tier);
    for (let i = 0; i < leagues.length - 1; i++) {
      const upper = leagues[i];
      const lower = leagues[i + 1];
      const n = Math.min(upper.relegation, lower.promotion);
      const d = n ? (tables.get(upper.id) ?? []).slice(-n) : [];
      const u = (tables.get(lower.id) ?? []).slice(0, n);
      d.forEach((id) => down.add(id));
      u.forEach((id) => up.add(id));
      moves.push({ upper, lower, down: d, up: u });
    }
  }
  return { up, down, moves };
}

/** Pokalabschneiden je Verein: Sieger, Finale oder die zuletzt erreichte Runde. */
function cupResults(cups: CupRow[], fixtures: FixtureRow[]) {
  const out = new Map<number, { national?: string; continental?: string }>();
  for (const cup of cups) {
    const reached = new Map<number, number>();
    for (const f of fixtures) {
      if (f.cup_id !== cup.id) continue;
      for (const id of [f.home_id, f.away_id]) reached.set(id, Math.max(reached.get(id) ?? 0, f.cup_round ?? 0));
    }
    for (const [clubId, round] of reached) {
      const text = cup.winner_club_id === clubId ? "Sieger" : cup.runner_up_club_id === clubId ? "Finale"
        : cup.rounds.find((r) => r.round === round)?.name ?? null;
      if (!text) continue;
      const entry = out.get(clubId) ?? {};
      entry[cup.kind === "continental" ? "continental" : "national"] = text;
      out.set(clubId, entry);
    }
  }
  return out;
}

/** Höchster Sieg und höchste Niederlage der Saison je Verein (alle Wettbewerbe). */
function extremes(w: WorldState, fixtures: FixtureRow[], cups: CupRow[], season: number) {
  const best = new Map<number, MatchMark>();
  const worst = new Map<number, MatchMark>();
  const cupName = new Map(cups.map((c) => [c.id, c.name]));
  const better = (a: MatchMark, b?: MatchMark) => !b || a.gf - a.ga > b.gf - b.ga || (a.gf - a.ga === b.gf - b.ga && a.gf > b.gf);
  const worse = (a: MatchMark, b?: MatchMark) => !b || a.ga - a.gf > b.ga - b.gf || (a.ga - a.gf === b.ga - b.gf && a.ga > b.ga);
  for (const f of fixtures) {
    if (!f.played || f.home_goals === null || f.away_goals === null) continue;
    const competition = f.cup_id ? cupName.get(f.cup_id) ?? "Pokal" : w.leagues.get(f.league_id)?.name ?? "Liga";
    for (const home of [true, false]) {
      const id = home ? f.home_id : f.away_id;
      const oppId = home ? f.away_id : f.home_id;
      const gf = home ? f.home_goals : f.away_goals;
      const ga = home ? f.away_goals : f.home_goals;
      const mark: MatchMark = { season, oppId, oppName: w.clubs.get(oppId)?.name ?? "?", gf, ga, home, competition };
      if (gf > ga && better(mark, best.get(id))) best.set(id, mark);
      if (gf < ga && worse(mark, worst.get(id))) worst.set(id, mark);
    }
  }
  return { best, worst };
}

/**
 * Archiviert die abgelaufene Saison. Muss vor Auf-/Abstieg und vor dem
 * Zurücksetzen der Spielerstatistiken laufen.
 */
export async function recordSeason(db: Db, career: CareerRow, w: WorldState, standings: Map<number, StandingRow[]>, fixtures: FixtureRow[]) {
  const season = career.season;
  const cups = await query<CupRow>(db, "select id, kind, name, rounds, winner_club_id, runner_up_club_id from cups where career_id = $1 and season = $2", [career.id, season]);
  const cupsBy = cupResults(cups, fixtures);
  const { best, worst } = extremes(w, fixtures, cups, season);
  const { up, down } = movements(w, new Map([...standings].map(([id, rows]) => [id, rows.map((r) => r.clubId)])));
  const market = await getMarket(db, career.id);
  const rows: Record<string, unknown>[] = [];
  for (const [leagueId, table] of standings) {
    const league = w.leagues.get(leagueId);
    if (!league) continue;
    table.forEach((r, i) => {
      const club = w.clubs.get(r.clubId);
      if (!club) return;
      const own = club.id === career.club_id;
      const top = (w.squads.get(club.id) ?? []).reduce<Player | null>((a, p) => (p.stats.goals > (a?.stats.goals ?? 0) ? p : a), null);
      rows.push({
        career_id: career.id, season, club_id: club.id, league_id: league.id, league_name: league.name, tier: league.tier, position: i + 1,
        played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, gf: r.goalsFor, ga: r.goalsAgainst, points: r.points,
        champion: i === 0 && r.played > 0, promoted: up.has(club.id), relegated: down.has(club.id),
        cup: cupsBy.get(club.id)?.national ?? null, continental: cupsBy.get(club.id)?.continental ?? null,
        manager: own ? career.manager_name : coachOf(market, club), user_managed: own,
        top_scorer: top ? { playerId: top.id, name: `${top.firstName} ${top.lastName}`, goals: top.stats.goals } satisfies TopScorer : null,
        best_win: best.get(club.id) ?? null, worst_loss: worst.get(club.id) ?? null,
      });
    });
  }
  if (rows.length) {
    await query(db,
      `insert into club_seasons select * from jsonb_populate_recordset(null::club_seasons, $1::jsonb) on conflict do nothing`,
      [JSON.stringify(rows)]);
  }

  // Spielerbilanzen je Verein fortschreiben
  const players = [...w.players.values()].filter((p) => p.clubId !== null && p.stats.apps > 0).map((p) => ({
    career_id: career.id, player_id: p.id, club_id: p.clubId, name: `${p.firstName} ${p.lastName}`, position: p.position, nationality: p.nationality,
    seasons: 1, apps: p.stats.apps, goals: p.stats.goals, assists: p.stats.assists, rating_sum: p.stats.ratingSum,
    first_season: season, last_season: season, peak_rating: p.rating, retired_season: null,
  }));
  if (players.length) {
    await query(db,
      `insert into player_careers select * from jsonb_populate_recordset(null::player_careers, $1::jsonb)
       on conflict (career_id, player_id, club_id) do update set
         seasons = player_careers.seasons + 1, apps = player_careers.apps + excluded.apps, goals = player_careers.goals + excluded.goals,
         assists = player_careers.assists + excluded.assists, rating_sum = player_careers.rating_sum + excluded.rating_sum,
         last_season = excluded.last_season, peak_rating = greatest(player_careers.peak_rating, excluded.peak_rating),
         name = excluded.name, position = excluded.position`,
      [JSON.stringify(players)]);
  }
}

/** Ab diesen Werten ist ein Karriereende eine Meldung wert. */
const NOTABLE = { apps: 200, goals: 80, peak: 84, peakApps: 40 };
const NEWS_MAX = 6;

/**
 * Karriereenden: markiert die Spieler in den Bilanzen und meldet die
 * bemerkenswerten Abschiede in den Medien. Liefert Abschiedstexte für eigene Spieler.
 */
export async function recordRetirements(db: Db, career: CareerRow, w: WorldState, retired: { player: Player; clubId: number | null }[]): Promise<string[]> {
  if (!retired.length) return [];
  const ids = retired.map((r) => r.player.id);
  await query(db, "update player_careers set retired_season = $3 where career_id = $1 and player_id = any($2::int[])", [career.id, ids, career.season]);
  const totals = await query<{ player_id: number; apps: number; goals: number; clubs: number; peak: number; best_club: number }>(db,
    `select player_id, sum(apps)::int as apps, sum(goals)::int as goals, count(*)::int as clubs, max(peak_rating)::int as peak,
            (array_agg(club_id order by apps desc))[1] as best_club
       from player_careers where career_id = $1 and player_id = any($2::int[]) group by player_id`, [career.id, ids]);
  const byId = new Map(totals.map((t) => [t.player_id, t]));
  const own: string[] = [];
  const notable: { line: string; score: number }[] = [];
  for (const { player: p, clubId } of retired) {
    const t = byId.get(p.id);
    const name = `${p.firstName} ${p.lastName}`;
    const line = t ? `${name} (${p.age}) – ${t.apps} Spiele, ${t.goals} ${t.goals === 1 ? "Tor" : "Tore"} bei ${t.clubs} ${t.clubs === 1 ? "Verein" : "Vereinen"}` : `${name} (${p.age})`;
    if (clubId !== null && clubId === career.club_id) own.push(line);
    if (t && (t.apps >= NOTABLE.apps || t.goals >= NOTABLE.goals || (t.peak >= NOTABLE.peak && t.apps >= NOTABLE.peakApps))) {
      const club = w.clubs.get(t.best_club);
      notable.push({ line: `${line}${club ? `, prägte vor allem ${club.name}` : ""}`, score: t.apps + t.goals * 2 + t.peak * 3 });
    }
  }
  if (notable.length) {
    const top = notable.sort((a, b) => b.score - a.score).slice(0, NEWS_MAX).map((n) => n.line);
    await addArticle(db, career, {
      kind: "league", importance: 2,
      title: notable.length === 1 ? `Karriereende: ${top[0].split(" (")[0]} hört auf` : `${notable.length} grosse Namen beenden ihre Karriere`,
      body: `Zum Saisonende verabschieden sich bekannte Gesichter vom Profifussball:\n${top.map((n) => `• ${n}`).join("\n")}` +
        (notable.length > top.length ? `\n… und ${notable.length - top.length} weitere.` : "") + "\n\nAlle Legenden findest du in der Ruhmeshalle.",
    });
  }
  return own;
}
