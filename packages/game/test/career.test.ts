/**
 * Integrationstest gegen PostgreSQL: Account, Karriere, eine komplette Saison.
 * Benötigt TEST_DATABASE_URL (oder lokale Standard-DB football_legacy_test).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://fl:fl@localhost:5432/football_legacy_test";

const game = await import("../src/index");
const { pool, migrate, register, createCareer, previewClubs, advance, quickMatch, dashboard, startMatch, stepMatch,
  squadView, saveTactic, tacticView, marketView, makeOffer, competitionView, careerView, financeView, leaderboards, cupView, reviewView, pressConference, answerPress, loanIn, loanOut } = game;

let accountId = "";
let careerId = "";
const loans: { inId?: number; outId?: number; parentId?: number } = {};

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

  it("Leihgeschäfte: ausleihen und verleihen", async () => {
    const d = await dashboard(careerId, accountId);
    const userClub = d.career.clubId!;
    const { rows } = await pool().query(
      "select p.id, p.club_id from players p join clubs c on c.id = p.club_id where p.career_id = $1 and c.league_id = $2 and c.id <> $3 and p.age <= 21 and (p.data->'contract'->>'untilSeason')::int > 2026 order by p.rating asc limit 1",
      [careerId, d.league!.id, userClub]);
    const r = await loanIn(careerId, accountId, rows[0].id, 0.1);
    expect(r.status).toBe("countered");
    const ok = await loanIn(careerId, accountId, rows[0].id, 1);
    expect(ok.status).toBe("completed");
    loans.inId = rows[0].id;
    loans.parentId = rows[0].club_id;
    const squad = await squadView(careerId, accountId);
    const lp = squad.players.find((p) => p.id === loans.inId)!;
    expect(lp.loan?.parentClubId).toBe(loans.parentId);
    const fringe = [...squad.players].filter((p) => !p.loan).sort((a, b) => (a.rating ?? 0) - (b.rating ?? 0))[0];
    const out = await loanOut(careerId, accountId, fringe.id);
    if (out.status === "completed") {
      loans.outId = fringe.id;
      const after = await squadView(careerId, accountId);
      expect((after.loanedOut ?? []).map((p) => p.id)).toContain(fringe.id);
    }
    await expect(game.releasePlayer(careerId, accountId, loans.inId!)).rejects.toThrow(/Leihspieler/);
  });

  it("Pressekonferenz vor dem Spiel", async () => {
    const p = await pressConference(careerId, accountId);
    expect(p.available).toBe(true);
    expect(p.questions.length).toBeGreaterThan(0);
    const answers = Object.fromEntries(p.questions.map((q) => [q.id, q.answers[0].i]));
    const r = await answerPress(careerId, accountId, answers);
    expect(Array.isArray(r.effects)).toBe(true);
    await expect(answerPress(careerId, accountId, answers)).rejects.toThrow(/bereits/);
    expect((await pressConference(careerId, accountId)).done).toBe(true);
  });

  it("spielt ein Spiel in Abschnitten mit Live-Eingriffen", async () => {
    const a = await advance(careerId, accountId);
    expect(a.kind).toBe("match");
    const first = await startMatch(careerId, accountId);
    expect(first.frames.length).toBe(31);
    // Live-Wechsel in der 1. Halbzeit
    const bench = first.teams[first.side].players.find((p) => p.slot === -1)!;
    const s1 = await stepMatch(careerId, accountId, { change: { style: { pressing: 80 }, subs: [{ slot: 10, playerId: bench.id }] } });
    expect(s1.fromTick).toBe(30);
    expect(s1.frames.length).toBe(30);
    expect(s1.events.some((e) => e.type === "sub" && e.playerId === bench.id)).toBe(true);
    // Bis zur Halbzeit: Simulation stoppt bei Tick 270
    const ht = await stepMatch(careerId, accountId, { until: 999 });
    expect(ht.tick).toBe(270);
    expect(ht.done).toBe(false);
    // Neu laden mitten im Spiel
    const resumed = await startMatch(careerId, accountId);
    expect(resumed.fromTick).toBe(270);
    expect(resumed.frames.length).toBe(1);
    const end = await stepMatch(careerId, accountId, { change: { style: { risk: 80 } }, until: 540 });
    expect(end.done).toBe(true);
    if (!end.done) return;
    expect(end.summary.week).toBe(1);
    expect(end.summary.results.length).toBe(6);
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
    const cup = await cupView(careerId, accountId, 2026);
    expect(cup.cup?.winner).toBeTruthy();
    expect(cup.rounds[cup.rounds.length - 1].name).toBe("Finale");
    expect(cup.rounds.every((r) => r.matches.every((m) => m.played))).toBe(true);
    const next = await cupView(careerId, accountId);
    expect(next.rounds[0].matches.length).toBeGreaterThan(0);
    const rv = await reviewView(careerId, accountId);
    expect(rv.seasons).toEqual([2026]);
    expect(rv.review?.awards.find((a) => a.key === "scorer")?.entry?.value).toMatch(/Tore/);
    expect(rv.review?.teamOfSeason.length).toBe(11);
    expect(rv.review?.table.length).toBeGreaterThan(5);
    // Leihen sind zum Saisonende ausgelaufen
    const back = await pool().query("select id, club_id, data->'loan' as loan from players where career_id = $1 and id = any($2::int[])", [careerId, [loans.inId, loans.outId].filter(Boolean)]);
    for (const row of back.rows) expect(row.loan).toBeNull();
    expect(back.rows.find((r) => r.id === loans.inId)?.club_id).toBe(loans.parentId);
    if (loans.outId) expect(back.rows.find((r) => r.id === loans.outId)?.club_id).toBe(d.career.clubId);
    const lb = await leaderboards();
    expect(lb.best.length).toBe(1);
  }, 240_000);
});
