"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { Icon, Seg, useToast } from "@/components/ui";
import { Switch } from "@/components/Switch";
import { useConfirm } from "@/components/Dialog";
import { NewsBody } from "@/components/news/NewsBody";
import { CATEGORIES, CATEGORY_LABEL, newsDate } from "@/components/news/meta";

export interface AdminNews {
  id: number;
  slug: string;
  category: string;
  title: string;
  teaser: string;
  body: string;
  titleEn: string;
  teaserEn: string;
  bodyEn: string;
  imageId: number | null;
  image: string | null;
  featured: boolean;
  published: boolean;
  publishedAt: string;
  author: string;
}

type Draft = Omit<AdminNews, "id" | "publishedAt"> & { publishedAt: string };

const EMPTY: Draft = {
  slug: "", category: "update", title: "", teaser: "", body: "", titleEn: "", teaserEn: "", bodyEn: "",
  imageId: null, image: null, featured: false, published: false, publishedAt: "", author: "Football Legacy Team",
};

/** ISO-Zeit ↔ Wert für <input type="datetime-local"> (Ortszeit des Browsers) */
const toLocal = (iso: string) => {
  const d = iso ? new Date(iso) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** Bild im Browser auf höchstens 1600 px Breite verkleinern und als WebP hochladen. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bmp.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const webp = canvas.toDataURL("image/webp", 0.86);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.86);
}

