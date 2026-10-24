/** Landespokal im Spielbetrieb: Rundenabschluss, Auslosung, Prämien. */
import { Rng, drawCupRound, formatMoney, seedFor } from "@fl/sim";
import type pg from "pg";
import { one, pool, query } from "./db";
import { insertCupFixtures, readCareer } from "./career";
import { type CareerRow, type FixtureRow, addFinance, addInbox, getClubs } from "./repo";
import { type RewardNote, grantXp, unlockAchievement } from "./rewards";
import type { WorldState } from "./world-state";

export interface CupRow {
  id: number;
  career_id: string;
  season: number;
  country_code: string;
  name: string;
  rounds: { round: number; name: string; week: number }[];
  byes: number[];
  current_round: number;
  winner_club_id: number | null;
  runner_up_club_id: number | null;
}

export interface CupWeekInfo {
  name: string;
  roundName: string;
  userStatus: "advanced" | "eliminated" | "winner" | "runner_up" | "out" | "not_involved";
  nextRoundName: string | null;
}

export function fixtureWinner(f: Pick<FixtureRow, "home_id" | "away_id" | "home_goals" | "away_goals" | "pen_home" | "pen_away">): number {
  const hg = f.home_goals ?? 0;
  const ag = f.away_goals ?? 0;
  if (hg !== ag) return hg > ag ? f.home_id : f.away_id;
  return (f.pen_home ?? 0) > (f.pen_away ?? 0) ? f.home_id : f.away_id;
}

/** Schliesst eine Pokalrunde ab und lost die nächste aus. */
export async function advanceCup(db: pg.PoolClient, career: CareerRow, w: WorldState, cupId: number, notes: RewardNote[]): Promise<CupWeekInfo | null> {
  const cup = await one<CupRow>(db, "select * from cups where id = $1 and career_id = $2", [cupId, career.id]);
  if (!cup || cup.winner_club_id) return null;
  const roundFixtures = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and cup_id = $2 and cup_round = $3", [career.id, cupId, cup.current_round]);
  if (!roundFixtures.length || roundFixtures.some((f) => !f.played)) return null;
  const round = cup.rounds.find((r) => r.round === cup.current_round)!;
  const userId = career.club_id;
  const winners = roundFixtures.map(fixtureWinner);
  const userFixture = roundFixtures.find((f) => f.home_id === userId || f.away_id === userId);
  let entrants = winners;
  if (cup.current_round === 1 && cup.byes.length) entrants = [...winners, ...cup.byes];
  const userClub = userId ? w.clubs.get(userId) : undefined;
  const info: CupWeekInfo = { name: cup.name, roundName: round.name, userStatus: "not_involved", nextRoundName: null };

  if (entrants.length <= 1) {
    // Finale entschieden
    const final = roundFixtures[0];
    const winner = winners[0];
    const runnerUp = final.home_id === winner ? final.away_id : final.home_id;
    await query(db, "update cups set winner_club_id = $2, runner_up_club_id = $3 where id = $1", [cupId, winner, runnerUp]);
    const wc = w.clubs.get(winner);
    if (wc) {
      wc.reputation = Math.min(100, wc.reputation + 3);
      if (wc.players_generated && wc.finance) wc.balance += wc.finance.tvWeekly * 8;
      w.dirtyClubs.add(wc.id);
    }
    if (winner === userId && userClub) {
      info.userStatus = "winner";
      career.manager.totals.cups = (career.manager.totals.cups ?? 0) + 1;
      unlockAchievement(career, "cup_winner", notes);
      grantXp(career, 250, notes);
      career.manager.reputation = Math.min(100, career.manager.reputation + 4);
      career.board.confidence = Math.min(100, career.board.confidence + 10);
      const prize = (userClub.finance?.tvWeekly ?? 50_000) * 8;
      await addFinance(db, career.id, userClub.id, career.season, career.week, [{ kind: "prize", amount: prize, label: `Pokalsieg ${cup.name}` }]);
      await addInbox(db, career.id, career.season, career.week, "board", `Pokalsieger!`,
        `${userClub.name} gewinnt den ${cup.name}. Der Vorstand ist begeistert, die Siegprämie beträgt ${formatMoney(prize)}.`);
    } else if (runnerUp === userId) {
      info.userStatus = "runner_up";
      grantXp(career, 80, notes);
      await addInbox(db, career.id, career.season, career.week, "match", "Finale verloren",
        `${userClub?.name} verliert das Finale des ${cup.name} gegen ${wc?.name}. Trotzdem eine starke Pokalsaison.`);
    } else {
      await addInbox(db, career.id, career.season, career.week, "news", `${cup.name}: ${wc?.name} holt den Pokal`,
        `${wc?.name} gewinnt das Finale gegen ${w.clubs.get(runnerUp)?.name}.`);
    }
    return info;
  }

  // Nutzerstatus in dieser Runde
  if (userFixture) {
    const won = fixtureWinner(userFixture) === userId;
    info.userStatus = won ? "advanced" : "eliminated";
    if (won && userClub) {
      const prize = Math.round(((userClub.finance?.tvWeekly ?? 40_000) * (cup.current_round + 1)) / 2 / 1000) * 1000;
      await addFinance(db, career.id, userClub.id, career.season, career.week, [{ kind: "prize", amount: prize, label: `Pokal: ${round.name} überstanden` }]);
      grantXp(career, 30 + cup.current_round * 10, notes);
    }
  } else if (userId && cup.byes.includes(userId) && cup.current_round === 1) {
    info.userStatus = "advanced";
  } else {
    info.userStatus = "out";
  }

  // Nächste Runde auslosen
  const next = cup.rounds.find((r) => r.round === cup.current_round + 1);
  if (!next) return info;
  const leagueTier = (clubId: number) => w.leagues.get(w.clubs.get(clubId)?.league_id ?? -1)?.tier ?? 9;
  const pairs = drawCupRound(
    new Rng(seedFor(career.seed, "cup", career.season, next.round)),
    entrants.map((id) => ({ id, tier: leagueTier(id), rating: w.clubs.get(id)?.rating ?? 50 })),
  );
  await insertCupFixtures(db, career.id, career.season, cupId, next.round, next.week, pairs);
  await query(db, "update cups set current_round = $2 where id = $1", [cupId, next.round]);
  info.nextRoundName = next.name;
  const userPair = pairs.find((p) => p.includes(userId ?? -1));
  if (userPair && userClub) {
    const opp = w.clubs.get(userPair[0] === userId ? userPair[1] : userPair[0]);
    await addInbox(db, career.id, career.season, career.week, "match", `${cup.name}: Auslosung ${next.name}`,
      `${userClub.name} trifft im ${next.name} ${userPair[0] === userId ? "zu Hause" : "auswärts"} auf ${opp?.name}.`);
  } else if (info.userStatus === "eliminated") {
    await addInbox(db, career.id, career.season, career.week, "match", `${cup.name}: Ausgeschieden`,
      `${userClub?.name} ist im ${round.name} ausgeschieden.`);
  }
  return info;
}

