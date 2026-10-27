/**
 * Beim Serverstart: Datenbank-Migrationen anwenden und den Hintergrunddienst
 * (worker.cjs) als eigenen Prozess starten, damit Simulationen den Webserver
 * nicht blockieren. WORKER_MODE: "fork" (Standard, wenn worker.cjs vorhanden),
 * "off" (Dienst läuft separat, z. B. als eigener Railway-Service).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SKIP_MIGRATIONS !== "true") {
    const { migrate } = await import("@fl/game");
    try {
      await migrate((m) => console.log(`[db] ${m}`));
    } catch (e) {
      console.error("[db] Migration fehlgeschlagen", e);
    }
  }
  const { startWorkerProcess } = await import("./lib/server/worker-process");
  startWorkerProcess();
  // KI-Anbindung prüfen (nur mit ANTHROPIC_API_KEY, höchstens alle 12 Stunden)
  const { aiSelfTest } = await import("@fl/game");
  void aiSelfTest().catch((e) => console.error("[ai] Selbsttest fehlgeschlagen", e));
}
