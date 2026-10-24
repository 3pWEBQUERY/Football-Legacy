"use client";
import { useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { ErrorBox, Icon, Loading, Panel, Progress, useToast } from "@/components/ui";

function Level({ value }: { value: number }) {
  return <span className="level-bar">{Array.from({ length: 5 }).map((_, i) => <span key={i} className={i < value ? "on" : ""} />)}</span>;
}

export default function BoardPage() {
  const { id } = useGame();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`careers/${id}/boardroom`);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Record<string, any>>({});
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const b = data.board;

  async function request(kind: string) {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${id}/boardroom`, { body: { kind } });
      setAnswer({ ...answer, [kind]: r });
      toast(r.message, r.status === "approved" ? "success" : "info");
      reload();
      refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Vorstand</h1><p>{data.club.name} · Kontostand {money(data.club.balance)} · Transferbudget {money(data.club.transferBudget)}</p></div>
      </div>
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Anfragen an den Vorstand" icon="board" flush>
            {data.offers.map((o: any) => (
              <div key={o.kind} className="request-row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="name">{o.title}</div>
                  <div className="dim small">{o.description}</div>
                  <div className="faint small" style={{ marginTop: 4 }}>
                    {o.kind === "budget" ? "Keine Kosten für den Verein, das Geld kommt aus dem Vermögen." : `Kosten ${money(o.cost)} · Bauzeit ${o.days} Tage`}
                  </div>
                  {!o.available && o.reason && <div className="small" style={{ color: "var(--warn)", marginTop: 4 }}>{o.reason}</div>}
                  {answer[o.kind] && <div className="small" style={{ color: answer[o.kind].status === "approved" ? "var(--pos)" : "var(--neg)", marginTop: 4 }}>{answer[o.kind].message}</div>}
                </div>
                <button className={`btn ${o.available ? "btn-primary" : ""}`} disabled={busy} onClick={() => request(o.kind)}>Anfragen</button>
              </div>
            ))}
          </Panel>
          {data.projects.length > 0 && (
            <Panel title="Laufende Bauprojekte" icon="stadium" flush>
              <table className="table">
                <tbody>
                  {data.projects.map((p: any, i: number) => (
                    <tr key={i}>
                      <td className="name">{p.label}</td>
                      <td className="dim">Fertig am {p.doneLabel}</td>
                      <td className="r cond" style={{ fontWeight: 700 }}>noch {p.daysLeft} Tage</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
        <div className="stack">
          <Panel title="Saisonziel" icon="target">
            <p style={{ fontWeight: 600, marginBottom: 10 }}>{b.objective}</p>
            <div className="between small"><span className="faint up">Vertrauen</span><b className="cond" style={{ fontSize: 16 }}>{b.confidence}%</b></div>
            <Progress value={b.confidence} tone={b.confidence < 35 ? "danger" : b.confidence < 55 ? "warn" : undefined} />
            <div className="kv" style={{ marginTop: 8 }}><span className="k">Kontostand mindestens</span><span className="v">{money(b.financeTarget)}</span></div>
          </Panel>
          <Panel title="Anlagen" icon="stadium">
            <div className="kv"><span className="k">Trainingszentrum</span><span className="v"><Level value={data.facilities.training.level} /></span></div>
            <div className="faint small" style={{ marginBottom: 8 }}>{data.facilities.training.label}</div>
            <div className="kv"><span className="k">Jugendakademie</span><span className="v"><Level value={data.facilities.youth.level} /></span></div>
            <div className="faint small" style={{ marginBottom: 8 }}>{data.facilities.youth.label}</div>
            <div className="kv"><span className="k">Stadion</span><span className="v">{data.club.capacity.toLocaleString("de-CH")} Plätze</span></div>
          </Panel>
          <div className="card small dim"><Icon name="info" size={14} /> Abgelehnte Anfragen kannst du nach zwei Wochen erneut stellen. Das Vertrauen des Vorstands steigt mit Siegen und erreichten Zielen.</div>
        </div>
      </div>
    </>
  );
}
