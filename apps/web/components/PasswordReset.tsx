"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { LegalLinks } from "./Legal";

function Shell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card card stack">
        <div className="card-head"><h3>{title}</h3><span className="faint small">Football Legacy</span></div>
        <div className="row" style={{ gap: 10 }}>
          <div className="brand-mark">FL</div>
          <div className="brand-name">Football Legacy<small>{sub}</small></div>
        </div>
        {children}
        <LegalLinks />
      </div>
    </div>
  );
}

/** Schritt 1: E-Mail-Adresse eingeben, Link wird verschickt. */
export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>("auth/forgot", { body: { email } });
      setDone(r.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title="Passwort vergessen" sub="Neues Passwort anfordern">
      {done ? (
        <div className="stack">
          <div className="card-soft small" role="status">{done}</div>
          <p className="dim small">Schau auch im Spam-Ordner nach. Der Link ist 60 Minuten gültig.</p>
          <Link href="/login" className="btn">Zurück zur Anmeldung</Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <p className="dim small" style={{ margin: 0 }}>Gib die E-Mail-Adresse deines Accounts ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst.</p>
          <div className="field">
            <label htmlFor="email">E-Mail</label>
            <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <div className="card-soft small" style={{ borderColor: "var(--neg)" }} role="alert">{error}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Einen Moment …" : "Link anfordern"}</button>
          <p className="dim small" style={{ textAlign: "center", margin: 0 }}><Link href="/login" style={{ color: "var(--accent)" }}>Zurück zur Anmeldung</Link></p>
        </form>
      )}
    </Shell>
  );
}

/** Schritt 2: über den Link aus der E-Mail ein neues Passwort setzen. */
export function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [valid, setValid] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ valid: boolean }>(`auth/reset?token=${encodeURIComponent(token)}`).then((r) => setValid(r.valid)).catch(() => setValid(false));
  }, [token]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== repeat) { setError("Die beiden Passwörter stimmen nicht überein."); return; }
    setBusy(true);
    setError(null);
    try {
      await api("auth/reset", { body: { token, password } });
      router.push("/careers");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Shell title="Neues Passwort" sub="Passwort zurücksetzen">
      {valid === null && <p className="dim small">Link wird geprüft …</p>}
      {valid === false && (
        <div className="stack">
          <div className="card-soft small" style={{ borderColor: "var(--neg)" }} role="alert">Dieser Link ist ungültig, abgelaufen oder wurde schon verwendet.</div>
          <Link href="/forgot" className="btn btn-primary">Neuen Link anfordern</Link>
        </div>
      )}
      {valid && (
        <form className="stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor="pw">Neues Passwort</label>
            <input id="pw" className="input" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            <small className="faint">Mindestens 8 Zeichen. Danach wirst du auf allen Geräten abgemeldet.</small>
          </div>
          <div className="field">
            <label htmlFor="pw2">Passwort wiederholen</label>
            <input id="pw2" className="input" type="password" autoComplete="new-password" required minLength={8} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </div>
          {error && <div className="card-soft small" style={{ borderColor: "var(--neg)" }} role="alert">{error}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Einen Moment …" : "Passwort speichern"}</button>
        </form>
      )}
    </Shell>
  );
}
