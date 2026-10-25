"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { POS_LABEL } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { PitchBoard, Stars, type BoardSlot, type SlotGroup } from "@/components/PitchBoard";
import { Condition, ErrorBox, Icon, Loading, Panel, Pos, Rating, moraleLabel, useNotes, useToast } from "@/components/ui";
import { PlayerFace } from "@/components/PlayerFace";

export default function TacticPage() {
  const { id } = useGame();
  const toast = useToast();
  const showNotes = useNotes();
  const { data, error, reload } = useApi<any>(`careers/${id}/tactic`);
  const [t, setT] = useState<any | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<ViewMode>("eignung");
  const [viewOpen, setViewOpen] = useState(false);
  const [menu, setMenu] = useState<{ slot: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (data) {
      setT(structuredClone(data.tactic));
      setDirty(false);
    }
  }, [data]);

  const players = data?.players ?? [];
  const byId = useMemo(() => new Map<number, any>(players.map((p: any) => [p.id, p])), [players]);
  const numbers = useMemo(() => squadNumbers(players), [players]);
  if (error) return <ErrorBox message={error} />;
  if (!data || !t) return <Loading />;

  const formation = data.formations[t.formation] as { position: string; x: number; y: number }[];
  const rolesFor = (pos: string) => data.roles.filter((r: any) => r.positions.includes(pos));
  const update = (fn: (t: any) => void) => {
    const next = structuredClone(t);
    fn(next);
    setT(next);
    setDirty(true);
  };

  const kit = data.club.colors;
  const roleOf = (i: number) => t.roles[i] || rolesFor(formation[i].position)[0]?.id;
  const slots: BoardSlot[] = formation.map((s, i) => {
    const off = t.slotOffsets?.[i];
    const p = t.lineup[i] != null ? byId.get(t.lineup[i]) : null;
    const role = data.roles.find((r: any) => r.id === roleOf(i));
    const r = p ? p.ratings[s.position] : null;
    let meter: BoardSlot["meter"] = null;
    if (p && view === "kondition") meter = { value: p.fitness, label: `${p.fitness}%`, tone: p.fitness >= 85 ? "pos" : p.fitness >= 70 ? "warn" : "neg" };
    if (p && view === "moral") { const m = moraleLabel(p.morale); meter = { value: p.morale, label: m.text, tone: p.morale >= 60 ? "pos" : p.morale >= 35 ? "warn" : "neg" }; }
    if (p && view === "staerke") meter = { value: r!, label: `Stärke ${r}`, tone: r! >= p.rating - 2 ? "pos" : r! >= p.rating - 8 ? "warn" : "neg" };
    return {
      position: s.position,
      x: off?.x ?? s.x,
      y: off?.y ?? s.y,
      role: ROLE_CODE[role?.id] ?? POS_LABEL[s.position] ?? s.position,
      roleName: role?.name ?? POS_LABEL[s.position],
      group: GROUP[s.position] ?? "mid",
      name: p ? p.lastName : null,
      number: p ? numbers.get(p.id) ?? null : null,
      stars: r !== null ? starsFor(r) : null,
      meter,
      kit,
      warn: p && (p.injuryWeeks > 0 || p.suspendedWeeks > 0) ? (p.injuryWeeks > 0 ? "Verletzt" : "Gesperrt") : p && r! < p.rating - 10 ? "Ungewohnte Position" : null,
    };
  });

  function assign(playerId: number, slot: number | null = selected) {
    if (slot === null) {
      toast("Wähle zuerst eine Position auf der Taktiktafel.");
      return;
    }
    update((n) => {
      const prev = n.lineup[slot];
      const at = n.lineup.indexOf(playerId);
      if (at >= 0) n.lineup[at] = prev; // Tausch innerhalb der Elf
      n.lineup[slot] = playerId;
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
      // Sichtbare Standardrolle je Position übernehmen, damit Anzeige und Speicherstand übereinstimmen
      n.roles = newSlots.map((s) => rolesFor(s.position)[0]?.id ?? "");
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
          <p>Position anklicken und Spieler in der Liste wählen – oder Rechtsklick (am Handy lange drücken) für Rolle, Ersatz und Standards. Positionen lassen sich verschieben.</p>
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
            onSelect={(i) => { setMenu(null); setSelected(selected === i ? null : i); }}
            onMove={(i, x, y) => update((n) => {
              n.slotOffsets = n.slotOffsets ?? [];
              while (n.slotOffsets.length < 11) n.slotOffsets.push(null);
              n.slotOffsets[i] = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
            })}
            onContext={(i, x, y) => { setSelected(i); setMenu({ slot: i, x, y }); }}
            toolbar={(
              <div className="pitch-view">
                <button className="pitch-tool" onClick={() => setViewOpen(!viewOpen)} aria-haspopup="menu" aria-expanded={viewOpen} title="Ansicht wählen">
                  <Icon name="eye" size={17} /><span className="pitch-tool-label">{VIEW_LABEL[view]}</span><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
                </button>
                {viewOpen && (
                  <div className="ctx-menu pitch-view-menu" role="menu">
                    {(Object.keys(VIEW_LABEL) as ViewMode[]).map((v) => (
                      <button key={v} role="menuitemradio" aria-checked={view === v} className="ctx-item" onClick={() => { setView(v); setViewOpen(false); }}>
                        <span className="ctx-check">{view === v && <Icon name="check" size={13} />}</span>{VIEW_LABEL[v]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          />
          {menu && (
            <SlotMenu
              key={`${menu.slot}-${menu.x}-${menu.y}`}
              at={menu}
              position={formation[menu.slot].position}
              player={t.lineup[menu.slot] != null ? byId.get(t.lineup[menu.slot]) : null}
              roles={rolesFor(formation[menu.slot].position)}
              role={roleOf(menu.slot)}
              candidates={[...players].filter((p: any) => p.id !== t.lineup[menu.slot]).sort((a: any, b: any) => b.ratings[formation[menu.slot].position] - a.ratings[formation[menu.slot].position]).slice(0, 10)}
              status={(pid: number) => (t.lineup.includes(pid) ? "Elf" : t.bench.includes(pid) ? "Bank" : "")}
              setPieces={t.setPieces}
              moved={!!t.slotOffsets?.[menu.slot]}
              profileHref={(pid: number) => `/c/${id}/player/${pid}`}
              kit={kit}
              numbers={numbers}
              onClose={() => setMenu(null)}
              onRole={(r: string) => update((n) => { n.roles[menu.slot] = r; })}
              onReplace={(pid: number) => assign(pid, menu.slot)}
              onBench={() => update((n) => {
                const pid = n.lineup[menu.slot];
                n.lineup[menu.slot] = null;
                if (pid != null && !n.bench.includes(pid)) n.bench = [pid, ...n.bench].slice(0, 9);
              })}
              onSetPiece={(key: string, pid: number) => update((n) => { n.setPieces[key] = n.setPieces[key] === pid ? null : pid; })}
              onReset={() => update((n) => { if (n.slotOffsets) n.slotOffsets[menu.slot] = null; })}
            />
          )}
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
                        <div className="face-card" style={{ gap: 8 }}>
                          <PlayerFace player={p} kit={data.club?.colors} size={26} />
                          <div style={{ minWidth: 0 }}>
                            <div className="truncate name" style={{ maxWidth: 140 }}>{p.name}</div>
                            {unavailable && <div className="small neg-txt">{p.injuryWeeks > 0 ? `Verletzt · ${p.injuryWeeks} W` : "Gesperrt"}</div>}
                          </div>
                        </div>
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

type ViewMode = "eignung" | "kondition" | "moral" | "staerke";
const VIEW_LABEL: Record<ViewMode, string> = { eignung: "Eignung", kondition: "Kondition", moral: "Moral", staerke: "Stärke" };

/** Kurzbezeichnungen der Rollen für den Kartenkopf. */
const ROLE_CODE: Record<string, string> = {
  gk: "TW", sweeper_keeper: "MTW", cb: "IV", bpd: "BIV", fb: "AV", wb: "FV", anchor: "AB", dlp: "TSM", b2b: "BTB",
  playmaker: "SM", winger: "FL", wide_mid: "BM", inside_fwd: "IF", am: "OM", poacher: "KN", target: "ZS", complete_fwd: "KS", false9: "F9",
};
const GROUP: Record<string, SlotGroup> = {
  GK: "gk", DC: "def", DR: "def", DL: "def", DM: "mid", MC: "mid", MR: "mid", ML: "mid", AMC: "att", AMR: "att", AML: "att", ST: "att",
};
const SET_PIECES: [string, string, string][] = [["penaltyTaker", "Elfmeterschütze", "penalties"], ["freeKickTaker", "Freistossschütze", "freeKicks"], ["cornerTaker", "Eckenschütze", "corners"]];

/** Eignung als Sterne (halbe Schritte): 45 ≈ 0, 90 ≈ 5 Sterne. */
function starsFor(rating: number) {
  return Math.max(0.5, Math.min(5, Math.round(((rating - 45) / 9) * 2) / 2));
}

/** Rückennummern: klassische Nummern je Mannschaftsteil, Beste zuerst. */
function squadNumbers(players: any[]): Map<number, number> {
  const pools: Record<string, number[]> = {
    gk: [1, 12, 25, 31, 40], def: [2, 3, 4, 5, 15, 16, 22, 24, 26, 28, 33, 35], mid: [6, 8, 10, 14, 17, 18, 20, 23, 30, 32, 34, 36], att: [9, 7, 11, 19, 21, 27, 29, 37, 38, 39],
  };
  const used = new Set<number>();
  const out = new Map<number, number>();
  for (const g of ["gk", "def", "mid", "att"] as const) {
    const list = players.filter((p) => (GROUP[p.position] ?? "mid") === g).sort((a, b) => b.rating - a.rating || a.id - b.id);
    for (const p of list) {
      let n = pools[g].find((x) => !used.has(x));
      if (n === undefined) { n = 41; while (used.has(n)) n++; }
      used.add(n);
      out.set(p.id, n);
    }
  }
  return out;
}

/** Kontextmenü einer Position: Rolle, Ersatz, Bank, Standards (Untermenüs wie im Manager-Spiel). */
function SlotMenu(props: {
  at: { x: number; y: number }; position: string; player: any | null; roles: any[]; role: string; candidates: any[];
  status: (pid: number) => string; setPieces: any; moved: boolean; profileHref: (pid: number) => string; kit: any; numbers: Map<number, number>;
  onClose: () => void; onRole: (r: string) => void; onReplace: (pid: number) => void; onBench: () => void; onSetPiece: (key: string, pid: number) => void; onReset: () => void;
}) {
  const { at, position, player: p, roles, role, candidates, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<"role" | "replace" | "set" | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; flip: boolean; narrow: boolean }>({ left: at.x, top: at.y, flip: false, narrow: false });

  useLayoutEffect(() => {
    const narrow = window.innerWidth < 640;
    const w = ref.current?.offsetWidth ?? 260;
    const h = ref.current?.offsetHeight ?? 320;
    const left = Math.max(8, Math.min(at.x, window.innerWidth - w - 8));
    const top = Math.max(8, Math.min(at.y, window.innerHeight - h - 8));
    setPlace({ left, top, flip: left + w * 2 + 16 > window.innerWidth, narrow });
  }, [at.x, at.y]);

  useEffect(() => {
    const down = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => { document.addEventListener("mousedown", down); document.addEventListener("touchstart", down); }, 0);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", down); document.removeEventListener("touchstart", down); document.removeEventListener("keydown", key); window.removeEventListener("resize", onClose); };
  }, [onClose]);

  const act = (fn: () => void) => { fn(); onClose(); };
  const roleName = roles.find((r) => r.id === role)?.name ?? "–";
  const takerCount = p ? SET_PIECES.filter(([k]) => props.setPieces[k] === p.id).length : 0;

  const subPanel = sub && (
    <div className="ctx-panel ctx-sub" role="menu">
      {place.narrow && <button className="ctx-item ctx-back" onClick={() => setSub(null)}><Icon name="back" size={13} /> Zurück</button>}
      {sub === "role" && roles.map((r) => (
        <button key={r.id} role="menuitemradio" aria-checked={r.id === role} className="ctx-item ctx-two" onClick={() => act(() => props.onRole(r.id))}>
          <span className="ctx-check">{r.id === role && <Icon name="check" size={13} />}</span>
          <span><b>{r.name}</b> <span className="ctx-code">{ROLE_CODE[r.id]}</span><small>{r.description}</small></span>
        </button>
      ))}
      {sub === "replace" && candidates.map((c) => {
        const out = c.injuryWeeks > 0 || c.suspendedWeeks > 0;
        const st = props.status(c.id);
        return (
          <button key={c.id} role="menuitem" className="ctx-item ctx-player" disabled={out} onClick={() => act(() => props.onReplace(c.id))}>
            <span className="ctx-num">{props.numbers.get(c.id) ?? ""}</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <b className="truncate" style={{ display: "block" }}>{c.name}</b>
              <small>{POS_LABEL[c.position] ?? c.position}{st ? ` · ${st === "Elf" ? "Startelf (Tausch)" : "Bank"}` : ""}{out ? ` · ${c.injuryWeeks > 0 ? "verletzt" : "gesperrt"}` : ` · Kondition ${c.fitness}%`}</small>
            </span>
            <Stars value={starsFor(c.ratings[position])} />
          </button>
        );
      })}
      {sub === "set" && p && SET_PIECES.map(([k, label, attr]) => (
        <button key={k} role="menuitemcheckbox" aria-checked={props.setPieces[k] === p.id} className="ctx-item" onClick={() => act(() => props.onSetPiece(k, p.id))}>
          <span className="ctx-check">{props.setPieces[k] === p.id && <Icon name="check" size={13} />}</span>{label}<span className="ctx-hint">{p.attrs?.[attr] ?? ""}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div ref={ref} className={`ctx-menu slot-menu ${place.flip ? "flip" : ""} ${place.narrow ? "narrow" : ""}`} style={place.narrow ? undefined : { left: place.left, top: place.top }} role="menu" aria-label="Positionsmenü"
      onContextMenu={(e) => e.preventDefault()}>
      {!(place.narrow && sub) && (
        <div className="ctx-panel">
          <div className="ctx-head">
            <span className={`fm-role g-${GROUP[position] ?? "mid"}`}>{ROLE_CODE[role] ?? POS_LABEL[position]}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <b className="truncate" style={{ display: "block" }}>{p ? p.name : "Position frei"}</b>
              <small>{POS_LABEL[position] ?? position}{p ? ` · Eignung ${p.ratings[position]}` : ""}</small>
            </div>
            {p && <Stars value={starsFor(p.ratings[position])} />}
          </div>
          <button className={`ctx-item ctx-more ${sub === "role" ? "open" : ""}`} onClick={() => setSub(sub === "role" ? null : "role")} onMouseEnter={() => !place.narrow && setSub("role")}>
            <Icon name="board" size={14} /><span>Rolle<small>{roleName}</small></span><span className="ctx-arrow">›</span>
          </button>
          <button className={`ctx-item ctx-more ${sub === "replace" ? "open" : ""}`} onClick={() => setSub(sub === "replace" ? null : "replace")} onMouseEnter={() => !place.narrow && setSub("replace")}>
            <Icon name="swap" size={14} /><span>{p ? "Spieler ersetzen" : "Spieler einsetzen"}</span><span className="ctx-arrow">›</span>
          </button>
          {p && (
            <button className={`ctx-item ctx-more ${sub === "set" ? "open" : ""}`} onClick={() => setSub(sub === "set" ? null : "set")} onMouseEnter={() => !place.narrow && setSub("set")}>
              <Icon name="flag" size={14} /><span>Standards{takerCount ? <small>{takerCount} Aufgabe{takerCount > 1 ? "n" : ""}</small> : null}</span><span className="ctx-arrow">›</span>
            </button>
          )}
          <div className="ctx-sep" />
          {p && <Link className="ctx-item" href={props.profileHref(p.id)} onMouseEnter={() => setSub(null)}><Icon name="users" size={14} /><span>Spielerprofil öffnen</span></Link>}
          {p && <button className="ctx-item" onMouseEnter={() => setSub(null)} onClick={() => act(props.onBench)}><Icon name="down" size={14} /><span>Auf die Bank setzen</span></button>}
          {props.moved && <button className="ctx-item" onMouseEnter={() => setSub(null)} onClick={() => act(props.onReset)}><Icon name="target" size={14} /><span>Position zurücksetzen</span></button>}
          <button className="ctx-item" onMouseEnter={() => setSub(null)} onClick={onClose}><Icon name="close" size={14} /><span>Schliessen</span></button>
        </div>
      )}
      {subPanel}
    </div>
  );
}
