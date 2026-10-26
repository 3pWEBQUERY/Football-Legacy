/**
 * Vereinsgeschichte und Rekorde: Titel, Saisonbilanzen, Trainer, Rekordspieler,
 * Rekordtransfers, höchste Siege und Niederlagen sowie die Vereinslegenden.
 * Die laufende Saison fliesst live mit ein.
 */
import { pool, query, type Db } from "../db";
import { readCareer } from "../career";
import { GameError } from "../errors";
import { coachOf, getMarket } from "../jobs/core";
import { type CareerRow, type FixtureRow, getClub, getPlayers } from "../repo";
import type { MatchMark, TopScorer } from "./record";

export interface ClubSeasonRow {
  season: number; club_id: number; league_id: number; league_name: string; tier: number; position: number;
  played: number; won: number; drawn: number; lost: number; gf: number; ga: number; points: number;
  champion: boolean; promoted: boolean; relegated: boolean; cup: string | null; continental: string | null;
  manager: string | null; user_managed: boolean; top_scorer: TopScorer | null; best_win: MatchMark | null; worst_loss: MatchMark | null;
}

export interface CareerLine {
  playerId: number; name: string; position: string; nationality: string; seasons: number; apps: number; goals: number; assists: number;
  avgRating: number | null; firstSeason: number; lastSeason: number; peak: number; retired: number | null; current: boolean;
}

/** Ab hier gilt ein Spieler als Vereinslegende. */
export const LEGEND = { apps: 150, goals: 60, seasons: 7 };
export const legendScore = (l: Pick<CareerLine, "apps" | "goals" | "assists" | "seasons">) => l.apps + l.goals * 2 + l.assists + l.seasons * 5;
export const isLegend = (l: CareerLine) => l.apps >= LEGEND.apps || l.goals >= LEGEND.goals || (l.seasons >= LEGEND.seasons && l.apps >= 100);

/** Spielerbilanzen eines Vereins: archivierte Saisons plus die laufende Saison des aktuellen Kaders. */
export async function clubCareers(db: Db, career: CareerRow, clubId: number): Promise<CareerLine[]> {
  const rows = await query<{
    player_id: number; name: string; position: string; nationality: string; seasons: number; apps: number; goals: number; assists: number;
    rating_sum: number; first_season: number; last_season: number; peak_rating: number; retired_season: number | null;
  }>(db, "select * from player_careers where career_id = $1 and club_id = $2", [career.id, clubId]);
  const lines = new Map<number, CareerLine>(rows.map((r) => [r.player_id, {
    playerId: r.player_id, name: r.name, position: r.position, nationality: r.nationality, seasons: r.seasons, apps: r.apps, goals: r.goals,
    assists: r.assists, avgRating: r.apps ? Math.round((r.rating_sum / r.apps) * 10) / 10 : null, firstSeason: r.first_season,
    lastSeason: r.last_season, peak: r.peak_rating, retired: r.retired_season, current: false,
  }]));
  for (const p of await getPlayers(db, career.id, [clubId])) {
    const l = lines.get(p.id);
    const s = p.stats;
    if (l) {
      const sum = (l.avgRating ?? 0) * l.apps + s.ratingSum;
      l.apps += s.apps; l.goals += s.goals; l.assists += s.assists;
      if (s.apps) { l.seasons += 1; l.lastSeason = career.season; }
      l.avgRating = l.apps ? Math.round((sum / l.apps) * 10) / 10 : null;
      l.peak = Math.max(l.peak, p.rating);
      l.current = true;
    } else if (s.apps > 0) {
      lines.set(p.id, {
        playerId: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, nationality: p.nationality, seasons: 1, apps: s.apps,
        goals: s.goals, assists: s.assists, avgRating: Math.round((s.ratingSum / s.apps) * 10) / 10, firstSeason: career.season,
        lastSeason: career.season, peak: p.rating, retired: null, current: true,
      });
    }
  }
  return [...lines.values()];
}

