/**
 * Browser-Test (Abläufe): ablösefreier Transfer, Livespiel mit Halbzeit und
 * Abpfiff, Online-Liga mit CPU-Teams und einem Spieltag, Einstellungen und
 * Admin-Bereich. Bricht bei Seiten- oder Konsolenfehlern mit Exit-Code 1 ab.
 *
 *   E2E_URL=http://localhost:3000 DATABASE_URL=postgres://… node apps/web/e2e/flows.mjs [Screenshot-Ordner]
 *
 * DATABASE_URL wird nur gebraucht, um die E-Mail-Adresse des Testkontos zu
 * bestätigen (Online-Ligen setzen das voraus). Der Server muss mit
 * ADMIN_EMAILS=admin-e2e@example.com laufen.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const B = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? null;
const ADMIN = "admin-e2e@example.com";
if (OUT) mkdirSync(OUT, { recursive: true });
const { Client } = createRequire(new URL("../../../packages/game/package.json", import.meta.url))("pg");
const errors = [];
const step = (name) => console.log(`▶ ${name}`);
const fail = (msg) => { throw new Error(msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(30_000);
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`);
});
const api = (p, b) => page.evaluate(async ([p, b]) => {
  const r = await fetch("/api/" + p, { method: b ? "POST" : "GET", headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${j.error ?? r.status}`);
  return j;
}, [p, b]);
const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` }); };
/** Bestätigungsdialog (useConfirm) schliessen, falls einer aufgeht. */
const confirmIfAsked = async () => {
  const dialog = page.locator(".modal [role=dialog], [role=alertdialog], .modal").last();
  if (await dialog.isVisible().catch(() => false)) await dialog.locator(".btn-primary, .btn-danger").last().click();
};
async function verify(email) {
  if (!process.env.DATABASE_URL) fail("DATABASE_URL fehlt (zum Bestätigen der Test-E-Mail)");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query("update accounts set email_verified_at = now() where email = $1", [email]);
  await db.end();
}

