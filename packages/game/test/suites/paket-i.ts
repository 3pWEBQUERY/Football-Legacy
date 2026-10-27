/** Integrationstest – Paket I: Admin-Bereich (Kennzahlen, Meldungen, Sperren, Konten, KI-Kosten, Protokoll). */
import { describe, expect, it } from "vitest";
import { game, pool, register, shared } from "../context";

const consent = { acceptTerms: true, ageConfirmed: true } as const;
const unique = (p: string) => `${p}${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;

async function asAdmin<T>(fn: (email: string) => Promise<T>): Promise<T> {
  const email = (await pool().query("select email from accounts where id = $1", [shared.accountId])).rows[0].email as string;
  process.env.ADMIN_EMAILS = email;
  try {
    return await fn(email);
  } finally {
    delete process.env.ADMIN_EMAILS;
  }
}

describe("Paket I: Admin-Bereich", () => {
  it("Nur Administratoren haben Zugang; Kennzahlen und KI-Kosten", async () => {
    await expect(game.adminOverview("jemand@example.com")).rejects.toMatchObject({ status: 403 });
    await asAdmin(async (admin) => {
      const o = await game.adminOverview(admin);
      expect(o.accounts).toBeGreaterThan(1);
      expect(o.careers).toBeGreaterThan(0);
      const ai = await game.aiUsage(admin);
      expect(ai.days.length).toBeGreaterThan(0);
      expect(ai.features.some((f) => f.feature === "assistant")).toBe(true);
    });
  });

  it("Meldungen: verwerfen macht sichtbar, entfernen und sperren beendet die Sitzung", async () => {
    const email = unique("troll");
    const { account, token } = await register(email, "geheim123", "Troll", consent);
    const owner = shared.accountId;
    const career = await game.createCareer(account.id, { managerName: "Troll", countryCode: "GER", clubIndex: game.previewClubs(99, "GER")[0].clubs[1].index, seed: 99 });
    await pool().query("update accounts set email_verified_at = now() where id = any($1::uuid[])", [[owner, account.id]]);
    const l = await game.createOnlineLeague(owner, { name: "Admin-Test", careerId: shared.careerId, maxMembers: 4, rhythm: "manual", public: false });
    await game.joinOnlineLeague(account.id, { code: l.code, careerId: career });
    await game.postOnlineMessage(account.id, l.id, "Erste Nachricht");
    const first = (await game.onlineLeagueView(owner, l.id)).posts.find((p) => p.body === "Erste Nachricht")!;
    await game.reportOnlinePost(owner, l.id, first.id, "Spam");
    await asAdmin(async (admin) => {
      const open = await game.adminReports(admin);
      expect(open.reports.some((r) => r.post_id === first.id)).toBe(true);
      await game.resolveReport(admin, first.id, "dismiss");
      expect((await game.adminReports(admin)).reports.some((r) => r.post_id === first.id)).toBe(false);
      expect((await pool().query("select hidden from online_posts where id = $1", [first.id])).rows[0].hidden).toBe(false);
      // Zweite Nachricht: entfernen und 7 Tage sperren
      await game.postOnlineMessage(account.id, l.id, "Beleidigung");
      const bad = (await game.onlineLeagueView(owner, l.id)).posts.find((p) => p.body === "Beleidigung")!;
      await game.reportOnlinePost(owner, l.id, bad.id, "Beleidigung");
      await game.resolveReport(admin, bad.id, "remove_ban", 7);
      expect(await game.accountForToken(token)).toBeNull(); // Sitzung beendet
      await expect(game.login(email, "geheim123")).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/bis .* gesperrt\. Grund/) });
      const found = await game.adminAccounts(admin, "troll");
      expect(found.accounts.find((a) => a.id === account.id)).toMatchObject({ banned: true });
      // Dauerhaft sperren, dann aufheben
      await game.banAccount(admin, account.id, null, "Wiederholte Verstösse");
      await expect(game.login(email, "geheim123")).rejects.toThrow(/dauerhaft gesperrt/);
      expect((await game.adminAccount(admin, account.id)).account).toMatchObject({ banned: true, banned_until: "dauerhaft" });
      await game.unbanAccount(admin, account.id);
      expect((await game.login(email, "geheim123")).token).toBeTruthy();
      // Admins lassen sich nicht sperren
      await expect(game.banAccount(admin, shared.accountId, 1, "Test")).rejects.toThrow(/Administratoren/);
    });
  });

  it("Konten: Namen zurücksetzen, löschen, Protokoll", async () => {
    const { account } = await register(unique("weg"), "geheim123", "Unpassender Name", consent);
    await asAdmin(async (admin) => {
      const r = await game.resetDisplayName(admin, account.id);
      expect(r.name).toMatch(/^Manager-[0-9a-f]{6}$/);
      expect((await game.adminAccount(admin, account.id)).actions[0]).toMatchObject({ action: "rename" });
      await game.adminDeleteAccount(admin, account.id);
      expect((await pool().query("select 1 from accounts where id = $1", [account.id])).rowCount).toBe(0);
      expect((await pool().query("select 1 from admin_actions where target_account = $1", [account.id])).rowCount).toBe(0);
      const log = await game.adminActions(admin);
      expect(log.actions.map((x) => x.action)).toEqual(expect.arrayContaining(["ban", "unban", "report_dismiss", "report_remove_ban", "delete"]));
    });
  });
});
