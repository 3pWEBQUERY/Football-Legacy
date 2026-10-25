/** Transferverhandlungen: tägliche Antworten der Vereine, fällige Raten, Weiterverkauf, Budget. */
import { Rng, evaluateFee, formatMoney, seedFor, wageBill, type Player } from "@fl/sim";
import { withCareer } from "../career";
import { query, type Db } from "../db";
import { GameError } from "../errors";
import { clubSender, send } from "../news";
import { addFinance, getClub, getPlayer, getPlayers, saveClubs, type CareerRow, type ClubRow } from "../repo";
import { windowFor } from "../window";
import { toContractStage } from "./actions";
import { ACTIVE, describeOffer, log, nominalFor, offerValue, requireClub, saveNeg, sellerCtx, type NegRow } from "./core";

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
