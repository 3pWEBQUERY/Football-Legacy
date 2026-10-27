/**
 * Spielwoche verarbeiten: alle Partien, Spielerentwicklung, Finanzen,
 * KI-Transfers, Posteingang und Gamification.
 */
import {
  DEFAULT_TRAINING, Rng, afterMatch, penaltyShootout, shootersFrom, attendance, benchMorale, computeStandings, formatMoney, playMatch, quickResult,
  injure, injuryName, matchInjuryLength, retrainStep, seedFor, squadRanks, teamRating, validateTactic, wageBill, weeklyDevelopment, weeklyFinances, weeksSincePreviousLeague,
  type MatchResult, type Player,
} from "@fl/sim";
import type pg from "pg";
import { windowFor } from "./window";
import { query } from "./db";
import { aiMarketRound } from "./market";
import {
  type CareerRow, type FixtureRow, addFinance, addInbox, deletePlayers, insertPlayers, saveCareer, saveClubs,
  saveFixtureResults, savePlayers,
} from "./repo";
import { type RewardNote, announceNotes, ensureMissions, rewardMatch } from "./rewards";
import { aiTactic, teamSetup } from "./setup";
import { trackPlayingTime, weeklyDynamics } from "./dynamics";
import { councilWeek } from "./council";
import { leagueRoundup, matchArticle, transferArticles } from "./media";
import { nationalNewSeason, nationalTournament } from "./national";
import { staffSeasonEnd } from "./staff";
import { fanAdjusted, loadMgmtForWeek, weeklyFans } from "./clubmgmt";
import { difficultySettings } from "./difficulty";
import { fixtureConditions } from "./conditions";
import { RIVALRY_LABEL, type RivalryKind, derbySetup, loadRivalries, rivalryOf } from "./rivals";
import { onboardingTick } from "./onboarding";
import { advanceCup, type CupWeekInfo } from "./cup";
import { academyWeek } from "./academy";
import { facilitiesOf } from "./facilities";
import { endSeason, type SeasonSummary } from "./season-end";
import { jobsSeasonEnd, jobsWeek } from "./jobs";
import { aiPrecontracts, aiSaleOffers, negotiationsDaily, paymentsSeasonStart, transferDeadline } from "./negotiations";
import { matchAnalysis, milestones, newsWeekly, send, staffSender } from "./news";
import { familiarityTick, userFamiliarity } from "./tactics";
import { type WorldState, loadWorld, squadOf } from "./world-state";
import { getSponsor, sponsorBonus, sponsorWeekly } from "./sponsors";
import { createPlayoffs, firstLegs, resolvePlayoffs } from "./playoffs";

export interface WeekResultLine {
  fixtureId: number;
  leagueId: number;
  homeId: number;
  awayId: number;
  homeName: string;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
  penHome?: number;
  penAway?: number;
}

export interface WeekSummary {
  week: number;
  season: number;
  userFixtureId: number | null;
  results: WeekResultLine[];
  cupResults: WeekResultLine[];
  cup: CupWeekInfo | null;
  notes: RewardNote[];
  news: string[];
  seasonEnd: SeasonSummary | null;
}

export interface UserMatchInput {
  fixtureId: number;
  result: MatchResult;
  /** Aufstellung beim Anpfiff (für Belohnungen). */
  starters: number[];
}

/** Speichert einen Spielbericht (Ereignisse, Statistiken, Noten). */
async function saveReport(db: pg.PoolClient, careerId: string, fixtureId: number, r: MatchResult, extra: Record<string, unknown> = {}) {
  const events = r.events.filter((e) => !["foul", "corner", "freekick"].includes(e.type));
  await query(
    db,
    "insert into match_reports(fixture_id, career_id, data) values ($1,$2,$3) on conflict (fixture_id) do update set data = excluded.data",
    [fixtureId, careerId, JSON.stringify({ events, stats: r.stats, players: r.players, motm: r.motm, shots: r.shots ?? [], conditions: r.conditions ?? null, ...extra })],
  );
}

function suspensionFor(rng: Rng, red: boolean, yellowTotal: number): number {
  if (red) return rng.int(1, 3);
  if (yellowTotal > 0 && yellowTotal % 5 === 0) return 1;
  return 0;
}


