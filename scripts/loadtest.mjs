/**
 * Lasttest: simuliert gleichzeitige Spieler (Registrierung, Karriere anlegen,
 * Tage weiterspielen, Spiele per Sofortergebnis) und misst Antwortzeiten.
 *
 *   LOAD_URL=http://localhost:3000 node scripts/loadtest.mjs [Spieler=20] [Aktionen je Spieler=30]
 *
 * Gegen einen lokalen Server: Jeder virtuelle Spieler schickt eine eigene
 * X-Real-IP, damit das Registrierungslimit je IP nicht greift. Hinter Railway
 * überschreibt der Proxy diesen Header – dort nur mit wenigen Spielern testen.
 */
const B = process.env.LOAD_URL ?? "http://localhost:3000";
const USERS = Number(process.argv[2] ?? 20);
const ACTIONS = Number(process.argv[3] ?? 30);

const timings = new Map(); // Kategorie → Millisekunden[]
const errors = new Map();
const note = (kind, ms) => (timings.get(kind) ?? timings.set(kind, []).get(kind)).push(ms);
const fail = (kind, msg) => errors.set(`${kind}: ${msg}`, (errors.get(`${kind}: ${msg}`) ?? 0) + 1);

async function call(kind, ctx, path, body) {
  const t0 = performance.now();
  const res = await fetch(`${B}/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-real-ip": ctx.ip, ...(ctx.token ? { authorization: `Bearer ${ctx.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }));
  const json = await res.json().catch(() => ({}));
  note(kind, performance.now() - t0);
  if (!res.ok) { fail(kind, `${res.status} ${json.error ?? ""}`.slice(0, 120)); return null; }
  return json;
}

async function player(i) {
  const ctx = { ip: `10.77.${Math.floor(i / 250)}.${(i % 250) + 1}`, token: null };
  const reg = await call("Registrierung", ctx, "auth/register", { email: `load${Date.now()}_${i}@example.com`, password: "geheim123", displayName: `Last ${i}`, acceptTerms: true, ageConfirmed: true, returnToken: true });
  if (!reg?.token) return;
  ctx.token = reg.token;
  const prev = await call("Vorschau", ctx, `world/preview?seed=${100 + i}&country=GER`);
  if (!prev) return;
  const car = await call("Karriere anlegen", ctx, "careers", { managerName: `Last ${i}`, countryCode: "GER", clubIndex: prev[0].clubs[i % prev[0].clubs.length].index, seed: 100 + i });
  if (!car?.id) return;
  await call("Büro laden", ctx, `careers/${car.id}/dashboard`);
  for (let a = 0; a < ACTIONS; a++) {
    const r = await call("Weiter (Tag)", ctx, `careers/${car.id}/advance`, {});
    if (r?.kind === "match") await call("Sofortergebnis (Spieltag)", ctx, `careers/${car.id}/match/quick`, {});
    if (a % 10 === 5) await call("Kader laden", ctx, `careers/${car.id}/squad`);
  }
}

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const t0 = performance.now();
console.log(`Lasttest gegen ${B}: ${USERS} gleichzeitige Spieler, je ${ACTIONS} Aktionen`);
await Promise.all(Array.from({ length: USERS }, (_, i) => player(i)));
const secs = (performance.now() - t0) / 1000;
let total = 0;
console.log(`\nDauer ${secs.toFixed(1)} s\n`);
console.log("Kategorie".padEnd(28), "Anzahl".padStart(7), "p50 ms".padStart(8), "p95 ms".padStart(8), "max ms".padStart(8));
for (const [kind, xs] of timings) {
  xs.sort((a, b) => a - b);
  total += xs.length;
  console.log(kind.padEnd(28), String(xs.length).padStart(7), pct(xs, 50).toFixed(0).padStart(8), pct(xs, 95).toFixed(0).padStart(8), xs[xs.length - 1].toFixed(0).padStart(8));
}
console.log(`\n${total} Anfragen, ${(total / secs).toFixed(1)} pro Sekunde`);
if (errors.size) {
  console.log("\nFehler:");
  for (const [k, n] of errors) console.log(`  ${n}× ${k}`);
  process.exitCode = 1;
} else console.log("Keine Fehler.");
const health = await fetch(`${B}/api/health`).then((r) => r.json()).catch(() => null);
if (health) console.log(`Warteschlange am Ende: ${health.queued}, Worker: ${health.workers}`);
