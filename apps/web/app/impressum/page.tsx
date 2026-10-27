import { LegalPage, Missing, operator } from "@/components/Legal";

export const metadata = { title: "Impressum – Football Legacy" };
export const dynamic = "force-dynamic";

export default function ImpressumPage() {
  const o = operator();
  return (
    <LegalPage title="Impressum" updated="Oktober 2026">
      <h2>Anbieter</h2>
      <p>
        {o.name ?? <Missing what="Name des Betreibers (LEGAL_NAME)" />}<br />
        {o.address.length ? o.address.map((l, i) => <span key={i}>{l}<br /></span>) : <><Missing what="Anschrift (LEGAL_ADDRESS)" /><br /></>}
        E-Mail: {o.email ? <a href={`mailto:${o.email}`}>{o.email}</a> : <Missing what="Kontakt-E-Mail (LEGAL_EMAIL)" />}
      </p>
      <h2>Verantwortlich für den Inhalt</h2>
      <p>{o.name ?? <Missing what="Name des Betreibers (LEGAL_NAME)" />}, Anschrift wie oben.</p>
      <h2>Über das Spiel</h2>
      <p>Football Legacy ist ein kostenloses Browserspiel. Alle Vereine, Spieler, Trainer und Wettbewerbe sind frei erfunden; Ähnlichkeiten mit realen Personen oder Vereinen sind zufällig. Es besteht keine Verbindung zu Fussballverbänden, Ligen oder anderen Spielen.</p>
      <h2>Haftung für Links</h2>
      <p>Für Inhalte externer Seiten, auf die wir verweisen, sind ausschliesslich deren Betreiber verantwortlich. Zum Zeitpunkt der Verlinkung waren keine Rechtsverstösse erkennbar; bei Bekanntwerden entfernen wir solche Links umgehend.</p>
      <h2>Urheberrecht</h2>
      <p>Die Inhalte und Grafiken dieses Spiels sind urheberrechtlich geschützt. Eine Verwendung ausserhalb des Spiels bedarf der Zustimmung des Betreibers.</p>
    </LegalPage>
  );
}
