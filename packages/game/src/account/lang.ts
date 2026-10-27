/**
 * Sprache eines Kontos (Einstellung "lang", Standard Deutsch) und
 * serverseitige Übersetzung für Texte, die nicht im Browser landen:
 * E-Mails und Push-Mitteilungen.
 */
import { isLang, type Lang } from "@fl/i18n";
import { one, pool } from "../db";

export async function accountLang(by: { id?: string; email?: string }): Promise<Lang> {
  const r = by.id
    ? await one<{ lang: string | null }>(pool(), "select settings->>'lang' as lang from accounts where id = $1", [by.id])
    : await one<{ lang: string | null }>(pool(), "select settings->>'lang' as lang from accounts where lower(email) = lower($1)", [by.email ?? ""]);
  return isLang(r?.lang) ? r!.lang : "de";
}

/** Übersetzer für die Sprache; Deutsch gibt den Text unverändert zurück. Der Katalog wird erst bei Bedarf geladen. */
export async function translatorFor(lang: Lang): Promise<(s: string) => string> {
  if (lang === "de") return (s) => s;
  const { en } = await import("@fl/i18n/en");
  return en;
}

const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e as string]!);
const encode = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Textabschnitte zwischen HTML-Tags übersetzen (für Mails aus layout()). */
export function translateHtml(html: string, tr: (s: string) => string): string {
  return html.replace(/>([^<>]+)</g, (all, text: string) => (text.trim() ? `>${encode(tr(decode(text)))}<` : all));
}
