# Football Legacy – Schreibe Fussball Geschichte

Ein tiefgehender Fussball-Manager im Browser: Kader, Taktik, Transfers und Saisonverlauf, verbunden mit Gamification. Alle Vereine, Ligen und Spieler sind frei erfunden – nachempfunden an die Strukturen echter Länder.

## Was drin ist (Version 1.0, Stufe „Muss“)

| Bereich | Umsetzung |
| --- | --- |
| Welt | 155 Länder mit fiktiven Ligapyramiden (z. B. England 4 Stufen, Deutschland 3, Schweiz 2), über 3000 Vereine, regionale Namenspools, Archetypen und Wunderkinder |
| Simulation | Heimatland mit Detailsimulation (Matchengine), alle anderen Ligen vereinfacht (Poisson-Modell). Ligen werden per Scouting-Netzwerk oder beim Öffnen eines Vereins detailliert |
| Matchengine | 540 Ticks pro Spiel, Positionsdaten für 22 Spieler und den Ball, Aktionen (Pass, Dribbling, Schuss, Flanke, Klärung), Zweikämpfe, Fouls, Karten, Elfmeter, Ecken- und Freistossvarianten, Verletzungen, Ausdauer, Konter, Steilpässe hinter hohe Abwehrlinien |
| Taktik | 8 Formationen, frei verschiebbare Positionen, 18 Rollen, 7 Regler (Tempo, Passlänge, Breite, Risiko, Pressing, Abwehrlinie, Härte), Presets, Standardschützen |
| Spieltag | 2D-Taktikansicht (Canvas) in drei Geschwindigkeiten, Highlights, Ereignisliste, Halbzeit-Kabine mit Formation, Reglern und Wechseln, Abpfiff mit Noten und Belohnungen. Die Partie wird serverseitig simuliert |
| Management | Transfers mit Verhandlung (Gegenangebote, Geduld des Vereins), Ausstiegsklauseln, Verträge und Verlängerungen, Transferliste, Vertragsauflösung, KI-Angebote für deine Spieler, Finanzen (Tickets, Sponsoren, TV, Gehälter, Prämien), Training mit Schwerpunkten und Intensität, Trainerstab, Scouting mit unscharfen Werten |
| Saison | Spielplan (grosse Ligen spielen auch unter der Woche), Tabellen aller Länder, Auf- und Abstieg, Alterung, Rücktritte, auslaufende Verträge, Jugendjahrgang, Vorstandsziele, Entlassung, Jobangebote |
| Gamification | Manager-Level mit Titeln und Freischaltungen, 20 Erfolge, drei Tagesmissionen, Login- und Siegesserien, Spielerkarten-Sammlung, Kartenpakete mit offengelegten Chancen, Stadion-Skins, Ranglisten |
| Account | Registrierung per E-Mail und Passwort (scrypt), Sessions mit gehashten Tokens, bis zu fünf Karrieren parallel, Spielstände in PostgreSQL |
| Oberfläche | Seitenleiste (Desktop) und Tab-Leiste (Smartphone) mit fünf Bereichen, Dark und Light Mode über Design-Tokens, sortierbare Tabellen, Diagramme für Finanzen und Spielerprofil |

## Erweiterungen (Stufe 1.x)

