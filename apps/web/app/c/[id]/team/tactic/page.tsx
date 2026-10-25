"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { POS_LABEL } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { shapePositions, tacticIntensity } from "@fl/sim";
import { PitchBoard, Stars, type BoardSlot, type SlotGroup } from "@/components/PitchBoard";
import { Select } from "@/components/Select";
import { Sheet } from "@/components/Sheet";
import { Condition, ErrorBox, Icon, Loading, Panel, Seg, moraleLabel, useNotes, useToast } from "@/components/ui";
import { PlayerFace } from "@/components/PlayerFace";
import { useConfirm, usePrompt } from "@/components/Dialog";

export default function TacticPage() {
  const { id } = useGame();
  const toast = useToast();
  const ask = useConfirm();
  const askText = usePrompt();
  const showNotes = useNotes();
  const { data, error, reload } = useApi<any>(`careers/${id}/tactic`);
  const [t, setT] = useState<any | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<ViewMode>("eignung");
  const [viewOpen, setViewOpen] = useState(false);
  const [menu, setMenu] = useState<{ slot: number; x: number; y: number } | null>(null);
  const [phase, setPhase] = useState<Phase>("base");
  const [sheet, setSheet] = useState<SheetKey | null>(null);
  const anchors = useRef<Record<SheetKey, HTMLButtonElement | null>>({ attack: null, defend: null, set: null });

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
  // Grundordnung (inkl. verschobener Positionen) und daraus die Laufwege mit/gegen den Ball
  const base = formation.map((s, i) => ({ position: s.position as any, x: t.slotOffsets?.[i]?.x ?? s.x, y: t.slotOffsets?.[i]?.y ?? s.y }));
  const roleIds = formation.map((_, i) => roleOf(i));
  const extra = { duties: t.duties, instructions: t.instructions, mentality: t.mentality ?? 0 };
  const shown = phase === "base" ? base : shapePositions(base, roleIds, t.style, phase === "defend" ? "defend" : "attack", extra);
  const ghosts = phase === "both" ? shapePositions(base, roleIds, t.style, "defend", extra) : null;
  const slots: BoardSlot[] = formation.map((s, i) => {
    const p = t.lineup[i] != null ? byId.get(t.lineup[i]) : null;
    const role = data.roles.find((r: any) => r.id === roleOf(i));
    const r = p ? p.ratings[s.position] : null;
    let meter: BoardSlot["meter"] = null;
    if (p && view === "kondition") meter = { value: p.fitness, label: `${p.fitness}%`, tone: p.fitness >= 85 ? "pos" : p.fitness >= 70 ? "warn" : "neg" };
    if (p && view === "moral") { const m = moraleLabel(p.morale); meter = { value: p.morale, label: m.text, tone: p.morale >= 60 ? "pos" : p.morale >= 35 ? "warn" : "neg" }; }
    if (p && view === "staerke") meter = { value: r!, label: `Stärke ${r}`, tone: r! >= p.rating - 2 ? "pos" : r! >= p.rating - 8 ? "warn" : "neg" };
    return {
      position: s.position,
      x: shown[i].x,
      y: shown[i].y,
      role: `${ROLE_CODE[role?.id] ?? POS_LABEL[s.position] ?? s.position}${t.duties?.[i] ? `-${data.duties[t.duties[i]].short}` : ""}${t.instructions?.[i]?.length ? " •" : ""}`,
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
      n.duties = [];
      n.instructions = [];
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
  const lineupPlayers = t.lineup.map((pid: number | null) => (pid != null ? byId.get(pid) : null)).filter(Boolean);
  // Pkd wie im Manager-Spiel: Position in der Elf, S1–S9 auf der Bank
  const picked = (pid: number): { label: string; group: SlotGroup | "sub"; order: number } | null => {
    const at = t.lineup.indexOf(pid);
    if (at >= 0) return { label: POS_LABEL[formation[at].position] ?? formation[at].position, group: GROUP[formation[at].position] ?? "mid", order: at };
    const b = t.bench.indexOf(pid);
    return b >= 0 ? { label: `S${b + 1}`, group: "sub", order: 20 + b } : null;
  };
  const fitFor = (p: any) => {
    if (selPos) return p.ratings[selPos];
    const at = t.lineup.indexOf(p.id);
    return at >= 0 ? p.ratings[formation[at].position] : p.rating;
  };
  const out = (p: any) => p.injuryWeeks > 0 || p.suspendedWeeks > 0;
  const sortedPlayers = [...players].sort((a: any, b: any) => {
    if (selPos) return Number(out(a)) - Number(out(b)) || b.ratings[selPos] - a.ratings[selPos] || b.fitness - a.fitness;
    return (picked(a.id)?.order ?? 99) - (picked(b.id)?.order ?? 99) || b.rating - a.rating;
  });
  const styleSummary = (keys: string[]) => keys.map((k) => `${data.styleLabels[k][0]} ${t.style[k]}`).slice(0, 3).join(" · ");
  const sliders = (keys: string[]) => (
    <div className="stack">
      {keys.map((k) => {
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
  );
  // Aktive Spielidee: Vorlage, deren Werte exakt der Taktik entsprechen – sonst individuell
  const presetKey = Object.entries(data.presets).find(([, v]: [string, any]) => Object.keys(v.style).every((k) => v.style[k] === t.style[k]))?.[0] ?? "custom";
  const intensity = tacticIntensity(t.style, t.mentality ?? 0, t.instructions);
  async function slotAction(action: string, index?: number, name?: string) {
    if (action !== "rename" && dirty && !(await ask({ title: "Ungespeicherte Änderungen verwerfen?", message: "Deine letzten Änderungen an dieser Taktik sind noch nicht gespeichert.", danger: true, confirmLabel: "Verwerfen" }))) return;
    if (action === "delete" && !(await ask({ title: `„${data.tactics.slots[index ?? 0]?.name ?? "Taktik"}“ löschen?`, message: "Formation, Aufstellung und alle Anweisungen dieser Taktik gehen verloren.", danger: true, confirmLabel: "Taktik löschen" }))) return;
    try {
      const r = await api<any>(`careers/${id}/tactic/slot`, { body: { action, index, name } });
      toast(r.message, "success");
      setSelected(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  const openSheet = (k: SheetKey) => {
    const opening = sheet !== k;
    setSheet(opening ? k : null);
    // Die Tafel zeigt gleich die passende Phase, damit Regleränderungen sichtbar werden
    if (opening && k !== "set") setPhase(k);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Taktik</h1>
          <p>Position anklicken und Spieler in der Liste wählen – oder Rechtsklick (am Handy lange drücken) für Rolle, Pflicht, Anweisungen und Ersatz.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={autoPick}>Auto-Aufstellung</button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>{saving ? "Speichere …" : dirty ? "Speichern" : "Gespeichert"}</button>
        </div>
      </div>

      <section className="card tactic-header">
        <div className="th-row">
          <div className="tactic-slots" role="tablist" aria-label="Taktiken">
            {data.tactics.slots.map((x: any) => (
              <div key={x.index} className={`tactic-slot ${x.index === data.tactics.active ? "active" : ""}`}>
                <button role="tab" aria-selected={x.index === data.tactics.active} className="tactic-slot-main" onClick={() => slotAction("select", x.index)}>
                  <span className="tactic-slot-no">{x.index + 1}</span>
                  <span className="tactic-slot-text"><b>{x.name}</b><small>{x.index === data.tactics.active ? t.formation : x.formation} · {x.index === data.tactics.active ? (presetKey === "custom" ? "Individuell" : data.presets[presetKey].name) : x.preset}</small></span>
                </button>
                {x.index === data.tactics.active && (
                  <>
                    <button className="tactic-slot-tool" title="Umbenennen" aria-label="Taktik umbenennen" onClick={async () => { const name = await askText({ title: "Taktik umbenennen", defaultValue: x.name, placeholder: "z. B. Gegenpressing 4-3-3", maxLength: 30, confirmLabel: "Umbenennen" }); if (name) slotAction("rename", x.index, name); }}><Icon name="contract" size={13} /></button>
                    {data.tactics.slots.length > 1 && <button className="tactic-slot-tool" title="Löschen" aria-label="Taktik löschen" onClick={() => slotAction("delete", x.index)}><Icon name="close" size={13} /></button>}
                  </>
                )}
              </div>
            ))}
            {data.tactics.slots.length < data.tactics.max && (
              <button className="tactic-slot-add" onClick={() => slotAction("add")} title="Neue Taktik (Kopie der aktiven)" aria-label="Neue Taktik"><Icon name="plus" size={15} /></button>
            )}
          </div>
          <div className="tactic-meters">
            <Meter label="Vertrautheit" value={data.familiarity.total} tone="fam" title={`Formation ${data.familiarity.formation} % · Spielweise ${data.familiarity.style} % – steigt durch Training und Spiele`} />
            <Meter label="Intensität" value={intensity} tone="int" title="Wie sehr die Spielweise an der Kraft zehrt (Pressing, Tempo, Mentalität)" />
          </div>
        </div>
        <div className="th-row th-controls">
          <Select label="Formation" suffix="Formation" value={t.formation} menuWidth={230} onChange={(f) => changeFormation(f)}
            options={Object.keys(data.formations).map((f) => ({ value: f, label: f, icon: <FormationIcon slots={data.formations[f]} />, description: formationText(data.formations[f]) }))} />
          <Select label="Spielidee" suffix="Spielidee" value={presetKey} menuWidth={300}
            onChange={(k) => { const v = data.presets[k]; if (v) update((n) => { n.style = { ...v.style }; n.mentality = v.mentality ?? 0; }); }}
            options={[
              ...Object.entries(data.presets).map(([k, v]: [string, any]) => ({ value: k, label: v.name, description: styleText(v.style) })),
              ...(presetKey === "custom" ? [{ value: "custom", label: "Individuell", description: styleText(t.style) }] : []),
            ]} />
          <Select label="Mentalität" suffix="Mentalität" value={String(t.mentality ?? 0)} menuWidth={260}
            onChange={(v) => update((n) => { n.mentality = Number(v); })}
            options={["-3", "-2", "-1", "0", "1", "2", "3"].map((k) => ({ value: k, label: data.mentalities[k], description: MENTALITY_TEXT[k], icon: <MentalityIcon level={Number(k)} /> }))} />
          <span className="th-sep" aria-hidden="true" />
          {([
            ["attack", "ball", "Mit Ball", ATTACK_KEYS],
            ["defend", "shield", "Gegen den Ball", DEFEND_KEYS],
          ] as [SheetKey, string, string, string[]][]).map(([k, icon, label, keys]) => (
            <button key={k} ref={(el) => { anchors.current[k] = el; }} className={`tactic-pill ${sheet === k ? "open" : ""}`} onClick={() => openSheet(k)} aria-expanded={sheet === k} title={styleSummary(keys)}>
              <Icon name={icon} size={15} /><b>{label}</b><small>{styleSummary(keys)}</small>
              <svg className="fl-select-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>
            </button>
          ))}
          <button ref={(el) => { anchors.current.set = el; }} className={`tactic-pill ${sheet === "set" ? "open" : ""}`} onClick={() => openSheet("set")} aria-expanded={sheet === "set"} title={CORNER_LABEL[t.setPieces.corners]}>
            <Icon name="flag" size={15} /><b>Standards</b><small>{CORNER_LABEL[t.setPieces.corners]}</small>
            <svg className="fl-select-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>
          </button>
        </div>
      </section>

      <Sheet open={sheet === "attack"} anchor={anchors.current.attack} title="Anweisungen mit Ball" onClose={() => setSheet(null)}>
        {sliders(ATTACK_KEYS)}
        <p className="faint small" style={{ marginBottom: 0 }}>Breite und Risiko verändern die Laufwege – sieh dir die Wirkung in der Ansicht „Mit Ball“ an.</p>
      </Sheet>
      <Sheet open={sheet === "defend"} anchor={anchors.current.defend} title="Anweisungen gegen den Ball" onClose={() => setSheet(null)}>
        {sliders(DEFEND_KEYS)}
        <p className="faint small" style={{ marginBottom: 0 }}>Die Abwehrlinie schiebt die ganze Mannschaft – sichtbar in der Ansicht „Gegen den Ball“.</p>
      </Sheet>
      <Sheet open={sheet === "set"} anchor={anchors.current.set} title="Standards" onClose={() => setSheet(null)}>
        <div className="stack">
          <div className="field">
            <label>Eckbälle</label>
            <Select label="Eckbälle" value={t.setPieces.corners} onChange={(v) => update((n) => { n.setPieces.corners = v; })}
              options={Object.entries(CORNER_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
          </div>
          {[["cornerTaker", "Eckenschütze", "corners"], ["freeKickTaker", "Freistossschütze", "freeKicks"], ["penaltyTaker", "Elfmeterschütze", "penalties"]].map(([key, label, attr]) => (
            <div key={key} className="field">
              <label>{label}</label>
              <Select label={label} value={String(t.setPieces[key] ?? "auto")} onChange={(v) => update((n) => { n.setPieces[key] = v === "auto" ? null : Number(v); })}
                options={[{ value: "auto", label: "Automatisch", description: "Der beste Schütze auf dem Platz" },
                  ...[...lineupPlayers].sort((a: any, b: any) => b.attrs[attr] - a.attrs[attr]).map((p: any) => ({ value: String(p.id), label: p.name, description: `${label.replace("schütze", "")}: ${p.attrs[attr]}` }))]} />
            </div>
          ))}
        </div>
      </Sheet>

      <div className="grid grid-tactic">
        <Panel title={`Formation ${t.formation}`} icon="board" actions={phase === "base" && t.slotOffsets?.some(Boolean) && <button className="btn btn-ghost btn-sm" onClick={() => update((n) => { n.slotOffsets = []; })}>Zurücksetzen</button>}>
          <div className="phase-tabs">
            <Seg value={phase} onChange={(v) => setPhase(v)} options={[
              { value: "base", label: "Grundordnung" },
              { value: "attack", label: "Mit Ball" },
              { value: "defend", label: "Gegen den Ball" },
              { value: "both", label: "Beide" },
            ]} />
            {phase !== "base" && (
              <button className="btn btn-ghost btn-sm" onClick={() => openSheet(phase === "defend" ? "defend" : "attack")} ref={undefined}>
                <Icon name={phase === "defend" ? "shield" : "ball"} size={14} /> Anweisungen
              </button>
            )}
          </div>
          <PitchBoard
            slots={slots}
            selected={selected}
            ghosts={ghosts}
            onSelect={(i) => { setMenu(null); setSelected(selected === i ? null : i); }}
            onMove={phase === "base" ? (i, x, y) => update((n) => {
              n.slotOffsets = n.slotOffsets ?? [];
              while (n.slotOffsets.length < 11) n.slotOffsets.push(null);
              n.slotOffsets[i] = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
            }) : undefined}
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
          <p className="faint small" style={{ margin: "10px 2px 0" }}>{PHASE_HINT[phase]}</p>
          {menu && (
            <SlotMenu
              key={`${menu.slot}-${menu.x}-${menu.y}`}
              at={menu}
              position={formation[menu.slot].position}
              player={t.lineup[menu.slot] != null ? byId.get(t.lineup[menu.slot]) : null}
              roles={rolesFor(formation[menu.slot].position)}
              role={roleOf(menu.slot)}
              candidates={[...players].filter((p: any) => p.id !== t.lineup[menu.slot]).sort((a: any, b: any) => Number(out(a)) - Number(out(b)) || b.ratings[formation[menu.slot].position] - a.ratings[formation[menu.slot].position] || b.fitness - a.fitness).slice(0, 12)}
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
              duty={t.duties?.[menu.slot] ?? null}
              dutyLabels={data.duties}
              onDuty={(d: string) => update((n) => { n.duties = fill(n.duties, 11, null); n.duties[menu.slot] = d === "support" ? null : d; })}
              instructions={t.instructions?.[menu.slot] ?? []}
              instructionLabels={data.instructions}
              onInstruction={(k: string) => update((n) => {
                n.instructions = fill(n.instructions, 11, null).map((x: any) => x ?? []);
                let list: string[] = n.instructions[menu.slot];
                if (list.includes(k)) list = list.filter((x) => x !== k);
                else {
                  // Widersprüche auflösen, höchstens drei Anweisungen
                  for (const [a, b] of data.conflicts as [string, string][]) { if (k === a) list = list.filter((x) => x !== b); if (k === b) list = list.filter((x) => x !== a); }
                  list = [...list, k].slice(-3);
                }
                n.instructions[menu.slot] = list;
              })}
            />
          )}
          {selected !== null && (
            <div className="card-soft stack-sm" style={{ marginTop: 12 }}>
              <div className="between"><span className="faint small up">Rolle · {POS_LABEL[formation[selected].position]}</span><button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>Fertig</button></div>
              <Select label="Rolle" value={roleOf(selected)} onChange={(v) => update((n) => { n.roles[selected] = v; })}
                options={rolesFor(formation[selected].position).map((r: any) => ({ value: r.id, label: `${r.name} (${ROLE_CODE[r.id] ?? ""})`, description: r.description }))} />
            </div>
          )}
        </Panel>

        <Panel className="cand-panel" title={selPos ? `Kandidaten · ${POS_LABEL[selPos]}` : "Kader"} icon="users" flush actions={<span className="faint small">Bank {t.bench.length}/9</span>}>
          <div className="cand-body"><div className="cand-wrap">
            <table className="table cand-table">
              <thead><tr><th>Pkd</th><th className="hide-sm">Pos</th><th>Spieler</th><th>{selPos ? `Eignung ${POS_LABEL[selPos]}` : "Eignung"}</th><th className="c hide-sm">Kond.</th><th className="c hide-sm">Moral</th><th className="r" /></tr></thead>
              <tbody>
                {sortedPlayers.map((p: any) => {
                  const unavailable = out(p);
                  const pk = picked(p.id);
                  const status = inLineup.has(p.id) ? "Elf" : t.bench.includes(p.id) ? "Bank" : "";
                  const fit = fitFor(p);
                  const mor = moraleLabel(p.morale);
                  return (
                    <tr key={p.id} className={`clickable ${status === "Elf" ? "highlight" : ""}`} style={{ opacity: unavailable ? 0.45 : 1 }} onClick={() => !unavailable && assign(p.id)}>
                      <td>{pk ? <span className={`pkd ${pk.group === "sub" ? "sub" : `g-${pk.group}`}`}>{pk.label}</span> : <span className="pkd none">–</span>}</td>
                      <td className="hide-sm"><span className="faint small cond">{POS_LABEL[p.position] ?? p.position}</span></td>
                      <td>
                        <div className="face-card" style={{ gap: 8 }}>
                          <span className="cand-num">{numbers.get(p.id)}</span>
                          <PlayerFace player={p} kit={data.club?.colors} size={26} />
                          <div style={{ minWidth: 0 }}>
                            <div className="truncate name" style={{ maxWidth: 150 }}>{p.name}</div>
                            {unavailable && <div className="small neg-txt">{p.injuryWeeks > 0 ? `Verletzt · ${p.injuryWeeks} W` : "Gesperrt"}</div>}
                          </div>
                        </div>
                      </td>
                      <td><span className="cand-stars" title={`Eignung ${fit}`}><Stars value={starsFor(fit)} /><b>{fit}</b></span></td>
                      <td className="c hide-sm"><Condition value={p.fitness} /></td>
                      <td className="c hide-sm"><span className="mor-dot" style={{ background: mor.color }} title={mor.text} /></td>
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
          </div></div>
        </Panel>
      </div>
    </>
  );
}

function fill<T>(arr: T[] | undefined, n: number, v: T): T[] {
  const out = [...(arr ?? [])];
  while (out.length < n) out.push(v);
  return out;
}
const MENTALITY_TEXT: Record<string, string> = {
  "-3": "Alles hinter den Ball, nur kontern", "-2": "Tief stehen, wenig Risiko", "-1": "Kontrolliert, Absicherung zuerst", "0": "Gleichgewicht aus Angriff und Abwehr",
  "1": "Mutig nach vorne, höhere Linie", "2": "Druck machen, viele Spieler im Angriff", "3": "Alles nach vorne – hohes Risiko",
};
function MentalityIcon({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 28 10" width="28" height="10" aria-hidden="true">
      {[-3, -2, -1, 0, 1, 2, 3].map((l, i) => <rect key={l} x={i * 4} y={2} width="3" height="6" rx="1" fill={l === level ? (level < 0 ? "#3b82f6" : level > 0 ? "#ef4444" : "#e5e7eb") : "rgba(255,255,255,0.18)"} />)}
    </svg>
  );
}
function Meter({ label, value, tone, title }: { label: string; value: number; tone: "fam" | "int"; title: string }) {
  const segs = 10;
  const on = Math.round((value / 100) * segs);
  return (
    <div className={`meter meter-${tone}`} title={title} aria-label={`${label}: ${value} %`}>
      <span className="meter-label">{label}<b>{value}%</b></span>
      <span className="meter-segs">{Array.from({ length: segs }, (_, i) => <i key={i} className={i < on ? "on" : ""} />)}</span>
    </div>
  );
}
const STYLE_SHORT: Record<string, string> = { tempo: "Tempo", passLength: "Pässe", width: "Breite", risk: "Risiko", pressing: "Pressing", defensiveLine: "Linie", hardness: "Härte" };
function styleText(style: Record<string, number>) {
  return ["tempo", "passLength", "width", "pressing", "defensiveLine"].map((k) => `${STYLE_SHORT[k]} ${style[k]}`).join(" · ");
}
function formationText(slots: { position: string }[]) {
  const back = slots.filter((s) => ["DC", "DR", "DL"].includes(s.position)).length;
  const top = slots.filter((s) => s.position === "ST").length;
  return `${back}er-Kette · ${top === 1 ? "eine Spitze" : `${top} Spitzen`}`;
}
function FormationIcon({ slots }: { slots: { x: number; y: number; position: string }[] }) {
  return (
    <svg viewBox="0 0 30 40" width="22" height="30" aria-hidden="true" className="formation-icon">
      <rect x="0.5" y="0.5" width="29" height="39" rx="2" fill="#1d4d3f" stroke="rgba(255,255,255,0.35)" />
      <line x1="0.5" y1="20" x2="29.5" y2="20" stroke="rgba(255,255,255,0.3)" strokeWidth="0.6" />
      {slots.map((s, i) => <circle key={i} cx={2 + s.y * 26} cy={38 - s.x * 36} r="1.9" fill={s.position === "GK" ? "#f3c945" : "#fff"} />)}
    </svg>
  );
}

type Phase = "base" | "attack" | "defend" | "both";
type SheetKey = "attack" | "defend" | "set";
const ATTACK_KEYS = ["tempo", "passLength", "width", "risk"];
const DEFEND_KEYS = ["pressing", "defensiveLine", "hardness"];
const CORNER_LABEL: Record<string, string> = { far: "Hoch an den zweiten Pfosten", near: "Scharf an den ersten Pfosten", short: "Kurz ausführen" };
const PHASE_HINT: Record<Phase, string> = {
  base: "Grundordnung: Positionen lassen sich per Ziehen verschieben.",
  attack: "Mit Ball: So rücken die Spieler bei eigenem Ballbesitz auf – abhängig von Rolle, Breite, Risiko und Abwehrlinie.",
  defend: "Gegen den Ball: So formiert sich die Mannschaft ohne Ball – abhängig von Breite und Abwehrlinie.",
  both: "Beide: Karten zeigen die Position mit Ball, die Punkte den Platz gegen den Ball.",
};

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
  duty: string | null; dutyLabels: Record<string, { name: string; short: string; text: string }>; onDuty: (d: string) => void;
  instructions: string[]; instructionLabels: Record<string, { name: string; text: string }>; onInstruction: (k: string) => void;
}) {
  const { at, position, player: p, roles, role, candidates, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<"role" | "duty" | "pi" | "replace" | "set" | null>(null);
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
      {sub === "duty" && Object.entries(props.dutyLabels).map(([k, d]) => (
        <button key={k} role="menuitemradio" aria-checked={(props.duty ?? "support") === k} className="ctx-item ctx-two" onClick={() => act(() => props.onDuty(k))}>
          <span className="ctx-check">{(props.duty ?? "support") === k && <Icon name="check" size={13} />}</span>
          <span><b>{d.name}</b> <span className="ctx-code">{d.short}</span><small>{d.text}</small></span>
        </button>
      ))}
      {sub === "pi" && Object.entries(props.instructionLabels).map(([k, d]) => (
        <button key={k} role="menuitemcheckbox" aria-checked={props.instructions.includes(k)} className="ctx-item ctx-two" onClick={() => props.onInstruction(k)}>
          <span className="ctx-check">{props.instructions.includes(k) && <Icon name="check" size={13} />}</span>
          <span><b>{d.name}</b><small>{d.text}</small></span>
        </button>
      ))}
      {sub === "pi" && <div className="faint small" style={{ padding: "4px 10px 6px" }}>Bis zu drei Anweisungen; widersprüchliche ersetzen sich.</div>}
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
          {position !== "GK" && (
            <button className={`ctx-item ctx-more ${sub === "duty" ? "open" : ""}`} onClick={() => setSub(sub === "duty" ? null : "duty")} onMouseEnter={() => !place.narrow && setSub("duty")}>
              <Icon name="target" size={14} /><span>Pflicht<small>{props.dutyLabels[props.duty ?? "support"]?.name}</small></span><span className="ctx-arrow">›</span>
            </button>
          )}
          {position !== "GK" && (
            <button className={`ctx-item ctx-more ${sub === "pi" ? "open" : ""}`} onClick={() => setSub(sub === "pi" ? null : "pi")} onMouseEnter={() => !place.narrow && setSub("pi")}>
              <Icon name="info" size={14} /><span>Spieleranweisungen<small>{props.instructions.length ? props.instructions.map((k) => props.instructionLabels[k]?.name).join(", ") : "keine"}</small></span><span className="ctx-arrow">›</span>
            </button>
          )}
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
