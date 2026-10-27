/** Startet den gebündelten Hintergrunddienst als Kindprozess und startet ihn nach Abstürzen neu. */
import { spawn as spawnProcess, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

let child: ChildProcess | null = null;
let restarts = 0;

export function startWorkerProcess() {
  const mode = process.env.WORKER_MODE ?? "fork";
  if (mode === "off" || process.env.JOB_MODE === "inline") return;
  // Laufzeitpfad, nicht vom Bundler auflösen lassen
  const script = process.env.WORKER_SCRIPT ?? path.join(/* turbopackIgnore: true */ process.cwd(), "worker.cjs");
  if (!existsSync(script)) {
    console.log("[worker] worker.cjs nicht gefunden – Berechnungen laufen direkt im Webserver");
    return;
  }
  const spawn = () => {
    // Mit IPC-Kanal: endet der Webserver, beendet sich der Dienst selbst ("disconnect")
    child = spawnProcess(process.execPath, [script], { env: { ...process.env, WORKER_PARENT: String(process.pid) }, stdio: ["inherit", "inherit", "inherit", "ipc"] });
    child.on("exit", (code, signal) => {
      child = null;
      if (signal === "SIGTERM" || signal === "SIGINT") return;
      restarts++;
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(restarts, 6));
      console.error(`[worker] beendet (Code ${code ?? signal}) – Neustart in ${Math.round(delay / 1000)} s`);
      setTimeout(spawn, delay).unref();
    });
  };
  spawn();
  const stop = () => { child?.kill("SIGTERM"); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.once("exit", stop);
}
