"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useApi } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/format";
import { MobileSubnav, useGame } from "@/components/GameShell";
import { LeaguePicker } from "@/components/LeaguePicker";
import { Crest, ErrorBox, FormChips, Icon, Loading } from "@/components/ui";

function Competition() {
  const { id } = useGame();
  const router = useRouter();
  const params = useSearchParams();
  const leagueParam = params.get("league");
  const { data, error } = useApi<any>(`careers/${id}/competition${leagueParam ? `?league=${leagueParam}` : ""}`);
  const [week, setWeek] = useState<number | null>(null);
  useEffect(() => {
    if (data) setWeek((data.weeks.find((w: any) => w.week >= data.career.week + 1) ?? data.weeks[data.weeks.length - 1])?.week ?? 1);
  }, [data]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const l = data.league;
  const weeks = data.weeks.map((w: any) => w.week);
  const current = data.weeks.find((w: any) => w.week === week) ?? data.weeks[0];
  const go = (leagueId: number) => router.push(`/c/${id}/competition?league=${leagueId}`);

  return (
    <>
      <MobileSubnav section="competition" />
      <div className="page-head">
        <div>
          <h1>{l.name}</h1>
          <p>{data.countries.find((c: any) => c.code === l.countryCode)?.name} · {l.tier}. Liga · {l.size} Vereine · {l.promotion ? `${l.promotion} Aufsteiger · ` : ""}{l.relegation ? `${l.relegation} Absteiger` : "keine Absteiger"}{!l.active && " · vereinfachte Simulation"}</p>
        </div>
        <LeaguePicker countries={data.countries} league={l} onChange={go} />
      </div>
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="card card-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th className="c">#</th><th>Verein</th><th className="c">Sp</th><th className="c">S</th><th className="c">U</th><th className="c">N</th><th className="c">Tore</th><th className="c">Diff</th><th className="c">Pkt</th><th className="hide-sm">Form</th></tr>
              </thead>
              <tbody>
                {data.table.map((r: any) => {
                  const zone = r.position <= (l.tier === 1 ? 1 : l.promotion) ? "zone-promo" : r.position > l.size - l.relegation ? "zone-releg" : r.position === l.playoffUp || r.position === l.playoffDown ? "zone-playoff" : "";
                  return (
                    <tr key={r.clubId} className={`clickable ${zone} ${r.clubId === data.userClubId ? "highlight" : ""}`} onClick={() => router.push(`/c/${id}/club/${r.clubId}`)}>
                      <td className="c num">{r.position}</td>
                      <td><span className="row" style={{ gap: 8 }}><Crest colors={r.club.colors} name={r.club.name} size={18} /><b className="truncate">{r.club.name}</b></span></td>
                      <td className="c num">{r.played}</td>
                      <td className="c num">{r.won}</td>
                      <td className="c num">{r.drawn}</td>
                      <td className="c num">{r.lost}</td>
                      <td className="c num">{r.goalsFor}:{r.goalsAgainst}</td>
                      <td className="c num">{r.goalsFor - r.goalsAgainst > 0 ? "+" : ""}{r.goalsFor - r.goalsAgainst}</td>
                      <td className="c num"><b>{r.points}</b></td>
                      <td className="hide-sm"><FormChips form={r.form} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row small faint" style={{ padding: "10px 14px", gap: 16 }}>
            <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, background: "var(--accent)", borderRadius: 2 }} />{l.tier === 1 ? "Meister" : "Aufstieg"}</span>
            {(l.playoffUp || l.playoffDown) && <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, background: "var(--warn)", borderRadius: 2 }} />Relegation</span>}
            {l.relegation > 0 && <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, background: "var(--neg)", borderRadius: 2 }} />Abstieg</span>}
          </div>
        </div>
        <div className="card stack">
          <div className="between">
            <button className="btn btn-sm btn-ghost" aria-label="Vorheriger Spieltag" disabled={!current || weeks.indexOf(current.week) <= 0} onClick={() => setWeek(weeks[weeks.indexOf(current.week) - 1])}><Icon name="back" size={16} /></button>
            <h3>{current ? `${current.round}. Spieltag` : "–"}{current?.date && <span className="faint" style={{ fontWeight: 500, marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>{fmtDate(current.date)}</span>}</h3>
            <button className="btn btn-sm btn-ghost" aria-label="Nächster Spieltag" disabled={!current || weeks.indexOf(current.week) >= weeks.length - 1} onClick={() => setWeek(weeks[weeks.indexOf(current.week) + 1])} style={{ transform: "scaleX(-1)" }}><Icon name="back" size={16} /></button>
          </div>
          {current?.matches.map((m: any) => {
            const mine = m.home.id === data.userClubId || m.away.id === data.userClubId;
            const inner = (
              <div className="card-soft between small" style={{ padding: "8px 10px", borderColor: mine ? "var(--accent)" : undefined }}>
                <span className="row truncate" style={{ flex: 1, gap: 6 }}><Crest colors={m.home.colors} name={m.home.name} size={14} /><span className="truncate">{m.home.name}</span></span>
                <b className="num" style={{ padding: "0 8px" }}>{m.played ? `${m.homeGoals}:${m.awayGoals}` : "–:–"}</b>
                <span className="row truncate" style={{ flex: 1, gap: 6, justifyContent: "flex-end" }}><span className="truncate">{m.away.name}</span><Crest colors={m.away.colors} name={m.away.name} size={14} /></span>
              </div>
            );
            return m.played && l.active ? <Link key={m.id} href={`/c/${id}/report/${m.id}`}>{inner}</Link> : <div key={m.id}>{inner}</div>;
          })}
          {!current && <p className="faint">Kein Spielplan.</p>}
        </div>
      </div>
    </>
  );
}

export default function CompetitionPage() {
  return <Suspense fallback={<Loading />}><Competition /></Suspense>;
}
