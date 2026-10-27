"use client";
import { useApi } from "@/lib/client/api";
import { Empty, ErrorBox, Loading, Panel } from "@/components/ui";

const FEATURE: Record<string, string> = { press: "Pressekonferenz", match: "Spielberichte", assistant: "Co-Trainer", selftest: "Selbsttest" };
const ACTION: Record<string, string> = {
  ban: "Gesperrt", unban: "Sperre aufgehoben", rename: "Name zurückgesetzt", delete: "Konto gelöscht",
  report_dismiss: "Meldung verworfen", report_remove: "Nachricht entfernt", report_remove_ban: "Nachricht entfernt + gesperrt",
};
const fmt = (n: number) => n.toLocaleString("de-CH");
const usd = (n: number) => `$${n.toFixed(2)}`;

/** Kosten der KI-Funktionen (Schätzung nach Listenpreis). */
export function AdminAi() {
  const { data, error } = useApi<any>("admin/ai");
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="admin-tiles">
        <div className="card admin-tile"><span className="label">30 Tage</span><span className="value">{usd(data.total30)}</span><span className="faint small">geschätzt (${data.prices.input} / ${data.prices.output} pro Mio. Tokens)</span></div>
        <div className="card admin-tile"><span className="label">KI eingeschaltet</span><span className="value">{data.enabled}</span><span className="faint small">Konten</span></div>
      </div>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <Panel title="Pro Tag" icon="calendar" flush>
          {data.days.length === 0 ? <Empty>Noch keine Anfragen.</Empty> : (
            <table className="table">
              <thead><tr><th>Tag</th><th className="r">Anfragen</th><th className="r">Ohne Antwort</th><th className="r">Tokens ein/aus</th><th className="r">Kosten</th></tr></thead>
              <tbody>{data.days.map((d: any) => <tr key={d.day}><td>{d.day}</td><td className="r">{d.requests}</td><td className="r">{d.failed || "–"}</td><td className="r small">{fmt(d.tin)} / {fmt(d.tout)}</td><td className="r">{usd(d.costUsd)}</td></tr>)}</tbody>
            </table>
          )}
        </Panel>
        <div className="stack">
          <Panel title="Nach Funktion (30 Tage)" icon="chart" flush>
            <table className="table">
              <tbody>{data.features.map((f: any) => <tr key={f.feature}><td>{FEATURE[f.feature] ?? f.feature}</td><td className="r">{f.requests}</td><td className="r">{usd(f.costUsd)}</td></tr>)}</tbody>
            </table>
          </Panel>
          <Panel title="Grösste Nutzer (7 Tage)" icon="users" flush>
            {data.top.length === 0 ? <Empty>Keine.</Empty> : (
              <table className="table">
                <tbody>{data.top.map((t: any) => <tr key={t.id}><td>{t.display_name}</td><td className="r">{t.requests}</td><td className="r">{usd(t.costUsd)}</td></tr>)}</tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Wer hat wann was getan. */
export function AdminActions() {
  const { data, error } = useApi<any>("admin/actions");
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  if (!data.actions.length) return <div className="card"><Empty>Noch keine Admin-Aktionen.</Empty></div>;
  return (
    <div className="card card-flush table-wrap">
      <table className="table">
        <thead><tr><th>Zeit</th><th>Aktion</th><th>Konto</th><th>Details</th><th>Admin</th></tr></thead>
        <tbody>
          {data.actions.map((x: any) => (
            <tr key={x.id}>
              <td className="small nowrap">{new Date(x.created_at).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
              <td>{ACTION[x.action] ?? x.action}</td>
              <td>{x.display_name ?? <span className="faint">gelöscht</span>}</td>
              <td className="small dim">{x.detail?.reason ?? x.detail?.body ?? (x.detail?.to ? `${x.detail.from} → ${x.detail.to}` : "")}</td>
              <td className="small faint">{x.admin_email}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
