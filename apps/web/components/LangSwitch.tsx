"use client";
import { useEffect, useState } from "react";
import type { Lang } from "@fl/i18n";
import { currentLang, setLanguage } from "@/lib/client/lang";

/** Sprachumschalter für Kopfzeilen: zeigt die jeweils andere Sprache an. */
export function LangSwitch() {
  const [lang, setLang] = useState<Lang>("de");
  useEffect(() => setLang(currentLang()), []);
  const other: Lang = lang === "de" ? "en" : "de";
  return (
    <button className="btn btn-ghost btn-sm" translate="no" onClick={() => setLanguage(other)} title={other === "en" ? "Switch to English" : "Auf Deutsch wechseln"} lang={other}>
      {other === "en" ? "EN" : "DE"}<span className="sr-only">{other === "en" ? " – Switch to English" : " – Auf Deutsch wechseln"}</span>
    </button>
  );
}
