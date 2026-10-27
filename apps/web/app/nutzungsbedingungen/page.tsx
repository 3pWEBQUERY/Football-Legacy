import Link from "next/link";
import { LegalPage, OperatorCard } from "@/components/Legal";

export const metadata = { title: "Nutzungsbedingungen – Football Legacy" };
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return (
    <LegalPage title="Nutzungsbedingungen" updated="Oktober 2026">
      <p>Diese Bedingungen regeln die Nutzung von Football Legacy. Mit der Registrierung akzeptierst du sie. Bitte lies sie aufmerksam – sie sind bewusst kurz gehalten.</p>

      <h2>1. Anbieter</h2>
      <OperatorCard role="Anbieter" />

      <h2>2. Mindestalter</h2>
      <p>Football Legacy darf ab <b>16 Jahren</b> genutzt werden. Mit der Registrierung bestätigst du, dass du mindestens 16 Jahre alt bist. Stellt sich heraus, dass das nicht zutrifft, löschen wir das Konto.</p>

      <h2>3. Dein Konto</h2>
      <ul>
        <li>Dein Konto ist persönlich und nicht übertragbar. Halte dein Passwort geheim; für Handlungen über dein Konto bist du verantwortlich.</li>
        <li>Gib eine E-Mail-Adresse an, die dir gehört – sie wird für die Anmeldung, die Bestätigung und das Zurücksetzen des Passworts gebraucht.</li>
        <li>Du kannst dein Konto jederzeit unter <i>Karriere → Einstellungen → Account löschen</i> entfernen.</li>
      </ul>

      <h2>4. Das Spiel</h2>
      <ul>
        <li>Football Legacy ist kostenlos. Alle Vereine, Spieler, Trainer und Wettbewerbe sind frei erfunden.</li>
        <li>Wir entwickeln das Spiel laufend weiter. Funktionen können sich ändern, hinzukommen oder wegfallen. Einen Anspruch auf eine bestimmte Funktion oder ständige Verfügbarkeit gibt es nicht.</li>
        <li>Wir bemühen uns, Spielstände bei Updates zu erhalten. In Ausnahmefällen (z. B. grundlegende Umstellungen oder schwere Fehler) kann ein Spielstand zurückgesetzt werden müssen.</li>
        <li>Spielwährung, Punkte, Karten und andere Belohnungen im Spiel haben keinen Geldwert und können nicht ausgezahlt oder übertragen werden.</li>
      </ul>

      <h2>5. Verhaltensregeln</h2>
      <p>Für Anzeigenamen, Manager- und Vereinsnamen, Ligen und den Liga-Chat gilt:</p>
      <ul>
        <li>Keine Beleidigungen, Drohungen, Belästigung, Hetze oder Diskriminierung.</li>
        <li>Keine pornografischen, gewaltverherrlichenden oder sonst rechtswidrigen Inhalte.</li>
        <li>Keine Werbung, kein Spam und keine Links zu schädlichen Seiten.</li>
        <li>Keine persönlichen Daten anderer Personen und kein Auftreten unter fremdem Namen.</li>
      </ul>
      <p>Ausserdem verboten sind Eingriffe in das Spiel: automatisierte Zugriffe (Bots, Skripte), das gezielte Ausnutzen von Fehlern, Angriffe auf die Server sowie mehrere Konten, um Ranglisten oder Online-Ligen zu manipulieren. Gefundene Fehler meldest du bitte per E-Mail – dafür sind wir dankbar.</p>

      <h2>6. Meldungen und Sperren</h2>
      <p>Nachrichten im Liga-Chat kannst du melden, andere Mitglieder blockieren. Bei Verstössen gegen diese Bedingungen können wir Inhalte entfernen, Namen ändern, Konten vorübergehend sperren oder löschen – in schweren Fällen ohne vorherige Warnung. Wir entscheiden nach den Umständen und hören dich auf Wunsch an.</p>

      <h2>7. Deine Inhalte</h2>
      <p>Namen und Nachrichten, die du im Spiel eingibst, bleiben deine. Du erlaubst uns, sie im Spiel anzuzeigen (z. B. in Ranglisten, Online-Ligen und im Chat), solange dein Konto besteht. Du bist dafür verantwortlich, dass sie keine Rechte anderer verletzen.</p>

      <h2>8. Haftung</h2>
      <p>Football Legacy wird kostenlos und so, wie es ist, zur Verfügung gestellt. Wir haften nur für Schäden, die wir vorsätzlich oder grob fahrlässig verursachen; die Haftung für leichte Fahrlässigkeit ist ausgeschlossen, soweit das Gesetz es erlaubt. Für den Verlust von Spielständen haften wir nicht, wenn er auf leichter Fahrlässigkeit, technischen Störungen oder höherer Gewalt beruht.</p>

      <h2>9. Ende der Nutzung</h2>
      <p>Du kannst die Nutzung jederzeit beenden, indem du dein Konto löschst. Wir können das Spiel einstellen; das kündigen wir mindestens 30 Tage vorher auf der Startseite an.</p>

      <h2>10. Änderungen</h2>
      <p>Wir können diese Bedingungen anpassen, etwa wenn neue Funktionen dazukommen. Über eine neue Fassung informieren wir beim nächsten Besuch; sie gilt, sobald du ihr zustimmst. Stimmst du nicht zu, kannst du dein Konto löschen.</p>

      <h2>11. Anwendbares Recht</h2>
      <p>Es gilt Schweizer Recht. Gerichtsstand ist Bülach (Kanton Zürich). Wohnst du als Verbraucherin oder Verbraucher in einem anderen Land, bleiben die zwingenden Schutzvorschriften deines Wohnsitzlandes und dein dortiger Gerichtsstand unberührt.</p>

      <p className="faint small">Siehe auch: <Link href="/datenschutz">Datenschutzerklärung</Link> · <Link href="/impressum">Impressum</Link></p>
    </LegalPage>
  );
}
