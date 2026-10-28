/**
 * Barrierefreiheit: prüft die Hauptseiten mit axe-core (WCAG 2.1 A/AA).
 * Bricht ab, wenn schwere oder kritische Verstösse gefunden werden.
 *
 *   E2E_URL=http://localhost:3000 node apps/web/e2e/a11y.mjs [--report]
 */
import { chromium } from "playwright";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");
const B = process.env.E2E_URL ?? "http://localhost:3000";
const REPORT = process.argv.includes("--report");
const browser = await chromium.launch();
const results = [];

async function scan(page, name) {
  await page.waitForTimeout(700);
  await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(" ") + (n.any[0]?.data?.contrastRatio ? ` [${n.any[0].data.fgColor} auf ${n.any[0].data.bgColor} = ${n.any[0].data.contrastRatio}]` : "")) }));
  });
  results.push({ page: name, violations: r });
}

// axe wird als Skript eingespielt – nur im Testbrowser an der CSP vorbei
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
const page = await ctx.newPage();
page.setDefaultTimeout(30_000);
const api = (p, b) => page.evaluate(async ([p, b]) => {
  const r = await fetch("/api/" + p, { method: b ? "POST" : "GET", headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j;
}, [p, b]);

for (const [path, name] of [["/", "Startseite"], ["/login", "Anmelden"], ["/register", "Registrieren"], ["/impressum", "Impressum"], ["/datenschutz", "Datenschutz"], ["/neuigkeiten", "Neuigkeiten"]]) {
  await page.goto(B + path);
  await scan(page, name);
}
await api("auth/register", { email: `a11y${Date.now()}@example.com`, password: "geheim123", displayName: "A11y", acceptTerms: true, ageConfirmed: true });
const prev = await api("world/preview?seed=5&country=GER");
const { id } = await api("careers", { managerName: "A11y", countryCode: "GER", clubIndex: prev[0].clubs[3].index, seed: 5 });
await api(`careers/${id}/onboarding`, { action: "tour" });
for (const [path, name] of [["", "Büro"], ["/team", "Kader"], ["/team/tactic", "Taktik"], ["/team/training", "Training"], ["/team/youth", "Jugend"], ["/market", "Transfers"],
  ["/competition", "Wettbewerb"], ["/career", "Karriere"], ["/career/settings", "Einstellungen"], ["/assistant", "Co-Trainer"], ["/calendar", "Kalender"], ["/media", "Medien"]]) {
  await page.goto(`${B}/c/${id}${path}`);
  await scan(page, name);
}
await page.goto(`${B}/careers`);
await scan(page, "Karrieren");
// Helles Design: dieselben Hauptseiten noch einmal
await page.evaluate(() => localStorage.setItem("fl-theme", "light"));
for (const [path, name] of [["", "Büro"], ["/team", "Kader"], ["/team/tactic", "Taktik"], ["/market", "Transfers"], ["/competition", "Wettbewerb"], ["/career", "Karriere"], ["/media", "Medien"]]) {
  await page.goto(`${B}/c/${id}${path}`);
  await scan(page, `${name} (hell)`);
}
await browser.close();

let serious = 0;
for (const r of results) {
  for (const v of r.violations) {
    if (v.impact === "serious" || v.impact === "critical") serious++;
    if (REPORT || v.impact === "serious" || v.impact === "critical") console.log(`${r.page.padEnd(20)} ${String(v.impact).padEnd(9)} ${v.id} (${v.nodes}) – ${v.help} – ${v.sample.join(" | ")}`);
  }
}
console.log(`\n${results.length} Seiten geprüft, ${serious} schwere oder kritische Verstösse.`);
if (serious && !REPORT) process.exit(1);
