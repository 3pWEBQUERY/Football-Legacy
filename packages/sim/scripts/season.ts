/**
 * Eine komplette Ligasaison in der Konsole (ohne Grafik). Beispiel:
 *   pnpm sim:season GER 1
 */
import {
  COUNTRY_BY_CODE, Rng, computeStandings, createSchedule, defaultTactic, generateSquad, generateWorld, playMatch,
  roundsFor, teamRating, type Player,
} from "../src/index";

const code = process.argv[2] ?? "GER";
const tier = Number(process.argv[3] ?? 1);
const seed = Number(process.argv[4] ?? 2026);
const country = COUNTRY_BY_CODE[code];
if (!country) throw new Error(`Unbekanntes Land ${code}`);

const world = generateWorld(seed, 2026, [country]);
const league = world.leagues.find((l) => l.tier === tier)!;
let pid = 1;
const clubs = world.clubs
  .filter((c) => c.leagueKey === league.key)
  .map((c, i) => {
    const id = i + 1;
    const players: Player[] = generateSquad(seed, { id, countryCode: c.countryCode, rating: c.rating, reputation: c.reputation }, 2026, () => pid++);
    return { ...c, id, players, tactic: defaultTactic(players), strength: teamRating(players) };
  });
const weeks = roundsFor(clubs.length);
const schedule = createSchedule(clubs.map((c) => c.id), weeks, new Rng(seed));
const byId = new Map(clubs.map((c) => [c.id, c]));
const played: { homeId: number; awayId: number; homeGoals: number; awayGoals: number; round: number }[] = [];
const scorers = new Map<number, { name: string; club: string; goals: number }>();

const t0 = Date.now();
for (const m of schedule) {
  const h = byId.get(m.homeId)!;
  const a = byId.get(m.awayId)!;
  const r = playMatch({
    seed: seed * 1000 + played.length,
    home: { clubId: h.id, name: h.name, shortName: h.shortName, colors: h.colors, tactic: h.tactic, players: h.players },
    away: { clubId: a.id, name: a.name, shortName: a.shortName, colors: a.colors, tactic: a.tactic, players: a.players },
  });
  played.push({ homeId: h.id, awayId: a.id, homeGoals: r.homeGoals, awayGoals: r.awayGoals, round: m.round });
  for (const line of r.players) {
    if (!line.goals) continue;
    const club = line.side === 0 ? h : a;
    const cur = scorers.get(line.playerId) ?? { name: line.name, club: club.shortName, goals: 0 };
    cur.goals += line.goals;
    scorers.set(line.playerId, cur);
  }
}
const table = computeStandings(clubs.map((c) => c.id), played);
const goals = played.reduce((s, f) => s + f.homeGoals + f.awayGoals, 0);
console.log(`\n${country.name} – ${league.name} (${clubs.length} Vereine, ${played.length} Spiele, ${(goals / played.length).toFixed(2)} Tore/Spiel, ${Date.now() - t0} ms)\n`);
console.log("Pl  Verein                              Stärke  Sp   S  U  N   Tore   Pkt");
table.forEach((r, i) => {
  const c = byId.get(r.clubId)!;
  console.log(
    `${String(i + 1).padStart(2)}. ${c.name.padEnd(35)} ${String(c.strength).padStart(5)}  ${String(r.played).padStart(3)} ${String(r.won).padStart(3)}${String(r.drawn).padStart(3)}${String(r.lost).padStart(3)}  ${`${r.goalsFor}:${r.goalsAgainst}`.padStart(6)}  ${String(r.points).padStart(4)}`,
  );
});
console.log("\nTorschützen:");
[...scorers.values()].sort((a, b) => b.goals - a.goals).slice(0, 10).forEach((s, i) => console.log(`${i + 1}. ${s.name} (${s.club}) – ${s.goals}`));
