/** Integrationstest – Paket F: Spielbedingungen, Vorverträge, U19-Spiele, Mannschaftsrat. */
import { describe, expect, it } from "vitest";
import { game, pool, shared } from "../context";
import { aiPrecontracts, applyPrecontract, precontractOpen } from "../../src/negotiations/precontract";
import { getCareer } from "../../src/repo";
import { loadWorld, squadOf } from "../../src/world-state";

/** Erster Tag nach Neujahr im Kalender der Karriere. */
async function januaryDay(cid: string) {
  const c = (await getCareer(pool(), cid))!;
  let day = c.day;
  while (!precontractOpen(c, day)) day++;
  return { career: c, day };
}

describe("Paket F", () => {
  it("Spielbedingungen: Vorschau zeigt Wetter und Schiedsrichter", async () => {
    const { cid, acc } = shared.sponsorCareer!;
    const preview = (await game.dashboard(cid, acc)).next;
    if (!preview) return;
    expect(preview.conditions?.weatherLabel).toBeTruthy();
    expect(preview.conditions?.referee).toBeTruthy();
    expect(["streng", "normal", "grosszügig"]).toContain(preview.conditions?.refereeStyle);
  });

  it("Vorverträge: ab 1. Januar mit Spielern im letzten Vertragsjahr, Wechsel zum Sommer", async () => {
    const { cid, acc } = shared.sponsorCareer!;
    const { career, day } = await januaryDay(cid);
    // Kandidat: Ergänzungsspieler eines anderen Vereins im letzten Vertragsjahr
    const row = (await pool().query(
      `select p.id from players p join clubs c on c.career_id = p.career_id and c.id = p.club_id
        where p.career_id = $1 and p.club_id <> $2 and c.league_id = (select league_id from clubs where career_id = $1 and id = $2)
          and p.data->'loan' is null order by p.rating asc limit 1 offset 3`, [cid, career.club_id])).rows[0];
    await pool().query("update players set data = jsonb_set(data, '{contract,untilSeason}', to_jsonb($3::int)) where career_id = $1 and id = $2", [cid, row.id, career.season]);
    await expect(game.startPrecontract(cid, acc, row.id)).rejects.toThrow(/1\. Januar/);
    await pool().query("update careers set day = $2 where id = $1", [cid, day]);
    try {
      const r = await game.startPrecontract(cid, acc, row.id);
      expect(r.stage).toBe("contract");
      const n = await game.negotiationView(cid, acc, r.id);
      const before = (await pool().query("select transfer_budget from clubs where career_id = $1 and id = $2", [cid, career.club_id])).rows[0].transfer_budget;
      const res = await game.offerContract(cid, acc, r.id, { ...n.demand!, wage: Math.round(n.demand!.wage * 1.1) });
      expect(res.status).toBe("completed");
      const p = (await pool().query("select club_id, data from players where career_id = $1 and id = $2", [cid, row.id])).rows[0];
      expect(p.club_id).not.toBe(career.club_id); // erst im Sommer
      expect(p.data.precontract.clubId).toBe(career.club_id);
      const after = (await pool().query("select transfer_budget from clubs where career_id = $1 and id = $2", [cid, career.club_id])).rows[0].transfer_budget;
      expect(Number(after)).toBeLessThan(Number(before)); // Handgeld und Beraterhonorar
      await expect(game.startPrecontract(cid, acc, row.id)).rejects.toThrow(/bereits/);
      // Saisonwechsel: der Spieler zieht um, mit dem vereinbarten Vertrag
      const c = (await getCareer(pool(), cid))!;
      const w = await loadWorld(pool(), c);
      const wp = w.players.get(row.id)!;
      expect(applyPrecontract(w, wp, c, c.season + 1)).toMatch(/kommt von/);
      expect(wp.clubId).toBe(career.club_id);
      expect(wp.contract!.untilSeason).toBe(c.season + n.demand!.years);
      expect(wp.precontract).toBeNull();
    } finally {
      await pool().query("update careers set day = $2 where id = $1", [cid, career.day]);
    }
  });

  it("Vorverträge: KI-Vereine werben auslaufende Spieler ab, die Sportdirektion warnt", async () => {
    const { cid } = shared.sponsorCareer!;
    const { career, day } = await januaryDay(cid);
    const w = await loadWorld(pool(), career);
    const squad = squadOf(w, career.club_id!);
    for (const p of squad) if (p.contract) p.contract.untilSeason = career.season;
    let lost: string[] = [];
    for (let d = day; d < day + 120 && !lost.length; d += 7) {
      career.day = d;
      lost = await aiPrecontracts(pool(), career, w);
    }
    expect(lost.length).toBeGreaterThan(0);
    const gone = squad.find((p) => p.precontract);
    expect(gone?.precontract?.clubId).not.toBe(career.club_id);
    const kinds = (await pool().query("select kind from inbox where career_id = $1 and kind like 'precontract%'", [cid])).rows.map((r) => r.kind);
    expect(kinds).toContain("precontract_open");
    expect(kinds).toContain("precontract_lost");
  });

  it("U19-Liga: Akademie wird aufgefüllt, spielt Runden mit Tabelle, Torschützen und Einsatzminuten", async () => {
    const { cid, acc } = shared.sponsorCareer!;
    let played = 0;
    for (let i = 0; i < 80 && played < 3; i++) {
      const a = await game.advance(cid, acc);
      if (a.kind === "match") { await game.quickMatch(cid, acc); played++; }
    }
    const v = await game.academyView(cid, acc);
    expect(v.players.length).toBeGreaterThanOrEqual(16);
    expect(v.u19).not.toBeNull();
    expect(v.u19!.round).toBeGreaterThanOrEqual(2);
    const own = v.u19!.table.find((r) => r.clubId === v.career.clubId)!;
    expect(own.played).toBe(v.u19!.round);
    expect(v.u19!.table.reduce((n, r) => n + r.played, 0) % 2).toBe(0);
    expect(v.players.some((p) => p.apps > 0)).toBe(true);
    expect(Object.values(v.u19!.minutes).some((m) => m >= 90)).toBe(true);
  }, 180_000);

  it("Mannschaftsrat: fünf Mitglieder mit Kapitän, monatliche Sitzung, Antwort wirkt auf die Moral", async () => {
    const { cid, acc } = shared.sponsorCareer!;
    let c = await game.councilFor(cid, acc);
    for (let i = 0; i < 60 && !c?.pending; i++) {
      const a = await game.advance(cid, acc);
      if (a.kind === "match") await game.quickMatch(cid, acc);
      c = await game.councilFor(cid, acc);
    }
    expect(c!.members).toHaveLength(5);
    expect(c!.members.filter((m) => m.captain)).toHaveLength(1);
    const pending = c!.pending!;
    expect(pending.options.length).toBeGreaterThan(0);
    const inbox = (await pool().query("select 1 from inbox where career_id = $1 and kind = 'council'", [cid])).rowCount;
    expect(inbox).toBeGreaterThan(0);
    const r = await game.answerCouncil(cid, acc, pending.options[0].key);
    expect(r.message).toBeTruthy();
    const after = await game.councilFor(cid, acc);
    expect(after!.pending).toBeNull();
    expect(after!.history[0].choice).toBe(pending.options[0].label);
    await expect(game.answerCouncil(cid, acc, pending.options[0].key)).rejects.toThrow(/kein offenes Anliegen/);
    const dyn = await game.dynamicsView(cid, acc);
    expect(dyn.council.members).toHaveLength(5);
  }, 180_000);
});
