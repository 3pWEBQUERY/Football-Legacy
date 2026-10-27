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
    // Die Datenbank ist beim Start nicht immer sofort erreichbar (privates Netz, Neustart):
    // mehrfach mit wachsender Wartezeit versuchen (insgesamt gut eine Minute)
    const waits = [2, 4, 8, 15, 30];
    for (let attempt = 0; ; attempt++) {
      try {
        await migrate((m) => console.log(`[db] ${m}`));
        break;
      } catch (e) {
        if (attempt >= waits.length) {
          console.error("[db] Migration endgültig fehlgeschlagen", e);
          break;
        }
        console.warn(`[db] Migration fehlgeschlagen (${(e as Error).message}) – neuer Versuch in ${waits[attempt]} s`);
        await new Promise((r) => setTimeout(r, waits[attempt] * 1000));
      }
    }
  }
  const { startWorkerProcess } = await import("./lib/server/worker-process");
  startWorkerProcess();
  // KI-Anbindung prüfen (nur mit ANTHROPIC_API_KEY, höchstens alle 12 Stunden)
  const { aiSelfTest } = await import("@fl/game");
  void aiSelfTest().catch((e) => console.error("[ai] Selbsttest fehlgeschlagen", e));
}
