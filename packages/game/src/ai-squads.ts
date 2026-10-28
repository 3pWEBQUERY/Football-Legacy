/**
 * Kaderpflege der KI-Vereine (wöchentlich): Ergänzungsspieler auf die
 * Transferliste, Wechselwünsche guter Spieler ohne Einsatz, und während des
 * Transferfensters Leihen junger Talente an kleinere Vereine.
 */
import { Rng, squadRanks } from "@fl/sim";
import { movePlayer, squadOf, type WorldState } from "./world-state";

export interface SquadNews {
  text: string;
  userLeague: boolean;
  type: "unrest" | "loan";
  playerId: number;
  clubId: number;
  toClubId?: number;
}

export function aiSquadWeek(w: WorldState, rng: Rng, windowOpen: boolean): SquadNews[] {
  const news: SquadNews[] = [];
  const userId = w.career.club_id;
  const userLeague = userId ? w.clubs.get(userId)?.league_id : undefined;
  const clubs = [...w.clubs.values()].filter((c) => c.players_generated && c.id !== userId);
  for (const club of clubs) {
    const squad = squadOf(w, club.id).filter((p) => !p.loan);
    const ranks = squadRanks(squad);
    for (const p of squad) {
      const rank = ranks.get(p.id) ?? 30;
      // Ergänzungsspieler stehen zum Verkauf, Stammkräfte nicht
      const surplus = rank > 20 && p.age >= 22 || squad.length > 27 && rank > 18;
      if (surplus !== p.listed && (surplus ? rng.chance(0.25) : rank <= 16)) { p.listed = surplus; w.dirtyPlayers.add(p.id); }
      // Gute Spieler auf der Bank werden unruhig
      const restless = rank >= 15 && p.rating >= club.rating - 1 && p.age >= 21 && p.age <= 31;
      if (restless && !p.transferRequest && rng.chance(0.03)) {
        p.transferRequest = true;
        p.listed = true;
        w.dirtyPlayers.add(p.id);
        if (club.league_id === userLeague) news.push({ text: `${p.firstName} ${p.lastName} (${club.name}) will den Verein verlassen.`, userLeague: true, type: "unrest", playerId: p.id, clubId: club.id });
      } else if (p.transferRequest && rank <= 12) {
        p.transferRequest = false;
        w.dirtyPlayers.add(p.id);
      }
    }
    if (windowOpen) loanOut(w, rng, club.id, squad, ranks, news, userLeague);
  }
  return news;
}

/** Grosse Vereine verleihen Talente ohne Einsatzchance an passende kleinere Vereine. */
function loanOut(w: WorldState, rng: Rng, clubId: number, squad: ReturnType<typeof squadOf>, ranks: Map<number, number>, news: SquadNews[], userLeague?: number) {
  const club = w.clubs.get(clubId)!;
  if (club.reputation < 55 || squad.length < 24) return;
  const talents = squad.filter((p) => p.age <= 21 && (ranks.get(p.id) ?? 30) > 18 && p.potential >= p.rating + 8 && !p.precontract);
  for (const p of talents) {
    if (!rng.chance(0.12)) continue;
    const hosts = [...w.clubs.values()].filter((c) =>
      c.players_generated && c.id !== clubId && c.id !== w.career.club_id && c.reputation < club.reputation - 8 &&
      c.rating >= p.rating - 3 && c.rating <= p.rating + 8 && squadOf(w, c.id).length < 26);
    if (!hosts.length) continue;
    const host = rng.pick(hosts);
    movePlayer(w, p, host.id);
    p.loan = { parentClubId: clubId, untilSeason: w.career.season, wageShare: 0.6 };
    p.listed = false;
    if (host.league_id === userLeague || club.league_id === userLeague) {
      news.push({ text: `${club.name} verleiht Talent ${p.firstName} ${p.lastName} an ${host.name}.`, userLeague: true, type: "loan", playerId: p.id, clubId, toClubId: host.id });
    }
    return; // höchstens eine Leihe pro Verein und Woche
  }
}
