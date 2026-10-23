/**
 * Integrationstest gegen PostgreSQL: Account, Karriere, eine komplette Saison.
 * Benötigt TEST_DATABASE_URL (oder lokale Standard-DB football_legacy_test).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://fl:fl@localhost:5432/football_legacy_test";

const game = await import("../src/index");
const { pool, migrate, register, createCareer, previewClubs, advance, quickMatch, dashboard, startMatch, continueMatch,
  squadView, saveTactic, tacticView, marketView, makeOffer, competitionView, careerView, financeView, leaderboards } = game;

let accountId = "";
let careerId = "";

beforeAll(async () => {
  await pool().query("drop schema public cascade; create schema public;");
  await migrate();
  const { account } = await register(`test${Date.now()}@example.com`, "geheim123", "Tester");
  accountId = account.id;
}, 60_000);

afterAll(async () => {
  await pool().end();
});

describe("Karriere", () => {
  it("legt eine Karriere mit ganzer Welt an", async () => {
    const preview = previewClubs(4711, "SUI");
    expect(preview.length).toBe(2);
    const t0 = Date.now();
    careerId = await createCareer(accountId, { managerName: "Testmanager", countryCode: "SUI", clubIndex: preview[0].clubs[5].index, seed: 4711 });
    console.log(`Karriere angelegt in ${Date.now() - t0} ms`);
    const d = await dashboard(careerId, accountId);
    expect(d.club?.name).toBe(preview[0].clubs[5].name);
    expect(d.career.week).toBe(0);
    expect(d.inbox.length).toBeGreaterThan(0);
    const leagues = await pool().query("select count(*)::int as n from leagues where career_id = $1", [careerId]);
    expect(leagues.rows[0].n).toBeGreaterThan(150);
  }, 60_000);

  it("Taktik speichern und Kader lesen", async () => {
    const t = await tacticView(careerId, accountId);
    expect(t.tactic.lineup.filter((x) => x !== null).length).toBe(11);
    const res = await saveTactic(careerId, accountId, { ...t.tactic, formation: "4-3-3", style: { ...t.tactic.style, pressing: 70 } });
    expect(res.tactic.formation).toBe("4-3-3");
    const s = await squadView(careerId, accountId);
    expect(s.players.length).toBe(25);
  });

  it("Transfermarkt und Angebot", async () => {
    const m = await marketView(careerId, accountId, { sort: "rating" });
    expect(m.players.length).toBeGreaterThan(10);
    const target = m.players.find((p) => p.clubId === null) ?? m.players[m.players.length - 1];
    const out = await makeOffer(careerId, accountId, { playerId: target.id, fee: 0, wage: 1000, years: 2 });
    expect(["completed", "countered", "rejected"]).toContain(out.status);
  });

  it("spielt ein Spiel mit Halbzeit-Änderungen", async () => {
    const a = await advance(careerId, accountId);
    expect(a.kind).toBe("match");
    const first = await startMatch(careerId, accountId);
    expect(first.frames.length).toBe(271);
    const bench = first.teams[first.side].players.find((p) => p.slot === -1)!;
    const second = await continueMatch(careerId, accountId, { style: { risk: 80 }, subs: [{ slot: 10, playerId: bench.id }] });
    expect(second.frames.length).toBe(270);
    expect(second.summary.week).toBe(1);
    expect(second.summary.results.length).toBe(6);
  }, 60_000);

  it("spielt die komplette Saison bis zum Saisonwechsel", async () => {
    const t0 = Date.now();
    let seasonEnd = null;
    for (let i = 0; i < 40 && !seasonEnd; i++) {
      const a = await advance(careerId, accountId);
      const summary = a.kind === "match" ? await quickMatch(careerId, accountId) : a.summary;
      seasonEnd = summary.seasonEnd;
    }
    console.log(`Saison in ${Date.now() - t0} ms`, seasonEnd);
    expect(seasonEnd).not.toBeNull();
    const d = await dashboard(careerId, accountId);
    expect(d.career.season).toBe(2027);
    expect(d.career.week).toBe(0);
    const c = await competitionView(careerId, accountId);
    expect(c.table.length).toBeGreaterThan(0);
    expect(c.table.every((r) => r.played === 0)).toBe(true);
    const cv = await careerView(careerId, accountId);
    expect(cv.history.length).toBe(1);
    expect(cv.career.xp).toBeGreaterThan(0);
    const f = await financeView(careerId, accountId);
    expect(f.recent.length).toBeGreaterThan(0);
    const lb = await leaderboards();
    expect(lb.best.length).toBe(1);
  }, 240_000);
});
