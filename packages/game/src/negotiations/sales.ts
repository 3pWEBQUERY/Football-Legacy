/**
 * Transferverhandlungen: Angebote anderer Vereine für eigene Spieler. Du nimmst an,
 * forderst mehr oder lehnst ab; danach entscheidet der Spieler. Gezogene
 * Ausstiegsklauseln kannst du nicht ablehnen. Am Deadline Day geht alles sofort.
 */
import { Rng, formatMoney, roundMoney, seedFor, type Player } from "@fl/sim";
import { withCareer } from "../career";
import { query, type Db } from "../db";
import { GameError } from "../errors";
import { addArticle } from "../media";
import { clubSender, mediaSender, send } from "../news";
import { addFinance, getClub, getClubs, getPlayer, getPlayers, saveClubs, savePlayers, type CareerRow, type ClubRow } from "../repo";
import { windowFor } from "../window";
import { ACTIVE, cleanOffer, deadlineDay, describeOffer, getNeg, insertNeg, log, newNeg, paySellOn, requireClub, responseDay, saveNeg, type ClubOffer, type NegRow } from "./core";

/** Höchstens so viele offene Verkaufsverhandlungen gleichzeitig. */
const SALE_LIMIT = 3;
/** So lange wartet ein Verein auf deine Antwort, dann zieht er sein Angebot zurück. */
const OFFER_DAYS = 7;

/** Was kostet ein Angebot den Käufer? Raten sind günstiger, eine Beteiligung kostet ihn etwas. */
function buyerCost(p: Player, o: ClubOffer) {
  const up = o.fee * (o.upfrontPct / 100);
  return up + (o.fee - up) * 0.85 + p.value * (o.sellOn / 100) * 0.4;
}

function feeForCost(p: Player, cost: number, o: ClubOffer) {
  const share = o.upfrontPct / 100 + (1 - o.upfrontPct / 100) * 0.85;
  return roundMoney(Math.max(0, (cost - p.value * (o.sellOn / 100) * 0.4) / share));
}

/** Schmerzgrenze des Käufers – fest je Verhandlung, damit sie nicht durch Neuladen schwankt. */
function maxPay(career: CareerRow, n: NegRow, p: Player, buyer: ClubRow) {
  const r = new Rng(seedFor(career.seed, "sale-max", n.id)).next();
  return Math.min(buyer.transfer_budget, p.value * (1.15 + r * 0.45));
}

async function createSale(db: Db, career: CareerRow, p: Player, seller: ClubRow, buyer: ClubRow, offer: ClubOffer, clause: boolean) {
  const n = newNeg(career, "sell", p, seller.id, buyer.id);
  n.offer = { ...offer, attempts: 1 };
  if (clause) {
    n.stage = "contract";
    n.status = "player";
    n.respond_day = responseDay(career, 1);
    n.message = `${buyer.name} hat die Ausstiegsklausel über ${formatMoney(offer.fee)} gezogen. Jetzt entscheidet ${p.firstName} ${p.lastName}.`;
    log(n, career, "verein", `Ausstiegsklausel gezogen: ${formatMoney(offer.fee)}`);
  } else {
    n.status = "offered";
    n.respond_day = responseDay(career, OFFER_DAYS);
    n.message = `${buyer.name} bietet ${describeOffer(offer)}.`;
    log(n, career, "verein", `Angebot: ${describeOffer(offer)}`);
  }
  await insertNeg(db, n);
  await send(db, career, {
    category: "transfer", title: clause ? `Ausstiegsklausel für ${n.player_name} gezogen!` : `Angebot für ${n.player_name}`,
    sender: clubSender(buyer, "Sportdirektor"),
    blocks: [
      { t: "p", text: clause
        ? `Wir haben die Ausstiegsklausel von ${n.player_name} gezogen. Sie können den Wechsel nicht verhindern – die Entscheidung liegt beim Spieler.`
        : `Wir möchten ${n.player_name} verpflichten und bieten ${describeOffer(offer)}. Sie können annehmen, mehr fordern oder ablehnen.` },
      { t: "kv", rows: [["Spieler", `${n.player_name} (${p.position}, ${p.age})`], ["Angebot", describeOffer(offer)], ["Marktwert", formatMoney(p.value)], ["Vertrag bis", p.contract ? `Sommer ${p.contract.untilSeason + 1}` : "–"]] },
    ],
    priority: 2, kind: clause ? "release_clause" : "sale_offer", action: { type: "negotiation", negotiationId: n.id, playerId: p.id },
  });
}

