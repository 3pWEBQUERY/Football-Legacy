"use client";
import { useEffect, useMemo, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { POS_LABEL } from "@/lib/client/format";
import { MobileSubnav, useGame } from "@/components/GameShell";
import { PitchBoard, type BoardSlot } from "@/components/PitchBoard";
import { ErrorBox, Loading, Pos, Rating, useNotes, useToast } from "@/components/ui";

export default function TacticPage() {
  const { id } = useGame();
  const toast = useToast();
  const showNotes = useNotes();
  const { data, error, reload } = useApi<any>(`careers/${id}/tactic`);
  const [t, setT] = useState<any | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setT(structuredClone(data.tactic));
      setDirty(false);
    }
  }, [data]);

  const players = data?.players ?? [];
  const byId = useMemo(() => new Map<number, any>(players.map((p: any) => [p.id, p])), [players]);
  if (error) return <ErrorBox message={error} />;
  if (!data || !t) return <Loading />;

  const formation = data.formations[t.formation] as { position: string; x: number; y: number }[];
  const update = (fn: (t: any) => void) => {
    const next = structuredClone(t);
    fn(next);
    setT(next);
    setDirty(true);
  };

  const slots: BoardSlot[] = formation.map((s, i) => {
    const off = t.slotOffsets?.[i];
    const p = t.lineup[i] != null ? byId.get(t.lineup[i]) : null;
    return {
      position: s.position,
      x: off?.x ?? s.x,
      y: off?.y ?? s.y,
      label: p ? p.lastName : "frei",
      sub: p ? `${p.ratings[s.position]}` : undefined,
      color: data.club.colors.primary,
      ink: "#fff",
      empty: !p,
    };
  });

  function assign(playerId: number) {
    if (selected === null) {
      toast("Wähle zuerst eine Position auf der Taktiktafel.");
      return;
    }
    update((n) => {
      const prev = n.lineup[selected];
      const at = n.lineup.indexOf(playerId);
      if (at >= 0) n.lineup[at] = prev; // Tausch innerhalb der Elf
      n.lineup[selected] = playerId;
      n.bench = n.bench.filter((b: number) => b !== playerId);
      if (prev != null && at < 0 && !n.bench.includes(prev)) n.bench.unshift(prev);
      n.bench = n.bench.slice(0, 9);
    });
  }

  function toggleBench(playerId: number) {
    update((n) => {
      if (n.bench.includes(playerId)) n.bench = n.bench.filter((b: number) => b !== playerId);
      else if (n.bench.length < 9 && !n.lineup.includes(playerId)) n.bench.push(playerId);
    });
  }

  function changeFormation(f: string) {
    update((n) => {
      // Spieler möglichst passend auf die neuen Slots verteilen
      const current = n.lineup.filter((x: number | null) => x != null) as number[];
      const newSlots = data.formations[f] as { position: string }[];
      const used = new Set<number>();
      n.lineup = newSlots.map((s) => {
        let best: number | null = null;
        let bestR = -1;
        for (const pid of current) {
          if (used.has(pid)) continue;
          const r = byId.get(pid)?.ratings[s.position] ?? 0;
          if (r > bestR) { bestR = r; best = pid; }
        }
        if (best != null) used.add(best);
        return best;
      });
      n.formation = f;
      n.roles = newSlots.map(() => "");
      n.slotOffsets = [];
    });
    setSelected(null);
  }

  function autoPick() {
    update((n) => {
      const slotsF = data.formations[n.formation] as { position: string }[];
      const avail = players.filter((p: any) => p.injuryWeeks === 0 && p.suspendedWeeks === 0);
      const used = new Set<number>();
      n.lineup = slotsF.map((s) => {
        const best = avail.filter((p: any) => !used.has(p.id)).sort((a: any, b: any) => b.ratings[s.position] * (0.85 + b.fitness / 650) - a.ratings[s.position] * (0.85 + a.fitness / 650))[0];
        if (best) used.add(best.id);
        return best?.id ?? null;
      });
      const rest = avail.filter((p: any) => !used.has(p.id)).sort((a: any, b: any) => b.rating - a.rating);
      const gk = rest.find((p: any) => p.position === "GK");
      n.bench = [...(gk ? [gk.id] : []), ...rest.filter((p: any) => p !== gk).slice(0, 8).map((p: any) => p.id)];
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await api<any>(`careers/${id}/tactic`, { method: "PUT", body: t });
      toast("Taktik gespeichert", "success");
      showNotes(res.notes);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  const selPos = selected !== null ? formation[selected].position : null;
  const rolesFor = (pos: string) => data.roles.filter((r: any) => r.positions.includes(pos));
  const inLineup = new Set(t.lineup.filter((x: any) => x != null));
  const sortedPlayers = [...players].sort((a: any, b: any) =>
    selPos ? b.ratings[selPos] - a.ratings[selPos] : b.rating - a.rating,
  );
  const lineupPlayers = t.lineup.map((pid: number | null) => (pid != null ? byId.get(pid) : null)).filter(Boolean);

  return (
    <>
      <MobileSubnav section="team" />
      <div className="page-head">
        <div>
          <h1>Aufstellung & Taktik</h1>
          <p>Tippe eine Position an und wähle rechts einen Spieler. Positionen lassen sich auf der Tafel verschieben.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={autoPick}>Automatisch aufstellen</button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>{saving ? "Speichere …" : dirty ? "Speichern" : "Gespeichert"}</button>
        </div>
      </div>
      <div className="grid grid-tactic" style={{ alignItems: "start" }}>
        <div className="card stack">
          <div className="between">
            <select className="select" value={t.formation} onChange={(e) => changeFormation(e.target.value)} aria-label="Formation">
              {Object.keys(data.formations).map((f) => <option key={f}>{f}</option>)}
            </select>
            {t.slotOffsets?.some(Boolean) && <button className="btn btn-ghost btn-sm" onClick={() => update((n) => { n.slotOffsets = []; })}>Positionen zurücksetzen</button>}
          </div>
          <PitchBoard
            slots={slots}
            selected={selected}
            onSelect={(i) => setSelected(selected === i ? null : i)}
            onMove={(i, x, y) => update((n) => {
              n.slotOffsets = n.slotOffsets ?? [];
              while (n.slotOffsets.length < 11) n.slotOffsets.push(null);
              n.slotOffsets[i] = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
            })}
          />
          {selected !== null && (
            <div className="card-soft stack-sm">
              <div className="between"><b>{POS_LABEL[formation[selected].position]} – Rolle</b><button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>Fertig</button></div>
              <select className="select" value={t.roles[selected] || rolesFor(formation[selected].position)[0]?.id} onChange={(e) => update((n) => { n.roles[selected] = e.target.value; })}>
                {rolesFor(formation[selected].position).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <small className="dim">{rolesFor(formation[selected].position).find((r: any) => r.id === (t.roles[selected] || rolesFor(formation[selected].position)[0]?.id))?.description}</small>
            </div>
          )}
        </div>

        <div className="card card-flush">
          <div className="card-head" style={{ paddingBottom: 8 }}>
            <h3>{selPos ? `Spieler für ${POS_LABEL[selPos]}` : "Spieler"}</h3>
            <span className="faint small">Bank {t.bench.length}/9</span>
          </div>
          <div style={{ maxHeight: 640, overflowY: "auto" }}>
            <table className="table">
              <tbody>
                {sortedPlayers.map((p: any) => {
                  const unavailable = p.injuryWeeks > 0 || p.suspendedWeeks > 0;
                  const status = inLineup.has(p.id) ? "Elf" : t.bench.includes(p.id) ? "Bank" : "";
                  return (
                    <tr key={p.id} className="clickable" style={{ opacity: unavailable ? 0.5 : 1 }} onClick={() => !unavailable && assign(p.id)}>
                      <td><Pos p={p.position} /></td>
                      <td>
                        <div className="truncate" style={{ maxWidth: 150 }}><b>{p.name}</b></div>
                        <div className="faint small">{unavailable ? (p.injuryWeeks > 0 ? `verletzt (${p.injuryWeeks} W)` : "gesperrt") : `Fit ${p.fitness}% · Form ${p.form.toFixed(1)}`}</div>
                      </td>
                      <td className="c"><Rating value={selPos ? p.ratings[selPos] : p.rating} /></td>
                      <td className="r">
                        {status === "Elf" ? <span className="badge badge-accent">Elf</span> : (
                          <button className="btn btn-ghost btn-sm" disabled={unavailable} onClick={(e) => { e.stopPropagation(); toggleBench(p.id); }}>
                            {status === "Bank" ? "Bank ✓" : "+ Bank"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <div className="card stack">
            <h3>Spielstil</h3>
            <div className="row-wrap">
              {Object.entries(data.presets).map(([k, v]: [string, any]) => (
                <button key={k} className="btn btn-sm" onClick={() => update((n) => { n.style = { ...v.style }; })}>{v.name}</button>
              ))}
            </div>
            {Object.entries(data.styleLabels).map(([k, [label, lo, hi]]: [string, any]) => (
              <div key={k}>
                <div className="slider">
                  <label htmlFor={`s-${k}`} className="small" style={{ fontWeight: 600 }}>{label}</label>
                  <input id={`s-${k}`} type="range" min={0} max={100} step={5} value={t.style[k]} onChange={(e) => update((n) => { n.style[k] = Number(e.target.value); })} />
                  <span className="num small" style={{ textAlign: "right" }}>{t.style[k]}</span>
                </div>
                <div className="slider"><span /><div className="ends"><span>{lo}</span><span>{hi}</span></div></div>
              </div>
            ))}
          </div>
          <div className="card stack">
            <h3>Standards</h3>
            <div className="field">
              <label>Eckball-Variante</label>
              <select className="select" value={t.setPieces.corners} onChange={(e) => update((n) => { n.setPieces.corners = e.target.value; })}>
                <option value="far">Hoch an den zweiten Pfosten</option>
                <option value="near">Scharf an den ersten Pfosten</option>
                <option value="short">Kurz ausführen</option>
              </select>
            </div>
            {[["cornerTaker", "Eckenschütze", "corners"], ["freeKickTaker", "Freistossschütze", "freeKicks"], ["penaltyTaker", "Elfmeterschütze", "penalties"]].map(([key, label, attr]) => (
              <div key={key} className="field">
                <label>{label}</label>
                <select className="select" value={t.setPieces[key] ?? ""} onChange={(e) => update((n) => { n.setPieces[key] = e.target.value ? Number(e.target.value) : null; })}>
                  <option value="">Automatisch</option>
                  {lineupPlayers.sort((a: any, b: any) => b.attrs[attr] - a.attrs[attr]).map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.attrs[attr]})</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