/** Höchster Sieg und höchste Niederlage der laufenden Saison. */
async function liveExtremes(db: Db, career: CareerRow, clubId: number) {
  const fx = await query<FixtureRow & { opp: string; comp: string | null }>(db,
    `select f.*, c.name as opp, coalesce(cu.name, l.name) as comp from fixtures f
       join clubs c on c.career_id = f.career_id and c.id = case when f.home_id = $3 then f.away_id else f.home_id end
       left join cups cu on cu.id = f.cup_id
       left join leagues l on l.career_id = f.career_id and l.id = f.league_id
      where f.career_id = $1 and f.season = $2 and f.played and $3 in (f.home_id, f.away_id)`,
    [career.id, career.season, clubId]);
  return fx.map((f): MatchMark => {
    const home = f.home_id === clubId;
    return { season: career.season, oppId: home ? f.away_id : f.home_id, oppName: f.opp, gf: (home ? f.home_goals : f.away_goals) ?? 0, ga: (home ? f.away_goals : f.home_goals) ?? 0, home, competition: f.comp ?? "Spiel" };
  });
}

const top = <T>(items: T[], key: (x: T) => number, n = 10) => [...items].filter((x) => key(x) > 0).sort((a, b) => key(b) - key(a)).slice(0, n);

export async function clubHistoryView(careerId: string, accountId: string, clubId?: number) {
  const career = await readCareer(careerId, accountId);
  const id = clubId ?? career.club_id;
  if (!id) throw new GameError("Kein Verein");
  const db = pool();
  const club = await getClub(db, career.id, id);
  if (!club) throw new GameError("Verein nicht gefunden", 404);
  const seasons = await query<ClubSeasonRow>(db, "select * from club_seasons where career_id = $1 and club_id = $2 order by season desc", [career.id, id]);
  const cups = await query<{ season: number; name: string; kind: string; won: boolean }>(db,
    `select season, name, kind, winner_club_id = $2 as won from cups where career_id = $1 and (winner_club_id = $2 or runner_up_club_id = $2) order by season desc`,
    [career.id, id]);

  // Titel und Erfolge
  const honours = [
    ...seasons.filter((s) => s.champion).map((s) => ({ season: s.season, kind: s.tier === 1 ? "league" : "lower", title: `Meister ${s.league_name}${s.promoted ? " · Aufstieg" : ""}` })),
    ...cups.filter((c) => c.won).map((c) => ({ season: c.season, kind: c.kind === "continental" ? "continental" : "cup", title: c.name })),
    ...seasons.filter((s) => s.promoted && !s.champion).map((s) => ({ season: s.season, kind: "promotion", title: `Aufstieg aus der ${s.league_name}` })),
  ].sort((a, b) => b.season - a.season);
  const count = (k: string) => honours.filter((h) => h.kind === k).length;

  // Rekordspieler (inklusive laufender Saison)
  const careers = await clubCareers(db, career, id);
  const line = (l: CareerLine) => ({ ...l });
  const legends = careers.filter(isLegend).sort((a, b) => legendScore(b) - legendScore(a)).map(line);

  // Rekordtransfers
  const transfers = await query<{ player_id: number; player_name: string; fee: number; season: number; other: string | null; dir: "in" | "out" }>(db,
    `select t.player_id, t.player_name, t.fee::float8 as fee, t.season, c.name as other, case when t.to_club = $2 then 'in' else 'out' end as dir
       from transfers t left join clubs c on c.career_id = t.career_id and c.id = case when t.to_club = $2 then t.from_club else t.to_club end
      where t.career_id = $1 and t.status = 'completed' and t.fee > 0 and t.kind not like 'loan%' and $2 in (t.to_club, t.from_club)
      order by t.fee desc limit 40`, [career.id, id]);

  // Höchste Siege und Niederlagen
  const marks = [...seasons.flatMap((s) => [s.best_win, s.worst_loss]).filter((m): m is MatchMark => !!m), ...await liveExtremes(db, career, id)];
  const wins = marks.filter((m) => m.gf > m.ga).sort((a, b) => b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf).slice(0, 5);
  const losses = marks.filter((m) => m.gf < m.ga).sort((a, b) => b.ga - b.gf - (a.ga - a.gf) || b.ga - a.ga).slice(0, 5);

  // Trainerhistorie: aufeinanderfolgende Saisons mit demselben Trainer
  const coaches: { name: string; from: number; to: number; seasons: number; played: number; won: number; drawn: number; lost: number; titles: number; you: boolean; current: boolean }[] = [];
  for (const s of [...seasons].reverse()) {
    const name = s.manager ?? "unbekannt";
    const last = coaches[coaches.length - 1];
    if (last && last.name === name && last.to === s.season - 1) {
      Object.assign(last, { to: s.season, seasons: last.seasons + 1, played: last.played + s.played, won: last.won + s.won, drawn: last.drawn + s.drawn, lost: last.lost + s.lost, titles: last.titles + (s.champion ? 1 : 0) });
    } else {
      coaches.push({ name, from: s.season, to: s.season, seasons: 1, played: s.played, won: s.won, drawn: s.drawn, lost: s.lost, titles: s.champion ? 1 : 0, you: s.user_managed, current: false });
    }
  }
  const nowCoach = id === career.club_id ? career.manager_name : coachOf(await getMarket(db, career.id), club);
  const last = coaches[coaches.length - 1];
  if (last && last.name === nowCoach && last.to === career.season - 1) Object.assign(last, { current: true, you: id === career.club_id || last.you });
  else coaches.push({ name: nowCoach, from: career.season, to: career.season, seasons: 0, played: 0, won: 0, drawn: 0, lost: 0, titles: 0, you: id === career.club_id, current: true });

  const best = [...seasons].sort((a, b) => a.tier - b.tier || a.position - b.position || b.points - a.points)[0] ?? null;
  return {
    club: { id: club.id, name: club.name, short: club.short_name, colors: club.colors, founded: club.founded, city: club.city, own: id === career.club_id },
    season: career.season,
    summary: {
      seasons: seasons.length, titles: count("league"), lowerTitles: count("lower"), cups: count("cup"), continental: count("continental"), promotions: seasons.filter((x) => x.promoted).length,
      relegations: seasons.filter((s) => s.relegated).length, finals: cups.filter((c) => !c.won).length,
      bestSeason: best ? { season: best.season, league: best.league_name, position: best.position, points: best.points } : null,
      mostPoints: seasons.length ? [...seasons].sort((a, b) => b.points - a.points)[0] : null,
    },
    honours,
    seasons: seasons.map((s) => ({
      season: s.season, league: s.league_name, tier: s.tier, position: s.position, played: s.played, won: s.won, drawn: s.drawn, lost: s.lost,
      gf: s.gf, ga: s.ga, points: s.points, champion: s.champion, promoted: s.promoted, relegated: s.relegated, cup: s.cup, continental: s.continental,
      manager: s.manager, you: s.user_managed, topScorer: s.top_scorer,
    })),
    records: {
      apps: top(careers, (l) => l.apps).map(line),
      goals: top(careers, (l) => l.goals).map(line),
      assists: top(careers, (l) => l.assists).map(line),
      seasonGoals: top(seasons.filter((s) => s.top_scorer).map((s) => ({ ...s.top_scorer!, season: s.season })), (x) => x.goals, 5),
      buys: transfers.filter((t) => t.dir === "in").slice(0, 5),
      sales: transfers.filter((t) => t.dir === "out").slice(0, 5),
      wins, losses,
    },
    coaches: coaches.reverse(),
    legends,
    legendRule: LEGEND,
  };
}
