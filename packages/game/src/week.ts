/**
 * Spielwoche verarbeiten: alle Partien, Spielerentwicklung, Finanzen,
 * KI-Transfers, Posteingang und Gamification.
 */
import {
  DEFAULT_TRAINING, Rng, afterMatch, penaltyShootout, shootersFrom, attendance, benchMorale, computeStandings, formatMoney, playMatch, quickResult,
  seedFor, squadRanks, teamRating, validateTactic, wageBill, weeklyDevelopment, weeklyFinances, weeksSincePreviousLeague,
  type MatchResult, type Player,
} from "@fl/sim";
import type pg from "pg";
import { windowFor } from "./window";
import { query } from "./db";
import { aiBidsForUser, aiMarketRound } from "./market";
import {
  type CareerRow, type FixtureRow, addFinance, addInbox, deletePlayers, insertPlayers, saveCareer, saveClubs,
  saveFixtureResults, savePlayers,
} from "./repo";
import { type RewardNote, announceNotes, ensureMissions, rewardMatch } from "./rewards";
import { aiTactic, teamSetup } from "./setup";
import { advanceCup, type CupWeekInfo } from "./cup";
import { academyWeek } from "./academy";
import { facilitiesOf } from "./facilities";
import { endSeason, type SeasonSummary } from "./season-end";
import { type WorldState, loadWorld, squadOf } from "./world-state";

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
    [fixtureId, careerId, JSON.stringify({ events, stats: r.stats, players: r.players, motm: r.motm, ...extra })],
  );
}

function suspensionFor(rng: Rng, red: boolean, yellowTotal: number): number {
  if (red) return rng.int(1, 3);
  if (yellowTotal > 0 && yellowTotal % 5 === 0) return 1;
  return 0;
}

