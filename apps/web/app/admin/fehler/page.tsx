"use client";
import Link from "next/link";
import { useState } from "react";
import { AccountTop } from "@/components/AccountTop";
import { useApi } from "@/lib/client/api";
import { MfaGate } from "@/components/admin/MfaGate";

interface Group { fingerprint: string; source: string; message: string; path: string | null; count: number; first_at: string; last_at: string; users: number; stack: string | null }

const SOURCE: Record<string, string> = { server: "Server", worker: "Hintergrunddienst", client: "Browser" };
const when = (iso: string) => new Date(iso).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Fehlerprotokoll der letzten 7 Tage (nur Administratoren). */
export default function ErrorsPage() {
  return (
    <>
      <AccountTop />
      <main className="content"><MfaGate><ErrorList /></MfaGate></main>
    </>
  );
}

function ErrorList() {
  const data = useApi<{ groups: Group[]; totals: { day: number; week: number }; sentry: boolean }>("admin/errors");
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
        <div className="page-head">
          <div><h1>Fehlerprotokoll</h1><p>Unerwartete Fehler der letzten 7 Tage, gruppiert. {data.data ? `${data.data.totals.day} heute · ${data.data.totals.week} in 7 Tagen${data.data.sentry ? " · wird zusätzlich an Sentry gemeldet" : ""}` : ""}</p></div>
          <button className="btn" onClick={() => data.reload()}>Aktualisieren</button>
        </div>
        {data.error && <div className="card error-box" role="alert">{data.error}</div>}
        {data.data && !data.data.groups.length && <div className="card"><p className="dim" style={{ margin: 0 }}>Keine Fehler in den letzten 7 Tagen. 🎉</p></div>}
        {!!data.data?.groups.length && (
          <div className="card card-flush">
            <table className="table admin-errors">
              <thead><tr><th>Fehler</th><th>Quelle</th><th className="r">Anzahl</th><th className="r">Nutzer</th><th>Zuletzt</th></tr></thead>
              <tbody>
                {data.data.groups.map((g) => (
                  <tr key={g.fingerprint} className="clickable" onClick={() => setOpen(open === g.fingerprint ? null : g.fingerprint)}>
                    <td style={{ maxWidth: 560 }}>
                      <b className="small">{g.message}</b>
                      {g.path && <div className="faint small">{g.path}</div>}
                      {open === g.fingerprint && g.stack && <pre>{g.stack}</pre>}
                    </td>
                    <td><span className="badge">{SOURCE[g.source] ?? g.source}</span></td>
                    <td className="r num">{g.count}</td>
                    <td className="r num">{g.users}</td>
                    <td className="small nowrap">{when(g.last_at)}<div className="faint">seit {when(g.first_at)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="faint small">Zugang über die Umgebungsvariable <code>ADMIN_EMAILS</code>. <Link href="/careers">Zurück</Link></p>
    </>
  );
}