/** Wendet ein Spielergebnis auf die beteiligten Spieler an. */
function applyMatchToPlayers(
  w: WorldState, rng: Rng, result: MatchResult, homeId: number, awayId: number, physio: (clubId: number) => number, injuredNow: Set<number>,
) {
  const played = new Set<number>();
  for (const line of result.players) {
    const p = w.players.get(line.playerId);
    if (!p) continue;
    played.add(p.id);
    const side = line.side;
    const gf = side === 0 ? result.homeGoals : result.awayGoals;
    const ga = side === 0 ? result.awayGoals : result.homeGoals;
    const res = gf > ga ? "W" : gf === ga ? "D" : "L";
    afterMatch(p, line.rating, line.minutes, res, line.staminaEnd);
    if (line.started && p.promise) p.promise.starts++;
    p.stats.goals += line.goals;
    p.stats.assists += line.assists;
    p.stats.yellow += line.yellow;
    if (line.red) p.stats.red++;
    if (ga === 0 && line.started && ["GK", "DC", "DL", "DR"].includes(p.position)) p.stats.cleanSheets++;
    const susp = suspensionFor(rng, line.red, line.yellow > 0 ? p.stats.yellow : 0);
    if (susp) p.suspendedWeeks = Math.max(p.suspendedWeeks, susp + 1);
    if (line.injured) {
      injure(rng, p, matchInjuryLength(rng, physio(side === 0 ? homeId : awayId)) + 1, w.career.season, w.career.day);
      injuredNow.add(p.id);
    }
    w.dirtyPlayers.add(p.id);
  }
  for (const clubId of [homeId, awayId]) {
    const squad = squadOf(w, clubId);
    if (clubId === w.career.club_id) {
      // Eigener Verein: Einsatzzeit zählen, Moral nach Kaderstatus
      const started = new Set(result.players.filter((l) => l.started).map((l) => l.playerId));
      trackPlayingTime(squad, played, started, w.career.season, w.clubs.get(clubId)?.tactic?.formation);
      for (const p of squad) w.dirtyPlayers.add(p.id);
      continue;
    }
    const ranks = squadRanks(squad);
    for (const p of squad) {
      if (played.has(p.id) || p.injuryWeeks > 0) continue;
      benchMorale(p, ranks.get(p.id) ?? 30);
      w.dirtyPlayers.add(p.id);
    }
  }
  return played;
}

