/**
 * Ruhmeshalle: dein Vermächtnis als Manager (Stufen nach Titeln und
 * Erfolgen, Trophäenschrank, Stationen) und die grössten Spieler der Welt –
 * Legenden im Ruhestand, aktive Rekordspieler und die jüngsten Abschiede.
 */
import { pool, query } from "../db";
import { readCareer } from "../career";

/** Vermächtnis-Punkte: Titel zählen am meisten, Beständigkeit gibt den Rest. */
export const LEGACY_LEVELS = [
  { min: 0, name: "Neuling", text: "Der Weg in die Ruhmeshalle beginnt." },
  { min: 250, name: "Aufgenommen", text: "Dein Name steht in der Ruhmeshalle." },
  { min: 700, name: "Bronze", text: "Ein Trainer mit Spuren im Fussball." },
  { min: 1500, name: "Silber", text: "Ein Name, den man in den Vereinen kennt." },
  { min: 3000, name: "Gold", text: "Einer der Grossen deiner Zeit." },
  { min: 6000, name: "Legende", text: "Dein Vermächtnis überdauert Generationen." },
];

export function legacyPoints(t: { titles: number; cups?: number; continental?: number; promotions: number; seasons: number; wins: number }) {
  return t.titles * 250 + (t.continental ?? 0) * 400 + (t.cups ?? 0) * 120 + t.promotions * 90 + t.seasons * 25 + t.wins * 2;
}

interface WorldLine { player_id: number; name: string; position: string; nationality: string; apps: number; goals: number; assists: number; clubs: number; peak: number; retired: number | null; club_id: number; club: string | null; seasons: number }

const playerScore = (l: WorldLine) => l.apps + l.goals * 2 + l.assists + l.peak * 3;
/** In die Ruhmeshalle kommt, wer eine grosse Karriere beendet hat (archivierte Werte). */
const HALL = { apps: 150, goals: 60, peak: 84, peakApps: 40 };
const hallWorthy = (l: WorldLine) => l.apps >= HALL.apps || l.goals >= HALL.goals || (l.peak >= HALL.peak && l.apps >= HALL.peakApps);

