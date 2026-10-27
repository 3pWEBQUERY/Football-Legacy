/**
 * Zieht alle deutschen Texte aus dem Quellcode und schreibt sie als Schlüssel
 * in catalog/keys.<bereich>.json. Vorlagen (`${a} unterschreibt bei ${b}`)
 * werden zu Mustern mit Platzhaltern ("{0} unterschreibt bei {1}"), einfache
 * Bedingungen (`n === 1 ? "Tag" : "Tagen"`) zu allen Varianten. Fehlende
 * Übersetzungen landen in catalog/missing.<bereich>.json.
 *
 *   pnpm --filter @fl/i18n extract [--check]
 *
 * --check: Exit-Code 1, wenn Übersetzungen fehlen (nur als Bericht gedacht).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ts = createRequire(import.meta.url)("typescript");
const HERE = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(HERE, "../..");
const CHECK = process.argv.includes("--check");

const LEGAL = /apps\/web\/app\/(impressum|datenschutz|nutzungsbedingungen)\//;
const AREAS = {
  ui: ["apps/web/app", "apps/web/components", "apps/web/lib"],
  game: ["packages/game/src"],
  sim: ["packages/sim/src"],
};
const SKIP_FILE = /(\.d\.ts$|\/data\/names\.ts$|migrations[^/]*\.ts$|\/test\/|\.test\.ts$|\/e2e\/|\/ai\/claude\.ts$)/;

const STOP = new Set(("der die das den dem des ein eine einen einem einer eines und oder aber nicht kein keine keinen keiner mit für ist sind war waren wird werden wurde wurden hat haben hast hatte im am auf aus bei bis nach vor von zu zum zur über unter noch schon nur auch du dein deine deinen deinem deiner dich dir sie er es wir ihr ihre ihren sein seine seinen man wenn als wie was wer jetzt hier dort mehr weniger alle alles neue neuer neues neu gegen ohne seit beim vom ins sich kann können muss soll will mehr diese dieser dieses jede jeder jedes eigene eigenen noch heute morgen tage tag tagen wochen woche jahre jahren minuten spiele spielen punkte tore saison saisons spieltag spieltage")
  .split(" "));
const DISPLAY_ATTR = new Set(["title", "placeholder", "aria-label", "alt", "label", "confirmLabel", "message", "hint", "description", "heading", "text", "subtitle", "empty", "aria-description"]);
const SKIP_ATTR = new Set(["className", "style", "href", "id", "key", "type", "role", "name", "htmlFor", "src", "rel", "target", "inputMode", "autoComplete", "method", "viewBox", "d", "fill", "stroke", "icon", "value", "data-theme", "lang", "as", "variant", "tone", "size"]);
const SKIP_CALL = /^(query|one|many|db\.query|pool\(\)\.query|client\.query|api|useApi|fetch|console\.\w+|localStorage\.\w+|sessionStorage\.\w+|\w+\.getItem|\w+\.setItem|document\.querySelector\w*|\w+\.addEventListener|require|import|matchMedia|\w+\.startsWith|\w+\.endsWith|\w+\.split|\w+\.join|\w+\.replace|\w+\.padStart|route|career|seedFor|\w+\.toLocaleString|\w+\.toLocaleDateString|Intl\.\w+|captureException|router\.push|redirect|\w+\.get|\w+\.has|\w+\.set|cookies\(\)\.\w+|res\.cookies\.\w+|\w+\.headers\.get)$/;

const squash = (s) => s.replace(/\s+/g, " ").trim();
const PH = "\u0000";

function looksGerman(s, relaxed) {
  const t = squash(s.replaceAll(PH, " "));
  if (!/[A-Za-zÄÖÜäöü]{2,}/.test(t)) return false;
  if (/^(https?:|mailto:|\/|\.\/|#|@|data:|--)/.test(t) || /^[\w.-]+\/[\w./-]*$/.test(t)) return false;
  if (/\b(select|insert into|update \w+ set|delete from|create table|alter table|returning|coalesce|jsonb|on conflict|left join|order by|group by)\b/i.test(t)) return false;
  if (/[äöüÄÖÜß„“]/.test(t)) return true;
  const words = t.split(/[^A-Za-zÄÖÜäöüß]+/).filter(Boolean);
  if (words.some((w) => STOP.has(w.toLowerCase()))) return true;
  if (/^[a-z0-9_.:/-]+$/.test(t) || /^[a-z][a-zA-Z0-9]*$/.test(t)) return relaxed && words.length === 1 && /^[a-zäöü]{4,}$/.test(t) && !/[A-Z_]/.test(t) ? relaxed : false;
  if (/^[a-z-]+( [a-z0-9-]+)+$/.test(t)) return false; // Klassenlisten
  if (/^[\d.:+–·•(\s-]*[A-ZÄÖÜ][a-zäöüß]{2,}/.test(t)) return true;
  return relaxed && words.length > 1;
}

function calleeName(call) {
  try {
    return call.expression.getText().replace(/\s+/g, "");
  } catch {
    return "";
  }
}

/** Alle Text-Varianten eines Ausdrucks; Platzhalter als PH. */
function variants(e, depth = 0) {
  if (!e || depth > 6) return [PH];
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return variants(e.expression, depth + 1);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isConditionalExpression(e)) return cap([...variants(e.whenTrue, depth + 1), ...variants(e.whenFalse, depth + 1)]);
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    const right = variants(e.right, depth + 1);
    return cap([PH, ...right.filter((x) => x !== PH)]);
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return combine([variants(e.left, depth + 1), variants(e.right, depth + 1)]);
  if (ts.isTemplateExpression(e)) {
    const parts = [[e.head.text]];
    for (const span of e.templateSpans) parts.push(variants(span.expression, depth + 1), [span.literal.text]);
    return combine(parts);
  }
  return [PH];
}
const cap = (xs) => [...new Set(xs)].slice(0, 16);
function combine(parts) {
  let acc = [""];
  for (const p of parts) {
    const next = [];
    for (const a of acc) for (const b of p) next.push(a + b);
    acc = cap(next);
  }
  return acc;
}