/**
 * KI-Vereine machen Angebote für Spieler des Nutzers. intensity 1 = normale Woche,
 * 2 = letzte Tage des Fensters. force erzwingt ein Angebot (für Tests).
 */
export async function aiSaleOffers(db: Db, career: CareerRow, rng: Rng, opts: { intensity?: number; force?: { playerId: number; clause?: boolean } } = {}) {
  const userId = career.club_id;
  if (!userId || !windowFor(career).open) return 0;
  const intensity = opts.intensity ?? 1;
  const active = await query<{ player_id: number }>(db, "select player_id from negotiations where career_id = $1 and kind = 'sell' and stage = any($2::text[])", [career.id, ACTIVE]);
  if (!opts.force && active.length >= SALE_LIMIT) return 0;
  const busy = new Set(active.map((a) => a.player_id));
  const squad = (await getPlayers(db, career.id, [userId])).filter((p) => !p.loan && !busy.has(p.id));
  if (!squad.length) return 0;
  const user = (await getClub(db, career.id, userId))!;
  const clubs = await getClubs(db, career.id, "players_generated and id <> $2", [userId]);
  const forced = opts.force ? squad.find((p) => p.id === opts.force!.playerId) : undefined;
  let made = 0;

  // Ausstiegsklauseln: je günstiger die Klausel im Verhältnis zum Wert, desto eher wird sie gezogen
  for (const p of squad.filter((x) => x.contract?.releaseClause)) {
    const clause = p.contract!.releaseClause!;
    const isForced = forced?.id === p.id && opts.force?.clause;
    if (opts.force && !isForced) continue;
    if (!isForced && !rng.chance(Math.min(0.5, 0.06 * intensity * Math.max(0.3, (p.value * 1.4) / clause)))) continue;
    const bidders = clubs.filter((c) => c.transfer_budget >= clause && c.rating >= p.rating - 6 && c.reputation >= user.reputation - 10);
    if (!bidders.length) continue;
    await createSale(db, career, p, user, rng.pick(bidders), { fee: clause, upfrontPct: 100, installmentYears: 0, sellOn: 0 }, true);
    made++;
  }
  if (opts.force?.clause) return made;

  const listed = squad.some((p) => p.listed || p.transferRequest);
  if (!forced && !rng.chance(Math.min(0.9, (0.18 + (listed ? 0.45 : 0)) * intensity))) return made;
  const pool = forced ? [forced] : squad.filter((p) => p.listed || p.transferRequest || rng.chance(0.25));
  if (!pool.length) return made;
  const target = pool[rng.weighted(pool.map((p) => (p.listed ? 6 : p.transferRequest ? 4 : 1) * Math.sqrt(Math.max(1, p.value))))];
  const bidders = clubs.filter((c) => c.transfer_budget > target.value * 0.8 && Math.abs(c.rating - target.rating) <= 10);
  if (!bidders.length) return made;
  const bidder = rng.pick(bidders);
  const fee = roundMoney(Math.min(bidder.transfer_budget, target.value * rng.range(0.8, 1.3) * (target.listed ? 0.9 : 1)));
  const upfrontPct = rng.pick([100, 100, 75, 50]);
  await createSale(db, career, target, user, bidder, {
    fee, upfrontPct, installmentYears: upfrontPct === 100 ? 0 : rng.int(1, 3),
    sellOn: target.age <= 23 && rng.chance(0.4) ? rng.pick([10, 15, 20]) : 0,
  }, false);
  return made + 1;
}

