import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";

const FEATURES = [
  { icon: "🌍", title: "Eine ganze Welt", text: "155 Länder mit fiktiven Ligenpyramiden, über 3000 Vereinen und regionalen Spielernamen – nachempfunden an echte Strukturen." },
  { icon: "🧠", title: "Taktik, die zählt", text: "Formationen, Rollen, Tempo, Pressing, Abwehrlinie und Standards. Die Matchengine rechnet jeden Spielzug aus Attributen und Taktik." },
  { icon: "📺", title: "2D-Taktikansicht", text: "22 Spieler als Punkte auf dem Feld, drei Geschwindigkeiten, Highlights und Halbzeitansprache mit Wechseln und Umstellungen." },
  { icon: "💼", title: "Echter Markt", text: "Transfers mit Verhandlung, Verträge, Finanzen und KI-Vereine, die nach denselben Regeln handeln wie du." },
  { icon: "🏆", title: "Karriere & Gamification", text: "Vom Co-Trainer zum Meistermacher: Level, Erfolge, Tagesmissionen, Serien, Spielerkarten und Ranglisten." },
  { icon: "☁️", title: "Überall weiterspielen", text: "Dein Spielstand liegt in der Cloud – am Desktop oder auf dem Smartphone, im Dark oder Light Mode." },
];

export default async function Landing() {
  const jar = await cookies();
  if (jar.get("fl_session")) redirect("/careers");
  return (
    <div className="landing">
      <header className="between" style={{ padding: "16px 24px" }}>
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">FL</div>
          <div>Football Legacy<small>Schreibe Fussball Geschichte</small></div>
        </div>
        <div className="row">
          <ThemeToggle compact />
          <Link className="btn btn-ghost" href="/login">Anmelden</Link>
          <Link className="btn btn-primary" href="/register">Kostenlos starten</Link>
        </div>
      </header>
      <section className="hero">
        <div className="hero-glow" />
        <h1>Vom Co-Trainer<br /><span>zur Legende.</span></h1>
        <p>Übernimm einen Mittelklasse-Verein irgendwo auf der Welt, stelle die Taktik ein, verhandle Transfers und schreibe deine eigene Fussball-Geschichte. Jede Entscheidung wirkt im nächsten Spiel.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn btn-primary btn-lg" href="/register">Karriere starten</Link>
          <Link className="btn btn-lg" href="/login">Ich habe schon einen Account</Link>
        </div>
      </section>
      <section className="features">
        {FEATURES.map((f) => (
          <div key={f.title} className="card stack-sm">
            <div style={{ fontSize: 26 }}>{f.icon}</div>
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
