/**
 * Neuigkeiten auf der Startseite: Administratoren schreiben Meldungen mit
 * Titelbild (optional auch auf Englisch), planen die Veröffentlichung und
 * heben einzelne Meldungen hervor. Öffentlich sichtbar ist nur, was
 * veröffentlicht und fällig ist; Bilder unveröffentlichter Meldungen sehen
 * nur Administratoren.
 */
import { one, pool, query } from "./db";
import { GameError } from "./errors";
import { isAdmin } from "./monitoring";
import { logAction, requireAdmin } from "./admin";

export const NEWS_CATEGORIES = ["update", "feature", "community", "event", "maintenance"] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

const MAX_IMAGE_BYTES = 2_500_000;
const LIMITS = { title: 140, teaser: 400, body: 20_000 };

interface NewsRow {
  id: string;
  slug: string;
  category: NewsCategory;
  title: string;
  teaser: string;
  body: string;
  title_en: string | null;
  teaser_en: string | null;
  body_en: string | null;
  image_id: string | null;
  featured: boolean;
  published: boolean;
  published_at: string;
  author: string;
  updated_at: string;
}

export interface NewsCard {
  slug: string;
  category: NewsCategory;
  title: string;
  teaser: string;
  image: string | null;
  featured: boolean;
  publishedAt: string;
  author: string;
  /** Sprache des Inhalts (Englisch nur, wenn eine Übersetzung hinterlegt ist) */
  lang: "de" | "en";
}

export interface NewsArticle extends NewsCard {
  body: string;
  readMinutes: number;
}

const imageUrl = (id: string | null) => (id ? `/api/news/images/${id}` : null);
const due = "published and published_at <= now()";

function card(r: NewsRow, lang: string): NewsCard {
  const en = lang === "en" && !!r.title_en?.trim();
  return {
    slug: r.slug,
    category: r.category,
    title: en ? r.title_en! : r.title,
    teaser: en ? (r.teaser_en ?? "") : r.teaser,
    image: imageUrl(r.image_id),
    featured: r.featured,
    publishedAt: new Date(r.published_at).toISOString(),
    author: r.author,
    lang: en ? "en" : "de",
  };
}

// ---------------------------------------------------------------- Öffentlich

export async function publicNews(opts: { lang?: string; category?: string | null; limit?: number; offset?: number } = {}) {
  const category = NEWS_CATEGORIES.includes(opts.category as NewsCategory) ? opts.category : null;
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 120);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = await query<NewsRow & { total: number }>(pool(), `
    select *, count(*) over ()::int as total from site_news
     where ${due} and ($1::text is null or category = $1)
     order by published_at desc, id desc limit $2 offset $3`, [category, limit, offset]);
  return { items: rows.map((r) => card(r, opts.lang ?? "de")), total: rows[0]?.total ?? 0 };
}

export async function publicArticle(slug: string, lang = "de"): Promise<{ article: NewsArticle; more: NewsCard[] } | null> {
  const r = await one<NewsRow>(pool(), `select * from site_news where slug = $1 and ${due}`, [slug]);
  if (!r) return null;
  const c = card(r, lang);
  const body = c.lang === "en" ? (r.body_en ?? "") : r.body;
  const words = body.split(/\s+/).filter(Boolean).length;
  const more = await query<NewsRow>(pool(), `select * from site_news where ${due} and id <> $1 order by (category = $2) desc, published_at desc limit 3`, [r.id, r.category]);
  return { article: { ...c, body, readMinutes: Math.max(1, Math.round(words / 200)) }, more: more.map((m) => card(m, lang)) };
}

/** Bild ausliefern: öffentlich nur für fällige Meldungen, sonst nur für Administratoren. */
export async function newsImage(id: string, email: string | null | undefined) {
  if (!/^\d{1,18}$/.test(id)) return null;
  const visible = isAdmin(email) ? "true" : "exists (select 1 from site_news n where n.image_id = i.id and n.published and n.published_at <= now())";
  return one<{ mime: string; data: Buffer }>(pool(), `select mime, data from site_images i where id = $1 and ${visible}`, [id]);
}

