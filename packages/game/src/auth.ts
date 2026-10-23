import crypto from "node:crypto";
import { promisify } from "node:util";
import { one, pool, query } from "./db";
import { GameError } from "./errors";

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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function register(email: string, password: string, displayName: string): Promise<{ account: Account; token: string }> {
  const e = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new GameError("Bitte gib eine gültige E-Mail-Adresse ein.");
  if (password.length < 8) throw new GameError("Das Passwort muss mindestens 8 Zeichen lang sein.");
  const name = displayName.trim().slice(0, 40) || e.split("@")[0];
  const existing = await one(pool(), "select id from accounts where email = $1", [e]);
  if (existing) throw new GameError("Für diese E-Mail-Adresse gibt es bereits einen Account.");
  const hash = await hashPassword(password);
  const account = await one<Account>(
    pool(),
    "insert into accounts(email, password_hash, display_name) values ($1, $2, $3) returning id, email, display_name, settings, login_streak, best_login_streak, last_login_day",
    [e, hash, name],
  );
  const token = await createSession(account!.id);
  await touchLoginStreak(account!.id);
  return { account: account!, token };
}

export async function login(email: string, password: string): Promise<{ account: Account; token: string }> {
  const row = await one<Account & { password_hash: string }>(pool(), "select * from accounts where email = $1", [normalizeEmail(email)]);
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw new GameError("E-Mail oder Passwort ist falsch.", 401);
  }
  const token = await createSession(row.id);
  await touchLoginStreak(row.id);
  const { password_hash: _ignored, ...account } = row;
  return { account, token };
}

async function createSession(accountId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await query(pool(), "insert into sessions(token, account_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)", [
    hashToken(token), accountId, String(SESSION_DAYS),
  ]);
  return token;
}

/** Tokens werden nur gehasht gespeichert. */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function accountForToken(token: string | undefined | null): Promise<Account | null> {
  if (!token) return null;
  return one<Account>(
    pool(),
    `select a.id, a.email, a.display_name, a.settings, a.login_streak, a.best_login_streak, a.last_login_day
       from sessions s join accounts a on a.id = s.account_id
      where s.token = $1 and s.expires_at > now()`,
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
    "update accounts set login_streak = $2, best_login_streak = greatest(best_login_streak, $2), last_login_day = current_date where id = $1",
    [accountId, streak],
  );
  return { streak, firstToday: true };
}

export async function updateSettings(accountId: string, settings: Record<string, unknown>) {
  await query(pool(), "update accounts set settings = settings || $2::jsonb where id = $1", [accountId, JSON.stringify(settings)]);
}
