/**
 * Warteschlange für Rechenaufträge. Läuft ein Hintergrunddienst (sim_workers
 * mit frischem Lebenszeichen), legt die Web-Anfrage einen Auftrag in sim_jobs
 * an und wartet nur noch auf das Ergebnis – die eigentliche Simulation blockiert
 * so nicht den Webserver. Ohne Dienst wird direkt in der Anfrage gerechnet.
 *
 * JOB_MODE: "auto" (Standard), "inline" (nie Warteschlange), "queue" (immer).
 */
import { one, pool, query } from "../db";
import { GameError } from "../errors";

export interface JobMeta { accountId?: string | null; careerId?: string | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => Promise<unknown>;

const handlers = new Map<string, Handler>();
let online = { at: 0, value: false };

export function registerTask(name: string, fn: Handler) {
  handlers.set(name, fn);
}

export function taskHandler(name: string): Handler | undefined {
  return handlers.get(name);
}

/** Läuft gerade mindestens ein Hintergrunddienst? (3 s zwischengespeichert) */
export async function workerOnline(): Promise<boolean> {
  const mode = process.env.JOB_MODE ?? "auto";
  if (mode === "inline") return false;
  if (mode === "queue") return true;
  if (Date.now() - online.at < 3000) return online.value;
  const r = await one<{ n: number }>(pool(), "select count(*)::int as n from sim_workers where seen_at > now() - interval '45 seconds'").catch(() => null);
  online = { at: Date.now(), value: (r?.n ?? 0) > 0 };
  return online.value;
}

export function resetWorkerCache() {
  online = { at: 0, value: false };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Führt eine registrierte Aufgabe aus – über den Hintergrunddienst, falls vorhanden. */
export async function runTask<T>(name: string, args: unknown[], meta: JobMeta): Promise<T> {
  const fn = handlers.get(name);
  if (!fn) throw new Error(`Unbekannte Aufgabe: ${name}`);
  if (!(await workerOnline())) return (await fn(...args)) as T;
  const job = await one<{ id: number }>(pool(),
    "insert into sim_jobs(kind, account_id, career_id, payload, polled_at) values ($1,$2,$3,$4, now()) returning id",
    [name, meta.accountId ?? null, meta.careerId ?? null, JSON.stringify(args)]);
  await query(pool(), "select pg_notify('fl_jobs', $1)", [String(job!.id)]);
  return waitForJob<T>(job!.id);
}

async function waitForJob<T>(id: number): Promise<T> {
  const limit = Number(process.env.JOB_WAIT_MS ?? 150_000);
  const start = Date.now();
  let delay = 30;
  while (Date.now() - start < limit) {
    await sleep(delay);
    delay = Math.min(250, Math.round(delay * 1.4));
    // polled_at zeigt dem Dienst, dass noch jemand auf das Ergebnis wartet
    const j = await one<{ status: string; result: { value?: T } | null; error: { message?: string; status?: number } | null }>(pool(),
      "update sim_jobs set polled_at = now() where id = $1 returning status, result, error", [id]);
    if (!j) throw new GameError("Rechenauftrag nicht gefunden", 500);
    if (j.status === "done") return j.result?.value as T;
    if (j.status === "failed") throw new GameError(j.error?.message ?? "Unbekannter Fehler", j.error?.status ?? 500);
  }
  throw new GameError("Die Berechnung dauert ungewöhnlich lange. Sie läuft im Hintergrund weiter – lade die Seite gleich neu.", 503);
}

/** Kennzahlen für /api/health und die Einstellungen. */
export async function workerStatus() {
  const r = await one<{ workers: number; queued: number; running: number; done_hour: number; avg_ms: number | null }>(pool(), `
    select (select count(*)::int from sim_workers where seen_at > now() - interval '45 seconds') as workers,
           (select count(*)::int from sim_jobs where status = 'queued') as queued,
           (select count(*)::int from sim_jobs where status = 'running') as running,
           (select count(*)::int from sim_jobs where finished_at > now() - interval '1 hour') as done_hour,
           (select round(avg(extract(epoch from finished_at - started_at) * 1000))::int from sim_jobs where finished_at > now() - interval '1 hour') as avg_ms`);
  return { mode: process.env.JOB_MODE ?? "auto", ...r };
}
