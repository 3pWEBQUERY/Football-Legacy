"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useApi } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Crest, ErrorBox, Icon, Loading, Nat, Pos, Rating, SortTable } from "@/components/ui";
import { PlayerFace } from "@/components/PlayerFace";

export default function ClubPage() {
  const { id } = useGame();
  const { cid } = useParams<{ cid: string }>();
  const router = useRouter();
  const { data, error } = useApi<any>(`careers/${id}/clubs/${cid}`);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const c = data.club;
  return (
    <>
      <div className="between"><button className="btn btn-ghost btn-sm" onClick={() => router.back()}><Icon name="back" size={16} /> Zurück</button><Link className="btn btn-sm" href={`/c/${id}/history?club=${c.id}`}><Icon name="trophy" size={15} /> Vereinsgeschichte</Link></div>
      <div className="card row" style={{ gap: 18, flexWrap: "wrap" }}>
        <Crest colors={c.colors} name={c.name} size={64} />
        <div className="stack-sm" style={{ flex: 1 }}>
          <h1>{c.name}</h1>
          <div className="row-wrap dim">
            <span>{c.city}</span>·<span>gegründet {c.founded}</span>·<span>{c.capacity.toLocaleString("de-CH")} Plätze</span>·
            <span>{data.league.name}</span>
            {!data.league.active && <span className="badge" title="Diese Liga wird vereinfacht simuliert">vereinfachte Simulation</span>}
          </div>
        </div>
        <div className="row" style={{ gap: 24 }}>
          <div className="stat"><span className="label">Stärke</span><span className="value"><Rating value={c.rating} /></span></div>
          <div className="stat"><span className="label">Ruf</span><span className="value">{c.reputation}</span></div>
          {data.tactic && <div className="stat"><span className="label">Formation</span><span className="value">{data.tactic.formation}</span></div>}
          {data.coach && <div className="stat"><span className="label">Trainer</span><span className="value" style={{ fontSize: 16 }}>{data.coach.name}</span><span className="faint small">Spielidee: {data.coach.idea}</span></div>}
        </div>
      </div>
      <div className="card card-flush">
        <SortTable
          rows={data.players}
          rowKey={(p: any) => p.id}
          onRowClick={(p: any) => router.push(`/c/${id}/player/${p.id}`)}
          columns={[
            { key: "pos", label: "Pos", render: (p: any) => <Pos p={p.position} /> },
            { key: "name", label: "Name", render: (p: any) => <span className="row" style={{ gap: 8 }}><PlayerFace player={p} kit={data.club.colors} size={28} /><Nat code={p.nationality} /><span className="name">{p.name}</span></span>, sort: (p: any) => p.lastName },
            { key: "age", label: "Alter", render: (p: any) => p.age, sort: (p: any) => p.age, className: "c" },
            { key: "rating", label: "Stärke", render: (p: any) => <Rating value={p.rating} range={p.ratingRange} />, sort: (p: any) => p.rating ?? p.ratingRange[0], className: "c" },
            { key: "apps", label: "Sp", render: (p: any) => p.stats.apps, sort: (p: any) => p.stats.apps, className: "c" },
            { key: "goals", label: "Tore", render: (p: any) => p.stats.goals, sort: (p: any) => p.stats.goals, className: "c" },
            { key: "value", label: "Marktwert", render: (p: any) => money(p.value), sort: (p: any) => p.value, className: "r" },
            { key: "until", label: "Vertrag", render: (p: any) => p.contract?.untilSeason ?? "–", sort: (p: any) => p.contract?.untilSeason ?? 0, className: "c" },
          ]}
        />
      </div>
    </>
  );
}
