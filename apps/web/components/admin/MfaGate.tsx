"use client";
import { useState, type ReactNode } from "react";
import { api, useApi } from "@/lib/client/api";
import { ErrorBox, Loading, useToast } from "@/components/ui";

interface Status { required: boolean; enabled: boolean; verified: boolean }

/** Zeigt den Admin-Bereich erst nach der Zwei-Faktor-Anmeldung (Einrichtung beim ersten Mal). */
export function MfaGate({ children }: { children: ReactNode }) {
  const { data, error, reload } = useApi<Status>("admin/2fa");
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  if (!data.required || data.verified) return <>{children}</>;
  return <MfaForm enabled={data.enabled} onDone={reload} />;
}

function MfaForm({ enabled, onDone }: { enabled: boolean; onDone: () => void }) {
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try { setSetup(await api(`admin/2fa/setup`, { body: {} })); } catch (e) { toast((e as Error).message, "error"); } finally { setBusy(false); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`admin/2fa/verify`, { body: { code } });
      toast(r.message, "success");
      onDone();
    } catch (err) {
      toast((err as Error).message, "error");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form className="row" style={{ gap: 8 }} onSubmit={verify}>
      <label htmlFor="mfa-code" className="sr-only">Sechsstelliger Code</label>
      <input id="mfa-code" className="input mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="123 456"
        value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
      <button className="btn btn-primary" disabled={busy || code.replace(/\s/g, "").length !== 6}>Bestätigen</button>
    </form>
  );

  return (
    <div className="card stack mfa-card">
      <h2>Zwei-Faktor-Anmeldung</h2>
      {enabled ? (
        <>
          <p className="dim">Gib den sechsstelligen Code aus deiner Authenticator-App ein. Die Bestätigung gilt 12 Stunden für dieses Gerät.</p>
          {form}
        </>
      ) : !setup ? (
        <>
          <p className="dim">Der Admin-Bereich ist zusätzlich geschützt. Richte einmalig eine Authenticator-App ein (z. B. Google Authenticator, 1Password, Microsoft Authenticator oder Bitwarden).</p>
          <div><button className="btn btn-primary" disabled={busy} onClick={start}>Einrichtung starten</button></div>
        </>
      ) : (
        <>
          <ol className="mfa-steps">
            <li>Scanne den QR-Code mit deiner Authenticator-App.</li>
            <li>Kein Scanner zur Hand? Gib den Schlüssel von Hand ein: <code translate="no" className="mfa-secret">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code></li>
            <li>Gib den angezeigten Code ein, um die Einrichtung abzuschliessen.</li>
          </ol>
          <div className="mfa-qr" role="img" aria-label="QR-Code für die Authenticator-App" dangerouslySetInnerHTML={{ __html: setup.qr }} />
          {form}
        </>
      )}
    </div>
  );
}
