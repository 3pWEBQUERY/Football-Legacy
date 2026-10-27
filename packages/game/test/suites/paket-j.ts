/** Integrationstest – Paket J: englische Fassung (E-Mails, KI-Texte in der Kontosprache). */
import { describe, expect, it } from "vitest";
import { game, register, shared } from "../context";
import type { MailMessage } from "../../src/account/mail";
import { accountLang } from "../../src/account/lang";

const consent = { acceptTerms: true, ageConfirmed: true } as const;

describe("Paket J: englische Fassung", () => {
  it("E-Mails kommen in der Sprache des Kontos", async () => {
    const mails: MailMessage[] = [];
    game.setMailTransport(async (m) => { mails.push(m); return { sent: true, id: "test" }; });
    try {
      const { account } = await register(`english${Date.now()}@example.com`, "geheim123", "Ellie", consent);
      await game.updateSettings(account.id, { lang: "en" });
      expect(await accountLang({ id: account.id })).toBe("en");
      await game.sendVerification(account.id, "https://example.com");
      const m = mails.at(-1)!;
      expect(m.subject).toMatch(/confirm|verify/i);
      expect(m.html).toContain('lang="en"');
      expect(m.html).not.toMatch(/Bitte bestätige|Falls der Knopf/);
      expect(m.html).toContain("https://example.com/verify?token=");
      // Deutsche Konten bekommen weiter deutsche Mails
      const { account: de } = await register(`deutsch${Date.now()}@example.com`, "geheim123", "Dora", consent);
      await game.sendVerification(de.id, "https://example.com");
      expect(mails.at(-1)!.subject).toContain("bestätigen");
    } finally {
      game.setMailTransport();
    }
  });

  it("KI-Anfragen bitten bei englischen Konten um englische Antworten", async () => {
    const seen: string[] = [];
    game.setAiTransport(async (req) => { seen.push(req.context ?? ""); return { text: "Good morning.", inputTokens: 10, outputTokens: 5 }; });
    try {
      await game.updateSettings(shared.accountId, { ai: true, lang: "en" });
      await game.askAssistant(shared.careerId, shared.accountId, "How is the squad?");
      expect(seen.at(-1)).toContain("englische Fassung");
      await game.updateSettings(shared.accountId, { lang: "de" });
      await game.askAssistant(shared.careerId, shared.accountId, "Wie steht der Kader?");
      expect(seen.at(-1)).not.toContain("englische Fassung");
    } finally {
      game.setAiTransport();
      await game.updateSettings(shared.accountId, { ai: false });
    }
  });
});
