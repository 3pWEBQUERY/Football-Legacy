import Link from "next/link";
import { cookies } from "next/headers";
import { langFromCookie } from "@fl/i18n";
import { publicNews } from "@fl/game";
import { SiteFooter, SiteNav } from "@/components/landing/SiteNav";
import { NewsCard } from "@/components/news/NewsCard";
import { CATEGORIES, CATEGORY_LABEL } from "@/components/news/meta";

export const metadata = {
  title: "Neuigkeiten – Football Legacy",
  description: "Updates, neue Funktionen und Ankündigungen rund um Football Legacy.",
};

const PAGE = 12;

export default async function NewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const jar = await cookies();
  const lang = langFromCookie(jar.toString());
  const category = typeof sp.kategorie === "string" && CATEGORIES.includes(sp.kategorie) ? sp.kategorie : null;
  const pages = Math.min(Math.max(Number(sp.seite) || 1, 1), 10);
  const { items, total } = await publicNews({ lang, category, limit: PAGE * pages }).catch(() => ({ items: [], total: 0 }));

  // Grosse Kachel: die neueste hervorgehobene Meldung, sonst die neueste überhaupt
  const heroIndex = Math.max(0, items.findIndex((n) => n.featured));
  const hero = items[heroIndex];
  const rest = items.filter((_, i) => i !== heroIndex);
  const side = rest.slice(0, 2);
  const grid = rest.slice(2);
  const href = (p: { kategorie?: string | null; seite?: number }) => {
    const q = new URLSearchParams();
    if (p.kategorie) q.set("kategorie", p.kategorie);
    if (p.seite && p.seite > 1) q.set("seite", String(p.seite));
    const s = q.toString();
    return s ? `/neuigkeiten?${s}` : "/neuigkeiten";
  };

  return (
    <div className="lp">
      <SiteNav active="news" loggedIn={!!jar.get("fl_session")} />
      <main className="nw-page">
        <div className="nw-head">
          <div>
            <h1>Neuigkeiten</h1>
            <p>Updates, neue Funktionen und Ankündigungen rund um Football Legacy</p>
          </div>
          <nav className="nw-filter" aria-label="Nach Kategorie filtern">
            <Link href={href({})} aria-current={!category ? "page" : undefined}>Alle</Link>
            {CATEGORIES.map((c) => <Link key={c} href={href({ kategorie: c })} aria-current={category === c ? "page" : undefined}>{CATEGORY_LABEL[c]}</Link>)}
          </nav>
        </div>

        {!hero ? (
          <div className="nw-empty">
            <h2>Noch keine Neuigkeiten</h2>
            <p>{category ? "In dieser Kategorie gibt es noch keine Meldungen." : "Hier erscheinen bald Updates und Ankündigungen."}</p>
            {category && <Link className="btn" href="/neuigkeiten">Alle Neuigkeiten</Link>}
          </div>
        ) : (
          <>
            <section className="nw-top" aria-label="Aktuell">
              <NewsCard n={hero} variant="hero" lang={lang} priority />
              {side.length > 0 && <div className="nw-side">{side.map((n) => <NewsCard key={n.slug} n={n} variant="side" lang={lang} />)}</div>}
            </section>
            {grid.length > 0 && (
              <section className="nw-grid" aria-label="Weitere Meldungen">
                {grid.map((n) => <NewsCard key={n.slug} n={n} variant={n.featured ? "wide" : "grid"} lang={lang} />)}
              </section>
            )}
            {total > items.length && (
              <div className="nw-more">
                <Link className="btn btn-primary" href={href({ kategorie: category, seite: pages + 1 })} scroll={false}>Mehr laden</Link>
              </div>
            )}
          </>
        )}
      </main>
      {!jar.get("fl_session") && (
        <section className="nw-band">
          <div>
            <p className="lp-eyebrow">Football Legacy</p>
            <h2>Bereit für deine Karriere?</h2>
            <p>Konto anlegen, Verein wählen und loslegen – kostenlos und ohne Download.</p>
          </div>
          <Link className="btn btn-primary btn-lg" href="/register">Kostenlos spielen</Link>
        </section>
      )}
      <SiteFooter />
    </div>
  );
}
