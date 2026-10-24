"use client";
import Link from "next/link";
import { useApi } from "@/lib/client/api";
import { useGame } from "@/components/GameShell";
import { Crest, Empty, ErrorBox, Icon, Loading, Pos } from "@/components/ui";
import { PlayerFace } from "@/components/PlayerFace";

export default function AwardsPage() {
  const { id } = useGame();
  const { data, error } = useApi<any>(`careers/${id}/awards`);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const own = data.career.clubId;
  const kit = (clubId: number) => data.colors[clubId] ?? null;

  const winner = (label: string, x: any) => (
    <div className={`award-cell ${x?.clubId === own ? "mine" : ""}`}>
      {x ? <PlayerFace player={x} kit={kit(x.clubId)} size={56} /> : null}
      <div style={{ minWidth: 0 }}>
        <div className="k">{label}</div>
        {x ? (
          <>
            <Link href={`/c/${id}/player/${x.id}`} className="name truncate" style={{ display: "block", fontSize: 16 }}>{x.name}</Link>
            <div className="faint small truncate">{x.club} · {x.age} Jahre</div>
            <div className="small">Ø <b>{x.avg.toFixed(2)}</b> · {x.goals} Tore · {x.assists} Vorlagen · {x.apps} Spiele</div>
          </>
        ) : <div className="faint">Nicht vergeben</div>}
      </div>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div><h1>Auszeichnungen</h1><p>{data.league?.name ?? "Liga"} · Spieler, Talent, Trainer und Elf des Monats</p></div>
        {data.managerAwards > 0 && <span className="badge badge-gold"><Icon name="trophy" size={13} /> {data.managerAwards}× Trainer des Monats</span>}
      </div>
      {data.months.length === 0 ? (
        <div className="card"><Empty>Die ersten Auszeichnungen werden am Monatsersten nach mindestens zwei Ligaspieltagen vergeben.</Empty></div>
      ) : data.months.map((m: any) => (
        <section key={`${m.season}-${m.month}`} className="card card-flush">
          <div className="card-head"><h3>{m.label}</h3><span className="faint small">{m.rounds} Spieltage</span></div>
          <div className="award-grid" style={{ borderTop: "1px solid var(--line)" }}>
            {winner("Spieler des Monats", m.player)}
            {winner("Talent des Monats", m.young)}
            <div className={`award-cell ${m.manager?.user ? "mine" : ""}`}>
              {m.manager && kit(m.manager.clubId) && <Crest colors={kit(m.manager.clubId)} name={m.manager.club} size={48} />}
              <div style={{ minWidth: 0 }}>
                <div className="k">Trainer des Monats</div>
                {m.manager ? (
                  <>
                    <div className="name truncate" style={{ fontSize: 16 }}>{m.manager.name}</div>
                    <Link href={`/c/${id}/club/${m.manager.clubId}`} className="faint small truncate" style={{ display: "block" }}>{m.manager.club}</Link>
                    <div className="small"><b>{m.manager.points}</b> Punkte · Bilanz {m.manager.record}</div>
                  </>
                ) : <div className="faint">Nicht vergeben</div>}
              </div>
            </div>
          </div>
          {m.team.length > 0 && (
            <>
              <div className="faint small up" style={{ padding: "10px 16px 0", fontWeight: 700, borderTop: "1px solid var(--line)" }}>Elf des Monats</div>
              <div className="team-month" style={{ borderTop: 0 }}>
                {m.team.map((t: any) => (
                  <Link key={t.id} href={`/c/${id}/player/${t.id}`} className={`tm ${t.clubId === own ? "mine" : ""}`}>
                    <PlayerFace player={t} kit={kit(t.clubId)} size={34} />
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 4 }}><Pos p={t.position} /><b className="small cond">{t.avg.toFixed(2)}</b></div>
                      <div className="small truncate name">{t.name}</div>
                      <div className="faint small truncate">{t.club}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      ))}
    </>
  );
}
