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
| Tageskalender | Die Zeit läuft Tag für Tag: Saisonstart Anfang Juli, zwei Testspiele in der Vorbereitung, Ligaspiele samstags, Pokal mittwochs, Winterpause bei langen Ligen. Kondition erholt sich täglich (Regenerationstage stärker), Trainingsereignisse, Gegneranalyse zwei Tage vor dem Spiel, Scoutberichte mit Laufzeit, Monatsberichte der Finanzen, Deadline Day. Monatskalender im Büro |
| Kontinentalpokal | Die besten Vereine des eigenen Kontinentalverbands (32 Teams, bis zu vier pro Topliga, Qualifikation über die Abschlusstabelle, in der ersten Saison über den Ruf). Gruppenphase mit acht Vierergruppen am Dienstag, K.-o.-Runden in einem Spiel mit Elfmeterschiessen, Antritts-, Sieg- und Rundenprämien, eigene Seite mit Gruppentabellen und Turnierbaum |
| Spielergespräche | Loben, Kritisieren, Zuspruch, Einsatzzeit versprechen. Wirkung hängt von Form, Moral und Nervenstärke ab; gebrochene Versprechen kosten viel Moral |
| Transferfenster | Nach Datum: Sommer bis 31. August, Winter rund um die Winterpause, mit Hinweisen zur Öffnung, eine Woche vorher und am Deadline Day |
| Navigation | Horizontales Hauptmenü mit Untermenüs, Datum und Weiter-Button in der Kopfleiste |

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
```

- `packages/sim/test` prüft Determinismus, Halbzeit-Speicherung, Spielplan, Tabelle und die Statistik über hunderte Partien (rund 2,7 Tore pro Spiel, Heimvorteil, Favorit gewinnt meistens, aber nicht immer).
- `packages/game/test` spielt gegen eine echte PostgreSQL-Datenbank eine komplette Saison inklusive Saisonwechsel (`TEST_DATABASE_URL`, Standard `postgres://fl:fl@localhost:5432/football_legacy_test` – die Testdatenbank wird dabei geleert).

Kennzahlen der Engine (gleich starke Teams): ~2,7 Tore, ~23 Schüsse, ~2,7 Gelbe Karten, Heimsiege 45 % / Remis 25 % / Auswärtssiege 30 %. Eine Partie dauert ~9 ms, eine Spielwoche mit vier detaillierten englischen Ligen ~0,8 s.

## Deployment auf Railway

1. Neues Projekt mit einem PostgreSQL-Service anlegen.
2. Dieses Repository als Service hinzufügen – gebaut wird über das `Dockerfile` (siehe `railway.json`, Healthcheck `/api/health`).
3. Im Web-Service die Variablen `DATABASE_URL=${{Postgres.DATABASE_URL}}` und `PORT=3000` setzen und eine Domain auf Port 3000 generieren (ohne `PORT` startet Railway den Server auf 8080 – dann muss die Domain auf 8080 zeigen).

Live-Instanz: https://web-production-4d4918.up.railway.app (Railway-Projekt „Football Legacy“, Region europe-west4).

Beim ersten Start legt der Server das Schema selbst an. Redis, ein separater Simulations-Worker und ein Mail-Dienst (z. B. Resend für Magic-Links) sind für spätere Ausbaustufen vorgesehen und für Version 1.0 nicht nötig.

## Nächste Schritte

- Offene Entscheidungen aus dem Konzept: Monetarisierung, Magic-Link statt Passwort, Logo/Design-System, Online-Umfang (nur Ranglisten oder gemeinsame Ligen).
- Stufe 1.x: detailliertere Jugendakademie, Medien und Spielerinteraktionen, internationale Wettbewerbe.
- Technik: Simulations-Worker mit Warteschlange (Redis), E-Mail-Versand für Passwort-Reset, Datenschutzerklärung vor dem Launch.
