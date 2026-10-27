/**
 * E-Mail-Bestätigung: Nach der Registrierung kommt ein Link (7 Tage gültig).
 * Ein Klick bestätigt, dass die Adresse dem Konto gehört. Ohne Bestätigung
 * sind Liga-Chat und öffentliche Online-Ligen gesperrt, sobald der E-Mail-
 * Versand eingerichtet ist.
 */
import crypto from "node:crypto";
import { one, pool, query } from "../db";
import { GameError } from "../errors";
import { hashToken } from "../auth";
import { layout, mailConfigured, sendMail } from "./mail";
import { appUrl } from "./password-reset";
import { VERIFY_PER_ACCOUNT, guard, record } from "./limits";

const VALID_DAYS = 7;

export async function sendVerification(accountId: string, origin?: string | null) {
  const a = await one<{ email: string; display_name: string; email_verified_at: string | null }>(pool(),
    "select email, display_name, email_verified_at from accounts where id = $1", [accountId]);
  if (!a) throw new GameError("Account nicht gefunden", 404);
  if (a.email_verified_at) return { ok: true, alreadyVerified: true, sent: false };
  await guard(VERIFY_PER_ACCOUNT, accountId, "Es wurden gerade schon mehrere Bestätigungs-Mails verschickt. Bitte schau in deinem Postfach (auch im Spam-Ordner) nach oder versuche es in einer Stunde erneut.");
  await record(VERIFY_PER_ACCOUNT, accountId);
  const token = crypto.randomBytes(32).toString("base64url");
  await query(pool(), "delete from email_verifications where account_id = $1", [accountId]);
  await query(pool(), "insert into email_verifications(account_id, token_hash, email, expires_at) values ($1, $2, $3, now() + ($4 || ' days')::interval)",
    [accountId, hashToken(token), a.email, String(VALID_DAYS)]);
  const url = `${appUrl(origin)}/verify?token=${token}`;
  const result = await sendMail({
    to: a.email,
    subject: "E-Mail-Adresse bestätigen – Football Legacy",
    text: `Hallo ${a.display_name},\n\nbitte bestätige deine E-Mail-Adresse für Football Legacy (gültig ${VALID_DAYS} Tage):\n${url}\n\nDu hast dich nicht registriert? Dann ignoriere diese E-Mail.`,
    html: layout("E-Mail-Adresse bestätigen", [
      `Hallo ${a.display_name},`,
      `willkommen bei Football Legacy! Bitte bestätige mit einem Klick, dass diese Adresse dir gehört. Der Link ist ${VALID_DAYS} Tage gültig.`,
      "Du hast dich nicht registriert? Dann ignoriere diese E-Mail – ohne Bestätigung bleibt das Konto eingeschränkt.",
    ], { label: "E-Mail bestätigen", url }),
  });
  return { ok: true, alreadyVerified: false, sent: result.sent };
}

export async function verifyEmail(token: string) {
  if (!token || token.length > 100) throw new GameError("Der Bestätigungslink ist ungültig.");
  const v = await one<{ id: number; account_id: string; email: string }>(pool(),
    "select id, account_id, email from email_verifications where token_hash = $1 and expires_at > now()", [hashToken(token)]);
  if (!v) throw new GameError("Der Bestätigungslink ist ungültig oder abgelaufen. Unter Einstellungen kannst du einen neuen anfordern.");
  // Nur gültig, solange die Adresse am Konto noch dieselbe ist
  const done = await query(pool(), "update accounts set email_verified_at = now() where id = $1 and email = $2 returning id", [v.account_id, v.email]);
  await query(pool(), "delete from email_verifications where account_id = $1", [v.account_id]);
  if (!done.length) throw new GameError("Die E-Mail-Adresse des Kontos hat sich inzwischen geändert.");
  return { ok: true, email: v.email };
}

/** Für Chat und öffentliche Ligen: bestätigte Adresse nötig, sobald Mails verschickt werden können. */
export async function requireVerified(accountId: string) {
  if (!mailConfigured()) return;
  const a = await one<{ email_verified_at: string | null }>(pool(), "select email_verified_at from accounts where id = $1", [accountId]);
  if (!a?.email_verified_at) throw new GameError("Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Willkommens-Mail oder unter Einstellungen → Konto).", 403);
}
