/**
 * Übernimmt Übersetzungsdateien ({ deutsch: englisch }) in den Katalog.
 *   node scripts/merge.mjs <bereich> <datei.json> [...]
 * Prüft, dass alle Platzhalter erhalten bleiben; fehlerhafte Einträge werden übersprungen.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const HERE = fileURLToPath(new URL("..", import.meta.url));
const [area, ...inputs] = process.argv.slice(2);
const path = join(HERE, `catalog/en.${area}.json`);
const cat = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
let added = 0, bad = 0;
for (const f of inputs) {
  for (const [k, v] of Object.entries(JSON.parse(readFileSync(f, "utf8")))) {
    if (typeof v !== "string" || ph(k) !== ph(v)) { bad++; console.warn(`  übersprungen: ${k}`); continue; }
    cat[k] = v;
    added++;
  }
}
const sorted = Object.fromEntries(Object.entries(cat).sort(([a], [b]) => a.localeCompare(b, "de")));
writeFileSync(path, JSON.stringify(sorted, null, 1) + "\n");
console.log(`${area}: ${added} übernommen, ${bad} übersprungen, ${Object.keys(sorted).length} gesamt`);
