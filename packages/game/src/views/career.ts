/** Sichten: Karriere, Bestenlisten und Weltdaten. */
import { ACHIEVEMENTS, CARD_PACK, COUNTRIES, COUNTRY_BY_CODE, LEVEL_TITLES, SKINS, UNLOCKS, flagEmoji } from "@fl/sim";
import { difficultyOf, difficultySettings } from "../difficulty";
import { readCareer } from "../career";
import { pool, query } from "../db";
import { careerSummary } from "./common";

// ---------------------------------------------------------------- Karriere

export async function careerView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const m = career.manager;
  return {
    career: careerSummary(career),
    manager: { ...m, missions: undefined },
    achievements: ACHIEVEMENTS.map((a) => ({ ...a, unlockedAt: m.achievements[a.id] ?? null })),
    unlocks: UNLOCKS.map((u) => ({ ...u, unlocked: m.level >= u.level })),
    levelTitles: LEVEL_TITLES,
    skins: SKINS.map((s) => ({ ...s, owned: m.skins.includes(s.id), active: m.activeSkin === s.id })),
    cardPack: CARD_PACK,
    jobOffers: career.job_offers,
    history: m.history,
    difficulty: { id: difficultyOf(career), ...difficultySettings(career) },
  };
}

export async function leaderboards() {
  const best = await query(pool(),
    `select r.season, r.club_name, r.league_name, r.country_code, r.tier, r.position, r.points, r.played, r.ppg, r.champion, r.promoted,
            a.display_name, c.manager_name, (c.manager->>'level')::int as level
       from season_results r join accounts a on a.id = r.account_id join careers c on c.id = r.career_id
      where r.played >= 10 order by r.ppg desc, r.points desc limit 25`);
  const levels = await query(pool(),
    `select c.manager_name, a.display_name, (c.manager->>'level')::int as level, (c.manager->>'xp')::int as xp,
            (c.manager->'totals'->>'titles')::int as titles, cl.name as club_name
       from careers c join accounts a on a.id = c.account_id left join clubs cl on cl.id = c.club_id
      order by (c.manager->>'xp')::int desc limit 25`);
  const titles = await query(pool(),
    `select a.display_name, c.manager_name, count(*) filter (where r.champion)::int as titles, count(*) filter (where r.promoted)::int as promotions, count(*)::int as seasons
       from season_results r join accounts a on a.id = r.account_id join careers c on c.id = r.career_id
      group by a.display_name, c.manager_name having count(*) filter (where r.champion or r.promoted) > 0
      order by titles desc, promotions desc limit 25`);
  return { best, levels, titles };
}

export function worldMeta() {
  return {
    countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name, flag: flagEmoji(c.code), strength: c.strength, confed: c.confed, tiers: c.tiers.length })),
    countryByCode: Object.fromEntries(Object.entries(COUNTRY_BY_CODE).map(([k, v]) => [k, { name: v.name, flag: flagEmoji(k) }])),
  };
}
