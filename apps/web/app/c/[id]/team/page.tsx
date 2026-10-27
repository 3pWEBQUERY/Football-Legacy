"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/client/api";
import { matchRatingColor, money, posGroup } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { StatusIcons, playerStatus } from "@/components/PlayerStatus";
import { Condition, ErrorBox, Icon, Loading, Nat, Pos, Rating, Seg, SortTable, moraleLabel, type Column } from "@/components/ui";
import { FaceName, PlayerFace } from "@/components/PlayerFace";
import { PageTip } from "@/components/Onboarding";

type Group = "ALL" | "GK" | "DEF" | "MID" | "ATT";
const ORDER = ["GK", "DR", "DC", "DL", "DM", "MR", "MC", "ML", "AMR", "AMC", "AML", "ST"];

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
    { key: "pos", label: "Pos", render: (p) => <Pos p={p.position} />, sort: (p) => ORDER.indexOf(p.position) },
    { key: "name", label: "Name", render: (p) => (
      <span className="row" style={{ gap: 8 }}>
        <PlayerFace player={p} kit={data.club?.colors} size={28} />
        <span className="name">{p.name}</span>
        {p.wonderkid && <span className="badge badge-gold">Talent</span>}
        {p.listed && <span className="badge badge-blue">Transferliste</span>}
        {p.loan && <span className="badge badge-accent" title={p.loanFrom ? `Ausgeliehen von ${p.loanFrom}` : undefined}>Leihe</span>}
      </span>
    ), sort: (p) => p.lastName },
    { key: "status", label: "", render: (p) => (
      <span className="row" style={{ gap: 4 }}>
        <StatusIcons badges={playerStatus(p)} />
        {p.contract?.untilSeason <= season && <span title="Vertrag läuft aus" style={{ color: "var(--warn)", display: "inline-flex" }}><Icon name="contract" size={14} /></span>}
      </span>
    ) },
    { key: "nat", label: "Nat", render: (p) => <Nat code={p.nationality} />, sort: (p) => p.nationality },
    { key: "age", label: "Alter", render: (p) => p.age, sort: (p) => p.age, className: "c" },
    { key: "rating", label: "Stärke", render: (p) => <Rating value={p.rating} />, sort: (p) => p.rating, className: "c" },
    { key: "pot", label: "Pot", title: "Potenzial", render: (p) => <span className="cond faint" style={{ fontWeight: 700, fontSize: 14 }}>{p.potential}</span>, sort: (p) => p.potential, className: "c" },
    { key: "fit", label: "Kond.", title: "Kondition", render: (p) => <Condition value={p.fitness} />, sort: (p) => p.fitness, className: "c" },
    { key: "mor", label: "Moral", render: (p) => { const m = moraleLabel(p.morale); return <span style={{ color: m.color, fontWeight: 600 }}>{m.text}</span>; }, sort: (p) => p.morale },
    { key: "form", label: "Form", render: (p) => <span className="cond" style={{ fontWeight: 700, fontSize: 14 }}>{p.form.toFixed(1)}</span>, sort: (p) => p.form, className: "c" },
    { key: "train", label: "Training", title: "Ø Trainingsnote der letzten Einheiten", render: (p) => (p.trainingAvg !== null ? <span className="cond" style={{ fontWeight: 700, fontSize: 14, color: matchRatingColor(p.trainingAvg) }}>{p.trainingAvg.toFixed(1)}</span> : <span className="faint">–</span>), sort: (p) => p.trainingAvg ?? 0, className: "c" },
    { key: "apps", label: "Sp", title: "Einsätze", render: (p) => p.stats.apps, sort: (p) => p.stats.apps, className: "c" },
    { key: "goals", label: "Tore", render: (p) => p.stats.goals, sort: (p) => p.stats.goals, className: "c" },
    { key: "ast", label: "Vor", title: "Vorlagen", render: (p) => p.stats.assists, sort: (p) => p.stats.assists, className: "c" },
    { key: "avg", label: "Ø Note", render: (p) => (p.stats.apps ? <span className="cond" style={{ fontWeight: 700, fontSize: 14 }}>{(p.stats.ratingSum / p.stats.apps).toFixed(2)}</span> : <span className="faint">–</span>), sort: (p) => (p.stats.apps ? p.stats.ratingSum / p.stats.apps : 0), className: "c" },
    { key: "value", label: "Marktwert", render: (p) => money(p.value), sort: (p) => p.value, className: "r" },
    { key: "wage", label: "Gehalt", render: (p) => money(p.contract?.wage), sort: (p) => p.contract?.wage ?? 0, className: "r" },
    { key: "until", label: "Bis", render: (p) => <span style={{ color: p.contract?.untilSeason <= season ? "var(--warn)" : undefined, fontWeight: 600 }}>{p.contract?.untilSeason ?? "–"}</span>, sort: (p) => p.contract?.untilSeason ?? 0, className: "c" },
  ];

  const ps = data.players;
  const wages = ps.reduce((s: number, p: any) => s + (p.contract?.wage ?? 0) * (p.loan ? p.loan.wageShare : 1), 0)
    + (data.loanedOut ?? []).reduce((s: number, p: any) => s + (p.contract?.wage ?? 0) * (1 - p.loan.wageShare), 0);
  const avgAge = ps.reduce((s: number, p: any) => s + p.age, 0) / ps.length;
  const injured = ps.filter((p: any) => p.injuryWeeks > 0).length;
  const value = ps.reduce((s: number, p: any) => s + p.value, 0);

  return (
    <>
      <PageTip id="squad" title="Dein Kader">Klicke auf einen Spieler für sein Profil mit Attributen, Vertrag und Formkurve. Die Symbole neben dem Namen zeigen Verletzungen, Sperren und Gelbe Karten. Kondition unter 75 % kostet im Spiel Leistung.</PageTip>
      <div className="page-head">
        <div><h1>Kader</h1><p>{data.club.name} · Saison {season}</p></div>
        <Seg<Group> value={group} onChange={setGroup} options={[{ value: "ALL", label: "Alle" }, { value: "GK", label: "Tor" }, { value: "DEF", label: "Abwehr" }, { value: "MID", label: "Mittelfeld" }, { value: "ATT", label: "Angriff" }]} />
      </div>
      <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
        <div className="stat"><span className="label">Spieler</span><span className="value">{ps.length}</span></div>
        <div className="stat"><span className="label">Ø Alter</span><span className="value">{avgAge.toFixed(1)}</span></div>
        <div className="stat"><span className="label">Kaderwert</span><span className="value">{money(value)}</span></div>
        <div className="stat"><span className="label">Gehälter / Woche</span><span className="value">{money(wages)}</span></div>
        <div className="stat"><span className="label">Verletzt</span><span className="value" style={{ color: injured ? "var(--neg)" : undefined }}>{injured}</span></div>
      </div>
      <div className="card card-flush">
        <SortTable rows={rows} columns={cols} rowKey={(p) => p.id} initialSort={{ key: "pos", dir: 1 }} onRowClick={(p) => router.push(`/c/${id}/player/${p.id}`)} />
      </div>
      {data.loanedOut?.length > 0 && (
        <div className="card card-flush">
          <div className="card-head"><h3>Verliehene Spieler</h3><span className="faint small">Rückkehr zum Saisonende</span></div>
          <table className="table">
            <thead><tr><th>Pos</th><th>Name</th><th>Verein</th><th className="c">Alter</th><th className="c">Stärke</th><th className="c">Sp</th><th className="c">Tore</th><th className="c">Ø Note</th><th className="r">Dein Gehaltsanteil</th></tr></thead>
            <tbody>
              {data.loanedOut.map((p: any) => (
                <tr key={p.id} className="clickable" onClick={() => router.push(`/c/${id}/player/${p.id}`)}>
                  <td><Pos p={p.position} /></td>
                  <td className="name"><FaceName player={p} /></td>
                  <td className="truncate">{p.loanTo}</td>
                  <td className="c">{p.age}</td>
                  <td className="c"><Rating value={p.rating} /></td>
                  <td className="c">{p.stats.apps}</td>
                  <td className="c">{p.stats.goals}</td>
                  <td className="c">{p.stats.apps ? (p.stats.ratingSum / p.stats.apps).toFixed(2) : "–"}</td>
                  <td className="r">{money((p.contract?.wage ?? 0) * (1 - p.loan.wageShare))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
