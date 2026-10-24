/** Finanzen: Einnahmen, Ausgaben, Budgets. Gleiche Regeln für alle Vereine. */
import { COUNTRY_BY_CODE } from "./data/countries";
import { clamp } from "./rng";
import type { Player } from "./types";

export interface ClubFinanceProfile {
  ticketPrice: number;
  sponsorWeekly: number;
  tvWeekly: number;
  merchWeekly: number;
  stadiumCostWeekly: number;
  staffWeekly: number;
}

export interface FinanceEntry {
  kind: "tickets" | "sponsor" | "tv" | "merch" | "prize" | "transfer_in" | "transfer_out" | "wages" | "stadium" | "staff" | "bonus" | "other";
  amount: number; // positiv = Einnahme
  label: string;
}

export const FINANCE_LABEL: Record<FinanceEntry["kind"], string> = {
  tickets: "Ticketverkauf",
  sponsor: "Sponsoren",
  tv: "TV-Gelder",
  merch: "Merchandising",
  prize: "Prämien",
  transfer_in: "Transfererlöse",
  transfer_out: "Ablösen",
  wages: "Gehälter",
  stadium: "Stadion",
  staff: "Personal",
  bonus: "Prämien Spieler",
  other: "Sonstiges",
};

export function wageBill(players: Pick<Player, "contract" | "loan">[], loanedOut: Pick<Player, "contract" | "loan">[] = []): number {
  const own = players.reduce((sum, p) => sum + (p.contract?.wage ?? 0) * (p.loan ? p.loan.wageShare : 1), 0);
  const out = loanedOut.reduce((sum, p) => sum + (p.contract?.wage ?? 0) * (1 - (p.loan?.wageShare ?? 1)), 0);
  return Math.round(own + out);
}

/**
 * Finanzprofil eines Vereins. Wird bei der Aktivierung aus Kader und Ruf
 * abgeleitet, sodass ein durchschnittlich geführter Verein etwa ausgeglichen wirtschaftet.
 */
export function financeProfile(club: { countryCode: string; reputation: number; capacity: number }, wages: number, tier: number): ClubFinanceProfile {
  const country = COUNTRY_BY_CODE[club.countryCode];
  const strength = country?.strength ?? 3;
  // Ticketerlöse sollen etwa ein Drittel der Gehälter decken – sonst wird der Ticketpreis gesenkt
  const basePrice = Math.round(6 + strength * 4 + club.reputation / 6 - (tier - 1) * 3);
  const ticketPrice = Math.max(5, Math.min(basePrice, Math.round((wages * 0.4) / Math.max(1, club.capacity * 0.35))));
  const avgTickets = club.capacity * 0.7 * ticketPrice * 0.5; // jede zweite Woche ein Heimspiel
  const target = wages * 1.12;
  const rest = Math.max(target - avgTickets, wages * 0.25);
  return {
    ticketPrice,
    sponsorWeekly: round100(rest * 0.42),
    tvWeekly: round100(rest * 0.45),
    merchWeekly: round100(rest * 0.13),
    stadiumCostWeekly: round100(club.capacity * 0.9 + 2000),
    staffWeekly: round100(wages * 0.08 + 1500),
  };
}

function round100(v: number) {
  return Math.round(v / 100) * 100;
}

export function attendance(capacity: number, reputation: number, formPoints: number, opponentReputation: number): number {
  // formPoints: Punkte aus den letzten 5 Spielen (0–15)
  const base = 0.45 + reputation / 220 + (formPoints - 7) / 60 + opponentReputation / 600;
  return Math.round(capacity * clamp(base, 0.2, 1));
}

/** Wöchentliche Buchungen eines Vereins. */
export function weeklyFinances(
  profile: ClubFinanceProfile,
  wages: number,
  homeMatch: { attendance: number } | null,
): FinanceEntry[] {
  const entries: FinanceEntry[] = [
    { kind: "sponsor", amount: profile.sponsorWeekly, label: "Sponsorenvertrag" },
    { kind: "tv", amount: profile.tvWeekly, label: "TV-Vermarktung" },
    { kind: "merch", amount: profile.merchWeekly, label: "Fanartikel" },
    { kind: "wages", amount: -wages, label: "Gehälter Spieler" },
    { kind: "staff", amount: -profile.staffWeekly, label: "Gehälter Personal" },
    { kind: "stadium", amount: -profile.stadiumCostWeekly, label: "Stadionbetrieb" },
  ];
  if (homeMatch) {
    entries.push({ kind: "tickets", amount: homeMatch.attendance * profile.ticketPrice, label: `${homeMatch.attendance.toLocaleString("de-CH")} Zuschauer` });
  }
  return entries;
}

/** Startkapital und Transferbudget bei Aktivierung. */
export function initialBudget(wages: number, reputation: number): { balance: number; transferBudget: number } {
  const balance = Math.round((wages * (14 + reputation / 4)) / 10_000) * 10_000;
  return { balance, transferBudget: Math.round((balance * 0.45) / 10_000) * 10_000 };
}

export function formatMoney(v: number): string {
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)} Mio. €`;
  if (a >= 1_000) return `${sign}${Math.round(a / 1_000)}k €`;
  return `${sign}${Math.round(a)} €`;
}
