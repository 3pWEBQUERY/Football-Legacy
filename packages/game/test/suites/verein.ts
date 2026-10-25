/** Integrationstest – Verein, Fans und Online-Ligen. */
import { describe, expect, it } from "vitest";
import { game, pool, register, createCareer, previewClubs, dashboard, shared } from "../context";

describe("Verein, Fans und Online-Ligen", () => {
  let friendId = "";
  let friendCareer = "";
  let leagueId = "";

  it("Vereinsverwaltung: Fanstimmung, Tickets, Fan-Aktionen und Identität", async () => {
    const v = await game.clubManagementView(shared.careerId, shared.accountId);
    // nach einer ganzen Saison haben die Fans eine Geschichte und eine Meinung
    expect(v.fans.history.length).toBeGreaterThan(10);
    expect(v.fans.voices.length).toBeGreaterThan(0);
    expect(v.fans.members).toBeGreaterThan(0);
    expect(v.actions.length).toBe(6);
    await game.setTicketLevel(shared.careerId, shared.accountId, "low");
    expect((await game.clubManagementView(shared.careerId, shared.accountId)).tickets.level).toBe("low");
    await expect(game.setTicketLevel(shared.careerId, shared.accountId, "gratis" as never)).rejects.toThrow();
    const before = (await game.clubManagementView(shared.careerId, shared.accountId)).fans.satisfaction;
    const r = await game.fanAction(shared.careerId, shared.accountId, "training");
    expect(r.satisfaction).toBeGreaterThanOrEqual(Math.min(100, before));
    await expect(game.fanAction(shared.careerId, shared.accountId, "training")).rejects.toThrow(/Tagen/);
    const old = v.club.name;
    await game.updateIdentity(shared.careerId, shared.accountId, { name: "Testclub Legacy", short: "TCL", primary: "#123456", secondary: "#fedcba", stadiumName: "Legacy-Park" });
    const after = await game.clubManagementView(shared.careerId, shared.accountId);
    expect(after.club.name).toBe("Testclub Legacy");
    expect(after.club.colors.primary).toBe("#123456");
    expect(after.stadiumName).toBe("Legacy-Park");
    expect(after.renamed).toBe(1);
    expect(after.fans.satisfaction).toBeLessThan(r.satisfaction);
    await expect(game.updateIdentity(shared.careerId, shared.accountId, { name: "X" })).rejects.toThrow();
    expect(old).not.toBe("Testclub Legacy");
  });

  it("Eigenen Verein gründen", async () => {
    const { account } = await register(`friend${Date.now()}@example.com`, "geheim123", "Freundin");
    friendId = account.id;
    const preview = previewClubs(99, "GER");
    const base = preview[0].clubs[3];
    await expect(createCareer(friendId, { managerName: "F", countryCode: "GER", clubIndex: base.index, seed: 99, custom: { name: "X", shortName: "X", city: "", primary: "#000000", secondary: "#ffffff", founded: 2000, stadiumName: "" } })).rejects.toThrow();
    friendCareer = await createCareer(friendId, {
      managerName: "Freundin", countryCode: "GER", clubIndex: base.index, seed: 99,
      custom: { name: "FC Seeblick", shortName: "fcs", city: "Seeblick", primary: "#0a7d3b", secondary: "#ffffff", founded: 2024, stadiumName: "" },
    });
    const d = await dashboard(friendCareer, friendId);
    expect(d.club?.name).toBe("FC Seeblick");
    const v = await game.clubManagementView(friendCareer, friendId);
    expect(v.club.short).toBe("FCS");
    expect(v.club.founded).toBe(2024);
    expect(v.stadiumName).toBe("Seeblick-Arena");
    expect(v.club.colors.primary).toBe("#0a7d3b");
    const names = await pool().query("select count(*)::int as n from clubs where career_id = $1 and name = $2", [friendCareer, base.name]);
    expect(names.rows[0].n).toBe(0);
    expect(d.inbox.some((m) => String(m.title).includes("FC Seeblick"))).toBe(true);
  }, 60_000);

  it("Spielplan: Doppelrunde, jeder gegen jeden", () => {
    for (const n of [2, 3, 4, 7, 10]) {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const rounds = game.roundRobin(ids);
      expect(rounds.length).toBe((n % 2 ? n : n - 1) * 2);
      const pairs = rounds.flat();
      expect(pairs.length).toBe(n * (n - 1));
      expect(new Set(pairs.map(([h, a]) => `${h}-${a}`)).size).toBe(n * (n - 1));
      for (const r of rounds) expect(new Set(r.flat()).size).toBe(r.length * 2);
    }
  });

  it("Online-Liga: gründen, beitreten, CPU-Teams, Bereit-Meldung, Saison, Chat", async () => {
    await expect(game.createOnlineLeague(shared.accountId, { name: "ab", careerId: shared.careerId, maxMembers: 4, rhythm: "manual", public: true })).rejects.toThrow();
    const created = await game.createOnlineLeague(shared.accountId, { name: "Testliga", careerId: shared.careerId, maxMembers: 4, rhythm: "manual", public: false });
    leagueId = created.id;
    expect(created.code).toMatch(/^[A-Z2-9]{6}$/);
    // privat: nicht in der Liste offener Ligen, Fremde sehen sie nicht
    expect((await game.onlineOverview(friendId)).open.some((l: { id: string }) => l.id === leagueId)).toBe(false);
    await expect(game.onlineLeagueView(friendId, leagueId)).rejects.toThrow();
    await expect(game.joinOnlineLeague(friendId, { code: "ZZZZZZ", careerId: friendCareer })).rejects.toThrow();
    await expect(game.joinOnlineLeague(friendId, { code: created.code, careerId: shared.careerId })).rejects.toThrow(); // fremde Karriere
    await game.joinOnlineLeague(friendId, { code: created.code.toLowerCase(), careerId: friendCareer });
    await expect(game.joinOnlineLeague(friendId, { code: created.code, careerId: friendCareer })).rejects.toThrow(/bereits/);
    await expect(game.addOnlineBots(friendId, leagueId, 2)).rejects.toThrow(/gründer/i);
    await game.addOnlineBots(shared.accountId, leagueId, 5);
    let v = await game.onlineLeagueView(shared.accountId, leagueId);
    expect(v.members.length).toBe(4);
    expect(v.members.filter((m: { bot: boolean }) => m.bot).length).toBe(2);
    expect(v.members.find((m: { mine: boolean }) => m.mine)?.team.name).toBe("Testclub Legacy");
    expect(v.members.every((m: { team: { rating: number } }) => m.team.rating > 0)).toBe(true);

    await game.startOnlineLeague(shared.accountId, leagueId);
    v = await game.onlineLeagueView(shared.accountId, leagueId);
    expect(v.status).toBe("running");
    expect(v.rounds).toBe(6);
    expect(v.schedule.length).toBe(6);
    expect(v.myNext?.bye).toBe(false);
    await expect(game.leaveOnlineLeague(friendId, leagueId)).rejects.toThrow();

    // erst wenn beide bereit sind, wird gespielt
    const r1 = await game.setOnlineReady(shared.accountId, leagueId, true);
    expect(r1.played).toBe(false);
    expect((await game.onlineLeagueView(friendId, leagueId)).waitingFor).toEqual(["Freundin"]);
    const r2 = await game.setOnlineReady(friendId, leagueId, true);
    expect(r2.played).toBe(true);
    v = await game.onlineLeagueView(shared.accountId, leagueId);
    expect(v.round).toBe(1);
    expect(v.table.reduce((s: number, r: { p: number }) => s + r.p, 0)).toBe(4);
    const played = v.schedule[0].matches[0] as { id: number; hasReport: boolean };
    expect(played.hasReport).toBe(true);
    const rep = await game.onlineMatchReport(friendId, leagueId, played.id);
    expect(rep.report?.players.length).toBeGreaterThanOrEqual(22);
    expect(rep.homeGoals).toBe(rep.report!.events.filter((e) => ["goal", "penalty_goal"].includes(e.type) && e.side === "home").length + rep.report!.events.filter((e) => e.type === "own_goal" && e.side === "away").length);

    // Gründer spielt den Rest
    await expect(game.playOnlineRound(friendId, leagueId)).rejects.toThrow();
    for (let i = 0; i < 5; i++) await game.playOnlineRound(shared.accountId, leagueId);
    v = await game.onlineLeagueView(shared.accountId, leagueId);
    expect(v.status).toBe("finished");
    expect(v.table.every((r: { p: number }) => r.p === 6)).toBe(true);
    expect(v.posts.some((p: { body: string }) => p.body.includes("Meister der Saison 1"))).toBe(true);

    await game.postOnlineMessage(friendId, leagueId, "  Glückwunsch   zum Titel! ");
    await expect(game.postOnlineMessage(friendId, leagueId, "  ")).rejects.toThrow();
    v = await game.onlineLeagueView(friendId, leagueId);
    expect(v.posts.at(-1)?.body).toBe("Glückwunsch zum Titel!");
    expect(v.posts.at(-1)?.mine).toBe(true);

    // neue Saison mit frischem Spielplan
    await game.startOnlineLeague(shared.accountId, leagueId);
    v = await game.onlineLeagueView(shared.accountId, leagueId);
    expect(v.season).toBe(2);
    expect(v.round).toBe(0);
    expect(v.table.every((r: { p: number }) => r.p === 0)).toBe(true);
    const ov = await game.onlineOverview(friendId);
    expect(ov.leagues[0].id).toBe(leagueId);
    expect(ov.careers.length).toBe(1);
  }, 60_000);

  it("Online-Liga: täglicher Rhythmus holt fällige Spieltage nach", async () => {
    const l = await game.createOnlineLeague(friendId, { name: "Tagesliga", careerId: friendCareer, maxMembers: 3, rhythm: "daily", public: true });
    expect((await game.onlineOverview(shared.accountId)).open.some((x: { id: string }) => x.id === l.id)).toBe(true);
    await game.joinOnlineLeague(shared.accountId, { leagueId: l.id, careerId: shared.careerId });
    await game.addOnlineBots(friendId, l.id, 1);
    await game.startOnlineLeague(friendId, l.id);
    // zwei Tage vergangen
    await pool().query("update online_leagues set next_at = now() - interval '1 day 1 hour' where id = $1", [l.id]);
    const v = await game.onlineLeagueView(shared.accountId, l.id);
    expect(v.round).toBe(2);
    expect(new Date(v.nextAt!).getTime()).toBeGreaterThan(Date.now());
    // Karriere gelöscht: Team spielt mit letztem Kaderstand weiter
    await game.deleteCareer(friendId, friendCareer);
    await game.playOnlineRound(friendId, l.id);
    const after = await game.onlineLeagueView(friendId, l.id);
    expect(after.round).toBe(3);
    expect(after.members.find((m: { mine: boolean }) => m.mine)?.orphan).toBe(true);
    expect(after.table.reduce((n: number, r: { p: number }) => n + r.p, 0)).toBe(6);
  }, 60_000);
});