export async function processWeek(db: pg.PoolClient, career: CareerRow, opts: { userMatch?: UserMatchInput; quickUserMatch?: boolean } = {}): Promise<WeekSummary> {
  const week = career.week + 1;
  // Pokalrunden liegen unter der Woche: kein zusätzliches Training, keine zusätzlichen laufenden Kosten
  const midweek = (career.calendar?.slots[week - 1]?.kind ?? "league") !== "league";
  const w = await loadWorld(db, career);
  const rng = new Rng(seedFor(career.seed, "week", career.season, week));
  const notes: RewardNote[] = [];
  const news: string[] = [];
  ensureMissions(career);

  const fixtures = await query<FixtureRow>(
    db, "select * from fixtures where career_id = $1 and season = $2 and week = $3 and not played", [career.id, career.season, week],
  );
  const userClubId = career.club_id;
  const userFixture = fixtures.find((f) => f.home_id === userClubId || f.away_id === userClubId) ?? null;
  if (userFixture && !opts.userMatch && !opts.quickUserMatch) {
    throw new Error("Das eigene Spiel muss zuerst gespielt werden.");
  }
  const physio = (clubId: number) => (clubId === userClubId ? career.staff.physio : 8);
  const minutes = new Map<number, number>();
  const results: { id: number; home: number; away: number; penHome?: number; penAway?: number }[] = [];
  const lines: WeekResultLine[] = [];
  const cupLines: WeekResultLine[] = [];
  const injuredNow = new Set<number>();
  const attendances = new Map<number, number>();
  const userLeagueId = userClubId ? w.clubs.get(userClubId)?.league_id : undefined;
  const rivals = await loadRivalries(db, career);
  const playoffWeek = career.calendar?.slots[week - 1]?.kind === "playoff";
  const legs1 = playoffWeek ? await firstLegs(db, career) : new Map<number, FixtureRow>();
  const userDerby = userFixture ? rivalryOf(rivals, userFixture.home_id, userFixture.away_id) : null;

  for (const f of fixtures) {
    const home = w.clubs.get(f.home_id)!;
    const away = w.clubs.get(f.away_id)!;
    const league = f.cup_id ? undefined : w.leagues.get(f.league_id);
    let hg: number;
    let ag: number;
    const isUser = userFixture?.id === f.id;
    const detailed = home.players_generated && away.players_generated && (league?.active || isUser || !!f.cup_id);
    if (isUser && opts.userMatch) {
      const r = opts.userMatch.result;
      hg = r.homeGoals;
      ag = r.awayGoals;
      applyMatchToPlayers(w, rng, r, home.id, away.id, physio, injuredNow).forEach((id) => minutes.set(id, 90));
      await saveReport(db, career.id, f.id, r);
      applyUserRewards(w, career, f, r, opts.userMatch.starters, notes, userDerby);
    } else if (detailed) {
      const hs = squadOf(w, home.id);
      const as = squadOf(w, away.id);
      const ht = isUser && home.id === userClubId && home.tactic ? validateTactic(home.tactic, hs) : aiTactic(home, hs);
      const at = isUser && away.id === userClubId && away.tactic ? validateTactic(away.tactic, as) : aiTactic(away, as);
      const fam = isUser ? await userFamiliarity(db, career, w.clubs.get(userClubId!)!) : undefined;
      const r = playMatch(derbySetup({ seed: seedFor(career.seed, "match", f.id), conditions: fixtureConditions(career, f, home.country_code), home: teamSetup(home, hs, ht, true, home.id === userClubId ? fam : undefined), away: teamSetup(away, as, at, true, away.id === userClubId ? fam : undefined) }, rivalryOf(rivals, home.id, away.id), f.cup_id != null));
      hg = r.homeGoals;
      ag = r.awayGoals;
      applyMatchToPlayers(w, rng, r, home.id, away.id, physio, injuredNow).forEach((id) => minutes.set(id, 90));
      if (f.league_id === userLeagueId || isUser) await saveReport(db, career.id, f.id, r);
      if (isUser) {
        const starters = (home.id === userClubId ? ht : at).lineup.filter((x): x is number => x !== null);
        applyUserRewards(w, career, f, r, starters, notes, userDerby);
      }
    } else {
      [hg, ag] = quickResult(rng, home.rating, away.rating);
    }
    // Pokal: bei Unentschieden direkt Elfmeterschiessen
    let pens: [number, number] | null = null;
    // Relegation: im Rückspiel entscheidet bei Gleichstand nach beiden Spielen das Elfmeterschiessen
    const first = playoffWeek && f.cup_round === 2 && f.group_no !== null ? legs1.get(f.group_no) : undefined;
    const tied = first ? hg + (first.away_goals ?? 0) === ag + (first.home_goals ?? 0) : f.cup_id && f.group_no === null && hg === ag;
    if (tied) {
      const prng = new Rng(seedFor(career.seed, "penalties", f.id));
      if (home.players_generated && away.players_generated) {
        const hs = shootersFrom(squadOf(w, home.id));
        const as = shootersFrom(squadOf(w, away.id));
        pens = penaltyShootout(prng, hs.shooters, as.shooters, hs.keeper, as.keeper);
      } else {
        pens = prng.chance(0.5 + (home.rating - away.rating) / 100) ? [5, 4] : [4, 5];
      }
    }
    results.push({ id: f.id, home: hg, away: ag, penHome: pens?.[0], penAway: pens?.[1] });
    const line = { fixtureId: f.id, leagueId: f.league_id, homeId: home.id, awayId: away.id, homeName: home.name, awayName: away.name, homeGoals: hg, awayGoals: ag, penHome: pens?.[0], penAway: pens?.[1] };
    if (f.cup_id) cupLines.push(line);
    else if (f.league_id === userLeagueId) lines.push(line);
    // Zuschauer und Ticketerlöse für das Heimteam
    // Derbys sind ausverkauft
    if (home.players_generated && home.finance) {
      attendances.set(home.id, rivalryOf(rivals, home.id, away.id) ? Math.round(home.capacity * 0.98) : attendance(home.capacity, home.reputation, 7, away.reputation));
    }
  }
  await saveFixtureResults(db, career.id, results);
  await createPlayoffs(db, career, week);
  if (playoffWeek) await resolvePlayoffs(db, career);
  // Leistungsvertrag des Sponsors: Prämie für jeden Sieg
  const ur = userFixture ? results.find((x) => x.id === userFixture.id) : undefined;
  if (ur && userClubId && (userFixture!.home_id === userClubId ? ur.home > ur.away : ur.away > ur.home)) {
    const own = w.clubs.get(userClubId)!;
    own.balance += await sponsorBonus(db, career, own, "win");
    w.dirtyClubs.add(own.id);
  }
  const cupId = fixtures.find((f) => f.cup_id)?.cup_id ?? null;
  let cupInfo: CupWeekInfo | null = null;
  if (cupId) cupInfo = await advanceCup(db, career, w, cupId, notes);

  // Training & Entwicklung aller Spieler aktiver Vereine (eigene Kondition erholt sich täglich)
  const boost = !midweek && career.manager.trainingBoostWeeks > 0;
  const injuredBefore = new Set(userClubId ? squadOf(w, userClubId).filter((p) => p.injuryWeeks > 0).map((p) => p.id) : []);
  const retrained: Player[] = [];
  if (midweek) {
    for (const [clubId, squad] of w.squads) {
      for (const p of squad) {
        if (p.suspendedWeeks > 0) p.suspendedWeeks--;
        if (clubId !== userClubId) p.fitness = Math.min(100, p.fitness + 10);
        w.dirtyPlayers.add(p.id);
      }
    }
  }
  for (const [clubId, squad] of midweek ? [] : w.squads) {
    const club = w.clubs.get(clubId);
    if (!club?.players_generated) continue;
    const isUser = clubId === userClubId;
    const plan = isUser ? career.training : DEFAULT_TRAINING;
    const coach = isUser ? career.staff.coach + (facilitiesOf(career).training - 1) * 1.5 : Math.round(4 + club.reputation / 10);
    for (const p of squad) {
      // Individueller Schwerpunkt ersetzt den Mannschaftsschwerpunkt
      const own = isUser && p.individual?.focus ? { ...plan, focus: p.individual.focus } : plan;
      if (isUser && retrainStep(p)) retrained.push(p);
      const { injured } = weeklyDevelopment(rng, p, own, { minutesLastWeek: minutes.get(p.id) ?? 0, coachQuality: coach, physioQuality: physio(clubId), skipFitness: isUser });
      if (isUser && boost) {
        p.devProgress += 0.03;
        p.morale = Math.min(100, p.morale + 1);
      }
      if (injured) p.injury = { name: injuryName(rng, p.injuryWeeks), season: career.season, day: career.day, weeks: p.injuryWeeks };
      if (isUser && injured) injuredNow.add(p.id);
      w.dirtyPlayers.add(p.id);
    }
  }
  if (boost) career.manager.trainingBoostWeeks--;
  if (userClubId && !midweek) {
    const own = squadOf(w, userClubId);
    await weeklyDynamics(db, career, own);
    news.push(...await councilWeek(db, career, own));
    for (const p of own) w.dirtyPlayers.add(p.id);
  }
  // Genesene Spieler: Verletzung austragen, eigene melden
  for (const p of w.players.values()) {
    if (p.injuryWeeks === 0 && p.injury) {
      p.injury = null;
      w.dirtyPlayers.add(p.id);
    }
  }
  const recovered = userClubId ? squadOf(w, userClubId).filter((p) => injuredBefore.has(p.id) && p.injuryWeeks === 0) : [];
  if (recovered.length) {
    await addInbox(db, career.id, career.season, week, "medical", recovered.length === 1 ? `Wieder fit: ${recovered[0].firstName} ${recovered[0].lastName}` : `Wieder fit: ${recovered.length} Spieler`,
      `Die medizinische Abteilung gibt grünes Licht:\n${recovered.map((p) => `• ${p.firstName} ${p.lastName} (${p.position})`).join("\n")}\n\nNach der Pause fehlt noch etwas Spielpraxis.`);
  }
  if (!midweek && userClubId) await academyWeek(db, career, rng);
  for (const p of retrained) {
    await addInbox(db, career.id, career.season, week, "training", `Umschulung abgeschlossen: ${p.firstName} ${p.lastName}`,
      `${p.firstName} ${p.lastName} beherrscht jetzt auch die Position ${p.altPositions[p.altPositions.length - 1]}.`, { type: "player", playerId: p.id });
  }
  // Nach der Winterpause sind Verletzungen entsprechend weiter ausgeheilt
  const extraWeeks = career.calendar ? Math.round(weeksSincePreviousLeague(career.calendar, week)) - 1 : 0;
  if (extraWeeks > 0) {
    for (const p of w.players.values()) {
      if (p.injuryWeeks > 0) {
        p.injuryWeeks = Math.max(0, p.injuryWeeks - extraWeeks);
        w.dirtyPlayers.add(p.id);
      }
    }
  }
  for (const p of midweek ? [] : w.freeAgents) {
    p.fitness = Math.min(100, p.fitness + 10);
    if (p.injuryWeeks > 0) p.injuryWeeks--;
    w.dirtyPlayers.add(p.id);
  }

  // Finanzen (verliehene Spieler: Stammverein trägt den Restanteil des Gehalts)
  const loanedOut = new Map<number, Player[]>();
  for (const p of w.players.values()) if (p.loan) loanedOut.set(p.loan.parentClubId, [...(loanedOut.get(p.loan.parentClubId) ?? []), p]);
  // Laufende Posten nach vergangener Zeit seit dem letzten Ligaspieltag (Winterpause zählt mit)
  const span = career.calendar ? weeksSincePreviousLeague(career.calendar, week) : midweek ? 0 : 1;
  const mgmt = userClubId ? await loadMgmtForWeek(db, career) : null;
  const sponsor = userClubId ? sponsorWeekly(await getSponsor(db, career, userClubId), career.season) : null;
  for (const club of w.clubs.values()) {
    if (!club.players_generated || !club.finance) continue;
    const squad = squadOf(w, club.id);
    let att = attendances.get(club.id);
    let profile = club.finance;
    if (mgmt && club.id === userClubId) {
      // Fans und Ticketpreise des eigenen Vereins
      const adj = fanAdjusted(mgmt, club.finance, att ?? 0, club.capacity);
      profile = adj.profile;
      if (att !== undefined) att = adj.attendance;
      if (sponsor !== null) profile = { ...profile, sponsorWeekly: sponsor };
    }
    const entries = weeklyFinances(profile, wageBill(squad, loanedOut.get(club.id) ?? []), att ? { attendance: att } : null)
      .map((e) => (e.kind === "tickets" ? e : { ...e, amount: Math.round(e.amount * span) }))
      .filter((e) => e.amount !== 0);
    if (!entries.length) continue;
    const sum = entries.reduce((s, e) => s + e.amount, 0);
    club.balance += sum;
    if (club.id !== userClubId) club.transfer_budget = Math.max(0, club.transfer_budget + Math.round(sum * 0.3));
    w.dirtyClubs.add(club.id);
    if (club.id === userClubId) await addFinance(db, career.id, club.id, career.season, week, entries);
  }

  // Transfermarkt
  career.week = week;
  const window = windowFor(career);
  if (window.open) {
    const marketNews = await aiMarketRound(db, w, rng);
    news.push(...marketNews.map((n) => n.text));
    await transferArticles(db, career, marketNews.filter((n) => n.important).map((n) => ({ text: n.text })));
    if (userClubId) await aiSaleOffers(db, career, rng);
  }
  // Vorverträge: KI-Vereine werben auslaufende Spieler ab (ab 1. Januar)
  if (userClubId && !midweek) news.push(...await aiPrecontracts(db, career, w));
  // Abgelaufene Angebote verfallen
  await query(
    db,
    "update transfers set status = 'expired' where career_id = $1 and status = 'pending' and kind = 'offer_in' and (season < $2 or week < $3 - 2)",
    [career.id, career.season, week],
  );

  // Stärke aktualisieren
  for (const club of w.clubs.values()) {
    if (!club.players_generated) continue;
    const r = teamRating(squadOf(w, club.id));
    if (r && r !== club.rating) {
      club.rating = r;
      w.dirtyClubs.add(club.id);
    }
  }

  // Meilensteine eigener Spieler (vor dem Speichern, da die Moral steigt)
  if (userFixture && userClubId) {
    const rep = await query<{ data: { players?: { playerId: number; goals: number; minutes: number; side: number }[] } }>(db, "select data from match_reports where fixture_id = $1", [userFixture.id]);
    const side = userFixture.home_id === userClubId ? 0 : 1;
    const own = squadOf(w, userClubId);
    await milestones(db, career, w.clubs.get(userClubId)!, own, (rep[0]?.data.players ?? []).filter((l) => l.side === side));
    for (const p of own) w.dirtyPlayers.add(p.id);
  }
  await persistWorld(db, w);

  // Posteingang: eigenes Ergebnis, Verletzungen, Hinweise
  const position = userClubId ? await weeklyInbox(db, career, w, week, userFixture, results, news, injuredNow, cupInfo?.name ?? null) : null;
  if (position && week >= 3) boardDrift(career, position);
  if (userClubId && mgmt) {
    const own = w.clubs.get(userClubId)!;
    const r = userFixture ? results.find((x) => x.id === userFixture.id) : undefined;
    const homeSide = userFixture?.home_id === userClubId;
    const sold = await query<{ player_name: string }>(db,
      "select player_name from transfers where career_id = $1 and kind = 'offer_in' and status = 'completed' and from_club = $2 and season = $3 and week = $4 and fee >= 8000000",
      [career.id, userClubId, career.season, week - 1]);
    await weeklyFans(db, career, mgmt, own,
      r && userFixture ? { gf: homeSide ? r.home : r.away, ga: homeSide ? r.away : r.home, opponent: w.clubs.get(homeSide ? userFixture.away_id : userFixture.home_id)?.name ?? "", home: homeSide, derby: !!userDerby } : null,
      position, sold.map((x) => x.player_name));
    if (r && userFixture && userDerby) await derbyNews(db, career, w, userFixture, homeSide ? r.home : r.away, homeSide ? r.away : r.home, userDerby);
  }
  if (userClubId && !midweek) await leagueRoundup(db, career, w.clubs.get(userClubId)!.league_id, week);
  await announceNotes(db, career, notes);

  if (userClubId) {
    await negotiationsDaily(db, career);
    await transferDeadline(db, career);
  }
  if (!midweek) await jobsWeek(db, career);
  if (!midweek && userClubId) await newsWeekly(db, career, week);
  if (userFixture) await familiarityTick(db, career, "match");

  let seasonEnd: SeasonSummary | null = null;
  if (week >= career.season_weeks) {
    const clubBefore = career.club_id;
    await nationalTournament(db, career);
    seasonEnd = await endSeason(db, career);
    await paymentsSeasonStart(db, career);
    await jobsSeasonEnd(db, career, seasonEnd.dismissed, clubBefore);
    await nationalNewSeason(db, career);
    await staffSeasonEnd(db, career);
  }
  await saveCareer(db, career);
  return { week, season: career.season, userFixtureId: userFixture?.id ?? null, results: lines, cupResults: cupLines, cup: cupInfo, notes, news, seasonEnd };
}