try {
  step("Konto und Karriere");
  await page.goto(B);
  const email = `flow${Date.now()}@example.com`;
  await api("auth/register", { email, password: "geheim123", displayName: "Ablauf", acceptTerms: true, ageConfirmed: true });
  const prev = await api("world/preview?seed=11&country=GER");
  const { id } = await api("careers", { managerName: "Ablauf", countryCode: "GER", clubIndex: prev[0].clubs[4].index, seed: 11 });
  await api(`careers/${id}/onboarding`, { action: "tour" });

  step("Ablösefreier Spieler: Vertrag anbieten");
  const before = (await api(`careers/${id}/squad`)).players.length;
  await page.goto(`${B}/c/${id}/market/search`);
  await page.getByRole("button", { name: "Vereinslos" }).click();
  const row = page.locator("tbody tr.clickable", { has: page.getByRole("button", { name: /Vertrag/ }) }).first();
  await row.waitFor();
  const signed = (await row.locator("td").nth(1).innerText()).split("\n")[0].trim();
  await row.getByRole("button", { name: /Vertrag/ }).click();
  await page.getByRole("button", { name: "Gespräche eröffnen" }).click();
  await page.getByRole("button", { name: "Forderung übernehmen" }).click();
  await page.getByRole("button", { name: "Vertrag anbieten" }).click();
  await page.locator(".neg-status").waitFor();
  await shot("10-verhandlung");
  await page.keyboard.press("Escape");
  let after = (await api(`careers/${id}/squad`)).players.length;
  // Je nach Berater sofort oder nach einigen Tagen
  for (let i = 0; i < 6 && after === before; i++) {
    await api(`careers/${id}/advance`, {});
    after = (await api(`careers/${id}/squad`)).players.length;
  }
  if (after !== before + 1) fail(`Ablösefreier Spieler (${signed}) nicht im Kader angekommen`);

  step("Livespiel bis zur Halbzeit und zum Abpfiff");
  let matched = false;
  for (let i = 0; i < 80 && !matched; i++) matched = (await api(`careers/${id}/advance`, {})).kind === "match";
  if (!matched) fail("Kein Spieltag erreicht");
  await page.goto(`${B}/c/${id}/match`);
  await page.getByRole("button", { name: "Anpfiff" }).click();
  await page.getByRole("button", { name: "Zur Halbzeit" }).click({ timeout: 60_000 });
  await page.getByText("Kabine · Halbzeitansprache").waitFor({ timeout: 60_000 });
  await page.locator(".clock", { hasText: "HZ" }).waitFor();
  await shot("11-halbzeit");
  await page.locator(".talk-tone").first().click();
  await page.getByRole("button", { name: "2. Halbzeit" }).click();
  await page.getByRole("button", { name: "Zum Abpfiff" }).click({ timeout: 60_000 });
  await page.getByRole("link", { name: "Zurück ins Büro" }).waitFor({ timeout: 60_000 });
  await page.locator(".clock", { hasText: "Ende" }).waitFor();
  await shot("12-abpfiff");

  step("Einstellungen: Name und helles Design");
  await page.goto(`${B}/c/${id}/career/settings`);
  await page.fill("#dn", "Ablauf Neu");
  await page.locator("form", { has: page.locator("#dn") }).getByRole("button", { name: "Speichern" }).click();
  await page.getByText("Name gespeichert").waitFor();
  await page.getByRole("tab", { name: "Hell" }).click();
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== "light") fail("Helles Design nicht aktiv");
  await page.reload();
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== "light") fail("Design nach Neuladen nicht gespeichert");
  await page.getByRole("tab", { name: "Dunkel" }).click();
  if ((await api("auth/me")).account.displayName !== "Ablauf Neu") fail("Anzeigename nicht gespeichert");

  step("Online-Liga mit CPU-Teams und einem Spieltag");
  await verify(email);
  const league = await api("online", { name: `Ablauf ${Date.now() % 10000}`, careerId: id, maxMembers: 6, rhythm: "manual", public: false });
  await page.goto(`${B}/online/${league.id}`);
  await page.getByRole("button", { name: "CPU-Teams" }).click();
  await page.locator(".btn-primary", { hasText: "Saison starten" }).and(page.locator(":enabled")).waitFor();
  await page.getByRole("button", { name: "Saison starten" }).click();
  await confirmIfAsked();
  await page.getByRole("button", { name: "Jetzt spielen" }).click();
  await page.waitForTimeout(300);
  await confirmIfAsked();
  let played = false;
  for (let i = 0; i < 30 && !played; i++) {
    const v = await api(`online/${league.id}`);
    played = (v.round ?? 0) >= 1;
    if (!played) await page.waitForTimeout(1000);
  }
  if (!played) fail("Kein Online-Spieltag gespielt");
  await page.reload();
  await page.locator("h1").first().waitFor();
  await shot("13-online-liga");

  step("Admin-Bereich");
  await api("auth/logout", {});
  try {
    await api("auth/login", { email: ADMIN, password: "geheim123" });
  } catch {
    await api("auth/register", { email: ADMIN, password: "geheim123", displayName: "Admin E2E", acceptTerms: true, ageConfirmed: true });
  }
  await page.goto(`${B}/admin`);
  await page.getByRole("heading", { name: "Admin-Bereich", level: 1 }).waitFor();
  await page.locator(".admin-tile").first().waitFor();
  await shot("14-admin");
  for (const tab of ["Meldungen", "Konten", "KI-Kosten", "Protokoll"]) {
    await page.getByRole("tab", { name: tab }).click();
    await page.locator(".loading").first().waitFor({ state: "detached" }).catch(() => {});
    if (await page.locator(".error-box").count()) fail(`Fehler im Admin-Tab ${tab}`);
  }
  await page.getByRole("tab", { name: "Konten" }).click();
  await page.getByLabel("Konten suchen").fill(email);
  await page.getByRole("button", { name: "Suchen" }).click();
  await page.locator("tr.clickable", { hasText: email }).click();
  await page.getByRole("button", { name: "Namen zurücksetzen" }).waitFor();
  await shot("15-admin-konto");

  step("Nicht-Admins haben keinen Zugang");
  await api("auth/logout", {});
  await api("auth/login", { email, password: "geheim123" });
  const status = await page.evaluate(async () => (await fetch("/api/admin/overview")).status);
  if (status !== 403) fail(`Admin-API für normale Spieler: Status ${status}`);

  if (errors.length) fail(`Fehler im Browser:\n${errors.join("\n")}`);
  console.log("✔ Ablauf-Test bestanden");
  await browser.close();
} catch (e) {
  console.error(`✘ ${e.message}`);
  if (errors.length) console.error(errors.join("\n"));
  if (OUT) await page.screenshot({ path: `${OUT}/fehler-ablauf.png`, fullPage: true }).catch(() => {});
  await browser.close();
  process.exit(1);
}
