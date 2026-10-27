/**
 * Konkurrenz um Spieler: Während du mit dem Berater verhandelst, kann ein
 * anderer Verein ebenfalls ein Angebot machen. Der Spieler fordert dann mehr
 * und gibt dir wenige Tage Zeit – sonst unterschreibt er beim Konkurrenten.
 */
import { Rng, formatMoney, seedFor, wageBill, wageDemand } from "@fl/sim";
import { query, type Db } from "../db";
import { addArticle } from "../media";
import { clubSender, send } from "../news";
import { getClub, getClubs, getPlayer, getPlayers, saveClubs, savePlayers, type CareerRow } from "../repo";
import { log, saveNeg, type NegRow } from "./core";

/** Tage, die der Berater dir nach einem Konkurrenzangebot gibt. */
export const RIVAL_DAYS = 3;
/** Tägliche Wahrscheinlichkeit für ein Konkurrenzangebot (gefragte Spieler). */
const RIVAL_CHANCE = 0.07;

/** Täglich für deine Einkäufe und Vorverträge in der Vertragsphase. */
export async function rivalDaily(db: Db, career: CareerRow, n: NegRow): Promise<void> {
  if ((n.kind !== "buy" && n.kind !== "pre") || n.stage !== "contract" || !n.demand) return;
  if (n.rival) {
    const expired = n.rival.season !== career.season || career.day > n.rival.until;
    if (expired) await loseToRival(db, career, n);
    return;
  }
  const p = await getPlayer(db, career.id, n.player_id);
  const buyer = await getClub(db, career.id, n.to_club);
  if (!p || !buyer || p.rating < 58 || career.day <= n.day) return;
  const rng = new Rng(seedFor(career.seed, "rival", n.id, career.day));
  if (!rng.chance(RIVAL_CHANCE * (p.rating >= buyer.rating ? 1.5 : 1))) return;
  const fee = n.offer?.fee ?? 0;
  const suitors = (await getClubs(db, career.id, "players_generated and id <> $2 and id <> $3 and reputation >= $4 and rating between $5 and $6 and transfer_budget >= $7",
    [buyer.id, n.from_club ?? -1, buyer.reputation - 12, p.rating - 6, p.rating + 10, fee])).filter((c) => c.country_code === buyer.country_code || c.reputation >= 70);
  // Nur Vereine, die sich das Gehalt leisten können
  let rival: (typeof suitors)[number] | null = null;
  let wage = 0;
  for (const c of rng.shuffle(suitors).slice(0, 8)) {
    const w = Math.max(Math.round((wageDemand(p, c.reputation) * 1.05) / 100) * 100, Math.round((n.demand.wage * 1.05) / 100) * 100);
    if (wageBill(await getPlayers(db, career.id, [c.id])) + w <= c.wage_budget * 1.15) { rival = c; wage = w; break; }
  }
  if (!rival) return;
  n.rival = { clubId: rival.id, name: rival.name, until: career.day + RIVAL_DAYS, season: career.season, fee, wage };
  // Mit Konkurrenz im Rücken wird der Berater teurer
  n.demand = { ...n.demand, wage: Math.max(n.demand.wage, Math.round((wage * 1.03) / 100) * 100) };
  n.message = `${rival.name} bietet ebenfalls ${formatMoney(wage)} pro Woche. Mein Klient entscheidet sich in ${RIVAL_DAYS} Tagen – wir brauchen jetzt mindestens ${formatMoney(n.demand.wage)}.`;
  log(n, career, "berater", n.message);
  await saveNeg(db, n);
  await send(db, career, {
    category: "transfer", title: `Konkurrenz um ${n.player_name}`, sender: clubSender(buyer, "Sportdirektion"),
    blocks: [
      { t: "p", text: `${rival.name} ist ebenfalls an ${n.player_name} interessiert und hat ein Vertragsangebot vorgelegt.` },
      { t: "kv", rows: [["Gehalt beim Konkurrenten", `${formatMoney(wage)} / Woche`], ["Neue Forderung", `${formatMoney(n.demand.wage)} / Woche`], ["Entscheidung", `in ${RIVAL_DAYS} Tagen`]] },
      { t: "p", text: "Bessere dein Angebot in der Transfer-Zentrale nach, sonst unterschreibt er dort." },
    ],
    priority: 3, kind: "rival_offer", action: { type: "player", playerId: n.player_id },
  });
}

/** Frist verstrichen: Der Spieler unterschreibt beim Konkurrenten. */
async function loseToRival(db: Db, career: CareerRow, n: NegRow) {
  const r = n.rival!;
  const p = await getPlayer(db, career.id, n.player_id);
  const rival = await getClub(db, career.id, r.clubId);
  n.stage = "failed";
  n.status = "rejected";
  n.message = `${n.player_name} hat sich für ${r.name} entschieden.`;
  log(n, career, "berater", n.message);
  await saveNeg(db, n);
  if (p && rival && !p.loan) {
    const seller = p.clubId !== null ? await getClub(db, career.id, p.clubId) : null;
    if (n.kind === "pre") {
      p.precontract = { clubId: rival.id, season: career.season, wage: r.wage, years: 3, role: "important", releaseClause: null };
    } else if (rival.transfer_budget >= r.fee) {
      rival.balance -= r.fee;
      rival.transfer_budget -= r.fee;
      if (seller) {
        seller.balance += r.fee;
        if (seller.tactic) seller.tactic = { ...seller.tactic, lineup: seller.tactic.lineup.map((x) => (x === p.id ? null : x)), bench: seller.tactic.bench.filter((x) => x !== p.id) };
      }
      p.clubId = rival.id;
      p.joined = { season: career.season };
      p.listed = false;
      p.transferRequest = false;
      p.squadStatus = null;
      p.contract = { wage: r.wage, untilSeason: career.season + 2, releaseClause: null, goalBonus: 0 };
      await saveClubs(db, career.id, seller ? [rival, seller] : [rival]);
      await query(db,
        `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, season, week)
         values ($1,$2,$3,$4,$5,$6,$7,3,'ai','completed',$8,$9)`,
        [career.id, p.id, n.player_name, seller?.id ?? null, rival.id, r.fee, r.wage, career.season, career.week]);
    }
    await savePlayers(db, career.id, [p]);
  }
  const buyer = (await getClub(db, career.id, n.to_club))!;
  await send(db, career, {
    category: "transfer", title: `${n.player_name} geht zu ${r.name}`, sender: clubSender(buyer, "Sportdirektion"),
    blocks: [{ t: "p", text: `Wir haben zu lange gezögert: ${n.player_name} unterschreibt bei ${r.name}${n.kind === "pre" ? " einen Vorvertrag" : ""}.` }],
    priority: 2, kind: "rival_lost", action: { type: "player", playerId: n.player_id },
  });
  await addArticle(db, career, {
    kind: "transfer", title: `${r.name} schnappt sich ${n.player_name}`,
    body: `Im Werben um ${n.player_name} hat ${r.name} das Rennen gemacht – auch ${buyer.name} war interessiert.`,
    clubId: r.clubId, playerId: n.player_id, own: false, importance: 2,
  });
}
