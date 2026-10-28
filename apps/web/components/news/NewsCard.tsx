import Link from "next/link";
import type { NewsCard as Card } from "@fl/game";
import { CATEGORY_LABEL, newsDate } from "./meta";

/** Kachel einer Meldung: gross (hero), seitlich (side), im Raster (grid) oder quer (wide). */
export function NewsCard({ n, variant = "grid", lang, priority = false }: { n: Card; variant?: "hero" | "side" | "grid" | "wide"; lang: string; priority?: boolean }) {
  return (
    <Link href={`/neuigkeiten/${n.slug}`} className={`nw-card is-${variant}`}>
      <div className="nw-img">
        {n.image ? (
          <img src={n.image} alt="" loading={priority ? "eager" : "lazy"} {...(priority ? { fetchPriority: "high" as const } : {})} />
        ) : (
          <div className="nw-img-fallback" aria-hidden="true"><span translate="no">FL</span></div>
        )}
      </div>
      <div className="nw-card-copy">
        <h3 lang={n.lang} translate="no">{n.title}</h3>
        <p className="nw-meta">
          <span className="nw-cat">{CATEGORY_LABEL[n.category] ?? n.category}</span>
          <time dateTime={n.publishedAt} translate="no">{newsDate(n.publishedAt, lang)}</time>
        </p>
        {(variant === "hero" || variant === "wide") && n.teaser && <p className="nw-teaser" lang={n.lang} translate="no">{n.teaser}</p>}
      </div>
    </Link>
  );
}
