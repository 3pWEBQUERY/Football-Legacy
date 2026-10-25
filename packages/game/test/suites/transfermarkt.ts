/** Integrationstest – Transfermarkt mit Verhandlungen. */
import { describe, expect, it } from "vitest";
import { game, neg, pool, register, createCareer, previewClubs, advance, quickMatch, marketView } from "../context";

describe("Transfermarkt", () => {
  let cid = "";
  let acc = "";

  async function untilAnswered(id: number) {
    for (let i = 0; i < 4; i++) {
      const v = await game.negotiationView(cid, acc, id);
      if (v.status !== "pending") return v;
      const r = await advance(cid, acc);
      if (r.kind === "match") await quickMatch(cid, acc);
    }
    return game.negotiationView(cid, acc, id);
  }

  it("Transfer-Zentrale, zweistufige Verhandlung mit Raten und Weiterverkaufsbeteiligung", async () => {
    const { account } = await register(`markt${Date.now()}@example.com`, "geheim123", "Markt");
    acc = account.id;
    const preview = previewClubs(99, "GER");
    cid = await createCareer(acc, { managerName: "Markt", countryCode: "GER", clubIndex: preview[0].clubs[3].index, seed: 99 });
    const hub = await game.transferHub(cid, acc);
    expect(hub.window.open).toBe(true);
    expect(hub.window.daysLeft).toBeGreaterThan(10);
    expect(hub.budget.transfer).toBeGreaterThan(0);
    expect(hub.budget.wage).toBeGreaterThanOrEqual(hub.budget.wageBill);

    const m = await marketView(cid, acc, { sort: "rating", maxValue: Math.round(hub.budget.transfer / 3) });
    const target = m.players.find((p) => p.clubId !== null && !p.loan && p.value > 200_000)!;
    expect(target.stars?.current).toBeGreaterThan(0);
    const detail = await game.playerDetail(cid, acc, target.id);
    const ask = detail.askingPrice!;

    const low = await game.startNegotiation(cid, acc, { playerId: target.id, offer: { fee: Math.round(ask * 0.3), upfrontPct: 100, installmentYears: 0, sellOn: 0 } });
    await expect(game.startNegotiation(cid, acc, { playerId: target.id, offer: { fee: ask, upfrontPct: 100, installmentYears: 0, sellOn: 0 } })).rejects.toThrow(/läuft bereits/);
    expect((await game.negotiationView(cid, acc, low.id)).status).toBe("pending");
    let v = await untilAnswered(low.id);
    expect(["rejected", "countered"]).toContain(v.status);
    const msg = await pool().query("select sender, blocks from inbox where career_id = $1 and kind = 'negotiation' order by id desc limit 1", [cid]);
    expect(msg.rows[0].sender.kind).toBe("club");
    expect((await game.playerDetail(cid, acc, target.id)).negotiation?.id).toBe(low.id);

    await game.reviseClubOffer(cid, acc, low.id, { fee: Math.round(ask * 1.5), upfrontPct: 50, installmentYears: 2, sellOn: 10 });
    v = await untilAnswered(low.id);
    if (v.status === "countered") {
      await game.acceptClubCounter(cid, acc, low.id);
      v = await game.negotiationView(cid, acc, low.id);
    }
    expect(v.stage).toBe("contract");
    expect(v.demand!.wage).toBeGreaterThan(0);

    const d = v.demand!;
    const lowball = await game.offerContract(cid, acc, low.id, { ...d, wage: Math.round(d.wage * 0.85) });
    expect(lowball.status).toBe("countered");
    v = await game.negotiationView(cid, acc, low.id);
    expect(v.patience).toBe(2);
    const before = await game.transferHub(cid, acc);
    const done = await game.offerContract(cid, acc, low.id, { ...v.demand! });
    expect(done.status).toBe("completed");

    const p = (await pool().query("select data, club_id from players where career_id = $1 and id = $2", [cid, target.id])).rows[0];
    const own = (await game.dashboard(cid, acc)).career.clubId;
    expect(p.club_id).toBe(own);
    expect(p.data.sellOn.pct).toBe(10);
    expect(p.data.squadStatus).toBe(v.demand!.role);
    const pays = await pool().query("select amount, due_season from transfer_payments where career_id = $1 order by due_season", [cid]);
    expect(pays.rows.length).toBe(2);
    const fee = (await game.negotiationView(cid, acc, low.id)).offer!.fee;
    const rest = pays.rows.reduce((n: number, r: { amount: string }) => n + Number(r.amount), 0);
    expect(Math.abs(rest - fee * 0.5)).toBeLessThan(fee * 0.01);
    const after = await game.transferHub(cid, acc);
    expect(after.budget.balance).toBeLessThan(before.budget.balance);
    expect(after.installments.length).toBe(2);
    expect(after.negotiations.find((n) => n.id === low.id)?.stage).toBe("done");

    // Raten zum Saisonstart
    const career = await game.readCareer(cid, acc);
    const balance0 = after.budget.balance;
    career.season += 1;
    await neg.paymentsSeasonStart(pool(), career);
    const club = (await pool().query("select balance from clubs where career_id = $1 and id = $2", [cid, own])).rows[0];
    expect(Number(club.balance)).toBe(balance0 - Number(pays.rows[0].amount));
    expect((await game.transferHub(cid, acc)).installments.length).toBe(1);

    // Weiterverkauf: Ex-Verein erhält seinen Anteil
    const buyer = (await pool().query("select id from clubs where career_id = $1 and id <> $2 and id <> $3 order by reputation desc limit 1", [cid, own, target.clubId])).rows[0].id;
    const t = await pool().query("insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, kind, status, season, week) values ($1,$2,'x',$3,$4,10000000,'offer_in','pending',$5,0) returning id", [cid, target.id, own, buyer, career.season - 1]);
    const ex0 = Number((await pool().query("select balance from clubs where career_id = $1 and id = $2", [cid, target.clubId])).rows[0].balance);
    const sold = await game.respondToOffer(cid, acc, t.rows[0].id, "accept");
    expect(sold.message).toMatch(/Weiterverkaufsbeteiligung/);
    const ex1 = Number((await pool().query("select balance from clubs where career_id = $1 and id = $2", [cid, target.clubId])).rows[0].balance);
    expect(ex1 - ex0).toBe(1_000_000);
  }, 120_000);

  it("Vereinslose Spieler, Budget umschichten, Abbruch", async () => {
    const m = await marketView(cid, acc, { freeOnly: true, sort: "rating" });
    const free = m.players[0];
    const r = await game.startNegotiation(cid, acc, { playerId: free.id, offer: { fee: 0, upfrontPct: 100, installmentYears: 0, sellOn: 0 } });
    const v = await game.negotiationView(cid, acc, r.id);
    expect(v.stage).toBe("contract");
    expect(v.from).toBeNull();
    const w = await game.withdrawNegotiation(cid, acc, r.id);
    expect(w.message).toMatch(/abgebrochen/);
    await expect(game.offerContract(cid, acc, r.id, v.demand!)).rejects.toThrow();

    const hub = await game.transferHub(cid, acc);
    const res = await game.setWageBudget(cid, acc, hub.budget.wage + 1000);
    expect(res.transferBudget).toBe(hub.budget.transfer - (res.wageBudget - hub.budget.wage) * hub.budget.ratio);
    expect(res.wageBudget).toBeGreaterThan(hub.budget.wage + 900);
    await expect(game.setWageBudget(cid, acc, Math.round(hub.budget.wageBill * 0.5))).rejects.toThrow(/Gehaltsbudget/);
    const m2 = await marketView(cid, acc, { expiring: true, sort: "contract" });
    expect(m2.players.every((p) => (p.contract?.untilSeason ?? 0) <= m2.career.season)).toBe(true);
  }, 60_000);
});
