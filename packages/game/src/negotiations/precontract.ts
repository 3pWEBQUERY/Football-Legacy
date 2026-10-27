/**
 * Vorverträge: Spieler im letzten Vertragsjahr dürfen ab dem 1. Januar mit
 * anderen Vereinen unterschreiben und wechseln im Sommer ablösefrei. Du kannst
 * so Spieler holen – KI-Vereine werben aber auch deine auslaufenden Spieler ab.
 */
import { Rng, SQUAD_STATUS_LABEL, dateOf, formatMoney, seedFor, squadRanks, wageBill, wageDemand, type Player } from "@fl/sim";
import { withCareer } from "../career";
import { one, query, type Db } from "../db";
import { GameError } from "../errors";
import { addArticle } from "../media";
import { clubSender, send } from "../news";
import { addFinance, getClub, getPlayer, getPlayers, saveCareer, saveClubs, savePlayers, type CareerRow } from "../repo";
import { announceNotes, completeMission, unlockAchievement, type RewardNote } from "../rewards";
import { movePlayer, squadOf, type WorldState } from "../world-state";
import { transferBan } from "../club-safety";
import { ACTIVE, describeTerms, initialDemand, insertNeg, log, newNeg, requireClub, type ContractTerms, type NegRow } from "./core";

/** Ab dem 1. Januar (ältere Spielstände ohne Kalender: ab der Saisonhälfte). */
export function precontractOpen(career: CareerRow, day = career.day): boolean {
  if (career.calendar?.slots?.length) return dateOf(career.season, day).getUTCFullYear() > career.season;
  return career.week >= Math.ceil(career.season_weeks / 2);
}

/** Warum (noch) kein Vorvertrag möglich ist – oder null. */
export function precontractBlocker(career: CareerRow, p: Player): string | null {
  if (p.clubId === null) return "Vereinslose Spieler kannst du direkt verpflichten.";
  if (p.clubId === career.club_id) return "Der Spieler gehört bereits zu deinem Verein.";
  if (p.loan) return "Der Spieler ist ausgeliehen.";
  if (!p.contract || p.contract.untilSeason !== career.season) return "Vorverträge gibt es nur mit Spielern im letzten Vertragsjahr.";
  if (p.precontract) return p.precontract.clubId === career.club_id ? "Der Spieler hat bereits bei dir unterschrieben." : "Der Spieler hat bereits einen Vorvertrag bei einem anderen Verein.";
  if (!precontractOpen(career)) return "Vorverträge sind ab dem 1. Januar möglich.";
  return null;
}

export async function startPrecontract(careerId: string, accountId: string, playerId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    const p = await getPlayer(db, career.id, playerId);
    if (!p) throw new GameError("Spieler nicht gefunden", 404);
    const blocker = precontractBlocker(career, p);
    if (blocker) throw new GameError(blocker);
    const open = await one<{ id: number }>(db, "select id from negotiations where career_id = $1 and player_id = $2 and stage = any($3::text[])", [career.id, p.id, ACTIVE]);
    if (open) throw new GameError("Mit diesem Spieler läuft bereits eine Verhandlung.");
    const buyer = (await getClub(db, career.id, clubId))!;
    const ban = transferBan(buyer);
    if (ban) throw new GameError(ban);
    const seller = (await getClub(db, career.id, p.clubId!))!;
    const squad = await getPlayers(db, career.id, [clubId]);
    const incoming = await one<{ n: number }>(db, "select count(*)::int as n from players where career_id = $1 and (data->'precontract'->>'clubId')::int = $2", [career.id, clubId]);
    if (squad.length + (incoming?.n ?? 0) >= 32) throw new GameError("Dein Kader für die neue Saison ist voll (max. 32 Spieler inklusive Vorverträge).");
    // Stammspieler grösserer Vereine wollen lieber verlängern
    const rank = squadRanks(await getPlayers(db, career.id, [seller.id])).get(p.id) ?? 30;
    if (rank <= 5 && seller.reputation > buyer.reputation + 5) throw new GameError(`${p.firstName} ${p.lastName} fühlt sich bei ${seller.name} wohl und will dort zuerst über eine Verlängerung sprechen.`);
    const d = initialDemand(p, buyer, seller, squad, 0);
    if ("refuse" in d) throw new GameError(d.refuse);
    // Ohne Ablöse verlangen Spieler und Berater mehr Handgeld
    const demand: ContractTerms = { ...d, signingBonus: Math.round((d.wage * 14) / 1000) * 1000 };
    const n = newNeg(career, "pre", p, p.clubId, clubId);
    n.stage = "contract";
    n.status = "open";
    n.demand = demand;
    n.message = `Der Berater von ${n.player_name} ist offen für einen Vorvertrag – der Wechsel erfolgt im Sommer ablösefrei.`;
    log(n, career, "berater", `Forderung: ${describeTerms(demand)}`);
    await insertNeg(db, n);
    return { id: n.id, message: n.message, stage: n.stage, status: n.status };
  });
}

