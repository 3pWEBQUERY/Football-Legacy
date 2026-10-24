"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { posGroup } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { NationBadge } from "@/components/NationBadge";
import { PlayerFace } from "@/components/PlayerFace";
import { Condition, ErrorBox, Loading, Pos, Rating, Seg, useToast } from "@/components/ui";

type Group = "ALL" | "GK" | "DEF" | "MID" | "ATT";

export default function NationalSquadPage() {
  const { id } = useGame();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`careers/${id}/national/squad`);
  const [squad, setSquad] = useState<number[]>([]);
  const [starters, setStarters] = useState<number[]>([]);
  const [formation, setFormation] = useState("4-3-3");
  const [preset, setPreset] = useState("balanced");
  const [group, setGroup] = useState<Group>("ALL");
  const [onlySelected, setOnlySelected] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setSquad(data.players.filter((p: any) => p.selected).map((p: any) => p.id));
    setStarters(data.starters);
    setFormation(data.formation);
    setPreset(data.preset);
    setDirty(false);
  }, [data]);

  const players = useMemo(() => (data?.players ?? []).filter((p: any) => (group === "ALL" || posGroup(p.position) === group) && (!onlySelected || squad.includes(p.id))), [data, group, onlySelected, squad]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  const counts = { GK: 0, DEF: 0, MID: 0, ATT: 0 } as Record<string, number>;
  for (const p of data.players) if (squad.includes(p.id)) counts[posGroup(p.position)]++;

  function toggle(pid: number) {
    setDirty(true);
    if (squad.includes(pid)) {
      setSquad(squad.filter((x) => x !== pid));
      setStarters(starters.filter((x) => x !== pid));
    } else if (squad.length >= data.max) toast(`Höchstens ${data.max} Spieler.`, "error");
    else setSquad([...squad, pid]);
  }
  function toggleStarter(pid: number) {
    setDirty(true);
    if (starters.includes(pid)) setStarters(starters.filter((x) => x !== pid));
    else if (starters.length >= 11) toast("Die Stammelf ist voll (11 Spieler).", "error");
    else setStarters([...starters, pid]);
  }
  async function save(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${id}/national/squad`, { body });
      toast(r.warning ?? "Kader und Taktik gespeichert", r.warning ? "info" : "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ gap: 12 }}>
          <NationBadge code={data.nation.code} colors={data.nation.colors} size={36} />
          <div><h1>Kader & Taktik</h1><p>{data.nation.name} · Nominiere bis zu {data.max} Spieler und wähle deine Stammelf</p></div>
        </div>
        <div className="row-wrap">
          <div className="field" style={{ minWidth: 110 }}>
            <label>Formation</label>
            <select className="select" value={formation} onChange={(e) => { setFormation(e.target.value); setDirty(true); }} aria-label="Formation">
              {data.formations.map((f: string) => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 150 }}>
            <label>Spielidee</label>
            <select className="select" value={preset} onChange={(e) => { setPreset(e.target.value); setDirty(true); }} aria-label="Spielidee">
              {Object.entries(data.presets).map(([k, v]: [string, any]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="row" style={{ alignSelf: "flex-end" }}>
            <button className="btn" disabled={busy} onClick={() => save({ auto: true, formation, preset })}>Auto-Nominierung</button>
            <button className="btn btn-primary" disabled={busy || !dirty} onClick={() => save({ squad, starters, formation, preset })}>{dirty ? "Speichern" : "Gespeichert"}</button>
          </div>
        </div>
      </div>
      <div className="card row-wrap" style={{ gap: 24 }}>
        <div><div className="faint small up">Nominiert</div><div className="squad-count" style={{ color: squad.length > data.max ? "var(--neg)" : undefined }}>{squad.length} / {data.max}</div></div>
        <div><div className="faint small up">Tor / Abwehr / Mittelfeld / Angriff</div><div className="squad-count">{counts.GK} / {counts.DEF} / {counts.MID} / {counts.ATT}</div></div>
        <div><div className="faint small up">Stammelf</div><div className="squad-count">{starters.length} / 11</div></div>
        <div className="dim small" style={{ flex: 1, minWidth: 240 }}>Ohne Stammelf stellt der Co-Trainer die besten nominierten Spieler auf. Verletzte werden vor der Länderspielpause automatisch ersetzt.</div>
      </div>
      <section className="card card-flush">
        <div className="card-head">
          <Seg<Group> value={group} onChange={setGroup} options={[{ value: "ALL", label: "Alle" }, { value: "GK", label: "Tor" }, { value: "DEF", label: "Abwehr" }, { value: "MID", label: "Mittelfeld" }, { value: "ATT", label: "Angriff" }]} />
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} /> Nur Nominierte</label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Kader</th><th>Pos</th><th>Name</th><th>Verein</th><th className="c">Alter</th><th className="c">Stärke</th><th className="c">Form</th><th className="c">Kond.</th><th className="c">Länderspiele</th><th className="r">Stammelf</th></tr></thead>
            <tbody>
              {players.map((p: any) => {
                const sel = squad.includes(p.id);
                return (
                  <tr key={p.id} className={sel ? "highlight" : ""} style={{ opacity: p.injuryWeeks > 0 ? 0.5 : 1 }}>
                    <td><input type="checkbox" checked={sel} onChange={() => toggle(p.id)} aria-label={`${p.name} nominieren`} /></td>
                    <td><Pos p={p.position} /></td>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <PlayerFace player={p} kit={p.kit} size={28} />
                        <Link href={`/c/${id}/player/${p.id}`} className="name">{p.name}</Link>
                        {p.own && <span className="badge badge-accent">Dein Verein</span>}
                        {p.injuryWeeks > 0 && <span className="badge badge-danger">Verletzt</span>}
                      </span>
                    </td>
                    <td className="truncate dim">{p.clubId ? <Link href={`/c/${id}/club/${p.clubId}`}>{p.club}</Link> : "vereinslos"}</td>
                    <td className="c">{p.age}</td>
                    <td className="c"><Rating value={p.rating} /></td>
                    <td className="c cond" style={{ fontWeight: 700 }}>{p.form.toFixed(1)}</td>
                    <td className="c"><Condition value={p.fitness} /></td>
                    <td className="c">{p.caps}{p.intlGoals ? <span className="faint small"> · {p.intlGoals} T</span> : null}</td>
                    <td className="r">
                      {sel && <button className={`btn btn-sm starter-btn ${starters.includes(p.id) ? "btn-primary" : "btn-ghost"}`} onClick={() => toggleStarter(p.id)}>{starters.includes(p.id) ? "Stammelf" : "+ Elf"}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
