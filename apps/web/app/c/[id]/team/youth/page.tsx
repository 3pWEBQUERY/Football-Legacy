"use client";
import { useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { ATTR_GROUPS, attrColor } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Crest, Empty, ErrorBox, Icon, Loading, Modal, Nat, Panel, Pos, useToast } from "@/components/ui";
import { PlayerFace } from "@/components/PlayerFace";
import { useConfirm } from "@/components/Dialog";
import { PageTip } from "@/components/Onboarding";

function Stars({ n }: { n: number }) {
  return (
    <span className="stars" title={`${n} von 5`}>
      {Array.from({ length: 5 }).map((_, i) => <span key={i} className={i < n ? "on" : ""} />)}
    </span>
  );
}

export default function YouthPage() {
  const { id } = useGame();
  const toast = useToast();
  const ask = useConfirm();
  const { data, error, reload } = useApi<any>(`careers/${id}/academy`);
  const [open, setOpen] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  async function act(p: any, action: "promote" | "release") {
    if (action === "release" && !(await ask({ title: `${p.name} entlassen?`, message: "Der Spieler verlässt die Akademie und ist danach vereinslos.", danger: true, confirmLabel: "Entlassen" }))) return;
    setBusy(true);
    try {
      const r = await api<any>(`careers/${id}/academy/${p.id}`, { body: { action } });
      toast(r.message, "success");
      setOpen(null);
      reload();
      refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTip id="youth" title="Jugendakademie">Einmal pro Saison kommt am Jugendtag ein neuer Jahrgang. Ziehe Talente mit hohem Potenzial in die erste Mannschaft hoch – Eigengewächse zählen auch für die Vision des Vorstands.</PageTip>
      <div className="page-head">
        <div>
          <h1>Jugendakademie</h1>
          <p>{data.players.length} Talente · Jugendtrainer Stufe {data.staffYouth} · Akademie Stufe {data.facilityYouth}{data.nextIntake ? ` · Nächster Jugendtag: ${data.nextIntake.label}` : ""}</p>
        </div>
      </div>
      <div className="card small dim" style={{ padding: "10px 14px" }}>
        Die Werte sind Einschätzungen deines Jugendtrainers – je besser Trainer und Akademie, desto genauer. Talente können ab 16 in die erste Mannschaft hochgezogen werden; mit 20 verlassen sie die Akademie.
      </div>
      <section className="card card-flush">
        {data.players.length === 0 ? <Empty>Noch keine Talente. Der nächste Jahrgang kommt am Jugendtag.</Empty> : (
          <table className="table">
            <thead>
              <tr><th>Pos</th><th>Name</th><th>Nat</th><th className="c">Alter</th><th className="c">Stärke</th><th>Potenzial</th><th className="hide-sm">Typ</th><th className="c hide-sm" title="U19-Einsätze / Tore">U19</th><th className="r" /></tr>
            </thead>
            <tbody>
              {data.players.map((p: any) => (
                <tr key={p.id} className="clickable" onClick={() => setOpen(p)}>
                  <td><Pos p={p.position} /></td>
                  <td><span className="row" style={{ gap: 8 }}><PlayerFace player={p} kit={data.kit} size={28} /><span className="name">{p.name}</span>{p.wonderkid && <span className="badge badge-gold">Ausnahmetalent</span>}</span></td>
                  <td><Nat code={p.nationality} /></td>
                  <td className="c">{p.age}</td>
                  <td className="c cond" style={{ fontWeight: 700 }}>{p.ratingRange[0]}–{p.ratingRange[1]}</td>
                  <td><span className="row" style={{ gap: 8 }}><Stars n={p.stars} /><span className="faint small">{p.potentialRange[0]}–{p.potentialRange[1]}</span></span></td>
                  <td className="hide-sm dim small">{p.archetype}</td>
                  <td className="c hide-sm small">{p.apps ? <>{p.apps} <span className="faint">/</span> {p.goals}</> : <span className="faint">–</span>}</td>
                  <td className="r nowrap" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-primary" disabled={busy || p.age < 16} title={p.age < 16 ? "Erst ab 16 Jahren" : "In die erste Mannschaft"} onClick={() => act(p, "promote")}>Hochziehen</button>{" "}
                    <button className="btn btn-sm btn-ghost" disabled={busy} title="Freigeben" onClick={() => act(p, "release")}><Icon name="close" size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {data.u19 && <U19 data={data.u19} clubId={data.career.clubId} />}

      <Modal open={!!open} onClose={() => setOpen(null)} wide>
        {open && (
          <div className="stack">
            <div className="between">
              <div className="face-card">
                <PlayerFace player={open} kit={data.kit} size={84} />
                <div>
                <div className="faint small up">{open.archetype} · {open.age} Jahre · Fuss {open.foot === "L" ? "links" : open.foot === "R" ? "rechts" : "beidfüssig"}</div>
                <h2>{open.name}</h2>
                </div>
              </div>
              <div className="row" style={{ gap: 16 }}>
                <div className="stat"><span className="label">Stärke</span><span className="value">{open.ratingRange[0]}–{open.ratingRange[1]}</span></div>
                <div className="stat"><span className="label">Potenzial</span><span className="value"><Stars n={open.stars} /></span></div>
              </div>
            </div>
            <div className="grid grid-3" style={{ gap: 18 }}>
              {ATTR_GROUPS.map((g) => (
                <div key={g.title}>
                  <div className="attr-group-title">{g.title}</div>
                  {g.keys.map(([k, label]) => (
                    <div key={k} className="attr"><span className="dim">{label}</span><span className="attr-v" style={{ color: attrColor(open.attrs[k]) }}>{open.attrs[k]}</span></div>
                  ))}
                </div>
              ))}
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => act(open, "release")} disabled={busy}>Freigeben</button>
              <button className="btn btn-primary" onClick={() => act(open, "promote")} disabled={busy || open.age < 16}>In die erste Mannschaft</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function U19({ data, clubId }: { data: any; clubId: number }) {
  const score = (f: any) => {
    const home = f.home === clubId;
    const res = f.hg === f.ag ? "draw" : (f.hg > f.ag) === home ? "win" : "loss";
    return <span className={`u19-res u19-${res}`}>{f.hg}:{f.ag}</span>;
  };
  return (
    <div className="grid grid-side" style={{ alignItems: "start" }}>
      <Panel title={`U19-Liga · ${data.round}/${data.rounds} Spieltage`} icon="trophy" actions={data.champion && <span className="badge badge-gold">Meister: {data.champion}</span>}>
        <table className="table">
          <thead><tr><th className="c">#</th><th>Team</th><th className="c">Sp</th><th className="c hide-sm">S</th><th className="c hide-sm">U</th><th className="c hide-sm">N</th><th className="c">Tore</th><th className="c">Pkt</th></tr></thead>
          <tbody>
            {data.table.map((r: any, i: number) => (
              <tr key={r.clubId} className={r.clubId === clubId ? "highlight" : ""}>
                <td className="c faint">{i + 1}</td>
                <td><span className="row" style={{ gap: 8 }}><Crest colors={r.colors} name={r.name} size={16} /><span className={r.clubId === clubId ? "name" : ""}>{r.name}</span></span></td>
                <td className="c">{r.played}</td><td className="c hide-sm">{r.won}</td><td className="c hide-sm">{r.drawn}</td><td className="c hide-sm">{r.lost}</td>
                <td className="c">{r.gf}:{r.ga}</td><td className="c" style={{ fontWeight: 700 }}>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="stack">
        <Panel title="Spiele der U19" icon="calendar">
          {data.results.length === 0 && data.next.length === 0 ? <Empty>Noch keine Spiele.</Empty> : (
            <div className="stack" style={{ gap: 6 }}>
              {data.results.map((f: any) => <div key={`r${f.round}`} className="between small"><span className="truncate">{f.round}. {f.homeName} – {f.awayName}</span>{score(f)}</div>)}
              {data.next.map((f: any) => <div key={`n${f.round}`} className="between small dim"><span className="truncate">{f.round}. {f.homeName} – {f.awayName}</span><span className="faint">–:–</span></div>)}
            </div>
          )}
        </Panel>
        <Panel title="Torschützen" icon="ball">
          {data.scorers.length === 0 ? <Empty>Noch keine Tore.</Empty> : (
            <table className="table">
              <thead><tr><th>Spieler</th><th className="c">Sp</th><th className="c">T</th><th className="c">V</th><th className="c">Ø</th></tr></thead>
              <tbody>
                {data.scorers.map((x: any) => (
                  <tr key={x.id}><td><span className="row" style={{ gap: 6 }}><Pos p={x.position} />{x.name}</span></td><td className="c">{x.apps}</td><td className="c" style={{ fontWeight: 700 }}>{x.goals}</td><td className="c">{x.assists}</td><td className="c faint">{x.avg?.toFixed(1)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
