/** Integrationstest – Paket K: Zwei-Faktor-Anmeldung für Admins, Speicherdauer inaktiver Konten. */
import { describe, expect, it } from "vitest";
import { game, pool, register, shared } from "../context";
import { base32Decode, base32Encode, codeAt, currentStep, verifyCode } from "../../src/account/totp";
import { createSession } from "../../src/auth";
import type { MailMessage } from "../../src/account/mail";

const consent = { acceptTerms: true, ageConfirmed: true } as const;

describe("Paket K: Betrieb und Sicherheit", () => {
  it("TOTP nach RFC 6238 (Testvektor), Toleranz und Schutz vor Wiederverwendung", () => {
    // RFC 6238, SHA1-Geheimnis "12345678901234567890", T = 59 s → 94287082 (8 Stellen) → 287082
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
    expect(codeAt(secret, 1)).toBe("287082");
    const now = Date.now();
    const step = currentStep(now);
    expect(verifyCode(secret, codeAt(secret, step), null, now)).toBe(step);
    expect(verifyCode(secret, codeAt(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyCode(secret, codeAt(secret, step - 3), null, now)).toBeNull();
    expect(verifyCode(secret, codeAt(secret, step), step, now)).toBeNull(); // schon benutzt
    expect(verifyCode(secret, "12345", null, now)).toBeNull();
  });

  it("Admin-Bereich erst nach Einrichtung und Bestätigung der Zwei-Faktor-Anmeldung", async () => {
    const email = (await pool().query("select email from accounts where id = $1", [shared.accountId])).rows[0].email as string;
    process.env.ADMIN_EMAILS = email;
    try {
      const token = await createSession(shared.accountId);
      await expect(game.requireAdminMfa(shared.accountId, token)).rejects.toMatchObject({ status: 403, code: "mfa_setup" });
      const setup = await game.adminMfaSetup(shared.accountId);
      expect(setup.uri).toMatch(/^otpauth:\/\/totp\/Football%20Legacy/);
      expect(setup.qr).toContain("<svg");
      await expect(game.adminMfaVerify(shared.accountId, token, "000000")).rejects.toMatchObject({ status: 401 });
      await game.adminMfaVerify(shared.accountId, token, codeAt(setup.secret, currentStep()));
      await expect(game.requireAdminMfa(shared.accountId, token)).resolves.toBeUndefined();
      // Neue Sitzung braucht wieder einen Code; eine zweite Einrichtung ist nicht möglich
      const other = await createSession(shared.accountId);
      await expect(game.requireAdminMfa(shared.accountId, other)).rejects.toMatchObject({ code: "mfa_required" });
      await expect(game.adminMfaSetup(shared.accountId)).rejects.toThrow(/bereits/);
      expect((await game.adminMfaStatus(shared.accountId, token))).toMatchObject({ enabled: true, verified: true });
      // Nicht-Admins kommen gar nicht erst so weit
      const { account } = await register(`kein-admin${Date.now()}@example.com`, "geheim123", "Kein Admin", consent);
      await expect(game.requireAdminMfa(account.id, null)).rejects.toMatchObject({ status: 403 });
    } finally {
      delete process.env.ADMIN_EMAILS;
      await pool().query("update accounts set totp_secret = null, totp_enabled_at = null, totp_last_step = null where id = $1", [shared.accountId]);
    }
  });

  it("Inaktive Konten: Erinnerung nach 11 Monaten, Löschung einen Monat später, Anmeldung rettet das Konto", async () => {
    const mails: MailMessage[] = [];
    game.setMailTransport(async (m) => { mails.push(m); return { sent: true, id: "t" }; });
    try {
      const { account: idle } = await register(`schlaefer${Date.now()}@example.com`, "geheim123", "Schläfer", consent);
      const { account: back } = await register(`rueckkehrer${Date.now()}@example.com`, "geheim123", "Rückkehrer", consent);
      await pool().query("update accounts set last_login_day = current_date - interval '340 days' where id = any($1::uuid[])", [[idle.id, back.id]]);
      await pool().query("insert into sessions(token, account_id, expires_at) values ('abgelaufen-k', $1, now() - interval '1 day')", [idle.id]);
      const first = await game.retentionSweep();
      expect(first.warned).toBeGreaterThanOrEqual(2);
      expect(first.sessions).toBeGreaterThanOrEqual(1);
      expect(mails.some((m) => m.subject.includes("bald gelöscht"))).toBe(true);
      // Der Rückkehrer meldet sich an, für den Schläfer läuft die Frist ab
      await game.touchLoginStreak(back.id);
      await pool().query("update accounts set last_login_day = current_date - interval '400 days', inactivity_warned_at = now() - interval '31 days' where id = $1", [idle.id]);
      const second = await game.retentionSweep();
      expect(second.deleted).toBeGreaterThanOrEqual(1);
      expect((await pool().query("select 1 from accounts where id = $1", [idle.id])).rowCount).toBe(0);
      expect((await pool().query("select inactivity_warned_at from accounts where id = $1", [back.id])).rows[0].inactivity_warned_at).toBeNull();
    } finally {
      game.setMailTransport();
    }
  });

  it("Ohne Mailversand wird kein Konto gelöscht", async () => {
    const { account } = await register(`ohne-mail${Date.now()}@example.com`, "geheim123", "Ohne Mail", consent);
    await pool().query("update accounts set last_login_day = current_date - interval '500 days', inactivity_warned_at = now() - interval '60 days' where id = $1", [account.id]);
    const r = await game.retentionSweep();
    expect(r.deleted).toBe(0);
    expect((await pool().query("select 1 from accounts where id = $1", [account.id])).rowCount).toBe(1);
  });
});
