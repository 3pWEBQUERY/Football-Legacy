/** Transferverhandlungen: Ansichten für Verhandlung, Spielerprofil und Transfer-Zentrale. */
import { SQUAD_STATUS_LABEL, askingPrice, wageBill, type Player } from "@fl/sim";
import { readCareer } from "../career";
import { one, pool, query, type Db } from "../db";
import { GameError } from "../errors";
import { getClub, getPlayer, getPlayers, type CareerRow } from "../repo";
import { windowFor } from "../window";
import { ACTIVE, getNeg, sellerCtx, type NegRow } from "./core";
import { BUDGET_RATIO } from "./timeline";

// ------------------------------------------------------------ Ansichten

export async function negotiationView(careerId: string, accountId: string, id: number) {
  const career = await readCareer(careerId, accountId);
  const n = await getNeg(pool(), career, id);
  return negPayload(pool(), career, n, true);
}

/** Budgetrahmen des eigenen Vereins für die Verhandlungsmaske. */
async function budgetOf(db: Db, career: CareerRow) {
  if (!career.club_id) return null;
  const club = (await getClub(db, career.id, career.club_id))!;
  const squad = await getPlayers(db, career.id, [club.id]);
  return { transfer: club.transfer_budget, wage: club.wage_budget, wageBill: wageBill(squad), balance: club.balance };
}

async function negPayload(db: Db, career: CareerRow, n: NegRow, full = false) {
  const p = await getPlayer(db, career.id, n.player_id);
  const seller = n.from_club ? await getClub(db, career.id, n.from_club) : null;
  const buyer = n.kind === "sell" ? await getClub(db, career.id, n.to_club) : null;
  const waiting = (n.stage === "club" && n.status === "pending") || (n.kind === "sell" && ["pending", "player", "offered"].includes(n.status));
  const base = {
    id: n.id, kind: n.kind, playerId: n.player_id, player: n.player_name, position: p?.position, age: p?.age, stage: n.stage, status: n.status,
    from: seller ? { id: seller.id, name: seller.name, colors: seller.colors } : null,
    to: buyer ? { id: buyer.id, name: buyer.name, colors: buyer.colors, reputation: buyer.reputation } : null,
    offer: n.offer, counter: n.counter, demand: n.demand, terms: n.terms,
    patience: n.patience, message: n.message, day: n.day, season: n.season,
    waitingDays: waiting ? Math.max(0, (n.respond_day ?? career.day) - career.day) : 0,
    clause: n.kind === "sell" && n.log.some((l) => l.text.startsWith("Ausstiegsklausel")),
  };
  if (!full) return base;
  return {
    ...base, log: n.log, roles: SQUAD_STATUS_LABEL, value: p?.value ?? 0, currentWage: p?.contract?.wage ?? 0, budget: await budgetOf(db, career),
    attempts: n.offer?.attempts ?? 1, releaseClause: p?.contract?.releaseClause ?? null, contractUntil: p?.contract?.untilSeason ?? null,
  };
}

export async function playerNegotiation(db: Db, career: CareerRow, playerId: number) {
  const n = await one<NegRow>(db, "select * from negotiations where career_id = $1 and player_id = $2 order by id desc limit 1", [career.id, playerId]);
  return n ? negPayload(db, career, n, true) : null;
}

/** Richtwert für das erste Angebot (ohne dass der Spieler gescoutet sein muss). */
export async function offerHint(db: Db, career: CareerRow, p: Player) {
  if (p.clubId === null) return { askingPrice: 0, free: true };
  const { ctx } = await sellerCtx(db, career, p);
  return { askingPrice: askingPrice(p, ctx), free: false };
}

export async function transferHub(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Kein Verein");
  const db = pool();
  const club = (await getClub(db, career.id, career.club_id))!;
  const squad = await getPlayers(db, career.id, [club.id]);
  const w = windowFor(career);
  const all = await query<NegRow>(db, "select * from negotiations where career_id = $1 and (stage = any($2::text[]) or (season = $3 and day > $4)) order by id desc limit 40", [career.id, ACTIVE, career.season, career.day - 30]);
  const negs = all.filter((n) => n.kind !== "sell");
  const sales = all.filter((n) => n.kind === "sell");
  const incoming = await query<{ id: number; player_id: number; player_name: string; to_club: number; fee: number; status: string; club_name: string; colors: unknown }>(db,
    `select t.id, t.player_id, t.player_name, t.to_club, t.fee, t.status, c.name as club_name, c.colors from transfers t join clubs c on c.id = t.to_club
      where t.career_id = $1 and t.kind = 'offer_in' and t.status = 'pending' order by t.id desc`, [career.id]);
  const shortlist = await query<{ data: Player; club_name: string | null; colors: unknown }>(db,
    `select p.data, c.name as club_name, c.colors from shortlist s join players p on p.career_id = s.career_id and p.id = s.player_id
       left join clubs c on c.id = p.club_id where s.career_id = $1 order by p.rating desc limit 12`, [career.id]);
  const world = await query<{ player_name: string; fee: number; from_name: string | null; to_name: string; to_colors: unknown; week: number }>(db,
    `select t.player_name, t.fee, f.name as from_name, c.name as to_name, c.colors as to_colors, t.week from transfers t
       join clubs c on c.id = t.to_club left join clubs f on f.id = t.from_club
      where t.career_id = $1 and t.season = $2 and t.status = 'completed' order by t.fee desc limit 12`, [career.id, career.season]);
  const due = await query<{ amount: number; due_season: number; label: string }>(db, "select amount, due_season, label from transfer_payments where career_id = $1 and from_club = $2 and not paid order by due_season", [career.id, club.id]);
  const bill = wageBill(squad);
  return {
    window: { ...w, daysLeft: w.open && w.closes ? Math.max(0, w.closes - career.day) : null, daysToOpen: !w.open && w.opens ? Math.max(0, w.opens - career.day) : null },
    budget: { transfer: club.transfer_budget, wage: club.wage_budget, wageBill: bill, balance: club.balance, ratio: BUDGET_RATIO, minWage: Math.round(bill * 0.9), maxWage: club.wage_budget + Math.floor(club.transfer_budget / BUDGET_RATIO) },
    negotiations: await Promise.all(negs.map((n) => negPayload(db, career, n))),
    sales: await Promise.all(sales.map((n) => negPayload(db, career, n))),
    deadline: w.open && w.closes !== null && w.closes <= career.day,
    incoming: incoming.map((o) => ({ id: o.id, playerId: o.player_id, player: o.player_name, club: o.club_name, colors: o.colors, fee: o.fee })),
    shortlist: shortlist.map((r) => ({ id: r.data.id, name: `${r.data.firstName} ${r.data.lastName}`, position: r.data.position, age: r.data.age, value: r.data.value, club: r.club_name, colors: r.colors, contractUntil: r.data.contract?.untilSeason ?? null })),
    world: world.map((t) => ({ ...t })),
    installments: due,
    squad: { size: squad.length, listed: squad.filter((p) => p.listed).length, expiring: squad.filter((p) => p.contract && p.contract.untilSeason <= career.season).length },
  };
}
