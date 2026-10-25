/** Integrationstest – Stellenmarkt. */
import { describe, expect, it } from "vitest";
import { game, pool, advance, quickMatch, dashboard, squadView, shared } from "../context";

describe("Stellenmarkt", () => {
  async function playOn(until: (c: { week: number }) => boolean, max = 80) {
    for (let i = 0; i < max; i++) {
      const c = (await pool().query("select week, club_id from careers where id = $1", [shared.careerId])).rows[0];
      if (until(c)) return;
      const r = await advance(shared.careerId, shared.accountId);
      if (r.kind === "match") await quickMatch(shared.careerId, shared.accountId);
    }
    throw new Error("Ziel nicht erreicht");
  }

  it("Freie Stellen: alle Vereine der Welt mit Status, Filter und Seiten", async () => {
    const v = await game.jobsView(shared.careerId, shared.accountId, {});
    const total = v.counts.frei + v.counts.unsicher + v.counts.besetzt;
    expect(total).toBeGreaterThan(1000);
    expect(v.rows.length).toBe(40);
    expect(v.rows.every((r) => r.coach === null ? r.status === "frei" : r.coach.length > 3)).toBe(true);
    expect(v.me.club?.name).toBe("Testclub Legacy");
    const ger = await game.jobsView(shared.careerId, shared.accountId, { country: "GER", tier: 1 });
    expect(ger.total).toBe(18);
    expect(ger.rows.every((r) => r.countryCode === "GER" && r.tier === 1)).toBe(true);
    const page2 = await game.jobsView(shared.careerId, shared.accountId, { page: 2 });
    expect(page2.rows[0].clubId).not.toBe(v.rows[0].clubId);
    const reach = await game.jobsView(shared.careerId, shared.accountId, { reachable: true });
    expect(reach.total).toBeLessThan(total);
  });

  it("Bewerbung: verschicken, doppelt abgelehnt, Antwort nach einigen Tagen", async () => {
    const v = await game.jobsView(shared.careerId, shared.accountId, { country: "ESP", tier: 2 });
    const target = v.rows[0];
    const r = await game.applyForJob(shared.careerId, shared.accountId, target.clubId);
    expect(r.message).toMatch(/bewerbung/i);
    await expect(game.applyForJob(shared.careerId, shared.accountId, target.clubId)).rejects.toThrow(/läuft/);
    await expect(game.applyForJob(shared.careerId, shared.accountId, v.me.club!.id)).rejects.toThrow();
    let after = await game.jobsView(shared.careerId, shared.accountId, { country: "ESP", tier: 2 });
    expect(after.applications[0].status).toBe("pending");
    expect(after.rows.find((x) => x.clubId === target.clubId)?.applied).toBe(true);
    for (let i = 0; i < 12; i++) {
      const res = await advance(shared.careerId, shared.accountId);
      if (res.kind === "match") await quickMatch(shared.careerId, shared.accountId);
    }
    after = await game.jobsView(shared.careerId, shared.accountId, {});
    const app = after.applications.find((a) => a.clubId === target.clubId)!;
    expect(["rejected", "offer"]).toContain(app.status);
    const inbox = await pool().query("select title from inbox where career_id = $1 and title like $2", [shared.careerId, `%${target.name}%`]);
    expect(inbox.rows.length).toBeGreaterThan(0);
  }, 60_000);

  it("Vereinswechsel mitten in der Saison und Rücktritt", async () => {
    await playOn((c) => c.week >= 2);
    const before = (await pool().query("select club_id, season from careers where id = $1", [shared.careerId])).rows[0];
    // Angebot eines Vereins aus einer anderen Liga
    const pick = (await pool().query(
      `select c.id, c.name, c.reputation, c.country_code, l.name as league from clubs c join leagues l on l.id = c.league_id
        where c.career_id = $1 and l.country_code = 'ITA' and l.tier = 2 order by c.reputation desc limit 1`, [shared.careerId])).rows[0];
    await pool().query("update careers set job_offers = $2 where id = $1", [shared.careerId, JSON.stringify([{ clubId: pick.id, clubName: pick.name, leagueName: pick.league, countryCode: "ITA", reputation: pick.reputation, expires: before.season + 1, expiresDay: before.season * 1000 + 999, kind: "angebot", wage: 300000, years: 2 }])]);
    await expect(game.acceptJob(shared.careerId, shared.accountId, 999999)).rejects.toThrow();
    await game.acceptJob(shared.careerId, shared.accountId, pick.id);
    const d = await dashboard(shared.careerId, shared.accountId);
    expect(d.club?.id).toBe(pick.id);
    expect(d.career.week).toBeGreaterThanOrEqual(2);
    const squad = await squadView(shared.careerId, shared.accountId);
    expect(squad.players.length).toBeGreaterThan(15);
    const v = await game.jobsView(shared.careerId, shared.accountId, {});
    expect(v.me.contract?.untilSeason).toBe(before.season + 1);
    expect(v.offers.length).toBe(0);
    const old = await game.jobsView(shared.careerId, shared.accountId, { q: "Testclub Legacy" });
    expect(old.rows[0].status).toBe("frei");
    // weiterspielen mit dem neuen Verein: nächste Runde inklusive eigenem Spiel
    const week = d.career.week;
    await playOn((c) => c.week > week);
    const played = await pool().query("select count(*)::int as n from fixtures where career_id = $1 and season = $2 and played and $3 in (home_id, away_id)", [shared.careerId, before.season, pick.id]);
    expect(played.rows[0].n).toBeGreaterThanOrEqual(week);

    await game.resignJob(shared.careerId, shared.accountId);
    const free = await dashboard(shared.careerId, shared.accountId);
    expect(free.career.status).toBe("unemployed");
    expect(free.club).toBeFalsy();
    await expect(game.resignJob(shared.careerId, shared.accountId)).rejects.toThrow();
    // ohne Verein läuft die Zeit weiter
    const w0 = free.career.week;
    await playOn((c) => c.week > w0 + 1, 40);
    const now = await dashboard(shared.careerId, shared.accountId);
    expect(now.career.week).toBeGreaterThan(w0 + 1);
    const jobs = await game.jobsView(shared.careerId, shared.accountId, { status: "frei" });
    expect(jobs.me.club).toBeNull();
    expect(jobs.total).toBeGreaterThan(0);
    // Interesse bekunden und zurücknehmen
    const t = (await game.jobsView(shared.careerId, shared.accountId, { status: "besetzt" })).rows[0];
    expect((await game.toggleInterest(shared.careerId, shared.accountId, t.clubId)).interest).toBe(true);
    expect((await game.toggleInterest(shared.careerId, shared.accountId, t.clubId)).interest).toBe(false);
    // wieder einsteigen über ein Angebot
    const pick2 = jobs.rows[0];
    await pool().query("update careers set job_offers = $2 where id = $1", [shared.careerId, JSON.stringify([{ clubId: pick2.clubId, clubName: pick2.name, leagueName: pick2.league, countryCode: pick2.countryCode, reputation: pick2.reputation, expires: 9999, expiresDay: 9_999_999 }])]);
    await game.declineOffer(shared.careerId, shared.accountId, pick2.clubId);
    expect((await dashboard(shared.careerId, shared.accountId)).jobOffers.length).toBe(0);
    await pool().query("update careers set job_offers = $2 where id = $1", [shared.careerId, JSON.stringify([{ clubId: pick2.clubId, clubName: pick2.name, leagueName: pick2.league, countryCode: pick2.countryCode, reputation: pick2.reputation, expires: 9999, expiresDay: 9_999_999 }])]);
    await game.acceptJob(shared.careerId, shared.accountId, pick2.clubId);
    const back = await dashboard(shared.careerId, shared.accountId);
    expect(back.career.status).toBe("active");
    expect(back.club?.id).toBe(pick2.clubId);
  }, 120_000);
});
