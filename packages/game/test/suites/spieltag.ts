/** Integrationstest – Spieltag: Zurufe, Halbzeitansprache, Schlussansprache, Spielbericht mit Schüssen. */
import { describe, expect, it } from "vitest";
import { advance, createCareer, game, pool, previewClubs, register, startMatch, stepMatch } from "../context";

describe("Spieltag an der Seitenlinie", () => {
  it("Zuruf, Halbzeitansprache und Schlussansprache wirken; der Bericht enthält alle Schüsse", async () => {
    const { account } = await register(`spieltag${Date.now()}@example.com`, "geheim123", "Spieltag");
    const acc = account.id;
    const preview = previewClubs(555, "GER");
    const cid = await createCareer(acc, { managerName: "Spieltag", countryCode: "GER", clubIndex: preview[0].clubs[4].index, seed: 555 });
    for (let i = 0; i < 120; i++) { const r = await advance(cid, acc); if (r.kind === "match") break; }
    await startMatch(cid, acc);
    await stepMatch(cid, acc, { until: 60 });
    const sh = await game.matchShout(cid, acc, "encourage");
    expect(sh.ok).toBe(true);
    expect(sh.events.some((e: { text: string }) => e.text.includes("Ermutigen"))).toBe(true);
    await expect(game.matchShout(cid, acc, "praise")).rejects.toThrow(/Moment/);
    await expect(game.halftimeAddress(cid, acc, "calm")).rejects.toThrow(/Pause/);
    let r = await stepMatch(cid, acc, { until: 270 });
    expect(r.tick).toBe(270);
    const ht = await game.halftimeAddress(cid, acc, "encourage");
    expect(ht.ok).toBe(true);
    await expect(game.halftimeAddress(cid, acc, "praise")).rejects.toThrow(/bereits/);
    r = await stepMatch(cid, acc, { until: 540 });
    expect(r.done).toBe(true);

    const career = await game.readCareer(cid, acc);
    const st = await game.postMatchState(pool(), career);
    expect(st).not.toBeNull();
    const before = (await pool().query("select avg((data->>'morale')::int) as m from players where career_id = $1 and club_id = $2", [cid, career.club_id])).rows[0].m;
    const talk = await game.postMatchTalk(cid, acc, "praise");
    expect(talk.players).toBeGreaterThanOrEqual(11);
    const after = (await pool().query("select avg((data->>'morale')::int) as m from players where career_id = $1 and club_id = $2", [cid, career.club_id])).rows[0].m;
    expect(Number(after)).not.toBe(Number(before));
    await expect(game.postMatchTalk(cid, acc, "angry")).rejects.toThrow(/keine Schlussansprache/);

    const report = (await pool().query("select data from match_reports where fixture_id = $1", [st!.fixtureId])).rows[0].data;
    expect(report.shots.length).toBe(report.stats[0].shots + report.stats[1].shots);
    expect(report.events.some((e: { text: string }) => e.text.startsWith("Halbzeitansprache"))).toBe(true);
  }, 120_000);
});
