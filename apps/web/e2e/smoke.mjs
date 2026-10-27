/**
 * Browser-Test (Smoke): Registrierung, Karrierestart, alle Hauptseiten, ein
 * Spieltag, Passwort vergessen, Rechtstexte und Smartphone-Ansicht. Bricht bei
 * Seitenfehlern, Konsolenfehlern oder fehlenden Elementen mit Exit-Code 1 ab.
 *
 *   E2E_URL=http://localhost:3000 node apps/web/e2e/smoke.mjs [Screenshot-Ordner]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const B = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? null;
if (OUT) mkdirSync(OUT, { recursive: true });
const errors = [];
const step = (name) => console.log(`▶ ${name}`);
const fail = (msg) => { throw new Error(msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(30_000);
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  // Erwartete 4xx-Antworten der API (z. B. falsches Passwort) sind kein Fehler der Oberfläche
  if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`);
});
const api = (p, b) => page.evaluate(async ([p, b]) => {
  const r = await fetch("/api/" + p, { method: b ? "POST" : "GET", headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
}, [p, b]);
const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` }); };

try {
  step("Health");
  const health = await page.request.get(`${B}/api/health`);
  if (!health.ok()) fail(`Health-Check ${health.status()}`);

  step("Installierbare App");
  const manifest = await page.request.get(`${B}/manifest.webmanifest`);
  if (!manifest.ok() || (await manifest.json()).name !== "Football Legacy") fail("Manifest fehlt");
  for (const path of ["/sw.js", "/offline.html", "/icons/icon-192.png", "/icons/maskable-512.png"]) {
    if (!(await page.request.get(B + path)).ok()) fail(`${path} fehlt`);
  }

  step("Startseite und Rechtstexte");
  await page.goto(B);
  await page.getByRole("link", { name: "Impressum" }).first().waitFor();
  for (const [path, heading] of [["/impressum", "Impressum"], ["/datenschutz", "Datenschutzerklärung"], ["/nutzungsbedingungen", "Nutzungsbedingungen"]]) {
    await page.goto(B + path);
    await page.getByRole("heading", { name: heading, level: 1 }).waitFor();
  }

  step("Registrieren");
  const email = `e2e${Date.now()}@example.com`;
  await page.goto(`${B}/register`);
  await page.fill("#name", "E2E");
  await page.fill("#email", email);
  await page.fill("#pw", "geheim123");
  // Ohne Altersbestätigung und Zustimmung lässt der Server keine Registrierung zu
  const rejected = await page.evaluate(async (email) => (await fetch("/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x" + email, password: "geheim123", displayName: "X" }) })).status, email);
  if (rejected !== 400) fail(`Registrierung ohne Zustimmung: Status ${rejected}`);
  await page.locator(".consent input").check();
  await page.getByRole("button", { name: "Account erstellen" }).click();
  await page.waitForURL(/\/careers\/new/);

  step("Karriere starten");
  await page.locator("tr.clickable").first().click();
  await page.locator("section:has-text('Verein') tbody tr.clickable").nth(3).click();
  await page.getByRole("radio", { name: /Normal/ }).click();
  await page.getByRole("button", { name: /^Übernehmen$/ }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+$/, { timeout: 120_000 });
  const id = page.url().split("/c/")[1];
  await page.locator(".tour").waitFor();
  await shot("01-tour");
  await page.getByRole("button", { name: "Überspringen" }).click();
  await page.locator(".first-steps").waitFor();

  step("Hauptseiten");
  const pages = [
    ["/team", "Kader"], ["/team/tactic", "Taktik"], ["/team/training", "Training"], ["/team/youth", null], ["/team/medical", null],
    ["/market", null], ["/market/search", null], ["/market/contracts", null], ["/market/finances", null],
    ["/competition", null], ["/competition/cup", null], ["/board", "Vorstand"], ["/verein", null], ["/history", "Vereinsgeschichte"],
    ["/career", null], ["/career/hall", "Ruhmeshalle"], ["/career/help", "Hilfe & Glossar"], ["/career/settings", "Einstellungen"], ["/calendar", null],
  ];
  for (const [path, heading] of pages) {
    await page.goto(`${B}/c/${id}${path}`);
    await page.locator("h1").first().waitFor();
    if (heading) await page.getByRole("heading", { name: heading, level: 1 }).waitFor();
    if (await page.locator(".error-box, [role=alert].error").count()) fail(`Fehleranzeige auf ${path}`);
  }

  step("Bis zum ersten Spiel und Schnellsimulation");
  let matched = false;
  for (let i = 0; i < 80 && !matched; i++) {
    const r = await api(`careers/${id}/advance`, {});
    if (r.kind === "match") matched = true;
  }
  if (!matched) fail("Kein Spieltag erreicht");
  const week = await api(`careers/${id}/match/quick`, {});
  if (!week.userFixtureId) fail("Schnellsimulation ohne eigenes Spiel");
  await page.goto(`${B}/c/${id}/report/${week.userFixtureId}`);
  await page.locator(".chart-svg").first().waitFor();
  await shot("02-bericht");

  step("Charakter, Ton und App-Einstellungen");
  const squad = await api(`careers/${id}/squad`);
  await page.goto(`${B}/c/${id}/player/${squad.players[0].id}`);
  await page.getByText("Charakter", { exact: true }).first().waitFor();
  await page.goto(`${B}/c/${id}/career/settings`);
  await page.getByText("App & Mitteilungen").waitFor();
  await page.getByText("Stadionton", { exact: true }).waitFor();

  step("Passwort vergessen");
  await api("auth/logout", {});
  await page.goto(`${B}/login`);
  await page.getByRole("link", { name: "Passwort vergessen?" }).click();
  await page.waitForURL(/\/forgot/);
  await page.fill("#email", email);
  await page.getByRole("button", { name: "Link anfordern" }).click();
  await page.getByRole("status").waitFor();
  await page.goto(`${B}/reset?token=ungueltig`);
  await page.getByText(/ungültig, abgelaufen/).waitFor();

  step("Smartphone");
  await page.goto(`${B}/login`);
  await page.fill("#email", email);
  await page.fill("#pw", "geheim123");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL(/\/careers/);
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
  const mp = await mobile.newPage();
  mp.on("pageerror", (e) => errors.push(`pageerror (mobil): ${e.message}`));
  for (const path of ["", "/team/tactic", "/market", "/career/help"]) {
    await mp.goto(`${B}/c/${id}${path}`);
    await mp.locator("h1, .first-steps").first().waitFor();
    const w = await mp.evaluate(() => document.documentElement.scrollWidth);
    if (w > 392) fail(`Seitliches Scrollen auf dem Smartphone (${path || "/"}): ${w}px`);
  }

  if (errors.length) fail(`Fehler im Browser:\n${errors.join("\n")}`);
  console.log("✔ Browser-Test bestanden");
  await browser.close();
} catch (e) {
  console.error(`✘ ${e.message}`);
  if (errors.length) console.error(errors.join("\n"));
  if (OUT) await page.screenshot({ path: `${OUT}/fehler.png`, fullPage: true }).catch(() => {});
  await browser.close();
  process.exit(1);
}
