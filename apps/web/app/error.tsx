"use client";
import Link from "next/link";
import { useEffect } from "react";
import { reportClientError } from "@/lib/client/report";

/** Fehlerseite für unerwartete Fehler beim Anzeigen einer Seite. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError(error), [error]);
  return (
    <div className="status-page">
      <div className="card status-card">
        <div className="status-code">Ups</div>
        <h1>Da ist etwas schiefgelaufen</h1>
        <p className="dim">Beim Anzeigen dieser Seite ist ein Fehler aufgetreten. Wir haben ihn automatisch gemeldet. Dein Spielstand ist gespeichert – versuche es einfach noch einmal.</p>
        <div className="row-wrap" style={{ justifyContent: "center" }}>
          <button className="btn btn-primary" onClick={() => reset()}>Erneut versuchen</button>
          <Link className="btn" href="/careers">Zu deinen Spielständen</Link>
        </div>
        {error.digest && <p className="faint small" style={{ marginBottom: 0 }}>Fehlercode: {error.digest}</p>}
      </div>
    </div>
  );
}