/** PH → {0},{1}…, benachbarte Platzhalter zusammenfassen. */
function toKey(v) {
  let s = squash(v.replace(new RegExp(`${PH}(\\s*${PH})+`, "g"), PH));
  if (s === PH || !s) return null;
  let i = 0;
  s = s.replace(new RegExp(PH, "g"), () => `{${i++}}`);
  return s;
}

/** JSX-Text wie React zusammenfassen */
function jsxText(raw) {
  const lines = raw.split(/\r?\n/);
  return lines.map((l, i) => (i === 0 ? l.replace(/^\s+(?=.)/, (m) => (lines.length === 1 ? m : "")) : l.trimStart())).map((l, i) => (i === lines.length - 1 ? l : l.trimEnd())).filter((l, i, a) => l || (i > 0 && i < a.length - 1)).join(" ");
}

/** Steht der Ausdruck (über Bedingungen/Klammern) direkt in JSX? */
function inJsx(node) {
  let p = node.parent;
  while (p && (ts.isConditionalExpression(p) || ts.isParenthesizedExpression(p) || ts.isBinaryExpression(p) || ts.isTemplateSpan(p) || ts.isTemplateExpression(p))) p = p.parent;
  return !!p && (ts.isJsxExpression(p) || ts.isJsxAttribute(p));
}

