/**
 * Sprachen von Football Legacy. Deutsch ist die Quellsprache: Texte stehen im
 * Code auf Deutsch, die englische Fassung entsteht über den Katalog
 * (`@fl/i18n/en`, nur bei Bedarf geladen).
 */
export type Lang = "de" | "en";
export const LANGS: { value: Lang; label: string; locale: string }[] = [
  { value: "de", label: "Deutsch", locale: "de-CH" },
  { value: "en", label: "English", locale: "en-GB" },
];
export const LANG_COOKIE = "fl-lang";
export const isLang = (v: unknown): v is Lang => v === "de" || v === "en";
export const localeOf = (lang: Lang) => (lang === "en" ? "en-GB" : "de-CH");

/** Sprache aus einem Cookie-Header lesen (Standard: Deutsch). */
export function langFromCookie(header: string | null | undefined): Lang {
  const m = /(?:^|;\s*)fl-lang=(de|en)\b/.exec(header ?? "");
  return (m?.[1] as Lang) ?? "de";
}

export { createTranslator, squash, type Catalog, type Translator } from "./translator";