/** Antwort auf ein Angebot für einen eigenen Spieler. */
export async function respondSale(careerId: string, accountId: string, id: number, decision: "accept" | "reject" | "counter", counter?: Partial<ClubOffer>) {
  return withCareer(careerId, accountId, async (db, career) => {
    requireClub(career);
    const n = await getNeg(db, career, id);
    if (n.kind !== "sell" || !ACTIVE.includes(n.stage)) throw new GameError("Dieses Angebot ist nicht mehr gültig.");
    const buyer = (await getClub(db, career.id, n.to_club))!;
    const clause = n.status === "player" && n.log.some((l) => l.text.startsWith("Ausstiegsklausel"));
    if (decision === "reject") {
      if (clause) throw new GameError("Die Ausstiegsklausel wurde gezogen – du kannst den Wechsel nicht ablehnen.");
      if (n.status !== "offered") throw new GameError("Darüber wird gerade schon entschieden.");
      const p = (await getPlayer(db, career.id, n.player_id))!;
      const user = (await getClub(db, career.id, n.from_club!))!;
      n.stage = "failed";
      n.status = "rejected";
      n.message = "Angebot abgelehnt.";
      if (p.transferRequest || buyer.reputation > user.reputation + 10) {
        p.morale = Math.max(5, p.morale - 8);
        await savePlayers(db, career.id, [p]);
        n.message += ` ${p.firstName} ${p.lastName} ist enttäuscht – er wäre gern zu ${buyer.name} gewechselt.`;
      }
      log(n, career, "du", "Angebot abgelehnt.");
      await saveNeg(db, n);
      return { status: "rejected", message: n.message };
    }
    if (n.status !== "offered") throw new GameError("Darüber wird gerade schon entschieden.");
    if (decision === "accept") {
      n.stage = "contract";
      n.status = "player";
      n.respond_day = responseDay(career, 1);
      n.message = `Einigung mit ${buyer.name}. Der Spieler spricht jetzt mit ${buyer.name} über seinen Vertrag.`;
      log(n, career, "du", "Angebot angenommen.");
      await saveNeg(db, n);
      if (n.respond_day === career.day) return resolvePlayer(db, career, n);
      return { status: "player", message: n.message };
    }
    if ((n.offer?.attempts ?? 1) >= 3) throw new GameError(`${buyer.name} verhandelt nicht weiter – nimm an oder lehne ab.`);
    const c = cleanOffer(counter ?? {}, false);
    if (c.fee <= 0) throw new GameError("Bitte eine Ablöse angeben.");
    n.counter = c;
    n.status = "pending";
    n.respond_day = responseDay(career, 1);
    n.message = `${buyer.name} prüft deine Forderung.`;
    log(n, career, "du", `Forderung: ${describeOffer(c)}`);
    await saveNeg(db, n);
    if (n.respond_day === career.day) return answerCounter(db, career, n);
    return { status: "pending", message: n.message };
  });
}

/** Täglich: fällige Antworten auf Forderungen und Entscheidungen der Spieler. */
export async function saleDaily(db: Db, career: CareerRow, n: NegRow) {
  const due = (n.respond_season ?? 0) < career.season || (n.respond_day ?? Infinity) <= career.day;
  if (n.status === "offered") {
    // Unbeantwortete Angebote verfallen nach einigen Tagen (am Deadline Day erst am Folgetag)
    if ((n.respond_season ?? 0) < career.season || (n.respond_day ?? Infinity) < career.day) {
      const buyer = await getClub(db, career.id, n.to_club);
      n.stage = "expired";
      n.status = "expired";
      n.message = `${buyer?.name ?? "Der Verein"} hat keine Antwort erhalten und zieht das Angebot zurück.`;
      log(n, career, "verein", n.message);
      await saveNeg(db, n);
    }
    return;
  }
  if (!due) return;
  if (n.status === "pending") await answerCounter(db, career, n);
  else if (n.status === "player") await resolvePlayer(db, career, n);
}

