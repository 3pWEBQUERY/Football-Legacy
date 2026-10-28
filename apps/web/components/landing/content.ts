/** Inhalte der Startseite. Zahlen stammen aus dem Spiel (Länderliste, Matchengine, Taktik). */

export interface Feature {
  id: string;
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
  shot: string;
  alt: string;
}

export const FACTS: { value: string; label: string }[] = [
  { value: "155", label: "Länder mit eigener Ligapyramide" },
  { value: "3.000+", label: "fiktive Vereine in jeder Welt" },
  { value: "540", label: "Spielzüge pro Partie" },
  { value: "18", label: "Spielerrollen in 8 Formationen" },
];

export const FEATURES: Feature[] = [
  {
    id: "spieltag",
    eyebrow: "Spieltag",
    title: "Jedes Spiel live an der Seitenlinie",
    text: "Die Matchengine rechnet jede Partie Zug für Zug aus Attributen, Form, Kondition, Wetter und deiner Taktik. Du verfolgst sie in der 2D-Ansicht, greifst mit Zurufen und Wechseln ein und stellst in der Halbzeit die Weichen neu.",
    points: ["Live-Ticker, Statistik und Expected Goals", "Halbzeit- und Schlussansprache an die Mannschaft", "Schiedsrichter, Wetter und Abseits spielen mit"],
    shot: "match",
    alt: "Livespiel in der Halbzeitpause mit Statistik, Live-Ticker und Kabinenansprache",
  },
  {
    id: "taktik",
    eyebrow: "Taktik",
    title: "Deine Spielidee, bis ins Detail",
    text: "Formation, Rollen und Aufgaben, Mentalität, Pressing und Abwehrlinie – getrennt für Ballbesitz und gegen den Ball. Neue Ideen brauchen Zeit, bis die Mannschaft sie verinnerlicht hat. Wer ständig umstellt, verliert die Eingespieltheit.",
    points: ["8 Formationen, 18 Rollen mit eigenen Aufgaben", "Anweisungen mit Ball und gegen den Ball", "Standardsituationen und Gegneranweisungen"],
    shot: "tactics",
    alt: "Taktikbrett mit Formation, Rollen und Eignung der Spieler",
  },
  {
    id: "transfers",
    eyebrow: "Transfers",
    title: "Verhandeln wie am echten Tisch",
    text: "Scoute Spieler auf der ganzen Welt, einige dich mit dem Verein über Ablöse, Raten und Weiterverkaufsbeteiligung und danach mit dem Berater über Gehalt, Rolle und Ausstiegsklausel. Die KI-Vereine bieten mit, verleihen Talente und reagieren auf Wechselwünsche.",
    points: ["Scouting mit unscharfen Werten", "Leihen, Vorverträge und Deadline Day", "KI-Vereine handeln nach denselben Regeln"],
    shot: "transfers",
    alt: "Spielersuche im Transfermarkt mit Filtern, Stärke und Marktwert",
  },
  {
    id: "spieler",
    eyebrow: "Spieler",
    title: "Spieler mit Charakter",
    text: "28 Attribute, Potenzial, Form und Moral, dazu Charakterzüge wie Führungsspieler oder Trainingsweltmeister. Spieler wollen Einsatzzeit, erinnern dich an Versprechen und haben im Mannschaftsrat eine Stimme. Aus der eigenen Akademie kommen jedes Jahr neue Talente.",
    points: ["Individuelles Training und Positionsumschulung", "Gespräche mit Versprechen und Folgen", "Jugendakademie mit eigener U19-Liga"],
    shot: "player",
    alt: "Spielerprofil mit Attributen, Charakterzügen und Vertrag",
  },
  {
    id: "verein",
    eyebrow: "Verein",
    title: "Ein ganzer Verein in deiner Verantwortung",
    text: "Ticketpreise, Sponsoren, Gehaltsbudget und Vereinsanlagen: Der Vorstand erwartet Ergebnisse und gibt eine Vision für drei Jahre vor. Wer sie verfehlt, muss gehen. Wer sie übertrifft, bekommt Angebote anderer Vereine.",
    points: ["Finanzen mit allen Einnahmen und Ausgaben", "Vorstand, Fans und Medien mit eigener Stimme", "Stellenmarkt, Entlassung und Vereinswechsel"],
    shot: "board",
    alt: "Vorstandsseite mit Saisonziel, Vertrauen und Vision für drei Jahre",
  },
  {
    id: "wettbewerbe",
    eyebrow: "Wettbewerbe",
    title: "Liga, Pokal, Kontinent und Nationalteam",
    text: "Ligapyramiden nach echtem Vorbild mit Auf- und Abstieg und Relegation, ein Landespokal mit Elfmeterschiessen und ein Kontinentalpokal mit Gruppenphase. Mit wachsendem Ruf kannst du zusätzlich ein Nationalteam übernehmen.",
    points: ["Vereinsgeschichte, Rekorde und Ruhmeshalle", "Monats- und Saisonauszeichnungen", "Ranglisten unter allen Managern"],
    shot: "competition",
    alt: "Ligatabelle mit Form, Torjägern und Spieltag",
  },
  {
    id: "online",
    eyebrow: "Online",
    title: "Gemeinsam in der Online-Liga",
    text: "Gründe eine Liga mit Freunden oder tritt einer öffentlichen bei. Jeder bringt seinen eigenen Verein mit, gespielt wird täglich oder auf Zuruf, und im Liga-Chat wird nach dem Spieltag gefachsimpelt.",
    points: ["Freie Plätze mit CPU-Teams füllen", "Spieltag täglich oder wenn alle bereit sind", "Melden und Blockieren im Chat"],
    shot: "online",
    alt: "Online-Liga mit Tabelle, Spielplan und Liga-Chat",
  },
];

export const ANYWHERE: string[] = [
  "Läuft im Browser – ohne Download, auf Computer, Tablet und Smartphone",
  "Als App installierbar, mit Mitteilungen zum Spieltag",
  "Spielstände in der Cloud: dort weiterspielen, wo du aufgehört hast",
  "Auf Deutsch und Englisch",
];

export const FAQ: { q: string; a: string }[] = [
  { q: "Was kostet Football Legacy?", a: "Nichts. Football Legacy ist kostenlos und ohne Werbung. Du brauchst nur ein Konto mit E-Mail-Adresse." },
  { q: "Gibt es echte Vereine und Spieler?", a: "Nein. Die Länder sind echt, Ligen, Vereine und Spieler sind frei erfunden. Namen und Städte entstehen regional passend aus Silben, Ähnlichkeiten mit realen Personen oder Vereinen sind zufällig." },
  { q: "Muss ich etwas herunterladen?", a: "Nein, Football Legacy läuft im Browser. Auf dem Smartphone kannst du es wie eine App auf den Startbildschirm legen." },
  { q: "Wo werden meine Spielstände gespeichert?", a: "Auf unserem Server, automatisch nach jedem Spieltag. Du kannst mehrere Karrieren parallel führen und deine Daten jederzeit herunterladen oder löschen." },
  { q: "Welche Rolle spielt KI?", a: "Die gegnerischen Vereine werden von einer Spiel-KI geführt: Taktik, Aufstellung, Transfers und Leihen. Wer möchte, schaltet zusätzlich KI-Texte ein – freie Antworten in der Pressekonferenz, Spielberichte und einen Co-Trainer zum Fragen." },
  { q: "Ab welchem Alter darf ich spielen?", a: "Football Legacy richtet sich an Personen ab 16 Jahren." },
];
