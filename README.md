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
| Spielbedingungen | Wetter nach Land und Monat (Sonne, Regen, Starkregen, Schnee, Wind, Hitze, Nebel) wirkt auf Technik, lange Bälle, Torhüter und Kondition; Schiedsrichter mit unterschiedlicher Strenge (Karten); Abseits bei Steilpässen. Anzeige in Vorschau, Live-Spiel und Spielbericht |
| Vorverträge | Ab dem 1. Januar mit Spielern im letzten Vertragsjahr anderer Vereine: nur Vertragsgespräch, Wechsel im Sommer ablösefrei. KI-Vereine werben auch deine auslaufenden Spieler ab, die Sportdirektion warnt zum Jahreswechsel |
| U19-Liga | Die Akademie spielt eine eigene Saison gegen die Nachwuchsteams der Ligakonkurrenten (Tabelle, Ergebnisse, Torschützen). Eigene Spiele laufen durch die Matchengine; Einsatzminuten treiben die Entwicklung. Kleine Akademien werden zum Start mit bestehendem Nachwuchs aufgefüllt |
| Mannschaftsrat | Kapitän und vier Führungsspieler; ihre Stimmung färbt auf die Kabine ab. Einmal im Monat ein Anliegen (Einsatzzeiten, Belastung, Ergebnisse, Prämie, Verträge) mit zwei Antworten und Wirkung auf die Moral; unbeantwortet verfällt es nach 14 Tagen |
| KI-Gegner | Regelbasierte KI-Trainer: Mentalität nach Spielstand (bei Rückstand offensiver, knappe Führung absichern), Grundausrichtung je Gegner, Rotation in englischen Wochen und im Pokal. Jeder Trainer hat eine Spielidee (Formation und Stil), ein Trainerwechsel stellt das Team um. KI-Vereine setzen Ergänzungsspieler auf die Transferliste, verleihen Talente und bieten bei deinen Verhandlungen mit (Konkurrenzangebot mit Frist) |
| Claude im Spiel (optional) | Mit `ANTHROPIC_API_KEY` und Einwilligung in den Einstellungen: eigene Antworten in der Pressekonferenz (Claude Sonnet 5.5 ordnet sie festen Wirkungen zu), Spielberichte von Claude und ein Co-Trainer-Chat auf Basis der Spieldaten. Strukturierte Ausgaben, Rückfall auf Vorlagen, 80 Anfragen pro Tag und Konto |
| Stadionton | Synthetisch im Browser erzeugt (keine Audiodateien): Zuschauer, Raunen bei Chancen, Torjubel bzw. Stöhnen je nach Heim- und Gästeblock, Trillerpfiffe. Schalter im Spiel, Lautstärke in den Einstellungen (pro Gerät) |
| Installierbare App | Web-App-Manifest, Symbole, Service Worker mit Offline-Hinweis; „App installieren“ auf der Karrierenseite und in den Einstellungen |
| Push-Mitteilungen | Web Push (VAPID) für Online-Ligen (Spieltage, Saisonstart, Beitritte, Nachrichten) und lange Berechnungen, wenn die Seite inzwischen geschlossen wurde. Themen pro Gerät wählbar, Testmitteilung |
| Sicherheit | Registrierung ab 16 mit Zustimmung zu den Nutzungsbedingungen (bestehende Konten holen sie nach), Limits gegen Passwort-Raten (8 Fehlversuche je Adresse bzw. 30 je IP in 15 Minuten) und Massenregistrierung (5 je IP und Stunde), E-Mail-Bestätigung (Pflicht für Liga-Chat und öffentliche Ligen, sobald der Mailversand eingerichtet ist), Fehlerprotokoll für Server, Hintergrunddienst und Browser mit Übersicht für Administratoren, deutsche Fehlerseiten |
| Chat-Moderation | Nachrichten melden (ab zwei Meldungen ausgeblendet, Gründer wird informiert), eigene Nachrichten löschen, Gründer löscht jede Nachricht, Mitglieder blockieren |
| Hintergrunddienst | Rechenintensive Aufrufe (Weiter, Spiele, neue Karriere, Online-Spieltage) laufen über eine Warteschlange in PostgreSQL und einen eigenen Prozess; tägliche Online-Ligen spielen ihre Spieltage selbstständig |

