"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useApi } from "@/lib/client/api";
import { MobileSubnav, useGame } from "@/components/GameShell";
import { LeaguePicker } from "@/components/LeaguePicker";
import { Empty, ErrorBox, Loading, Pos, SortTable } from "@/components/ui";

function Stats() {
  const { id } = useGame();
  const router = useRouter();
  const params = useSearchParams();
  const league = params.get("league");
  const { data, error } = useApi<any>(`careers/${id}/competition${league ? `?league=${league}` : ""}`);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <MobileSubnav section="competition" />
      <div className="page-head">
        <div><h1>Statistiken</h1><p>{data.league.name}</p></div>
        <LeaguePicker countries={data.countries} league={data.league} onChange={(l) => router.push(`/c/${id}/competition/stats?league=${l}`)} />
      </div>
      {!data.league.active ? (
        <div className="card"><Empty>Spielerstatistiken gibt es nur für detailliert simulierte Ligen. Nimm das Land ins Scouting-Netzwerk auf.</Empty></div>
      ) : (
        <div className="card card-flush">
          <SortTable
            rows={data.scorers}
            rowKey={(r: any) => r.id}
            initialSort={{ key: "goals", dir: -1 }}
            onRowClick={(r: any) => router.push(`/c/${id}/player/${r.id}`)}
            columns={[
              { key: "pos", label: "Pos", render: (r: any) => <Pos p={r.position} /> },
              { key: "name", label: "Spieler", render: (r: any) => <b>{r.name}</b>, sort: (r: any) => r.name },
              { key: "club", label: "Verein", render: (r: any) => <span className="dim">{r.club}</span>, sort: (r: any) => r.club },
              { key: "apps", label: "Spiele", render: (r: any) => r.apps, sort: (r: any) => r.apps, className: "c" },
              { key: "goals", label: "Tore", render: (r: any) => <b>{r.goals}</b>, sort: (r: any) => r.goals, className: "c" },
              { key: "assists", label: "Vorlagen", render: (r: any) => r.assists, sort: (r: any) => r.assists, className: "c" },
              { key: "sc", label: "Scorer", render: (r: any) => r.goals + r.assists, sort: (r: any) => r.goals + r.assists, className: "c" },
              { key: "avg", label: "Ø Note", render: (r: any) => r.avgRating.toFixed(2), sort: (r: any) => r.avgRating, className: "c" },
            ]}
          />
          {data.scorers.length === 0 && <Empty>Noch keine Spiele gespielt.</Empty>}
        </div>
      )}
    </>
  );
}

export default function StatsPage() {
  return <Suspense fallback={<Loading />}><Stats /></Suspense>;
}
