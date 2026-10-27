/** Inhalte der Hilfe: Kapitel mit kurzen Erklärungen und ein Glossar. */
export interface HelpTopic { id: string; title: string; icon: string; items: { q: string; a: string }[] }

export const HELP: HelpTopic[] = [
  {
    id: "start", title: "Spielablauf", icon: "next",
    items: [
      { q: "Wie vergeht die Zeit?", a: "Mit „Weiter“ (oben rechts oder Strg + Leertaste) geht es Tag für Tag voran. An Spieltagen führt der Knopf zum Spiel. „Weiter“ hält automatisch an, wenn eine wichtige Nachricht eintrifft – welche Kategorien anhalten, stellst du unter Karriere → Einstellungen ein." },
      { q: "Was passiert an einem Spieltag?", a: "Vor dem Spiel kannst du die Aufstellung prüfen, eine Mannschaftsansprache halten oder auf die Pressekonferenz gehen. Im Spiel greifst du live ein: Wechsel, Taktik, Zurufe von der Seitenlinie und die Halbzeitansprache. Danach gibt es Spielbericht, Noten und eine Schlussansprache." },
      { q: "Was zeigt der Tagesbericht?", a: "Nach jedem Tag fasst er Training, Ergebnisse, Verletzungen und neue Nachrichten zusammen. Mit einem Klick auf eine Nachricht springst du direkt ins Büro." },
    ],
  },
  {
    id: "team", title: "Mannschaft & Taktik", icon: "team",
    items: [
      { q: "Stärke, Kondition und Moral", a: "Die Stärke (1–100) fasst die Attribute für die Position zusammen. Kondition sinkt mit jedem Spiel und erholt sich täglich – unter 75 % leidet die Leistung. Moral steigt mit Einsatzzeit, Siegen und guten Gesprächen." },
      { q: "Vertrautheit", a: "Neue Formationen und Einstellungen muss die Mannschaft erst lernen. Bleibst du bei einer Taktik, steigt die Vertrautheit und damit die Leistung." },
      { q: "Positionseignung", a: "Jede Spielerkarte zeigt, wie gut der Spieler auf seine Position passt. Ein Spieler auf einer fremden Position spielt schwächer. Mit individuellem Training lassen sich neue Positionen erlernen." },
      { q: "Gelbe Karten und Sperren", a: "Nach jeder fünften Gelben Karte folgt ein Spiel Sperre. Eine Rote Karte sperrt sofort. Auf der Taktiktafel warnt ein „!“ vor der drohenden Gelbsperre." },
      { q: "Kaderstatus und Spielzeit", a: "Jeder Spieler erwartet Einsätze passend zu seinem Status (Schlüsselspieler, Stammspieler, Rotation …). Bekommt er zu wenig Spielzeit, sinkt die Moral – bis hin zum Wechselwunsch." },
    ],
  },
  {
    id: "training", title: "Training & Jugend", icon: "youth",
    items: [
      { q: "Wie entwickeln sich Spieler?", a: "Junge Spieler wachsen bis zu ihrem Potenzial, am schnellsten bis 21. Spielzeit, ein guter Trainer und passendes Training beschleunigen das. Ab etwa 30 lässt vor allem die Physis nach." },
      { q: "Trainingsintensität", a: "Hohe Intensität bringt mehr Fortschritt, kostet aber Kondition und erhöht das Verletzungsrisiko. Vor wichtigen Spielen hilft ein Regenerationstag." },
      { q: "Jugendakademie", a: "Am Jugendtag kommt ein neuer Jahrgang in die U19. Ein besseres Nachwuchszentrum bringt stärkere Talente. Hochgezogene Eigengewächse zählen für die Vision des Vorstands." },
    ],
  },
  {
    id: "transfers", title: "Transfers & Verträge", icon: "transfer",
    items: [
      { q: "Wie läuft eine Verhandlung?", a: "Zuerst bietest du dem Verein eine Ablöse (auch mit Raten oder Weiterverkaufsbeteiligung). Nach einer Einigung verhandelst du mit dem Spieler und seinem Berater über Gehalt, Laufzeit, Handgeld und Rolle." },
      { q: "Transferfenster", a: "Transfers sind im Sommer (bis 31. August) und im Winter möglich. Am Deadline Day antworten Vereine sofort. Vereinslose Spieler kannst du jederzeit verpflichten." },
      { q: "Ausstiegsklausel", a: "Zahlt ein Verein die Klausel, darf er direkt mit dem Spieler verhandeln – ablehnen kannst du dann nicht. Grössere Vereine ziehen günstige Klauseln deiner Spieler höchstens einmal pro Saison." },
      { q: "Auslaufende Verträge", a: "Läuft ein Vertrag aus, geht der Spieler im Sommer ablösefrei. Dein Co-Trainer erinnert dich rechtzeitig. Verlängern kannst du im Spielerprofil oder unter Transfers → Verträge." },
      { q: "Leihen", a: "Leihen gelten bis Saisonende, optional mit Kaufoption oder Kaufpflicht. Beim Verleihen teilt ihr euch das Gehalt." },
    ],
  },
  {
    id: "club", title: "Verein, Vorstand & Finanzen", icon: "board",
    items: [
      { q: "Vertrauen des Vorstands", a: "Das Vertrauen steuert auf einen Wert zu, der sich aus Tabellenplatz und Saisonziel ergibt: im Soll etwa 60 %, je Platz besser oder schlechter rund 5 Punkte. Siege, Pokalerfolge und erreichte Ziele der Vision helfen zusätzlich. Bei sehr geringem Vertrauen folgt ein Ultimatum, danach die Entlassung." },
      { q: "Vorstandsvision", a: "Ein Dreijahresplan mit einem sportlichen Ziel und zwei Vereinszielen. Jedes erreichte Ziel stärkt sofort das Vertrauen, nach drei Jahren zieht der Vorstand Bilanz." },
      { q: "Woher kommt das Geld?", a: "Tickets, Sponsoren, TV-Gelder, Fanartikel und Prämien. Nach einem Aufstieg steigen TV- und Sponsorengelder, nach einem Abstieg sinken sie. Gehälter sind der grösste Kostenblock." },
      { q: "Fans", a: "Die Stimmung hängt von Ergebnissen, Tabellenplatz und Ticketpreisen ab. Sehr unzufriedene Fans protestieren – das kostet auch Vertrauen beim Vorstand." },
    ],
  },
  {
    id: "career", title: "Karriere & Vermächtnis", icon: "star",
    items: [
      { q: "Schwierigkeitsgrad", a: "Leicht: mehr Startkapital, höhere Einnahmen, geduldiger Vorstand. Schwer: knappe Kassen und wenig Geduld. Der Grad wird beim Start gewählt; in der Ruhmeshalle zählen Erfolge auf Schwer mehr (×1,25), auf Leicht weniger (×0,75)." },
      { q: "Erfahrung und Level", a: "Siege, Titel, Missionen und erledigte erste Schritte bringen Erfahrung. Neue Level schalten Funktionen frei, etwa die Gegner-Analyse oder das Scouting-Netzwerk." },
      { q: "Vereinsgeschichte und Ruhmeshalle", a: "Jede Saison wird für alle Vereine archiviert: Titel, Rekorde, Legenden und Trainer. In der Ruhmeshalle steigt dein Vermächtnis mit Titeln, Aufstiegen und Beständigkeit." },
      { q: "Jobwechsel und Nationalteam", a: "Unter Karriere → Freie Stellen bewirbst du dich bei anderen Vereinen. Mit gutem Ruf kommen auch Angebote von Nationalverbänden." },
    ],
  },
];
