/** Transferverhandlungen: Datenmodell, Bewertung von Angeboten und Forderungen des Beraters. */
import { SQUAD_STATUS_LABEL, formatMoney, roundMoney, squadRanks, wageDemand, wageFactor, type Player, type SquadStatus } from "@fl/sim";
import { one, query, type Db } from "../db";
import { GameError } from "../errors";
import { addFinance, getClub, getPlayer, getPlayers, saveClubs, type CareerRow, type ClubRow } from "../repo";
import { windowFor } from "../window";

export interface ClubOffer { fee: number; upfrontPct: number; installmentYears: number; sellOn: number }
export interface ContractTerms { wage: number; years: number; signingBonus: number; releaseClause: number | null; role: SquadStatus; agentFee: number }
interface LogEntry { day: number; season: number; who: "du" | "verein" | "berater"; text: string }
/** buy: eigener Einkauf · sell: Angebot für einen eigenen Spieler · renew: Vertragsverlängerung */
export type NegKind = "buy" | "sell" | "renew";
export interface NegRow {
  id: number; career_id: string; kind: NegKind; player_id: number; player_name: string; from_club: number | null; to_club: number;
  stage: "club" | "contract" | "done" | "failed" | "withdrawn" | "expired"; status: string;
  offer: (ClubOffer & { attempts?: number }) | null; counter: ClubOffer | null; demand: ContractTerms | null; terms: ContractTerms | null;
  patience: number; respond_season: number | null; respond_day: number | null; season: number; day: number; message: string | null; log: LogEntry[];
}

export const ROLE_ORDER: SquadStatus[] = ["star", "important", "regular", "rotation", "backup", "prospect"];
const roleIdx = (r: SquadStatus) => Math.min(4, ROLE_ORDER.indexOf(r));
export const ACTIVE = ["club", "contract"];

export function requireClub(career: CareerRow) {
  if (!career.club_id || career.status !== "active") throw new GameError("Du hast aktuell keinen Verein.");
  return career.club_id;
}

export async function getNeg(db: Db, career: CareerRow, id: number): Promise<NegRow> {
  const n = await one<NegRow>(db, "select * from negotiations where career_id = $1 and id = $2", [career.id, id]);
  if (!n) throw new GameError("Verhandlung nicht gefunden", 404);
  return n;
}

export async function saveNeg(db: Db, n: NegRow) {
  await query(db,
    `update negotiations set stage = $2, status = $3, offer = $4, counter = $5, demand = $6, terms = $7, patience = $8,
       respond_season = $9, respond_day = $10, message = $11, log = $12, updated_at = now() where id = $1`,
    [n.id, n.stage, n.status, n.offer ? JSON.stringify(n.offer) : null, n.counter ? JSON.stringify(n.counter) : null,
      n.demand ? JSON.stringify(n.demand) : null, n.terms ? JSON.stringify(n.terms) : null, n.patience,
      n.respond_season, n.respond_day, n.message, JSON.stringify(n.log.slice(-30))]);
}

