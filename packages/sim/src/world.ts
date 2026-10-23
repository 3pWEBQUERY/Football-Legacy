/**
 * Weltgenerator: erzeugt aus den Länderprofilen Ligen und Vereine. Spieler werden
 * erst erzeugt, wenn eine Liga "aktiv" wird (eigenes Land, Scouting, Transfer),
 * damit die ganze Welt tragbar bleibt.
 */
import { COUNTRIES, COUNTRY_BY_CODE, type CountryProfile } from "./data/countries";
import { NAME_POOLS } from "./data/names";
import { Rng, clamp, seedFor } from "./rng";
import { SQUAD_TEMPLATE, generatePlayer } from "./player";
import type { Club, ClubColors, League, Player, Position } from "./types";

export interface WorldLeague extends Omit<League, "id"> {
  key: string; // eindeutiger Schlüssel, z. B. GER-1
}

export interface WorldClub extends Omit<Club, "id" | "leagueId" | "tactic" | "playersGenerated"> {
  leagueKey: string;
}

const PALETTE = [
  "#c8102e", "#003da5", "#ffd100", "#00843d", "#000000", "#ffffff", "#6c1d45", "#ff6900", "#5bc2e7",
  "#7a263a", "#1d428a", "#e4002b", "#009639", "#fdb913", "#8a2be2", "#3c3c3c", "#a6192e", "#0057b8",
];

export function leagueName(country: CountryProfile, tier: number): string {
  const pool = NAME_POOLS[country.region];
  const pattern = pool.leagueNames[Math.min(tier - 1, pool.leagueNames.length - 1)];
  const base = pattern.replace("{n} ", "").replace("{n}", "");
  // Zusätzliche Stufen ohne eigenen Namen bekommen eine Nummer
  if (tier > pool.leagueNames.length) return `${base} ${tier - pool.leagueNames.length + 1}`;
  return base;
}

/** Erwartete Durchschnittsstärke einer Liga (1–100). */
export function leagueLevel(country: CountryProfile, tier: number): number {
  return 38 + country.strength * 3.7 - (tier - 1) * 6.5;
}

/**
 * Städte, deren Name in Kombination mit unseren Mustern einen echten,
 * bekannten Verein ergeben könnte. Diese werden nie erzeugt.
 */
const BLOCKED_TOWNS = new Set([
  "Freiburg", "Oberhausen", "Augsburg", "Burton", "Westham", "Villareal", "Porto Alegre", "Rio Branco", "Rio Grande",
  "Campo Grande", "Santa Clara", "Bahía Blanca", "Krasnodar", "Volgograd", "Krasnoyarsk", "Zelenograd", "Akhisar",
  "Eskişehir", "Al-Hilal", "Kawasaki", "Matsumoto", "Okayama", "Gwangju", "Daegu", "Cheonan", "Gangwon", "Cheonju",
  "Shanghai", "Nanning", "Wolverhampton", "Kingstonian", "Stanley", "Belfort", "Vila Nova", "Nordhausen", "Neustadt",
  "Steinbach", "Sandhausen", "Wiesbaden", "Eichstätt", "Hoffenheim", "Rosenheim", "Ulmstadt", "Bergamo", "Monteforte",
  "Stockport", "Ashford", "Sutton", "Whitby", "Eastbourne", "Northwood", "Fairfield", "Greenwood", "Kingsford",
  "Puerto Real", "Fuenlabrada", "Valdemoro", "Almendralejo", "Mirandés", "Lyngby", "Holmsund", "Sandvik",
]);

export function townName(rng: Rng, region: string): string {
  const pool = NAME_POOLS[region];
  for (let tries = 0; ; tries++) {
    const pre = rng.pick(pool.townPre);
    const suf = rng.pick(pool.townSuf);
    let name = pre.endsWith("-") || suf.startsWith(" ") ? pre + suf : pre + suf.toLowerCase();
    if (pre.endsWith("-")) name = pre + suf.charAt(0).toUpperCase() + suf.slice(1);
    name = name.trim();
    if (!BLOCKED_TOWNS.has(name) || tries > 30) return name;
  }
}

function clubName(rng: Rng, region: string, town: string): string {
  const pool = NAME_POOLS[region];
  return rng.pick(pool.clubPatterns).replace("{c}", town).replace("Al-Al-", "Al-");
}

function shortFrom(name: string, town: string): string {
  const parts = town.split(/[\s-]+/).filter(Boolean);
  const base = parts.length > 1 ? parts.map((p) => p[0]).join("") : town.slice(0, 3);
  void name;
  return base.toUpperCase().slice(0, 4);
}

function colors(rng: Rng): ClubColors {
  const primary = rng.pick(PALETTE);
  let secondary = rng.pick(PALETTE);
  while (secondary === primary) secondary = rng.pick(PALETTE);
  return { primary, secondary };
}

export interface GeneratedWorld {
  leagues: WorldLeague[];
  clubs: WorldClub[];
}

