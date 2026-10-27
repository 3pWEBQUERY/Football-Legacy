/**
 * Übersetzer mit deutschem Quelltext als Schlüssel. Der Katalog enthält feste
 * Texte ("Kader" → "Squad") und Satzmuster mit Platzhaltern
 * ("{0} unterschreibt bei {1}!" → "{0} signs for {1}!"). Platzhalter-Werte
 * werden ihrerseits übersetzt, damit z. B. Wettbewerbsnamen mitwandern.
 * Nicht gefundene Texte bleiben unverändert (deutsch).
 */
import { builtinRule } from "./rules";

export type Catalog = Record<string, string>;

interface Pattern {
  re: RegExp;
  /** Ausgabe mit {n} oder {name}; slots[g] = Platzhalter der Gruppe g */
  out: string;
  slots: string[];
  literal: number;
}

const PLACEHOLDER = /\{(\w+)\}/g;
const WORD = /[A-Za-zÄÖÜäöüßéèàç]{3,}/g;
/** "1th" → "1st", "22th" → "22nd" (Ordnungszahlen aus deutschen "{0}."-Mustern) */
const ordinals = (s: string) => s.replace(/\b(\d+)th\b/g, (_, n: string) => {
  const d = Number(n) % 100;
  return n + (d >= 11 && d <= 13 ? "th" : (["th", "st", "nd", "rd"][d % 10] ?? "th"));
});
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Leerraum wie im gerenderten HTML zusammenfassen */
export const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export interface Translator {
  (text: string): string;
  /** Liefert null, wenn es keine Übersetzung gibt (für Abdeckungsberichte). */
  lookup(text: string): string | null;
  size: number;
}

