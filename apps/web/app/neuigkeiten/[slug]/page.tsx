import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { langFromCookie } from "@fl/i18n";
import { publicArticle } from "@fl/game";
import { SiteFooter, SiteNav } from "@/components/landing/SiteNav";
import { NewsCard } from "@/components/news/NewsCard";
import { NewsBody } from "@/components/news/NewsBody";
import { Icon } from "@/components/ui";
import { CATEGORY_LABEL, newsDate } from "@/components/news/meta";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const lang = langFromCookie((await cookies()).toString());
  return { lang, data: await publicArticle(slug, lang).catch(() => null) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { data } = await load((await params).slug);
  if (!data) return { title: "Neuigkeiten – Football Legacy" };
  const a = data.article;
  return {
    title: `${a.title} – Football Legacy`,
    description: a.teaser || undefined,
    openGraph: { title: a.title, description: a.teaser || undefined, type: "article", publishedTime: a.publishedAt, images: a.image ? [a.image] : undefined },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { lang, data } = await load((await params).slug);
  if (!data) notFound();
  const { article: a, more } = data;
  const loggedIn = !!(await cookies()).get("fl_session");
  return (
    <div className="lp">
      <SiteNav active="news" loggedIn={loggedIn} />
      <main className="nw-article-page">
        <article className="nw-article">
          <Link href="/neuigkeiten" className="nw-back"><Icon name="back" size={15} /> Alle Neuigkeiten</Link>
          <p className="nw-kicker">
            <span className="nw-cat">{CATEGORY_LABEL[a.category] ?? a.category}</span>
            <time dateTime={a.publishedAt} translate="no">{newsDate(a.publishedAt, lang)}</time>
            <span>{a.readMinutes} Min. Lesezeit</span>
          </p>
          <h1 lang={a.lang} translate="no">{a.title}</h1>
          {a.teaser && <p className="nw-lead" lang={a.lang} translate="no">{a.teaser}</p>}
          <p className="nw-author">Von <span translate="no">{a.author}</span></p>
          {a.image && <img className="nw-hero-img" src={a.image} alt="" fetchPriority="high" />}
          <div lang={a.lang} translate="no"><NewsBody text={a.body} /></div>
        </article>
        {more.length > 0 && (
          <section className="nw-related" aria-labelledby="more-title">
            <h2 id="more-title">Weitere Neuigkeiten</h2>
            <div className="nw-grid">{more.map((n) => <NewsCard key={n.slug} n={n} lang={lang} />)}</div>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
