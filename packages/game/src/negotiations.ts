/**
 * Transferverhandlungen im Stil des FM: erst mit dem Verein (Ablöse, Raten,
 * Weiterverkaufsbeteiligung; Antwort nach ein bis zwei Tagen), dann mit dem
 * Berater (Gehalt, Laufzeit, Handgeld, Ausstiegsklausel, Kaderrolle, Beraterhonorar).
 * Dazu Ratenzahlungen, Budget-Umschichtung und die Transfer-Zentrale.
 */
import {
  type Player, Rng, SQUAD_STATUS_LABEL, type SquadStatus, askingPrice, evaluateFee, formatMoney, roundMoney, seedFor, squadRanks, wageBill, wageDemand,
} from "@fl/sim";
import { type Db, one, pool, query } from "./db";
import { GameError } from "./errors";
import { readCareer, withCareer } from "./career";
import { type CareerRow, type ClubRow, addFinance, getClub, getPlayer, getPlayers, saveCareer, saveClubs, savePlayers } from "./repo";
import { windowFor } from "./window";
import { addArticle } from "./media";
import { clubSender, send } from "./news";
import { type RewardNote, announceNotes, awardCard, completeMission, unlockAchievement } from "./rewards";

export interface ClubOffer { fee: number; upfrontPct: number; installmentYears: number; sellOn: number }
export interface ContractTerms { wage: number; years: number; signingBonus: number; releaseClause: number | null; role: SquadStatus; agentFee: number }
interface LogEntry { day: number; season: number; who: "du" | "verein" | "berater"; text: string }
interface NegRow {
  id: number; career_id: string; player_id: number; player_name: string; from_club: number | null; to_club: number;
  stage: "club" | "contract" | "done" | "failed" | "withdrawn" | "expired"; status: string;
  offer: (ClubOffer & { attempts?: number }) | null; counter: ClubOffer | null; demand: ContractTerms | null; terms: ContractTerms | null;
  patience: number; respond_season: number | null; respond_day: number | null; season: number; day: number; message: string | null; log: LogEntry[];
}

const ROLE_ORDER: SquadStatus[] = ["star", "important", "regular", "rotation", "backup", "prospect"];
const roleIdx = (r: SquadStatus) => Math.min(4, ROLE_ORDER.indexOf(r));
const ACTIVE = ["club", "contract"];

function requireClub(career: CareerRow) {
  if (!career.club_id || career.status !== "active") throw new GameError("Du hast aktuell keinen Verein.");
  return career.club_id;
}

async function getNeg(db: Db, career: CareerRow, id: number): Promise<NegRow> {
  const n = await one<NegRow>(db, "select * from negotiations where career_id = $1 and id = $2", [career.id, id]);
  if (!n) throw new GameError("Verhandlung nicht gefunden", 404);
  return n;
}

async function saveNeg(db: Db, n: NegRow) {
  await query(db,
    `update negotiations set stage = $2, status = $3, offer = $4, counter = $5, demand = $6, terms = $7, patience = $8,
       respond_season = $9, respond_day = $10, message = $11, log = $12, updated_at = now() where id = $1`,
    [n.id, n.stage, n.status, n.offer ? JSON.stringify(n.offer) : null, n.counter ? JSON.stringify(n.counter) : null,
      n.demand ? JSON.stringify(n.demand) : null, n.terms ? JSON.stringify(n.terms) : null, n.patience,
      n.respond_season, n.respond_day, n.message, JSON.stringify(n.log.slice(-30))]);
}

const log = (n: NegRow, career: CareerRow, who: LogEntry["who"], text: string) => n.log.push({ day: career.day, season: career.season, who, text });

// ------------------------------------------------------------ Bewertung

async function sellerCtx(db: Db, career: CareerRow, p: Player) {
  const squad = p.clubId !== null ? await getPlayers(db, career.id, [p.clubId]) : [];
  const club = p.clubId !== null ? await getClub(db, career.id, p.clubId) : null;
  return { ctx: { season: career.season, squadRank: squadRanks(squad).get(p.id) ?? 30, squadSize: squad.length, sellerReputation: club?.reputation ?? 30, isUserClub: false }, club };
}

/** Was ist das Angebot dem abgebenden Verein wert? Raten zählen etwas weniger, Weiterverkauf zählt bei jungen Spielern. */
function offerValue(p: Player, o: ClubOffer) {
  const up = o.fee * (o.upfrontPct / 100);
  const rest = o.fee - up;
  const sellOnValue = p.value * (o.sellOn / 100) * (p.age <= 23 ? 0.6 : 0.3);
  return up + rest * 0.85 + sellOnValue;
}

