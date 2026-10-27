/**
 * Saisonwechsel: Wirtschaft und Spielerbestand im Gleichgewicht halten.
 * - Einnahmen folgen jedes Jahr Liga-Stufe und Ruf (Aufstieg bringt mehr TV-Geld).
 * - KI-Vereine wirtschaften nachhaltig: Verschuldete sparen, Reiche investieren.
 * - KI-Kader und der Markt der Vereinslosen wachsen nicht unbegrenzt.
 */
import { type Player, type Rng, financeProfile, squadRanks, tierMoney, wageBill } from "@fl/sim";
import type { CareerRow } from "./repo";
import { difficultySettings } from "./difficulty";
import { type WorldState, movePlayer, removePlayer, squadOf } from "./world-state";

/** Grösster Kader, den KI-Vereine in die neue Saison mitnehmen. */
export const MAX_AI_SQUAD = 28;
/** Vereinslose je aktivem Verein, mehr hält der Markt nicht. */
const FREE_AGENTS_PER_CLUB = 2;

export interface SeasonStart { tier: Map<number, number>; reputation: Map<number, number> }

/** Stand vor Auf- und Abstieg und vor den Ruf-Änderungen der Saison. */
export function seasonStart(w: WorldState): SeasonStart {
  const tier = new Map<number, number>();
  const reputation = new Map<number, number>();
  for (const c of w.clubs.values()) {
    tier.set(c.id, w.leagues.get(c.league_id)?.tier ?? 1);
    reputation.set(c.id, c.reputation);
  }
  return { tier, reputation };
}

/** Finanzprofile für die neue Saison. */
export function refreshFinances(w: WorldState, career: CareerRow, before: SeasonStart) {
  const loanedOut = new Map<number, Player[]>();
  for (const p of w.players.values()) if (p.loan) loanedOut.set(p.loan.parentClubId, [...(loanedOut.get(p.loan.parentClubId) ?? []), p]);
  for (const club of w.clubs.values()) {
    if (!club.players_generated || !club.finance) continue;
    const tier = w.leagues.get(club.league_id)?.tier ?? 1;
    const info = { countryCode: club.country_code, reputation: club.reputation, capacity: club.capacity };
    const wages = wageBill(squadOf(w, club.id), loanedOut.get(club.id) ?? []);
    if (club.id === career.club_id) {
      // Eigener Verein: Einnahmen hängen an Liga und Ruf, nicht an den eigenen Gehältern
      const base = club.finance.baseWages ?? wages;
      const oldTier = before.tier.get(club.id) ?? tier;
      const repShift = (club.reputation - (before.reputation.get(club.id) ?? club.reputation)) / 80;
      const next = base * (tierMoney(tier) / tierMoney(oldTier)) * (1 + repShift);
      club.finance = { ...financeProfile(info, next, tier, difficultySettings(career).margin), ticketPrice: club.finance.ticketPrice };
    } else {
      // KI: Verschuldete fahren einen Sparkurs, sehr reiche Vereine investieren ihren Überschuss
      const annual = wages * 52;
      const margin = club.balance < 0 ? 1.15 : club.balance > annual ? 0.98 : 1.04;
      club.finance = financeProfile(info, wages, tier, margin);
      if (club.balance < 0) club.transfer_budget = 0;
    }
    w.dirtyClubs.add(club.id);
  }
}

/** KI-Kader auf MAX_AI_SQUAD begrenzen: zuerst ältere Ergänzungsspieler, Talente bleiben. */
export function trimSquads(w: WorldState, career: CareerRow): number {
  let released = 0;
  for (const club of w.clubs.values()) {
    if (!club.players_generated || club.id === career.club_id) continue;
    const squad = squadOf(w, club.id).filter((p) => !p.loan);
    if (squad.length <= MAX_AI_SQUAD) continue;
    const ranks = squadRanks(squad);
    const prospect = (p: Player) => p.age <= 20 && p.potential >= p.rating + 8;
    const out = squad
      .filter((p) => (ranks.get(p.id) ?? 99) > 18 && !prospect(p))
      .sort((a, b) => b.age - a.age || a.rating - b.rating)
      .slice(0, squad.length - MAX_AI_SQUAD);
    for (const p of out) {
      movePlayer(w, p, null);
      p.contract = null;
      released++;
    }
  }
  return released;
}

/**
 * Vereinslose: ältere hören eher auf, schwache verschwinden vom Markt, und
 * der Markt ist auf FREE_AGENTS_PER_CLUB je Verein begrenzt. Liefert die
 * Spieler, die ihre Karriere beenden.
 */
export function trimFreeAgents(w: WorldState, rng: Rng): Player[] {
  const gone: Player[] = [];
  const retire = (p: Player) => { gone.push(p); removePlayer(w, p); };
  for (const p of [...w.freeAgents]) {
    if (p.age >= 33 || (p.age >= 30 && rng.chance(0.5)) || (p.rating < 45 && rng.chance(0.5))) retire(p);
  }
  const clubs = [...w.clubs.values()].filter((c) => c.players_generated).length;
  const cap = Math.max(150, clubs * FREE_AGENTS_PER_CLUB);
  if (w.freeAgents.length > cap) {
    const worst = [...w.freeAgents].sort((a, b) => a.rating - b.rating || b.age - a.age).slice(0, w.freeAgents.length - cap);
    worst.forEach(retire);
  }
  return gone;
}