function hasJsx(node) {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found = true;
    else ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

function extractFile(file, out) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (v, relaxed) => {
    if (v.includes("\n")) for (const line of v.split("\n")) add(line, relaxed);
    if (!looksGerman(v, relaxed)) return;
    const k = toKey(v);
    if (k && k.length < 2000) out.add(k);
  };
  // Viele Varianten = zusammengesetzter Text: die Einzelteile reichen (Laufzeit zerlegt in Sätze)
  const addAll = (vs, relaxed) => { if (vs.length <= 4) for (const v of vs) add(v, relaxed); };

  // Sonderfall Länderliste: "GER|Deutschland|…"
  if (file.endsWith("data/countries.ts")) for (const m of text.matchAll(/^[A-Z]{3}\|([^|]+)\|/gm)) out.add(m[1]);

  function skipLiteral(node) {
    const p = node.parent;
    if (!p) return true;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isLiteralTypeNode(p)) return true;
    if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p)) && p.name === node) return true;
    if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
    if (ts.isCaseClause(p)) return true;
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return true;
    if (ts.isCallExpression(p) && p.arguments.includes(node) && SKIP_CALL.test(calleeName(p))) return true;
    if (ts.isJsxAttribute(p)) return SKIP_ATTR.has(p.name.getText());
    return false;
  }

  function visit(node) {
    // JSX-Kinder: reiner Text mit Ausdrücken → ein Muster, sonst Textstücke einzeln
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const kids = node.children;
      const pure = kids.length > 0 && kids.every((c) => ts.isJsxText(c) || (ts.isJsxExpression(c) && (!c.expression || !hasJsx(c.expression))));
      if (pure && kids.some((c) => ts.isJsxText(c) && c.text.trim())) {
        const parts = kids.map((c) => (ts.isJsxText(c) ? [jsxText(c.text)] : c.expression ? variants(c.expression) : [""]));
        addAll(combine(parts), true);
      }
      for (const c of kids) if (ts.isJsxText(c) && c.text.trim()) add(jsxText(c.text), true);
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!skipLiteral(node)) {
        const p = node.parent;
        const relaxed = inJsx(node) && !(ts.isJsxAttribute(p) && !DISPLAY_ATTR.has(p.name.getText()))
          || (ts.isPropertyAssignment(p) && DISPLAY_ATTR.has(p.name.getText()));
        add(node.text, relaxed);
      }
    } else if (ts.isTemplateExpression(node)) {
      const p = node.parent;
      if (!(ts.isCallExpression(p) && SKIP_CALL.test(calleeName(p))) && !ts.isTaggedTemplateExpression(p)) addAll(variants(node), inJsx(node));
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      const vs = variants(node);
      if (vs.some((v) => v.includes(PH) && v.replaceAll(PH, "").trim())) addAll(vs, false);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

function files(dir) {
  const res = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(p).isDirectory()) res.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name) && !SKIP_FILE.test(p)) res.push(p);
  }
  return res;
}

const byArea = { ui: new Set(), game: new Set(), sim: new Set(), legal: new Set() };
for (const [area, dirs] of Object.entries(AREAS)) {
  for (const d of dirs) for (const f of files(join(ROOT, d))) extractFile(f, LEGAL.test(relative(ROOT, f)) ? byArea.legal : byArea[area]);
}
// Schlüssel nur einmal führen: Oberfläche vor Spiel vor Engine
for (const k of byArea.ui) { byArea.game.delete(k); byArea.sim.delete(k); byArea.legal.delete(k); }
for (const k of byArea.game) byArea.sim.delete(k);

let missingTotal = 0;
for (const [area, keys] of Object.entries(byArea)) {
  const sorted = [...keys].sort((a, b) => a.localeCompare(b, "de"));
  writeFileSync(join(HERE, `catalog/keys.${area}.json`), JSON.stringify(sorted, null, 0).replace(/","/g, '",\n"') + "\n");
  const enPath = join(HERE, `catalog/en.${area}.json`);
  const en = existsSync(enPath) ? JSON.parse(readFileSync(enPath, "utf8")) : {};
  const manual = JSON.parse(readFileSync(join(HERE, "catalog/en.manual.json"), "utf8"));
  const missing = sorted.filter((k) => !(k in en) && !(k in manual));
  const stale = Object.keys(en).filter((k) => !keys.has(k));
  missingTotal += missing.length;
  const missPath = join(HERE, `catalog/missing.${area}.json`);
  if (missing.length) writeFileSync(missPath, JSON.stringify(missing, null, 1) + "\n");
  else if (existsSync(missPath)) unlinkSync(missPath);
  console.log(`${area.padEnd(6)} ${String(sorted.length).padStart(5)} Texte, ${String(sorted.length - missing.length).padStart(5)} übersetzt, ${String(missing.length).padStart(5)} fehlen${stale.length ? `, ${stale.length} veraltet` : ""}`);
}
if (CHECK && missingTotal) process.exit(1);
