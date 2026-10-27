/** Integrationstest – Relegation, Derbys, Sponsoren, Kapitän und Gegneranweisungen. */
import { describe, expect, it } from "vitest";
import { derbySetup, ensureRivalries, rivalryBetween } from "../../src/rivals";
import { advance, createCareer, game, pool, previewClubs, quickMatch, register, shared } from "../context";

describe("Spieltiefe", () => {
  it("Relegation: Paarung aus der Tabelle, Sieger entscheidet über Auf- und Abstieg", async () => {
    const cup = (await pool().query("select id, groups from cups where career_id = $1 and season = 2026 and kind = 'playoff'", [shared.careerId])).rows[0];
    expect(cup).toBeTruthy();
    expect(cup.groups.length).toBeGreaterThan(0);
    for (const p of cup.groups) {
      expect([p.upperId, p.lowerId]).toContain(p.winnerId);
      const legs = await pool().query("select cup_round, home_id, played from fixtures where career_id = $1 and cup_id = $2 and group_no = $3 order by cup_round", [shared.careerId, cup.id, cup.groups.indexOf(p)]);
      expect(legs.rows.map((r) => r.played)).toEqual([true, true]);
      expect(legs.rows[0].home_id).toBe(p.lowerId);
      const seasons = await pool().query("select club_id, promoted, relegated from club_seasons where career_id = $1 and season = 2026 and club_id = any($2::int[])", [shared.careerId, [p.upperId, p.lowerId]]);
      const up = seasons.rows.find((r) => r.club_id === p.lowerId);
      const down = seasons.rows.find((r) => r.club_id === p.upperId);
      expect(up.promoted).toBe(p.winnerId === p.lowerId);
      expect(down.relegated).toBe(p.winnerId === p.lowerId);
    }
  });

  it("Derbys: Stadtderbys und Erzrivalen, mehr Härte im Spiel", async () => {
    await ensureRivalries(pool(), { id: shared.careerId });
    const kinds = await pool().query("select kind, count(*)::int as n from rivalries where career_id = $1 group by kind", [shared.careerId]);
    expect(kinds.rows.find((x) => x.kind === "rival")?.n).toBeGreaterThan(10);
    expect(kinds.rows.find((x) => x.kind === "derby")?.n).toBeGreaterThan(0);
    const r = await pool().query("select club_a, club_b, kind from rivalries where career_id = $1 limit 1", [shared.careerId]);
    const pair = r.rows[0];
    expect(await rivalryBetween(pool(), { id: shared.careerId }, pair.club_b, pair.club_a)).toBe(pair.kind);
    const t = { clubId: 1, name: "A", shortName: "A", colors: { primary: "#000", secondary: "#fff" }, players: [], tactic: { style: { hardness: 50 } } } as never;
    const s = derbySetup({ seed: 1, home: t, away: t }, "derby");
    expect(s.home.tactic.style.hardness).toBe(65);
    expect(s.homeAdvantage).toBeGreaterThan(1.06);
  });

  it("Sponsoren: drei Angebote, Wahl des Leistungsvertrags, Siegprämie", async () => {
    const acc = (await register(`sponsor${Date.now()}@example.com`, "geheim123", "Sponsor")).account.id;
    const preview = previewClubs(4711, "GER");
    const cid = await createCareer(acc, { managerName: "Sponsor", countryCode: "GER", clubIndex: preview[0].clubs[0].index, seed: 4711 });
    await advance(cid, acc);
    const v = await game.clubManagementView(cid, acc);
    expect(v.sponsor.offers.map((o) => o.kind)).toEqual(["fixed", "performance", "long"]);
    const perf = v.sponsor.offers[1];
    expect(perf.weekly).toBeLessThan(v.sponsor.offers[0].weekly);
    const r = await game.chooseSponsor(cid, acc, "performance");
    expect(r.deal?.kind).toBe("performance");
    await expect(game.chooseSponsor(cid, acc, "fixed")).rejects.toThrow(/läuft noch/);
    // Spiele bis zum ersten Sieg: die Prämie wird gebucht
    let bonus = 0;
    for (let i = 0; i < 400 && !bonus; i++) {
      const a = await advance(cid, acc);
      if (a.kind === "match") await quickMatch(cid, acc);
      bonus = (await pool().query("select count(*)::int as n from finance_log where career_id = $1 and kind = 'sponsor' and label like 'Prämie%'", [cid])).rows[0].n;
    }
    expect(bonus).toBeGreaterThan(0);
    const weekly = await pool().query("select amount from finance_log where career_id = $1 and kind = 'sponsor' and label not like 'Prämie%' order by id desc limit 1", [cid]);
    expect(Number(weekly.rows[0].amount)).toBeGreaterThan(0);
    shared.sponsorCareer = { cid, acc };
  }, 180_000);

  it("Taktik: Kapitän und Gegneranweisungen werden gespeichert, Anführer und Gegner angezeigt", async () => {
    const { cid, acc } = shared.sponsorCareer!;
    const view = await game.tacticView(cid, acc);
    expect(view.leaders.length).toBeGreaterThan(3);
    expect(view.opponent?.players.length).toBeGreaterThan(5);
    const opp = view.opponent!;
    const items = opp.players.slice(0, 4).map((p, i) => ({ playerId: p.id, kind: (["tight", "hard", "weakfoot", "bogus"] as const)[i] }));
    const saved = await game.saveTactic(cid, acc, {
      ...view.tactic, captain: view.leaders[0].id, viceCaptain: view.leaders[0].id,
      opposition: { clubId: opp.club.id, items: items as never },
    });
    expect(saved.tactic.captain).toBe(view.leaders[0].id);
    expect(saved.tactic.viceCaptain).toBeNull();
    expect(saved.tactic.opposition?.items.map((x) => x.kind)).toEqual(["tight", "hard", "weakfoot"]);
  });
});
