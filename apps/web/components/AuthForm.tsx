"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { LegalLinks } from "./Legal";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`auth/${mode}`, { body: { email, password, displayName: name } });
      const next = params.get("next");
      router.push(next && next.startsWith("/") ? next : mode === "register" ? "/careers/new" : "/careers");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
    <div className="auth-card card stack">
      <div className="card-head"><h3>{mode === "login" ? "Anmelden" : "Account erstellen"}</h3><span className="faint small">Football Legacy</span></div>
      <div className="row" style={{ gap: 10 }}>
        <div className="brand-mark">FL</div>
        <div className="brand-name">Football Legacy<small>{mode === "login" ? "Spielstand laden" : "Neuer Manager"}</small></div>
      </div>
      <form className="stack" onSubmit={submit}>
        {mode === "register" && (
          <div className="field">
            <label htmlFor="name">Anzeigename (für Ranglisten)</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="z. B. Alex" />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">E-Mail</label>
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw">Passwort</label>
          <input id="pw" className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === "register" && <small className="faint">Mindestens 8 Zeichen.</small>}
          {mode === "login" && <Link href="/forgot" className="small" style={{ color: "var(--accent)", alignSelf: "flex-end" }}>Passwort vergessen?</Link>}
        </div>
        {error && <div className="card-soft small neg-txt" style={{ borderColor: "var(--neg)" }} role="alert">{error}</div>}
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Einen Moment …" : mode === "login" ? "Anmelden" : "Account erstellen"}</button>
      </form>
      <p className="dim small" style={{ textAlign: "center" }}>
        {mode === "login" ? <>Noch kein Account? <Link href="/register" style={{ color: "var(--accent)" }}>Registrieren</Link></> : <>Schon registriert? <Link href="/login" style={{ color: "var(--accent)" }}>Anmelden</Link></>}
      </p>
      {mode === "register" && <p className="faint small">Mit der Registrierung speicherst du deine Spielstände in der Cloud. Wir verwenden deine E-Mail nur für den Login und zum Zurücksetzen des Passworts. Mehr dazu in der <Link href="/datenschutz" style={{ color: "var(--accent)" }}>Datenschutzerklärung</Link>.</p>}
      <LegalLinks />
    </div>
    </div>
  );
}
