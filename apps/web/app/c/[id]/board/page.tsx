"use client";
import { useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { money, seasonLabel } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { ErrorBox, Icon, Loading, Panel, Progress, useToast } from "@/components/ui";
import { PageTip } from "@/components/Onboarding";

const GOAL_ICON: Record<string, string> = { promotion: "up", title: "trophy", position: "target", youth: "youth", finance: "euro", reputation: "star", cup: "trophy" };
const STATUS_TONE: Record<string, string> = { "erfüllt": "badge-accent", "auf Kurs": "badge-accent", "am Anfang": "", "Rückstand": "badge-gold", "in Gefahr": "badge-danger" };

/** Mehrjährige Vorstandsvision mit Fortschritt je Ziel und den bisherigen Bewertungen. */
function VisionPanel({ v, past }: { v: any; past: any[] }) {
  return (
    <Panel title={`Vorstandsvision ${seasonLabel(v.startSeason)} – ${seasonLabel(v.endSeason)}`} icon="target" actions={<span className={`badge ${STATUS_TONE[v.status] ?? ""}`}>{v.status}</span>}>
      <div className="vision-head">
        <b className="vision-title">„{v.headline}“</b>
        <span className="faint small">Jahr {v.year} von {v.years} · {v.met} von {v.goals.length} Zielen erreicht</span>
      </div>
      <div className="vision-years" aria-hidden="true">{Array.from({ length: v.years }).map((_, i) => <span key={i} className={i < v.year - 1 ? "done" : i === v.year - 1 ? "now" : ""} />)}</div>
      <div className="vision-goals">
        {v.goals.map((g: any) => (
          <div key={g.kind} className={`vision-goal ${g.met ? "met" : ""}`}>
            <span className="vision-icon"><Icon name={g.met ? "check" : GOAL_ICON[g.kind] ?? "target"} size={16} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="small" style={{ fontWeight: 600 }}>{g.text}</div>
              {g.kind === "finance" ? <div className="faint small">aktuell {money(g.current)}</div>
                : g.kind === "reputation" ? <div className="faint small">aktuell {g.current}</div>
                : g.kind === "youth" ? <div className="faint small">bisher bestens {g.current} in einer Saison</div>
                : g.kind === "position" && g.current ? <div className="faint small">beste Platzierung bisher: {g.current}.</div> : null}
              {g.kind !== "promotion" && g.kind !== "position" && !g.met && <Progress value={g.progress} />}
            </div>
            {g.met && <span className="badge badge-accent">erreicht</span>}
          </div>
        ))}
      </div>
      {v.reviews.length > 0 && (
        <div className="vision-reviews">
          {[...v.reviews].reverse().map((r: any) => (
            <div key={r.season} className="small"><b className="cond">{seasonLabel(r.season)}</b> {r.text} {r.delta !== 0 && <span className={r.delta > 0 ? "pos-text" : "neg-text"}>({r.delta > 0 ? "+" : ""}{r.delta} Vertrauen)</span>}</div>
          ))}
        </div>
      )}
      {past.length > 0 && (
        <div className="vision-reviews">
          <span className="faint up small">Frühere Visionen</span>
          {past.map((p: any) => (
            <div key={`${p.clubId}-${p.startSeason}`} className="between small" style={{ gap: 8 }}>
              <span className="truncate">{seasonLabel(p.startSeason)} – {seasonLabel(p.endSeason)} · „{p.headline}“</span>
              <span className={`badge ${p.met === p.total ? "badge-accent" : p.met / p.total >= 2 / 3 ? "badge-accent" : p.met > 0 ? "badge-gold" : "badge-danger"}`}>{p.met}/{p.total}</span>
            </div>
          ))}
        </div>
      )}
      <p className="faint small" style={{ marginTop: 8 }}>Neu erreichte Ziele stärken das Vertrauen sofort. Nach {v.years} Jahren zieht der Vorstand Bilanz: Wer mindestens zwei Drittel erfüllt, gewinnt viel Vertrauen – wer nichts erreicht, gerät unter Druck.</p>
    </Panel>
  );
}

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
      <PageTip id="board" title="Der Vorstand">Das Vertrauen orientiert sich an deinem Tabellenplatz im Vergleich zum Saisonziel. Siege und erreichte Ziele der Vision helfen. Ab gutem Vertrauen kannst du Ausbauten und mehr Transferbudget beantragen.</PageTip>
      <div className="page-head">
        <div><h1>Vorstand</h1><p>{data.club.name} · Kontostand {money(data.club.balance)} · Transferbudget {money(data.club.transferBudget)}</p></div>
      </div>
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          {data.vision && <VisionPanel v={data.vision} past={data.visionHistory ?? []} />}
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
            <div className="between small"><span className="faint up">Vertrauen</span><b className="cond" style={{ fontSize: 16 }}>{Math.round(b.confidence)}%</b></div>
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
