"use client";
import { useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { ATTR_GROUPS, attrColor } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Empty, ErrorBox, Icon, Loading, Modal, Nat, Pos, useToast } from "@/components/ui";
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
              <tr><th>Pos</th><th>Name</th><th>Nat</th><th className="c">Alter</th><th className="c">Stärke</th><th>Potenzial</th><th className="hide-sm">Typ</th><th className="r" /></tr>
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
