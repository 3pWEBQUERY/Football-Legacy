import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { langFromCookie } from "@fl/i18n";
import { publicNews } from "@fl/game";
import { Shot } from "@/components/landing/Shot";
import { SiteFooter, SiteNav } from "@/components/landing/SiteNav";
import { NewsCard } from "@/components/news/NewsCard";
import { ANYWHERE, FACTS, FAQ, FEATURES } from "@/components/landing/content";

export default async function Landing() {
  const jar = await cookies();
  if (jar.get("fl_session")) redirect("/careers");
  const lang = langFromCookie(jar.toString());
  const news = (await publicNews({ lang, limit: 3 }).catch(() => ({ items: [] }))).items;
  return (
    <div className="lp">
      <SiteNav />

      <main>
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">Fussball-Manager im Browser</p>
            <h1>Schreibe Fussball Geschichte.</h1>
            <p className="lp-lead">
              Übernimm einen Verein in einer von 155 Fussballnationen und führe ihn Saison für Saison nach oben – mit Taktik, Transfers, Training und Nerven an der Seitenlinie.
            </p>
            <div className="row lp-cta">
              <Link className="btn btn-primary btn-lg" href="/register">Neue Karriere starten</Link>
              <Link className="btn btn-lg" href="/login">Spielstand laden</Link>
            </div>
            <p className="lp-note">Kostenlos · ohne Download · Spielstände in der Cloud</p>
          </div>
          <figure className="lp-hero-shot">
            <Shot name="office" lang={lang} priority alt="Das Büro: Posteingang, nächstes Spiel, Vorstand und Tabelle auf einen Blick" />
          </figure>
        </section>

        <section className="lp-facts" aria-label="Football Legacy in Zahlen">
          {FACTS.map((f) => (
            <div key={f.label} className="lp-fact"><strong>{f.value}</strong><span>{f.label}</span></div>
          ))}
        </section>

        {news.length > 0 && (
          <section className="lp-news" aria-labelledby="nw-title">
            <div className="lp-news-head">
              <h2 id="nw-title">Neuigkeiten</h2>
              <Link href="/neuigkeiten" className="btn btn-sm">Alle Neuigkeiten</Link>
            </div>
            <div className="nw-grid">{news.map((n) => <NewsCard key={n.slug} n={n} lang={lang} />)}</div>
          </section>
        )}

        {FEATURES.map((f, i) => (
          <section key={f.id} id={f.id} className={`lp-feature ${i % 2 ? "flip" : ""}`} aria-labelledby={`${f.id}-title`}>
            <div className="lp-feature-copy">
              <p className="lp-eyebrow"><span className="lp-num">{String(i + 1).padStart(2, "0")}</span> {f.eyebrow}</p>
              <h2 id={`${f.id}-title`}>{f.title}</h2>
              <p>{f.text}</p>
              <ul className="lp-points">{f.points.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
            <figure className="lp-shot">
              <Shot name={f.shot} lang={lang} alt={f.alt} />
            </figure>
          </section>
        ))}

        <section className="lp-anywhere" aria-labelledby="anywhere-title">
          <figure className="lp-phone"><Shot name="mobile" lang={lang} alt="Das Büro auf dem Smartphone mit Posteingang und nächstem Spiel" /></figure>
          <div className="lp-feature-copy">
            <p className="lp-eyebrow">Überall</p>
            <h2 id="anywhere-title">Weiterspielen, wo du gerade bist</h2>
            <p>Die Karriere läuft auf dem Server weiter, nicht auf deinem Gerät. Am Abend am Computer die Taktik feilen, in der Mittagspause auf dem Smartphone den nächsten Spieltag spielen.</p>
            <ul className="lp-points">{ANYWHERE.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        </section>

        <section className="lp-faq" aria-labelledby="faq-title">
          <h2 id="faq-title">Häufige Fragen</h2>
          <div className="lp-faq-list">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-final">
          <h2>Dein Verein wartet auf dich.</h2>
          <p>Konto anlegen, Land und Verein wählen, erstes Training ansetzen – in zwei Minuten stehst du an der Seitenlinie.</p>
          <Link className="btn btn-primary btn-lg" href="/register">Kostenlos spielen</Link>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
