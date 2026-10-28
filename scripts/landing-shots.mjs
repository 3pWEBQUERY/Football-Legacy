/**
 * Screenshots für die Startseite aus einer echten Karriere (Deutsch und
 * Englisch): Livespiel, Büro, Taktik, Spielerprofil, Transfers, Finanzen,
 * Tabelle, Online-Liga und Smartphone. Ergebnis: apps/web/public/landing/*.webp
 *
 *   E2E_URL=http://localhost:3000 DATABASE_URL=postgres://… node scripts/landing-shots.mjs
 *
 * DATABASE_URL wird nur gebraucht, um die E-Mail für die Online-Liga zu bestätigen.
 * Zum Schluss werden die Aufnahmen mit Python/Pillow in WebP umgewandelt (≈ 90 KB pro Bild).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const B = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = new URL("../apps/web/public/landing/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const { Client } = createRequire(new URL("../packages/game/package.json", import.meta.url))("pg");
const TIPS = ["board", "contracts", "finances", "search", "squad", "tactic", "training", "transfers", "youth"];
const HIDE = ".toasts, .daily-report, .tour { display: none !important; }";

const browser = await chromium.launch();

async function verify(email) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query("update accounts set email_verified_at = now() where email = $1", [email]);
  await db.query("delete from auth_attempts");
  await db.end();
}

async function run(lang) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 });
  await ctx.addCookies([{ name: "fl-lang", value: lang, url: B }]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  const api = (p, b) => page.evaluate(async ([p, b]) => {
    const r = await fetch("/api/" + p, { method: b ? "POST" : "GET", headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
    const j = await r.json(); if (!r.ok) throw new Error(`${p}: ${j.error}`); return j;
  }, [p, b]);
  const ready = async () => {
    await page.waitForFunction(() => !document.documentElement.classList.contains("i18n-pending"));
    await page.addStyleTag({ content: HIDE });
    await page.waitForTimeout(1200);
  };
  const shot = async (name, opts = {}) => {
    await page.screenshot({ path: `${OUT}${name}.${lang}.jpg`, type: "jpeg", quality: 80, ...opts });
    console.log(`  ${name}.${lang}.jpg`);
  };
  const open = async (path) => { await page.goto(B + path); await ready(); };

  console.log(`▶ ${lang}`);
  await page.goto(B);
  const email = `landing-${lang}-${Date.now()}@example.com`;
  await api("auth/register", { email, password: "geheim123", displayName: "Sven Rehberg", acceptTerms: true, ageConfirmed: true });
  const prev = await api("world/preview?seed=2026&country=GER");
  // Oberes Mittelfeld: realistische Marktwerte und ein Kader mit Luft nach oben
  const club = [...prev[0].clubs].sort((a, b) => Math.abs(a.rating - 74) - Math.abs(b.rating - 74))[0];
  const { id } = await api("careers", { managerName: "Sven Rehberg", countryCode: "GER", clubIndex: club.index, seed: 2026 });
  await api(`careers/${id}/onboarding`, { action: "tour" });
  await api(`careers/${id}/onboarding`, { action: "dismiss" });
  for (const tip of TIPS) await api(`careers/${id}/onboarding`, { action: "tip", id: tip });

  // Ein paar Spieltage weit spielen, damit Tabelle, Posteingang und Formkurven leben
  let matches = 0;
  for (let i = 0; i < 160 && matches < 4; i++) {
    const r = await api(`careers/${id}/advance`, {});
    if (r.kind === "match") { await api(`careers/${id}/match/quick`, {}); matches++; }
  }
  for (let i = 0; i < 40; i++) if ((await api(`careers/${id}/advance`, {})).kind === "match") break;

  await open(`/c/${id}`);
  await shot("office");
  await open(`/c/${id}/team/tactic`);
  await shot("tactics");
  const squad = await api(`careers/${id}/squad`);
  const star = [...squad.players].sort((a, b) => b.rating - a.rating)[0];
  await open(`/c/${id}/player/${star.id}`);
  await shot("player");
  await open(`/c/${id}/market/search`);
  await shot("transfers");
  await open(`/c/${id}/board`);
  await shot("board");
  await open(`/c/${id}/competition`);
  await shot("competition");

  // Livespiel in der Halbzeitpause: Statistik, Ticker und Kabinenansprache sichtbar
  await page.goto(`${B}/c/${id}/match`);
  await ready();
  await page.locator(".btn-primary.btn-lg").last().click();
  await page.locator(".seg button").last().click(); // höchste Geschwindigkeit
  await page.locator(".clock", { hasText: /HZ|HT/ }).waitFor({ timeout: 120_000 });
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(1500);
  await shot("match");

  // Online-Liga mit CPU-Teams und einem gespielten Spieltag
  await verify(email);
  const league = await api("online", { name: lang === "de" ? "Montagsrunde" : "Monday Club", careerId: id, maxMembers: 8, rhythm: "manual", public: false });
  await api(`online/${league.id}/bots`, { count: 5 });
  await api(`online/${league.id}/start`, {});
  await api(`online/${league.id}/play`, {}).catch(() => {});
  await api(`online/${league.id}/posts`, { body: lang === "de" ? "Gut gespielt am Wochenende – Revanche im Rückspiel!" : "Well played at the weekend – revenge in the return fixture!" }).catch(() => {});
  await open(`/online/${league.id}`);
  await shot("online");

  // Smartphone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, storageState: await ctx.storageState(), isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  await mp.goto(`${B}/c/${id}`);
  await mp.waitForFunction(() => !document.documentElement.classList.contains("i18n-pending"));
  await mp.addStyleTag({ content: HIDE });
  await mp.waitForTimeout(1200);
  await mp.screenshot({ path: `${OUT}mobile.${lang}.jpg`, type: "jpeg", quality: 80 });
  console.log(`  mobile.${lang}.jpg`);
  await phone.close();
  await ctx.close();
}

try {
  await run("de");
  await run("en");
} finally {
  await browser.close();
}
execFileSync("python3", ["-I", "-c", `
from PIL import Image; import glob, os
for f in glob.glob(${JSON.stringify(OUT)} + '*.jpg'):
    Image.open(f).convert('RGB').save(f[:-4] + '.webp', 'WEBP', quality=80, method=6); os.remove(f)
`], { stdio: "inherit" });
console.log("✔ WebP in apps/web/public/landing");
