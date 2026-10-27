/**
 * Einfache Limits gegen Passwort-Raten und Massenregistrierungen. Versuche
 * stehen in auth_attempts (Schlüssel: E-Mail oder IP-Adresse) und werden nach
 * einem Tag gelöscht.
 */
import { one, pool, query } from "../db";
import { GameError } from "../errors";

export interface Limit { kind: string; max: number; minutes: number }

/** Fehlgeschlagene Anmeldungen je E-Mail-Adresse und je IP-Adresse. */
export const LOGIN_PER_EMAIL: Limit = { kind: "login_email", max: 8, minutes: 15 };
export const LOGIN_PER_IP: Limit = { kind: "login_ip", max: 30, minutes: 15 };
/** Registrierungen je IP-Adresse. */
export const REGISTER_PER_IP: Limit = { kind: "register_ip", max: 5, minutes: 60 };
/** Fehlermeldungen aus dem Browser je IP-Adresse. */
export const CLIENT_ERRORS_PER_IP: Limit = { kind: "client_error", max: 30, minutes: 10 };
/** Bestätigungs-Mails je Account. */
export const VERIFY_PER_ACCOUNT: Limit = { kind: "verify_mail", max: 3, minutes: 60 };

export async function attempts(limit: Limit, key: string): Promise<number> {
  const r = await one<{ n: number }>(pool(),
    "select count(*)::int as n from auth_attempts where kind = $1 and key = $2 and created_at > now() - ($3 || ' minutes')::interval",
    [limit.kind, key, String(limit.minutes)]);
  return r?.n ?? 0;
}

/** Wirft 429, wenn das Limit erreicht ist. */
export async function guard(limit: Limit, key: string | null | undefined, message?: string) {
  if (!key) return;
  if ((await attempts(limit, key)) >= limit.max) {
    throw new GameError(message ?? `Zu viele Versuche. Bitte warte ${limit.minutes} Minuten und versuche es dann erneut.`, 429);
  }
}

export async function record(limit: Limit, key: string | null | undefined) {
  if (!key) return;
  await query(pool(), "insert into auth_attempts(kind, key) values ($1, $2)", [limit.kind, key]);
  // Gelegentlich aufräumen
  if (Math.random() < 0.02) await query(pool(), "delete from auth_attempts where created_at < now() - interval '1 day'");
}

export async function clear(limit: Limit, key: string | null | undefined) {
  if (!key) return;
  await query(pool(), "delete from auth_attempts where kind = $1 and key = $2", [limit.kind, key]);
}
