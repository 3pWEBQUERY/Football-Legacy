"use client";
import { useEffect } from "react";
import { reportClientError } from "@/lib/client/report";

/** Letzte Rettung, wenn selbst das Grundgerüst der Seite abstürzt. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError(error), [error]);
  return (
    <html lang="de">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#11151c", color: "#e8ecf2", fontFamily: "system-ui, sans-serif", padding: 16 }}>
        <div style={{ maxWidth: 440, textAlign: "center", background: "#181d26", border: "1px solid #262d39", borderRadius: 6, padding: "28px 24px" }}>
          <h1 style={{ fontSize: 22, textTransform: "uppercase", letterSpacing: ".02em" }}>Da ist etwas schiefgelaufen</h1>
          <p style={{ color: "#a3adbd", lineHeight: 1.5 }}>Football Legacy konnte nicht geladen werden. Der Fehler wurde gemeldet; dein Spielstand ist gespeichert.</p>
          <button onClick={() => reset()} style={{ font: "inherit", fontWeight: 700, background: "#3d8bfd", color: "#fff", border: 0, borderRadius: 4, padding: "10px 18px", cursor: "pointer" }}>Erneut versuchen</button>
        </div>
      </body>
    </html>
  );
}
