import Link from "next/link";
import { LegalPage, OperatorCard } from "@/components/Legal";

export const metadata = { title: "Datenschutz – Football Legacy" };
export const dynamic = "force-dynamic";

export default function DatenschutzPage() {
  return (
    <LegalPage title="Datenschutzerklärung" updated="Oktober 2026">
      <p>Wir erheben nur die Daten, die für das Spiel nötig sind. Es gibt keine Werbung, kein Tracking und keine Analyse-Dienste. Diese Erklärung gilt nach der Datenschutz-Grundverordnung (DSGVO) und dem Schweizer Datenschutzgesetz (DSG).</p>

      <h2>1. Verantwortlicher</h2>
      <OperatorCard role="Verantwortlich für die Datenbearbeitung" />

      <h2>2. Welche Daten wir verarbeiten</h2>
      <ul>
        <li><b>Account:</b> E-Mail-Adresse, Anzeigename und dein Passwort – das Passwort nur als nicht umkehrbarer Hash (scrypt). Dazu Zeitpunkt und Fassung deiner Zustimmung zu den <Link href="/nutzungsbedingungen">Nutzungsbedingungen</Link>, deine Bestätigung, mindestens 16 Jahre alt zu sein, und ob deine E-Mail-Adresse bestätigt ist. Zweck: Anmeldung und Speichern deiner Spielstände (Art. 6 Abs. 1 lit. b DSGVO).</li>
        <li><b>E-Mail-Bestätigung:</b> Nach der Registrierung schicken wir einen Bestätigungslink; gespeichert wird nur ein Hash des Links (7 Tage gültig).</li>
        <li><b>Spielstände:</b> Karrieren, Einstellungen und Spielfortschritt. Sie enthalten keine weiteren persönlichen Angaben.</li>
        <li><b>Ranglisten:</b> Dein Anzeigename und deine Saisonergebnisse sind für andere Spieler sichtbar. Wähle dafür einen Namen, der dich nicht identifiziert, wenn du das nicht möchtest.</li>
        <li><b>Online-Ligen:</b> In gemeinsamen Ligen sehen die Mitspieler deinen Anzeigenamen, deine Ergebnisse und deine Nachrichten im Liga-Chat. Meldest du eine Nachricht, speichern wir die Meldung mit deinem Konto und einem optionalen Grund; blockierst du jemanden, speichern wir diese Einstellung. Gemeldete oder gelöschte Nachrichten werden ausgeblendet und mit der Liga gelöscht.</li>
        <li><b>Push-Mitteilungen:</b> Nur wenn du sie in den Einstellungen einschaltest und dein Browser die Erlaubnis erhält. Wir speichern pro Gerät die vom Browser erzeugte Zustell-Adresse (Endpunkt) mit den zugehörigen Schlüsseln, eine Kennung deines Browsers (User-Agent, gekürzt), die gewählten Themen sowie Zeitpunkt der Anmeldung und der letzten Zustellung. Zweck: dich über Ereignisse in deinen Online-Ligen und über fertige Berechnungen zu informieren (Einwilligung, Art. 6 Abs. 1 lit. a DSGVO). Du kannst die Einwilligung jederzeit widerrufen, indem du die Mitteilungen in den Einstellungen oder im Browser ausschaltest.</li>
        <li><b>Rechenaufträge:</b> Aufwendige Berechnungen (z. B. ein Spieltag oder eine neue Karriere) laufen in einem Hintergrunddienst. Dafür wird ein Auftrag mit deiner Account- und Karriere-Kennung, den Eingaben und dem Ergebnis kurz gespeichert und nach einem Tag gelöscht.</li>
        <li><b>Passwort zurücksetzen:</b> Wenn du einen Link anforderst, speichern wir einen Hash des Links, den Zeitpunkt und deine IP-Adresse, um Missbrauch zu verhindern (Art. 6 Abs. 1 lit. f DSGVO). Diese Einträge werden nach 7 Tagen gelöscht.</li>
        <li><b>Schutz vor Missbrauch:</b> Bei fehlgeschlagenen Anmeldungen und Registrierungen speichern wir kurzzeitig die E-Mail-Adresse bzw. IP-Adresse und den Zeitpunkt, um das Erraten von Passwörtern und Massenregistrierungen zu verhindern (Art. 6 Abs. 1 lit. f DSGVO). Diese Einträge werden nach einem Tag gelöscht.</li>
        <li><b>Fehlerprotokoll:</b> Tritt ein unerwarteter Fehler auf, speichern wir die Fehlermeldung, die betroffene Seite, die Browserkennung und – falls du angemeldet bist – deine Konto-Kennung, um den Fehler beheben zu können (Art. 6 Abs. 1 lit. f DSGVO). Einträge werden nach 30 Tagen gelöscht.</li>
        <li><b>Moderation:</b> Verstösst ein Konto gegen die <Link href="/nutzungsbedingungen">Nutzungsbedingungen</Link>, speichern wir eine Sperre mit Dauer und Grund sowie ein Protokoll der Moderationsschritte (wer, was, wann, Grund bzw. betroffene Nachricht), um Entscheidungen nachvollziehbar zu machen und Einsprüche prüfen zu können (Art. 6 Abs. 1 lit. f DSGVO). Über eine Sperre informieren wir per E-Mail. Die Einträge werden mit dem Konto gelöscht; es bleibt nur ein Vermerk ohne persönliche Angaben, dass ein Konto gelöscht wurde.</li>
        <li><b>KI-Funktionen (freiwillig):</b> Nur wenn du sie in den Einstellungen einschaltest (Einwilligung, Art. 6 Abs. 1 lit. a DSGVO). Für eigene Antworten in der Pressekonferenz, Spielberichte und den Co-Trainer-Chat übermitteln wir Spieldaten deiner Karriere (z. B. Verein, Tabelle, Kader, Ergebnisse) und die Texte, die du dafür eingibst, an Anthropic, um die Antworten zu erzeugen. E-Mail-Adresse, Passwort und Anzeigename werden nicht übermittelt. Wir speichern den Verlauf des Co-Trainer-Chats (bis du ihn löschst oder die Karriere entfernst) sowie pro Anfrage Zeitpunkt, Funktion und Textlänge in Tokens zur Kostenkontrolle (30 Tage). Gib in den Texten keine persönlichen Angaben ein. Du kannst die Einwilligung jederzeit in den Einstellungen widerrufen.</li>
        <li><b>Server-Protokolle:</b> Der Hosting-Anbieter verarbeitet technisch notwendige Verbindungsdaten (z. B. IP-Adresse, Zeitpunkt, aufgerufene Adresse), um den Betrieb und die Sicherheit zu gewährleisten.</li>
      </ul>

      <h2>3. Cookies und lokaler Speicher</h2>
      <p>Wir setzen ein einziges, technisch notwendiges Cookie (<code>fl_session</code>), das dich 30 Tage angemeldet hält. Im lokalen Speicher deines Browsers merken wir uns Einstellungen dieses Geräts: helles oder dunkles Design, Stadionton und Lautstärke sowie die Spieler in deinem Spielervergleich. Ein Service Worker legt Programmdateien, Symbole und die Offline-Seite im Zwischenspeicher des Browsers ab, damit die App schneller lädt und ohne Verbindung einen Hinweis zeigt; persönliche Daten speichert er nicht. Für all das ist keine Einwilligung nötig; diese Daten verlassen dein Gerät nicht.</p>

      <h2>4. Empfänger und Auftragsverarbeiter</h2>
      <ul>
        <li><b>Railway</b> (Railway Corporation, USA) betreibt Server und Datenbank. Die Daten liegen in einem Rechenzentrum in der EU (Region Europe West).</li>
        <li><b>Resend</b> (Resend, Inc., USA) verschickt E-Mails zum Zurücksetzen des Passworts. Dafür werden deine E-Mail-Adresse und der Inhalt der Nachricht übermittelt.</li>
      </ul>
      {process.env.ANTHROPIC_API_KEY && <ul><li><b>Anthropic</b> (Anthropic, PBC, USA) erzeugt die Texte der KI-Funktionen mit dem Modell Claude, nur wenn du diese eingeschaltet hast. Übermittelt werden Spieldaten und deine eingegebenen Texte; Anthropic verwendet Daten aus der API nach eigenen Angaben nicht zum Training seiner Modelle.</li></ul>}
      {process.env.SENTRY_DSN && <ul><li><b>Sentry</b> (Functional Software, Inc., USA) erhält Fehlerberichte (Fehlermeldung, Seite, Browserkennung, Konto-Kennung) zur Fehleranalyse.</li></ul>}
      <p>Push-Mitteilungen werden über den Push-Dienst deines Browsers zugestellt, z. B. Google (Chrome, Android), Mozilla (Firefox), Apple (Safari, iPhone) oder Microsoft (Edge). Den Dienst bestimmt dein Browser, nicht wir. Der Inhalt jeder Mitteilung (Titel, kurzer Text, Link ins Spiel) wird Ende-zu-Ende verschlüsselt übertragen und kann nur von deinem Gerät gelesen werden; der Push-Dienst sieht die Zustell-Adresse und den Zeitpunkt.</p>
      <p>Mit Railway und Resend bestehen Verträge zur Auftragsverarbeitung. Für Übermittlungen in die USA gelten die EU-Standardvertragsklauseln bzw. das EU-US Data Privacy Framework.</p>

      <h2>5. Mindestalter</h2>
      <p>Football Legacy richtet sich an Personen ab 16 Jahren. Bei der Registrierung bestätigst du dein Alter. Erfahren wir, dass ein Konto einer jüngeren Person gehört, löschen wir es mit allen Daten.</p>

      <h2>6. Speicherdauer</h2>
      <p>Account und Spielstände speichern wir, bis du deinen Account löschst. Das geht jederzeit unter <i>Karriere → Einstellungen → Account löschen</i>; dabei werden alle Karrieren und Sitzungen sofort entfernt. Hast du dich 12 Monate lang nicht angemeldet, löschen wir den Account mit allen Spielständen; einen Monat vorher erinnern wir dich per E-Mail, und eine Anmeldung genügt, um ihn zu behalten. Abgelaufene Sitzungen und Links zum Zurücksetzen werden regelmässig gelöscht. Push-Abos löschen wir, sobald du die Mitteilungen ausschaltest, der Push-Dienst das Abo als ungültig meldet oder du deinen Account löschst. Rechenaufträge und Einträge zum Schutz vor Missbrauch werden nach einem Tag, das Fehlerprotokoll nach 30 Tagen gelöscht.</p>

      <h2>7. Deine Rechte</h2>
      <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Eine Kopie deiner Daten kannst du unter <i>Karriere → Einstellungen → Daten herunterladen</i> selbst abrufen. Für alle anderen Anliegen genügt eine E-Mail an die oben genannte Adresse.</p>
      <p>Du kannst dich ausserdem bei einer Datenschutz-Aufsichtsbehörde beschweren – in der Schweiz beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB), in der EU bei der Behörde deines Wohnsitzlandes.</p>

      <h2>8. Sicherheit</h2>
      <p>Die Verbindung ist durchgehend verschlüsselt (HTTPS). Passwörter, Sitzungen, Links zum Zurücksetzen und Bestätigungslinks speichern wir nur als Hash. Anmeldeversuche sind begrenzt, um das Erraten von Passwörtern zu verhindern. Push-Mitteilungen sind nach dem Web-Push-Standard verschlüsselt und mit einem eigenen Serverschlüssel (VAPID) signiert.</p>

      <p className="faint small"><Link href="/impressum">Zum Impressum</Link></p>
    </LegalPage>
  );
}