| Bereich | Umsetzung |
| --- | --- |
| Live-Eingriffe | Die Partie wird in Abschnitten von fünf Spielminuten simuliert. Über „Eingreifen“ lassen sich Formation, Regler und Wechsel jederzeit ändern; sie greifen ab dem nächsten Abschnitt |
| Landespokal | K.-o.-Wettbewerb für alle Vereine des Heimatlands mit Vorrunde und Freilosen, klassentiefere Vereine mit Heimrecht, Elfmeterschiessen, Prämien pro Runde, eigene Pokalseite mit Turnierbaum |
| Pressekonferenzen | Vor jedem Spiel bis zu drei Fragen je nach Lage (Favorit, Krise, Form, Leistungsträger, Verletzungen, Druck des Vorstands, Pokal). Die Antworten wirken auf Moral und Vorstandsvertrauen |
| Saisonrückblick | Auszeichnungen der Liga (Spieler der Saison, Torschützenkönig, Vorbereiter, Talent, Torhüter), Elf der Saison, Abschlusstabelle und Bilanz des eigenen Vereins für jede gespielte Saison |
| Leihgeschäfte | Spieler bis Saisonende ausleihen (Gehaltsanteil verhandelbar) oder eigene Spieler verleihen; Rückkehr zum Saisonende, Gehälter werden anteilig verrechnet |
| Tageskalender | Die Zeit läuft Tag für Tag: Saisonstart Anfang Juli, zwei Testspiele in der Vorbereitung, Ligaspiele samstags von Ende Juli bis Mai (kurze Ligen mit freien Wochenenden), Kontinentalpokal dienstags, Landespokal mittwochs, Winterpause über den Jahreswechsel. Kondition erholt sich täglich (Regenerationstage stärker), Trainingsereignisse, Gegneranalyse zwei Tage vor dem Spiel, Scoutberichte mit Laufzeit, Monatsberichte der Finanzen, Deadline Day. Monatskalender im Büro |
| Kontinentalpokal | Die besten Vereine des eigenen Kontinentalverbands (32 Teams, bis zu vier pro Topliga, Qualifikation über die Abschlusstabelle, in der ersten Saison über den Ruf). Gruppenphase mit acht Vierergruppen am Dienstag, K.-o.-Runden in einem Spiel mit Elfmeterschiessen, Antritts-, Sieg- und Rundenprämien, eigene Seite mit Gruppentabellen und Turnierbaum |
| Spielergespräche | Loben, Kritisieren, Zuspruch, Einsatzzeit versprechen. Wirkung hängt von Form, Moral und Nervenstärke ab; gebrochene Versprechen kosten viel Moral |
| Transferfenster | Nach Datum: Sommer bis 31. August, Winter rund um die Winterpause, mit Hinweisen zur Öffnung, eine Woche vorher und am Deadline Day |
| Jugendakademie | Eigener U19-Kader: am Jugendtag im Februar kommt ein neuer Jahrgang (Grösse und Qualität nach Jugendtrainer und Akademiestufe). Talente trainieren wöchentlich, die Werte sind Einschätzungen des Jugendtrainers. Ab 16 hochziehen, mit 20 verlassen sie die Akademie |
| Vorstand und Anlagen | Anfragen an den Vorstand: mehr Transferbudget, Ausbau von Trainingszentrum und Jugendakademie (fünf Stufen) und Stadion. Entscheidung nach Vertrauen und Finanzen, Bauprojekte mit Fertigstellungsdatum |
| Weiter wie im Manager | „Weiter“ lässt die Tage automatisch ablaufen; das Datum in der Kopfleiste läuft mit. Die Verarbeitung hält an, sobald etwas Wichtiges passiert (Spielvorbereitung, Testspiel, Verletzung, Transfers, Vorstand, Scoutbericht, Jugendtag), öffnet die Nachricht im Posteingang und führt am Spieltag direkt zum Spiel. Ein zweiter Klick (oder Strg + Leertaste) hält an |
| Training und Ansprache | Tägliche Einheiten nach Wochentag und Schwerpunkt, Trainingsnoten wirken leicht auf die Form (Ø im Kader sichtbar). Mannschaftsansprache vor dem Anpfiff mit drei Tonlagen, Wirkung nach Favoritenrolle und Moral |
| Individuelles Training | Eigener Schwerpunkt pro Spieler und Umschulung auf eine neue Position (Fortschritt pro Woche, jüngere Spieler lernen schneller) |
| Länderspielpausen | Im September, Oktober, November und März werden starke Spieler je nach Land nominiert: sie fehlen im Training, sammeln Länderspiele und Tore und kehren mit Moral, Müdigkeit oder einer Verletzung zurück. Im Kalender markiert |
| Co-Trainer | Hinweise im Vorbericht: verletzte, gesperrte oder müde Spieler in der Startelf, Spieler auf fremder Position, stärkere Alternativen, zu kleine Bank |
| Scouting-Zentrale | Aufträge nach Land, Position und Höchstalter (Anzahl, Dauer und Genauigkeit je nach Chefscout, Ausland teurer). Nach Ablauf liefert der Scout fünf Empfehlungen mit Bericht, die Kader fremder Ligen werden dafür bei Bedarf erzeugt |
| Medizin | Verletzungsarten passend zur Dauer (Prellung bis Kreuzbandriss), Meldungen bei Genesung, Seite mit Verletzten, voraussichtlicher Rückkehr, Sperren und Verletzungsrisiko |
| Navigation | Horizontales Hauptmenü mit Untermenüs, Datum und Weiter-Button in der Kopfleiste |
| Charakterzüge | Bis zu zwei feste Eigenschaften je Spieler (ehrgeizig, Profi, launisch, Führungsspieler, Wettkampftyp, nervös, vereinstreu, geldorientiert, verletzungsanfällig). Sie wirken auf Entwicklung, Moral, Kapitänsrolle, Leistung in Derbys/Pokal/Relegation, Verletzungen, Gehaltsforderungen und Wechselwünsche; sichtbar bei eigenen und gut bekannten Spielern |
| Stadionton | Synthetisch im Browser erzeugt (keine Audiodateien): Zuschauer, Raunen bei Chancen, Torjubel bzw. Stöhnen je nach Heim- und Gästeblock, Trillerpfiffe. Schalter im Spiel, Lautstärke in den Einstellungen (pro Gerät) |
| Installierbare App | Web-App-Manifest, Symbole, Service Worker mit Offline-Hinweis; „App installieren“ auf der Karrierenseite und in den Einstellungen |
| Push-Mitteilungen | Web Push (VAPID) für Online-Ligen (Spieltage, Saisonstart, Beitritte, Nachrichten) und lange Berechnungen, wenn die Seite inzwischen geschlossen wurde. Themen pro Gerät wählbar, Testmitteilung |
| Hintergrunddienst | Rechenintensive Aufrufe (Weiter, Spiele, neue Karriere, Online-Spieltage) laufen über eine Warteschlange in PostgreSQL und einen eigenen Prozess; tägliche Online-Ligen spielen ihre Spieltage selbstständig |

