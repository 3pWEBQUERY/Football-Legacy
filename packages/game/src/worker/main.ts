/**
 * Startpunkt des Hintergrunddienstes (eigener Prozess). Wird vom Webserver als
 * Kindprozess gestartet oder als eigener Dienst: `node worker.cjs` bzw.
 * `pnpm --filter @fl/game worker`. WORKER_CONCURRENCY: parallele Aufträge.
 */
import { migrate } from "../migrate";
import { startWorker } from "./worker";

async function main() {
  // Datenbank beim Start evtl. noch nicht erreichbar: mehrfach versuchen
  for (const wait of [2, 4, 8, 15, 30, 0]) {
    try {
      await migrate((m) => console.log(`[db] ${m}`));
      break;
    } catch (e) {
      if (!wait) throw e;
      console.warn(`[worker] Datenbank nicht bereit (${(e as Error).message}) – neuer Versuch in ${wait} s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
  const w = startWorker({ concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2), log: (m) => console.log(m) });
  await w.ready;
  let stopping = false;
  const stop = async (why: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] beende (${why})`);
    await w.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
  // Als Kindprozess des Webservers: mit ihm beenden
  process.on("disconnect", () => void stop("Webserver beendet"));
}

main().catch((e) => {
  console.error("[worker] Start fehlgeschlagen", e);
  process.exit(1);
});
