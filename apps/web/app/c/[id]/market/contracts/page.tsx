"use client";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { MobileSubnav, useGame } from "@/components/GameShell";
import { ErrorBox, Loading, Pos, Rating, SortTable } from "@/components/ui";
import { FaceName } from "@/components/PlayerFace";
import { PageTip } from "@/components/Onboarding";

export default function Contracts() {
  const { id } = useGame();
  const router = useRouter();
  const { data, error } = useApi<any>(`careers/${id}/contracts`);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const season = data.career.season;
  const expiring = data.players.filter((p: any) => (p.contract?.untilSeason ?? 0) <= season);
  return (
    <>
      <MobileSubnav section="market" />
      <PageTip id="contracts" title="Verträge im Blick">Läuft ein Vertrag aus, geht der Spieler im Sommer ablösefrei. Verlängere wichtige Spieler rechtzeitig – je näher das Vertragsende, desto mehr verlangt der Berater.</PageTip>
      <div className="page-head">
        <div>
          <h1>Verträge</h1>
          <p>{expiring.length ? `${expiring.length} Verträge laufen am Saisonende aus – sonst gehen die Spieler ablösefrei.` : "Keine auslaufenden Verträge in dieser Saison."}</p>
        </div>
      </div>
      <div className="card card-flush">
        <SortTable
          rows={data.players}
          rowKey={(p: any) => p.id}
          initialSort={{ key: "until", dir: 1 }}
          onRowClick={(p: any) => router.push(`/c/${id}/player/${p.id}`)}
          rowClass={(p: any) => ((p.contract?.untilSeason ?? 0) <= season ? "highlight" : "")}
          columns={[
            { key: "pos", label: "Pos", render: (p: any) => <Pos p={p.position} /> },
            { key: "name", label: "Name", render: (p: any) => <b><FaceName player={p} kit={data.kit} /></b>, sort: (p: any) => p.lastName },
            { key: "age", label: "Alter", render: (p: any) => p.age, sort: (p: any) => p.age, className: "c" },
            { key: "rating", label: "Stärke", render: (p: any) => <Rating value={p.rating} />, sort: (p: any) => p.rating, className: "c" },
            { key: "morale", label: "Moral", render: (p: any) => `${p.morale}%`, sort: (p: any) => p.morale, className: "c" },
            { key: "wage", label: "Gehalt/Woche", render: (p: any) => money(p.contract?.wage), sort: (p: any) => p.contract?.wage ?? 0, className: "r" },
            { key: "clause", label: "Ausstiegsklausel", render: (p: any) => (p.contract?.releaseClause ? money(p.contract.releaseClause) : "–"), sort: (p: any) => p.contract?.releaseClause ?? 0, className: "r" },
            { key: "until", label: "Bis", render: (p: any) => <span className={(p.contract?.untilSeason ?? 0) <= season ? "badge badge-warn" : ""}>{p.contract?.untilSeason ?? "–"}</span>, sort: (p: any) => p.contract?.untilSeason ?? 0, className: "c" },
          ]}
        />
      </div>
    </>
  );
}