## Architektur

Drei klar getrennte Ebenen als TypeScript-Pakete in einem pnpm-Monorepo:

```
packages/sim    @fl/sim   Reine Simulation ohne UI und Datenbank: Welt- und Spielergenerator,
                          Matchengine, Saison, Training, Finanzen, Transferregeln, Gamification
packages/game   @fl/game  Game-Server: PostgreSQL-Schema und Migrationen, Accounts, Karrieren,
                          Spielwoche, Saisonende, Aktionen und lesende Sichten
apps/web        @fl/web   Next.js: JSON-API unter /api/* und der Browser-Client
```

- Die Simulation bekommt nur einfache Datenobjekte und ist deterministisch (gleicher Seed → gleiches Ergebnis).
- Spiele werden auf dem Server in Abschnitten simuliert, der Spielstand wird nach jedem Abschnitt in der Datenbank gespeichert. Der Browser puffert die Positionsdaten und spielt sie ab.
- Hintergrunddienst (`packages/game/src/worker`): Die API legt rechenintensive Aufträge in `sim_jobs` ab, ein eigener Node-Prozess holt sie mit `FOR UPDATE SKIP LOCKED` ab (mehrere Prozesse möglich), die Anfrage wartet nur auf das Ergebnis. Der Webserver startet den gebündelten Dienst (`apps/web/worker.cjs`, gebaut mit `pnpm --filter @fl/game build:worker`) als Kindprozess und startet ihn nach Abstürzen neu. Ohne laufenden Dienst wird wie bisher direkt in der Anfrage gerechnet. `/api/health` zeigt die Zahl der aktiven Dienste.
- Die API (`apps/web/lib/server/router.ts`) akzeptiert Cookies oder `Authorization: Bearer <token>` – die spätere iOS-App kann sie unverändert nutzen (`returnToken: true` beim Login liefert das Token).

## Lokal starten

Voraussetzungen: Node.js 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
createdb football_legacy                       # oder eine bestehende Datenbank nutzen
cp .env.example apps/web/.env.local            # DATABASE_URL anpassen
pnpm --filter @fl/web build && pnpm start      # Produktion auf http://localhost:3000
# oder: pnpm dev
```

Die Migrationen laufen beim Serverstart automatisch (`instrumentation.ts`), alternativ mit `pnpm migrate`.

## Tests

```bash
pnpm test               # alle Pakete
pnpm sim:calibrate 400  # Statistik der Matchengine über viele Partien
pnpm sim:season GER 1   # eine komplette Ligasaison in der Konsole
pnpm --filter @fl/game balance 4 GER 8 4242 --active   # Balancing: mehrere Saisons ohne Browser messen
```

Das Balancing-Skript (`packages/game/scripts/balance.ts`) legt in einer eigenen Datenbank (`BALANCE_DATABASE_URL`, Standard `football_legacy_balance` – wird geleert) eine Karriere an und spielt Saisons in der Schnellsimulation durch. Je Saison gibt es Wirtschaft des eigenen Vereins und der KI-Vereine, Spielerniveau und -bestand, Transfers, Torquote sowie den Verlauf des Vorstandsvertrauens aus. `--active` verlängert zu Saisonbeginn die Verträge der Stammspieler wie ein aktiver Manager. Zielwerte nach dem Balancing: eigener Verein bei normaler Führung leicht im Plus, KI-Vereine praktisch schuldenfrei, Kader höchstens 28 Spieler, Startelf-Niveau der Startvereine stabil, höchstens eine gezogene Ausstiegsklausel pro Saison.

- `packages/sim/test/balance.test.ts` hält die Balancing-Grenzen fest (Tore, Heimvorteil, Favoriten, Überschuss der Finanzprofile).
- `packages/sim/test` prüft Determinismus, Halbzeit-Speicherung, Spielplan, Tabelle und die Statistik über hunderte Partien (rund 2,7 Tore pro Spiel, Heimvorteil, Favorit gewinnt meistens, aber nicht immer).
- `packages/game/test` spielt gegen eine echte PostgreSQL-Datenbank eine komplette Saison inklusive Saisonwechsel (`TEST_DATABASE_URL`, Standard `postgres://fl:fl@localhost:5432/football_legacy_test` – die Testdatenbank wird dabei geleert).

