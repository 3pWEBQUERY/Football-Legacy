/** Sichten: Kader, Taktik, Spielerprofil und Vereinsseite. */
import { DUTY_LABEL, EXPECTED_SHARE, FORMATIONS, INSTRUCTION_CONFLICTS, INSTRUCTION_LABEL, MENTALITY_LABEL, ROLES, STYLE_LABEL, STYLE_PRESETS, askingPrice, defaultStatuses, defaultTactic, ratingForSlot, squadRanks, statusOf, tacticIntensity, leadership, validateTactic, type SquadStatus } from "@fl/sim";
import { scoutLimit } from "../actions";
import { readCareer } from "../career";
import { one, pool, query } from "../db";
import { GameError } from "../errors";
import { playerNegotiation, precontractBlocker } from "../negotiations";
import { getClub, getLeague, getPlayer, getPlayers } from "../repo";
import { MAX_TACTICS, familiarityOf, getTactics, presetName } from "../tactics";
import { windowFor } from "../window";
import { ORDER, careerSummary, clubNames, clubSummary, knowledgeFor, loanedOut, playerView, positionOrder, scoutReport } from "./common";

// ---------------------------------------------------------------- Team

export async function squadView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) return { players: [], club: null, career: careerSummary(career) };
  const club = (await getClub(pool(), career.id, career.club_id))!;
  const players = await getPlayers(pool(), career.id, [club.id]);
  const ranks = squadRanks(players);
  const out = await loanedOut(career.id, club.id);
  const parentIds = [...new Set(players.map((p) => p.loan?.parentClubId).filter((x): x is number => !!x))];
  const names = await clubNames(career.id, [...parentIds, ...out.map((p) => p.clubId!)]);
  return {
    career: careerSummary(career),
    club: { ...clubSummary(club), balance: club.balance, transferBudget: club.transfer_budget },
    players: players
      .sort((a, b) => positionOrder(a.position) - positionOrder(b.position) || b.rating - a.rating)
      .map((p) => playerView(p, "exact", { squadRank: ranks.get(p.id), loanFrom: p.loan ? names.get(p.loan.parentClubId) ?? null : null })),
    loanedOut: out.map((p) => playerView(p, "exact", { loanTo: names.get(p.clubId!) ?? null })),
  };
}


export async function tacticView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Kein Verein");
  const club = (await getClub(pool(), career.id, career.club_id))!;
  const players = await getPlayers(pool(), career.id, [club.id]);
  const tactic = validateTactic(club.tactic ?? defaultTactic(players, "4-4-2", STYLE_PRESETS.balanced.style), players, { keepUnavailable: true });
  const tst = await getTactics(pool(), career, club);
  return {
    career: careerSummary(career),
    club: clubSummary(club),
    tactic,
    players: players.map((p) => ({
      ...playerView(p, "exact"),
      ratings: Object.fromEntries(ORDER.map((pos) => [pos, ratingForSlot(p, pos)])),
    })),
    formations: Object.fromEntries(Object.entries(FORMATIONS).map(([k, v]) => [k, v])),
    roles: ROLES,
    styleLabels: STYLE_LABEL,
    presets: STYLE_PRESETS,
    training: career.training,
    mentalities: MENTALITY_LABEL,
    duties: DUTY_LABEL,
    instructions: INSTRUCTION_LABEL,
    conflicts: INSTRUCTION_CONFLICTS,
    tactics: {
      active: tst.active,
      slots: tst.slots.map((x, i) => ({ index: i, name: x.name, formation: x.tactic.formation, preset: presetName(x.tactic), mentality: x.tactic.mentality ?? 0 })),
      max: MAX_TACTICS,
    },
    familiarity: familiarityOf(tst, tactic),
    formationFamiliarity: tst.formation,
    intensity: tacticIntensity(tactic.style, tactic.mentality ?? 0, tactic.instructions),
    // Kapitän: die besten Anführer des Kaders (Gelassenheit, Entscheidungen, Einsatz, Erfahrung)
    leaders: [...players].map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.position, value: Math.round(leadership(p) * 100) }))
      .sort((a, b) => b.value - a.value).slice(0, 8),
    opponent: await nextOpponent(career, club.id),
  };
}

/** Nächster Pflichtspielgegner mit seinen wichtigsten Spielern (für Gegneranweisungen). */
async function nextOpponent(career: Awaited<ReturnType<typeof readCareer>>, clubId: number) {
  const f = await one<{ home_id: number; away_id: number }>(pool(),
    "select home_id, away_id from fixtures where career_id = $1 and season = $2 and not played and $3 in (home_id, away_id) order by week, round limit 1",
    [career.id, career.season, clubId]);
  if (!f) return null;
  const oppId = f.home_id === clubId ? f.away_id : f.home_id;
  const opp = await getClub(pool(), career.id, oppId);
  if (!opp) return null;
  const squad = await getPlayers(pool(), career.id, [oppId]);
  const k = await knowledgeFor(career, squad, (await getClub(pool(), career.id, clubId))?.league_id ?? null);
  return {
    club: clubSummary(opp), home: f.away_id === clubId,
    players: [...squad].sort((a, b) => b.rating - a.rating).slice(0, 14).map((p) => playerView(p, k.of(p))),
  };
}

