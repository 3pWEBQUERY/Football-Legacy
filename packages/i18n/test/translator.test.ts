import { describe, expect, it } from "vitest";
import { createTranslator, langFromCookie } from "../src/index";
import { en } from "../src/en";

describe("Übersetzer", () => {
  const tr = createTranslator({
    Kader: "Squad",
    "{0} unterschreibt bei {1}!": "{0} signs for {1}!",
    "Antwort in {0} Tagen": "Reply in {0} days",
    "Wir respektieren {opp}.": "We respect {opp}.",
    "{0} bestreitet sein {1}. Spiel": "{0} plays his {1}th game",
    Landespokal: "National Cup",
    "Sieg im {0}": "Win in the {0}",
  });

  it("feste Texte, Leerraum und Unbekanntes", () => {
    expect(tr("Kader")).toBe("Squad");
    expect(tr("  Kader \n")).toBe(" Squad ");
    expect(tr("Emil Dahl")).toBe("Emil Dahl");
    expect(tr.lookup("Emil Dahl")).toBeNull();
  });

  it("Muster mit Platzhaltern, auch verschachtelt und benannt", () => {
    expect(tr("Emil Dahl unterschreibt bei SpVgg Bergburg!")).toBe("Emil Dahl signs for SpVgg Bergburg!");
    expect(tr("Antwort in 3 Tagen")).toBe("Reply in 3 days");
    expect(tr("Sieg im Landespokal")).toBe("Win in the National Cup");
    expect(tr("Wir respektieren Seewald.")).toBe("We respect Seewald.");
  });

  it("Ordnungszahlen und zusammengesetzte Texte", () => {
    expect(tr("Klein bestreitet sein 1. Spiel")).toBe("Klein plays his 1st game");
    expect(tr("Klein bestreitet sein 22. Spiel")).toBe("Klein plays his 22nd game");
    expect(tr("Klein bestreitet sein 12. Spiel")).toBe("Klein plays his 12th game");
    expect(tr("Kader · Landespokal")).toBe("Squad · National Cup");
    expect(tr("Antwort in 2 Tagen. Kader")).toBe("Reply in 2 days. Squad");
  });

  it("Datum und Geld", () => {
    expect(tr("Mo 06.07.2026")).toBe("Mon 06/07/2026");
    expect(tr("Montag, 6. Juli 2026")).toBe("Monday, 6 July 2026");
    expect(tr("54.6 Mio. €")).toBe("€54.6m");
    expect(tr("700k €")).toBe("€700k");
  });

  it("Sprach-Cookie", () => {
    expect(langFromCookie("fl_session=x; fl-lang=en")).toBe("en");
    expect(langFromCookie("fl-lang=fr")).toBe("de");
    expect(langFromCookie(null)).toBe("de");
  });

  it("englischer Katalog deckt die Hauptbegriffe ab", () => {
    expect(en.size).toBeGreaterThan(4000);
    for (const [de, english] of [["Kader", "Squad"], ["Taktik", "Tactics"], ["Weiter", "Continue"], ["Deutschland", "Germany"], ["TW", "GK"]]) expect(en(de)).toBe(english);
  });
});

describe("Mehrzeilige Nachrichten", () => {
  it("übersetzt Zeile für Zeile", () => {
    const text = "A – B 0:2\n\nTore:\n• 36' Max Scholz (THO)\n\nBester Spieler: Max Scholz (Note 7.6)\nEin gelungener Test. Testspiele zählen nicht in der Statistik, bringen aber Spielpraxis.";
    const out = en(text);
    expect(out).toContain("Goals:");
    expect(out).toMatch(/Best player: Max Scholz/i);
    expect(out).not.toMatch(/Bester|Testspiele/);
    expect(out.split("\n").length).toBe(text.split("\n").length);
  });
});

describe("Spielkommentar", () => {
  it("leere Platzhalter und Leerraum in eingesetzten Werten", () => {
    expect(en("TOR für ASH! A. Amara trifft.")).toBe("GOAL for ASH! A. Amara scores.");
    expect(en("TOR für ASH! A. Amara trifft. Vorlage: M. Krasniqi.")).toBe("GOAL for ASH! A. Amara scores. Assist: M. Krasniqi.");
  });
});
