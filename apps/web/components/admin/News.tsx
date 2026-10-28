"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Empty, Icon, Loading, useToast } from "@/components/ui";
import { CATEGORY_LABEL, newsDate } from "@/components/news/meta";
import { NewsEditor, type AdminNews } from "./NewsEditor";

const status = (n: AdminNews) =>
  !n.published ? <span className="badge">Entwurf</span>
    : new Date(n.publishedAt) > new Date() ? <span className="badge badge-warn">Geplant</span>
      : <span className="badge badge-accent">Veröffentlicht</span>;

/** Neuigkeiten der Startseite: Liste aller Meldungen, Anlegen und Bearbeiten. */
export function AdminNews() {
  const toast = useToast();
  const [rows, setRows] = useState<AdminNews[] | null>(null);
  const [edit, setEdit] = useState<AdminNews | "new" | null>(null);
  const load = () => api<{ news: AdminNews[] }>("admin/news").then((r) => setRows(r.news)).catch((e) => toast((e as Error).message, "error"));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (edit) {
    return <NewsEditor key={edit === "new" ? "new" : edit.id} initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={(n) => { load(); setEdit(n); }} onDeleted={() => { load(); setEdit(null); }} />;
  }
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="dim small" style={{ margin: 0 }}>Meldungen erscheinen unter „Neuigkeiten“ und auf der Startseite. Geplante Meldungen werden zum gewählten Zeitpunkt sichtbar.</p>
        <button className="btn btn-primary btn-sm" onClick={() => setEdit("new")}><Icon name="plus" size={15} /> Neue Meldung</button>
      </div>
      {!rows ? <Loading /> : rows.length === 0 ? (
        <div className="card"><Empty>Noch keine Meldungen. Lege die erste Meldung an.</Empty></div>
      ) : (
        <div className="card card-flush table-wrap">
          <table className="table">
            <thead><tr><th>Titel</th><th>Kategorie</th><th>Status</th><th>Datum</th><th className="c">Englisch</th></tr></thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id} className="clickable" onClick={() => setEdit(n)}>
                  <td className="name">
                    <span translate="no">{n.title}</span>
                    {n.featured && <span className="badge badge-gold" style={{ marginLeft: 8 }}>Hervorgehoben</span>}
                  </td>
                  <td className="small">{CATEGORY_LABEL[n.category] ?? n.category}</td>
                  <td>{status(n)}</td>
                  <td className="small" translate="no">{newsDate(n.publishedAt)}</td>
                  <td className="c small">{n.titleEn ? "Ja" : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