export async function persistWorld(db: pg.PoolClient, w: WorldState) {
  const newIds = new Set(w.newPlayers.map((p) => p.id));
  const dirty = [...w.dirtyPlayers].filter((id) => !newIds.has(id) && !w.removedPlayers.has(id)).map((id) => w.players.get(id)!).filter(Boolean);
  await savePlayers(db, w.career.id, dirty);
  if (w.newPlayers.length) await insertPlayers(db, w.career.id, w.newPlayers.filter((p) => !w.removedPlayers.has(p.id)));
  await deletePlayers(db, w.career.id, [...w.removedPlayers]);
  await saveClubs(db, w.career.id, [...w.dirtyClubs].map((id) => w.clubs.get(id)!).filter(Boolean));
  w.dirtyPlayers.clear();
  w.dirtyClubs.clear();
  w.newPlayers = [];
  w.removedPlayers.clear();
}

/**
 * Das Vertrauen des Vorstands zieht jede Woche in Richtung eines Werts, der
 * sich aus Tabellenplatz und Saisonziel ergibt: im Soll ~62, je Platz besser
 * +5, je Platz schlechter −5. Einzelne Ergebnisse schwanken nur darum herum.
 */
export function boardDrift(career: CareerRow, position: number) {
  const level = Math.max(5, Math.min(95, 62 + difficultySettings(career).board + (career.board.targetPosition - position) * 5));
  const c = career.board.confidence ?? 60;
  // Langsame Annäherung: das Urteil des Vorstands reicht über mehr als eine Saison
  career.board.confidence = Math.round((c + (level - c) * 0.05) * 10) / 10;
}