function nominalFor(p: Player, value: number, o: ClubOffer) {
  const sellOnValue = p.value * (o.sellOn / 100) * (p.age <= 23 ? 0.6 : 0.3);
  const share = o.upfrontPct / 100 + (1 - o.upfrontPct / 100) * 0.85;
  return roundMoney(Math.max(0, (value - sellOnValue) / share));
}

function expectedRole(p: Player, squad: Player[]): SquadStatus {
  const ranks = squadRanks([...squad.filter((x) => x.id !== p.id), p]);
  const r = ranks.get(p.id) ?? 30;
  if (r <= 3) return "star";
  if (r <= 7) return "important";
  if (r <= 11) return "regular";
  if (r <= 16) return "rotation";
  return p.age <= 21 ? "prospect" : "backup";
}

function initialDemand(p: Player, buyer: ClubRow, seller: ClubRow | null, squad: Player[], fee: number): ContractTerms | { refuse: string } {
  const curRep = seller?.reputation ?? Math.max(1, buyer.reputation - 20);
  if (buyer.reputation < curRep - 30 && p.rating > 60) return { refuse: `${p.firstName} ${p.lastName} sieht bei ${buyer.name} keine sportliche Perspektive und lehnt Gespräche ab.` };
  const repF = buyer.reputation < curRep - 10 ? 1.25 : buyer.reputation > curRep + 10 ? 0.92 : 1;
  const wage = Math.max(Math.round((wageDemand(p, buyer.reputation) * repF) / 100) * 100, Math.round(((p.contract?.wage ?? 0) * 1.05) / 100) * 100, 500);
  const years = p.age >= 31 ? 2 : p.age <= 23 ? 4 : 3;
  const wantsClause = p.age <= 25 && p.potential >= p.rating + 4;
  return {
    wage, years, role: expectedRole(p, squad),
    signingBonus: Math.round((wage * 8) / 1000) * 1000,
    releaseClause: wantsClause ? roundMoney(p.value * 2.5) : null,
    agentFee: roundMoney(Math.max(wage * 4, fee * 0.05, 5_000)),
  };
}

/** Prüft ein Vertragsangebot gegen die Forderung des Beraters. */
function judgeTerms(d: ContractTerms, t: ContractTerms): { ok: boolean; need: number; reason: string | null; hardRole: boolean } {
  let need = d.wage;
  const reasons: string[] = [];
  const roleGap = roleIdx(t.role) - roleIdx(d.role);
  if (roleGap >= 2) return { ok: false, need: Math.round(need * 1.2), reason: `Mein Klient erwartet mindestens die Rolle „${SQUAD_STATUS_LABEL[d.role]}“.`, hardRole: true };
  need *= 1 + roleGap * 0.07;
  if (roleGap > 0) reasons.push("die Rolle ist geringer als erwartet");
  need *= 1 + Math.abs(t.years - d.years) * 0.03;
  if (d.releaseClause && (!t.releaseClause || t.releaseClause > d.releaseClause * 1.2)) { need *= 1.08; reasons.push("er möchte eine Ausstiegsklausel"); }
  if (t.agentFee < d.agentFee * 0.8) { need *= 1.06; reasons.push("das Beraterhonorar ist zu niedrig"); }
  // Nur Handgeld über bzw. unter der Forderung verschiebt das nötige Gehalt
  const bonusShift = ((t.signingBonus - d.signingBonus) / (t.years * 52)) * 1.2;
  if (bonusShift < 0) reasons.push("das Handgeld ist zu niedrig");
  const effective = t.wage + bonusShift;
  return { ok: effective >= need * 0.98, need: Math.round((need - bonusShift) / 100) * 100, reason: reasons.length ? reasons.join(", ") : null, hardRole: false };
}

// ------------------------------------------------------------ Aktionen

