"use client";
import { LANG_COOKIE, type Lang } from "@fl/i18n";

/** Aktuelle Sprache (vom Inline-Skript im Layout aus dem Cookie gesetzt). */
export function currentLang(): Lang {
  if (typeof document === "undefined") return "de";
  return document.documentElement.lang === "en" ? "en" : "de";
}

/** Sprache wechseln: Cookie setzen, im Konto speichern (falls angemeldet), neu laden. */
export async function setLanguage(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  await fetch("/api/account/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang }) }).catch(() => {});
  location.reload();
}