// ---------------------------------------------------------------- Admin

export interface NewsInput {
  title?: unknown;
  teaser?: unknown;
  body?: unknown;
  titleEn?: unknown;
  teaserEn?: unknown;
  bodyEn?: unknown;
  category?: unknown;
  slug?: unknown;
  imageId?: unknown;
  featured?: unknown;
  published?: unknown;
  publishedAt?: unknown;
  author?: unknown;
}

const text = (v: unknown, max: number, label: string) => {
  const s = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
  if (s.length > max) throw new GameError(`${label}: höchstens ${max} Zeichen.`);
  return s;
};

export function slugify(s: string): string {
  const map: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
  return s.toLowerCase().replace(/[äöüß]/g, (c) => map[c]).normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "") || "meldung";
}

async function uniqueSlug(base: string, exceptId: string | null) {
  for (let i = 1; ; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const taken = await one(pool(), "select 1 from site_news where slug = $1 and ($2::bigint is null or id <> $2)", [slug, exceptId]);
    if (!taken) return slug;
  }
}

function adminView(r: NewsRow) {
  return {
    id: Number(r.id), slug: r.slug, category: r.category, title: r.title, teaser: r.teaser, body: r.body,
    titleEn: r.title_en ?? "", teaserEn: r.teaser_en ?? "", bodyEn: r.body_en ?? "",
    imageId: r.image_id ? Number(r.image_id) : null, image: imageUrl(r.image_id), featured: r.featured,
    published: r.published, publishedAt: new Date(r.published_at).toISOString(), author: r.author, updatedAt: r.updated_at,
  };
}

export async function adminNewsList(email: string) {
  requireAdmin(email);
  const rows = await query<NewsRow>(pool(), "select * from site_news order by published_at desc, id desc limit 500");
  return { news: rows.map(adminView), categories: NEWS_CATEGORIES };
}

export async function adminNewsGet(email: string, id: number) {
  requireAdmin(email);
  const r = await one<NewsRow>(pool(), "select * from site_news where id = $1", [id]);
  if (!r) throw new GameError("Meldung nicht gefunden.", 404);
  return { news: adminView(r) };
}

/** Anlegen (id = null) oder ändern. */
export async function adminNewsSave(email: string, id: number | null, input: NewsInput) {
  const admin = requireAdmin(email);
  const title = text(input.title, LIMITS.title, "Titel");
  if (title.length < 3) throw new GameError("Bitte gib einen Titel mit mindestens 3 Zeichen ein.");
  const teaser = text(input.teaser, LIMITS.teaser, "Kurztext");
  const body = text(input.body, LIMITS.body, "Text");
  const titleEn = text(input.titleEn, LIMITS.title, "Titel (Englisch)");
  const teaserEn = text(input.teaserEn, LIMITS.teaser, "Kurztext (Englisch)");
  const bodyEn = text(input.bodyEn, LIMITS.body, "Text (Englisch)");
  const author = text(input.author, 60, "Verfasser") || "Football Legacy Team";
  const category = NEWS_CATEGORIES.includes(input.category as NewsCategory) ? (input.category as NewsCategory) : "update";
  const published = input.published === true;
  const at = typeof input.publishedAt === "string" && input.publishedAt ? new Date(input.publishedAt) : new Date();
  if (Number.isNaN(at.getTime())) throw new GameError("Ungültiges Veröffentlichungsdatum.");
  const imageId = input.imageId == null || input.imageId === "" ? null : Number(input.imageId);
  if (imageId !== null && !(await one(pool(), "select 1 from site_images where id = $1", [imageId]))) throw new GameError("Das Bild wurde nicht gefunden. Bitte lade es erneut hoch.");

  const existing = id === null ? null : await one<NewsRow>(pool(), "select * from site_news where id = $1", [id]);
  if (id !== null && !existing) throw new GameError("Meldung nicht gefunden.", 404);
  const wanted = typeof input.slug === "string" && input.slug.trim() ? slugify(input.slug) : existing?.slug ?? slugify(title);
  const slug = wanted === existing?.slug ? wanted : await uniqueSlug(wanted, existing?.id ?? null);
  const values = [slug, category, title, teaser, body, titleEn || null, teaserEn || null, bodyEn || null, imageId, input.featured === true, published, at.toISOString()];

  let row: NewsRow | null;
  if (!existing) {
    row = await one<NewsRow>(pool(), `insert into site_news(slug, category, title, teaser, body, title_en, teaser_en, body_en, image_id, featured, published, published_at, author)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`, [...values, author]);
  } else {
    row = await one<NewsRow>(pool(), `update site_news set slug=$1, category=$2, title=$3, teaser=$4, body=$5, title_en=$6, teaser_en=$7, body_en=$8,
      image_id=$9, featured=$10, published=$11, published_at=$12, author=$13, updated_at=now() where id = $14 returning *`, [...values, author, existing.id]);
    if (existing.image_id && existing.image_id !== row?.image_id) await dropImageIfUnused(existing.image_id);
  }
  await logAction(admin, existing ? "news_update" : "news_create", null, { id: Number(row!.id), title, published });
  return { ok: true, message: published ? (at > new Date() ? "Meldung geplant" : "Meldung veröffentlicht") : "Entwurf gespeichert", news: adminView(row!) };
}