export function generateWorld(seed: number, season: number, countries: CountryProfile[] = COUNTRIES): GeneratedWorld {
  const leagues: WorldLeague[] = [];
  const clubs: WorldClub[] = [];
  for (const country of countries) {
    const rng = new Rng(seedFor(seed, "country", country.code));
    const usedNames = new Set<string>();
    country.tiers.forEach((size, i) => {
      const tier = i + 1;
      const key = `${country.code}-${tier}`;
      const isLast = tier === country.tiers.length;
      const promotion = tier === 1 ? 0 : size >= 18 ? 3 : 2;
      const relegation = isLast ? 0 : country.tiers[i + 1] >= 18 ? 3 : 2;
      leagues.push({
        key, countryCode: country.code, tier, name: leagueName(country, tier), size, promotion, relegation, active: false,
      });
      const level = leagueLevel(country, tier);
      for (let r = 0; r < size; r++) {
        // Rangabhängige Stärke: einige Favoriten, breites Mittelfeld, Abstiegskandidaten
        const rank = r / Math.max(1, size - 1); // 0 = stärkster
        const spread = 15 - country.strength * 0.4;
        const rating = clamp(Math.round(level + spread * (0.55 - rank) + rng.normal(0, 1.6)), 25, 90);
        let town = townName(rng, country.region);
        let name = clubName(rng, country.region, town);
        for (let tries = 0; usedNames.has(name) && tries < 20; tries++) {
          town = townName(rng, country.region);
          name = clubName(rng, country.region, town);
        }
        usedNames.add(name);
        const reputation = clamp(Math.round(rating * 1.05 - 8 + rng.normal(0, 3)), 1, 100);
        const capacity = Math.round(
          clamp((900 + Math.pow(Math.max(0, rating - 30), 2.3) * 6) * rng.range(0.7, 1.3), 800, 85_000) / 100,
        ) * 100;
        clubs.push({
          leagueKey: key,
          countryCode: country.code,
          name,
          shortName: shortFrom(name, town),
          city: town,
          reputation,
          rating,
          balance: 0,
          transferBudget: 0,
          wageBudget: 0,
          capacity,
          colors: colors(rng),
          founded: rng.int(1880, 1990),
        });
      }
    });
  }
  return { leagues, clubs };
}

/** Nationalitätenmix: überwiegend einheimisch, etwas Ausland je nach Stärke. */
function pickNationality(rng: Rng, country: CountryProfile, rating: number): string {
  const foreignShare = clamp(0.1 + (country.strength - 4) * 0.05 + (rating - 55) / 120, 0.05, 0.55);
  if (!rng.chance(foreignShare)) return country.code;
  // Ausländer stammen bevorzugt aus dem gleichen Verband oder aus starken Talentländern
  const pool = COUNTRIES.filter((c) => c.code !== country.code);
  return pool[rng.weighted(pool.map((c) => Math.pow(c.strength, 2.4) * (c.confed === country.confed ? 2.5 : 1)))].code;
}

/** Erzeugt einen kompletten Kader (deterministisch pro Verein). */
export function generateSquad(
  worldSeed: number,
  club: { id: number; countryCode: string; rating: number; reputation: number },
  season: number,
  nextId: () => number,
): Player[] {
  const rng = new Rng(seedFor(worldSeed, "squad", club.id));
  const country = COUNTRY_BY_CODE[club.countryCode];
  const players: Player[] = [];
  SQUAD_TEMPLATE.forEach((position: Position, i) => {
    // Stammspieler stärker, Ergänzungsspieler schwächer
    const depth = i < 11 ? 2.5 : -3;
    const isStarterSlot = [0, 3, 4, 7, 9, 11, 13, 14, 16, 17, 21].includes(i);
    const target = clamp(Math.round(club.rating + (isStarterSlot ? 2.5 : depth - 1) + rng.normal(0, 3.2)), 20, 92);
    const youngster = i >= 22 || rng.chance(0.12);
    players.push(
      generatePlayer(rng, {
        id: nextId(),
        clubId: club.id,
        nationality: pickNationality(rng, country, club.rating),
        position,
        targetRating: youngster ? target - 6 : target,
        age: youngster ? rng.int(17, 20) : undefined,
        season,
        reputation: club.reputation,
      }),
    );
  });
  return players;
}

/** Jugendjahrgang: jährlich 2–4 Talente. */
export function generateYouthIntake(
  worldSeed: number,
  club: { id: number; countryCode: string; rating: number; reputation: number },
  season: number,
  academyQuality: number,
  nextId: () => number,
): Player[] {
  const rng = new Rng(seedFor(worldSeed, "youth", club.id, season));
  const count = rng.int(2, 4);
  const positions: Position[] = ["GK", "DC", "DR", "DL", "DM", "MC", "AMC", "AMR", "AML", "ST", "MR", "ML"];
  const out: Player[] = [];
  for (let i = 0; i < count; i++) {
    const p = generatePlayer(rng, {
      id: nextId(),
      clubId: club.id,
      nationality: rng.chance(0.85) ? club.countryCode : pickNationality(rng, COUNTRY_BY_CODE[club.countryCode], club.rating),
      position: rng.pick(positions),
      targetRating: clamp(Math.round(club.rating - 16 + rng.normal(0, 4) + academyQuality / 10), 20, 75),
      age: rng.int(16, 17),
      season,
      reputation: club.reputation,
      youth: true,
    });
    if (p.contract) {
      p.contract.wage = Math.max(300, Math.round(p.contract.wage * 0.4 / 100) * 100);
      p.contract.untilSeason = season + 3;
    }
    out.push(p);
  }
  return out;
}
