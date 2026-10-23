"use client";
import { useParams, useRouter } from "next/navigation";
import { useApi } from "@/lib/client/api";
import { useGame } from "@/components/GameShell";
import { EVENT_ICON, RatingList, StatRows } from "@/components/MatchStats";
import { Crest, Empty, ErrorBox, Icon, Loading } from "@/components/ui";

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
      <div className="card">
        <div className="scoreboard" style={{ background: "none", border: "none", padding: 0 }}>
          <div className="team"><Crest colors={data.home.colors} name={data.home.name} size={44} /><strong>{data.home.name}</strong></div>
          <div><div className="score">{f.played ? `${f.home_goals}:${f.away_goals}` : "–:–"}</div><div className="clock">{f.week}. Spieltag</div></div>
          <div className="team away"><strong>{data.away.name}</strong><Crest colors={data.away.colors} name={data.away.name} size={44} /></div>
        </div>
      </div>
      {!r ? (
        <div className="card"><Empty>Für dieses Spiel gibt es keinen detaillierten Bericht.</Empty></div>
      ) : (
        <div className="grid grid-3" style={{ alignItems: "start" }}>
          <div className="card stack-sm">
            <h3>Spielverlauf</h3>
            <div className="events" style={{ maxHeight: "none" }}>
              {r.events.filter((e: any) => !["kickoff"].includes(e.type)).map((e: any, i: number) => (
                <div key={i} className={`event ${e.type.includes("goal") ? "goal" : ""}`}>
                  <span className="min">{e.minute}'</span><span>{EVENT_ICON[e.type] ?? "•"}</span><span className="txt">{e.text}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card stack"><h3>Statistik</h3><StatRows stats={r.stats} /></div>
          <div className="card stack">
            <RatingList players={r.players} side={0} title={data.home.name} motm={r.motm} />
            <div className="divider" />
            <RatingList players={r.players} side={1} title={data.away.name} motm={r.motm} />
          </div>
        </div>
      )}
    </>
  );
}
