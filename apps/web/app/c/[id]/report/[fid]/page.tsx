"use client";
import { useParams, useRouter } from "next/navigation";
import { useApi } from "@/lib/client/api";
import { useGame } from "@/components/GameShell";
import { RatingList, StatRows } from "@/components/MatchStats";
import { Crest, Empty, ErrorBox, EventIcon, Icon, Loading, Panel } from "@/components/ui";

export default function Report() {
  const { id } = useGame();
  const { fid } = useParams<{ fid: string }>();
  const router = useRouter();
  const { data, error } = useApi<any>(`careers/${id}/reports/${fid}`);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const f = data.fixture;
  const r = data.report;
  return (
    <>
      <div className="row"><button className="btn btn-ghost btn-sm" onClick={() => router.back()}><Icon name="back" size={16} /> Zurück</button></div>
      <div className="card card-flush" style={{ ["--home" as string]: data.home.colors.primary, ["--away" as string]: data.away.colors.primary }}>
        <div className="scoreboard" style={{ border: "none" }}>
          <div className="team home"><Crest colors={data.home.colors} name={data.home.name} size={40} /><strong className="truncate">{data.home.name}</strong></div>
          <div className="center"><div className="score">{f.played ? `${f.home_goals} – ${f.away_goals}` : "– : –"}</div></div>
          <div className="team away"><strong className="truncate">{data.away.name}</strong><Crest colors={data.away.colors} name={data.away.name} size={40} /></div>
        </div>
        <div className="faint small up" style={{ textAlign: "center", padding: "6px 0", borderTop: "1px solid var(--line)" }}>{f.week}. Spieltag · Abpfiff</div>
      </div>
      {!r ? (
        <div className="card"><Empty>Für dieses Spiel gibt es keinen detaillierten Bericht.</Empty></div>
      ) : (
        <div className="grid grid-3" style={{ alignItems: "start", ["--home" as string]: data.home.colors.primary, ["--away" as string]: data.away.colors.primary }}>
          <Panel title="Spielverlauf" icon="whistle">
            <div className="events" style={{ maxHeight: "none" }}>
              {r.events.filter((e: any) => !["kickoff"].includes(e.type)).map((e: any, i: number) => (
                <div key={i} className={`event ${e.type.includes("goal") ? "goal" : ""}`}>
                  <span className="min">{e.minute}'</span><span className="ico"><EventIcon type={e.type} /></span><span className="txt">{e.text}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Statistik" icon="chart"><StatRows stats={r.stats} /></Panel>
          <Panel title="Spielernoten" icon="users" flush>
            <RatingList players={r.players} side={0} title={data.home.name} motm={r.motm} />
            <RatingList players={r.players} side={1} title={data.away.name} motm={r.motm} />
          </Panel>
        </div>
      )}
    </>
  );
}
