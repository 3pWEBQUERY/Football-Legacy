/** Kategorien und Datumsformat der Neuigkeiten (Startseite und Admin-Bereich). */
export const CATEGORY_LABEL: Record<string, string> = {
  update: "Update",
  feature: "Neue Funktion",
  community: "Community",
  event: "Event",
  maintenance: "Wartung",
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL);

export function newsDate(iso: string, lang: string = "de") {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "de-DE", { day: "numeric", month: lang === "en" ? "short" : "2-digit", year: "numeric", timeZone: "Europe/Berlin" }).format(new Date(iso));
}
