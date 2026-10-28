/**
 * Englische Fassung: öffnet die Hauptseiten mit Sprache Englisch und meldet
 * sichtbare Texte, die noch deutsch aussehen. Bricht ab bei Konsolenfehlern
 * (z. B. Hydrationsfehlern) oder wenn auf einer Seite mehr als MAX_GERMAN
 * deutsche Textstellen übrig sind.
 *
 *   E2E_URL=http://localhost:3000 node apps/web/e2e/i18n.mjs [Screenshot-Ordner] [--all]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const B = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? null;
const ALL = process.argv.includes("--all");
const MAX_GERMAN = Number(process.env.MAX_GERMAN ?? 3);
if (OUT) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: "fl-lang", value: "en", url: B }]);
const page = await ctx.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`); });
const api = (p, b) => page.evaluate(async ([p, b]) => {
  const r = await fetch("/api/" + p, { method: b ? "POST" : "GET", headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j;
}, [p, b]);

/** Sichtbare Textstellen, die nach Deutsch aussehen (Umlaute oder typische Wörter). */
const germanTexts = () => page.evaluate(() => {
  const STOP = /\b(der|die|das|und|nicht|mit|für|ist|wird|dein|deine|noch|keine|kein|bei|zum|zur|auf|aus|nach|oder|sind|werden|Spieler|Verein|Saison|Spieltag|Tage|Tagen|Woche|Wochen|heute|jetzt|gegen|gewinnt|Tor|Tore|Spiel|Spiele|Halbzeit|Ecke|Freistoss|Abseits|Gelbe|Schuss)\b/;
  const out = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest("[translate=no], script, style, textarea") || !el.offsetParent) continue;
    const t = n.nodeValue.replace(/\s+/g, " ").trim();
    if (t.length < 3) continue;
    if (/[äöüÄÖÜß]/.test(t.replace(/\b[A-ZÄÖÜ][a-zäöüßéèç]+(?:ić|ević|ović)?\b/g, (w) => (/^(Für|Über|Spieler|Größe)$/.test(w) ? w : ""))) || STOP.test(t)) out.add(t.slice(0, 120));
  }
  for (const a of document.querySelectorAll("[title], [placeholder], [aria-label]")) {
    for (const v of [a.getAttribute("title"), a.getAttribute("placeholder"), a.getAttribute("aria-label")]) if (v && (STOP.test(v) || /[äöü]/.test(v))) out.add(`@${v.slice(0, 100)}`);
  }
  return [...out];
});

const report = [];
async function check(path, name) {
  await page.goto(B + path);
  await page.waitForFunction(() => !document.documentElement.classList.contains("i18n-pending"));
  await page.waitForTimeout(900);
  const de = await germanTexts();
  report.push({ name, de });
  if (OUT) await page.screenshot({ path: `${OUT}/en-${name.replace(/\W+/g, "-").toLowerCase()}.png` });
}

try {
  for (const [p, n] of [["/", "Start"], ["/login", "Sign in"], ["/register", "Sign up"], ["/impressum", "Legal notice"], ["/datenschutz", "Privacy"], ["/nutzungsbedingungen", "Terms"], ["/neuigkeiten", "News"]]) await check(p, n);
  if ((await page.evaluate(() => document.documentElement.lang)) !== "en") throw new Error("html lang ist nicht en");
  await api("auth/register", { email: `i18n${Date.now()}@example.com`, password: "geheim123", displayName: "Lang", acceptTerms: true, ageConfirmed: true });
  const prev = await api("world/preview?seed=7&country=ENG");
  const { id } = await api("careers", { managerName: "Lang", countryCode: "ENG", clubIndex: prev[0].clubs[2].index, seed: 7 });
  await check(`/c/${id}`, "Office (tour)");
  await api(`careers/${id}/onboarding`, { action: "tour" });
  for (let i = 0; i < 12; i++) await api(`careers/${id}/advance`, {});
  const pages = [["", "Office"], ["/team", "Squad"], ["/team/tactic", "Tactics"], ["/team/training", "Training"], ["/team/youth", "Youth"], ["/team/medical", "Medical"],
    ["/market", "Transfers"], ["/market/search", "Player search"], ["/market/contracts", "Contracts"], ["/market/finances", "Finances"], ["/competition", "Competition"],
    ["/board", "Board"], ["/verein", "Club"], ["/history", "History"], ["/career", "Career"], ["/career/help", "Help"], ["/career/settings", "Settings"], ["/calendar", "Calendar"], ["/media", "Media"], ["/match", "Match preview"]];
  for (const [p, n] of pages) await check(`/c/${id}${p}`, n);
  const squad = await api(`careers/${id}/squad`);
  await check(`/c/${id}/player/${squad.players[0].id}`, "Player");
  // Livespiel bis zur Halbzeit (Kommentar, Statistik)
  let matched = false;
  for (let i = 0; i < 80 && !matched; i++) matched = (await api(`careers/${id}/advance`, {})).kind === "match";
  await page.goto(`${B}/c/${id}/match`);
  await page.locator(".btn-primary.btn-lg").last().click();
  await page.locator(".btn", { hasText: /half-time/i }).first().click({ timeout: 60_000 });
  await page.locator(".clock", { hasText: "HT" }).waitFor({ timeout: 60_000 });
  report.push({ name: "Live match (HT)", de: await germanTexts() });
  if (OUT) await page.screenshot({ path: `${OUT}/en-live-match.png` });
  await check(`/c/${id}`, "Office (after)");
  await check("/careers", "Saves");
  await check("/online", "Online");
} finally {
  await browser.close();
}

let failed = 0;
for (const r of report) {
  const bad = r.de.length > MAX_GERMAN;
  if (bad) failed++;
  console.log(`${bad ? "✘" : "✔"} ${r.name.padEnd(16)} ${r.de.length} deutsche Stellen`);
  for (const t of r.de.slice(0, ALL ? 999 : 6)) console.log(`     ${t}`);
}
if (errors.length) console.log(`\nFehler im Browser:\n${errors.join("\n")}`);
if (errors.length || failed) process.exit(1);
console.log("✔ Englische Fassung geprüft");
