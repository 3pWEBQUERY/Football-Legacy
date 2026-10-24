"use client";
import Link from "next/link";
import { useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { useGame } from "@/components/GameShell";
import { NationBadge } from "@/components/NationBadge";
import { MatchRow } from "@/components/NationalMatchRow";
import { Empty, ErrorBox, Icon, Loading, Panel, useToast } from "@/components/ui";

const CONFED: Record<string, string> = { UEFA: "Europa", CONMEBOL: "Südamerika", CONCACAF: "Nord- und Mittelamerika", AFC: "Asien", CAF: "Afrika", OFC: "Ozeanien" };

export default function NationalPage() {
  const { id } = useGame();
  const toast = useToast();
  const base = `/c/${id}`;
  const { data, error, reload } = useApi<any>(`careers/${id}/national`);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  async function act(path: string, body: unknown, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    try {
      const r = await api<any>(`careers/${id}/${path}`, { body });
      toast(r.message, "success");
      reload();
      refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!data.coach) {
    const j = data.jobs;
    return (
      <>
        <div className="page-head">
          <div><h1>Nationalmannschaft</h1><p>Übernimm zusätzlich zu deinem Verein eine Nationalmannschaft · Dein Manager-Ruf: <b>{j.reputation}</b></p></div>
        </div>
        <div className="grid grid-main" style={{ alignItems: "start" }}>
          <section className="card card-flush">
            <div className="card-head"><h3>Offene Posten</h3><span className="faint small">Je stärker die Nation, desto höher der nötige Ruf</span></div>
            {j.jobs.length === 0 ? <Empty>Für deinen Ruf ist derzeit kein Verband interessiert.</Empty> : (
              <table className="table">
                <thead><tr><th>Nation</th><th>Verband</th><th className="c">Stärke</th><th className="c">Nötiger Ruf</th><th className="r" /></tr></thead>
                <tbody>
                  {j.jobs.map((n: any) => (
                    <tr key={n.code}>
                      <td><span className="row" style={{ gap: 10 }}><NationBadge code={n.code} colors={n.colors ?? { primary: "#39424f", secondary: "#d6d9de" }} size={20} /><b>{n.name}</b>{n.home && <span className="badge">Heimatland</span>}</span></td>
                      <td className="dim">{CONFED[n.confed]}</td>
                      <td className="c cond" style={{ fontWeight: 700 }}>{n.rating}</td>
                      <td className="c" style={{ color: n.available ? "var(--pos)" : "var(--text-3)", fontWeight: 600 }}>{n.required}</td>
                      <td className="r">
                        {n.available
                          ? <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act("national/job", { code: n.code }, `Nationaltrainer von ${n.name} werden?`)}>Übernehmen</button>
                          : <span className="faint small">Ruf zu gering</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <div className="card-soft small dim">
            Als Nationaltrainer nominierst du in den Länderspielpausen (September, Oktober, November, März) deinen Kader aus allen Spielern der Nation,
            spielst die Qualifikation und am Saisonende die Endrunde – abwechselnd Weltmeisterschaft und Kontinentalmeisterschaft. Den Ruf steigerst du mit Erfolgen im Verein.
          </div>
        </div>
      </>
    );
  }

  const n = data.nation;
  return (
    <>
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <NationBadge code={n.code} colors={n.colors} size={44} />
          <div><h1>{n.name}</h1><p>Nationaltrainer seit {data.since} · {CONFED[n.confed]} · Stärke {n.rating}</p></div>
        </div>
        <div className="row">
          <Link href={`${base}/national/squad`} className="btn btn-primary"><Icon name="users" size={15} /> Kader nominieren</Link>
          <button className="btn btn-danger" disabled={busy} onClick={() => act("national/resign", {}, "Als Nationaltrainer zurücktreten? Das kostet etwas Ruf.")}>Zurücktreten</button>
        </div>
      </div>
      <div className="card dyn-kpis">
        <div className="stat"><span className="label">Ziel des Verbands</span><span className="value" style={{ fontSize: 18 }}>{data.objective.text}</span></div>
        <div className="stat"><span className="label">{data.tournament}</span><span className="value" style={{ fontSize: 18, color: data.qualified ? "var(--pos)" : undefined }}>{data.qualified ? "Qualifiziert" : data.groupPos ? `Gruppenplatz ${data.groupPos}` : "Qualifikation läuft"}</span></div>
        <div className="stat"><span className="label">Nächste Länderspielpause</span><span className="value" style={{ fontSize: 18 }}>{data.nextWindow ? data.nextWindow.label : "Nach Saisonende"}</span>{data.nextWindow && <span className="faint small">Kader ({data.squadSize}/23) bis {data.nextWindow.deadline} nominieren</span>}</div>
        <div className="stat"><span className="label">Bilanz</span><span className="value">{data.record.w}-{data.record.d}-{data.record.l}</span><span className="faint small">{data.record.p} Länderspiele</span></div>
      </div>
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Nächste Spiele" icon="calendar" flush>
            {data.upcoming.length === 0 ? <Empty>Keine Spiele angesetzt. Testspiele werden zu Beginn der Länderspielpause vereinbart.</Empty> : data.upcoming.map((m: any) => <MatchRow key={m.id} m={m} own={n.code} base={base} />)}
          </Panel>
          <Panel title="Letzte Ergebnisse" icon="ball" flush actions={<Link href={`${base}/national/matches`} className="btn btn-ghost btn-sm">Alle Spiele</Link>}>
            {data.results.length === 0 ? <Empty>Noch keine Länderspiele.</Empty> : data.results.slice(0, 8).map((m: any) => <MatchRow key={m.id} m={m} own={n.code} base={base} />)}
          </Panel>
        </div>
        <div className="stack">
          {data.group && (
            <Panel title={data.group.name} icon="trophy" flush>
              <table className="table">
                <thead><tr><th>#</th><th>Nation</th><th className="c">Sp</th><th className="c">Tore</th><th className="c">Pkt</th></tr></thead>
                <tbody>
                  {data.group.table.map((r: any, i: number) => (
                    <tr key={r.code} className={r.own ? "highlight" : ""}>
                      <td className="c">{i + 1}</td>
                      <td><span className="row" style={{ gap: 8 }}><NationBadge code={r.code} colors={r.colors} size={16} />{r.name}</span></td>
                      <td className="c">{r.played}</td>
                      <td className="c">{r.gf}:{r.ga}</td>
                      <td className="c"><b>{r.points}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="faint small" style={{ padding: "8px 14px" }}>Platz 1 qualifiziert sich direkt, Platz 2 spielt im März die Playoffs.</div>
            </Panel>
          )}
          <Panel title="Bilanz als Nationaltrainer" icon="star">
            {data.history.length === 0 ? <p className="dim small" style={{ margin: 0 }}>Noch keine abgeschlossenen Wettbewerbe.</p> : data.history.map((h: any, i: number) => (
              <div key={i} className="kv"><span className="k">{h.season}/{String(h.season + 1).slice(2)}</span><span className="v">{h.text}</span></div>
            ))}
          </Panel>
        </div>
      </div>
    </>
  );
}