function applyUserRewards(w: WorldState, career: CareerRow, f: FixtureRow, r: MatchResult, starters: number[], notes: RewardNote[], derby: RivalryKind | null = null) {
  const home = f.home_id === career.club_id;
  const own = w.clubs.get(career.club_id!)!;
  const opp = w.clubs.get(home ? f.away_id : f.home_id)!;
  const gf = home ? r.homeGoals : r.awayGoals;
  const ga = home ? r.awayGoals : r.homeGoals;
  rewardMatch(career, {
    goalsFor: gf, goalsAgainst: ga, home, ownRating: own.rating, oppRating: opp.rating,
    starters: starters.map((id) => w.players.get(id)).filter(Boolean) as Player[],
  }, notes);
  // Vorstandsvertrauen
  const diff = own.rating - opp.rating;
  const expectation = diff > 4 ? "W" : diff < -4 ? "L" : "D";
  const res = gf > ga ? "W" : gf === ga ? "D" : "L";
  const base = res === "W" ? (expectation === "W" ? 1 : 2) : res === "D" ? (expectation === "W" ? -1.5 : expectation === "L" ? 1 : 0) : expectation === "L" ? -0.5 : -2;
  // Derbys zählen beim Vorstand anderthalbfach, die Spieler feiern oder leiden mit
  const delta = derby ? base * 1.5 : base;
  career.board.confidence = Math.max(0, Math.min(100, (career.board.confidence ?? 60) + delta));
  if (derby && res !== "D") {
    for (const id of starters) {
      const p = w.players.get(id);
      if (p) { p.morale = Math.max(5, Math.min(100, p.morale + (res === "W" ? 4 : -3))); w.dirtyPlayers.add(id); }
    }
  }
  onboardingTick(career, notes);
}