## Architektur

Drei klar getrennte Ebenen als TypeScript-Pakete in einem pnpm-Monorepo:

```
packages/sim    @fl/sim   Reine Simulation ohne UI und Datenbank: Welt- und Spielergenerator,
                          Matchengine, Saison, Training, Finanzen, Transferregeln, Gamification
packages/game   @fl/game  Game-Server: PostgreSQL-Schema und Migrationen, Accounts, Karrieren,
                          Spielwoche, Saisonende, Aktionen und lesende Sichten
packages/i18n  @fl/i18n  Sprachen: Übersetzer und englischer Katalog (deutsch ist die Quellsprache)
apps/web        @fl/web   Next.js: JSON-API unter /api/* und der Browser-Client
```

- Die Simulation bekommt nur einfache Datenobjekte und ist deterministisch (gleicher Seed → gleiches Ergebnis).
- Spiele werden auf dem Server in Abschnitten simuliert, der Spielstand wird nach jedem Abschnitt in der Datenbank gespeichert. Der Browser puffert die Positionsdaten und spielt sie ab.
- Hintergrunddienst (`packages/game/src/worker`): Die API legt rechenintensive Aufträge in `sim_jobs` ab, ein eigener Node-Prozess holt sie mit `FOR UPDATE SKIP LOCKED` ab (mehrere Prozesse möglich), die Anfrage wartet nur auf das Ergebnis. Der Webserver startet den gebündelten Dienst (`apps/web/worker.cjs`, gebaut mit `pnpm --filter @fl/game build:worker`) als Kindprozess und startet ihn nach Abstürzen neu. Ohne laufenden Dienst wird wie bisher direkt in der Anfrage gerechnet. `/api/health` zeigt die Zahl der aktiven Dienste.
- Englische Fassung (`packages/i18n`): Alle Texte stehen deutsch im Code. `pnpm i18n:extract` zieht sie per TypeScript-Compiler aus Oberfläche, Spiellogik und Engine – Vorlagen wie `` `${a} unterschreibt bei ${b}!` `` werden zu Mustern („{0} unterschreibt bei {1}!“) – und schreibt fehlende Übersetzungen nach `catalog/missing.*.json`; die Übersetzungen stehen in `catalog/en.*.json` (`en.manual.json` für Kürzel und Sonderfälle). Im Browser übersetzt `components/LangRuntime.tsx` für englische Spieler die gerenderte Oberfläche nach dem Hydrieren (der Katalog wird nur dann geladen); dadurch sind auch gespeicherte Nachrichten, News und Spielkommentare alter Spielstände englisch. E-Mails und Push-Mitteilungen übersetzt der Server in der Kontosprache (`settings.lang`), KI-Texte schreibt Claude direkt auf Englisch. Die Sprache steckt im Cookie `fl-lang` und im Konto (Umschalter oben rechts und unter Einstellungen). Mehrdeutige Kürzel geben ihre Übersetzung ausdrücklich mit (`data-en="W"`), Nutzertexte wie Chat-Nachrichten sind mit `translate="no"` ausgenommen. Die CI bricht ab, wenn neue Texte ohne Übersetzung dazukommen; `pnpm e2e:i18n` prüft die Hauptseiten auf deutsche Reste.
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
| `ANTHROPIC_API_KEY` | API-Schlüssel von [Anthropic](https://console.anthropic.com) für die freiwilligen KI-Funktionen (Claude Sonnet 5.5). Ohne Schlüssel sind sie ausgeschaltet. |
| `MAIL_FROM` | Absender, z. B. `Football Legacy <noreply@deine-domain.ch>`. Die Domain muss bei Resend verifiziert sein; ohne eigene Domain kann `onboarding@resend.dev` nur an die E-Mail des Resend-Kontos senden. |
| `APP_URL` | Öffentliche Adresse für Links in E-Mails. Optional – auf Railway wird `RAILWAY_PUBLIC_DOMAIN` verwendet. |
| `ADMIN_EMAILS` | Kommagetrennte E-Mail-Adressen mit Zugang zum Admin-Bereich `/admin` (Kennzahlen, Moderation, KI-Kosten, Fehlerprotokoll). |
| `ADMIN_MFA` | `required` (Standard): Admins müssen eine Authenticator-App einrichten und jede Sitzung mit einem Code bestätigen (12 h gültig). `off` nur im Notfall, z. B. bei verlorenem Gerät – danach neu einrichten. |
| `WORKER_MODE` | `fork` (Standard): der Webserver startet den Hintergrunddienst selbst. `off`: kein eigener Dienst – für den Betrieb mit separatem Worker-Dienst (siehe unten). |
| `SENTRY_DSN` | Optional. Unerwartete Fehler gehen zusätzlich an [Sentry](https://sentry.io) (ohne SDK, über die Envelope-API). Ohne DSN bleibt es beim eigenen Fehlerprotokoll in der Datenbank (30 Tage). |
| `WORKER_MODE` | `fork` (Standard): Webserver startet den Hintergrunddienst selbst. `off`: Dienst läuft separat. |
| `JOB_MODE` | `auto` (Standard): Warteschlange, sobald ein Dienst läuft. `inline`: immer direkt in der Anfrage rechnen. |
| `WORKER_CONCURRENCY` | Parallele Aufträge pro Dienst (Standard 2). Faustregel: Anzahl vCPUs des Dienstes, höchstens 4. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional. Ohne Angabe erzeugt der Server die Push-Schlüssel beim ersten Bedarf selbst und speichert sie in der Datenbank (`app_secrets`). |
| `LEGAL_NAME`, `LEGAL_ADDRESS`, `LEGAL_EMAIL` | Angaben für Impressum und Datenschutzerklärung. Mehrzeilige Anschrift mit `|` trennen, z. B. `Musterstrasse 1|8000 Zürich|Schweiz`. |

### Sicherheit und Speicherdauer

- **Header:** `proxy.ts` setzt pro Seite eine Content-Security-Policy mit Nonce (Skripte nur von der eigenen Domain oder mit Nonce, keine Einbettung in fremde Seiten). `next.config.ts` ergänzt für alle Antworten `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` und in Produktion `Strict-Transport-Security`.
- **Zwei-Faktor für Admins:** TOTP nach RFC 6238 (`packages/game/src/account/totp.ts`), Einrichtung per QR-Code im Admin-Bereich. Notfall ohne Gerät: `ADMIN_MFA=off` setzen oder in der Datenbank `update accounts set totp_secret = null, totp_enabled_at = null where email = '…';`.
- **Inaktive Konten:** Der Hintergrunddienst löscht stündlich abgelaufene Sitzungen und Links. Konten ohne Anmeldung seit 11 Monaten bekommen eine Erinnerung per E-Mail; meldet sich niemand innerhalb von 30 Tagen an, wird das Konto mit allen Spielständen gelöscht (Admins ausgenommen). Ohne eingerichteten Mailversand wird nie gelöscht.

### Eigener Worker-Dienst (optional)

Wenn die Rechenlast steigt, laufen Webserver und Hintergrunddienst besser getrennt:

1. In Railway im selben Projekt einen neuen Dienst aus demselben GitHub-Repository anlegen.
2. Beim neuen Dienst unter *Settings → Config-as-code* den Pfad `railway.worker.json` eintragen (Startbefehl `node apps/web/worker.cjs`, kein Healthcheck).
3. Die Variablen `DATABASE_URL`, `WORKER_CONCURRENCY` (z. B. Anzahl vCPUs) und – falls genutzt – `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL` übernehmen.
4. Beim Web-Dienst `WORKER_MODE=off` setzen.

Mehrere Worker-Dienste können parallel laufen; die Aufträge werden über die Datenbank verteilt (`FOR UPDATE SKIP LOCKED`). `/api/health` zeigt die Zahl der aktiven Dienste.

### Backups

Die Datenbank liegt auf dem Volume `postgres-volume`. Unter Postgres → Volume → *Backups* lassen sich tägliche (6 Tage aufbewahrt) und wöchentliche Sicherungen (1 Monat) einschalten und Stände wiederherstellen. Die Zeitpläne müssen im Railway-Dashboard aktiviert werden.

### Neuigkeiten

Meldungen für `/neuigkeiten` und die Startseite schreiben Administratoren im Admin-Bereich unter *Neuigkeiten*: Titel, Kurztext, Text, Titelbild, Kategorie (Update, Neue Funktion, Community, Event, Wartung), Verfasser und Adresse, optional auf Englisch. *Veröffentlichen ab* plant eine Meldung; vorher ist sie nur für Admins sichtbar. *Hervorheben* zeigt sie als grosse Kachel oben und als breite Kachel im Raster.

- **Textformat:** Absätze durch Leerzeilen, `## Zwischenüberschrift`, `- Aufzählung`, `> Zitat`, `**fett**`, `[Linktext](https://…)`. HTML wird nicht ausgewertet; Links nur auf `http(s)` oder eigene Pfade.
- **Bilder:** Der Browser verkleinert auf 1600 px und lädt WebP hoch (höchstens 2,5 MB). Gespeichert werden sie in der Datenbank (`site_images`), der Typ wird am Inhalt geprüft (WebP, JPEG, PNG – kein SVG). Bilder ersetzter oder gelöschter Meldungen werden sofort entfernt, nie gespeicherte Uploads nach einem Tag.

Die erste Meldung „Football Legacy ist live!“ (Deutsch und Englisch, Titelbild `apps/web/public/news/launch.webp`) legt Migration 029 an; sie lässt sich wie jede andere Meldung im Admin-Bereich bearbeiten oder löschen.

### Neuigkeiten aus aller Welt (im Spiel)

Nach jedem „Weiter“ öffnet sich wie im Football Manager eine Übersicht der neuen Meldungen aus der Fussballwelt: Wechsel und Leihen der KI-Vereine (mit Ablöse), Interesse grösserer Vereine an Spielern, Wechselwünsche, Spielberichte und Liga-Meldungen – mit Spielergesicht, Wappen von abgebendem und aufnehmendem Verein, Position, Alter, Nation und Marktwert. Vor einem eigenen Spiel und über dem Saisonrückblick erscheint sie nicht; der Zeitungs-Knopf neben „Weiter“ öffnet sie jederzeit und zeigt die Zahl der ungelesenen Meldungen. Das automatische Öffnen lässt sich im Fenster abschalten (pro Gerät).

Grundlage sind die Medienartikel (`media`, strukturierte Angaben in `media.data`); `careers.media_seen_id` merkt sich, was gelesen wurde (`GET /api/careers/:id/world-news`, `POST …/world-news/seen`).

### Screenshots der Startseite

`DATABASE_URL=… node scripts/landing-shots.mjs` (Server muss laufen) spielt eine Karriere an und nimmt Livespiel, Büro, Taktik, Spielerprofil, Transfers, Vorstand, Tabelle, Online-Liga und Smartphone auf – je auf Deutsch und Englisch, als WebP in `apps/web/public/landing/`. Danach den Server neu starten, Next.js liest `public/` beim Start ein.

### Browser-Tests

Alle drei brauchen einen laufenden Server (`E2E_URL`, Standard `http://localhost:3000`) und laufen in der CI nach dem Build gegen die Testdatenbank:

- `pnpm e2e [Screenshot-Ordner]` (Smoke): registriert einen Account, startet eine Karriere, öffnet alle Hauptseiten, simuliert ein Spiel, prüft „Passwort vergessen“, die Rechtstexte und die Smartphone-Ansicht.
- `pnpm e2e:flows [Screenshot-Ordner]` (Abläufe): ablösefreier Transfer über die Oberfläche, Livespiel mit Halbzeitansprache bis zum Abpfiff, Einstellungen (Name, helles Design), Online-Liga mit CPU-Team und einem Spieltag, Admin-Bereich. Braucht `DATABASE_URL` (um die Test-E-Mail zu bestätigen) und einen Server mit `ADMIN_EMAILS=admin-e2e@example.com`.
- `pnpm e2e:i18n [Screenshot-Ordner] [--all]` (Englisch): öffnet die Hauptseiten und ein Livespiel mit Sprache Englisch und meldet sichtbare deutsche Reste (höchstens `MAX_GERMAN`=3 pro Seite) sowie Hydrations- und Konsolenfehler.
- `pnpm e2e:a11y [--report]` (Barrierefreiheit): prüft 18 Seiten im dunklen und 7 im hellen Design mit axe-core gegen WCAG 2.1 A/AA. Schwere oder kritische Verstösse lassen die CI scheitern; `--report` listet auch die leichteren.

### Lasttest

`LOAD_URL=http://localhost:3000 pnpm loadtest [Spieler=20] [Aktionen=30]` simuliert gleichzeitige Spieler (Registrierung, Karriere, Tage weiterspielen, Sofortergebnisse) und gibt p50/p95/max je Anfrageart aus. Gemessen lokal auf 4 Kernen mit `WORKER_CONCURRENCY=2`: 25 gleichzeitige Spieler ohne Fehler, Karriere anlegen p50 25 s, Spieltag p50 5,6 s, „Weiter“ ohne Spiel unter 100 ms. Mit `WORKER_CONCURRENCY=4` sinkt Karriere anlegen auf p50 14 s. Der Engpass ist die CPU der Hintergrundrechnung (Weltgenerierung, Spieltage); mehr Kerne oder ein zweiter Dienst mit `pnpm --filter @fl/game worker` skalieren das direkt. Gegen Railway nur mit wenigen Spielern testen (der Proxy setzt die IP, das Registrierungslimit greift).

### Langzeit-Balancing

`pnpm --filter @fl/game balance 10 GER 8 4242 --active --check` simuliert zehn Saisons ohne Eingriffe (eigene Datenbank `BALANCE_DATABASE_URL`) und prüft Grenzwerte: KI-Vereine im Minus, Kontostände, Altersstruktur, Torquote, Vereinslose, Stärke der Startvereine, Anteil der Stars (Stärke ≥ 80, höchstens 30 % über dem Start) und Rechenzeit pro Saison.

**Kalibrierung der Matchengine** (`pnpm sim:calibrate`): gleich starke Teams 2,7–2,8 Tore, rund 25 Schüsse, davon 9 aufs Tor, 9–10 Ecken, rund 11 Fouls und 3 Gelbe Karten pro Team bzw. Spiel, Heimsiege 45–50 %. Die Passquote hängt vom absoluten Niveau ab (Amateure rund 69 %, Spitzenteams rund 82 %, Favoriten deutlich genauer als Aussenseiter), alle übrigen Attribute wirken relativ zum Spielniveau, damit jede Liga spannend bleibt. Neben harten Fouls gibt es kleine Fouls, die nur das Spiel unterbrechen. Karten und Verletzungen orientieren sich an echten Ligen: rund 3 Gelbe und 0,1 Rote Karten pro Spiel (Gelb-Rot sperrt ein Spiel, glatt Rot meist zwei, die fünfte Gelbe ein Spiel), im Schnitt unter einem verletzten Spieler je Verein, meist kurze Ausfälle. Härte erhöht Fouls und Karten im realistischen Rahmen (8–14 Fouls je Team) und das Verletzungsrisiko des Gegners, nicht das der eigenen Spieler; verwarnte Spieler gehen vorsichtiger in Zweikämpfe. `pnpm sim:calibrate 400 --styles` vergleicht Karten und Verletzungen je Spielstil, das Langzeit-Balancing prüft Grenzwerte für Gelb, Rot und Verletzte. Der Workflow „Langzeit-Balancing“ führt das jeden Montag auf dem Standard-Branch aus und lässt sich unter *Actions* auch von Hand starten.

## Nächste Schritte

- Offene Entscheidungen aus dem Konzept: Monetarisierung, Magic-Link statt Passwort, Logo/Design-System, Online-Umfang (nur Ranglisten oder gemeinsame Ligen).
- Stufe 1.x: detailliertere Jugendakademie, Medien und Spielerinteraktionen, internationale Wettbewerbe.
- Technik: Fehlerüberwachung, weitere Sprachen.
