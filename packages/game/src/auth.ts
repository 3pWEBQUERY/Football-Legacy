import crypto from "node:crypto";
import { promisify } from "node:util";
import { one, pool, query } from "./db";
import { GameError } from "./errors";
import { TERMS_VERSION } from "./account/terms";
import { LOGIN_PER_EMAIL, LOGIN_PER_IP, REGISTER_PER_IP, clear, guard, record } from "./account/limits";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 30;

export interface Account {
  id: string;
  email: string;
  display_name: string;
  settings: Record<string, unknown>;
  login_streak: number;
  best_login_streak: number;
  last_login_day: string | null;
  terms_version?: number;
  email_verified_at?: string | null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function register(email: string, password: string, displayName: string, consent?: { acceptTerms: true; ageConfirmed: true }, opts: { ip?: string | null } = {}): Promise<{ account: Account; token: string }> {
  const e = normalizeEmail(email);
  await guard(REGISTER_PER_IP, opts.ip, "Von deinem Netzwerk wurden gerade schon mehrere Accounts angelegt. Bitte versuche es in einer Stunde erneut.");
  await record(REGISTER_PER_IP, opts.ip);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new GameError("Bitte gib eine gültige E-Mail-Adresse ein.");
  if (password.length < 8) throw new GameError("Das Passwort muss mindestens 8 Zeichen lang sein.");
  const name = displayName.trim().slice(0, 40) || e.split("@")[0];
  const existing = await one(pool(), "select id from accounts where email = $1", [e]);
  if (existing) throw new GameError("Für diese E-Mail-Adresse gibt es bereits einen Account.");
  const hash = await hashPassword(password);
  const account = await one<Account>(
    pool(),
    `insert into accounts(email, password_hash, display_name, terms_version, terms_accepted_at, age_confirmed) values ($1, $2, $3, $4, $5, $6)
     returning id, email, display_name, settings, login_streak, best_login_streak, last_login_day, terms_version, email_verified_at`,
    [e, hash, name, consent ? TERMS_VERSION : 0, consent ? new Date() : null, !!consent],
  );
  const token = await createSession(account!.id);
  await touchLoginStreak(account!.id);
  return { account: account!, token };
}

export async function login(email: string, password: string, opts: { ip?: string | null } = {}): Promise<{ account: Account; token: string }> {
  const e = normalizeEmail(email);
  await guard(LOGIN_PER_EMAIL, e, "Zu viele fehlgeschlagene Anmeldungen für diese Adresse. Bitte warte 15 Minuten oder setze dein Passwort zurück.");
  await guard(LOGIN_PER_IP, opts.ip, "Zu viele fehlgeschlagene Anmeldungen von deinem Netzwerk. Bitte warte 15 Minuten.");
  const row = await one<Account & { password_hash: string }>(pool(), "select * from accounts where email = $1", [e]);
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    await record(LOGIN_PER_EMAIL, e);
    await record(LOGIN_PER_IP, opts.ip);
    throw new GameError("E-Mail oder Passwort ist falsch.", 401);
  }
  await clear(LOGIN_PER_EMAIL, e);
  const ban = await one<{ banned: boolean; until: string | null; reason: string | null }>(pool(),
    "select coalesce(banned_until > now(), false) as banned, to_char(nullif(banned_until, 'infinity'), 'DD.MM.YYYY') as until, ban_reason as reason from accounts where id = $1", [row.id]);
  if (ban?.banned) {
    throw new GameError(`Dein Konto ist ${ban.until ? `bis ${ban.until}` : "dauerhaft"} gesperrt. Grund: ${ban.reason ?? "Verstoss gegen die Nutzungsbedingungen"}.`, 403);
  }
  const token = await createSession(row.id);
  await touchLoginStreak(row.id);
  const { password_hash: _ignored, banned_until: _b, ban_reason: _r, ...account } = row as typeof row & { banned_until?: unknown; ban_reason?: unknown };
  return { account, token };
}

export async function createSession(accountId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await query(pool(), "insert into sessions(token, account_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)", [
    hashToken(token), accountId, String(SESSION_DAYS),
  ]);
  return token;
}

/** Tokens werden nur gehasht gespeichert. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function accountForToken(token: string | undefined | null): Promise<Account | null> {
  if (!token) return null;
  return one<Account>(
    pool(),
    `select a.id, a.email, a.display_name, a.settings, a.login_streak, a.best_login_streak, a.last_login_day, a.terms_version, a.email_verified_at
       from sessions s join accounts a on a.id = s.account_id
      where s.token = $1 and s.expires_at > now() and (a.banned_until is null or a.banned_until < now())`,
    [hashToken(token)],
  );
}

export async function logout(token: string) {
  await query(pool(), "delete from sessions where token = $1", [hashToken(token)]);
}

/**
 * Login-Serie: zählt aufeinanderfolgende Tage. Liefert die neue Serie und ob
 * heute der erste Login war.
 */
export async function touchLoginStreak(accountId: string): Promise<{ streak: number; firstToday: boolean }> {
  const row = await one<{ login_streak: number; day_diff: number | null }>(
    pool(),
    "select login_streak, (current_date - last_login_day) as day_diff from accounts where id = $1",
    [accountId],
  );
  if (!row) return { streak: 0, firstToday: false };
  if (row.day_diff === 0) return { streak: row.login_streak, firstToday: false };
  const streak = row.day_diff === 1 ? row.login_streak + 1 : 1;
  await query(
    pool(),
    "update accounts set login_streak = $2, best_login_streak = greatest(best_login_streak, $2), last_login_day = current_date, inactivity_warned_at = null where id = $1",
    [accountId, streak],
  );
  return { streak, firstToday: true };
}

export async function updateSettings(accountId: string, settings: Record<string, unknown>) {
  await query(pool(), "update accounts set settings = settings || $2::jsonb where id = $1", [accountId, JSON.stringify(settings)]);
}

export async function updateProfile(accountId: string, displayName: string) {
  const name = displayName.trim().slice(0, 40);
  if (name.length < 2) throw new GameError("Der Name muss mindestens 2 Zeichen lang sein.");
  await query(pool(), "update accounts set display_name = $2 where id = $1", [accountId, name]);
  return { displayName: name };
}

/** Passwort ändern; alle anderen Sitzungen werden abgemeldet. */
export async function changePassword(accountId: string, currentToken: string | null, oldPassword: string, newPassword: string) {
  const row = await one<{ password_hash: string }>(pool(), "select password_hash from accounts where id = $1", [accountId]);
  if (!row || !(await verifyPassword(oldPassword, row.password_hash))) throw new GameError("Das aktuelle Passwort ist falsch.");
  if (newPassword.length < 8) throw new GameError("Das neue Passwort muss mindestens 8 Zeichen lang sein.");
  if (newPassword === oldPassword) throw new GameError("Das neue Passwort muss sich vom alten unterscheiden.");
  await query(pool(), "update accounts set password_hash = $2 where id = $1", [accountId, await hashPassword(newPassword)]);
  await query(pool(), "delete from sessions where account_id = $1 and token <> $2", [accountId, currentToken ? hashToken(currentToken) : ""]);
  return { ok: true };
}

/** Account mit allen Karrieren endgültig löschen. */
export async function deleteAccount(accountId: string, password: string) {
  const row = await one<{ password_hash: string }>(pool(), "select password_hash from accounts where id = $1", [accountId]);
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new GameError("Das Passwort ist falsch.");
  await query(pool(), "delete from admin_actions where target_account = $1", [accountId]);
  await query(pool(), "delete from accounts where id = $1", [accountId]);
  return { ok: true, clearCookie: true };
}
