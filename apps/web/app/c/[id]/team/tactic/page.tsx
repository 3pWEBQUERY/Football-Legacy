"use client";
import { useEffect, useMemo, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { POS_LABEL } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { PitchBoard, type BoardSlot } from "@/components/PitchBoard";
import { Condition, ErrorBox, Loading, Panel, Pos, Rating, useNotes, useToast } from "@/components/ui";

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
      ink: inkFor(data.club.colors.primary),
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
      <div className="page-head">
        <div>
          <h1>Taktik</h1>
          <p>Position auf der Tafel wählen, dann den Spieler in der Liste. Positionen lassen sich verschieben.</p>
        </div>
        <div className="row-wrap">
          <div className="field" style={{ minWidth: 120 }}>
            <label>Formation</label>
            <select className="select" value={t.formation} onChange={(e) => changeFormation(e.target.value)} aria-label="Formation">
              {Object.keys(data.formations).map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 150 }}>
            <label>Spielidee</label>
            <select className="select" value="" onChange={(e) => { const v = data.presets[e.target.value]; if (v) update((n) => { n.style = { ...v.style }; }); }} aria-label="Spielidee">
              <option value="">Vorlage wählen …</option>
              {Object.entries(data.presets).map(([k, v]: [string, any]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
          </div>
          <div className="row" style={{ alignSelf: "flex-end" }}>
            <button className="btn" onClick={autoPick}>Auto-Aufstellung</button>
            <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>{saving ? "Speichere …" : dirty ? "Speichern" : "Gespeichert"}</button>
          </div>
        </div>
      </div>
      <div className="grid grid-tactic" style={{ alignItems: "start" }}>
        <Panel title={`Formation ${t.formation}`} icon="board" actions={t.slotOffsets?.some(Boolean) && <button className="btn btn-ghost btn-sm" onClick={() => update((n) => { n.slotOffsets = []; })}>Zurücksetzen</button>}>
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
            <div className="card-soft stack-sm" style={{ marginTop: 12 }}>
              <div className="between"><span className="faint small up">Rolle · {POS_LABEL[formation[selected].position]}</span><button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>Fertig</button></div>
              <select className="select" value={t.roles[selected] || rolesFor(formation[selected].position)[0]?.id} onChange={(e) => update((n) => { n.roles[selected] = e.target.value; })}>
                {rolesFor(formation[selected].position).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <small className="dim">{rolesFor(formation[selected].position).find((r: any) => r.id === (t.roles[selected] || rolesFor(formation[selected].position)[0]?.id))?.description}</small>
            </div>
          )}
        </Panel>

        <Panel title={selPos ? `Kandidaten · ${POS_LABEL[selPos]}` : "Kader"} icon="users" flush actions={<span className="faint small">Bank {t.bench.length}/9</span>}>
          <div style={{ maxHeight: 720, overflowY: "auto" }}>
            <table className="table">
              <thead><tr><th>Pos</th><th>Name</th><th className="c">Kond.</th><th className="c">{selPos ? "Eignung" : "Stärke"}</th><th className="r">Status</th></tr></thead>
              <tbody>
                {sortedPlayers.map((p: any) => {
                  const unavailable = p.injuryWeeks > 0 || p.suspendedWeeks > 0;
                  const status = inLineup.has(p.id) ? "Elf" : t.bench.includes(p.id) ? "Bank" : "";
                  return (
                    <tr key={p.id} className={`clickable ${status === "Elf" ? "highlight" : ""}`} style={{ opacity: unavailable ? 0.45 : 1 }} onClick={() => !unavailable && assign(p.id)}>
                      <td><Pos p={p.position} /></td>
                      <td>
                        <div className="truncate name" style={{ maxWidth: 160 }}>{p.name}</div>
                        {unavailable && <div className="small neg-txt">{p.injuryWeeks > 0 ? `Verletzt · ${p.injuryWeeks} W` : "Gesperrt"}</div>}
                      </td>
                      <td className="c"><Condition value={p.fitness} /></td>
                      <td className="c"><Rating value={selPos ? p.ratings[selPos] : p.rating} /></td>
                      <td className="r">
                        {status === "Elf" ? <span className="badge badge-blue">Startelf</span> : (
                          <button className={`btn btn-sm ${status === "Bank" ? "" : "btn-ghost"}`} disabled={unavailable} onClick={(e) => { e.stopPropagation(); toggleBench(p.id); }}>
                            {status === "Bank" ? "Bank" : "+ Bank"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="stack">
          {[
            { title: "Mit Ball", icon: "ball", keys: ["tempo", "passLength", "width", "risk"] },
            { title: "Gegen den Ball", icon: "shield", keys: ["pressing", "defensiveLine", "hardness"] },
          ].map((g) => (
            <Panel key={g.title} title={g.title} icon={g.icon}>
              <div className="stack">
                {g.keys.map((k) => {
                  const [label, lo, hi] = data.styleLabels[k];
                  return (
                    <div key={k}>
                      <div className="slider">
                        <label htmlFor={`s-${k}`} className="small" style={{ fontWeight: 600 }}>{label}</label>
                        <input id={`s-${k}`} type="range" min={0} max={100} step={5} value={t.style[k]} onChange={(e) => update((n) => { n.style[k] = Number(e.target.value); })} />
                        <span className="cond" style={{ textAlign: "right", fontWeight: 700, fontSize: 15 }}>{t.style[k]}</span>
                      </div>
                      <div className="slider"><span /><div className="ends"><span>{lo}</span><span>{hi}</span></div></div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          ))}
          <Panel title="Standards" icon="flag">
            <div className="stack">
              <div className="field">
                <label>Eckbälle</label>
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
          </Panel>
        </div>
      </div>
    </>
  );
}

function inkFor(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? "#111" : "#fff";
}