/** Neue Verhandlung speichern; liefert die ID. */
export async function insertNeg(db: Db, n: NegRow): Promise<number> {
  const r = await one<{ id: number }>(db,
    `insert into negotiations(career_id, kind, player_id, player_name, from_club, to_club, stage, status, offer, counter, demand, patience, respond_season, respond_day, season, day, message, log)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
    [n.career_id, n.kind, n.player_id, n.player_name, n.from_club, n.to_club, n.stage, n.status, n.offer ? JSON.stringify(n.offer) : null,
      n.counter ? JSON.stringify(n.counter) : null, n.demand ? JSON.stringify(n.demand) : null, n.patience, n.respond_season, n.respond_day,
      n.season, n.day, n.message, JSON.stringify(n.log)]);
  n.id = r!.id;
  return n.id;
}

/** Leere Verhandlung mit Standardwerten. */
export function newNeg(career: CareerRow, kind: NegKind, p: Player, fromClub: number | null, toClub: number): NegRow {
  return {
    id: 0, career_id: career.id, kind, player_id: p.id, player_name: `${p.firstName} ${p.lastName}`, from_club: fromClub, to_club: toClub,
    stage: "club", status: "pending", offer: null, counter: null, demand: null, terms: null, patience: 3,
    respond_season: career.season, respond_day: career.day, season: career.season, day: career.day, message: null, log: [],
  };
}

/** Deadline Day: letzter Tag des Transferfensters – Vereine antworten sofort. */
export function deadlineDay(career: CareerRow) {
  const w = windowFor(career);
  return w.open && w.closes !== null && w.closes <= career.day;
}

/** Antwortfrist: ein bis zwei Tage, am Deadline Day sofort. */
export function responseDay(career: CareerRow, delay: number) {
  const w = windowFor(career);
  if (w.open && w.closes !== null) return Math.min(career.day + delay, w.closes);
  return career.day + delay;
}

export const log = (n: NegRow, career: CareerRow, who: LogEntry["who"], text: string) => n.log.push({ day: career.day, season: career.season, who, text });

// ------------------------------------------------------------ Bewertung

export async function sellerCtx(db: Db, career: CareerRow, p: Player) {
  const squad = p.clubId !== null ? await getPlayers(db, career.id, [p.clubId]) : [];
  const club = p.clubId !== null ? await getClub(db, career.id, p.clubId) : null;
  return { ctx: { season: career.season, squadRank: squadRanks(squad).get(p.id) ?? 30, squadSize: squad.length, sellerReputation: club?.reputation ?? 30, isUserClub: false }, club };
}

/** Was ist das Angebot dem abgebenden Verein wert? Raten zählen etwas weniger, Weiterverkauf zählt bei jungen Spielern. */
export function offerValue(p: Player, o: ClubOffer) {
  const up = o.fee * (o.upfrontPct / 100);
  const rest = o.fee - up;
  const sellOnValue = p.value * (o.sellOn / 100) * (p.age <= 23 ? 0.6 : 0.3);
  return up + rest * 0.85 + sellOnValue;
}

export function nominalFor(p: Player, value: number, o: ClubOffer) {
  const sellOnValue = p.value * (o.sellOn / 100) * (p.age <= 23 ? 0.6 : 0.3);
  const share = o.upfrontPct / 100 + (1 - o.upfrontPct / 100) * 0.85;
  return roundMoney(Math.max(0, (value - sellOnValue) / share));
}

export function expectedRole(p: Player, squad: Player[]): SquadStatus {
  const ranks = squadRanks([...squad.filter((x) => x.id !== p.id), p]);
  const r = ranks.get(p.id) ?? 30;
  if (r <= 3) return "star";
  if (r <= 7) return "important";
  if (r <= 11) return "regular";
  if (r <= 16) return "rotation";
  return p.age <= 21 ? "prospect" : "backup";
}

export function initialDemand(p: Player, buyer: ClubRow, seller: ClubRow | null, squad: Player[], fee: number): ContractTerms | { refuse: string } {
  const curRep = seller?.reputation ?? Math.max(1, buyer.reputation - 20);
  if (buyer.reputation < curRep - 30 && p.rating > 60) return { refuse: `${p.firstName} ${p.lastName} sieht bei ${buyer.name} keine sportliche Perspektive und lehnt Gespräche ab.` };
  const repF = buyer.reputation < curRep - 10 ? 1.25 : buyer.reputation > curRep + 10 ? 0.92 : 1;
  const wage = Math.max(Math.round((wageDemand(p, buyer.reputation) * repF * wageFactor(p)) / 100) * 100, Math.round(((p.contract?.wage ?? 0) * 1.05) / 100) * 100, 500);
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
export function judgeTerms(d: ContractTerms, t: ContractTerms): { ok: boolean; need: number; reason: string | null; hardRole: boolean } {
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


export function cleanOffer(o: Partial<ClubOffer>, free: boolean): ClubOffer {
  if (free) return { fee: 0, upfrontPct: 100, installmentYears: 0, sellOn: 0 };
  const upfrontPct = [25, 50, 75, 100].includes(Number(o.upfrontPct)) ? Number(o.upfrontPct) : 100;
  return {
    fee: Math.max(0, Math.round(Number(o.fee) || 0)),
    upfrontPct,
    installmentYears: upfrontPct === 100 ? 0 : Math.max(1, Math.min(3, Math.round(Number(o.installmentYears) || 1))),
    sellOn: Math.max(0, Math.min(30, Math.round(Number(o.sellOn) || 0))),
  };
}

export function describeOffer(o: ClubOffer) {
  const parts = [formatMoney(o.fee)];
  if (o.upfrontPct < 100) parts.push(`${o.upfrontPct} % sofort, Rest in ${o.installmentYears} Jahresrate${o.installmentYears > 1 ? "n" : ""}`);
  if (o.sellOn) parts.push(`${o.sellOn} % Weiterverkaufsbeteiligung`);
  return parts.join(" · ");
}

export function describeTerms(t: ContractTerms) {
  return `${formatMoney(t.wage)}/Woche, ${t.years} Jahre, Handgeld ${formatMoney(t.signingBonus)}, Rolle ${SQUAD_STATUS_LABEL[t.role]}${t.releaseClause ? `, Ausstiegsklausel ${formatMoney(t.releaseClause)}` : ""}, Berater ${formatMoney(t.agentFee)}`;
}

/** Einigung mit dem Verein: Forderungen des Beraters ermitteln und zu den Vertragsgesprächen wechseln. */
export async function toContractStage(db: Db, career: CareerRow, n: NegRow, buyer: ClubRow) {
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
