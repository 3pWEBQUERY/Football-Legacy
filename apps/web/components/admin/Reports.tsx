"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { Empty, ErrorBox, Loading, useToast } from "@/components/ui";
import { useConfirm } from "@/components/Dialog";

const when = (iso: string) => new Date(iso).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Gemeldete Chat-Nachrichten: verwerfen, entfernen oder entfernen und Verfasser sperren. */
export function AdminReports() {
  const toast = useToast();
  const ask = useConfirm();
  const { data, error, reload } = useApi<any>("admin/reports");
  const [busy, setBusy] = useState<number | null>(null);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  async function act(r: any, action: "dismiss" | "remove" | "remove_ban") {
    if (action === "remove_ban" && !(await ask({ title: `${r.author} sperren?`, message: "Die Nachricht wird entfernt und das Konto für 7 Tage gesperrt. Laufende Sitzungen enden sofort.", danger: true, confirmLabel: "Entfernen und sperren" }))) return;
    setBusy(r.post_id);
    try {
      const res = await api<any>(`admin/reports/${r.post_id}`, { body: { action, days: 7 } });
      toast(res.message, "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  if (!data.reports.length) return <div className="card"><Empty>Keine offenen Meldungen.</Empty></div>;
  return (
    <div className="stack">
      {data.reports.map((r: any) => (
        <div key={r.post_id} className="card stack-sm">
          <div className="between">
            <span className="small"><b>{r.author}</b> in <b>{r.league}</b> · {when(r.created_at)}</span>
            <span className={`badge ${r.hidden ? "badge-danger" : "badge-warn"}`}>{r.reports} {r.reports === 1 ? "Meldung" : "Meldungen"}{r.hidden ? " · ausgeblendet" : ""}</span>
          </div>
          <blockquote className="admin-quote">{r.body}</blockquote>
          {r.reasons.length > 0 && <div className="faint small">Gründe: {r.reasons.join(" · ")}</div>}
          <div className="row-wrap" style={{ gap: 8 }}>
            <button className="btn btn-sm" disabled={busy === r.post_id} onClick={() => act(r, "dismiss")}>Verwerfen (wieder anzeigen)</button>
            <button className="btn btn-sm" disabled={busy === r.post_id} onClick={() => act(r, "remove")}>Nachricht entfernen</button>
            {r.account_id && <button className="btn btn-sm btn-danger" disabled={busy === r.post_id} onClick={() => act(r, "remove_ban")}>Entfernen und 7 Tage sperren</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
