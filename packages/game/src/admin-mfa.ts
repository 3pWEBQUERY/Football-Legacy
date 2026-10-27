/**
 * Zwei-Faktor-Anmeldung für den Admin-Bereich. Administratoren müssen eine
 * Authenticator-App einrichten; danach braucht jede Sitzung einmal einen
 * Code (gültig 12 Stunden). Bis dahin sind alle Admin-Funktionen gesperrt.
 *
 * Notfall (Gerät verloren): ADMIN_MFA=off setzen und neu einrichten, oder
 *   update accounts set totp_secret = null, totp_enabled_at = null where email = '…';
 */
import QRCode from "qrcode";
import { one, pool, query } from "./db";
import { GameError } from "./errors";
import { hashToken } from "./auth";
import { isAdmin } from "./monitoring";
import { newSecret, otpauthUri, verifyCode } from "./account/totp";

const VALID_HOURS = 12;
const required = () => (process.env.ADMIN_MFA ?? "required") !== "off";

interface MfaRow { email: string; totp_secret: string | null; totp_enabled_at: string | null; totp_last_step: string | null }

async function adminRow(accountId: string): Promise<MfaRow> {
  const r = await one<MfaRow>(pool(), "select email, totp_secret, totp_enabled_at, totp_last_step from accounts where id = $1", [accountId]);
  if (!r || !isAdmin(r.email)) throw new GameError("Nur für Administratoren.", 403);
  return r;
}

async function sessionVerified(token: string | null): Promise<boolean> {
  if (!token) return false;
  const s = await one<{ ok: boolean }>(pool(), `select coalesce(mfa_at > now() - interval '${VALID_HOURS} hours', false) as ok from sessions where token = $1`, [hashToken(token)]);
  return !!s?.ok;
}

/** Vor jeder Admin-Funktion: wirft 403 mit Code "mfa_setup" oder "mfa_required". */
export async function requireAdminMfa(accountId: string, token: string | null) {
  const r = await adminRow(accountId);
  if (!required()) return;
  if (!r.totp_enabled_at) throw new GameError("Bitte richte zuerst die Zwei-Faktor-Anmeldung ein.", 403, "mfa_setup");
  if (!(await sessionVerified(token))) throw new GameError("Bitte bestätige die Anmeldung mit dem Code aus deiner Authenticator-App.", 403, "mfa_required");
}

export async function adminMfaStatus(accountId: string, token: string | null) {
  const r = await adminRow(accountId);
  return { required: required(), enabled: !!r.totp_enabled_at, verified: await sessionVerified(token) };
}

/** Neues Geheimnis erzeugen (nur solange noch keins aktiv ist). */
export async function adminMfaSetup(accountId: string) {
  const r = await adminRow(accountId);
  if (r.totp_enabled_at) throw new GameError("Die Zwei-Faktor-Anmeldung ist bereits eingerichtet.");
  const secret = newSecret();
  await query(pool(), "update accounts set totp_secret = $2, totp_last_step = null where id = $1", [accountId, secret]);
  const uri = otpauthUri(secret, r.email);
  const qr = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { secret, uri, qr };
}

/** Code prüfen: aktiviert beim ersten Mal die Einrichtung und bestätigt die laufende Sitzung. */
export async function adminMfaVerify(accountId: string, token: string | null, code: string) {
  const r = await adminRow(accountId);
  if (!r.totp_secret) throw new GameError("Bitte richte zuerst die Zwei-Faktor-Anmeldung ein.", 400, "mfa_setup");
  const step = verifyCode(r.totp_secret, code, r.totp_last_step === null ? null : Number(r.totp_last_step));
  if (step === null) throw new GameError("Der Code stimmt nicht. Prüfe die Uhrzeit deines Geräts und versuche es erneut.", 401);
  await query(pool(), "update accounts set totp_last_step = $2, totp_enabled_at = coalesce(totp_enabled_at, now()) where id = $1", [accountId, step]);
  if (token) await query(pool(), "update sessions set mfa_at = now() where token = $1", [hashToken(token)]);
  return { ok: true, message: r.totp_enabled_at ? "Anmeldung bestätigt" : "Zwei-Faktor-Anmeldung eingerichtet" };
}
