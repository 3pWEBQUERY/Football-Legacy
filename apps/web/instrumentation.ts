/** Beim Serverstart: Datenbank-Migrationen anwenden. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SKIP_MIGRATIONS === "true") return;
  const { migrate } = await import("@fl/game");
  try {
    await migrate((m) => console.log(`[db] ${m}`));
  } catch (e) {
    console.error("[db] Migration fehlgeschlagen", e);
  }
}
