"use client";
import Link from "next/link";
import { useState } from "react";
import { api, useApi } from "@/lib/client/api";

/**
 * Holt die Zustimmung zu den Nutzungsbedingungen und die Altersbestätigung
 * nach (bestehende Konten oder neue Fassung der Bedingungen).
 */
export function TermsGate() {
  const me = useApi<{ account: { termsAccepted?: boolean } | null }>("auth/me");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (done || !me.data?.account || me.data.account.termsAccepted) return null;
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("account/terms", { body: { acceptTerms: consent, ageConfirmed: consent } });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="terms-gate" role="dialog" aria-modal="true" aria-labelledby="terms-gate-title">
      <div className="card stack">
        <h3 id="terms-gate-title" style={{ margin: 0 }}>Neue Nutzungsbedingungen</h3>
        <p className="dim small" style={{ margin: 0 }}>Football Legacy hat Nutzungsbedingungen mit Verhaltensregeln für Ranglisten, Online-Ligen und den Liga-Chat. Bitte lies sie und bestätige, dass du mindestens 16 Jahre alt bist.</p>
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Ich bin mindestens 16 Jahre alt und akzeptiere die <Link href="/nutzungsbedingungen" target="_blank">Nutzungsbedingungen</Link>.</span>
        </label>
        {error && <div className="card-soft small neg-txt" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-primary" disabled={!consent || busy} onClick={accept}>{busy ? "Einen Moment …" : "Zustimmen und weiterspielen"}</button>
        </div>
      </div>
    </div>
  );
}