async function answerCounter(db: Db, career: CareerRow, n: NegRow) {
  const p = await getPlayer(db, career.id, n.player_id);
  const buyer = (await getClub(db, career.id, n.to_club))!;
  if (!p || p.clubId !== n.from_club) {
    n.stage = "failed"; n.status = "rejected"; n.message = "Der Spieler ist nicht mehr verfügbar."; await saveNeg(db, n);
    return { status: "failed", message: n.message };
  }
  const max = maxPay(career, n, p, buyer);
  const c = n.counter!;
  const attempts = (n.offer?.attempts ?? 1) + 1;
  let title: string;
  if (buyerCost(p, c) <= max) {
    n.offer = { ...c, attempts };
    n.counter = null;
    n.stage = "contract";
    n.status = "player";
    n.respond_day = responseDay(career, 1);
    n.message = `${buyer.name} akzeptiert deine Forderung. Jetzt entscheidet der Spieler.`;
    title = `${buyer.name} akzeptiert deine Forderung für ${n.player_name}`;
    log(n, career, "verein", "Forderung akzeptiert.");
  } else if (attempts <= 3) {
    const o = n.offer!;
    const fee = Math.min(feeForCost(p, max, o), feeForCost(p, (buyerCost(p, o) + Math.min(max, buyerCost(p, c))) / 2, o));
    n.offer = { ...o, fee: Math.max(fee, o.fee), attempts };
    n.counter = null;
    n.status = "offered";
    n.respond_day = responseDay(career, OFFER_DAYS);
    n.message = `${buyer.name} bessert nach: ${describeOffer(n.offer)}.`;
    title = `Verbessertes Angebot für ${n.player_name}`;
    log(n, career, "verein", `Verbessertes Angebot: ${describeOffer(n.offer)}`);
  } else {
    n.stage = "failed";
    n.status = "rejected";
    n.message = `${buyer.name} ist nicht bereit, so viel zu zahlen, und zieht das Angebot zurück.`;
    title = `${buyer.name} zieht das Angebot zurück`;
    log(n, career, "verein", n.message);
  }
  await saveNeg(db, n);
  await send(db, career, {
    category: "transfer", title, sender: clubSender(buyer, "Sportdirektor"),
    blocks: [{ t: "p", text: n.message! }, { t: "kv", rows: [["Deine Forderung", describeOffer(c)], ...(n.status === "offered" ? [["Neues Angebot", describeOffer(n.offer!)] as [string, string]] : [])] }],
    priority: 2, kind: "negotiation", action: { type: "negotiation", negotiationId: n.id, playerId: n.player_id },
  });
  if (n.status === "player" && n.respond_day === career.day) return resolvePlayer(db, career, n);
  return { status: n.status, message: n.message };
}

/** Der Spieler entscheidet, ob er wechseln will. */
async function resolvePlayer(db: Db, career: CareerRow, n: NegRow) {
  const p = await getPlayer(db, career.id, n.player_id);
  const user = (await getClub(db, career.id, n.from_club!))!;
  const buyer = (await getClub(db, career.id, n.to_club))!;
  if (!p || p.clubId !== user.id) {
    n.stage = "failed"; n.status = "rejected"; n.message = "Der Spieler ist nicht mehr verfügbar."; await saveNeg(db, n);
    return { status: "failed", message: n.message };
  }
  let chance = 0.7;
  if (buyer.reputation > user.reputation + 10) chance += 0.2;
  if (buyer.reputation < user.reputation - 10) chance -= 0.35;
  if (p.morale < 40) chance += 0.15;
  if (p.listed) chance += 0.1;
  if (p.squadStatus === "star" && p.morale >= 70) chance -= 0.15;
  if (p.transferRequest) chance = 1;
  const yes = new Rng(seedFor(career.seed, "sale-player", n.id)).chance(Math.max(0.05, Math.min(1, chance)));
  if (!yes) {
    n.stage = "failed";
    n.status = "rejected";
    n.message = `${n.player_name} möchte bei ${user.name} bleiben und lehnt den Wechsel zu ${buyer.name} ab.`;
    p.morale = Math.min(100, p.morale + 3);
    await savePlayers(db, career.id, [p]);
    log(n, career, "berater", n.message);
    await saveNeg(db, n);
    await send(db, career, {
      category: "transfer", title: `${n.player_name} bleibt`, sender: clubSender(user, "Sportdirektion"),
      blocks: [{ t: "p", text: n.message }], priority: 1, kind: "negotiation", action: { type: "player", playerId: p.id },
    });
    return { status: "failed", message: n.message };
  }
  return completeSale(db, career, n, p, user, buyer);
}

