"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { MatchRow } from "@/components/NationalMatchRow";
import { NationBadge } from "@/components/NationBadge";
import { Empty, ErrorBox, EventIcon, Loading, Modal, Panel } from "@/components/ui";

export default function NationalMatchesPage() {
  return <Suspense fallback={<Loading />}><Matches /></Suspense>;
}

function Matches() {
  const { id } = useGame();
  const params = useSearchParams();
  const base = `/c/${id}`;
  const { data, error } = useApi<any>(`careers/${id}/national`);
  const [report, setReport] = useState<any | null>(null);
  const open = async (mid: number) => setReport(await api<any>(`careers/${id}/national/matches/${mid}`));
  useEffect(() => {
    const m = params.get("m");
    if (m) open(Number(m)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  if (!data.coach) return <div className="card"><Empty>Du betreust keine Nationalmannschaft.</Empty></div>;
  const own = data.nation.code;
  const clickable = (m: any) => (m.hasReport ? <div key={m.id} role="button" tabIndex={0} className="clickable" onClick={() => open(m.id)} onKeyDown={(e) => e.key === "Enter" && open(m.id)}><MatchRow m={{ ...m, hasReport: false }} own={own} base={base} /></div> : <MatchRow key={m.id} m={m} own={own} base={base} />);

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ gap: 12 }}>
          <NationBadge code={own} colors={data.nation.colors} size={36} />
          <div><h1>Länderspiele</h1><p>{data.nation.name} · {data.record.p} Spiele, Bilanz {data.record.w}-{data.record.d}-{data.record.l} · Klick auf ein Spiel öffnet den Bericht</p></div>
        </div>
      </div>
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Ergebnisse" icon="ball" flush>{data.results.length === 0 ? <Empty>Noch keine Länderspiele.</Empty> : data.results.map(clickable)}</Panel>
          {data.upcoming.length > 0 && <Panel title="Anstehend" icon="calendar" flush>{data.upcoming.map((m: any) => <MatchRow key={m.id} m={m} own={own} base={base} />)}</Panel>}
        </div>
        <div className="stack">
          {data.lastTournament && (
            <Panel title={data.lastTournament.matches[0]?.stage.split(" · ")[0] ?? "Endrunde"} icon="trophy" flush>
              {data.lastTournament.matches.filter((m: any) => m.user || !m.stage.includes("Gruppe")).map((m: any) => (
                <div key={m.id} className="nat-match small">
                  <span className="faint truncate" style={{ width: 90 }}>{m.stage.split(" · ")[1]}</span>
                  <span className={`truncate ${m.home.code === own ? "nat-own" : ""}`} style={{ flex: 1, textAlign: "right" }}>{m.home.name}</span>
                  <span className="nat-score">{m.homeGoals}:{m.awayGoals}{m.penHome !== null ? "*" : ""}</span>
                  <span className={`truncate ${m.away.code === own ? "nat-own" : ""}`} style={{ flex: 1 }}>{m.away.name}</span>
                </div>
              ))}
              <div className="faint small" style={{ padding: "6px 14px" }}>* nach Elfmeterschiessen</div>
            </Panel>
          )}
          {data.qualMatches.length > 0 && (
            <Panel title="Qualifikation: alle Spiele der Gruppe" icon="calendar" flush>
              {data.qualMatches.map((m: any) => (
                <div key={m.id} className="nat-match small">
                  <span className="faint" style={{ width: 56 }}>{fmtDate(m.date, { year: false })}</span>
                  <span className={`truncate ${m.home.code === own ? "nat-own" : ""}`} style={{ flex: 1, textAlign: "right" }}>{m.home.name}</span>
                  <span className="nat-score">{m.played ? `${m.homeGoals}:${m.awayGoals}` : "–:–"}</span>
                  <span className={`truncate ${m.away.code === own ? "nat-own" : ""}`} style={{ flex: 1 }}>{m.away.name}</span>
                </div>
              ))}
            </Panel>
          )}
        </div>
      </div>

      <Modal open={!!report} onClose={() => setReport(null)} wide>
        {report && <Report r={report} />}
      </Modal>
    </>
  );
}

function Report({ r }: { r: any }) {
  const d = r.data;
  const lines = (side: 0 | 1) => (d?.players ?? []).filter((p: any) => p.side === side).sort((a: any, b: any) => Number(b.started) - Number(a.started) || b.minutes - a.minutes);
  return (
    <div className="stack">
      <div className="faint small up">{r.stage} · {fmtDate(r.date)}</div>
      <div className="row" style={{ justifyContent: "center", gap: 18 }}>
        <span className="row" style={{ gap: 8 }}><b style={{ fontSize: 20 }}>{r.home.name}</b><NationBadge code={r.home.code} colors={r.home.colors} size={30} /></span>
        <span className="cond" style={{ fontSize: 34, fontWeight: 700 }}>{r.homeGoals}:{r.awayGoals}</span>
        <span className="row" style={{ gap: 8 }}><NationBadge code={r.away.code} colors={r.away.colors} size={30} /><b style={{ fontSize: 20 }}>{r.away.name}</b></span>
      </div>
      {r.penHome !== null && <div className="c dim">Elfmeterschiessen {r.penHome}:{r.penAway}</div>}
      {d ? (
        <>
          <div className="stack-sm">
            {d.events.filter((e: any) => ["goal", "penalty_goal", "own_goal", "red", "penalty_miss"].includes(e.type)).map((e: any, i: number) => (
              <div key={i} className="row small" style={{ gap: 8 }}><span className="cond faint" style={{ width: 34 }}>{e.minute}&apos;</span><EventIcon type={e.type} /><span>{e.text}</span></div>
            ))}
          </div>
          <div className="grid grid-2" style={{ gap: 16 }}>
            {[0, 1].map((side) => (
              <table key={side} className="table">
                <thead><tr><th>{side === 0 ? r.home.name : r.away.name}</th><th className="c">Min</th><th className="c">Note</th></tr></thead>
                <tbody>
                  {lines(side as 0 | 1).map((p: any) => (
                    <tr key={p.playerId}><td className="truncate">{p.name}{p.goals ? <span className="faint small"> · {p.goals} T</span> : null}{p.playerId === d.motm ? <span className="badge badge-gold" style={{ marginLeft: 6 }}>Bester Spieler</span> : null}</td><td className="c">{p.minutes}</td><td className="c cond" style={{ fontWeight: 700 }}>{p.rating.toFixed(1)}</td></tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </>
      ) : <p className="dim">Für dieses Spiel liegt kein Bericht vor.</p>}
    </div>
  );
}