export async function playerDetail(careerId: string, accountId: string, playerId: number) {
  const career = await readCareer(careerId, accountId);
  const p = await getPlayer(pool(), career.id, playerId);
  if (!p) throw new GameError("Spieler nicht gefunden", 404);
  const userClub = career.club_id ? await getClub(pool(), career.id, career.club_id) : null;
  const k = await knowledgeFor(career, [p], userClub?.league_id ?? null);
  const club = p.clubId !== null ? await getClub(pool(), career.id, p.clubId) : null;
  const league = club ? await getLeague(pool(), career.id, club.league_id) : null;
  const report = await one<{ report: unknown }>(pool(), "select report from shortlist where career_id = $1 and player_id = $2", [career.id, p.id]);
  let ask: number | null = null;
  if (club && club.id !== career.club_id) {
    const squad = await getPlayers(pool(), career.id, [club.id]);
    ask = askingPrice(p, { season: career.season, squadRank: squadRanks(squad).get(p.id) ?? 20, squadSize: squad.length, sellerReputation: club.reputation, isUserClub: false });
  }
  const history = await query(pool(), "select fee, from_club, to_club, season, kind from transfers where career_id = $1 and player_id = $2 and status = 'completed' order by id desc limit 10", [career.id, p.id]);
  let squadStatus: { value: SquadStatus; suggested: SquadStatus; expected: number } | null = null;
  if (p.clubId === career.club_id) {
    const own = await getPlayers(pool(), career.id, [career.club_id!]);
    const defaults = defaultStatuses(own, userClub?.tactic?.formation);
    const value = statusOf(p, defaults);
    squadStatus = { value, suggested: defaults.get(p.id) ?? "backup", expected: Math.round(EXPECTED_SHARE[value] * 100) };
  }
  return {
    squadStatus,
    career: careerSummary(career),
    player: playerView(p, k.of(p)),
    club: club ? clubSummary(club) : null,
    league: league ? { id: league.id, name: league.name, countryCode: league.country_code } : null,
    report: scoutReport(career, report?.report),
    shortlisted: k.shortlisted.has(p.id),
    askingPrice: ask,
    own: p.clubId === career.club_id,
    transfers: history,
    window: windowFor(career),
    scoutLimit: scoutLimit(career),
    budget: userClub?.transfer_budget ?? 0,
    loanParent: p.loan ? (await clubNames(career.id, [p.loan.parentClubId])).get(p.loan.parentClubId) ?? null : null,
    loanedOutByUser: !!p.loan && p.loan.parentClubId === career.club_id,
    negotiation: career.club_id ? await playerNegotiation(pool(), career, p.id) : null,
    precontract: {
      // Angebot möglich (letztes Vertragsjahr bei einem anderen Verein) – sonst der Grund
      lastYear: p.clubId !== null && p.clubId !== career.club_id && p.contract?.untilSeason === career.season,
      blocker: career.club_id ? precontractBlocker(career, p) : "Ohne Verein keine Vorverträge.",
      signed: p.precontract ? { clubId: p.precontract.clubId, club: (await clubNames(career.id, [p.precontract.clubId])).get(p.precontract.clubId) ?? "?", own: p.precontract.clubId === career.club_id } : null,
    },
  };
}

export async function clubView(careerId: string, accountId: string, clubId: number) {
  const career = await readCareer(careerId, accountId);
  const club = await getClub(pool(), career.id, clubId);
  if (!club) throw new GameError("Verein nicht gefunden", 404);
  const league = (await getLeague(pool(), career.id, club.league_id))!;
  const players = await getPlayers(pool(), career.id, [club.id]);
  const userClub = career.club_id ? await getClub(pool(), career.id, career.club_id) : null;
  const k = await knowledgeFor(career, players, userClub?.league_id ?? null);
  return {
    career: careerSummary(career),
    club: clubSummary(club),
    league: { id: league.id, name: league.name, tier: league.tier, countryCode: league.country_code, active: league.active },
    generated: club.players_generated,
    players: players
      .sort((a, b) => positionOrder(a.position) - positionOrder(b.position) || b.rating - a.rating)
      .map((p) => playerView(p, k.of(p))),
    tactic: club.tactic ? { formation: club.tactic.formation } : null,
  };
}