export function createTranslator(...catalogs: Catalog[]): Translator {
  const exact = new Map<string, string>();
  const index = new Map<string, Pattern[]>();
  let size = 0;
  for (const catalog of catalogs) {
    for (const [rawKey, value] of Object.entries(catalog)) {
      const key = squash(rawKey);
      if (!value || value === key) continue;
      size++;
      if (!/\{\w+\}/.test(key)) {
        exact.set(key, value);
        continue;
      }
      const slots: string[] = [];
      let src = "^";
      let last = 0;
      let literal = "";
      for (const m of key.matchAll(PLACEHOLDER)) {
        const lit = key.slice(last, m.index);
        literal += lit;
        src += escape(lit) + "(.*?)";
        slots.push(m[1]);
        last = m.index! + m[0].length;
      }
      literal += key.slice(last);
      src += escape(key.slice(last)) + "$";
      const words = literal.match(WORD);
      if (!words) continue; // reine Platzhalter ("{0} · {1}") übersetzen nichts
      const anchor = words.reduce((a, b) => (b.length > a.length ? b : a)).toLowerCase();
      const p: Pattern = { re: new RegExp(src, "s"), out: value, slots, literal: literal.length };
      const list = index.get(anchor) ?? [];
      list.push(p);
      list.sort((a, b) => b.literal - a.literal); // spezifischere Muster zuerst
      index.set(anchor, list);
    }
  }

  const cache = new Map<string, string | null>();
  const remember = (k: string, v: string | null) => {
    if (cache.size > 50_000) cache.clear();
    cache.set(k, v);
    return v;
  };

  function viaPattern(core: string, depth: number): string | null {
    const words = core.match(WORD);
    if (!words) return null;
    const seen = new Set<Pattern>();
    for (const w of new Set(words.map((x) => x.toLowerCase()))) {
      for (const p of index.get(w) ?? []) {
        if (seen.has(p)) continue;
        seen.add(p);
        const m = p.re.exec(core);
        if (!m) continue;
        const values: Record<string, string> = {};
        p.slots.forEach((slot, g) => {
          const raw = m[g + 1];
          const t = depth < 3 && raw.trim() ? find(raw, depth + 1) : null;
          // Leerraum am Rand des eingesetzten Werts erhalten (" Vorlage: X." → " Assist: X.")
          values[slot] = t === null ? raw : (/^\s/.test(raw) ? " " : "") + t + (/\s$/.test(raw) ? " " : "");
        });
        return ordinals(p.out.replace(PLACEHOLDER, (all, n) => values[n] ?? all));
      }
    }
    return null;
  }

  /** Zusammengesetzte Texte ("A · B", mehrere Sätze) stückweise übersetzen. */
  function viaParts(core: string, depth: number): string | null {
    for (const sep of [/(\s·\s)/, /(\n)/, /(?<=[.!?])(\s+)(?=[A-ZÄÖÜ0-9„"])/, /(\s[–—]\s)/, /(:\s)/]) {
      const parts = core.split(sep);
      if (parts.length < 3) continue;
      let changed = false;
      const out = parts.map((part, i) => {
        if (i % 2 === 1) return part; // Trenner
        const t = find(part, depth + 1);
        if (t !== null) changed = true;
        return t ?? part;
      });
      if (changed) return out.join("");
    }
    return null;
  }

  function find(text: string, depth = 0): string | null {
    // Mehrzeilige Texte (Nachrichten, Berichte) zeilenweise
    if (text.includes("\n") && /\S\s*\n\s*\S/.test(text) && depth < 2) {
      const whole = exact.get(squash(text)) ?? viaPattern(squash(text), depth + 1);
      if (whole !== null) return whole;
      let changed = false;
      const lines = text.split("\n").map((line) => {
        const t = line.trim() ? find(line, depth + 1) : null;
        if (t !== null) changed = true;
        return t ?? line.trim();
      });
      return changed ? lines.join("\n") : find(squash(text), depth + 1);
    }
    const core = squash(text);
    if (!core || !/[A-Za-zÄÖÜäöü]/.test(core)) return null;
    if (depth === 0 && cache.has(core)) return cache.get(core)!;
    let hit = exact.get(core) ?? builtinRule(core) ?? viaPattern(core, depth) ?? null;
    // Satzzeichen am Ende ("… Tagen." zum Schlüssel "… Tagen")
    const punct = /^(.*\S)([.!?:,])$/s.exec(core);
    if (hit === null && punct) {
      const inner = exact.get(punct[1]) ?? viaPattern(punct[1], depth);
      if (inner !== null) hit = /[.!?:,]$/.test(inner) ? inner : inner + punct[2];
    }
    // Text mit Zahl davor oder dahinter ("Passlänge 50", "1 Saison", "Stärke 84")
    const num = hit === null ? /^(.*[^\d\s])\s+([+-]?\d[\d.,'’]*\s?%?)$/s.exec(core) ?? /^([+-]?\d[\d.,'’]*\s?%?)\s+(\D.*)$/s.exec(core) : null;
    if (num) {
      const [, a, b] = num;
      const textFirst = /\d/.test(b[0] ?? "") || /^[+-]\d/.test(b);
      const t = exact.get(textFirst ? a : b);
      if (t !== undefined) hit = textFirst ? `${t} ${b}` : `${a} ${t}`;
    }
    // Führende oder abschliessende Zeichen ("· Bank", "+ Elf", "Liga ·")
    const affix = hit === null ? /^([·•–—:+.,(]\s*)(.*[^\s·])(\s*[·:)]?)$/s.exec(core) ?? /^()(.*[^\s·])(\s*·)$/s.exec(core) : null;
    if (affix && affix[2] !== core) {
      const inner = find(affix[2], depth + 1);
      if (inner !== null) hit = affix[1] + inner + affix[3];
    }
    if (hit === null && depth < 2) hit = viaParts(core, depth);
    return depth === 0 ? remember(core, hit) : hit;
  }

  const translate = ((text: string) => {
    const hit = find(text);
    if (hit === null) return text;
    const lead = /^\s*/.exec(text)![0] ? " " : "";
    const trail = /\s*$/.exec(text)![0] ? " " : "";
    return lead + hit + trail;
  }) as Translator;
  translate.lookup = (text) => find(text);
  translate.size = size;
  return translate;
}
