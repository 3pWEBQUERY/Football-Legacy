/**
 * Fehlerüberwachung: Unerwartete Fehler aus Webserver, Hintergrunddienst und
 * Browser landen gruppiert im Fehlerprotokoll (error_log, 30 Tage). Ist
 * SENTRY_DSN gesetzt, gehen sie zusätzlich an Sentry. Die Übersicht sehen
 * nur Accounts aus ADMIN_EMAILS (kommagetrennt).
 */
import crypto from "node:crypto";
import { one, pool, query } from "./db";
import { GameError } from "./errors";
import { CLIENT_ERRORS_PER_IP, guard, record } from "./account/limits";

export type ErrorSource = "server" | "worker" | "client";
export interface ErrorReport { source: ErrorSource; message: string; stack?: string | null; path?: string | null; accountId?: string | null; userAgent?: string | null }

/** Gleiche Fehler höchstens so oft pro Stunde speichern (gegen Fluten). */
const MAX_PER_HOUR = 50;

const cut = (s: string | null | undefined, n: number) => (s ? String(s).slice(0, n) : null);

function fingerprint(r: ErrorReport): string {
  // Zahlen und IDs entfernen, damit gleiche Fehler zusammenfallen
  const msg = r.message.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>").replace(/\d+/g, "<n>").slice(0, 200);
  const frame = (r.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "";
  return crypto.createHash("sha1").update(`${r.source}|${msg}|${frame.replace(/:\d+:\d+/g, "")}`).digest("hex").slice(0, 16);
}

export async function reportError(r: ErrorReport): Promise<void> {
  try {
    const fp = fingerprint(r);
    const recent = await one<{ n: number }>(pool(), "select count(*)::int as n from error_log where fingerprint = $1 and created_at > now() - interval '1 hour'", [fp]);
    if ((recent?.n ?? 0) >= MAX_PER_HOUR) return;
    await query(pool(),
      "insert into error_log(source, message, stack, path, account_id, user_agent, fingerprint) values ($1,$2,$3,$4,$5,$6,$7)",
      [r.source, cut(r.message, 1000) ?? "Unbekannter Fehler", cut(r.stack, 6000), cut(r.path, 300), r.accountId ?? null, cut(r.userAgent, 300), fp]);
    if (Math.random() < 0.02) await query(pool(), "delete from error_log where created_at < now() - interval '30 days'");
    await toSentry(r, fp);
  } catch (e) {
    console.error("[monitoring] Fehler konnte nicht gespeichert werden", e);
  }
}

/** Fehler aus einem catch-Block melden (GameError sind erwartete Meldungen und werden ignoriert). */
export function captureException(e: unknown, ctx: Omit<ErrorReport, "message" | "stack">) {
  if (e instanceof GameError) return;
  const err = e instanceof Error ? e : new Error(String(e));
  console.error(err);
  void reportError({ ...ctx, message: `${err.name}: ${err.message}`, stack: err.stack ?? null });
}

/** Minimaler Versand an Sentry über die Envelope-API (kein SDK nötig). */
async function toSentry(r: ErrorReport, fp: string) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const u = new URL(dsn);
  const project = u.pathname.replace(/^\//, "");
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: r.source === "client" ? "javascript" : "node",
    level: "error",
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "production",
    fingerprint: [fp],
    tags: { source: r.source },
    request: r.path ? { url: r.path, headers: r.userAgent ? { "User-Agent": r.userAgent } : undefined } : undefined,
    user: r.accountId ? { id: r.accountId } : undefined,
    exception: { values: [{ type: r.message.split(":")[0] || "Error", value: r.message, stacktrace: undefined }] },
    extra: r.stack ? { stack: r.stack.slice(0, 6000) } : undefined,
  };
  const body = `${JSON.stringify({ event_id: eventId, dsn, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
  await fetch(`${u.protocol}//${u.host}/api/${project}/envelope/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${u.username}, sentry_client=football-legacy/1.0` },
    body,
  }).catch(() => {});
}

/** Browser-Meldungen begrenzen, damit niemand das Protokoll fluten kann. */
export async function guardErrorReports(ip: string | null) {
  await guard(CLIENT_ERRORS_PER_IP, ip ?? "unknown", "Zu viele Fehlermeldungen");
  await record(CLIENT_ERRORS_PER_IP, ip ?? "unknown");
}

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return (process.env.ADMIN_EMAILS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

/** Übersicht der letzten 7 Tage, gruppiert nach Fehler. */
export async function errorOverview(email: string) {
  if (!isAdmin(email)) throw new GameError("Nur für Administratoren", 403);
  const groups = await query<{ fingerprint: string; source: string; message: string; path: string | null; count: number; first_at: string; last_at: string; users: number; stack: string | null }>(pool(), `
    select fingerprint, min(source) as source, (array_agg(message order by created_at desc))[1] as message, (array_agg(path order by created_at desc))[1] as path,
           count(*)::int as count, min(created_at) as first_at, max(created_at) as last_at, count(distinct account_id)::int as users,
           (array_agg(stack order by created_at desc))[1] as stack
      from error_log where created_at > now() - interval '7 days'
     group by fingerprint order by max(created_at) desc limit 100`);
  const totals = await one<{ day: number; week: number }>(pool(),
    "select count(*) filter (where created_at > now() - interval '1 day')::int as day, count(*)::int as week from error_log where created_at > now() - interval '7 days'");
  return { groups, totals: totals ?? { day: 0, week: 0 }, sentry: !!process.env.SENTRY_DSN };
}
