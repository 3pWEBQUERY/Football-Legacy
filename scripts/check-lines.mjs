/**
 * Prüft, dass keine Quelldatei mehr als 600 Zeilen hat (TypeScript, TSX, CSS, JS).
 * Läuft in der CI; lokal mit `pnpm check:lines`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_LINES = 600;
const SOURCE = /\.(ts|tsx|css|js|mjs)$/;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => SOURCE.test(f) && !f.endsWith(".d.ts"));

const tooLong = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // gelöschte, noch nicht committete Datei
  }
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  if (lines > MAX_LINES) tooLong.push({ file, lines });
}

if (tooLong.length) {
  console.error(`Diese Dateien haben mehr als ${MAX_LINES} Zeilen – bitte aufteilen:`);
  for (const { file, lines } of tooLong.sort((a, b) => b.lines - a.lines)) console.error(`  ${String(lines).padStart(5)}  ${file}`);
  process.exit(1);
}
console.log(`Zeilenprüfung bestanden: ${files.length} Dateien, keine über ${MAX_LINES} Zeilen.`);
