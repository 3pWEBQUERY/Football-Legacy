/** Transferverhandlungen: Angebot, Gegenangebot, Vertragsgespräch, Abbruch und Abschluss des Transfers. */
import { Rng, SQUAD_STATUS_LABEL, formatMoney, roundMoney, seedFor, wageBill, type SquadStatus } from "@fl/sim";
import { withCareer } from "../career";
import { one, query, type Db } from "../db";
import { GameError } from "../errors";
import { addArticle } from "../media";
import { clubSender, send } from "../news";
import { addFinance, getClub, getPlayer, getPlayers, saveCareer, saveClubs, savePlayers, type CareerRow, type ClubRow } from "../repo";
import { announceNotes, awardCard, completeMission, unlockAchievement, type RewardNote } from "../rewards";
import { windowFor } from "../window";
import { ACTIVE, ROLE_ORDER, cleanOffer, describeOffer, describeTerms, getNeg, initialDemand, judgeTerms, log, requireClub, saveNeg, type ClubOffer, type ContractTerms, type NegRow } from "./core";

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