Kennzahlen der Engine (gleich starke Teams): ~2,7 Tore, ~23 Schüsse, ~2,7 Gelbe Karten, Heimsiege 45 % / Remis 25 % / Auswärtssiege 30 %. Eine Partie dauert ~9 ms, eine Spielwoche mit vier detaillierten englischen Ligen ~0,8 s.

## Deployment auf Railway

1. Neues Projekt mit einem PostgreSQL-Service anlegen.
2. Dieses Repository als Service hinzufügen – gebaut wird über das `Dockerfile` (siehe `railway.json`, Healthcheck `/api/health`).
3. Im Web-Service die Variablen `DATABASE_URL=${{Postgres.DATABASE_URL}}` und `PORT=3000` setzen und eine Domain auf Port 3000 generieren (ohne `PORT` startet Railway den Server auf 8080 – dann muss die Domain auf 8080 zeigen).

Live-Instanz: https://web-production-4d4918.up.railway.app (Railway-Projekt „Football Legacy“, Region europe-west4).

Beim ersten Start legt der Server das Schema selbst an und startet den Hintergrunddienst als Kindprozess. Bei viel Last lässt sich der Dienst als eigener Railway-Service betreiben: gleiches Repository, Startbefehl `node apps/web/worker.cjs`, dieselbe `DATABASE_URL`; im Web-Service dann `WORKER_MODE=off` setzen.

### Weitere Variablen

| Variable | Zweck |
|---|---|
| `RESEND_API_KEY` | API-Schlüssel von [Resend](https://resend.com) für E-Mails (Passwort zurücksetzen). Ohne Schlüssel wird nichts verschickt, nur protokolliert. |
| `MAIL_FROM` | Absender, z. B. `Football Legacy <noreply@deine-domain.ch>`. Die Domain muss bei Resend verifiziert sein; ohne eigene Domain kann `onboarding@resend.dev` nur an die E-Mail des Resend-Kontos senden. |
| `APP_URL` | Öffentliche Adresse für Links in E-Mails. Optional – auf Railway wird `RAILWAY_PUBLIC_DOMAIN` verwendet. |
| `WORKER_MODE` | `fork` (Standard): Webserver startet den Hintergrunddienst selbst. `off`: Dienst läuft separat. |
| `JOB_MODE` | `auto` (Standard): Warteschlange, sobald ein Dienst läuft. `inline`: immer direkt in der Anfrage rechnen. |
| `WORKER_CONCURRENCY` | Parallele Aufträge pro Dienst (Standard 2). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional. Ohne Angabe erzeugt der Server die Push-Schlüssel beim ersten Bedarf selbst und speichert sie in der Datenbank (`app_secrets`). |
| `LEGAL_NAME`, `LEGAL_ADDRESS`, `LEGAL_EMAIL` | Angaben für Impressum und Datenschutzerklärung. Mehrzeilige Anschrift mit `|` trennen, z. B. `Musterstrasse 1|8000 Zürich|Schweiz`. |

### Backups

Die Datenbank liegt auf dem Volume `postgres-volume`. Unter Postgres → Volume → *Backups* lassen sich tägliche (6 Tage aufbewahrt) und wöchentliche Sicherungen (1 Monat) einschalten und Stände wiederherstellen. Die Zeitpläne müssen im Railway-Dashboard aktiviert werden.

### Browser-Test

`pnpm e2e [Screenshot-Ordner]` (Server muss laufen, `E2E_URL` Standard `http://localhost:3000`) registriert einen Account, startet eine Karriere, öffnet alle Hauptseiten, simuliert ein Spiel, prüft „Passwort vergessen“, die Rechtstexte und die Smartphone-Ansicht. In der CI läuft er nach dem Build gegen die Testdatenbank.

## Nächste Schritte

- Offene Entscheidungen aus dem Konzept: Monetarisierung, Magic-Link statt Passwort, Logo/Design-System, Online-Umfang (nur Ranglisten oder gemeinsame Ligen).
- Stufe 1.x: detailliertere Jugendakademie, Medien und Spielerinteraktionen, internationale Wettbewerbe.
- Technik: Fehlerüberwachung, weitere Sprachen.