/** Pokalübersicht für die Oberfläche. */
export async function cupView(careerId: string, accountId: string, season?: number) {
  const career = await readCareer(careerId, accountId);
  const s = season ?? career.season;
  const cup = await one<CupRow>(pool(), "select * from cups where career_id = $1 and season = $2 order by id desc limit 1", [career.id, s]);
  if (!cup) return { cup: null, rounds: [], userClubId: career.club_id };
  const fixtures = await query<FixtureRow>(pool(), "select * from fixtures where career_id = $1 and cup_id = $2 order by cup_round, id", [career.id, cup.id]);
  const ids = [...new Set(fixtures.flatMap((f) => [f.home_id, f.away_id]).concat(cup.byes, cup.winner_club_id ? [cup.winner_club_id] : []))];
  const clubs = ids.length ? await getClubs(pool(), career.id, "id = any($2::int[])", [ids]) : [];
  const byId = new Map(clubs.map((c) => [c.id, { id: c.id, name: c.name, short: c.short_name, colors: c.colors, rating: c.rating }]));
  const tierRows = await query<{ id: number; tier: number }>(pool(), "select c.id, l.tier from clubs c join leagues l on l.id = c.league_id where c.career_id = $1 and c.id = any($2::int[])", [career.id, ids]);
  const tier = new Map(tierRows.map((r) => [r.id, r.tier]));
  const rounds = cup.rounds.map((r) => ({
    ...r,
    current: r.round === cup.current_round && !cup.winner_club_id,
    matches: fixtures.filter((f) => f.cup_round === r.round).map((f) => ({
      id: f.id, played: f.played, homeGoals: f.home_goals, awayGoals: f.away_goals, penHome: f.pen_home, penAway: f.pen_away,
      home: { ...byId.get(f.home_id)!, tier: tier.get(f.home_id) }, away: { ...byId.get(f.away_id)!, tier: tier.get(f.away_id) },
      winnerId: f.played ? fixtureWinner(f) : null,
    })),
  }));
  return {
    cup: { id: cup.id, name: cup.name, season: cup.season, currentRound: cup.current_round, winner: cup.winner_club_id ? byId.get(cup.winner_club_id) : null, byes: cup.byes.length },
    rounds,
    userClubId: career.club_id,
  };
}
