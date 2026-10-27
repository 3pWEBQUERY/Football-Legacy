import Link from "next/link";
import type { ReactNode } from "react";

/** Links zu Impressum und Datenschutz – auf Start-, Login- und Einstellungsseite. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav className={`legal-links ${className}`} aria-label="Rechtliches">
      <Link href="/impressum">Impressum</Link>
      <span aria-hidden="true">·</span>
      <Link href="/datenschutz">Datenschutz</Link>
    </nav>
  );
}

/** Angaben zum Betreiber aus der Umgebung (LEGAL_NAME, LEGAL_ADDRESS, LEGAL_EMAIL). */
export function operator() {
  const name = process.env.LEGAL_NAME?.trim();
  const address = process.env.LEGAL_ADDRESS?.split(/\\n|\n|\|/).map((l) => l.trim()).filter(Boolean) ?? [];
  const email = process.env.LEGAL_EMAIL?.trim();
  return { name, address, email, complete: !!(name && address.length && email) };
}

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="legal">
      <header className="legal-top">
        <Link href="/" className="row" style={{ gap: 10 }}>
          <div className="brand-mark">FL</div>
          <div className="brand-name">Football Legacy<small>{title}</small></div>
        </Link>
      </header>
      <article className="legal-body card">
        <h1>{title}</h1>
        <p className="faint small">Stand: {updated}</p>
        {children}
      </article>
      <LegalLinks />
    </div>
  );
}

export function Missing({ what }: { what: string }) {
  return <span className="legal-missing">[{what} fehlt – bitte als Umgebungsvariable hinterlegen]</span>;
}
