/**
 * Passwort vergessen: Link per E-Mail (gültig 60 Minuten, einmal verwendbar).
 * Die Antwort verrät nie, ob es zu einer Adresse einen Account gibt. Tokens
 * werden nur gehasht gespeichert; nach dem Zurücksetzen enden alle Sitzungen.
 */
import crypto from "node:crypto";
import { createSession, hashPassword, hashToken, normalizeEmail } from "../auth";
import { one, pool, query } from "../db";
import { GameError } from "../errors";
import { layout, sendMail } from "./mail";

const VALID_MINUTES = 60;
/** Höchstens so viele Links je Account und je IP-Adresse pro Stunde. */
const PER_ACCOUNT_HOUR = 3;
const PER_IP_HOUR = 10;

/** Basis-URL für Links: APP_URL, sonst die öffentliche Railway-Domain, lokal die Anfrage. */
export function appUrl(requestOrigin?: string | null): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (process.env.NODE_ENV !== "production" && requestOrigin) return requestOrigin.replace(/\/$/, "");
  return "http://localhost:3000";
}

export async function requestPasswordReset(email: string, opts: { ip?: string | null; origin?: string | null } = {}) {
  const ok = { ok: true, message: "Wenn es zu dieser Adresse einen Account gibt, ist eine E-Mail mit einem Link zum Zurücksetzen unterwegs." };
  const e = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new GameError("Bitte gib eine gültige E-Mail-Adresse ein.");
  const db = pool();
  // Alte Einträge aufräumen (auch gespeicherte IP-Adressen)
  await query(db, "delete from password_resets where created_at < now() - interval '7 days'");
  if (opts.ip) {
    const byIp = await one<{ n: number }>(db, "select count(*)::int as n from password_resets where ip = $1 and created_at > now() - interval '1 hour'", [opts.ip]);
    if ((byIp?.n ?? 0) >= PER_IP_HOUR) return ok;
  }
  const account = await one<{ id: string; display_name: string }>(db, "select id, display_name from accounts where email = $1", [e]);
  if (!account) return ok;
  const recent = await one<{ n: number }>(db, "select count(*)::int as n from password_resets where account_id = $1 and created_at > now() - interval '1 hour'", [account.id]);
  if ((recent?.n ?? 0) >= PER_ACCOUNT_HOUR) return ok;
  const token = crypto.randomBytes(32).toString("base64url");
  // Nur der neueste Link gilt
  await query(db, "update password_resets set used_at = now() where account_id = $1 and used_at is null", [account.id]);
  await query(db, "insert into password_resets(account_id, token_hash, expires_at, ip) values ($1, $2, now() + ($3 || ' minutes')::interval, $4)",
    [account.id, hashToken(token), String(VALID_MINUTES), opts.ip ?? null]);
  const url = `${appUrl(opts.origin)}/reset?token=${token}`;
  const result = await sendMail({
    to: e,
    subject: "Passwort zurücksetzen – Football Legacy",
    text: `Hallo ${account.display_name},\n\nüber diesen Link kannst du ein neues Passwort festlegen (gültig ${VALID_MINUTES} Minuten):\n${url}\n\nDu hast das nicht angefordert? Dann ignoriere diese E-Mail – dein Passwort bleibt unverändert.`,
    html: layout("Neues Passwort festlegen", [
      `Hallo ${account.display_name},`,
      `für deinen Account wurde ein neues Passwort angefordert. Der Link ist ${VALID_MINUTES} Minuten gültig und funktioniert nur einmal.`,
      "Du hast das nicht angefordert? Dann ignoriere diese E-Mail – dein Passwort bleibt unverändert.",
    ], { label: "Passwort zurücksetzen", url }),
  });
  if (!result.sent && result.error !== "not_configured") console.error(`[reset] E-Mail an Account ${account.id} fehlgeschlagen`);
  return ok;
}

async function validReset(token: string) {
  if (!token || token.length > 100) return null;
  return one<{ id: number; account_id: string }>(pool(),
    "select id, account_id from password_resets where token_hash = $1 and used_at is null and expires_at > now()", [hashToken(token)]);
}

export async function checkResetToken(token: string) {
  return { valid: !!(await validReset(token)) };
}

/** Neues Passwort setzen; alle Sitzungen enden, der Nutzer wird direkt angemeldet. */
export async function resetPassword(token: string, password: string) {
  if (password.length < 8) throw new GameError("Das Passwort muss mindestens 8 Zeichen lang sein.");
  const reset = await validReset(token);
  if (!reset) throw new GameError("Der Link ist ungültig oder abgelaufen. Fordere einfach einen neuen an.", 400);
  const db = pool();
  const used = await query(db, "update password_resets set used_at = now() where id = $1 and used_at is null returning id", [reset.id]);
  if (!used.length) throw new GameError("Der Link wurde bereits verwendet.", 400);
  await query(db, "update accounts set password_hash = $2 where id = $1", [reset.account_id, await hashPassword(password)]);
  await query(db, "delete from sessions where account_id = $1", [reset.account_id]);
  const account = await one<{ id: string; email: string; display_name: string }>(db, "select id, email, display_name from accounts where id = $1", [reset.account_id]);
  return { ok: true, account: account!, token: await createSession(reset.account_id) };
}
