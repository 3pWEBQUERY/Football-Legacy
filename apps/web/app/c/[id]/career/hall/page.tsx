"use client";
import Link from "next/link";
import { useApi } from "@/lib/client/api";
import { seasonLabel } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Empty, ErrorBox, Icon, Loading, Nat, Panel, Pos, Progress } from "@/components/ui";
import { Kpi, LegendCard, TrophyShelf } from "@/components/History";

function PlayerTable({ rows, base, retired }: { rows: any[]; base: string; retired?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>#</th><th>Spieler</th><th className="hide-sm">Prägender Verein</th><th className="c">Spiele</th><th className="c">Tore</th><th className="c hide-sm">Vorl.</th><th className="c hide-sm">Top-Stärke</th>{retired && <th className="c hide-sm">Ende</th>}</tr></thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.playerId}>
              <td className="cond">{i + 1}</td>
              <td><span className="row" style={{ gap: 6 }}><Pos p={p.position} /><Nat code={p.nationality} /><Link href={`${base}/player/${p.playerId}`} className="name truncate">{p.name}</Link></span></td>
              <td className="small hide-sm">{p.clubId ? <Link href={`${base}/history?club=${p.clubId}`}>{p.club}</Link> : "–"}{p.clubs > 1 && <span className="faint"> +{p.clubs - 1}</span>}</td>
              <td className="c num">{p.apps}</td>
              <td className="c num">{p.goals}</td>
              <td className="c num hide-sm">{p.assists}</td>
              <td className="c num hide-sm">{p.peak}</td>
              {retired && <td className="c cond hide-sm">{seasonLabel(p.retired)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HallOfFamePage() {
  const { id } = useGame();
  const { data, error } = useApi<any>(`careers/${id}/hall-of-fame`);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const base = `/c/${id}`;
  const m = data.manager;
  const level = m.levels[m.levelIndex];
  const from = level.min;
  const to = m.next?.min ?? from;

  return (
    <>
      <div className="page-head">
        <div><h1>Ruhmeshalle</h1><p>Dein Vermächtnis und die grössten Spieler deiner Fussballwelt</p></div>
      </div>

      <div className="card legacy-card">
        <div className="legacy-medal" data-level={m.levelIndex}><Icon name="trophy" size={30} /></div>
        <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
          <div className="between" style={{ flexWrap: "wrap", gap: 8 }}>
            <div><span className="faint up small">Vermächtnis von {m.name}</span><h2>{level.name}</h2><span className="dim small">{level.text}</span></div>
            <span className="stack-sm" style={{ alignItems: "flex-end", gap: 2 }}>
              <b className="cond legacy-points">{m.points.toLocaleString("de-CH")} <small>Punkte</small></b>
              {m.difficulty.factor !== 1 && <span className="faint small">Schwierigkeit {m.difficulty.label}: ×{String(m.difficulty.factor).replace(".", ",")}</span>}
            </span>
          </div>
          {m.next ? (
            <>
              <Progress value={m.points - from} max={to - from} />
              <span className="faint small">Noch {m.next.missing.toLocaleString("de-CH")} Punkte bis „{m.next.name}“. Titel bringen am meisten: Meisterschaft 250, internationaler Titel 400, Pokal 120, Aufstieg 90 – dazu 25 je Saison und 2 je Sieg.</span>
            </>
          ) : <span className="pos-text small">Höchste Stufe erreicht.</span>}
          <div className="legacy-ladder">
            {m.levels.map((l: any, i: number) => <span key={l.name} className={i <= m.levelIndex ? "on" : ""} title={`ab ${l.min} Punkten`}>{l.name}</span>)}
          </div>
        </div>
      </div>

      <div className="card hist-kpis">
        <Kpi label="Saisons" value={m.totals.seasons} sub={`${m.totals.matches} Spiele`} />
        <Kpi label="Siegquote" value={m.totals.matches ? `${m.winRate} %` : "–"} sub={`${m.totals.wins} S · ${m.totals.draws} U · ${m.totals.losses} N`} />
        <Kpi label="Meistertitel" value={m.totals.titles} />
        <Kpi label="Pokalsiege" value={m.totals.cups} sub={m.totals.continental ? `+ ${m.totals.continental} international` : undefined} />
        <Kpi label="Aufstiege" value={m.totals.promotions} />
        <Kpi label="Ruf" value={`${m.reputation}/100`} />
      </div>

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Trophäenschrank" icon="trophy">
            <TrophyShelf items={data.trophies} empty="Noch keine Trophäen. Der erste Titel ist der wichtigste." />
          </Panel>
          <Panel title="Legenden im Ruhestand" icon="star" flush>
            {data.legends.length ? <PlayerTable rows={data.legends} base={base} retired /> : <div style={{ padding: 14 }}><Empty>Noch hat sich keine grosse Karriere vollendet.</Empty></div>}
            <p className="faint small" style={{ padding: "8px 14px" }}>Aufgenommen wird, wer nach dem Karriereende mindestens {data.hallRule.apps} Spiele, {data.hallRule.goals} Tore oder eine Top-Stärke von {data.hallRule.peak} bei {data.hallRule.peakApps} Spielen erreicht hat (gezählt ab Beginn deiner Karriere).</p>
          </Panel>
          <Panel title="Aktive Rekordspieler" icon="fire" flush>
            {data.active.length ? <PlayerTable rows={data.active} base={base} /> : <div style={{ padding: 14 }}><Empty>Die Bilanzen werden am Saisonende fortgeschrieben.</Empty></div>}
          </Panel>
        </div>
        <div className="stack">
          <Panel title="Stationen" icon="flag">
            {data.stations.length === 0 && <p className="faint small">Noch keine abgeschlossene Saison.</p>}
            {data.stations.map((s: any, i: number) => (
              <div key={i} className="station">
                <div className="between"><b>{s.club}</b><span className="cond faint">{seasonLabel(s.from)}{s.to !== s.from ? ` – ${seasonLabel(s.to)}` : ""}</span></div>
                <div className="faint small">{s.league} · {s.seasons} {s.seasons === 1 ? "Saison" : "Saisons"} · beste Platzierung {s.best}.{s.titles ? ` · ${s.titles}× Meister` : ""}{s.promotions ? ` · ${s.promotions}× Aufstieg` : ""}</div>
              </div>
            ))}
          </Panel>
          {data.farewells.players.length > 0 && (
            <Panel title={`Abschiede ${seasonLabel(data.farewells.season)}`} icon="users">
              <div className="stack-sm">{data.farewells.players.map((p: any) => <LegendCard key={p.playerId} l={p} base={base} sub={`${p.club ?? "–"} · ${p.seasons} Saisons`} />)}</div>
            </Panel>
          )}
          <Panel title="Rekordmeister" icon="shield">
            {data.champions.length === 0 && <p className="faint small">Noch keine abgeschlossene Saison.</p>}
            {data.champions.map((c: any) => (
              <div key={c.club_id} className="between small" style={{ padding: "4px 0" }}>
                <Link href={`${base}/history?club=${c.club_id}`} className="truncate"><Nat code={c.country} /> <b>{c.name}</b> <span className="faint">{c.league}</span></Link>
                <span className="badge badge-gold">{c.titles}× · zuletzt {seasonLabel(c.last)}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </>
  );
}
