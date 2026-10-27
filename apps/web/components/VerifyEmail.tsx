"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { Shell } from "./PasswordReset";

/** Bestätigungslink aus der Willkommens-Mail. */
export function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    api<{ email: string }>("auth/verify", { body: { token } })
      .then((r) => setState({ ok: true, text: `Danke! ${r.email} ist bestätigt.` }))
      .catch((e) => setState({ ok: false, text: (e as Error).message }));
  }, [token]);
  return (
    <Shell title="E-Mail bestätigen" sub="Adresse prüfen">
      {!state ? <p className="dim">Einen Moment …</p> : (
        <div className={`card-soft small ${state.ok ? "" : "neg-txt"}`} role={state.ok ? "status" : "alert"}>{state.text}</div>
      )}
      <Link className="btn btn-primary" href="/careers">Zu deinen Spielständen</Link>
    </Shell>
  );
}

/** Status und erneutes Senden in den Einstellungen. */
export function VerifyStatus({ verified, required }: { verified: boolean; required: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (verified) return <span className="badge badge-accent">E-Mail bestätigt</span>;
  if (!required) return <span className="faint small">E-Mail noch nicht bestätigt.</span>;
  return (
    <div className="stack-sm">
      <span className="small" style={{ color: "var(--warn)" }}>Noch nicht bestätigt – ohne Bestätigung sind Liga-Chat und öffentliche Online-Ligen gesperrt.</span>
      <div><button type="button" className="btn btn-sm" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ sent: boolean; alreadyVerified: boolean }>("account/verify/resend", { body: {} });
          setMsg(r.alreadyVerified ? "Die Adresse ist bereits bestätigt." : r.sent ? "Link verschickt – schau in dein Postfach (auch Spam)." : "Der E-Mail-Versand ist noch nicht eingerichtet.");
        } catch (e) {
          setMsg((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}>Bestätigungslink senden</button></div>
      {msg && <span className="faint small" role="status">{msg}</span>}
    </div>
  );
}
