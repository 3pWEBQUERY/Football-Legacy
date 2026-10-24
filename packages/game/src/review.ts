/** Saisonrückblick: Auszeichnungen, Elf der Saison, Abschlusstabelle. */
import type { Player, Position } from "@fl/sim";
import type pg from "pg";
import { one, pool, query } from "./db";
import { readCareer } from "./career";
import type { WorldState } from "./world-state";

export interface AwardEntry {
  playerId: number;
  name: string;
  clubId: number;
  clubName: string;
  position: Position;
  age: number;
  value: string; // Kennzahl für die Anzeige
  own: boolean;
}

export interface SeasonReview {
  season: number;
  leagueName: string;
  table: { position: number; clubId: number; clubName: string; played: number; won: number; drawn: number; lost: number; gf: number; ga: number; points: number }[];
  awards: { key: string; title: string; entry: AwardEntry | null }[];
  teamOfSeason: AwardEntry[];
  club: { position: number; points: number; topScorer: AwardEntry | null; bestPlayer: AwardEntry | null; record: string; cup: string | null };
  cupWinner: string | null;
}

const avg = (p: Player) => (p.stats.apps ? p.stats.ratingSum / p.stats.apps : 0);

export function buildReview(
  w: WorldState,
  season: number,
  leagueId: number,
  table: { clubId: number; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; points: number }[],
  userClubId: number | null,
  cupWinner: string | null,
  userCup: string | null,
): SeasonReview {
  const league = w.leagues.get(leagueId)!;
  const clubIds = new Set(table.map((r) => r.clubId));
  const players = [...w.players.values()].filter((p) => p.clubId !== null && clubIds.has(p.clubId));
  const rounds = Math.max(1, ...table.map((r) => r.played));
  const regular = players.filter((p) => p.stats.apps >= Math.max(3, rounds * 0.4));
  const entry = (p: Player | undefined, value: string): AwardEntry | null =>
    p ? {
      playerId: p.id, name: `${p.firstName} ${p.lastName}`, clubId: p.clubId!, clubName: w.clubs.get(p.clubId!)?.name ?? "",
      position: p.position, age: p.age, value, own: p.clubId === userClubId,
    } : null;
  const best = (list: Player[], score: (p: Player) => number) => [...list].sort((a, b) => score(b) - score(a))[0];

  const pos = best(regular, avg);
  const scorer = best(players, (p) => p.stats.goals * 100 + p.stats.assists);
  const assister = best(players, (p) => p.stats.assists * 100 + p.stats.goals);
  const young = best(regular.filter((p) => p.age <= 21), avg);
  const keeper = best(players.filter((p) => p.position === "GK" && p.stats.apps >= 3), (p) => p.stats.cleanSheets * 10 + avg(p));

  // Elf der Saison (4-4-2) nach Durchschnittsnote
  const used = new Set<number>();
  const pick = (positions: Position[]) => {
    const p = best(regular.filter((x) => positions.includes(x.position) && !used.has(x.id)), avg);
    if (p) used.add(p.id);
    return p;
  };
  const shape: Position[][] = [["GK"], ["DR"], ["DC"], ["DC"], ["DL"], ["MR", "AMR"], ["MC", "DM", "AMC"], ["MC", "DM", "AMC"], ["ML", "AML"], ["ST"], ["ST", "AMC"]];
  const teamOfSeason = shape.map(pick).map((p) => entry(p, p ? avg(p).toFixed(2) : "")).filter(Boolean) as AwardEntry[];

  const own = players.filter((p) => p.clubId === userClubId);
  const ownRow = table.find((r) => r.clubId === userClubId);
  return {
    season,
    leagueName: league.name,
    table: table.map((r, i) => ({
      position: i + 1, clubId: r.clubId, clubName: w.clubs.get(r.clubId)?.name ?? "", played: r.played, won: r.won, drawn: r.drawn,
      lost: r.lost, gf: r.goalsFor, ga: r.goalsAgainst, points: r.points,
    })),
    awards: [
      { key: "pos", title: "Spieler der Saison", entry: entry(pos, pos ? `Ø ${avg(pos).toFixed(2)}` : "") },
      { key: "scorer", title: "Torschützenkönig", entry: entry(scorer, scorer ? `${scorer.stats.goals} Tore` : "") },
      { key: "assists", title: "Bester Vorbereiter", entry: entry(assister, assister ? `${assister.stats.assists} Vorlagen` : "") },
      { key: "young", title: "Talent der Saison", entry: entry(young, young ? `Ø ${avg(young).toFixed(2)}` : "") },
      { key: "keeper", title: "Torhüter der Saison", entry: entry(keeper, keeper ? `${keeper.stats.cleanSheets}× zu null` : "") },
    ],
    teamOfSeason,
    club: {
      position: ownRow ? table.indexOf(ownRow) + 1 : 0,
      points: ownRow?.points ?? 0,
      topScorer: ((p) => entry(p, p ? `${p.stats.goals} Tore` : ""))(best(own, (p) => p.stats.goals * 100 + p.stats.assists)),
      bestPlayer: ((p) => entry(p, p ? `Ø ${avg(p).toFixed(2)}` : ""))(best(own.filter((p) => p.stats.apps >= 3), avg)),
      record: ownRow ? `${ownRow.won} S · ${ownRow.drawn} U · ${ownRow.lost} N · ${ownRow.goalsFor}:${ownRow.goalsAgainst}` : "",
      cup: userCup,
    },
    cupWinner,
  };
}

export async function saveReview(db: pg.PoolClient, careerId: string, review: SeasonReview) {
  await query(db, "insert into season_reviews(career_id, season, data) values ($1,$2,$3) on conflict (career_id, season) do update set data = excluded.data", [
    careerId, review.season, JSON.stringify(review),
  ]);
}

export async function reviewView(careerId: string, accountId: string, season?: number) {
  const career = await readCareer(careerId, accountId);
  const seasons = await query<{ season: number }>(pool(), "select season from season_reviews where career_id = $1 order by season desc", [career.id]);
  const s = season ?? seasons[0]?.season;
  const row = s !== undefined ? await one<{ data: SeasonReview }>(pool(), "select data from season_reviews where career_id = $1 and season = $2", [career.id, s]) : null;
  return { seasons: seasons.map((x) => x.season), review: row?.data ?? null, userClubId: career.club_id };
}
