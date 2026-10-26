/** Integrationstest – Verkäufe, Ausstiegsklauseln, Verlängerung, Leihen mit Option und Deadline Day. */
import { Rng } from "@fl/sim";
import { describe, expect, it } from "vitest";
import { windowFor } from "../../src/window";
import { advance, createCareer, game, marketView, neg, pool, previewClubs, quickMatch, register } from "../context";

describe("Transfer-Kreis", () => {
  let cid = "";
  let acc = "";
  let own = 0;
  const career = () => game.readCareer(cid, acc);
  const nextDay = async () => {
    const r = await advance(cid, acc);
    if (r.kind === "match") await quickMatch(cid, acc);
  };
  const squad = async () => (await pool().query("select id, data from players where career_id = $1 and club_id = $2 order by rating desc", [cid, own])).rows as { id: number; data: { value: number } }[];

  it("Angebot für eigenen Spieler: mehr fordern, Antwort des Käufers, Entscheidung des Spielers", async () => {
    const { account } = await register(`verkauf${Date.now()}@example.com`, "geheim123", "Verkauf");
    acc = account.id;
    const preview = previewClubs(321, "GER");
    cid = await createCareer(acc, { managerName: "Verkauf", countryCode: "GER", clubIndex: preview[0].clubs[8].index, seed: 321 });
    own = (await game.dashboard(cid, acc)).career.clubId!;
    const players = await squad();
    let done = false;
    // Mehrere Spieler versuchen, bis einer wirklich wechselt (der Spieler darf ablehnen)
    for (const target of players.slice(3, 12)) {
      const made = await neg.aiSaleOffers(pool(), await career(), new Rng(target.id), { force: { playerId: target.id } });
      if (!made) continue;
      const hub = await game.transferHub(cid, acc);
      const sale = hub.sales.find((s) => s.playerId === target.id && s.stage === "club")!;
      expect(sale.status).toBe("offered");
      expect(sale.to?.name).toBeTruthy();
      const msg = await pool().query("select kind from inbox where career_id = $1 and kind = 'sale_offer' order by id desc limit 1", [cid]);
      expect(msg.rows.length).toBe(1);
      const c = await game.respondSale(cid, acc, sale.id, "counter", { fee: Math.round(sale.offer!.fee * 1.1), upfrontPct: 100, installmentYears: 0, sellOn: 10 });
      expect(c.status).toBe("pending");
      await expect(game.respondSale(cid, acc, sale.id, "accept")).rejects.toThrow(/entschieden/);
      await nextDay();
      let v = await game.negotiationView(cid, acc, sale.id);
      expect(["offered", "player", "rejected"]).toContain(v.status);
      if (v.status === "offered") { await game.respondSale(cid, acc, sale.id, "accept"); v = await game.negotiationView(cid, acc, sale.id); }
      if (v.stage === "failed") continue;
      expect(v.status).toBe("player");
      const before = Number((await pool().query("select balance from clubs where career_id = $1 and id = $2", [cid, own])).rows[0].balance);
      await nextDay();
      v = await game.negotiationView(cid, acc, sale.id);
      expect(["done", "failed"]).toContain(v.stage);
      if (v.stage !== "done") continue;
      const p = (await pool().query("select club_id, data from players where career_id = $1 and id = $2", [cid, target.id])).rows[0];
      expect(p.club_id).toBe(v.to!.id);
      const after = Number((await pool().query("select balance from clubs where career_id = $1 and id = $2", [cid, own])).rows[0].balance);
      expect(after).toBeGreaterThan(before);
      if (v.offer!.sellOn) expect(p.data.sellOn.clubId).toBe(own);
      done = true;
      break;
    }
    expect(done).toBe(true);
  }, 120_000);

  it("Unbeantwortete Angebote verfallen nach einer Woche", async () => {
    const p = (await squad())[15];
    await neg.aiSaleOffers(pool(), await career(), new Rng(77), { force: { playerId: p.id } });
    const sale = (await game.transferHub(cid, acc)).sales.find((s) => s.playerId === p.id && s.stage === "club")!;
    expect(sale.waitingDays).toBeGreaterThan(5);
    for (let i = 0; i < 12 && (await game.negotiationView(cid, acc, sale.id)).stage === "club"; i++) await nextDay();
    expect((await game.negotiationView(cid, acc, sale.id)).stage).toBe("expired");
  }, 60_000);

  it("Ausstiegsklausel: KI zieht sie, Ablehnen ist nicht möglich; eigene Klausel-Zahlung überspringt den Verein", async () => {
    const [p] = (await squad()).slice(1, 2);
    await pool().query("update players set data = jsonb_set(data, '{contract,releaseClause}', to_jsonb($3::bigint)) where career_id = $1 and id = $2", [cid, p.id, Math.round(p.data.value * 0.6)]);
    const made = await neg.aiSaleOffers(pool(), await career(), new Rng(5), { force: { playerId: p.id, clause: true } });
    expect(made).toBe(1);
    const sale = (await game.transferHub(cid, acc)).sales.find((s) => s.playerId === p.id && s.stage === "contract")!;
    expect(sale.clause).toBe(true);
    await expect(game.respondSale(cid, acc, sale.id, "reject")).rejects.toThrow(/Ausstiegsklausel/);

    const m = await marketView(cid, acc, { sort: "rating", maxValue: 3_000_000 });
    const target = m.players.find((x) => x.clubId !== null && !x.loan)!;
    const clause = Math.max(100_000, Math.round(target.value * 1.5));
    await pool().query("update players set data = jsonb_set(data, '{contract,releaseClause}', to_jsonb($3::bigint)) where career_id = $1 and id = $2", [cid, target.id, clause]);
    const r = await game.startNegotiation(cid, acc, { playerId: target.id, offer: { fee: clause, upfrontPct: 100, installmentYears: 0, sellOn: 0 } });
    expect(r.stage).toBe("contract");
    await game.withdrawNegotiation(cid, acc, r.id);
  }, 60_000);

  it("Vertragsverlängerung mit dem Berater", async () => {
    const [p] = (await squad()).slice(4, 5);
    const c = await career();
    await pool().query("update players set data = jsonb_set(data, '{contract,untilSeason}', to_jsonb($3::int)) where career_id = $1 and id = $2", [cid, p.id, c.season]);
    const r = await game.startRenewal(cid, acc, p.id);
    const v = await game.negotiationView(cid, acc, r.id);
    expect(v.kind).toBe("renew");
    expect(v.stage).toBe("contract");
    expect((await game.startRenewal(cid, acc, p.id)).id).toBe(r.id);
    const low = await game.offerContract(cid, acc, r.id, { ...v.demand!, wage: Math.round(v.demand!.wage * 0.7) });
    expect(low.status).not.toBe("completed");
    const demand = (await game.negotiationView(cid, acc, r.id)).demand!;
    const ok = await game.offerContract(cid, acc, r.id, demand);
    expect(ok.status).toBe("completed");
    const after = (await pool().query("select data from players where career_id = $1 and id = $2", [cid, p.id])).rows[0].data;
    expect(after.contract.untilSeason).toBe(c.season + demand.years - 1);
    expect(after.contract.wage).toBe(demand.wage);
    const [q] = (await squad()).slice(6, 7);
    await pool().query("update players set data = jsonb_set(data, '{contract,untilSeason}', to_jsonb($3::int)) where career_id = $1 and id = $2", [cid, q.id, c.season + 4]);
    await expect(game.startRenewal(cid, acc, q.id)).rejects.toThrow(/keinen Grund/);
  });

  it("Leihe mit Kaufoption und Kaufpflicht; Option ziehen", async () => {
    const d = await game.dashboard(cid, acc);
    const { rows } = await pool().query(
      "select p.id from players p join clubs c on c.id = p.club_id where p.career_id = $1 and c.league_id = $2 and c.id <> $3 and p.data->'loan' is null order by p.rating asc limit 2",
      [cid, d.league!.id, own]);
    const low = await game.loanIn(cid, acc, rows[0].id, 1, { fee: 1000, obligation: false });
    expect(low.status).toBe("countered");
    const min = (low as { minOptionFee: number }).minOptionFee;
    const ok = await game.loanIn(cid, acc, rows[0].id, 1, { fee: min, obligation: false });
    expect(ok.status).toBe("completed");
    const loaned = (await pool().query("select data from players where career_id = $1 and id = $2", [cid, rows[0].id])).rows[0].data;
    expect(loaned.loan.optionFee).toBe(min);
    const bought = await game.exerciseLoanOption(cid, acc, rows[0].id);
    expect(bought.message).toMatch(/fest/);
    const now = (await pool().query("select club_id, data from players where career_id = $1 and id = $2", [cid, rows[0].id])).rows[0];
    expect(now.club_id).toBe(own);
    expect(now.data.loan).toBeNull();
    const ob = await game.loanIn(cid, acc, rows[1].id, 0.9, { fee: min * 3, obligation: true });
    expect(ob.status).toBe("completed");
  });

  it("Deadline Day: Vereine antworten sofort, Nachricht im Posteingang", async () => {
    const c = await career();
    const closes = windowFor(c).closes;
    expect(closes).not.toBeNull();
    for (let i = 0; i < 120 && (await career()).day < closes!; i++) await nextDay();
    const now = await career();
    expect(now.day).toBe(closes);
    expect(neg.deadlineDay(now)).toBe(true);
    const inbox = await pool().query("select title from inbox where career_id = $1 and kind like 'deadline_%'", [cid]);
    expect(inbox.rows[0]?.title).toBe("Deadline Day!");
    const m = await marketView(cid, acc, { sort: "rating", maxValue: 2_000_000 });
    const target = m.players.find((x) => x.clubId !== null && !x.loan && !x.negotiation)!;
    const r = await game.startNegotiation(cid, acc, { playerId: target.id, offer: { fee: Math.round(target.value * 0.5), upfrontPct: 100, installmentYears: 0, sellOn: 0 } });
    expect(r.status).not.toBe("pending");
  }, 60_000);
});
