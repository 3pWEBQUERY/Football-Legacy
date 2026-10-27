/** Transferverhandlungen: tägliche Antworten der Vereine, fällige Raten, Weiterverkauf, Budget. */
import { formatMoney, wageBill } from "@fl/sim";
import { withCareer } from "../career";
import { query, type Db } from "../db";
import { GameError } from "../errors";
import { clubSender, send } from "../news";
import { addFinance, getClub, getPlayers, saveClubs, type CareerRow, type ClubRow } from "../repo";
import { windowFor } from "../window";
import { answerClubOffer } from "./answer";
import { ACTIVE, log, requireClub, saveNeg, type NegRow } from "./core";
import { saleDaily } from "./sales";
import { rivalDaily } from "./rival";

// ------------------------------------------------------------ Zeitablauf

/** Täglich: Antworten der Vereine, abgelaufene Gespräche bei geschlossenem Fenster. */
export async function negotiationsDaily(db: Db, career: CareerRow) {
  if (!career.club_id) return;
  const rows = await query<NegRow>(db, "select * from negotiations where career_id = $1 and stage = any($2::text[])", [career.id, ACTIVE]);
  if (!rows.length) return;
  const window = windowFor(career);
  for (const n of rows) {
    if (n.kind !== "renew" && n.kind !== "pre" && n.from_club && !window.open) {
      n.stage = "expired";
      n.status = "expired";
      n.message = "Das Transferfenster hat geschlossen – die Verhandlung ist beendet.";
      log(n, career, "verein", n.message);
      await saveNeg(db, n);
      continue;
    }
    if (n.kind === "sell") { await saleDaily(db, career, n); continue; }
    await rivalDaily(db, career, n);
    if (n.stage !== "club" || n.status !== "pending") continue;
    if ((n.respond_season ?? 0) > career.season || ((n.respond_season ?? 0) === career.season && (n.respond_day ?? 0) > career.day)) continue;
    await answerClubOffer(db, career, n);
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
