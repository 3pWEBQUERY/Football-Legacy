/** Saisonende: Abschlusstabellen, Auf- und Abstieg, Alterung, Verträge, neue Saison. */
import {
  Rng, computeStandings, emptyStats, formatMoney, generateYouthIntake, prizeMoney, retirementChance, roundsFor, seasonAging,
  seedFor, squadRanks, teamRating, type Player,
} from "@fl/sim";
import type pg from "pg";
import { query } from "./db";
import { boardObjectives, scheduleSeason } from "./career";
import { type CareerRow, type FixtureRow, type JobOffer, type LeagueRow, addFinance, addInbox } from "./repo";
import { type RewardNote, announceNotes, awardCard, grantXp, unlockAchievement } from "./rewards";
import { type WorldState, loadWorld, movePlayer, removePlayer, squadOf } from "./world-state";
import { persistWorld } from "./week";
import { buildReview, saveReview, type SeasonReview } from "./review";
import { academySeasonEnd } from "./academy";

export interface SeasonSummary {
  season: number;
  position: number;
  points: number;
  champion: boolean;
  promoted: boolean;
  relegated: boolean;
  objectiveMet: boolean;
  dismissed: boolean;
  champions: { leagueName: string; clubName: string }[];
}

export async function endSeason(db: pg.PoolClient, career: CareerRow): Promise<SeasonSummary> {
  const w = await loadWorld(db, career);
  const rng = new Rng(seedFor(career.seed, "season-end", career.season));
  const notes: RewardNote[] = [];
  const fixtures = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and season = $2", [career.id, career.season]);
  const byLeague = new Map<number, FixtureRow[]>();
  for (const f of fixtures) byLeague.set(f.league_id, [...(byLeague.get(f.league_id) ?? []), f]);

  // Abschlusstabellen
  const tables = new Map<number, number[]>(); // leagueId → clubIds in Tabellenreihenfolge
  const pointsOf = new Map<number, { points: number; played: number }>();
  for (const league of w.leagues.values()) {
    const clubIds = [...w.clubs.values()].filter((c) => c.league_id === league.id).map((c) => c.id);
    const table = computeStandings(clubIds, (byLeague.get(league.id) ?? []).map((f) => ({
      homeId: f.home_id, awayId: f.away_id, homeGoals: f.home_goals, awayGoals: f.away_goals, round: f.round,
    })));
    tables.set(league.id, table.map((r) => r.clubId));
    for (const r of table) pointsOf.set(r.clubId, { points: r.points, played: r.played });
  }

  const userClub = career.club_id ? w.clubs.get(career.club_id) : undefined;
  const userLeague = userClub ? w.leagues.get(userClub.league_id) : undefined;
  // Qualifikation für den Kontinentalpokal der nächsten Saison: Abschlusstabellen aller Topligen
  career.qualifiers = {
    season: career.season + 1,
    tables: Object.fromEntries([...w.leagues.values()].filter((l) => l.tier === 1).map((l) => [l.country_code, tables.get(l.id) ?? []])),
  };
  const userTable = userLeague ? tables.get(userLeague.id)! : [];
  const position = userClub ? userTable.indexOf(userClub.id) + 1 : 0;
  const champion = position === 1;
  const promoted = !!userLeague && userLeague.tier > 1 && position > 0 && position <= userLeague.promotion;
  const relegated = !!userLeague && userLeague.relegation > 0 && position > userLeague.size - userLeague.relegation;

  // Saisonrückblick der eigenen Liga (vor Auf- und Abstieg, solange die Statistiken stehen)
  let review: SeasonReview | null = null;
  if (userClub && userLeague) {
    const rows = computeStandings(
      [...w.clubs.values()].filter((c) => c.league_id === userLeague.id).map((c) => c.id),
      (byLeague.get(userLeague.id) ?? []).map((f) => ({ homeId: f.home_id, awayId: f.away_id, homeGoals: f.home_goals, awayGoals: f.away_goals, round: f.round })),
    );
    const cupInfo = await query<{ id: number; rounds: { round: number; name: string }[]; winner_club_id: number | null }>(db, "select id, rounds, winner_club_id from cups where career_id = $1 and season = $2 and kind = 'national'", [career.id, career.season]);
    let userCup: string | null = null;
    if (cupInfo[0]) {
      const cf = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and cup_id = $2 and $3 in (home_id, away_id) order by cup_round desc limit 1", [career.id, cupInfo[0].id, userClub.id]);
      userCup = cupInfo[0].winner_club_id === userClub.id ? "Pokalsieger" : cf[0] ? cupInfo[0].rounds.find((r) => r.round === cf[0].cup_round)?.name ?? null : null;
    }
    const cupWinnerName = cupInfo[0]?.winner_club_id ? w.clubs.get(cupInfo[0].winner_club_id)?.name ?? null : null;
    review = buildReview(w, career.season, userLeague.id, rows, userClub.id, cupWinnerName, userCup);
    await saveReview(db, career.id, review);
    // Auszeichnungen für eigene Spieler heben die Moral
    for (const a of review.awards) {
      if (!a.entry?.own) continue;
      const p = w.players.get(a.entry.playerId);
      if (p) {
        p.morale = Math.min(100, p.morale + 10);
        w.dirtyPlayers.add(p.id);
      }
    }
  }

  // Meister der aktiven Ligen für die News
  const champions = [...w.leagues.values()]
    .filter((l) => l.active && l.tier === 1)
    .map((l) => ({ leagueName: l.name, clubName: w.clubs.get(tables.get(l.id)![0])?.name ?? "?" }));

  // Prämien und Ruf
  const prizeEntries: { kind: string; amount: number; label: string }[] = [];
  for (const league of w.leagues.values()) {
    const order = tables.get(league.id)!;
    order.forEach((clubId, i) => {
      const club = w.clubs.get(clubId)!;
      const pos = i + 1;
      const swing = (league.size / 2 - pos) / league.size;
      club.reputation = Math.max(1, Math.min(100, Math.round(club.reputation + swing * 4 + (pos === 1 ? 2 : 0))));
      if (club.players_generated && club.finance) {
        const pool = club.finance.tvWeekly * career.season_weeks * 0.5;
        const prize = prizeMoney(pos, league.size, pool * league.size / 4);
        club.balance += prize;
        if (club.id !== career.club_id) club.transfer_budget = Math.max(0, Math.round(club.balance * 0.4));
        if (club.id === career.club_id) prizeEntries.push({ kind: "prize", amount: prize, label: `Platzierungsprämie (Platz ${pos})` });
      } else {
        // Vereinfachte Vereine: Stärke driftet leicht
        club.rating = Math.max(25, Math.min(90, Math.round(club.rating + rng.normal(swing * 2, 1.5))));
      }
      w.dirtyClubs.add(club.id);
    });
  }

  if (career.club_id) await addFinance(db, career.id, career.club_id, career.season, career.week, prizeEntries);

  // Auf- und Abstieg je Land
  const byCountry = new Map<string, LeagueRow[]>();
  for (const l of w.leagues.values()) byCountry.set(l.country_code, [...(byCountry.get(l.country_code) ?? []), l]);
  for (const leagues of byCountry.values()) {
    leagues.sort((a, b) => a.tier - b.tier);
    for (let i = 0; i < leagues.length - 1; i++) {
      const upper = leagues[i];
      const lower = leagues[i + 1];
      const n = Math.min(upper.relegation, lower.promotion);
      const down = tables.get(upper.id)!.slice(-n);
      const up = tables.get(lower.id)!.slice(0, n);
      for (const id of down) w.clubs.get(id)!.league_id = lower.id;
      for (const id of up) w.clubs.get(id)!.league_id = upper.id;
    }
  }

  // Saisonrekord des Managers
  const m = career.manager;
  m.totals.seasons++;
  if (champion) m.totals.titles++;
  if (promoted) m.totals.promotions++;
  const pts = userClub ? pointsOf.get(userClub.id) : undefined;
  let objectiveMet = false;
  let dismissed = false;
  // Abschneiden im Pokal
  let cupResult: string | undefined;
  const cupRow = await query<{ id: number; rounds: { round: number; name: string }[]; winner_club_id: number | null }>(db, "select id, rounds, winner_club_id from cups where career_id = $1 and season = $2 and kind = 'national'", [career.id, career.season]);
  if (cupRow[0] && career.club_id) {
    const cf = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and cup_id = $2 and $3 in (home_id, away_id) order by cup_round desc limit 1", [career.id, cupRow[0].id, career.club_id]);
    if (cupRow[0].winner_club_id === career.club_id) cupResult = "Pokalsieger";
    else if (cf[0]) cupResult = cupRow[0].rounds.find((r) => r.round === cf[0].cup_round)?.name;
  }
  if (userClub && userLeague && pts) {
    m.history.push({
      season: career.season, clubName: userClub.name, leagueName: userLeague.name, position, points: pts.points,
      played: pts.played, champion, promoted, relegated, cup: cupResult,
    });
    await query(
      db,
      `insert into season_results(career_id, account_id, season, club_name, league_name, country_code, tier, position, points, played, ppg, champion, promoted, relegated)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        career.id, career.account_id, career.season, userClub.name, userLeague.name, userLeague.country_code, userLeague.tier, position,
        pts.points, pts.played, pts.played ? Math.round((pts.points / pts.played) * 100) / 100 : 0, champion, promoted, relegated,
      ],
    );
    unlockAchievement(career, "season_done", notes);
    if (champion) {
      unlockAchievement(career, "champion", notes);
      if (m.totals.titles >= 2) unlockAchievement(career, "double_champion", notes);
    }
    if (promoted) unlockAchievement(career, "promotion", notes);
    objectiveMet = position <= career.board.targetPosition && userClub.balance >= career.board.financeTarget;
    const positionOk = position <= career.board.targetPosition;
    grantXp(career, 150 + Math.max(0, (userLeague.size - position) * 10), notes);
    if (objectiveMet) {
      unlockAchievement(career, "objective_met", notes);
      grantXp(career, 300, notes);
      m.points += 100;
    }
    const gap = position - career.board.targetPosition;
    career.board.confidence = Math.max(0, Math.min(100, career.board.confidence + (positionOk ? 15 : -gap * 6) + (userClub.balance >= career.board.financeTarget ? 5 : -10)));
    m.reputation = Math.max(1, Math.min(100, m.reputation + (positionOk ? 4 : -3) + (champion ? 6 : 0) + (promoted ? 5 : 0) - (relegated ? 6 : 0)));
    dismissed = career.board.confidence < 20;
  }

  // Spieler: Saisonbilanz, Alterung, Rücktritte, Verträge
  const newSeason = career.season + 1;
  const retired: string[] = [];
  const loansEnded: string[] = [];
  const loansBought: string[] = [];
  const loanFinance: { kind: string; amount: number; label: string }[] = [];
  const released: string[] = [];
  for (const p of [...w.players.values()]) {
    const club = p.clubId !== null ? w.clubs.get(p.clubId) : undefined;
    if (p.stats.apps > 0) {
      p.history = [
        ...(p.history ?? []).slice(-9),
        {
          season: career.season, clubName: club?.name ?? "vereinslos", apps: p.stats.apps, goals: p.stats.goals, assists: p.stats.assists,
          avgRating: Math.round((p.stats.ratingSum / p.stats.apps) * 10) / 10,
        },
      ];
    }
    p.stats = emptyStats();
    seasonAging(rng, p);
    p.suspendedWeeks = 0;
    w.dirtyPlayers.add(p.id);
    if (rng.chance(retirementChance(p))) {
      if (p.clubId === career.club_id) retired.push(`${p.firstName} ${p.lastName} (${p.age})`);
      removePlayer(w, p);
      continue;
    }
    // Leihen enden mit der Saison: zurück zum Stammverein
    if (p.loan && p.loan.untilSeason <= career.season) {
      const { parentClubId: parentId, optionFee, obligation } = p.loan;
      const holder = club;
      const parent = w.clubs.get(parentId);
      // Kaufpflicht wird vollzogen; eine Kaufoption ziehen KI-Vereine oft, du entscheidest selbst während der Leihe
      const buys = !!optionFee && !!holder && (obligation || (holder.id !== career.club_id && rng.chance(0.5)));
      if (buys && holder && optionFee) {
        holder.balance -= optionFee;
        holder.transfer_budget = Math.max(0, holder.transfer_budget - optionFee);
        w.dirtyClubs.add(holder.id);
        if (parent) { parent.balance += optionFee; w.dirtyClubs.add(parent.id); }
        if (holder.id === career.club_id) loanFinance.push({ kind: "transfer_out", amount: -optionFee, label: `Kaufpflicht ${p.firstName} ${p.lastName}` });
        if (parentId === career.club_id) loanFinance.push({ kind: "transfer_in", amount: optionFee, label: `Kaufoption gezogen: ${p.firstName} ${p.lastName}` });
        if (holder.id === career.club_id || parentId === career.club_id) loansBought.push(`${p.firstName} ${p.lastName} wechselt fest zu ${holder.name} (${formatMoney(optionFee)})`);
        p.loan = null;
      } else {
        if (p.clubId === career.club_id || parentId === career.club_id) loansEnded.push(`${p.firstName} ${p.lastName}`);
        p.loan = null;
        movePlayer(w, p, w.clubs.has(parentId) ? parentId : null);
      }
    }
    if (p.contract && p.contract.untilSeason < newSeason && p.clubId !== null) {
      if (p.clubId === career.club_id) {
        released.push(`${p.firstName} ${p.lastName}`);
        movePlayer(w, p, null);
        p.contract = null;
      } else {
        const squad = squadOf(w, p.clubId);
        const rank = squadRanks(squad).get(p.id) ?? 30;
        if (rank <= 20 && p.age <= 33 && rng.chance(0.75)) {
          p.contract.untilSeason = newSeason + (p.age >= 30 ? 0 : rng.int(1, 2));
          p.contract.wage = Math.round(p.contract.wage * 1.05 / 100) * 100;
        } else {
          movePlayer(w, p, null);
          p.contract = null;
        }
      }
    }
  }

  // Jugendjahrgang
  let nextId = career.next_player_id;
  const youthNames: string[] = [];
  for (const club of w.clubs.values()) {
    // Der eigene Verein erhält seinen Jahrgang am Jugendtag in die Akademie
    if (!club.players_generated || club.id === career.club_id) continue;
    const quality = club.reputation / 2;
    const intake = generateYouthIntake(career.seed, { id: club.id, countryCode: club.country_code, rating: club.rating, reputation: club.reputation }, newSeason, quality, () => nextId++);
    for (const p of intake) {
      w.players.set(p.id, p);
      w.squads.set(club.id, [...squadOf(w, club.id), p]);
      w.newPlayers.push(p);
      if (club.id === career.club_id) {
        youthNames.push(`• ${p.firstName} ${p.lastName} (${p.position}, ${p.age} J., Potenzial ${p.wonderkid ? "Wunderkind!" : p.potential >= 70 ? "hoch" : "mittel"})`);
        if (p.wonderkid) awardCard(career, p, "Wunderkind aus der eigenen Jugend", notes, "epic");
      }
    }
  }
  career.next_player_id = nextId;
  await academySeasonEnd(db, career, rng, newSeason);

  // Freie Spieler ohne Verein länger als eine Saison und älter als 32 hören auf
  for (const p of [...w.freeAgents]) {
    if (p.age >= 33 || (p.rating < 40 && rng.chance(0.4))) removePlayer(w, p);
  }

  // Stärke neu berechnen
  for (const club of w.clubs.values()) {
    if (club.players_generated) club.rating = teamRating(squadOf(w, club.id)) || club.rating;
    if (club.tactic) {
      const ids = new Set(squadOf(w, club.id).map((p) => p.id));
      club.tactic.lineup = club.tactic.lineup.map((id) => (id !== null && ids.has(id) ? id : null));
      club.tactic.bench = club.tactic.bench.filter((id) => ids.has(id));
    }
    w.dirtyClubs.add(club.id);
  }
  await persistWorld(db, w);
  await query(db, "update leagues set active = active where career_id = $1", [career.id]);

  // Jobangebote
  const offers = jobOffers(w, career, rng, dismissed);
  career.job_offers = offers;
  if (dismissed) career.status = "unemployed";

  // Alte Spielpläne aufräumen (eigene Liga bleibt als Historie)
  await query(db, "delete from fixtures where career_id = $1 and season = $2 and league_id <> $3 and cup_id is null", [career.id, career.season, userLeague?.id ?? -1]);

  // Neue Saison
  const summary: SeasonSummary = { season: career.season, position, points: pts?.points ?? 0, champion, promoted, relegated, objectiveMet, dismissed, champions };
  career.season = newSeason;
  career.week = 0;
  career.day = 0;
  await query(db, "update careers set day = 0 where id = $1", [career.id]);
  const newUserClub = career.club_id ? w.clubs.get(career.club_id) : undefined;
  const newUserLeague = newUserClub ? w.leagues.get(newUserClub.league_id) : undefined;
  await scheduleSeason(db, career);
  if (newUserClub && newUserLeague && !dismissed) {
    const conf = career.board.confidence;
    career.board = await boardObjectives(db, career, newUserClub, newUserLeague);
    career.board.confidence = conf;
  }

  // Posteingang
  const title = champion ? `Meister! ${userClub?.name} gewinnt die ${userLeague?.name}` : promoted ? "Aufstieg geschafft!" : relegated ? "Abstieg" : `Saison ${summary.season} beendet`;
  await addInbox(
    db, career.id, newSeason, 0, "board", title,
    `Abschlussplatz: ${position} mit ${pts?.points ?? 0} Punkten.\n` +
      `Saisonziel ${objectiveMet ? "erfüllt" : "verfehlt"} – Vertrauen des Vorstands: ${career.board.confidence}/100.\n` +
      (dismissed ? "\nDer Vorstand hat sich von dir getrennt. Unter Karriere → Freie Stellen findest du Angebote und offene Trainerposten in aller Welt." :
        `\nNeues Saisonziel: ${career.board.objective}`) +
      `\n\nMeister der Topligen: ${champions.slice(0, 8).map((c) => `${c.clubName} (${c.leagueName})`).join(", ")}`,
  );
  if (review) {
    const own = review.awards.filter((a) => a.entry?.own);
    await addInbox(db, career.id, newSeason, 0, "news", `Saisonrückblick ${review.season}`,
      review.awards.map((a) => `${a.title}: ${a.entry ? `${a.entry.name} (${a.entry.clubName}, ${a.entry.value})` : "–"}`).join("\n") +
        (own.length ? `\n\nGlückwunsch: ${own.length} Auszeichnung(en) gehen an deine Spieler.` : "") +
        "\n\nDen ganzen Rückblick findest du unter Karriere → Saisonrückblick.");
  }
  if (loanFinance.length && career.club_id) await addFinance(db, career.id, career.club_id, career.season, career.week, loanFinance);
  if (loansBought.length) {
    await addInbox(db, career.id, newSeason, 0, "transfer", "Kaufoptionen und Kaufpflichten",
      `Zum Saisonende wurden diese Leihen in feste Transfers umgewandelt:\n${loansBought.map((n) => `• ${n}`).join("\n")}`);
  }
  if (loansEnded.length) {
    await addInbox(db, career.id, newSeason, 0, "transfer", "Leihgeschäfte beendet",
      `Diese Leihen sind mit dem Saisonende ausgelaufen:\n${loansEnded.map((n) => `• ${n}`).join("\n")}`);
  }
  if (retired.length || released.length) {
    await addInbox(db, career.id, newSeason, 0, "contract", "Kaderveränderungen zum Saisonwechsel",
      (retired.length ? `Karriereende:\n${retired.map((r) => `• ${r}`).join("\n")}\n\n` : "") +
        (released.length ? `Vertrag ausgelaufen (vereinslos):\n${released.map((r) => `• ${r}`).join("\n")}` : ""));
  }
  if (youthNames.length) {
    await addInbox(db, career.id, newSeason, 0, "youth", "Neuer Jugendjahrgang", `Aus der Akademie rücken nach:\n${youthNames.join("\n")}`);
  }
  if (offers.length && !dismissed) {
    await addInbox(db, career.id, newSeason, 0, "career", "Jobangebote", `Andere Vereine sind auf dich aufmerksam geworden:\n${offers.map((o) => `• ${o.clubName} (${o.leagueName})`).join("\n")}\n\nDetails und Annahme unter Karriere → Freie Stellen.`);
  }
  if (userClub) {
    await addInbox(db, career.id, newSeason, 0, "finance", "Finanzbericht", `Kontostand zum Saisonstart: ${formatMoney(newUserClub?.balance ?? 0)}.`);
  }
  await announceNotes(db, career, notes);
  return summary;
}

function jobOffers(w: WorldState, career: CareerRow, rng: Rng, dismissed: boolean): JobOffer[] {
  const rep = career.manager.reputation;
  const current = career.club_id ? w.clubs.get(career.club_id) : undefined;
  const candidates = [...w.clubs.values()].filter((c) => {
    if (c.id === career.club_id) return false;
    const league = w.leagues.get(c.league_id)!;
    if (dismissed) return c.reputation <= rep + 5 && c.reputation >= rep - 25;
    return c.reputation > (current?.reputation ?? 0) && c.reputation <= rep + 12 && league.tier <= 3;
  });
  const count = dismissed ? 3 : rep > (current?.reputation ?? 100) - 5 ? rng.int(0, 2) : 0;
  const picks = rng.shuffle(candidates).slice(0, Math.max(count, dismissed ? 3 : 0));
  return picks.map((c) => {
    const league = w.leagues.get(c.league_id)!;
    return { clubId: c.id, clubName: c.name, leagueName: league.name, countryCode: c.country_code, reputation: c.reputation, expires: career.season + 1 };
  });
}

export type { Player };
