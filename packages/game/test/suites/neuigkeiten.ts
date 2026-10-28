/** Integrationstest – Neuigkeiten: Meldungen im Admin-Bereich anlegen, planen, veröffentlichen; Titelbilder. */
import { describe, expect, it } from "vitest";
import { game, pool } from "../context";

const ADMIN = "news-admin@example.com";
// Kleinstes gültiges PNG (1×1 Pixel)
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  process.env.ADMIN_EMAILS = ADMIN;
  try {
    return await fn();
  } finally {
    delete process.env.ADMIN_EMAILS;
  }
}

describe("Neuigkeiten", () => {
  it("Entwurf, Veröffentlichung, Planung, Kategorie, Adresse und englische Fassung", async () => {
    await expect(game.adminNewsSave("spieler@example.com", null, { title: "Hallo" })).rejects.toMatchObject({ status: 403 });
    await asAdmin(async () => {
      await expect(game.adminNewsSave(ADMIN, null, { title: "Hi" })).rejects.toThrow(/mindestens 3 Zeichen/);
      const draft = await game.adminNewsSave(ADMIN, null, { title: "Update für Spieler: Über alles", teaser: "Kurz", body: "Text", category: "update" });
      expect(draft.news.slug).toBe("update-fuer-spieler-ueber-alles");
      expect(draft.message).toBe("Entwurf gespeichert");
      expect((await game.publicNews()).items.find((n) => n.slug === draft.news.slug)).toBeUndefined();
      expect(await game.publicArticle(draft.news.slug)).toBeNull();

      const pub = await game.adminNewsSave(ADMIN, draft.news.id, { ...draft.news, published: true, titleEn: "Update for players", teaserEn: "Short", bodyEn: "English text" });
      expect(pub.message).toBe("Meldung veröffentlicht");
      expect(pub.news.slug).toBe(draft.news.slug);
      const de = await game.publicArticle(pub.news.slug);
      expect(de?.article).toMatchObject({ title: "Update für Spieler: Über alles", body: "Text", lang: "de", readMinutes: 1 });
      expect((await game.publicArticle(pub.news.slug, "en"))?.article).toMatchObject({ title: "Update for players", body: "English text", lang: "en" });

      // Gleicher Titel ergibt eine eigene Adresse; geplante Meldungen bleiben bis zum Termin verborgen
      const later = await game.adminNewsSave(ADMIN, null, { title: "Update für Spieler: Über alles", category: "event", published: true, publishedAt: new Date(Date.now() + 86_400_000).toISOString() });
      expect(later.news.slug).toBe("update-fuer-spieler-ueber-alles-2");
      expect(later.message).toBe("Meldung geplant");
      expect((await game.publicNews()).items.map((n) => n.slug)).not.toContain(later.news.slug);
      expect((await game.publicNews({ category: "update" })).items.map((n) => n.slug)).toContain(pub.news.slug);
      expect((await game.publicNews({ category: "event" })).items.map((n) => n.slug)).toEqual(["football-legacy-ist-live"]);

      await game.adminNewsDelete(ADMIN, later.news.id);
      await game.adminNewsDelete(ADMIN, pub.news.id);
      await expect(game.adminNewsGet(ADMIN, pub.news.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  it("Startmeldung aus der Migration: hervorgehoben, zweisprachig, mit mitgeliefertem Titelbild", async () => {
    const de = await game.publicArticle("football-legacy-ist-live");
    expect(de?.article).toMatchObject({ title: "Football Legacy ist live!", featured: true, image: "/news/launch.webp", category: "event" });
    expect(de?.article.body).toContain("## Was dich erwartet");
    expect((await game.publicArticle("football-legacy-ist-live", "en"))?.article.title).toBe("Football Legacy is live!");
    // Das mitgelieferte Bild bleibt beim Speichern erhalten, bis es entfernt wird
    await asAdmin(async () => {
      const row = (await game.adminNewsList(ADMIN)).news.find((n) => n.slug === "football-legacy-ist-live")!;
      expect((await game.adminNewsSave(ADMIN, row.id, { ...row, published: true })).news.image).toBe("/news/launch.webp");
    });
  });

  it("Titelbilder: nur echte Bilder, unveröffentlicht nur für Admins, Aufräumen", async () => {
    await asAdmin(async () => {
      // Als PNG ausgegebenes SVG/HTML wird am Inhalt erkannt und abgelehnt
      const svg = `data:image/png;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64")}`;
      await expect(game.adminNewsUpload(ADMIN, svg)).rejects.toThrow(/WebP, JPEG oder PNG/);
      await expect(game.adminNewsUpload(ADMIN, "kein bild")).rejects.toThrow(/WebP, JPEG oder PNG/);

      const img = await game.adminNewsUpload(ADMIN, PNG);
      expect(img.url).toBe(`/api/news/images/${img.id}`);
      const saved = await game.adminNewsSave(ADMIN, null, { title: "Meldung mit Bild", imageId: img.id });
      expect(await game.newsImage(String(img.id), null)).toBeNull(); // Entwurf: öffentlich nicht sichtbar
      expect((await game.newsImage(String(img.id), ADMIN))?.mime).toBe("image/png");
      await game.adminNewsSave(ADMIN, saved.news.id, { ...saved.news, published: true });
      expect((await game.newsImage(String(img.id), null))?.mime).toBe("image/png");
      expect(await game.newsImage("1 or 1=1", ADMIN)).toBeNull();

      // Bild ersetzen löscht das alte; Löschen der Meldung löscht ihr Bild
      const next = await game.adminNewsUpload(ADMIN, PNG);
      await game.adminNewsSave(ADMIN, saved.news.id, { ...saved.news, published: true, imageId: next.id });
      const left = async (id: number) => (await pool().query("select 1 from site_images where id = $1", [id])).rowCount;
      expect(await left(img.id)).toBe(0);
      await game.adminNewsDelete(ADMIN, saved.news.id);
      expect(await left(next.id)).toBe(0);

      // Hochgeladen, aber nie gespeichert: nach einem Tag weg
      const orphan = await game.adminNewsUpload(ADMIN, PNG);
      await pool().query("update site_images set created_at = now() - interval '2 days' where id = $1", [orphan.id]);
      expect(await game.cleanupNewsImages()).toBeGreaterThanOrEqual(1);
      expect(await left(orphan.id)).toBe(0);
    });
  });
});
