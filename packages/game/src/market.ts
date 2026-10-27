/** KI-Transfermarkt: Vereine handeln untereinander (Angebote für deine Spieler: negotiations/sales). */
import {
  Rng, askingPrice, evaluateFee, evaluateTerms, formatMoney, squadNeed, squadRanks, wageDemand, wageFactor, type Player,
} from "@fl/sim";
import type { Db } from "./db";
import { query } from "./db";
import { addFinance, addInbox } from "./repo";
import { type WorldState, movePlayer, squadOf } from "./world-state";

export interface MarketNews {
  text: string;
  important: boolean;
}

function sellerContext(w: WorldState, p: Player) {
  const squad = p.clubId !== null ? squadOf(w, p.clubId) : [];
  const ranks = squadRanks(squad);
  const club = p.clubId !== null ? w.clubs.get(p.clubId) : undefined;
  return {
    season: w.career.season,
    squadRank: ranks.get(p.id) ?? 30,
    squadSize: squad.length,
    sellerReputation: club?.reputation ?? 30,
    isUserClub: p.clubId === w.career.club_id,
  };
}

/** Ein Transfertag der KI-Vereine. */
export async function aiMarketRound(db: Db, w: WorldState, rng: Rng): Promise<MarketNews[]> {
  const news: MarketNews[] = [];
  const userClubId = w.career.club_id;
  const userLeague = userClubId ? w.clubs.get(userClubId)?.league_id : undefined;
  const activeClubs = [...w.clubs.values()].filter((c) => c.players_generated && c.id !== userClubId);
  const market = [...w.players.values()].filter((p) => p.clubId !== userClubId && !p.loan && !p.precontract);

  // Ligaschnitt der Stärke: wer weit vorne liegt, rüstet nicht immer weiter auf
  const leagueRating = new Map<number, { sum: number; n: number }>();
  for (const c of activeClubs) {
    const r = leagueRating.get(c.league_id) ?? { sum: 0, n: 0 };
    leagueRating.set(c.league_id, { sum: r.sum + c.rating, n: r.n + 1 });
  }
  for (const club of activeClubs) {
    const squad = squadOf(w, club.id);
    // Überzählige Spieler abgeben
    if (squad.length > 30) {
      const worst = [...squad].sort((a, b) => a.rating - b.rating)[0];
      movePlayer(w, worst, null);
      worst.contract = null;
      continue;
    }
    if (!rng.chance(squad.length < 20 ? 0.6 : 0.16)) continue;
    const lr = leagueRating.get(club.league_id);
    if (lr && lr.n >= 6 && club.rating > lr.sum / lr.n + 8 && squad.length >= 22) continue;
    const need = squadNeed(squad, rng);
    if (!need) continue;
    // Dünner Kader: auch Ergänzungsspieler unter Stammelf-Niveau kommen in Frage
    const minRating = squad.length < 22 ? club.rating - 16 : Math.max(need.currentBest - 3, club.rating - 6);
    const maxRating = club.rating + 6;
    const budget = club.transfer_budget;
    const candidates = market.filter(
      (p) => p.clubId !== club.id && p.rating >= minRating && p.rating <= maxRating &&
        (p.position === need.position || p.altPositions.includes(need.position)) && p.injuryWeeks === 0 && p.age <= 33,
    );
    // Bezahlbare Kandidaten, die besten Preis-Leistungs-Verhältnisse zuerst
    const priced = candidates
      .map((p) => ({ p, fee: p.clubId === null ? 0 : askingPrice(p, sellerContext(w, p)) }))
      .filter((c) => c.fee <= budget)
      .sort((a, b) => b.p.rating - b.fee / 2_000_000 - (a.p.rating - a.fee / 2_000_000));
    if (!priced.length) continue;
    const { p: target, fee } = priced[Math.min(priced.length - 1, Math.floor(rng.next() * Math.min(5, priced.length)))];
    const sellerClub = target.clubId !== null ? w.clubs.get(target.clubId) : undefined;
    if (target.clubId !== null) {
      const verdict = evaluateFee(target, fee, sellerContext(w, target), rng);
      if (verdict.kind !== "accept") continue;
      // Abgebender Verein darf nicht ausbluten
      if (squadOf(w, target.clubId).length <= 18) continue;
    }
    const wage = Math.round(Math.max(wageDemand(target, club.reputation) * wageFactor(target), (target.contract?.wage ?? 0) * 1.1) / 100) * 100;
    if (wage * 52 > club.balance * 0.5 && fee > 0) continue;
    const terms = evaluateTerms(target, { wage, years: 3, releaseClause: null }, club.reputation, sellerClub?.reputation ?? 20, rng);
    if (terms.kind !== "accept") continue;
    // Transfer durchführen
    if (sellerClub) {
      sellerClub.balance += fee;
      sellerClub.transfer_budget += Math.round(fee * 0.6);
      w.dirtyClubs.add(sellerClub.id);
      // Weiterverkaufsbeteiligung an einen früheren Verein (z. B. deinen)
      const former = target.sellOn ? w.clubs.get(target.sellOn.clubId) : undefined;
      if (target.sellOn && former && fee > 0) {
        const share = Math.round((fee * target.sellOn.pct) / 100);
        sellerClub.balance -= share;
        former.balance += share;
        w.dirtyClubs.add(former.id);
        if (former.id === userClubId) {
          await addFinance(db, w.career.id, former.id, w.career.season, w.career.week, [{ kind: "transfer_in", amount: share, label: `Weiterverkaufsbeteiligung ${target.firstName} ${target.lastName}` }]);
          await addInbox(db, w.career.id, w.career.season, w.career.week, "transfer", `Weiterverkauf: ${formatMoney(share)} für ${target.firstName} ${target.lastName}`,
            `${sellerClub.name} hat ${target.firstName} ${target.lastName} für ${formatMoney(fee)} an ${club.name} verkauft. Deine Beteiligung von ${target.sellOn.pct} % bringt ${formatMoney(share)}.`);
        }
      }
    }
    target.sellOn = null;
    club.balance -= fee;
    club.transfer_budget -= fee;
    w.dirtyClubs.add(club.id);
    const fromName = sellerClub?.name ?? "vereinslos";
    movePlayer(w, target, club.id);
    target.contract = { wage, untilSeason: w.career.season + (target.age >= 30 ? 1 : 3), releaseClause: null, goalBonus: 0 };
    target.morale = 75;
    w.dirtyPlayers.add(target.id);
    const name = `${target.firstName} ${target.lastName}`;
    await query(
      db,
      `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, season, week)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'ai','completed',$9,$10)`,
      [w.career.id, target.id, name, sellerClub?.id ?? null, club.id, fee, wage, 3, w.career.season, w.career.week],
    );
    const inUserLeague = club.league_id === userLeague || sellerClub?.league_id === userLeague;
    if (inUserLeague || fee >= 15_000_000) {
      news.push({
        text: `${club.name} verpflichtet ${name} (${target.position}, ${target.rating}) von ${fromName}${fee ? ` für ${formatMoney(fee)}` : " ablösefrei"}.`,
        important: fee >= 15_000_000,
      });
    }
  }
  return news;
}
