/** Unerwartete Fehler im Browser an den Server melden (höchstens 5 pro Seitenaufruf, keine Dubletten). */
const seen = new Set<string>();
let sent = 0;

export function reportClientError(error: unknown, extra: { path?: string } = {}) {
  if (typeof window === "undefined") return;
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error)?.slice(0, 300) ?? "Unbekannter Fehler");
  const key = `${err.name}:${err.message}`;
  if (seen.has(key) || sent >= 5) return;
  // Abgebrochene Anfragen und Erweiterungen sind kein Fehler des Spiels
  if (/AbortError|ResizeObserver loop|chrome-extension:|moz-extension:/.test(`${key} ${err.stack ?? ""}`)) return;
  seen.add(key);
  sent++;
  void fetch("/api/errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: `${err.name}: ${err.message}`.slice(0, 1000), stack: (err.stack ?? "").slice(0, 6000), path: extra.path ?? window.location.pathname }),
    keepalive: true,
  }).catch(() => {});
}