export async function adminNewsDelete(email: string, id: number) {
  const admin = requireAdmin(email);
  const r = await one<NewsRow>(pool(), "delete from site_news where id = $1 returning *", [id]);
  if (!r) throw new GameError("Meldung nicht gefunden.", 404);
  if (r.image_id) await dropImageIfUnused(r.image_id);
  await logAction(admin, "news_delete", null, { id, title: r.title });
  return { ok: true, message: "Meldung gelöscht" };
}

// ---------------------------------------------------------------- Bilder

const SIGNATURES: [string, (b: Buffer) => boolean][] = [
  ["image/webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
];

/** Bild als data:-URL hochladen (WebP, JPEG oder PNG; der Browser verkleinert vorher). */
export async function adminNewsUpload(email: string, dataUrl: string) {
  const admin = requireAdmin(email);
  const m = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl ?? "");
  if (!m) throw new GameError("Bitte wähle ein Bild im Format WebP, JPEG oder PNG.");
  const data = Buffer.from(m[2], "base64");
  if (data.length > MAX_IMAGE_BYTES) throw new GameError("Das Bild ist zu gross (höchstens 2,5 MB).");
  // Der Typ kommt aus dem Inhalt, nicht aus der Angabe des Browsers (kein SVG, kein HTML)
  const mime = SIGNATURES.find(([, test]) => data.length > 12 && test(data))?.[0];
  if (!mime) throw new GameError("Bitte wähle ein Bild im Format WebP, JPEG oder PNG.");
  const r = await one<{ id: string }>(pool(), "insert into site_images(mime, data, bytes) values ($1,$2,$3) returning id", [mime, data, data.length]);
  await logAction(admin, "news_image", null, { id: Number(r!.id), bytes: data.length });
  return { id: Number(r!.id), url: imageUrl(r!.id) };
}

async function dropImageIfUnused(id: string) {
  await query(pool(), "delete from site_images i where id = $1 and not exists (select 1 from site_news n where n.image_id = i.id)", [id]);
}

/** Wartung: hochgeladene, aber nie gespeicherte Bilder nach einem Tag löschen. */
export async function cleanupNewsImages() {
  const rows = await query(pool(), "delete from site_images i where created_at < now() - interval '1 day' and not exists (select 1 from site_news n where n.image_id = i.id) returning id");
  return rows.length;
}
