"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/client/api";
import { seasonLabel } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Empty, ErrorBox, Crest, Loading, Panel, Seg } from "@/components/ui";
import { Kpi, LegendCard, MatchMarks, RecordList, TransferRecords, TrophyShelf } from "@/components/History";

type Tab = "seasons" | "records" | "legends" | "coaches";

function Place({ s }: { s: any }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <b className="cond">{s.position}.</b>
      {s.champion && <span className="badge badge-gold">Meister</span>}
      {s.promoted && !s.champion && <span className="badge badge-accent">Aufstieg</span>}
      {s.relegated && <span className="badge badge-danger">Abstieg</span>}
    </span>
  );
}

/**
 * Platzierungsverlauf: Linie über alle Saisons. Jede Liga-Stufe hat ein eigenes
 * Band (höhere Liga = weiter oben); die Breite folgt dem Container, damit die
 * Beschriftung auch auf dem Smartphone lesbar bleibt.
 */
function PositionTrend({ seasons }: { seasons: any[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const rows = [...seasons].reverse();
  if (rows.length < 2) return null;
  const BAND = 20;
  const H = 160, L = 30, R = 14, T = 14, B = 24;
  const rank = (s: any) => (s.tier - 1) * BAND + s.position;
  const tiers = [...new Set(rows.map((s) => s.tier))].sort((a, b) => a - b);
  const lo = (tiers[0] - 1) * BAND + 1;
  const hi = Math.max(lo + 3, ...rows.map(rank));
  const x = (i: number) => L + (i / (rows.length - 1)) * (W - L - R);
  const y = (v: number) => T + ((v - lo) / (hi - lo)) * (H - T - B);
  const d = rows.map((s, i) => `${i ? "L" : "M"}${x(i)},${y(rank(s))}`).join(" ");
  const leagueOf = (t: number) => rows.find((s) => s.tier === t)?.league ?? "";
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="chart-svg" role="img" aria-label="Platzierungsverlauf über die Saisons">
        {tiers.map((t) => {
          const top = (t - 1) * BAND + 1;
          return (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(top)} y2={y(top)} className="chart-grid" />
              <text x={L - 6} y={y(top) + 4} className="chart-axis" textAnchor="end">1.</text>
              {tiers.length > 1 && <text x={W - R} y={y(top) - 4} className="chart-axis" textAnchor="end">{leagueOf(t)}</text>}
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(hi)} y2={y(hi)} className="chart-grid" />
        <text x={L - 6} y={y(hi) + 4} className="chart-axis" textAnchor="end">{hi - (Math.ceil(hi / BAND) - 1) * BAND}.</text>
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {rows.map((s, i) => (
          <g key={s.season}>
            <circle cx={x(i)} cy={y(rank(s))} r={s.champion ? 6 : 4.5} fill={s.champion ? "var(--gold)" : "var(--accent)"} className="chart-ring"><title>{`${seasonLabel(s.season)}: ${s.position}. ${s.league}`}</title></circle>
            {(rows.length <= 8 || i % Math.ceil(rows.length / 8) === 0 || i === rows.length - 1) && (
              <text x={x(i)} y={H - 6} className="chart-axis" textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}>{seasonLabel(s.season)}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function HistoryPage() {
  const { id } = useGame();
  const club = useSearchParams().get("club");
  const { data, error } = useApi<any>(`careers/${id}/history${club ? `?club=${club}` : ""}`);
  const [tab, setTab] = useState<Tab>("seasons");
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const base = `/c/${id}`;
  const s = data.summary;
  const r = data.records;

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <Crest colors={data.club.colors} name={data.club.name} size={44} />
          <div>
            <h1>Vereinsgeschichte</h1>
            <p>{data.club.own ? data.club.name : <Link href={`${base}/club/${data.club.id}`}>{data.club.name}</Link>} · gegründet {data.club.founded} · {data.club.city}</p>
          </div>
        </div>
      </div>

      <div className="card hist-kpis">
        <Kpi label="Meistertitel" value={s.titles} sub={s.lowerTitles ? `+ ${s.lowerTitles} in unteren Ligen` : undefined} />
        <Kpi label="Pokalsiege" value={s.cups} sub={s.finals ? (s.finals === 1 ? "1 weiteres Finale" : `${s.finals} weitere Finals`) : undefined} />
        <Kpi label="Internationale Titel" value={s.continental} />
        <Kpi label="Aufstiege" value={s.promotions} sub={s.relegations ? (s.relegations === 1 ? "1 Abstieg" : `${s.relegations} Abstiege`) : undefined} />
        <Kpi label="Beste Saison" value={s.bestSeason ? `${s.bestSeason.position}.` : "–"} sub={s.bestSeason ? `${s.bestSeason.league} ${seasonLabel(s.bestSeason.season)}` : "noch keine abgeschlossene Saison"} />
        <Kpi label="Saisons im Archiv" value={s.seasons} />
      </div>

      <Panel title="Trophäenschrank" icon="trophy">
        <TrophyShelf items={data.honours} empty="Noch keine Titel – jede Saison ist eine neue Chance." />
      </Panel>

      <Seg value={tab} onChange={setTab} options={[
        { value: "seasons", label: "Saisons" }, { value: "records", label: "Rekorde" },
        { value: "legends", label: `Legenden (${data.legends.length})` }, { value: "coaches", label: "Trainer" },
      ]} />

      {tab === "seasons" && (
        data.seasons.length === 0 ? <Empty>Die erste Saison wird nach dem letzten Spieltag hier archiviert.</Empty> : (
          <>
            <Panel title="Platzierungsverlauf" icon="chart"><PositionTrend seasons={data.seasons} /></Panel>
            <div className="card card-flush table-wrap">
              <table className="table">
                <thead><tr><th>Saison</th><th>Liga</th><th>Platz</th><th className="c hide-sm">S-U-N</th><th className="c">Tore</th><th className="c">Pkt</th><th className="hide-sm">Pokal</th><th className="hide-sm">Bester Torschütze</th><th className="hide-sm">Trainer</th></tr></thead>
                <tbody>
                  {data.seasons.map((x: any) => (
                    <tr key={x.season} className={x.champion ? "highlight" : ""}>
                      <td className="cond nowrap">{seasonLabel(x.season)}</td>
                      <td className="truncate" style={{ maxWidth: 160 }}>{x.league}</td>
                      <td><Place s={x} /></td>
                      <td className="c num hide-sm">{x.won}-{x.drawn}-{x.lost}</td>
                      <td className="c num">{x.gf}:{x.ga}</td>
                      <td className="c num"><b>{x.points}</b></td>
                      <td className="small hide-sm">{[x.cup, x.continental && `Int.: ${x.continental}`].filter(Boolean).join(" · ") || "–"}</td>
                      <td className="small hide-sm">{x.topScorer ? `${x.topScorer.name} (${x.topScorer.goals})` : "–"}</td>
                      <td className="small hide-sm">{x.manager}{x.you && <span className="badge badge-accent" style={{ marginLeft: 6 }}>du</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {tab === "records" && (
        <div className="record-grid">
          <RecordList title="Rekordspieler" rows={r.apps} value={(x) => x.apps} unit="Spiele" base={base} />
          <RecordList title="Rekordtorschützen" rows={r.goals} value={(x) => x.goals} unit="Tore" base={base} />
          <RecordList title="Meiste Vorlagen" rows={r.assists} value={(x) => x.assists} unit="Vorl." base={base} />
          <div className="record-list">
            <div className="record-head">Beste Torschützen einer Saison</div>
            {r.seasonGoals.length === 0 && <p className="faint small" style={{ padding: "8px 12px" }}>Noch keine abgeschlossene Saison.</p>}
            <ol>
              {r.seasonGoals.map((g: any, i: number) => (
                <li key={i}><span className="rank cond">{i + 1}</span><Link href={`${base}/player/${g.playerId}`} className="name truncate">{g.name}</Link><span className="faint small">{seasonLabel(g.season)}</span><b className="cond val">{g.goals}<small> Tore</small></b></li>
              ))}
            </ol>
          </div>
          <TransferRecords title="Rekordzugänge" rows={r.buys} base={base} />
          <TransferRecords title="Rekordabgänge" rows={r.sales} base={base} />
          <MatchMarks title="Höchste Siege" rows={r.wins} tone="pos" />
          <MatchMarks title="Höchste Niederlagen" rows={r.losses} tone="neg" />
        </div>
      )}

      {tab === "legends" && (
        <>
          <p className="faint small">Vereinslegende wird, wer mindestens {data.legendRule.apps} Pflichtspiele oder {data.legendRule.goals} Tore für den Verein erreicht – oder {data.legendRule.seasons} Saisons mit 100 Spielen bleibt.</p>
          {data.legends.length === 0 ? <Empty>Noch keine Vereinslegenden. Wer lange bleibt und liefert, wird hier verewigt.</Empty> : (
            <div className="legend-grid">{data.legends.map((l: any) => <LegendCard key={l.playerId} l={l} base={base} />)}</div>
          )}
        </>
      )}

      {tab === "coaches" && (
        <div className="card card-flush table-wrap">
          <table className="table">
            <thead><tr><th>Trainer</th><th>Zeitraum</th><th className="c">Saisons</th><th className="c">Spiele</th><th className="c">S-U-N</th><th className="c">Siegquote</th><th className="c">Titel</th></tr></thead>
            <tbody>
              {data.coaches.map((c: any, i: number) => (
                <tr key={i} className={c.you ? "highlight" : ""}>
                  <td><b>{c.name}</b>{c.you && <span className="badge badge-accent" style={{ marginLeft: 6 }}>du</span>}{c.current && <span className="badge" style={{ marginLeft: 6 }}>aktuell</span>}</td>
                  <td className="cond nowrap">{seasonLabel(c.from)}{c.to !== c.from || c.current ? ` – ${c.current ? "heute" : seasonLabel(c.to)}` : ""}</td>
                  <td className="c num">{c.seasons}</td>
                  <td className="c num">{c.played}</td>
                  <td className="c num">{c.won}-{c.drawn}-{c.lost}</td>
                  <td className="c num">{c.played ? `${Math.round((c.won / c.played) * 100)} %` : "–"}</td>
                  <td className="c num">{c.titles || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
