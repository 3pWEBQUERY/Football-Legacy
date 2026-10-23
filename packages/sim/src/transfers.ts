/**
 * Transferlogik. KI-Vereine und Spieler nutzen dieselben Regeln, damit der
 * Markt fair bleibt.
 */
import { Rng, clamp } from "./rng";
import { roundMoney, wageDemand } from "./player";
import type { Player, Position } from "./types";
import { positionGroup } from "./types";

export interface SellerContext {
  season: number;
  /** Platz des Spielers in der Kader-Rangfolge (1 = bester). */
  squadRank: number;
  squadSize: number;
  sellerReputation: number;
  isUserClub: boolean;
}

/** Ablöseforderung des abgebenden Vereins. */
export function askingPrice(p: Player, ctx: SellerContext): number {
  const yearsLeft = p.contract ? p.contract.untilSeason - ctx.season : 0;
  const contractF = yearsLeft <= 0 ? 0.55 : yearsLeft === 1 ? 0.85 : yearsLeft === 2 ? 1 : 1.12;
  const importance = ctx.squadRank <= 5 ? 1.5 : ctx.squadRank <= 11 ? 1.3 : ctx.squadRank <= 16 ? 1.1 : 0.9;
  const listed = p.listed ? 0.85 : 1;
  const thin = ctx.squadSize <= 18 ? 1.3 : 1;
  return roundMoney(p.value * contractF * importance * listed * thin);
}

export type OfferVerdict =
  | { kind: "accept" }
  | { kind: "counter"; fee: number; message: string }
  | { kind: "reject"; message: string };

export function evaluateFee(p: Player, fee: number, ctx: SellerContext, rng: Rng): OfferVerdict {
  if (p.contract?.releaseClause && fee >= p.contract.releaseClause) return { kind: "accept" };
  const ask = askingPrice(p, ctx);
  // Leichte Verhandlungstoleranz
  const tolerance = rng.range(0.93, 1.0);
  if (fee >= ask * tolerance) return { kind: "accept" };
  if (fee >= ask * 0.65) {
    return { kind: "counter", fee: roundMoney(ask * rng.range(1.0, 1.06)), message: "Wir sind gesprächsbereit, aber nicht zu diesem Preis." };
  }
  if (ctx.squadRank <= 3 && fee < ask) return { kind: "reject", message: "Unser Schlüsselspieler ist praktisch unverkäuflich." };
  return { kind: "reject", message: "Das Angebot ist deutlich zu niedrig." };
}

export interface PersonalTerms {
  wage: number;
  years: number;
  releaseClause: number | null;
}

export type TermsVerdict = { kind: "accept" } | { kind: "counter"; wage: number; message: string } | { kind: "reject"; message: string };

/** Spieler prüft die persönlichen Bedingungen. */
export function evaluateTerms(
  p: Player,
  terms: PersonalTerms,
  buyerReputation: number,
  currentReputation: number,
  rng: Rng,
): TermsVerdict {
  if (buyerReputation < currentReputation - 30 && p.rating > 60) {
    return { kind: "reject", message: `${p.lastName} sieht bei einem kleineren Verein keine Perspektive.` };
  }
  const repF = buyerReputation < currentReputation - 10 ? 1.25 : buyerReputation > currentReputation + 10 ? 0.92 : 1;
  const ageF = p.age >= 31 && terms.years >= 3 ? 0.9 : p.age <= 23 && terms.years <= 1 ? 1.1 : 1;
  const demand = Math.round((wageDemand(p, buyerReputation) * repF * ageF) / 100) * 100;
  const currentWage = p.contract?.wage ?? 0;
  const need = Math.max(demand, Math.round(currentWage * 1.05));
  if (terms.wage >= need * rng.range(0.95, 1)) return { kind: "accept" };
  if (terms.wage >= need * 0.75) return { kind: "counter", wage: need, message: `${p.lastName} fordert ${need.toLocaleString("de-CH")} € pro Woche.` };
  return { kind: "reject", message: `${p.lastName} lehnt das Gehaltsangebot ab.` };
}

/** Vertragsverlängerung: Forderung des Spielers. */
export function renewalDemand(p: Player, reputation: number, squadRank: number): { wage: number; years: number } {
  const base = wageDemand(p, reputation);
  const loyalty = clamp(p.morale / 100, 0.3, 1);
  const rankF = squadRank <= 11 ? 1.1 : squadRank <= 18 ? 1 : 0.85;
  const current = p.contract?.wage ?? 0;
  const wage = Math.round((Math.max(base * rankF * (1.15 - loyalty * 0.2), current * 1.02)) / 100) * 100;
  const years = p.age >= 32 ? 1 : p.age >= 29 ? 2 : 3;
  return { wage, years };
}

export interface SquadNeed {
  group: "GK" | "DEF" | "MID" | "ATT";
  position: Position;
  currentBest: number;
}

const DESIRED: Record<"GK" | "DEF" | "MID" | "ATT", number> = { GK: 2, DEF: 7, MID: 7, ATT: 4 };
const GROUP_POS: Record<"GK" | "DEF" | "MID" | "ATT", Position[]> = {
  GK: ["GK"], DEF: ["DC", "DR", "DL"], MID: ["DM", "MC", "MR", "ML", "AMC"], ATT: ["ST", "AMR", "AML"],
};

/** Ermittelt die grösste Kaderlücke eines KI-Vereins. */
export function squadNeed(players: Player[], rng: Rng): SquadNeed | null {
  const groups = Object.keys(DESIRED) as (keyof typeof DESIRED)[];
  const scored = groups.map((g) => {
    const inGroup = players.filter((p) => positionGroup(p.position) === g).sort((a, b) => b.rating - a.rating);
    const shortage = DESIRED[g] - inGroup.length;
    const best = inGroup[0]?.rating ?? 0;
    return { g, shortage, best, inGroup };
  });
  scored.sort((a, b) => b.shortage - a.shortage);
  const top = scored[0];
  if (top.shortage > 0) {
    return { group: top.g, position: rng.pick(GROUP_POS[top.g]), currentBest: top.best };
  }
  // Sonst: zufällige Verstärkung für schwächste Gruppe
  const weakest = scored.sort((a, b) => (a.inGroup[1]?.rating ?? 0) - (b.inGroup[1]?.rating ?? 0))[0];
  return { group: weakest.g, position: rng.pick(GROUP_POS[weakest.g]), currentBest: weakest.inGroup[1]?.rating ?? 0 };
}

/** Kader-Rangfolge (nach Stärke) für Wichtigkeit und Moral. */
export function squadRanks(players: Player[]): Map<number, number> {
  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  return new Map(sorted.map((p, i) => [p.id, i + 1]));
}