async function completeSale(db: Db, career: CareerRow, n: NegRow, p: Player, user: ClubRow, buyer: ClubRow) {
  const o = n.offer!;
  const upfront = roundMoney(o.fee * (o.upfrontPct / 100));
  const rest = o.fee - upfront;
  user.balance += upfront;
  user.transfer_budget += Math.round(upfront * 0.75);
  buyer.balance -= upfront;
  buyer.transfer_budget = Math.max(0, buyer.transfer_budget - upfront);
  const sellOnShare = await paySellOn(db, career, p, o.fee, user, buyer);
  if (user.tactic) {
    user.tactic.lineup = user.tactic.lineup.map((x) => (x === p.id ? null : x));
    user.tactic.bench = user.tactic.bench.filter((x) => x !== p.id);
  }
  await saveClubs(db, career.id, [user, buyer]);
  if (rest > 0) {
    const per = Math.round(rest / o.installmentYears);
    for (let i = 1; i <= o.installmentYears; i++) {
      await query(db, "insert into transfer_payments(career_id, from_club, to_club, amount, due_season, label) values ($1,$2,$3,$4,$5,$6)",
        [career.id, buyer.id, user.id, i === o.installmentYears ? rest - per * (o.installmentYears - 1) : per, career.season + i, `Rate ${i}/${o.installmentYears}: Verkauf ${n.player_name}`]);
    }
  }
  p.clubId = buyer.id;
  p.listed = false;
  p.transferRequest = false;
  p.squadStatus = null;
  p.joined = { season: career.season };
  p.sellOn = o.sellOn > 0 ? { clubId: user.id, pct: o.sellOn } : null;
  p.contract = { wage: Math.round(((p.contract?.wage ?? 1000) * 1.2) / 100) * 100, untilSeason: career.season + (p.age >= 30 ? 2 : 4), releaseClause: null, goalBonus: 0 };
  p.morale = 80;
  await savePlayers(db, career.id, [p]);
  await query(db,
    `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, message, season, week)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'offer_in','completed','Verkauf abgeschlossen',$9,$10)`,
    [career.id, p.id, n.player_name, user.id, buyer.id, o.fee, p.contract.wage, 4, career.season, career.week]);
  if (upfront) await addFinance(db, career.id, user.id, career.season, career.week, [{ kind: "transfer_in", amount: upfront, label: `Verkauf ${n.player_name}${rest ? " (Sofortzahlung)" : ""}` }]);
  n.stage = "done";
  n.status = "agreed";
  n.message = `${n.player_name} wechselt für ${formatMoney(o.fee)} zu ${buyer.name}.`;
  log(n, career, "verein", "Transfer abgeschlossen.");
  await saveNeg(db, n);
  await send(db, career, {
    category: "transfer", title: `${n.player_name} verlässt den Verein`, sender: clubSender(user, "Sportdirektion"),
    blocks: [
      { t: "p", text: n.message },
      { t: "kv", rows: [["Ablöse", describeOffer(o)], ["Sofort eingegangen", formatMoney(upfront)], ...(sellOnShare ? [["Weiterverkaufsanteil an Ex-Verein", formatMoney(sellOnShare)] as [string, string]] : [])] },
    ],
    priority: 2, kind: "sale_done",
  });
  await addArticle(db, career, {
    kind: "transfer", title: `${n.player_name} wechselt zu ${buyer.name}`,
    body: `${user.name} gibt ${n.player_name} für ${formatMoney(o.fee)} an ${buyer.name} ab.`,
    clubId: user.id, playerId: p.id, own: true, importance: o.fee >= 10_000_000 ? 3 : 2,
  });
  return { status: "completed", message: n.message };
}

/** Letzte Tage des Fensters: mehr Angebote; am letzten Tag die Deadline-Day-Nachricht. */
export async function transferDeadline(db: Db, career: CareerRow) {
  if (!career.club_id) return;
  const w = windowFor(career);
  if (!w.open || w.closes === null || w.closes - career.day > 2) return;
  await aiSaleOffers(db, career, new Rng(seedFor(career.seed, "deadline-offers", career.season, career.day)), { intensity: 2 });
  if (!deadlineDay(career)) return;
  const kind = `deadline_${career.season}_${career.day}`;
  if ((await query(db, "select 1 from inbox where career_id = $1 and kind = $2 limit 1", [career.id, kind])).length) return;
  const own = (await getClub(db, career.id, career.club_id))!;
  const open = await query<{ player_name: string; kind: string }>(db, "select player_name, kind from negotiations where career_id = $1 and stage = any($2::text[]) and kind <> 'renew'", [career.id, ACTIVE]);
  await send(db, career, {
    category: "transfer", title: "Deadline Day!", sender: mediaSender(career, own, "deadline"),
    blocks: [
      { t: "p", text: `Heute um Mitternacht schliesst das ${w.label}. Vereine antworten auf Angebote sofort – was heute nicht unterschrieben ist, platzt.` },
      ...(open.length ? [{ t: "list" as const, items: open.map((o) => `${o.player_name}: ${o.kind === "sell" ? "Angebot für deinen Spieler" : "eigene Verhandlung"} läuft noch`) }] : []),
    ],
    priority: 2, kind, action: { type: "transfers" },
  });
}
