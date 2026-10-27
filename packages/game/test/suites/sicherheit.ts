/** Integrationstest – Nutzungsbedingungen, Anmeldeschutz, E-Mail-Bestätigung, Fehlerprotokoll, Chat-Moderation. */
import { describe, expect, it } from "vitest";
import { game, pool, register, shared } from "../context";

const mails: { to: string; subject: string; text: string }[] = [];
const consent = { acceptTerms: true, ageConfirmed: true } as const;
const unique = (p: string) => `${p}${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;

describe("Sicherheit und Moderation", () => {
  it("Nutzungsbedingungen und Mindestalter: ohne Zustimmung keine Registrierung, Zustimmung wird gespeichert", async () => {
    expect(() => game.requireConsent({ acceptTerms: true })).toThrow(/16 Jahren/);
    expect(() => game.requireConsent({ ageConfirmed: true })).toThrow(/Nutzungsbedingungen/);
    const { account } = await register(unique("terms"), "geheim123", "Terms", consent);
    expect(account.terms_version).toBe(game.TERMS_VERSION);
    // Bestehende Konten holen die Zustimmung nach
    const old = (await register(unique("alt"), "geheim123", "Alt")).account;
    expect(old.terms_version).toBe(0);
    await expect(game.acceptTerms(old.id, { acceptTerms: true })).rejects.toThrow();
    await game.acceptTerms(old.id, consent);
    const row = (await pool().query("select terms_version, age_confirmed, terms_accepted_at from accounts where id = $1", [old.id])).rows[0];
    expect(row).toMatchObject({ terms_version: game.TERMS_VERSION, age_confirmed: true });
    expect(row.terms_accepted_at).toBeTruthy();
  });

  it("Anmeldeschutz: nach 8 Fehlversuchen ist die Adresse gesperrt, Registrierungen je IP begrenzt", async () => {
    const email = unique("raten");
    await register(email, "geheim123", "Raten", consent);
    for (let i = 0; i < 8; i++) await expect(game.login(email, "falsch!!", { ip: `10.0.${i}.1` })).rejects.toMatchObject({ status: 401 });
    // Auch mit richtigem Passwort: erst nach Ablauf der Sperre
    await expect(game.login(email, "geheim123", { ip: "10.9.9.9" })).rejects.toMatchObject({ status: 429 });
    await pool().query("delete from auth_attempts where key = $1", [email]);
    expect((await game.login(email, "geheim123", { ip: "10.9.9.9" })).token).toBeTruthy();
    // Registrierungen je IP
    const ip = `192.0.2.${Math.floor(Math.random() * 200)}`;
    for (let i = 0; i < 5; i++) await register(unique(`ip${i}`), "geheim123", "IP", consent, { ip });
    await expect(register(unique("ip6"), "geheim123", "IP", consent, { ip })).rejects.toMatchObject({ status: 429 });
  });

  it("E-Mail-Bestätigung: Link per Mail, Bestätigung, Chat erst danach", async () => {
    game.setMailTransport(async (m) => { mails.push(m); return { sent: true, id: "test" }; });
    const { account } = await register(unique("verify"), "geheim123", "Verify", consent);
    const r = await game.sendVerification(account.id, "http://localhost:3000");
    expect(r.sent).toBe(true);
    const link = mails.at(-1)!.text.match(/token=([\w-]+)/)![1];
    await expect(game.requireVerified(account.id)).rejects.toMatchObject({ status: 403 });
    await expect(game.verifyEmail("unsinn")).rejects.toThrow(/ungültig/);
    expect((await game.verifyEmail(link)).email).toBe(account.email);
    await game.requireVerified(account.id);
    expect((await game.sendVerification(account.id)).alreadyVerified).toBe(true);
  });

  it("Fehlerprotokoll: unerwartete Fehler werden gruppiert, nur Administratoren sehen die Übersicht", async () => {
    for (let i = 0; i < 3; i++) game.captureException(new Error(`Testfehler in Runde ${i}`), { source: "server", path: "GET /api/test" });
    game.captureException(new game.GameError("Erwartete Meldung"), { source: "server" });
    await new Promise((r) => setTimeout(r, 300));
    const admin = (await pool().query("select email from accounts where id = $1", [shared.accountId])).rows[0].email;
    await expect(game.errorOverview(admin)).rejects.toMatchObject({ status: 403 });
    process.env.ADMIN_EMAILS = `chef@example.com, ${admin.toUpperCase()}`;
    try {
      const o = await game.errorOverview(admin);
      const g = o.groups.find((x) => x.message.includes("Testfehler"));
      expect(g?.count).toBe(3); // Zahlen im Text werden für die Gruppierung ignoriert
      expect(o.groups.some((x) => x.message.includes("Erwartete Meldung"))).toBe(false);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("Liga-Chat: melden, löschen, blockieren", async () => {
    const owner = shared.accountId;
    const other = shared.sponsorCareer!;
    await pool().query("update accounts set email_verified_at = now() where id = any($1::uuid[])", [[owner, other.acc]]);
    const l = await game.createOnlineLeague(owner, { name: "Moderation", careerId: shared.careerId, maxMembers: 4, rhythm: "manual", public: false });
    await game.joinOnlineLeague(other.acc, { code: l.code, careerId: other.cid });
    await game.postOnlineMessage(other.acc, l.id, "Hallo zusammen");
    const view = await game.onlineLeagueView(owner, l.id);
    const msg = view.posts.find((p) => p.body === "Hallo zusammen")!;
    expect(msg.canDelete).toBe(true); // Gründer
    // Melden: eine Meldung reicht noch nicht zum Ausblenden
    expect((await game.reportOnlinePost(owner, l.id, msg.id, "Test")).hidden).toBe(false);
    await expect(game.reportOnlinePost(other.acc, l.id, msg.id, "")).rejects.toThrow(/Eigene/);
    // Fremde Nachricht löschen darf nur der Gründer
    await game.postOnlineMessage(owner, l.id, "Vom Gründer");
    const own = (await game.onlineLeagueView(other.acc, l.id)).posts.find((p) => p.body === "Vom Gründer")!;
    expect(own.canDelete).toBe(false);
    await expect(game.deleteOnlinePost(other.acc, l.id, own.id)).rejects.toMatchObject({ status: 403 });
    await game.deleteOnlinePost(owner, l.id, msg.id);
    expect((await game.onlineLeagueView(owner, l.id)).posts.some((p) => p.body === "Hallo zusammen")).toBe(false);
    // Blockieren: Nachrichten des Blockierten verschwinden nur für den Blockierenden
    await game.postOnlineMessage(other.acc, l.id, "Noch einmal");
    const again = (await game.onlineLeagueView(owner, l.id)).posts.find((p) => p.body === "Noch einmal")!;
    await game.blockOnlineAuthor(owner, l.id, again.id);
    expect((await game.onlineLeagueView(owner, l.id)).posts.some((p) => p.body === "Noch einmal")).toBe(false);
    expect((await game.onlineLeagueView(other.acc, l.id)).posts.some((p) => p.body === "Noch einmal")).toBe(true);
    const blocked = await game.blockedList(owner);
    expect(blocked.map((b) => b.id)).toContain(other.acc);
    await game.unblockOnline(owner, other.acc);
    expect((await game.onlineLeagueView(owner, l.id)).posts.some((p) => p.body === "Noch einmal")).toBe(true);
    game.setMailTransport();
  });
});
