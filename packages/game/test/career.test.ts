/**
 * Integrationstest gegen PostgreSQL: Account, Karriere, eine komplette Saison.
 * Benötigt TEST_DATABASE_URL (oder lokale Standard-DB football_legacy_test).
 * Die Blöcke unter suites/ laufen in dieser Reihenfolge und teilen sich eine Karriere.
 */
import { afterAll, beforeAll } from "vitest";
import { migrate, pool, register, shared } from "./context";
import "./suites/karriere";
import "./suites/verein";
import "./suites/stellenmarkt";
import "./suites/taktik-nachrichten";
import "./suites/transfermarkt";
import "./suites/verkauf";
import "./suites/spieltag";
import "./suites/geschichte";
import "./suites/einstieg";
import "./suites/startreife";
import "./suites/spieltiefe";
import "./suites/hintergrund";
import "./suites/sicherheit";
import "./suites/paket-f";
import "./suites/paket-g";
import "./suites/paket-h";
import "./suites/paket-i";
import "./suites/paket-j";
import "./suites/paket-k";
import "./suites/neuigkeiten";
import "./suites/weltnachrichten";

beforeAll(async () => {
  await pool().query("drop schema public cascade; create schema public;");
  await migrate();
  const { account } = await register(`test${Date.now()}@example.com`, "geheim123", "Tester");
  shared.accountId = account.id;
}, 60_000);

afterAll(async () => {
  await pool().end();
});