async function weeklyInbox(
  db: pg.PoolClient, career: CareerRow, w: WorldState, week: number, userFixture: FixtureRow | null,
  results: { id: number; home: number; away: number; penHome?: number; penAway?: number }[], news: string[], injuredNow: Set<number>,
  cupName: string | null,
): Promise<number | null> {
  const club = w.clubs.get(career.club_id!)!;
  let position: number | null = null;
  const squad = squadOf(w, club.id);
  if (userFixture) {
    const r = results.find((x) => x.id === userFixture.id)!;
    const home = w.clubs.get(userFixture.home_id)!;
    const away = w.clubs.get(userFixture.away_id)!;
    const leagueFixtures = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and season = $2 and league_id = $3 and played", [
      career.id, career.season, club.league_id,
    ]);
    const table = computeStandings(
      [...w.clubs.values()].filter((c) => c.league_id === club.league_id).map((c) => c.id),
      leagueFixtures.map((f) => ({ homeId: f.home_id, awayId: f.away_id, homeGoals: f.home_goals, awayGoals: f.away_goals, round: f.round })),
    );
    const pos = table.findIndex((t) => t.clubId === club.id) + 1;
    position = pos;
    await matchAnalysis(db, career, userFixture, home, away, r.home, r.away, userFixture.cup_id ? null : pos,
      userFixture.cup_id ? cupName ?? "Pokal" : `${userFixture.round}. Spieltag`, r.penHome !== undefined ? [r.penHome, r.penAway!] : undefined);
    await matchArticle(db, career, userFixture, home, away, r, userFixture.cup_id ? null : pos,
      userFixture.cup_id ? cupName ?? "Pokal" : `${userFixture.round}. Spieltag`);
  }
  const fresh = squad.filter((p) => injuredNow.has(p.id) && p.injuryWeeks > 0);
  if (fresh.length) {
    await send(db, career, {
      category: "medical", title: fresh.length === 1 ? `Verletzung: ${fresh[0].firstName} ${fresh[0].lastName}` : `${fresh.length} neue Verletzungen`,
      sender: await staffSender(db, career, club, "physio"),
      blocks: [
        { t: "p", text: fresh.length === 1 ? "Leider müssen wir einen Ausfall melden." : "Die medizinische Abteilung meldet mehrere Ausfälle." },
        { t: "players", title: "Ausfälle", items: fresh.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, pos: p.position, value: p.injuryWeeks === 1 ? "1 Woche" : `${p.injuryWeeks} Wochen`, note: p.injury?.name ?? "Verletzung" })) },
        { t: "p", text: "Details und Genesungsverlauf findest du unter Team → Medizin." },
      ],
      priority: 2, kind: "injury", action: fresh.length === 1 ? { type: "player", playerId: fresh[0].id } : null,
    });
  }
  if (week === career.season_weeks - 6) {
    const expiring = squad.filter((p) => p.contract && p.contract.untilSeason <= career.season);
    if (expiring.length) {
      await addInbox(db, career.id, career.season, week, "contract", "Auslaufende Verträge",
        `Diese Verträge laufen am Saisonende aus:\n${expiring.map((p) => `• ${p.firstName} ${p.lastName} (${p.age}, ${p.rating})`).join("\n")}\n\nVerlängere rechtzeitig im Bereich Markt → Verträge.`);
    }
  }
  const important = news.slice(0, 6);
  if (important.length) {
    await addInbox(db, career.id, career.season, week, "news", "Neuigkeiten aus der Fussballwelt", important.map((n) => `• ${n}`).join("\n"));
  }
  if (club.balance < career.board.financeTarget && week % 4 === 0) {
    await addInbox(db, career.id, career.season, week, "board", "Der Vorstand ist besorgt",
      `Der Kontostand (${formatMoney(club.balance)}) liegt unter der Vorgabe von ${formatMoney(career.board.financeTarget)}. Bitte reduziere die Kosten.`);
  }
  return position;
}

