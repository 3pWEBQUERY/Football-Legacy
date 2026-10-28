import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LangSwitch } from "@/components/LangSwitch";
import { LegalLinks } from "@/components/Legal";
import { FEATURES } from "./content";

const SECTIONS = FEATURES.filter((f) => ["spieltag", "taktik", "transfers", "verein", "online"].includes(f.id));

/** Kopfzeile der öffentlichen Seiten (Startseite und Neuigkeiten). */
export function SiteNav({ active, loggedIn = false }: { active?: "news"; loggedIn?: boolean }) {
  return (
    <header className="lp-nav">
      <Link href="/" className="row lp-brand" style={{ gap: 10 }}>
        <div className="brand-mark" translate="no">FL</div>
        <div className="brand-name">Football Legacy<small>Manager</small></div>
      </Link>
      <nav className="lp-links" aria-label="Bereiche">
        <Link href="/neuigkeiten" className="lp-link-news" aria-current={active === "news" ? "page" : undefined}>Neuigkeiten</Link>
        {SECTIONS.map((f) => <Link key={f.id} href={`/#${f.id}`}>{f.eyebrow}</Link>)}
      </nav>
      <div className="row lp-actions">
        <LangSwitch />
        <ThemeToggle compact />
        {loggedIn ? (
          <Link className="btn btn-primary" href="/careers">Meine Karrieren</Link>
        ) : (
          <>
            <Link className="btn btn-ghost" href="/login">Anmelden</Link>
            <Link className="btn btn-primary" href="/register">Kostenlos spielen</Link>
          </>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="lp-footer">
      <div className="row" style={{ gap: 10 }}>
        <div className="brand-mark" translate="no">FL</div>
        <span className="dim small">Football Legacy</span>
      </div>
      <p className="faint small">Alle Vereine, Ligen und Spieler sind frei erfunden. Ähnlichkeiten mit realen Personen oder Vereinen sind zufällig.</p>
      <LegalLinks />
    </footer>
  );
}
