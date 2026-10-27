import Link from "next/link";

export const metadata = { title: "Seite nicht gefunden – Football Legacy" };

export default function NotFound() {
  return (
    <div className="status-page">
      <div className="card status-card">
        <div className="status-code">404</div>
        <h1>Seite nicht gefunden</h1>
        <p className="dim">Diese Adresse gibt es nicht – vielleicht ein Tippfehler oder ein veralteter Link. Dein Spielstand ist davon nicht betroffen.</p>
        <div className="row-wrap" style={{ justifyContent: "center" }}>
          <Link className="btn btn-primary" href="/careers">Zu deinen Spielständen</Link>
          <Link className="btn" href="/">Zur Startseite</Link>
        </div>
      </div>
    </div>
  );
}