/** Nach dem Derby: Schlagzeile der Fans im Posteingang. */
async function derbyNews(db: pg.PoolClient, career: CareerRow, w: WorldState, f: FixtureRow, gf: number, ga: number, kind: RivalryKind) {
  const opp = w.clubs.get(f.home_id === career.club_id ? f.away_id : f.home_id);
  if (!opp) return;
  const title = gf > ga ? `Derbysieg gegen ${opp.name}!` : gf < ga ? `Derbyniederlage gegen ${opp.name}` : `Derby-Remis gegen ${opp.name}`;
  const body = gf > ga
    ? `${gf}:${ga} im ${RIVALRY_LABEL[kind]} – die Fans feiern bis tief in die Nacht. Für die Stimmung im Umfeld gibt es kaum etwas Wertvolleres.`
    : gf < ga ? `${gf}:${ga} im ${RIVALRY_LABEL[kind]}. Eine Niederlage gegen ${opp.name} tut doppelt weh – Fans und Vorstand erwarten eine Reaktion.`
      : `${gf}:${ga} im ${RIVALRY_LABEL[kind]}. Keiner hat die Oberhand gewonnen – das Rückspiel wird umso heisser.`;
  await addInbox(db, career.id, career.season, career.week, "match", title, body, { type: "fixture", fixtureId: f.id });
}
