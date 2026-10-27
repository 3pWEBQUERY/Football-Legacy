import Link from "next/link";
import { LegalPage, Missing, operator } from "@/components/Legal";

export const metadata = { title: "Datenschutz – Football Legacy" };
export const dynamic = "force-dynamic";

export default function DatenschutzPage() {
  const o = operator();
  return (
    <LegalPage title="Datenschutzerklärung" updated="Oktober 2026">
      <p>Wir erheben nur die Daten, die für das Spiel nötig sind. Es gibt keine Werbung, kein Tracking und keine Analyse-Dienste. Diese Erklärung gilt nach der Datenschutz-Grundverordnung (DSGVO) und dem Schweizer Datenschutzgesetz (DSG).</p>

      <h2>1. Verantwortlicher</h2>
      <p>
        {o.name ?? <Missing what="Name (LEGAL_NAME)" />}<br />
        {o.address.length ? o.address.map((l, i) => <span key={i}>{l}<br /></span>) : <><Missing what="Anschrift (LEGAL_ADDRESS)" /><br /></>}
        E-Mail: {o.email ? <a href={`mailto:${o.email}`}>{o.email}</a> : <Missing what="E-Mail (LEGAL_EMAIL)" />}
      </p>

      <h2>2. Welche Daten wir verarbeiten</h2>
      <ul>
        <li><b>Account:</b> E-Mail-Adresse, Anzeigename und dein Passwort – das Passwort nur als nicht umkehrbarer Hash (scrypt). Zweck: Anmeldung und Speichern deiner Spielstände (Art. 6 Abs. 1 lit. b DSGVO).</li>
        <li><b>Spielstände:</b> Karrieren, Einstellungen und Spielfortschritt. Sie enthalten keine weiteren persönlichen Angaben.</li>
        <li><b>Ranglisten:</b> Dein Anzeigename und deine Saisonergebnisse sind für andere Spieler sichtbar. Wähle dafür einen Namen, der dich nicht identifiziert, wenn du das nicht möchtest.</li>
        <li><b>Online-Ligen:</b> In gemeinsamen Ligen sehen die Mitspieler deinen Anzeigenamen, deine Ergebnisse und deine Nachrichten im Liga-Chat.</li>
        <li><b>Passwort zurücksetzen:</b> Wenn du einen Link anforderst, speichern wir einen Hash des Links, den Zeitpunkt und deine IP-Adresse, um Missbrauch zu verhindern (Art. 6 Abs. 1 lit. f DSGVO). Diese Einträge werden nach 7 Tagen gelöscht.</li>
        <li><b>Server-Protokolle:</b> Der Hosting-Anbieter verarbeitet technisch notwendige Verbindungsdaten (z. B. IP-Adresse, Zeitpunkt, aufgerufene Adresse), um den Betrieb und die Sicherheit zu gewährleisten.</li>
      </ul>

      <h2>3. Cookies und lokaler Speicher</h2>
      <p>Wir setzen ein einziges, technisch notwendiges Cookie (<code>fl_session</code>), das dich 30 Tage angemeldet hält. Im lokalen Speicher deines Browsers merken wir uns Anzeige-Einstellungen wie das helle oder dunkle Design. Für beides ist keine Einwilligung nötig; es werden keine Daten an Dritte weitergegeben.</p>

      <h2>4. Empfänger und Auftragsverarbeiter</h2>
      <ul>
        <li><b>Railway</b> (Railway Corporation, USA) betreibt Server und Datenbank. Die Daten liegen in einem Rechenzentrum in der EU (Region Europe West).</li>
        <li><b>Resend</b> (Resend, Inc., USA) verschickt E-Mails zum Zurücksetzen des Passworts. Dafür werden deine E-Mail-Adresse und der Inhalt der Nachricht übermittelt.</li>
      </ul>
      <p>Mit beiden Anbietern bestehen Verträge zur Auftragsverarbeitung. Für Übermittlungen in die USA gelten die EU-Standardvertragsklauseln bzw. das EU-US Data Privacy Framework.</p>

      <h2>5. Speicherdauer</h2>
      <p>Account und Spielstände speichern wir, bis du deinen Account löschst. Das geht jederzeit unter <i>Karriere → Einstellungen → Account löschen</i>; dabei werden alle Karrieren und Sitzungen sofort entfernt. Abgelaufene Sitzungen und Links zum Zurücksetzen werden regelmässig gelöscht.</p>

      <h2>6. Deine Rechte</h2>
      <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Eine Kopie deiner Daten kannst du unter <i>Karriere → Einstellungen → Daten herunterladen</i> selbst abrufen. Für alle anderen Anliegen genügt eine E-Mail an die oben genannte Adresse.</p>
      <p>Du kannst dich ausserdem bei einer Datenschutz-Aufsichtsbehörde beschweren – in der Schweiz beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB), in der EU bei der Behörde deines Wohnsitzlandes.</p>

      <h2>7. Sicherheit</h2>
      <p>Die Verbindung ist durchgehend verschlüsselt (HTTPS). Passwörter, Sitzungen und Links zum Zurücksetzen speichern wir nur als Hash.</p>

      <p className="faint small"><Link href="/impressum">Zum Impressum</Link></p>
    </LegalPage>
  );
}