function injuryLength(rng: Rng, physio: number): number {
  const base = [1, 1, 2, 2, 3, 4, 6, 8, 12][rng.weighted([20, 18, 15, 12, 10, 8, 6, 4, 2])];
  return Math.max(1, Math.round(base * (1.15 - physio / 40)));
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
      p.injuryWeeks = injuryLength(rng, physio(side === 0 ? homeId : awayId)) + 1;
      injuredNow.add(p.id);
    }
    w.dirtyPlayers.add(p.id);
  }
  for (const clubId of [homeId, awayId]) {
    const squad = squadOf(w, clubId);
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
      applyUserRewards(w, career, f, r, opts.userMatch.starters, notes);
    } else if (detailed) {
      const hs = squadOf(w, home.id);
      const as = squadOf(w, away.id);
      const ht = isUser && home.id === userClubId && home.tactic ? validateTactic(home.tactic, hs) : aiTactic(home, hs);
      const at = isUser && away.id === userClubId && away.tactic ? validateTactic(away.tactic, as) : aiTactic(away, as);
      const r = playMatch({ seed: seedFor(career.seed, "match", f.id), home: teamSetup(home, hs, ht), away: teamSetup(away, as, at) });
      hg = r.homeGoals;
      ag = r.awayGoals;
      applyMatchToPlayers(w, rng, r, home.id, away.id, physio, injuredNow).forEach((id) => minutes.set(id, 90));
      if (f.league_id === userLeagueId || isUser) await saveReport(db, career.id, f.id, r);
      if (isUser) {
        const starters = (home.id === userClubId ? ht : at).lineup.filter((x): x is number => x !== null);
        applyUserRewards(w, career, f, r, starters, notes);
      }
    } else {
      [hg, ag] = quickResult(rng, home.rating, away.rating);
    }
    // Pokal: bei Unentschieden direkt Elfmeterschiessen
    let pens: [number, number] | null = null;
    if (f.cup_id && f.group_no === null && hg === ag) {
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
    if (home.players_generated && home.finance) attendances.set(home.id, attendance(home.capacity, home.reputation, 7, away.reputation));
  }
  await saveFixtureResults(db, career.id, results);
  const cupId = fixtures.find((f) => f.cup_id)?.cup_id ?? null;
  let cupInfo: CupWeekInfo | null = null;
  if (cupId) cupInfo = await advanceCup(db, career, w, cupId, notes);

  // Training & Entwicklung aller Spieler aktiver Vereine (eigene Kondition erholt sich täglich)
  const boost = !midweek && career.manager.trainingBoostWeeks > 0;
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
      const { injured } = weeklyDevelopment(rng, p, plan, { minutesLastWeek: minutes.get(p.id) ?? 0, coachQuality: coach, physioQuality: physio(clubId), skipFitness: isUser });
      if (isUser && boost) {
        p.devProgress += 0.03;
        p.morale = Math.min(100, p.morale + 1);
      }
      if (isUser && injured) injuredNow.add(p.id);
      w.dirtyPlayers.add(p.id);
    }
  }
  if (boost) career.manager.trainingBoostWeeks--;
  if (!midweek && userClubId) await academyWeek(db, career, rng);
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
  for (const club of w.clubs.values()) {
    if (!club.players_generated || !club.finance) continue;
    const squad = squadOf(w, club.id);
    const att = attendances.get(club.id);
    const entries = weeklyFinances(club.finance, wageBill(squad, loanedOut.get(club.id) ?? []), att ? { attendance: att } : null)
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
    await aiBidsForUser(db, w, rng);
  }
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

  await persistWorld(db, w);

  // Posteingang: eigenes Ergebnis, Verletzungen, Hinweise
  if (userClubId) await weeklyInbox(db, career, w, week, userFixture, results, news, injuredNow, cupInfo?.name ?? null);
  await announceNotes(db, career, notes);

  let seasonEnd: SeasonSummary | null = null;
  if (week >= career.season_weeks) {
    seasonEnd = await endSeason(db, career);
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

function applyUserRewards(w: WorldState, career: CareerRow, f: FixtureRow, r: MatchResult, starters: number[], notes: RewardNote[]) {
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
  const delta = res === "W" ? (expectation === "W" ? 1 : 3) : res === "D" ? (expectation === "W" ? -2 : expectation === "L" ? 2 : 0) : expectation === "L" ? -1 : -3;
  career.board.confidence = Math.max(0, Math.min(100, (career.board.confidence ?? 60) + delta));
}

async function weeklyInbox(
  db: pg.PoolClient, career: CareerRow, w: WorldState, week: number, userFixture: FixtureRow | null,
  results: { id: number; home: number; away: number; penHome?: number; penAway?: number }[], news: string[], injuredNow: Set<number>,
  cupName: string | null,
) {
  const club = w.clubs.get(career.club_id!)!;
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
    await addInbox(
      db, career.id, career.season, week, "match",
      `${userFixture.cup_id ? cupName ?? "Pokal" : `${userFixture.round}. Spieltag`}: ${home.short_name} ${r.home}:${r.away}${r.penHome !== undefined ? ` (${r.penHome}:${r.penAway} i.E.)` : ""} ${away.short_name}`,
      userFixture.cup_id
        ? `${home.name} – ${away.name} ${r.home}:${r.away}${r.penHome !== undefined ? `, ${r.penHome}:${r.penAway} im Elfmeterschiessen` : ""}.`
        : `${home.name} – ${away.name} ${r.home}:${r.away}. ${club.name} steht jetzt auf Platz ${pos}.`,
      { type: "fixture", fixtureId: userFixture.id },
    );
  }
  const fresh = squad.filter((p) => injuredNow.has(p.id) && p.injuryWeeks > 0);
  if (fresh.length) {
    const list = fresh.map((p) => `• ${p.firstName} ${p.lastName} fällt ${p.injuryWeeks === 1 ? "eine Woche" : `${p.injuryWeeks} Wochen`} aus`);
    await addInbox(db, career.id, career.season, week, "medical", "Bericht der medizinischen Abteilung", `Neue Verletzungen:\n${list.join("\n")}`);
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
}
