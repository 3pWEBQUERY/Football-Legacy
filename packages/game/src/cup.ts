/** Landespokal im Spielbetrieb: Rundenabschluss, Auslosung, Prämien. */
import { GROUP_ROUNDS, Rng, computeStandings, drawCupRound, drawKnockout, formatMoney, seedFor } from "@fl/sim";
import type pg from "pg";
import { type Db, one, pool, query } from "./db";
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
  kind: "national" | "continental" | "playoff";
  groups: number[][] | null;
}

export interface CupWeekInfo {
  name: string;
  roundName: string;
  userStatus: "advanced" | "eliminated" | "winner" | "runner_up" | "out" | "not_involved" | "group";
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
  if (!cup || cup.winner_club_id || cup.kind === "playoff") return null;
  const roundFixtures = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and cup_id = $2 and cup_round = $3", [career.id, cupId, cup.current_round]);
  if (!roundFixtures.length || roundFixtures.some((f) => !f.played)) return null;
  if (cup.kind === "continental" && cup.current_round <= GROUP_ROUNDS) return advanceGroupStage(db, career, w, cup, roundFixtures, notes);
  const round = cup.rounds.find((r) => r.round === cup.current_round)!;
  const userId = career.club_id;
  const continental = cup.kind === "continental";
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
    const factor = continental ? 20 : 8;
    if (wc) {
      wc.reputation = Math.min(100, wc.reputation + (continental ? 6 : 3));
      if (wc.players_generated && wc.finance && wc.id !== userId) wc.balance += wc.finance.tvWeekly * factor;
      w.dirtyClubs.add(wc.id);
    }
    if (winner === userId && userClub) {
      info.userStatus = "winner";
      if (continental) {
        career.manager.totals.continental = (career.manager.totals.continental ?? 0) + 1;
        unlockAchievement(career, "continental_winner", notes);
      } else {
        career.manager.totals.cups = (career.manager.totals.cups ?? 0) + 1;
        unlockAchievement(career, "cup_winner", notes);
      }
      grantXp(career, continental ? 600 : 250, notes);
      career.manager.reputation = Math.min(100, career.manager.reputation + (continental ? 10 : 4));
      career.board.confidence = Math.min(100, career.board.confidence + (continental ? 20 : 10));
      const prize = (userClub.finance?.tvWeekly ?? 50_000) * factor;
      await addFinance(db, career.id, userClub.id, career.season, career.week, [{ kind: "prize", amount: prize, label: `Titel: ${cup.name}` }]);
      await addInbox(db, career.id, career.season, career.week, "board", continental ? `${cup.name} gewonnen!` : "Pokalsieger!",
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
      const stage = continental ? (cup.current_round - GROUP_ROUNDS + 1) * 3 : cup.current_round + 1;
      const prize = Math.round(((userClub.finance?.tvWeekly ?? 40_000) * stage) / 2 / 1000) * 1000;
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
    new Rng(seedFor(career.seed, continental ? "continental-ko" : "cup", career.season, next.round)),
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

/** Ein Spieltag der Gruppenphase ist abgeschlossen; nach dem sechsten wird die erste K.-o.-Runde ausgelost. */
async function advanceGroupStage(db: pg.PoolClient, career: CareerRow, w: WorldState, cup: CupRow, roundFixtures: FixtureRow[], notes: RewardNote[]): Promise<CupWeekInfo> {
  const userId = career.club_id;
  const userClub = userId ? w.clubs.get(userId) : undefined;
  const round = cup.rounds.find((r) => r.round === cup.current_round)!;
  const groups = cup.groups ?? [];
  const userGroup = groups.findIndex((g) => g.includes(userId ?? -1));
  const info: CupWeekInfo = { name: cup.name, roundName: round.name, userStatus: userGroup >= 0 ? "group" : "not_involved", nextRoundName: null };
  const tv = userClub?.finance?.tvWeekly ?? 40_000;

  // Antrittsprämie und Punktprämien
  const uf = roundFixtures.find((f) => f.home_id === userId || f.away_id === userId);
  if (uf && userClub) {
    const gf = uf.home_id === userId ? uf.home_goals! : uf.away_goals!;
    const ga = uf.home_id === userId ? uf.away_goals! : uf.home_goals!;
    const entries: { kind: string; amount: number; label: string }[] = [];
    if (cup.current_round === 1) entries.push({ kind: "prize", amount: tv * 3, label: `Antrittsprämie ${cup.name}` });
    if (gf > ga) entries.push({ kind: "prize", amount: tv, label: `${cup.name}: Siegprämie` });
    else if (gf === ga) entries.push({ kind: "prize", amount: Math.round(tv / 3), label: `${cup.name}: Punktprämie` });
    if (entries.length) await addFinance(db, career.id, userClub.id, career.season, career.week, entries);
    if (gf > ga) grantXp(career, 25, notes);
  }

  const next = cup.rounds.find((r) => r.round === cup.current_round + 1);
  if (cup.current_round < GROUP_ROUNDS) {
    await query(db, "update cups set current_round = $2 where id = $1", [cup.id, cup.current_round + 1]);
    info.nextRoundName = next?.name ?? null;
    return info;
  }

  // Abschlusstabellen der Gruppen
  const all = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and cup_id = $2 and group_no is not null", [career.id, cup.id]);
  const winners: { id: number; group: number }[] = [];
  const runners: { id: number; group: number }[] = [];
  let userPos = 0;
  groups.forEach((g, gi) => {
    const table = computeStandings(g, all.filter((f) => f.group_no === gi).map((f) => ({
      homeId: f.home_id, awayId: f.away_id, homeGoals: f.home_goals, awayGoals: f.away_goals, round: f.cup_round ?? 0,
    })));
    winners.push({ id: table[0].clubId, group: gi });
    runners.push({ id: table[1].clubId, group: gi });
    if (gi === userGroup) userPos = table.findIndex((r) => r.clubId === userId) + 1;
  });
  if (userGroup >= 0 && userClub) {
    const letter = String.fromCharCode(65 + userGroup);
    if (userPos <= 2) {
      info.userStatus = "advanced";
      unlockAchievement(career, "continental_group", notes);
      grantXp(career, 120, notes);
      career.board.confidence = Math.min(100, career.board.confidence + 5);
      await addFinance(db, career.id, userClub.id, career.season, career.week, [{ kind: "prize", amount: tv * 4, label: `${cup.name}: K.-o.-Runde erreicht` }]);
    } else {
      info.userStatus = "eliminated";
      await addInbox(db, career.id, career.season, career.week, "match", `${cup.name}: Aus in der Gruppenphase`,
        `${userClub.name} beendet die Gruppe ${letter} auf Platz ${userPos} und scheidet aus.`);
    }
  }
  if (!next) return info;
  const pairs = drawKnockout(new Rng(seedFor(career.seed, "continental-ko", career.season, next.round)), winners, runners);
  await insertCupFixtures(db, career.id, career.season, cup.id, next.round, next.week, pairs);
  await query(db, "update cups set current_round = $2 where id = $1", [cup.id, next.round]);
  info.nextRoundName = next.name;
  const userPair = pairs.find((p) => p.includes(userId ?? -1));
  if (userPair && userClub) {
    const opp = w.clubs.get(userPair[0] === userId ? userPair[1] : userPair[0]);
    await addInbox(db, career.id, career.season, career.week, "match", `${cup.name}: Auslosung ${next.name}`,
      `${userClub.name} hat die Gruppenphase als ${userPos === 1 ? "Gruppensieger" : "Gruppenzweiter"} überstanden und trifft im ${next.name} ${userPair[0] === userId ? "zu Hause" : "auswärts"} auf ${opp?.name}.`);
  }
  return info;
}

export interface CompetitionInfo {
  kind: "league" | "cup" | "continental";
  name: string;
  label: string;
}

/** Wettbewerb und Runde einer Partie, z. B. "Kontinentalpokal Europa · Gruppenphase · 2. Spieltag". */
export async function competitionOf(db: Db, f: FixtureRow): Promise<CompetitionInfo> {
  if (f.cup_id) {
    const cup = await one<{ name: string; kind: string; rounds: { round: number; name: string }[] }>(db, "select name, kind, rounds from cups where id = $1", [f.cup_id]);
    const roundName = cup?.rounds.find((r) => r.round === f.cup_round)?.name ?? "Pokal";
    return { kind: cup?.kind === "continental" ? "continental" : "cup", name: cup?.name ?? "Pokal", label: `${cup?.name ?? "Pokal"} · ${roundName}` };
  }
  const league = await one<{ name: string }>(db, "select name from leagues where id = $1", [f.league_id]);
  return { kind: "league", name: league?.name ?? "Liga", label: `${league?.name ?? "Liga"} · ${f.round}. Spieltag` };
}

/** Pokalübersicht für die Oberfläche. */
export async function cupView(careerId: string, accountId: string, season?: number) {
  const career = await readCareer(careerId, accountId);
  const s = season ?? career.season;
  const cup = await one<CupRow>(pool(), "select * from cups where career_id = $1 and season = $2 and kind = 'national' order by id desc limit 1", [career.id, s]);
  if (!cup) return { cup: null, rounds: [], userClubId: career.club_id };
  const fixtures = await query<FixtureRow>(pool(), "select * from fixtures where career_id = $1 and cup_id = $2 order by cup_round, id", [career.id, cup.id]);
  const ids = [...new Set(fixtures.flatMap((f) => [f.home_id, f.away_id]).concat(cup.byes, cup.winner_club_id ? [cup.winner_club_id] : []))];
  const clubs = ids.length ? await getClubs(pool(), career.id, "id = any($2::int[])", [ids]) : [];
  const byId = new Map(clubs.map((c) => [c.id, { id: c.id, name: c.name, short: c.short_name, colors: c.colors, rating: c.rating }]));
  const tierRows = await query<{ id: number; tier: number }>(pool(), "select c.id, l.tier from clubs c join leagues l on l.id = c.league_id where c.career_id = $1 and c.id = any($2::int[])", [career.id, ids]);
  const tier = new Map(tierRows.map((r) => [r.id, r.tier]));
  const rounds = cup.rounds.map((r) => ({
    ...r,
    day: career.season === s ? career.calendar?.slots[r.week - 1]?.day ?? null : null,
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
