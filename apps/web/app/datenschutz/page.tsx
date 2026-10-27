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
        <li><b>Account:</b> E-Mail-Adresse, Anzeigename und dein Passwort – das Passwort nur als nicht umkehrbarer Hash (scrypt). Zweck: Anmeldung und Speichern deiner Spielstände (Art. 6 Abs. 1 lit. b DSGVO).</li>
        <li><b>Spielstände:</b> Karrieren, Einstellungen und Spielfortschritt. Sie enthalten keine weiteren persönlichen Angaben.</li>
        <li><b>Ranglisten:</b> Dein Anzeigename und deine Saisonergebnisse sind für andere Spieler sichtbar. Wähle dafür einen Namen, der dich nicht identifiziert, wenn du das nicht möchtest.</li>
        <li><b>Online-Ligen:</b> In gemeinsamen Ligen sehen die Mitspieler deinen Anzeigenamen, deine Ergebnisse und deine Nachrichten im Liga-Chat.</li>
        <li><b>Push-Mitteilungen:</b> Nur wenn du sie in den Einstellungen einschaltest und dein Browser die Erlaubnis erhält. Wir speichern pro Gerät die vom Browser erzeugte Zustell-Adresse (Endpunkt) mit den zugehörigen Schlüsseln, eine Kennung deines Browsers (User-Agent, gekürzt), die gewählten Themen sowie Zeitpunkt der Anmeldung und der letzten Zustellung. Zweck: dich über Ereignisse in deinen Online-Ligen und über fertige Berechnungen zu informieren (Einwilligung, Art. 6 Abs. 1 lit. a DSGVO). Du kannst die Einwilligung jederzeit widerrufen, indem du die Mitteilungen in den Einstellungen oder im Browser ausschaltest.</li>
        <li><b>Rechenaufträge:</b> Aufwendige Berechnungen (z. B. ein Spieltag oder eine neue Karriere) laufen in einem Hintergrunddienst. Dafür wird ein Auftrag mit deiner Account- und Karriere-Kennung, den Eingaben und dem Ergebnis kurz gespeichert und nach einem Tag gelöscht.</li>
        <li><b>Passwort zurücksetzen:</b> Wenn du einen Link anforderst, speichern wir einen Hash des Links, den Zeitpunkt und deine IP-Adresse, um Missbrauch zu verhindern (Art. 6 Abs. 1 lit. f DSGVO). Diese Einträge werden nach 7 Tagen gelöscht.</li>
        <li><b>Server-Protokolle:</b> Der Hosting-Anbieter verarbeitet technisch notwendige Verbindungsdaten (z. B. IP-Adresse, Zeitpunkt, aufgerufene Adresse), um den Betrieb und die Sicherheit zu gewährleisten.</li>
      </ul>

      <h2>3. Cookies und lokaler Speicher</h2>
      <p>Wir setzen ein einziges, technisch notwendiges Cookie (<code>fl_session</code>), das dich 30 Tage angemeldet hält. Im lokalen Speicher deines Browsers merken wir uns Einstellungen dieses Geräts: helles oder dunkles Design, Stadionton und Lautstärke sowie die Spieler in deinem Spielervergleich. Ein Service Worker legt Programmdateien, Symbole und die Offline-Seite im Zwischenspeicher des Browsers ab, damit die App schneller lädt und ohne Verbindung einen Hinweis zeigt; persönliche Daten speichert er nicht. Für all das ist keine Einwilligung nötig; diese Daten verlassen dein Gerät nicht.</p>

      <h2>4. Empfänger und Auftragsverarbeiter</h2>
      <ul>
        <li><b>Railway</b> (Railway Corporation, USA) betreibt Server und Datenbank. Die Daten liegen in einem Rechenzentrum in der EU (Region Europe West).</li>
        <li><b>Resend</b> (Resend, Inc., USA) verschickt E-Mails zum Zurücksetzen des Passworts. Dafür werden deine E-Mail-Adresse und der Inhalt der Nachricht übermittelt.</li>
      </ul>
      <p>Push-Mitteilungen werden über den Push-Dienst deines Browsers zugestellt, z. B. Google (Chrome, Android), Mozilla (Firefox), Apple (Safari, iPhone) oder Microsoft (Edge). Den Dienst bestimmt dein Browser, nicht wir. Der Inhalt jeder Mitteilung (Titel, kurzer Text, Link ins Spiel) wird Ende-zu-Ende verschlüsselt übertragen und kann nur von deinem Gerät gelesen werden; der Push-Dienst sieht die Zustell-Adresse und den Zeitpunkt.</p>
      <p>Mit Railway und Resend bestehen Verträge zur Auftragsverarbeitung. Für Übermittlungen in die USA gelten die EU-Standardvertragsklauseln bzw. das EU-US Data Privacy Framework.</p>

      <h2>5. Speicherdauer</h2>
      <p>Account und Spielstände speichern wir, bis du deinen Account löschst. Das geht jederzeit unter <i>Karriere → Einstellungen → Account löschen</i>; dabei werden alle Karrieren und Sitzungen sofort entfernt. Abgelaufene Sitzungen und Links zum Zurücksetzen werden regelmässig gelöscht. Push-Abos löschen wir, sobald du die Mitteilungen ausschaltest, der Push-Dienst das Abo als ungültig meldet oder du deinen Account löschst. Rechenaufträge werden nach einem Tag gelöscht.</p>

      <h2>6. Deine Rechte</h2>
      <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Eine Kopie deiner Daten kannst du unter <i>Karriere → Einstellungen → Daten herunterladen</i> selbst abrufen. Für alle anderen Anliegen genügt eine E-Mail an die oben genannte Adresse.</p>
      <p>Du kannst dich ausserdem bei einer Datenschutz-Aufsichtsbehörde beschweren – in der Schweiz beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB), in der EU bei der Behörde deines Wohnsitzlandes.</p>

      <h2>7. Sicherheit</h2>
      <p>Die Verbindung ist durchgehend verschlüsselt (HTTPS). Passwörter, Sitzungen und Links zum Zurücksetzen speichern wir nur als Hash. Push-Mitteilungen sind nach dem Web-Push-Standard verschlüsselt und mit einem eigenen Serverschlüssel (VAPID) signiert.</p>

      <p className="faint small"><Link href="/impressum">Zum Impressum</Link></p>
    </LegalPage>
  );
}
