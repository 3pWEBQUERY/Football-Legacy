/** Integrationstest – Einstieg (Schwierigkeitsgrad, Erste Schritte, Seitentipps) und Balancing-Grenzen. */
import { describe, expect, it } from "vitest";
import { boardDrift } from "../../src/week";
import { createCareer, game, pool, previewClubs, register, shared } from "../context";

describe("Einstieg und Balancing", () => {
  let acc = "";
  const make = async (difficulty: string) => {
    const preview = previewClubs(555, "GER");
    return createCareer(acc, { managerName: "Neu", countryCode: "GER", clubIndex: preview[0].clubs[6].index, seed: 555, difficulty });
  };
  // Kapital im Verhältnis zur Gehaltsliste (Kader unterscheiden sich je Karriere)
  const balanceOf = async (cid: string) => {
    const r = (await pool().query("select c.balance, (c.finance->>'baseWages')::float as wages from clubs c join careers k on k.club_id = c.id and k.id = c.career_id where k.id = $1", [cid])).rows[0];
    return Number(r.balance) / r.wages;
  };

  it("Schwierigkeitsgrad bestimmt das Startkapital", async () => {
    acc = (await register(`einstieg${Date.now()}@example.com`, "geheim123", "Einstieg")).account.id;
    const easy = await make("easy");
    shared.onboardingId = easy;
    const hard = await make("hard");
    const ratio = (await balanceOf(easy)) / (await balanceOf(hard));
    expect(ratio).toBeGreaterThan(1.75);
    expect(ratio).toBeLessThan(2.0);
    expect((await game.onboardingView(easy, acc)).difficulty.id).toBe("easy");
    expect((await game.careerView(hard, acc)).difficulty.label).toBe("Schwer");
  }, 60_000);

  it("Erste Schritte: Seitenbesuche zählen, Belohnung, Tipps und Ausblenden", async () => {
    const cid = shared.onboardingId;
    const v = await game.onboardingView(cid, acc);
    expect(v.total).toBe(8);
    expect(v.done).toBe(0);
    expect(v.active).toBe(true);
    expect(v.tourDone).toBe(false);
    const xp = (await game.readCareer(cid, acc)).manager.xp;
    const r = await game.onboardingAction(cid, acc, { action: "visit", page: "/board" });
    expect(r.steps.find((s) => s.id === "board")!.done).toBe(true);
    expect(r.fresh).toEqual(["Saisonziel kennenlernen"]);
    expect((await game.readCareer(cid, acc)).manager.xp).toBe(xp + r.reward.step);
    // Doppelter Besuch bringt nichts
    expect((await game.onboardingAction(cid, acc, { action: "visit", page: "/board" })).fresh).toEqual([]);
    await game.onboardingAction(cid, acc, { action: "tour" });
    await game.onboardingAction(cid, acc, { action: "tip", id: "tactic" });
    await expect(game.onboardingAction(cid, acc, { action: "tip", id: "<script>" })).rejects.toThrow(/Tipp/);
    const after = await game.onboardingView(cid, acc);
    expect(after.tourDone).toBe(true);
    expect(after.tips.tactic).toBe(true);
    expect((await game.onboardingAction(cid, acc, { action: "dismiss" })).active).toBe(false);
    const back = await game.onboardingAction(cid, acc, { action: "restore" });
    expect(back.active).toBe(true);
    expect(back.tips.tactic).toBeUndefined();
  });

  it("Alle Schritte erledigt: Abschlussbelohnung", async () => {
    const cid = shared.onboardingId;
    for (const page of ["/team", "/team/tactic", "/team/training", "/market/search", "/market/contracts"]) await game.onboardingAction(cid, acc, { action: "visit", page });
    // Ansprache und erstes Spiel ergeben sich aus dem Spielstand
    await pool().query("update careers set manager = jsonb_set(jsonb_set(manager, '{teamTalkDone}', '1'), '{totals,wins}', '1') where id = $1", [cid]);
    const points = (await game.readCareer(cid, acc)).manager.points;
    const r = await game.onboardingAction(cid, acc, { action: "visit", page: "/team" });
    expect(r.complete).toBe(true);
    expect(r.fresh).toContain("Alle ersten Schritte erledigt");
    expect((await game.readCareer(cid, acc)).manager.points).toBe(points + r.reward.points);
  });

  it("Vorstandsvertrauen folgt dem Tabellenplatz", () => {
    const career = { board: { confidence: 100, targetPosition: 10 }, manager: { difficulty: "normal" } } as never as Parameters<typeof boardDrift>[0];
    for (let i = 0; i < 60; i++) boardDrift(career, 15);
    expect(career.board.confidence).toBeGreaterThan(35);
    expect(career.board.confidence).toBeLessThan(40);
    for (let i = 0; i < 60; i++) boardDrift(career, 4);
    expect(career.board.confidence).toBeGreaterThan(88);
    const easy = { board: { confidence: 50, targetPosition: 10 }, manager: { difficulty: "easy" } } as never as Parameters<typeof boardDrift>[0];
    for (let i = 0; i < 60; i++) boardDrift(easy, 10);
    expect(easy.board.confidence).toBeGreaterThan(70);
  });

  it("Nach einer Saison: KI-Finanzen gesund, Kader begrenzt, höchstens eine gezogene Klausel", async () => {
    const cid = shared.careerId;
    const fin = await pool().query(`select count(*) filter (where balance < 0)::float / count(*) as debt from clubs where career_id = $1 and players_generated and id <> (select club_id from careers where id = $1)`, [cid]);
    expect(fin.rows[0].debt).toBeLessThan(0.1);
    const free = await pool().query("select count(*)::int as n from players where career_id = $1 and club_id is null", [cid]);
    const clubs = await pool().query("select count(*)::int as n from clubs where career_id = $1 and players_generated", [cid]);
    expect(free.rows[0].n).toBeLessThanOrEqual(Math.max(150, clubs.rows[0].n * 2) + 80);
    const clauses = await pool().query("select season, count(*)::int as n from negotiations where career_id = $1 and kind = 'sell' and log->0->>'text' like 'Ausstiegsklausel%' group by season", [cid]);
    for (const r of clauses.rows) expect(r.n).toBeLessThanOrEqual(1);
    const profile = await pool().query("select finance from clubs where career_id = $1 and players_generated and finance is not null limit 1", [cid]);
    expect(profile.rows[0].finance.baseWages).toBeGreaterThan(0);
  });
});