/** Einigung: Der Spieler unterschreibt jetzt, wechselt aber erst zur neuen Saison. */
export async function completePrecontract(db: Db, career: CareerRow, n: NegRow, t: ContractTerms) {
  const p = (await getPlayer(db, career.id, n.player_id))!;
  const buyer = (await getClub(db, career.id, n.to_club))!;
  const seller = n.from_club ? await getClub(db, career.id, n.from_club) : null;
  p.precontract = { clubId: buyer.id, season: career.season, wage: t.wage, years: t.years, role: t.role, releaseClause: t.releaseClause };
  await savePlayers(db, career.id, [p]);
  buyer.balance -= t.signingBonus + t.agentFee;
  buyer.transfer_budget = Math.max(0, buyer.transfer_budget - t.signingBonus - t.agentFee);
  await saveClubs(db, career.id, [buyer]);
  const fin = [
    ...(t.signingBonus ? [{ kind: "transfer_out", amount: -t.signingBonus, label: `Handgeld Vorvertrag ${n.player_name}` }] : []),
    ...(t.agentFee ? [{ kind: "transfer_out", amount: -t.agentFee, label: `Beraterhonorar Vorvertrag ${n.player_name}` }] : []),
  ];
  if (fin.length) await addFinance(db, career.id, buyer.id, career.season, career.week, fin);
  await query(db,
    `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, message, season, week)
     values ($1,$2,$3,$4,$5,0,$6,$7,'buy','completed','Vorvertrag – Wechsel im Sommer',$8,$9)`,
    [career.id, p.id, n.player_name, seller?.id ?? null, buyer.id, t.wage, t.years, career.season, career.week]);
  n.stage = "done";
  n.status = "agreed";
  n.message = `${n.player_name} unterschreibt einen Vorvertrag und kommt im Sommer ablösefrei zu ${buyer.name}!`;
  const notes: RewardNote[] = [];
  unlockAchievement(career, "first_signing", notes);
  completeMission(career, "sign_player", notes);
  await saveCareer(db, career);
  await announceNotes(db, career, notes);
  await send(db, career, {
    category: "transfer", title: `Vorvertrag: ${n.player_name}`, sender: clubSender(buyer, "Sportdirektion"),
    blocks: [
      { t: "p", text: `${n.player_name} hat unterschrieben und wechselt zur Saison ${career.season + 1}/${String((career.season + 2) % 100).padStart(2, "0")} ablösefrei${seller ? ` von ${seller.name}` : ""} zu uns.` },
      { t: "kv", rows: [["Gehalt ab Sommer", `${formatMoney(t.wage)} / Woche`], ["Vertrag bis", `Sommer ${career.season + 1 + t.years}`], ["Rolle", SQUAD_STATUS_LABEL[t.role]], ["Handgeld", formatMoney(t.signingBonus)], ["Beraterhonorar", formatMoney(t.agentFee)]] },
    ],
    priority: 2, kind: "signing", action: { type: "player", playerId: p.id },
  });
  await addArticle(db, career, {
    kind: "transfer", title: `${n.player_name} unterschreibt Vorvertrag bei ${buyer.name}`,
    body: `${n.player_name}${seller ? ` (noch ${seller.name})` : ""} hat sich mit ${buyer.name} geeinigt und wechselt im Sommer ablösefrei.`,
    clubId: buyer.id, playerId: p.id, own: true, importance: 2,
  });
  return { status: "completed", message: n.message, notes };
}

/** Saisonwechsel: Spieler mit Vorvertrag ziehen um. Liefert eine Zeile für den Saisonbericht, wenn dein Verein beteiligt ist. */
export function applyPrecontract(w: WorldState, p: Player, career: CareerRow, newSeason: number): string | false | null {
  const pc = p.precontract;
  if (!pc) return null;
  p.precontract = null;
  w.dirtyPlayers.add(p.id);
  const dest = w.clubs.get(pc.clubId);
  if (!dest || pc.season !== career.season || p.clubId === pc.clubId || p.loan) return null;
  const from = p.clubId !== null ? w.clubs.get(p.clubId) : undefined;
  movePlayer(w, p, dest.id);
  p.joined = { season: newSeason };
  p.squadStatus = pc.role;
  p.sellOn = null;
  p.contract = { wage: pc.wage, untilSeason: newSeason + pc.years - 1, releaseClause: pc.releaseClause, goalBonus: 0 };
  p.morale = Math.max(p.morale, 75);
  if (dest.id === career.club_id) { career.manager.totals.signings++; return `${p.firstName} ${p.lastName} kommt von ${from?.name ?? "vereinslos"}`; }
  if (from?.id === career.club_id) return `${p.firstName} ${p.lastName} wechselt zu ${dest.name}`;
  return false;
}