export async function startNegotiation(careerId: string, accountId: string, input: { playerId: number; offer: ClubOffer }) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    const p = await getPlayer(db, career.id, input.playerId);
    if (!p) throw new GameError("Spieler nicht gefunden", 404);
    if (p.clubId === clubId) throw new GameError("Der Spieler gehört bereits zu deinem Verein.");
    if (p.loan) throw new GameError("Der Spieler ist ausgeliehen und erst nach der Saison verfügbar.");
    const open = await one<{ id: number }>(db, "select id from negotiations where career_id = $1 and player_id = $2 and stage = any($3::text[])", [career.id, p.id, ACTIVE]);
    if (open) throw new GameError("Mit diesem Spieler läuft bereits eine Verhandlung.");
    if (p.clubId !== null && !windowFor(career).open) throw new GameError("Das Transferfenster ist geschlossen. Vereinslose Spieler kannst du jederzeit verpflichten.");
    const buyer = (await getClub(db, career.id, clubId))!;
    const squad = await getPlayers(db, career.id, [clubId]);
    if (squad.length >= 32) throw new GameError("Dein Kader ist voll (max. 32 Spieler).");
    const o = cleanOffer(input.offer, p.clubId === null);
    if (o.fee * (o.upfrontPct / 100) > buyer.transfer_budget) throw new GameError(`Die Sofortzahlung übersteigt dein Transferbudget (${formatMoney(buyer.transfer_budget)}).`);
    const seller = p.clubId !== null ? await getClub(db, career.id, p.clubId) : null;
    const neg: NegRow = {
      id: 0, career_id: career.id, player_id: p.id, player_name: `${p.firstName} ${p.lastName}`, from_club: p.clubId, to_club: clubId,
      stage: seller ? "club" : "contract", status: seller ? "pending" : "open", offer: { ...o, attempts: 1 }, counter: null, demand: null, terms: null,
      patience: 3, respond_season: career.season, respond_day: career.day + (seller ? new Rng(seedFor(career.seed, "neg", p.id, career.day)).int(1, 2) : 0),
      season: career.season, day: career.day, message: null, log: [],
    };
    if (seller) {
      log(neg, career, "du", `Angebot an ${seller.name}: ${describeOffer(o)}`);
      neg.message = `${seller.name} prüft dein Angebot und meldet sich in Kürze.`;
    } else {
      const d = initialDemand(p, buyer, null, squad, 0);
      if ("refuse" in d) throw new GameError(d.refuse);
      neg.demand = d;
      log(neg, career, "berater", `Forderung: ${describeTerms(d)}`);
      neg.message = "Der Berater des vereinslosen Spielers ist gesprächsbereit.";
    }
    const r = await one<{ id: number }>(db,
      `insert into negotiations(career_id, player_id, player_name, from_club, to_club, stage, status, offer, demand, patience, respond_season, respond_day, season, day, message, log)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
      [career.id, p.id, neg.player_name, neg.from_club, clubId, neg.stage, neg.status, JSON.stringify(neg.offer), neg.demand ? JSON.stringify(neg.demand) : null,
        neg.patience, neg.respond_season, neg.respond_day, career.season, career.day, neg.message, JSON.stringify(neg.log)]);
    return { id: r!.id, message: neg.message };
  });
}

function cleanOffer(o: Partial<ClubOffer>, free: boolean): ClubOffer {
  if (free) return { fee: 0, upfrontPct: 100, installmentYears: 0, sellOn: 0 };
  const upfrontPct = [25, 50, 75, 100].includes(Number(o.upfrontPct)) ? Number(o.upfrontPct) : 100;
  return {
    fee: Math.max(0, Math.round(Number(o.fee) || 0)),
    upfrontPct,
    installmentYears: upfrontPct === 100 ? 0 : Math.max(1, Math.min(3, Math.round(Number(o.installmentYears) || 1))),
    sellOn: Math.max(0, Math.min(30, Math.round(Number(o.sellOn) || 0))),
  };
}

function describeOffer(o: ClubOffer) {
  const parts = [formatMoney(o.fee)];
  if (o.upfrontPct < 100) parts.push(`${o.upfrontPct} % sofort, Rest in ${o.installmentYears} Jahresrate${o.installmentYears > 1 ? "n" : ""}`);
  if (o.sellOn) parts.push(`${o.sellOn} % Weiterverkaufsbeteiligung`);
  return parts.join(" · ");
}

function describeTerms(t: ContractTerms) {
  return `${formatMoney(t.wage)}/Woche, ${t.years} Jahre, Handgeld ${formatMoney(t.signingBonus)}, Rolle ${SQUAD_STATUS_LABEL[t.role]}${t.releaseClause ? `, Ausstiegsklausel ${formatMoney(t.releaseClause)}` : ""}, Berater ${formatMoney(t.agentFee)}`;
}

/** Neues Angebot an den Verein (nach Ablehnung oder Gegenangebot). */
export async function reviseClubOffer(careerId: string, accountId: string, id: number, input: ClubOffer) {
  return withCareer(careerId, accountId, async (db, career) => {
    const n = await getNeg(db, career, id);
    if (n.stage !== "club" || n.status === "pending") throw new GameError("Der Verein prüft gerade noch dein letztes Angebot.");
    if ((n.offer?.attempts ?? 1) >= 4) throw new GameError("Der Verein hat die Gespräche abgebrochen.");
    const o = cleanOffer(input, false);
    const buyer = (await getClub(db, career.id, n.to_club))!;
    if (o.fee * (o.upfrontPct / 100) > buyer.transfer_budget) throw new GameError(`Die Sofortzahlung übersteigt dein Transferbudget (${formatMoney(buyer.transfer_budget)}).`);
    n.offer = { ...o, attempts: (n.offer?.attempts ?? 1) + 1 };
    n.status = "pending";
    n.counter = null;
    n.respond_season = career.season;
    n.respond_day = career.day + 1;
    log(n, career, "du", `Neues Angebot: ${describeOffer(o)}`);
    n.message = "Der Verein prüft dein neues Angebot.";
    await saveNeg(db, n);
    return { message: n.message };
  });
}

/** Gegenangebot des Vereins annehmen: weiter zu den Vertragsgesprächen. */
export async function acceptClubCounter(careerId: string, accountId: string, id: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const n = await getNeg(db, career, id);
    if (n.stage !== "club" || n.status !== "countered" || !n.counter) throw new GameError("Kein Gegenangebot vorhanden.");
    const buyer = (await getClub(db, career.id, n.to_club))!;
    if (n.counter.fee * (n.counter.upfrontPct / 100) > buyer.transfer_budget) throw new GameError(`Die Sofortzahlung übersteigt dein Transferbudget (${formatMoney(buyer.transfer_budget)}).`);
    n.offer = { ...n.counter, attempts: n.offer?.attempts ?? 1 };
    await toContractStage(db, career, n, buyer);
    log(n, career, "du", "Gegenangebot des Vereins angenommen.");
    await saveNeg(db, n);
    return { message: n.message };
  });
}

async function toContractStage(db: Db, career: CareerRow, n: NegRow, buyer: ClubRow) {
  const p = (await getPlayer(db, career.id, n.player_id))!;
  const seller = n.from_club ? await getClub(db, career.id, n.from_club) : null;
  const squad = await getPlayers(db, career.id, [buyer.id]);
  const d = initialDemand(p, buyer, seller, squad, n.offer?.fee ?? 0);
  if ("refuse" in d) {
    n.stage = "failed";
    n.status = "rejected";
    n.message = d.refuse;
    log(n, career, "berater", d.refuse);
    return;
  }
  n.stage = "contract";
  n.status = "open";
  n.demand = d;
  n.patience = 3;
  n.message = "Einigung mit dem Verein. Jetzt geht es um den Vertrag des Spielers.";
  log(n, career, "berater", `Forderung: ${describeTerms(d)}`);
}

/** Vertragsangebot an den Berater. Bei Einigung ist der Transfer perfekt. */
export async function offerContract(careerId: string, accountId: string, id: number, input: Partial<ContractTerms>) {
  return withCareer(careerId, accountId, async (db, career) => {
    const n = await getNeg(db, career, id);
    if (n.stage !== "contract" || !n.demand) throw new GameError("Die Vertragsgespräche haben noch nicht begonnen.");
    const t: ContractTerms = {
      wage: Math.max(0, Math.round(Number(input.wage) || 0)),
      years: Math.max(1, Math.min(5, Math.round(Number(input.years) || n.demand.years))),
      signingBonus: Math.max(0, Math.round(Number(input.signingBonus) || 0)),
      releaseClause: input.releaseClause ? Math.max(0, Math.round(Number(input.releaseClause))) : null,
      role: ROLE_ORDER.includes(input.role as SquadStatus) ? (input.role as SquadStatus) : n.demand.role,
      agentFee: Math.max(0, Math.round(Number(input.agentFee) || 0)),
    };
    const buyer = (await getClub(db, career.id, n.to_club))!;
    const squad = await getPlayers(db, career.id, [buyer.id]);
    const bill = wageBill(squad);
    if (bill + t.wage > buyer.wage_budget) {
      throw new GameError(`Das Gehalt sprengt dein Gehaltsbudget (${formatMoney(bill)} + ${formatMoney(t.wage)} > ${formatMoney(buyer.wage_budget)} pro Woche). Schichte in der Transfer-Zentrale Budget um.`);
    }
    const upfront = (n.offer?.fee ?? 0) * ((n.offer?.upfrontPct ?? 100) / 100);
    if (upfront + t.signingBonus + t.agentFee > buyer.transfer_budget) throw new GameError(`Ablöse, Handgeld und Beraterhonorar übersteigen dein Transferbudget (${formatMoney(buyer.transfer_budget)}).`);
    if (n.from_club && !windowFor(career).open) throw new GameError("Das Transferfenster ist geschlossen.");
    log(n, career, "du", `Vertragsangebot: ${describeTerms(t)}`);
    n.terms = t;
    const verdict = judgeTerms(n.demand, t);
    if (verdict.ok) {
      const res = await completeTransfer(db, career, n, t);
      log(n, career, "berater", "Einverstanden – wir haben einen Deal.");
      await saveNeg(db, n);
      return res;
    }
    n.patience -= verdict.hardRole || t.wage < verdict.need * 0.8 ? 2 : 1;
    if (n.patience <= 0) {
      n.stage = "failed";
      n.status = "rejected";
      n.message = "Der Berater bricht die Gespräche ab – keine Einigung.";
      log(n, career, "berater", n.message);
      await saveNeg(db, n);
      return { status: "failed", message: n.message };
    }
    n.status = "countered";
    n.demand = { ...n.demand, wage: Math.max(n.demand.wage, verdict.need) };
    n.message = verdict.hardRole ? verdict.reason! : `Das reicht nicht${verdict.reason ? ` (${verdict.reason})` : ""}. Wir brauchen mindestens ${formatMoney(n.demand.wage)} pro Woche.`;
    log(n, career, "berater", n.message);
    await saveNeg(db, n);
    return { status: "countered", message: n.message, patience: n.patience };
  });
}

export async function withdrawNegotiation(careerId: string, accountId: string, id: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const n = await getNeg(db, career, id);
    if (!ACTIVE.includes(n.stage)) throw new GameError("Diese Verhandlung ist bereits beendet.");
    n.stage = "withdrawn";
    n.status = "withdrawn";
    n.message = "Verhandlung abgebrochen.";
    log(n, career, "du", "Verhandlungen beendet.");
    await saveNeg(db, n);
    return { message: n.message };
  });
}

async function completeTransfer(db: Db, career: CareerRow, n: NegRow, t: ContractTerms) {
  const p = (await getPlayer(db, career.id, n.player_id))!;
  const buyer = (await getClub(db, career.id, n.to_club))!;
  const seller = n.from_club ? await getClub(db, career.id, n.from_club) : null;
  const o = n.offer ?? { fee: 0, upfrontPct: 100, installmentYears: 0, sellOn: 0 };
  const upfront = roundMoney(o.fee * (o.upfrontPct / 100));
  const rest = o.fee - upfront;
  buyer.balance -= upfront + t.signingBonus + t.agentFee;
  // Raten belasten Kontostand und Budget erst, wenn sie fällig werden
  buyer.transfer_budget = Math.max(0, buyer.transfer_budget - upfront - t.signingBonus - t.agentFee);
  if (seller) {
    seller.balance += upfront;
    seller.transfer_budget += Math.round(upfront * 0.6);
    if (seller.tactic) {
      seller.tactic.lineup = seller.tactic.lineup.map((x) => (x === p.id ? null : x));
      seller.tactic.bench = seller.tactic.bench.filter((x) => x !== p.id);
    }
  }
  await saveClubs(db, career.id, seller ? [buyer, seller] : [buyer]);
  // Raten in den kommenden Saisons
  if (rest > 0 && seller) {
    const per = Math.round(rest / o.installmentYears);
    for (let i = 1; i <= o.installmentYears; i++) {
      await query(db, "insert into transfer_payments(career_id, from_club, to_club, amount, due_season, label) values ($1,$2,$3,$4,$5,$6)",
        [career.id, buyer.id, seller.id, i === o.installmentYears ? rest - per * (o.installmentYears - 1) : per, career.season + i, `Rate ${i}/${o.installmentYears}: ${p.firstName} ${p.lastName}`]);
    }
  }
  // eine bestehende Weiterverkaufsbeteiligung eines früheren Vereins wird beim Verkauf fällig (nicht hier)
  p.clubId = buyer.id;
  p.listed = false;
  p.joined = { season: career.season };
  p.squadStatus = t.role;
  p.transferRequest = false;
  p.sellOn = seller && o.sellOn > 0 ? { clubId: seller.id, pct: o.sellOn } : null;
  p.contract = { wage: t.wage, untilSeason: career.season + t.years - 1, releaseClause: t.releaseClause, goalBonus: 0 };
  p.morale = 82;
  await savePlayers(db, career.id, [p]);
  const fin = [
    ...(upfront ? [{ kind: "transfer_out", amount: -upfront, label: `Ablöse ${p.firstName} ${p.lastName}${rest ? " (Sofortzahlung)" : ""}` }] : []),
    ...(t.signingBonus ? [{ kind: "transfer_out", amount: -t.signingBonus, label: `Handgeld ${p.firstName} ${p.lastName}` }] : []),
    ...(t.agentFee ? [{ kind: "transfer_out", amount: -t.agentFee, label: `Beraterhonorar ${p.firstName} ${p.lastName}` }] : []),
  ];
  if (fin.length) await addFinance(db, career.id, buyer.id, career.season, career.week, fin);
  await query(db,
    `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, message, season, week)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'buy','completed','Transfer abgeschlossen',$9,$10)`,
    [career.id, p.id, n.player_name, seller?.id ?? null, buyer.id, o.fee, t.wage, t.years, career.season, career.week]);
  n.stage = "done";
  n.status = "agreed";
  n.message = `${n.player_name} unterschreibt bei ${buyer.name}!`;
  const notes: RewardNote[] = [];
  career.manager.totals.signings++;
  unlockAchievement(career, "first_signing", notes);
  if (o.fee >= 10_000_000) unlockAchievement(career, "big_signing", notes);
  completeMission(career, "sign_player", notes);
  awardCard(career, p, "Verpflichtung", notes);
  await saveCareer(db, career);
  await announceNotes(db, career, notes);
  await send(db, career, {
    category: "transfer", title: `${n.player_name} unterschreibt!`, sender: clubSender(buyer, "Sportdirektion"),
    blocks: [
      { t: "p", text: `${n.player_name} wechselt ${seller ? `von ${seller.name} ` : ""}zu ${buyer.name}. Willkommen!` },
      { t: "kv", rows: [["Ablöse", o.fee ? describeOffer(o) : "ablösefrei"], ["Gehalt", `${formatMoney(t.wage)} / Woche`], ["Vertrag bis", `Sommer ${career.season + t.years}`], ["Rolle", SQUAD_STATUS_LABEL[t.role]], ["Handgeld", formatMoney(t.signingBonus)], ["Beraterhonorar", formatMoney(t.agentFee)]] },
    ],
    priority: 2, kind: "signing", action: { type: "player", playerId: p.id },
  });
  await addArticle(db, career, {
    kind: "transfer", title: `${buyer.name} verpflichtet ${n.player_name}`,
    body: `${n.player_name} wechselt ${seller ? `von ${seller.name} ` : ""}zu ${buyer.name}${o.fee ? ` – die Ablöse soll bei ${formatMoney(o.fee)} liegen` : " – ablösefrei"}.`,
    clubId: buyer.id, playerId: p.id, own: true, importance: o.fee >= 10_000_000 ? 3 : 2,
  });
  return { status: "completed", message: n.message, notes };
}

// ------------------------------------------------------------ Zeitablauf

/** Täglich: Antworten der Vereine, abgelaufene Gespräche bei geschlossenem Fenster. */
export async function negotiationsDaily(db: Db, career: CareerRow) {
  if (!career.club_id) return;
  const rows = await query<NegRow>(db, "select * from negotiations where career_id = $1 and stage = any($2::text[])", [career.id, ACTIVE]);
  if (!rows.length) return;
  const window = windowFor(career);
  for (const n of rows) {
    if (n.from_club && !window.open) {
      n.stage = "expired";
      n.status = "expired";
      n.message = "Das Transferfenster hat geschlossen – die Verhandlung ist beendet.";
      log(n, career, "verein", n.message);
      await saveNeg(db, n);
      continue;
    }
    if (n.stage !== "club" || n.status !== "pending") continue;
    if ((n.respond_season ?? 0) > career.season || ((n.respond_season ?? 0) === career.season && (n.respond_day ?? 0) > career.day)) continue;
    const p = await getPlayer(db, career.id, n.player_id);
    if (!p || p.clubId !== n.from_club) {
      n.stage = "failed"; n.status = "rejected"; n.message = "Der Spieler ist nicht mehr verfügbar."; await saveNeg(db, n); continue;
    }
    const { ctx, club: seller } = await sellerCtx(db, career, p);
    const o = n.offer!;
    const rng = new Rng(seedFor(career.seed, "neg-answer", n.id, o.attempts ?? 1));
    const verdict = evaluateFee(p, offerValue(p, o), ctx, rng);
    const buyer = (await getClub(db, career.id, n.to_club))!;
    let title: string;
    let text: string;
    if (verdict.kind === "accept") {
      await toContractStage(db, career, n, buyer);
      title = `${seller!.name} akzeptiert dein Angebot für ${n.player_name}`;
      text = (n.stage as string) === "failed" ? n.message! : "Wir sind mit den Konditionen einverstanden. Sie dürfen mit dem Spieler und seinem Berater sprechen.";
      log(n, career, "verein", "Angebot angenommen.");
    } else if (verdict.kind === "counter" && (o.attempts ?? 1) < 4) {
      const fee = nominalFor(p, verdict.fee, o);
      n.counter = { ...o, fee };
      n.status = "countered";
      n.message = `${seller!.name} fordert ${describeOffer(n.counter)}.`;
      title = `Gegenangebot von ${seller!.name}`;
      text = `${verdict.message} Für ${n.player_name} verlangen wir ${describeOffer(n.counter)}.`;
      log(n, career, "verein", `Gegenangebot: ${describeOffer(n.counter)}`);
    } else {
      n.status = "rejected";
      if ((o.attempts ?? 1) >= 4 || verdict.message.includes("unverkäuflich")) n.stage = "failed";
      n.message = verdict.kind === "reject" ? verdict.message : "Wir sehen keine Grundlage mehr für Gespräche.";
      title = `${seller!.name} lehnt ab`;
      text = `${n.message}${n.stage === "failed" ? " Die Gespräche sind beendet." : " Ein verbessertes Angebot wäre möglich."}`;
      log(n, career, "verein", n.message);
    }
    await saveNeg(db, n);
    await send(db, career, {
      category: "transfer", title, sender: clubSender(seller!, "Sportdirektor"),
      blocks: [
        { t: "p", text },
        { t: "kv", rows: [["Spieler", `${n.player_name} (${p.position}, ${p.age})`], ["Dein Angebot", describeOffer(o)], ...(n.counter && n.status === "countered" ? [["Forderung", describeOffer(n.counter)] as [string, string]] : [])] },
      ],
      priority: 2, kind: "negotiation", action: { type: "negotiation", negotiationId: n.id, playerId: p.id },
    });
  }
}

/** Saisonwechsel: fällige Raten zahlen. */
export async function paymentsSeasonStart(db: Db, career: CareerRow) {
  const due = await query<{ id: number; from_club: number; to_club: number | null; amount: number; label: string }>(db,
    "select * from transfer_payments where career_id = $1 and due_season <= $2 and not paid", [career.id, career.season]);
  if (!due.length) return;
  const clubs = new Map<number, ClubRow>();
  const club = async (id: number) => clubs.get(id) ?? clubs.set(id, (await getClub(db, career.id, id))!).get(id)!;
  const userLines: string[] = [];
  for (const d of due) {
    const from = await club(d.from_club);
    from.balance -= d.amount;
    from.transfer_budget = Math.max(0, from.transfer_budget - d.amount);
    if (d.to_club) (await club(d.to_club)).balance += d.amount;
    if (d.from_club === career.club_id) {
      await addFinance(db, career.id, from.id, career.season, 0, [{ kind: "transfer_out", amount: -d.amount, label: d.label }]);
      userLines.push(`${d.label}: ${formatMoney(d.amount)}`);
    }
    if (d.to_club && d.to_club === career.club_id) await addFinance(db, career.id, d.to_club, career.season, 0, [{ kind: "transfer_in", amount: d.amount, label: d.label }]);
  }
  await saveClubs(db, career.id, [...clubs.values()]);
  await query(db, "update transfer_payments set paid = true where id = any($1::int[])", [due.map((d) => d.id)]);
  const own = career.club_id ? clubs.get(career.club_id) ?? (await getClub(db, career.id, career.club_id)) : null;
  if (userLines.length && own) {
    await send(db, career, {
      category: "finance", title: "Fällige Transferraten bezahlt", sender: clubSender(own, "Finanzabteilung"),
      blocks: [{ t: "p", text: "Zum Saisonstart wurden diese Raten aus früheren Transfers fällig:" }, { t: "list", items: userLines }],
      priority: 1, kind: "installments",
    });
  }
}

/** Beim Verkauf eines eigenen Spielers: Weiterverkaufsbeteiligung an den früheren Verein. */
export async function paySellOn(db: Db, career: CareerRow, p: Player, fee: number, seller: ClubRow, buyer: ClubRow) {
  if (!p.sellOn || p.sellOn.pct <= 0 || fee <= 0) return 0;
  const share = Math.round((fee * p.sellOn.pct) / 100);
  const former = p.sellOn.clubId === buyer.id ? buyer : await getClub(db, career.id, p.sellOn.clubId);
  seller.balance -= share;
  if (former) {
    former.balance += share;
    if (former !== buyer) await saveClubs(db, career.id, [former]);
  }
  await addFinance(db, career.id, seller.id, career.season, career.week, [{ kind: "transfer_out", amount: -share, label: `Weiterverkaufsbeteiligung (${p.sellOn.pct} %) an ${former?.name ?? "Ex-Verein"}` }]);
  p.sellOn = null;
  return share;
}

// ------------------------------------------------------------ Budget

export async function setWageBudget(careerId: string, accountId: string, wageBudget: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    const club = (await getClub(db, career.id, clubId))!;
    const target = Math.round(Number(wageBudget) / 100) * 100;
    const delta = target - club.wage_budget;
    const cost = delta * BUDGET_RATIO;
    if (club.transfer_budget - cost < 0) throw new GameError("Dafür reicht das Transferbudget nicht.");
    const squad = await getPlayers(db, career.id, [clubId]);
    if (target < wageBill(squad) * 0.9) throw new GameError("Das Gehaltsbudget darf nicht deutlich unter den aktuellen Gehältern liegen.");
    club.wage_budget = target;
    club.transfer_budget = Math.round(club.transfer_budget - cost);
    await saveClubs(db, career.id, [club]);
    return { message: `Budget angepasst: Transferbudget ${formatMoney(club.transfer_budget)}, Gehaltsbudget ${formatMoney(club.wage_budget)} pro Woche.`, transferBudget: club.transfer_budget, wageBudget: club.wage_budget };
  });
}

/** 1 € Wochengehalt entspricht 40 € Transferbudget. */
export const BUDGET_RATIO = 40;

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
  const base = {
    id: n.id, playerId: n.player_id, player: n.player_name, position: p?.position, age: p?.age, stage: n.stage, status: n.status,
    from: seller ? { id: seller.id, name: seller.name, colors: seller.colors } : null, offer: n.offer, counter: n.counter, demand: n.demand, terms: n.terms,
    patience: n.patience, message: n.message, day: n.day, season: n.season,
    waitingDays: n.stage === "club" && n.status === "pending" ? Math.max(0, (n.respond_day ?? career.day) - career.day) : 0,
  };
  if (!full) return base;
  return { ...base, log: n.log, roles: SQUAD_STATUS_LABEL, value: p?.value ?? 0, currentWage: p?.contract?.wage ?? 0, budget: await budgetOf(db, career), attempts: n.offer?.attempts ?? 1 };
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
  const negs = await query<NegRow>(db, "select * from negotiations where career_id = $1 and (stage = any($2::text[]) or (season = $3 and day > $4)) order by id desc limit 30", [career.id, ACTIVE, career.season, career.day - 30]);
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
    incoming: incoming.map((o) => ({ id: o.id, playerId: o.player_id, player: o.player_name, club: o.club_name, colors: o.colors, fee: o.fee })),
    shortlist: shortlist.map((r) => ({ id: r.data.id, name: `${r.data.firstName} ${r.data.lastName}`, position: r.data.position, age: r.data.age, value: r.data.value, club: r.club_name, colors: r.colors, contractUntil: r.data.contract?.untilSeason ?? null })),
    world: world.map((t) => ({ ...t })),
    installments: due,
    squad: { size: squad.length, listed: squad.filter((p) => p.listed).length, expiring: squad.filter((p) => p.contract && p.contract.untilSeason <= career.season).length },
  };
}
