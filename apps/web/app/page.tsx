import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";

const FEATURES = [
  { title: "155 Länder", text: "Fiktive Ligapyramiden nach echtem Vorbild – von der englischen vierten Liga bis zur Meisterliga der Schweiz. Über 3000 Vereine, regionale Spielernamen." },
  { title: "Matchengine", text: "540 Spielzüge pro Partie, berechnet aus Attributen, Form, Kondition und Taktik. Abgespielt in der 2D-Taktikansicht mit Halbzeitansprache." },
  { title: "Taktik", text: "Acht Formationen, verschiebbare Positionen, 18 Rollen, Tempo, Pressing, Abwehrlinie, Risiko und Standardvarianten." },
  { title: "Transfermarkt", text: "Verhandlungen mit Gegenangeboten, Ausstiegsklauseln, Verträge, Scouting mit unscharfen Werten. KI-Vereine handeln nach denselben Regeln." },
  { title: "Vereinsführung", text: "Finanzen, Training, Trainerstab, Jugendjahrgänge, Vorstandsziele, Auf- und Abstieg, Entlassung und Jobangebote." },
  { title: "Karriere", text: "Vom Co-Trainer zum Meistermacher: Manager-Level, Erfolge, Tagesziele, Ranglisten. Spielstände in der Cloud." },
];

export default async function Landing() {
  const jar = await cookies();
  if (jar.get("fl_session")) redirect("/careers");
  return (
    <div className="landing">
      <header className="landing-top">
        <div className="row" style={{ gap: 10 }}>
          <div className="brand-mark">FL</div>
          <div className="brand-name">Football Legacy<small>Manager</small></div>
        </div>
        <div className="row">
          <ThemeToggle compact />
          <Link className="btn btn-ghost" href="/login">Anmelden</Link>
          <Link className="btn btn-primary" href="/register">Registrieren</Link>
        </div>
      </header>
      <section className="hero">
        <div>
          <div className="faint up small" style={{ fontWeight: 700 }}>Fussball-Manager im Browser</div>
          <h1 style={{ marginTop: 10 }}>Schreibe<br />Fussball<br /><em>Geschichte.</em></h1>
          <p>Du übernimmst als Co-Trainer einen Verein im Mittelfeld der Tabelle. Aufstellung, Taktik, Transfers und Training liegen ab sofort bei dir – jede Entscheidung wirkt im nächsten Spiel.</p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Link className="btn btn-primary btn-lg" href="/register">Neue Karriere starten</Link>
            <Link className="btn btn-lg" href="/login">Spielstand laden</Link>
          </div>
        </div>
        <div className="hero-shot">
          <img src="/preview-squad.png" alt="Kaderansicht von Football Legacy" style={{ display: "block", width: "100%", height: "auto" }} />
        </div>
      </section>
      <section className="features">
        {FEATURES.map((f, i) => (
          <div key={f.title} className="feature">
            <div className="n">{String(i + 1).padStart(2, "0")}</div>
            <h3>{f.title}</h3>
            <p className="dim">{f.text}</p>
          </div>
        ))}
      </section>
      <footer className="faint small" style={{ textAlign: "center", padding: "0 24px 32px" }}>
        Alle Vereine, Ligen und Spieler sind frei erfunden. Ähnlichkeiten mit realen Personen oder Vereinen sind zufällig.
      </footer>
    </div>
  );
}