export function NewsEditor({ initial, onClose, onSaved, onDeleted }: {
  initial: AdminNews | null;
  onClose: () => void;
  onSaved: (n: AdminNews) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const ask = useConfirm();
  const file = useRef<HTMLInputElement>(null);
  const [d, setD] = useState<Draft>(() => (initial ? { ...initial, publishedAt: toLocal(initial.publishedAt) } : { ...EMPTY, publishedAt: toLocal("") }));
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function upload(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const r = await api<{ id: number; url: string }>("admin/news/images", { body: { data: await shrink(f) } });
      setD((x) => ({ ...x, imageId: r.id, image: r.url }));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  async function save(published: boolean) {
    setBusy(true);
    try {
      const body = { ...d, published, publishedAt: new Date(d.publishedAt || Date.now()).toISOString() };
      const r = await api<{ message: string; news: AdminNews }>(initial ? `admin/news/${initial.id}` : "admin/news", { body });
      toast(r.message, "success");
      setD({ ...r.news, publishedAt: toLocal(r.news.publishedAt) });
      onSaved(r.news);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial || !(await ask({ title: "Meldung löschen", message: `„${initial.title}“ wird endgültig gelöscht.`, confirmLabel: "Löschen", danger: true }))) return;
    setBusy(true);
    try {
      toast((await api<{ message: string }>(`admin/news/${initial.id}/delete`, { body: {} })).message, "success");
      onDeleted();
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  }

  const live = initial?.published && new Date(initial.publishedAt) <= new Date();
  return (
    <div className="stack nw-editor">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="back" size={15} /> Alle Meldungen</button>
        <Seg value={view} onChange={setView} options={[{ value: "edit", label: "Bearbeiten" }, { value: "preview", label: "Vorschau" }]} />
      </div>

      {view === "preview" ? (
        <article className="card nw-preview">
          {d.image && <img className="nw-preview-img" src={d.image} alt="" />}
          <p className="nw-kicker">{CATEGORY_LABEL[d.category]} · <span translate="no">{newsDate(new Date(d.publishedAt || Date.now()).toISOString())}</span></p>
          <h1 translate="no">{d.title || "Titel der Meldung"}</h1>
          {d.teaser && <p className="nw-lead" translate="no">{d.teaser}</p>}
          <div translate="no"><NewsBody text={d.body} /></div>
        </article>
      ) : (
        <div className="nw-editor-grid">
          <div className="card stack">
            <div className="field">
              <label htmlFor="n-title">Titel</label>
              <input id="n-title" className="input" maxLength={140} value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="z. B. Update 1.4: Neue Transferlogik" />
            </div>
            <div className="field">
              <label htmlFor="n-teaser">Kurztext <span className="faint">(Vorschau in der Übersicht)</span></label>
              <textarea id="n-teaser" className="input" rows={3} maxLength={400} value={d.teaser} onChange={(e) => set("teaser", e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="n-body">Text</label>
              <textarea id="n-body" className="input mono" rows={16} maxLength={20000} value={d.body} onChange={(e) => set("body", e.target.value)} />
              <p className="faint small" style={{ margin: 0 }}>Absätze mit einer Leerzeile trennen · <code>## Zwischenüberschrift</code> · <code>- Aufzählung</code> · <code>&gt; Zitat</code> · <code>**fett**</code> · <code>[Linktext](https://…)</code></p>
            </div>
            <details className="nw-en">
              <summary>Englische Fassung {d.titleEn ? "· vorhanden" : "· optional"}</summary>
              <p className="faint small">Ohne englischen Titel sehen englischsprachige Besucher die deutsche Meldung.</p>
              <div className="field">
                <label htmlFor="n-title-en">Titel (Englisch)</label>
                <input id="n-title-en" className="input" maxLength={140} value={d.titleEn} onChange={(e) => set("titleEn", e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="n-teaser-en">Kurztext (Englisch)</label>
                <textarea id="n-teaser-en" className="input" rows={3} maxLength={400} value={d.teaserEn} onChange={(e) => set("teaserEn", e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="n-body-en">Text (Englisch)</label>
                <textarea id="n-body-en" className="input mono" rows={12} maxLength={20000} value={d.bodyEn} onChange={(e) => set("bodyEn", e.target.value)} />
              </div>
            </details>
          </div>

          <aside className="stack">
            <div className="card stack">
              <h3 className="nw-side-title">Titelbild</h3>
              {d.image ? <img className="nw-editor-img" src={d.image} alt="Titelbild der Meldung" /> : <div className="nw-editor-img empty-img">Kein Bild</div>}
              <input ref={file} type="file" accept="image/webp,image/jpeg,image/png" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => upload(e.target.files?.[0])} />
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-sm" disabled={busy} onClick={() => file.current?.click()}>{d.image ? "Bild ersetzen" : "Bild hochladen"}</button>
                {d.image && <button className="btn btn-ghost btn-sm" onClick={() => setD((x) => ({ ...x, imageId: null, image: null }))}>Entfernen</button>}
              </div>
              <p className="faint small" style={{ margin: 0 }}>Querformat 16:9 empfohlen. Wird automatisch auf 1600 px verkleinert.</p>
            </div>
            <div className="card stack">
              <div className="field">
                <label htmlFor="n-cat">Kategorie</label>
                <select id="n-cat" className="select" value={d.category} onChange={(e) => set("category", e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="n-date">Veröffentlichen ab</label>
                <input id="n-date" type="datetime-local" className="input" value={d.publishedAt} onChange={(e) => set("publishedAt", e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="n-author">Verfasser</label>
                <input id="n-author" className="input" maxLength={60} value={d.author} onChange={(e) => set("author", e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="n-slug">Adresse</label>
                <input id="n-slug" className="input mono" maxLength={80} value={d.slug} onChange={(e) => set("slug", e.target.value)} placeholder="wird aus dem Titel erzeugt" />
                <span className="faint small">/neuigkeiten/{d.slug || "…"}</span>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>Hervorheben <span className="faint small">(grosse Kachel oben)</span></span>
                <Switch checked={d.featured} onChange={(v) => set("featured", v)} label="Meldung hervorheben" />
              </div>
            </div>
            <div className="card stack">
              <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>{initial?.published ? "Änderungen veröffentlichen" : "Veröffentlichen"}</button>
              <button className="btn" disabled={busy} onClick={() => save(false)}>{initial?.published ? "Zurückziehen (Entwurf)" : "Als Entwurf speichern"}</button>
              {live && <a className="btn btn-ghost" href={`/neuigkeiten/${initial!.slug}`} target="_blank" rel="noopener">Auf der Seite ansehen</a>}
              {initial && <button className="btn btn-ghost btn-danger" disabled={busy} onClick={remove}><Icon name="trash" size={15} /> Löschen</button>}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
