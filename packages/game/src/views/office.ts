/** Sichten: Büro mit täglichem Check-in und Übersicht. */
import { MISSIONS, flagEmoji, streakReward } from "@fl/sim";
import { upcomingDays } from "../calendar-view";
import { readCareer, todayKey, withCareer } from "../career";
import { one, pool, query } from "../db";
import { inboxRows } from "../inbox";
import { matchPreview } from "../match";
import { latestHeadlines } from "../media";
import { worldNewsCount } from "../world-news";
import { getClub, getLeague, saveCareer, type FixtureRow } from "../repo";
import { announceNotes, ensureMissions, unlockAchievement, type RewardNote } from "../rewards";
import { windowFor } from "../window";
import { careerSummary, clubSummary, standings } from "./common";

// ---------------------------------------------------------------- Büro

export async function checkin(careerId: string, accountId: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    ensureMissions(career);
    const notes: RewardNote[] = [];
    const account = await one<{ login_streak: number }>(db, "select login_streak from accounts where id = $1", [accountId]);
    const streak = account?.login_streak ?? 0;
    const today = todayKey();
    if (career.manager.streakRewardDay !== today) {
      career.manager.streakRewardDay = today;
      const reward = streakReward(streak);
      if (reward) {
        career.manager.points += reward.points;
        career.manager.trainingBoostWeeks += reward.trainingBoost;
        notes.push({ kind: "points", text: `${streak}-Tage-Serie: +${reward.points} MP${reward.trainingBoost ? `, Trainingsbonus für ${reward.trainingBoost} Wochen` : ""}`, icon: "🔥" });
      }
      if (streak >= 7) unlockAchievement(career, "login_7", notes);
    }
    await saveCareer(db, career);
    await announceNotes(db, career, notes);
    return { notes, streak };
  });
}

export async function dashboard(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const club = career.club_id ? await getClub(pool(), career.id, career.club_id) : null;
  const league = club ? await getLeague(pool(), career.id, club.league_id) : null;
  const inbox = (await inboxRows(pool(), career, { limit: 60 })).rows;
  const unread = await one<{ n: number }>(pool(), "select count(*)::int as n from inbox where career_id = $1 and not read", [career.id]);
  const next = await matchPreview(pool(), career);
  const headlines = await latestHeadlines(career.id, 4);
  let table: unknown[] = [];
  let recent: unknown[] = [];
  if (club && league) {
    const s = await standings(career, league.id);
    const pos = s.rows.findIndex((r) => r.clubId === club.id);
    table = s.rows.slice(Math.max(0, Math.min(pos - 3, s.rows.length - 7)), Math.max(7, pos + 4));
    const own = await query<FixtureRow & { opponent: string; cup_kind: string | null }>(
      pool(),
      `select f.*, o.name as opponent, cu.kind as cup_kind from fixtures f join clubs o on o.id = case when f.home_id = $3 then f.away_id else f.home_id end
        left join cups cu on cu.id = f.cup_id
        where f.career_id = $1 and f.season = $2 and f.played and $3 in (f.home_id, f.away_id) order by f.week desc limit 5`,
      [career.id, career.season, club.id],
    );
    recent = own.map((f) => ({
      fixtureId: f.id, week: f.week, home: f.home_id === club.id, opponent: f.opponent, cup: !!f.cup_id, continental: f.cup_kind === "continental",
      goalsFor: f.home_id === club.id ? f.home_goals : f.away_goals, goalsAgainst: f.home_id === club.id ? f.away_goals : f.home_goals,
      pens: f.pen_home !== null ? (f.home_id === club.id ? `${f.pen_home}:${f.pen_away}` : `${f.pen_away}:${f.pen_home}`) : null,
      won: f.pen_home !== null ? (f.home_id === club.id ? f.pen_home! > f.pen_away! : f.pen_away! > f.pen_home!) : null,
    }));
  }
  const offers = await query(pool(), "select * from transfers where career_id = $1 and kind = 'offer_in' and status = 'pending' order by id desc", [career.id]);
  ensureMissions(career);
  const account = await one<{ login_streak: number; best_login_streak: number }>(pool(), "select login_streak, best_login_streak from accounts where id = $1", [accountId]);
  return {
    headlines,
    career: careerSummary(career),
    club: club ? { ...clubSummary(club), balance: club.balance, transferBudget: club.transfer_budget } : null,
    league: league ? { id: league.id, name: league.name, tier: league.tier, countryCode: league.country_code, flag: flagEmoji(league.country_code) } : null,
    next,
    inbox,
    unread: unread?.n ?? 0,
    worldNews: await worldNewsCount(pool(), career.id),
    table,
    recent,
    offers,
    missions: career.manager.missions.items.map((i) => ({ ...MISSIONS.find((m) => m.kind === i.kind)!, done: i.done })),
    board: career.board,
    window: windowFor(career),
    loginStreak: account?.login_streak ?? 0,
    bestLoginStreak: account?.best_login_streak ?? 0,
    jobOffers: career.job_offers,
    schedule: await upcomingDays(career, 7),
  };
}
