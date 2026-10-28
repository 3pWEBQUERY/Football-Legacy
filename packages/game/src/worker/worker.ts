/**
 * Hintergrunddienst: holt Aufträge aus sim_jobs (FOR UPDATE SKIP LOCKED, also
 * auch mit mehreren Prozessen sicher), führt sie aus und speichert Ergebnis
 * oder Fehler. Wartet niemand mehr auf das Ergebnis, gibt es eine Push-
 * Mitteilung. Nebenbei: Lebenszeichen, verwaiste Aufträge neu einplanen,
 * alte Aufträge löschen und fällige Spieltage täglicher Online-Ligen spielen.
 */
import os from "node:os";
import { retentionSweep } from "../account/retention";
import { cleanupNewsImages } from "../site-news";
import crypto from "node:crypto";
import type pg from "pg";
import { one, pool, query } from "../db";
import { GameError } from "../errors";
import { notify } from "../account/push";
import { playDueOnlineLeagues } from "../online";
import { taskHandler } from "./queue";
import { captureException } from "../monitoring";
import "./tasks";

interface JobRow { id: number; kind: string; account_id: string | null; career_id: string | null; payload: unknown[] }
export interface WorkerOptions { concurrency?: number; idleMs?: number; schedule?: boolean; log?: (m: string) => void }

const DONE_MESSAGE: Record<string, string> = {
  createCareer: "Deine neue Welt ist erschaffen – die Karriere kann beginnen.",
  advance: "Der Spieltag ist fertig gerechnet.",
  quickMatch: "Dein Spiel ist fertig gerechnet.",
};

export function startWorker(opts: WorkerOptions = {}) {
  const id = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;
  const log = opts.log ?? (() => {});
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const idleMs = opts.idleMs ?? 2000;
  let running = true;
  let listener: pg.PoolClient | null = null;
  const wakers = new Set<() => void>();
  const wake = () => { for (const w of [...wakers]) w(); };
  const timers: NodeJS.Timeout[] = [];
  let jobs = 0;

  const idle = () => new Promise<void>((resolve) => {
    const done = () => { clearTimeout(t); wakers.delete(done); resolve(); };
    const t = setTimeout(done, idleMs);
    wakers.add(done);
  });

  async function heartbeat() {
    await query(pool(),
      `insert into sim_workers(id, host, pid, seen_at, jobs) values ($1,$2,$3, now(), $4)
       on conflict (id) do update set seen_at = now(), jobs = excluded.jobs`, [id, os.hostname(), process.pid, jobs]);
    // Aufträge abgestürzter Dienste wieder einplanen (ihre Transaktion wurde zurückgerollt)
    await query(pool(),
      `update sim_jobs set status = 'queued', worker = null, started_at = null
       where status = 'running' and worker not in (select id from sim_workers where seen_at > now() - interval '2 minutes')`);
  }

  async function claim(): Promise<JobRow | null> {
    return one<JobRow>(pool(),
      `update sim_jobs set status = 'running', started_at = now(), worker = $1
       where id = (select id from sim_jobs where status = 'queued' order by id for update skip locked limit 1)
       returning id, kind, account_id, career_id, payload`, [id]);
  }

  async function execute(job: JobRow) {
    const fn = taskHandler(job.kind);
    const t0 = Date.now();
    try {
      if (!fn) throw new GameError(`Unbekannte Aufgabe: ${job.kind}`, 500);
      const value = await fn(...(Array.isArray(job.payload) ? job.payload : []));
      await query(pool(), "update sim_jobs set status = 'done', result = $2, finished_at = now() where id = $1", [job.id, JSON.stringify({ value })]);
    } catch (e) {
      const status = e instanceof GameError ? e.status : 500;
      const message = e instanceof GameError ? e.message : "Interner Fehler bei der Berechnung";
      if (!(e instanceof GameError)) captureException(e, { source: "worker", path: `job:${job.kind}`, accountId: job.account_id });
      await query(pool(), "update sim_jobs set status = 'failed', error = $2, finished_at = now() where id = $1", [job.id, JSON.stringify({ message, status })]);
    }
    jobs++;
    log(`[worker] ${job.kind} #${job.id} in ${Date.now() - t0} ms`);
    // Niemand wartet mehr (Seite geschlossen oder Zeitlimit): per Push melden
    const row = await one<{ waiting: boolean; status: string }>(pool(),
      "select polled_at > now() - interval '4 seconds' as waiting, status from sim_jobs where id = $1", [job.id]);
    if (row && !row.waiting && row.status === "done" && Date.now() - t0 >= Number(process.env.JOB_PUSH_AFTER_MS ?? 3000) && job.account_id && DONE_MESSAGE[job.kind]) {
      await notify([job.account_id], "jobs", {
        title: "Football Legacy", body: DONE_MESSAGE[job.kind], tag: `job-${job.career_id ?? job.id}`,
        url: job.career_id ? `/c/${job.career_id}` : "/careers",
      }).catch(() => 0);
    }
  }

  async function slot() {
    while (running) {
      const job = await claim().catch((e) => { console.error("[worker] Abruf fehlgeschlagen", e); return null; });
      if (job) await execute(job).catch((e) => console.error(`[worker] Auftrag ${job.id}`, e));
      else await idle();
    }
  }

  async function maintenance() {
    await query(pool(), "delete from sim_jobs where finished_at < now() - interval '1 day'");
    await query(pool(), "delete from sim_workers where seen_at < now() - interval '1 day'");
    await retentionSweep();
    await cleanupNewsImages();
  }

  const ready = (async () => {
    await heartbeat();
    listener = await pool().connect();
    await listener.query("listen fl_jobs");
    listener.on("notification", wake);
    timers.push(setInterval(() => heartbeat().catch((e) => console.error("[worker] Lebenszeichen", e)), 5000));
    timers.push(setInterval(() => maintenance().catch((e) => console.error("[worker] Wartung", e)), 60 * 60 * 1000));
    setTimeout(() => maintenance().catch((e) => console.error("[worker] Wartung", e)), 30_000).unref?.();
    if (opts.schedule !== false) {
      const due = () => playDueOnlineLeagues().then((n) => n && log(`[worker] ${n} Online-Spieltag(e) gespielt`)).catch((e) => console.error("[worker] Online-Ligen", e));
      timers.push(setInterval(due, 60_000));
      void due();
    }
    log(`[worker] ${id} bereit (${concurrency} parallel)`);
  })();
  const loops = ready.then(() => Promise.all(Array.from({ length: concurrency }, slot)));

  return {
    id,
    ready,
    async stop() {
      running = false;
      timers.forEach(clearInterval);
      wake();
      await ready.catch(() => {});
      await loops.catch(() => {});
      if (listener) {
        await listener.query("unlisten fl_jobs").catch(() => {});
        listener.release();
        listener = null;
      }
      await query(pool(), "delete from sim_workers where id = $1", [id]).catch(() => {});
    },
  };
}
