/** KI-Transfermarkt: Vereine handeln untereinander und bieten für deine Spieler. */
import {
  Rng, askingPrice, evaluateFee, evaluateTerms, formatMoney, roundMoney, squadNeed, squadRanks, wageDemand, type Player,
} from "@fl/sim";
import type { Db } from "./db";
import { query } from "./db";
import { addInbox } from "./repo";
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
  const market = [...w.players.values()].filter((p) => p.clubId !== userClubId);

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
    const need = squadNeed(squad, rng);
    if (!need) continue;
    const minRating = Math.max(need.currentBest - 3, club.rating - 6);
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
    const wage = Math.round(Math.max(wageDemand(target, club.reputation), (target.contract?.wage ?? 0) * 1.1) / 100) * 100;
    if (wage * 52 > club.balance * 0.5 && fee > 0) continue;
    const terms = evaluateTerms(target, { wage, years: 3, releaseClause: null }, club.reputation, sellerClub?.reputation ?? 20, rng);
    if (terms.kind !== "accept") continue;
    // Transfer durchführen
    if (sellerClub) {
      sellerClub.balance += fee;
      sellerClub.transfer_budget += Math.round(fee * 0.6);
      w.dirtyClubs.add(sellerClub.id);
    }
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

/** KI-Vereine bieten für Spieler des Nutzers. */
export async function aiBidsForUser(db: Db, w: WorldState, rng: Rng) {
  const userClubId = w.career.club_id;
  if (!userClubId) return;
  const squad = squadOf(w, userClubId);
  const pending = await query<{ n: number }>(
    db, "select count(*)::int as n from transfers where career_id = $1 and kind = 'offer_in' and status = 'pending'", [w.career.id],
  );
  if ((pending[0]?.n ?? 0) >= 2) return;
  const listedBoost = squad.some((p) => p.listed) ? 0.45 : 0;
  if (!rng.chance(0.18 + listedBoost)) return;
  const pool = squad.filter((p) => p.listed || rng.chance(0.25));
  if (!pool.length) return;
  const target = pool[rng.weighted(pool.map((p) => (p.listed ? 6 : 1) * Math.sqrt(p.value)))];
  const userClub = w.clubs.get(userClubId)!;
  const bidders = [...w.clubs.values()].filter(
    (c) => c.players_generated && c.id !== userClubId && c.transfer_budget > target.value * 0.8 && Math.abs(c.rating - target.rating) <= 10,
  );
  if (!bidders.length) return;
  const bidder = rng.pick(bidders);
  const fee = roundMoney(Math.min(bidder.transfer_budget, target.value * rng.range(0.8, 1.35)));
  const name = `${target.firstName} ${target.lastName}`;
  const rows = await query<{ id: number }>(
    db,
    `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, season, week, message)
     values ($1,$2,$3,$4,$5,$6,0,0,'offer_in','pending',$7,$8,$9) returning id`,
    [w.career.id, target.id, name, userClubId, bidder.id, fee, w.career.season, w.career.week, `Angebot von ${bidder.name}`],
  );
  await addInbox(
    db, w.career.id, w.career.season, w.career.week, "transfer", `Angebot für ${name}`,
    `${bidder.name} bietet ${formatMoney(fee)} für ${name} (Marktwert ${formatMoney(target.value)}).\n` +
      `Dein Kontostand: ${formatMoney(userClub.balance)}. Du kannst annehmen, ablehnen oder eine höhere Ablöse fordern.`,
    { type: "transfer_offer", transferId: rows[0].id },
  );
}
