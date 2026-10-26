/** Integrationstest – Vereinsgeschichte, Rekorde, Ruhmeshalle und Vorstandsvision (nach der ersten Saison). */
import { describe, expect, it } from "vitest";
import { reviewVision, type Vision } from "../../src/history";
import { game, pool, shared } from "../context";

describe("Vereinsgeschichte und Ruhmeshalle", () => {
  it("Saisonende archiviert alle Vereine und die Spielerbilanzen", async () => {
    const cs = await pool().query("select count(*)::int as n, count(*) filter (where champion)::int as champs, count(*) filter (where user_managed)::int as own from club_seasons where career_id = $1 and season = 2026", [shared.careerId]);
    expect(cs.rows[0].n).toBeGreaterThan(30);
    expect(cs.rows[0].champs).toBeGreaterThan(1);
    expect(cs.rows[0].own).toBe(1);
    const pc = await pool().query("select count(*)::int as n, max(apps)::int as apps, count(*) filter (where retired_season = 2026)::int as retired from player_careers where career_id = $1", [shared.careerId]);
    expect(pc.rows[0].n).toBeGreaterThan(300);
    expect(pc.rows[0].apps).toBeGreaterThan(20);
    expect(pc.rows[0].retired).toBeGreaterThan(0);
  });

  it("Vereinsgeschichte: Saisons, Titel, Rekorde und Trainer", async () => {
    const own = (await pool().query("select club_id from club_seasons where career_id = $1 and season = 2026 and user_managed", [shared.careerId])).rows[0].club_id;
    const h = await game.clubHistoryView(shared.careerId, shared.accountId, own);
    expect(h.seasons.length).toBe(1);
    expect(h.seasons[0].played).toBeGreaterThan(10);
    expect(h.seasons[0].you).toBe(true);
    expect(h.coaches.some((c) => c.you && c.seasons === 1)).toBe(true);
    expect(h.records.apps[0].apps).toBeGreaterThan(10);
    expect(h.records.wins.length + h.records.losses.length).toBeGreaterThan(0);
    // Ein Meister hat den Titel im Trophäenschrank
    const champ = (await pool().query("select club_id, league_name from club_seasons where career_id = $1 and season = 2026 and champion and tier = 1 limit 1", [shared.careerId])).rows[0];
    const ch = await game.clubHistoryView(shared.careerId, shared.accountId, champ.club_id);
    expect(ch.honours.some((x) => x.kind === "league" && x.title.includes(champ.league_name))).toBe(true);
    expect(ch.summary.titles).toBe(1);
    expect(ch.coaches[0].current).toBe(true);
  });

  it("Ruhmeshalle: Vermächtnis, Stationen, Legenden und Rekordmeister", async () => {
    const hall = await game.hallOfFameView(shared.careerId, shared.accountId);
    expect(hall.manager.points).toBeGreaterThan(0);
    expect(hall.stations.length).toBeGreaterThanOrEqual(1);
    expect(hall.champions.length).toBeGreaterThan(1);
    expect(hall.active.length).toBe(10);
    expect(hall.farewells.season).toBe(2026);
    expect(hall.farewells.players.length).toBeGreaterThan(0);
  });

  it("Vorstandsvision: Dreijahresplan auf der Vorstandsseite", async () => {
    const d = await game.dashboard(shared.careerId, shared.accountId);
    if (!d.career.clubId) return;
    const b = await game.boardView(shared.careerId, shared.accountId);
    expect(b.vision).not.toBeNull();
    expect(b.vision!.goals.length).toBe(3);
    expect(b.vision!.endSeason - b.vision!.startSeason).toBe(2);
    expect(b.vision!.clubId).toBe(d.career.clubId);
  });

  it("Vorstandsvision: Bewertung pro Saison und Bilanz nach drei Jahren", () => {
    const v: Vision = {
      clubId: 1, startSeason: 2026, endSeason: 2028, headline: "Der Weg nach oben", reviews: [],
      goals: [
        { kind: "promotion", text: "Aufstieg", target: 1, current: 2, met: false },
        { kind: "youth", text: "Jugend", target: 3, current: 0, met: false },
        { kind: "finance", text: "Geld", target: 10_000_000, current: 5_000_000, met: false },
      ],
    };
    const base = { position: 5, champion: false, cup: null, reputation: 50 };
    const y1 = reviewVision(v, { ...base, season: 2026, nextTier: 2, youthRegulars: 3, balance: 6_000_000 });
    expect(y1.met).toBe(1);
    expect(y1.delta).toBe(4);
    const y2 = reviewVision(v, { ...base, season: 2027, nextTier: 1, youthRegulars: 1, balance: 8_000_000 });
    expect(y2.met).toBe(2);
    expect(y2.delta).toBe(4);
    const y3 = reviewVision(v, { ...base, season: 2028, nextTier: 1, youthRegulars: 0, balance: 12_000_000 });
    expect(y3.met).toBe(3);
    expect(y3.delta).toBe(10);
    expect(y3.text).toMatch(/vollständig/);
    expect(v.reviews.length).toBe(3);
    const fail: Vision = { ...v, reviews: [], goals: v.goals.map((g) => ({ ...g, current: g.kind === "promotion" ? 2 : 0, met: false })), startSeason: 2028 };
    expect(reviewVision(fail, { ...base, season: 2028, nextTier: 2, youthRegulars: 0, balance: 0 }).delta).toBe(-15);
  });
});
