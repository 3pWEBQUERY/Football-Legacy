/** Integrationstest – Paket G: KI-Taktik, Trainerphilosophien, Kaderpflege und Konkurrenzangebote. */
import { describe, expect, it } from "vitest";
import { Rng, squadRanks } from "@fl/sim";
import { game, pool, shared } from "../context";
import { aiContext, aiMentalityShift, aiTactic, restedPlayers } from "../../src/setup";
import { applyPhilosophy, philosophyFor, philosophyLabel } from "../../src/philosophy";
import { aiSquadWeek } from "../../src/ai-squads";
import { rivalDaily } from "../../src/negotiations/rival";
import { getCareer, getClub, getPlayers } from "../../src/repo";
import { loadWorld, squadOf } from "../../src/world-state";
import type { NegRow } from "../../src/negotiations/core";

describe("Paket G", () => {
  it("KI-Taktik: gegen Favoriten defensiver, Rotation schont müde Stammkräfte", async () => {
    const { cid } = shared.sponsorCareer!;
    const career = (await getCareer(pool(), cid))!;
    const club = (await pool().query("select id from clubs where career_id = $1 and players_generated and id <> $2 limit 1", [cid, career.club_id])).rows[0];
    const ai = (await getClub(pool(), cid, club.id))!;
    const squad = await getPlayers(pool(), cid, [ai.id]);
    expect(aiMentalityShift(70, 82)).toBe(-2);
    expect(aiMentalityShift(70, 60)).toBe(1);
    const base = aiTactic(ai, squad).mentality ?? 0;
    expect(aiTactic(ai, squad, { opponentRating: ai.rating + 12 }).mentality).toBe(Math.max(-3, base - 2));
    // Rotation: die besten Feldspieler sind angeschlagen und sitzen auf der Bank
    const stars = squad.filter((p) => p.position !== "GK").sort((a, b) => b.rating - a.rating).slice(0, 3);
    const tired = squad.map((p) => ({ ...p, injuryWeeks: 0, suspendedWeeks: 0, fitness: stars.includes(p) ? 90 : 100 }));
    const rested = restedPlayers(tired, "cup");
    expect(stars.every((p) => rested.has(p.id))).toBe(true);
    const t = aiTactic(ai, tired, { rotate: "cup" });
    expect(stars.some((p) => t.lineup.includes(p.id))).toBe(false);
    expect(stars.some((p) => t.bench.includes(p.id))).toBe(true);
    // Pokal gegen Gleichstarke: keine Rotation
    expect(aiContext(ai, ai, true, 19).rotate).toBe(false);
  });

  it("Trainerphilosophie: neuer Trainer stellt Formation und Stil um", async () => {
    const { cid } = shared.sponsorCareer!;
    const career = (await getCareer(pool(), cid))!;
    const ph = philosophyFor(career.seed, 5, 3, 0.9);
    expect(philosophyFor(career.seed, 5, 3, 0.9)).toEqual(ph);
    const club = (await pool().query("select id from clubs where career_id = $1 and players_generated and id <> $2 offset 2 limit 1", [cid, career.club_id])).rows[0];
    const t = await applyPhilosophy(pool(), career, club.id, { preset: "park_bus", formation: "5-3-2" });
    expect(t?.formation).toBe("5-3-2");
    const after = (await getClub(pool(), cid, club.id))!;
    expect(philosophyLabel(after.tactic?.style)).toBe("Mauern");
    const view = await game.clubView(cid, shared.sponsorCareer!.acc, club.id);
    expect(view.coach?.idea).toBe("Mauern");
  });

  it("Kaderpflege: KI-Vereine setzen Ergänzungsspieler auf die Liste und verleihen Talente", async () => {
    const { cid } = shared.sponsorCareer!;
    const career = (await getCareer(pool(), cid))!;
    const w = await loadWorld(pool(), career);
    const rng = new Rng(7);
    for (let i = 0; i < 8; i++) aiSquadWeek(w, rng, true);
    const ai = [...w.clubs.values()].filter((c) => c.players_generated && c.id !== career.club_id);
    // Ergänzungsspieler (ab Kaderrang 21, mindestens 22 Jahre) kommen mit 25 % pro Woche auf die Liste:
    // nach 8 Wochen also rund 90 % – unabhängig davon, wie gross die Kader gerade sind
    let surplus = 0;
    let listed = 0;
    for (const c of ai) {
      const squad = squadOf(w, c.id).filter((p) => !p.loan);
      const ranks = squadRanks(squad);
      for (const p of squad) {
        if ((ranks.get(p.id) ?? 0) <= 20 || p.age < 22) continue;
        surplus++;
        if (p.listed) listed++;
      }
    }
    const loans = [...w.players.values()].filter((p) => p.loan && p.loan.parentClubId !== career.club_id && p.clubId !== career.club_id).length;
    expect(surplus).toBeGreaterThan(ai.length / 2);
    expect(listed / surplus).toBeGreaterThan(0.75);
    expect(loans).toBeGreaterThan(0);
  });

  it("Konkurrenzangebot: Forderung steigt, nach Ablauf der Frist unterschreibt der Spieler woanders", async () => {
    const { cid, acc } = shared.sponsorCareer!;
    const free = (await pool().query("select id from players where career_id = $1 and club_id is null and rating >= 60 and data->'loan' is null order by rating desc limit 1", [cid])).rows[0];
    const r = await game.startNegotiation(cid, acc, { playerId: free.id, offer: { fee: 0, upfrontPct: 100, installmentYears: 0, sellOn: 0 } });
    expect(r.stage).toBe("contract");
    const career = (await getCareer(pool(), cid))!;
    const row = async () => (await pool().query("select * from negotiations where id = $1", [r.id])).rows[0] as NegRow;
    const before = (await row()).demand!.wage;
    for (let d = 1; d <= 120 && !(await row()).rival; d++) {
      await rivalDaily(pool(), { ...career, day: career.day + d }, await row());
    }
    const n = await row();
    expect(n.rival).toBeTruthy();
    expect(n.demand!.wage).toBeGreaterThan(before);
    expect((await game.negotiationView(cid, acc, r.id)).rival).toBeTruthy();
    // Frist verstreicht
    await rivalDaily(pool(), { ...career, day: n.rival!.until + 1 }, n);
    const done = await row();
    expect(done.stage).toBe("failed");
    const p = (await pool().query("select club_id from players where career_id = $1 and id = $2", [cid, free.id])).rows[0];
    expect(p.club_id).toBe(n.rival!.clubId);
    const inbox = (await pool().query("select kind from inbox where career_id = $1 and kind like 'rival%'", [cid])).rows.map((x) => x.kind);
    expect(inbox).toEqual(expect.arrayContaining(["rival_offer", "rival_lost"]));
  });
});