/**
 * KI-Vereine werben auslaufende Spieler deines Kaders ab. Am 1. Januar warnt
 * dich die Sportdirektion; danach unterschreiben gute Spieler ohne neuen
 * Vertrag mit einer gewissen Wahrscheinlichkeit pro Woche woanders.
 */
export async function aiPrecontracts(db: Db, career: CareerRow, w: WorldState): Promise<string[]> {
  const userId = career.club_id;
  if (!userId || !precontractOpen(career)) return [];
  const user = w.clubs.get(userId);
  if (!user) return [];
  const squad = squadOf(w, userId);
  const expiring = squad.filter((p) => p.contract?.untilSeason === career.season && !p.loan && !p.precontract);
  const warned = await one(db, "select 1 from inbox where career_id = $1 and season = $2 and kind = 'precontract_open' limit 1", [career.id, career.season]);
  if (!warned && expiring.length) {
    await send(db, career, {
      category: "transfer", title: "Auslaufende Verträge: Vorverträge ab jetzt möglich", sender: clubSender(user, "Sportdirektion"),
      blocks: [
        { t: "p", text: "Seit dem 1. Januar dürfen andere Vereine mit Spielern im letzten Vertragsjahr Vorverträge abschliessen. Diese Spieler würden uns im Sommer ablösefrei verlassen:" },
        { t: "list", items: expiring.map((p) => `${p.firstName} ${p.lastName} (${p.position}, ${p.age} J., Stärke ${p.rating})`) },
        { t: "p", text: "Verlängere wichtige Spieler rechtzeitig oder verkaufe sie im Winter noch gegen Ablöse." },
      ],
      priority: 2, kind: "precontract_open",
    });
  }
  const renewing = new Set((await query<{ player_id: number }>(db, "select player_id from negotiations where career_id = $1 and kind = 'renew' and stage = any($2::text[])", [career.id, ACTIVE])).map((r) => r.player_id));
  const ranks = squadRanks(squad);
  const out: string[] = [];
  const rng = new Rng(seedFor(career.seed, "precontract", career.season, career.day));
  for (const p of expiring) {
    if (renewing.has(p.id)) continue;
    const rank = ranks.get(p.id) ?? 30;
    if (rank > 18 || p.age >= 34) continue;
    if (!rng.chance(Math.min(0.14, 0.03 + (19 - rank) * 0.005 + (p.transferRequest ? 0.05 : 0)))) continue;
    const suitors = [...w.clubs.values()].filter((c) => c.id !== userId && c.players_generated && c.rating >= p.rating - 8 && c.rating <= p.rating + 10 && c.reputation >= user.reputation - 12);
    if (!suitors.length) continue;
    const club = rng.pick(suitors);
    const wage = Math.max(Math.round(wageDemand(p, club.reputation) / 100) * 100, p.contract?.wage ?? 0);
    if (wageBill(squadOf(w, club.id)) + wage > club.wage_budget * 1.05) continue;
    p.precontract = { clubId: club.id, season: career.season, wage, years: p.age >= 30 ? 2 : 3, role: rank <= 7 ? "important" : "regular", releaseClause: null };
    p.morale = Math.max(20, p.morale - 6);
    w.dirtyPlayers.add(p.id);
    const name = `${p.firstName} ${p.lastName}`;
    out.push(`${name} unterschreibt einen Vorvertrag bei ${club.name}`);
    await send(db, career, {
      category: "transfer", title: `${name} geht im Sommer`, sender: clubSender(user, "Sportdirektion"),
      blocks: [{ t: "p", text: `${name} hat bei ${club.name} einen Vorvertrag unterschrieben und verlässt uns nach der Saison ablösefrei. Bis dahin steht er uns weiter zur Verfügung – seine Motivation könnte aber leiden.` }],
      priority: 2, kind: "precontract_lost", action: { type: "player", playerId: p.id },
    });
    await addArticle(db, career, {
      kind: "transfer", title: `${name} wechselt im Sommer zu ${club.name}`,
      body: `${name} hat seinen auslaufenden Vertrag bei ${user.name} nicht verlängert und einen Vorvertrag bei ${club.name} unterschrieben.`,
      clubId: user.id, playerId: p.id, own: true, importance: rank <= 7 ? 3 : 2,
    });
  }
  return out;
}
