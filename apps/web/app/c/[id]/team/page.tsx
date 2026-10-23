"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/client/api";
import { money, posGroup } from "@/lib/client/format";
import { MobileSubnav, useGame } from "@/components/GameShell";
import { ErrorBox, Loading, Pos, Progress, Rating, Seg, SortTable, type Column } from "@/components/ui";

type Group = "ALL" | "GK" | "DEF" | "MID" | "ATT";

export default function Squad() {
  const { id } = useGame();
  const router = useRouter();
  const { data, error } = useApi<any>(`careers/${id}/squad`);
  const [group, setGroup] = useState<Group>("ALL");
  const rows = useMemo(() => (data?.players ?? []).filter((p: any) => group === "ALL" || posGroup(p.position) === group), [data, group]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const season = data.career.season;

  const cols: Column<any>[] = [
    { key: "pos", label: "Pos", render: (p) => <Pos p={p.position} />, sort: (p) => ["GK", "DR", "DC", "DL", "DM", "MR", "MC", "ML", "AMR", "AMC", "AML", "ST"].indexOf(p.position) },
    { key: "name", label: "Name", render: (p) => (
      <span className="row" style={{ gap: 6 }}>
        <span title={p.nationality}>{p.flag}</span>
        <b>{p.name}</b>
        {p.wonderkid && <span className="badge badge-gold" title="Wunderkind">★</span>}
        {p.injuryWeeks > 0 && <span className="badge badge-danger" title="Verletzt">🩺 {p.injuryWeeks} W</span>}
        {p.suspendedWeeks > 0 && <span className="badge badge-warn" title="Gesperrt">🟥</span>}
        {p.listed && <span className="badge badge-blue">Transferliste</span>}
      </span>
    ), sort: (p) => p.lastName },
    { key: "age", label: "Alter", render: (p) => p.age, sort: (p) => p.age, className: "c" },
    { key: "rating", label: "Stärke", render: (p) => <Rating value={p.rating} />, sort: (p) => p.rating, className: "c" },
    { key: "pot", label: "Pot.", title: "Potenzial", render: (p) => <span className="faint">{p.potential}</span>, sort: (p) => p.potential, className: "c" },
    { key: "form", label: "Form", render: (p) => <span className="num">{p.form.toFixed(1)}</span>, sort: (p) => p.form, className: "c" },
    { key: "fit", label: "Fitness", render: (p) => <div style={{ width: 60 }}><Progress value={p.fitness} tone={p.fitness < 70 ? "danger" : p.fitness < 85 ? "warn" : undefined} /></div>, sort: (p) => p.fitness },
    { key: "mor", label: "Moral", render: (p) => <span>{p.morale >= 75 ? "😀" : p.morale >= 50 ? "🙂" : p.morale >= 30 ? "😐" : "😟"}</span>, sort: (p) => p.morale, className: "c" },
    { key: "apps", label: "Sp", title: "Einsätze", render: (p) => p.stats.apps, sort: (p) => p.stats.apps, className: "c" },
    { key: "goals", label: "T", title: "Tore", render: (p) => p.stats.goals, sort: (p) => p.stats.goals, className: "c" },
    { key: "avg", label: "Ø Note", render: (p) => (p.stats.apps ? (p.stats.ratingSum / p.stats.apps).toFixed(2) : "–"), sort: (p) => (p.stats.apps ? p.stats.ratingSum / p.stats.apps : 0), className: "c" },
    { key: "value", label: "Marktwert", render: (p) => money(p.value), sort: (p) => p.value, className: "r" },
    { key: "wage", label: "Gehalt/W", render: (p) => money(p.contract?.wage), sort: (p) => p.contract?.wage ?? 0, className: "r" },
    { key: "until", label: "Vertrag", render: (p) => <span className={p.contract?.untilSeason <= season ? "badge badge-warn" : ""}>{p.contract?.untilSeason ?? "–"}</span>, sort: (p) => p.contract?.untilSeason ?? 0, className: "c" },
  ];

  const wages = data.players.reduce((s: number, p: any) => s + (p.contract?.wage ?? 0), 0);
  const avgAge = data.players.reduce((s: number, p: any) => s + p.age, 0) / data.players.length;

  return (
    <>
      <MobileSubnav section="team" />
      <div className="page-head">
        <div>
          <h1>Kader</h1>
          <p>{data.players.length} Spieler · Ø Alter {avgAge.toFixed(1)} · Gehälter {money(wages)} pro Woche</p>
        </div>
        <Seg<Group> value={group} onChange={setGroup} options={[{ value: "ALL", label: "Alle" }, { value: "GK", label: "Tor" }, { value: "DEF", label: "Abwehr" }, { value: "MID", label: "Mittelfeld" }, { value: "ATT", label: "Angriff" }]} />
      </div>
      <div className="card card-flush">
        <SortTable rows={rows} columns={cols} rowKey={(p) => p.id} onRowClick={(p) => router.push(`/c/${id}/player/${p.id}`)} />
      </div>
    </>
  );
}
