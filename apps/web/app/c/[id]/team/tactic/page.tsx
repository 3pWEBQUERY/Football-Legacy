"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { shapePositions, tacticIntensity } from "@fl/sim";
import { useConfirm, usePrompt } from "@/components/Dialog";
import { useGame } from "@/components/GameShell";
import { PitchBoard, Stars, type BoardSlot, type SlotGroup } from "@/components/PitchBoard";
import { PlayerFace } from "@/components/PlayerFace";
import { StatusIcons, playerStatus } from "@/components/PlayerStatus";
import { Select } from "@/components/Select";
import { Sheet } from "@/components/Sheet";
import { Condition, ErrorBox, Icon, Loading, Panel, Seg, moraleLabel, useNotes, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/client/api";
import { POS_LABEL } from "@/lib/client/format";
import { ATTACK_KEYS, CORNER_LABEL, DEFEND_KEYS, FormationIcon, GROUP, MENTALITY_TEXT, MentalityIcon, Meter, PHASE_HINT, ROLE_CODE, SlotMenu, VIEW_LABEL, fill, formationText, squadNumbers, starsFor, styleText, type Phase, type SheetKey, type ViewMode } from "@/components/TacticParts";

/** Nicht einsatzfähig: verletzt oder gesperrt. */
const out = (p: any) => p.injuryWeeks > 0 || p.suspendedWeeks > 0;

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
      warn: p && !out(p) && r! < p.rating - 10 ? "Ungewohnte Position" : null,
      badges: playerStatus(p),
      out: !!p && out(p),
    };
  });

  const absentXI = t.lineup.map((pid: number | null) => (pid != null ? byId.get(pid) : null)).filter((p: any) => p && out(p));
  const absentBench = t.bench.map((pid: number) => byId.get(pid)).filter((p: any) => p && out(p));

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

  /** Verletzte und gesperrte Spieler durch die besten verfügbaren ersetzen (Bank zuerst). */
  function replaceAbsent() {
    update((n) => {
      const slotsF = data.formations[n.formation] as { position: string }[];
      const taken = new Set<number>(n.lineup.filter((x: number | null) => x != null && !out(byId.get(x))));
      n.lineup = n.lineup.map((pid: number | null, i: number) => {
        if (pid != null && !out(byId.get(pid))) return pid;
        const pos = slotsF[i].position;
        const best = players.filter((p: any) => !out(p) && !taken.has(p.id))
          .sort((a: any, b: any) => (b.ratings[pos] + (n.bench.includes(b.id) ? 2 : 0)) - (a.ratings[pos] + (n.bench.includes(a.id) ? 2 : 0)))[0];
        if (best) taken.add(best.id);
        return best?.id ?? null;
      });
      n.bench = n.bench.filter((b: number) => !taken.has(b) && !out(byId.get(b)));
      const rest = players.filter((p: any) => !out(p) && !taken.has(p.id) && !n.bench.includes(p.id)).sort((a: any, b: any) => b.rating - a.rating);
      while (n.bench.length < 9 && rest.length) n.bench.push(rest.shift().id);
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
          {absentXI.length + absentBench.length > 0 && (
            <div className="lineup-alert" role="status">
              <StatusIcons badges={playerStatus(absentXI[0] ?? absentBench[0]).filter((b) => b.kind === "injury" || b.kind === "susp")} />
              <span>
                <b>{absentXI.length ? `${absentXI.length} ${absentXI.length === 1 ? "Ausfall" : "Ausfälle"} in der Startelf` : `${absentBench.length} auf der Bank nicht einsatzfähig`}:</b>{" "}
                {[...absentXI, ...absentBench].map((p: any) => `${p.lastName} (${p.injuryWeeks > 0 ? "verletzt" : "gesperrt"})`).join(", ")}. Am Spieltag wird automatisch ersetzt.
              </span>
              <button className="btn btn-sm" onClick={replaceAbsent}>Ausfälle ersetzen</button>
            </div>
          )}
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
                            <div className="cand-name"><span className="truncate name">{p.name}</span><StatusIcons badges={playerStatus(p)} /></div>
                            {unavailable && <div className="small neg-txt">{p.injuryWeeks > 0 ? `${p.injury?.name ?? "Verletzt"} · ${p.injuryWeeks} W` : `Gesperrt · ${p.suspendedWeeks} ${p.suspendedWeeks === 1 ? "Spiel" : "Spiele"}`}</div>}
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