export async function hallOfFameView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const m = career.manager;
  const t = m.totals;
  const points = legacyPoints(t);
  const levelIndex = LEGACY_LEVELS.reduce((i, l, j) => (points >= l.min ? j : i), 0);
  const next = LEGACY_LEVELS[levelIndex + 1] ?? null;

  // Trophäenschrank des Managers
  const trophies = [
    ...m.history.filter((h) => h.champion).map((h) => ({ season: h.season, kind: "league", title: `Meister ${h.leagueName}`, club: h.clubName })),
    ...m.history.filter((h) => h.cup === "Pokalsieger").map((h) => ({ season: h.season, kind: "cup", title: "Pokalsieger", club: h.clubName })),
    ...m.history.filter((h) => h.promoted && !h.champion).map((h) => ({ season: h.season, kind: "promotion", title: `Aufstieg aus der ${h.leagueName}`, club: h.clubName })),
  ].sort((a, b) => b.season - a.season);
  const db = pool();
  const continental = await query<{ season: number; name: string; club: string }>(db,
    `select cu.season, cu.name, c.name as club from cups cu join club_seasons s on s.career_id = cu.career_id and s.season = cu.season and s.club_id = cu.winner_club_id and s.user_managed
       join clubs c on c.career_id = cu.career_id and c.id = cu.winner_club_id
      where cu.career_id = $1 and cu.kind = 'continental'`, [career.id]);
  trophies.unshift(...continental.map((c) => ({ season: c.season, kind: "continental", title: c.name, club: c.club })));

  // Stationen
  const stations: { club: string; from: number; to: number; seasons: number; titles: number; promotions: number; best: number; league: string }[] = [];
  for (const h of m.history) {
    const last = stations[stations.length - 1];
    if (last && last.club === h.clubName && last.to === h.season - 1) {
      Object.assign(last, { to: h.season, seasons: last.seasons + 1, titles: last.titles + (h.champion ? 1 : 0), promotions: last.promotions + (h.promoted ? 1 : 0), best: Math.min(last.best, h.position) });
    } else {
      stations.push({ club: h.clubName, from: h.season, to: h.season, seasons: 1, titles: h.champion ? 1 : 0, promotions: h.promoted ? 1 : 0, best: h.position, league: h.leagueName });
    }
  }

  // Weltweite Spielerlegenden aus allen archivierten Bilanzen
  const lines = await query<WorldLine>(db,
    `select pc.player_id, max(pc.name) as name, max(pc.position) as position, max(pc.nationality) as nationality,
            sum(pc.apps)::int as apps, sum(pc.goals)::int as goals, sum(pc.assists)::int as assists, count(*)::int as clubs,
            max(pc.peak_rating)::int as peak, max(pc.retired_season) as retired, sum(pc.seasons)::int as seasons,
            (array_agg(pc.club_id order by pc.apps desc))[1] as club_id,
            (array_agg(c.name order by pc.apps desc))[1] as club
       from player_careers pc left join clubs c on c.career_id = pc.career_id and c.id = pc.club_id
      where pc.career_id = $1 group by pc.player_id`, [career.id]);
  const row = (l: WorldLine) => ({
    playerId: l.player_id, name: l.name, position: l.position, nationality: l.nationality, apps: l.apps, goals: l.goals, assists: l.assists,
    clubs: l.clubs, peak: l.peak, retired: l.retired, club: l.club, clubId: l.club_id, seasons: l.seasons, score: playerScore(l),
  });
  const ranked = [...lines].sort((a, b) => playerScore(b) - playerScore(a));
  const legends = ranked.filter((l) => l.retired !== null && hallWorthy(l)).slice(0, 20).map(row);
  const active = ranked.filter((l) => l.retired === null).slice(0, 10).map(row);
  const lastRetired = Math.max(0, ...lines.map((l) => l.retired ?? 0));
  const farewells = lastRetired ? ranked.filter((l) => l.retired === lastRetired).slice(0, 8).map(row) : [];

  // Rekordmeister je Topliga: eigenes Land zuerst, dann nach Titeln
  const champions = await query<{ club_id: number; name: string; league: string; country: string; titles: number; last: number; own: boolean }>(db,
    `select distinct on (s.league_id) s.club_id, c.name, s.league_name as league, c.country_code as country, t.titles, t.last, c.country_code = $2 as own
       from club_seasons s
       join clubs c on c.career_id = s.career_id and c.id = s.club_id
       join lateral (select count(*)::int as titles, max(season) as last from club_seasons x
                      where x.career_id = s.career_id and x.club_id = s.club_id and x.champion and x.tier = 1 and x.league_id = s.league_id) t on true
      where s.career_id = $1 and s.champion and s.tier = 1
      order by s.league_id, t.titles desc, t.last desc`, [career.id, career.country_code]);
  champions.sort((a, b) => Number(b.own) - Number(a.own) || b.titles - a.titles || b.last - a.last || a.league.localeCompare(b.league));
  champions.splice(12);

  return {
    manager: {
      name: career.manager_name, reputation: Math.round(m.reputation), level: m.level, points, levels: LEGACY_LEVELS, levelIndex,
      next: next ? { name: next.name, min: next.min, missing: next.min - points } : null,
      totals: { ...t, cups: t.cups ?? 0, continental: t.continental ?? 0, matches: t.wins + t.draws + t.losses },
      winRate: t.wins + t.draws + t.losses ? Math.round((t.wins / (t.wins + t.draws + t.losses)) * 100) : 0,
    },
    trophies,
    stations: stations.reverse(),
    legends,
    active,
    farewells: { season: lastRetired || null, players: farewells },
    champions,
    hallRule: HALL,
  };
}
