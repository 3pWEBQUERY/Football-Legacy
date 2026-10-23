"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SKINS } from "@fl/sim";
import { api, refreshAll } from "@/lib/client/api";
import { POS_LABEL } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { MatchCanvas } from "@/components/MatchCanvas";
import { EVENT_ICON, RatingList, StatRows } from "@/components/MatchStats";
import { WeekSummaryView } from "@/components/WeekSummary";
import { Crest, Icon, Loading, Pos, Progress, useNotes, useToast } from "@/components/ui";

type Phase = "preview" | "loading" | "play1" | "halftime" | "play2" | "fulltime";
const SPEEDS = [{ label: "1×", tps: 4 }, { label: "2×", tps: 9 }, { label: "4×", tps: 20 }];
const HIGHLIGHT = new Set(["goal", "penalty_goal", "own_goal", "penalty_miss", "save", "miss", "red"]);
const STYLE_KEYS: [string, string][] = [["tempo", "Tempo"], ["risk", "Risiko"], ["pressing", "Pressing"], ["defensiveLine", "Abwehrlinie"], ["width", "Breite"], ["passLength", "Passlänge"], ["hardness", "Härte"]];

export default function MatchDay() {
  const { id, shell } = useGame();
  const toast = useToast();
  const showNotes = useNotes();
  const base = `/c/${id}`;
  const [phase, setPhase] = useState<Phase>("preview");
  const [preview, setPreview] = useState<any | null>(null);
  const [m, setM] = useState<any | null>(null); // Präsentation (Teams, Seite, Aufstellungsverlauf)
  const [frames, setFrames] = useState<number[][]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [endTick, setEndTick] = useState(270);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [change, setChange] = useState<any>({ style: {}, subs: [] });
  const [subSlot, setSubSlot] = useState<number | null>(null);
  const [final, setFinal] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);

  useEffect(() => {
    api<any>(`careers/${id}/match/preview`).then((r) => {
      setPreview(r.preview);
      if (r.career.pendingMatch) start(); // Spiel bereits angepfiffen (z. B. nach Neuladen)
    }).catch((e) => toast(e.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function start() {
    setPhase("loading");
    try {
      const r = await api<any>(`careers/${id}/match/start`, { body: {} });
      setM(r);
      setEvents(r.events);
      setChange({ style: { ...r.teams[r.side].style }, subs: [], autoSubs: shell?.career?.autoSubs ?? true });
      if (r.frames.length) {
        setFrames(r.frames);
        setPlayhead(0);
        setEndTick(270);
        setPhase("play1");
      } else {
        // Seite neu geladen: direkt in die Kabine
        setPhase("halftime");
        setPlayhead(270);
      }
    } catch (e) {
      toast((e as Error).message, "error");
      setPhase("preview");
    }
  }

  async function quick() {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${id}/match/quick`, { body: {} });
      showNotes(r.notes);
      setFinal({ summary: r, quick: true });
      setPhase("fulltime");
      refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function secondHalf() {
    setBusy(true);
    try {
      const body = { ...change, style: change.style };
      const r = await api<any>(`careers/${id}/match/continue`, { body });
      setFrames((f) => [...(f.length ? f : Array.from({ length: 271 }, () => r.frames[0])), ...r.frames]);
      setEvents(r.events);
      setM((old: any) => ({ ...old, ...r, side: old.side }));
      setFinal(r);
      setEndTick(540);
      setPlayhead(271);
      setPaused(false);
      setPhase("play2");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // Wiedergabe-Schleife
  const tickLoop = useCallback((ts: number) => {
    if (last.current === null) last.current = ts;
    const dt = Math.min(0.1, (ts - last.current) / 1000);
    last.current = ts;
    setPlayhead((p) => Math.min(endTick, p + dt * SPEEDS[speed].tps));
    raf.current = requestAnimationFrame(tickLoop);
  }, [endTick, speed]);

  useEffect(() => {
    const playing = (phase === "play1" || phase === "play2") && !paused;
    if (playing) {
      last.current = null;
      raf.current = requestAnimationFrame(tickLoop);
    }
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [phase, paused, tickLoop]);

  useEffect(() => {
    if (phase === "play1" && playhead >= 270) setPhase("halftime");
    if (phase === "play2" && playhead >= 540) {
      setPhase("fulltime");
      showNotes(final?.summary?.notes?.filter((n: any) => n.kind === "level" || n.kind === "achievement"));
      refreshAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, phase]);

  const visible = useMemo(() => events.filter((e) => e.tick + 0.5 <= playhead || phase === "fulltime" || phase === "halftime" && e.tick <= 270), [events, playhead, phase]);
  const score = useMemo(() => {
    const goals = visible.filter((e) => e.score).pop();
    return goals?.score ?? [0, 0];
  }, [visible]);
  const lastGoal = useMemo(() => [...visible].reverse().find((e) => e.type.includes("goal")), [visible]);
  const flash = lastGoal && playhead - lastGoal.tick < 8 && phase.startsWith("play") ? "TOR!" : null;
  const minute = Math.min(90, Math.floor(playhead / 6));

  const numbers = useMemo<[number[], number[]]>(() => {
    if (!m) return [[], []];
    const res: [number[], number[]] = [Array.from({ length: 11 }, (_, i) => i + 1), Array.from({ length: 11 }, (_, i) => i + 1)];
    let subNo = [12, 12];
    for (const h of m.lineupHistory ?? []) {
      if (h.tick === 0) continue;
      if (h.tick <= playhead) res[h.side][h.slot] = subNo[h.side]++;
    }
    return res;
  }, [m, playhead]);

  const skinDef = SKINS.find((s) => s.id === (shell?.career?.activeSkin ?? "classic")) ?? SKINS[0];
  const colors = useMemo(() => {
    if (!m) return [{ fill: "#c00", ink: "#fff" }, { fill: "#00c", ink: "#fff" }] as any;
    const [h, a] = m.teams;
    const away = similar(h.colors.primary, a.colors.primary) ? a.colors.secondary : a.colors.primary;
    return [{ fill: h.colors.primary, ink: ink(h.colors.primary) }, { fill: away, ink: ink(away) }];
  }, [m]);

  // ------------------------------------------------------------ Vorschau
  if (phase === "preview" || phase === "loading") {
    return (
      <div className="match-shell">
        <div className="content" style={{ maxWidth: 760 }}>
          <Link href={base} className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}><Icon name="back" size={16} /> Zurück ins Büro</Link>
          {!preview ? <Loading /> : (
            <div className="card stack" style={{ textAlign: "center", padding: 28 }}>
              <span className="badge badge-accent" style={{ alignSelf: "center" }}>{preview.week}. Spieltag</span>
              <div className="between" style={{ gap: 20 }}>
                <div className="stack-sm" style={{ alignItems: "center", flex: 1 }}><Crest colors={preview.home.colors} name={preview.home.name} size={72} /><h2>{preview.home.name}</h2><span className="faint">Stärke {preview.home.rating}</span></div>
                <span style={{ fontSize: 28, fontWeight: 800 }} className="faint">vs</span>
                <div className="stack-sm" style={{ alignItems: "center", flex: 1 }}><Crest colors={preview.away.colors} name={preview.away.name} size={72} /><h2>{preview.away.name}</h2><span className="faint">Stärke {preview.away.rating}</span></div>
              </div>
              {preview.analysis && <p className="dim small">Der Gegner spielt meist {preview.analysis.formation}. Achte auf {preview.analysis.keyPlayers.map((p: any) => p.name).join(", ")}.</p>}
              <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
                <Link className="btn btn-lg" href={`${base}/team/tactic`}>Aufstellung</Link>
                <button className="btn btn-lg" onClick={quick} disabled={busy || phase === "loading"}>Nur Ergebnis</button>
                <button className="btn btn-primary btn-lg" onClick={start} disabled={phase === "loading"}><Icon name="whistle" /> {phase === "loading" ? "Anpfiff …" : "Anpfiff"}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ Nur Ergebnis
  if (final?.quick) {
    return (
      <div className="match-shell"><div className="content" style={{ maxWidth: 860 }}>
        <div className="card"><WeekSummaryView summary={final.summary} base={base} onClose={() => {}} /></div>
        <Link className="btn btn-primary btn-lg" href={base}>Zurück ins Büro</Link>
      </div></div>
    );
  }

  if (!m) return <Loading />;
  const side = m.side as 0 | 1;
  const mine = m.teams[side];
  const [home, away] = m.teams;
  // Nur bereits gesehene Szenen – sonst würden die Highlights das Ergebnis verraten
  const highlights = events.filter((e) => HIGHLIGHT.has(e.type) && e.tick + 0.5 <= playhead);

  return (
    <div className="match-shell">
      <div className="scoreboard">
        <div className="team"><Crest colors={home.colors} name={home.name} size={36} /><strong className="truncate">{home.name}</strong></div>
        <div>
          <div className="score">{score[0]}:{score[1]}</div>
          <div className="clock">{phase === "halftime" ? "Halbzeit" : phase === "fulltime" ? "Abpfiff" : `${minute}'`}</div>
        </div>
        <div className="team away"><strong className="truncate">{away.name}</strong><Crest colors={away.colors} name={away.name} size={36} /></div>
      </div>
      <div style={{ padding: "0 16px" }}><Progress value={playhead} max={540} /></div>

      <div className="match-body">
        <div className="stack">
          <div className="match-canvas-wrap">
            <MatchCanvas frames={frames} playhead={Math.min(playhead, frames.length - 1)} colors={colors} numbers={numbers} skin={skinDef} flash={flash} />
          </div>
          {(phase === "play1" || phase === "play2") && (
            <div className="row-wrap">
              <button className="btn" onClick={() => setPaused((p) => !p)}><Icon name={paused ? "play" : "pause"} size={16} /> {paused ? "Weiter" : "Pause"}</button>
              <div className="seg">{SPEEDS.map((s, i) => <button key={s.label} className={speed === i ? "active" : ""} onClick={() => setSpeed(i)}>{s.label}</button>)}</div>
              <button className="btn" onClick={() => setPlayhead(endTick)}><Icon name="fast" size={16} /> {phase === "play1" ? "Zur Halbzeit" : "Zum Abpfiff"}</button>
              <span className="faint small ml-auto">Highlights:</span>
              {highlights.map((e, i) => (
                <button key={i} className="btn btn-sm" title={e.text} onClick={() => { setPlayhead(Math.max(phase === "play2" ? 271 : 0, e.tick - 4)); setPaused(false); }}>
                  {EVENT_ICON[e.type]} {e.minute}'
                </button>
              ))}
            </div>
          )}

          {phase === "halftime" && (
            <div className="card stack">
              <div className="between"><h2>Kabine – Halbzeitansprache</h2><button className="btn btn-primary btn-lg" onClick={secondHalf} disabled={busy}><Icon name="whistle" /> {busy ? "Simuliere …" : "2. Halbzeit"}</button></div>
              <div className="grid grid-2" style={{ alignItems: "start" }}>
                <div className="stack">
                  <div className="field">
                    <label>Formation</label>
                    <select className="select" value={change.formation ?? mine.formation} onChange={(e) => setChange({ ...change, formation: e.target.value })}>
                      {(m.formations ?? []).map((f: string) => <option key={f}>{f}</option>)}
                    </select>
                  </div>
                  {STYLE_KEYS.map(([k, label]) => (
                    <div key={k} className="slider">
                      <label className="small" style={{ fontWeight: 600 }} htmlFor={`h-${k}`}>{label}</label>
                      <input id={`h-${k}`} type="range" min={0} max={100} step={5} value={change.style[k] ?? mine.style[k]} onChange={(e) => setChange({ ...change, style: { ...change.style, [k]: Number(e.target.value) } })} />
                      <span className="num small">{change.style[k] ?? mine.style[k]}</span>
                    </div>
                  ))}
                  <label className="row small"><input type="checkbox" checked={change.autoSubs ?? true} onChange={(e) => setChange({ ...change, autoSubs: e.target.checked })} /> Co-Trainer wechselt in der 2. Halbzeit automatisch</label>
                </div>
                <div className="stack-sm">
                  <div className="between"><h3>Wechsel</h3><span className="faint small">{mine.subsUsed + change.subs.length}/5 genutzt</span></div>
                  <p className="faint small">Tippe einen Spieler auf dem Platz an, dann einen von der Bank.</p>
                  {mine.players.filter((p: any) => p.slot >= 0).sort((a: any, b: any) => a.slot - b.slot).map((p: any) => {
                    const sub = change.subs.find((s: any) => s.slot === p.slot);
                    const incoming = sub && mine.players.find((x: any) => x.id === sub.playerId);
                    return (
                      <button key={p.id} className="card-soft between small" style={{ cursor: "pointer", padding: "6px 10px", borderColor: subSlot === p.slot ? "var(--gold)" : undefined }} onClick={() => setSubSlot(subSlot === p.slot ? null : p.slot)}>
                        <span className="row" style={{ gap: 6 }}><Pos p={p.position} /> {incoming ? <><s className="faint">{p.short}</s> → <b>{incoming.short}</b></> : p.short}</span>
                        <span className="row" style={{ gap: 8 }}><span className="faint">Note {p.rating.toFixed(1)}</span><span style={{ width: 50 }}><Progress value={p.stamina} tone={p.stamina < 60 ? "danger" : p.stamina < 75 ? "warn" : undefined} /></span></span>
                      </button>
                    );
                  })}
                  {subSlot !== null && (
                    <div className="card-soft stack-sm">
                      <b className="small">Einwechseln für Slot {POS_LABEL[mine.players.find((p: any) => p.slot === subSlot)?.position] ?? ""}</b>
                      {mine.players.filter((p: any) => p.slot === -1 && !change.subs.some((s: any) => s.playerId === p.id)).map((p: any) => (
                        <button key={p.id} className="btn btn-sm" style={{ justifyContent: "flex-start" }} disabled={mine.subsUsed + change.subs.filter((s: any) => s.slot !== subSlot).length >= 5}
                          onClick={() => { setChange({ ...change, subs: [...change.subs.filter((s: any) => s.slot !== subSlot), { slot: subSlot, playerId: p.id }] }); setSubSlot(null); }}>
                          <Pos p={p.position} /> {p.name}
                        </button>
                      ))}
                      {change.subs.some((s: any) => s.slot === subSlot) && <button className="btn btn-ghost btn-sm" onClick={() => { setChange({ ...change, subs: change.subs.filter((s: any) => s.slot !== subSlot) }); setSubSlot(null); }}>Wechsel zurücknehmen</button>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {phase === "fulltime" && final && (
            <div className="card stack">
              <div className="between">
                <h2>{resultText(final.result, side)}</h2>
                <Link className="btn btn-primary btn-lg" href={base}>Zurück ins Büro</Link>
              </div>
              {final.summary.notes?.length > 0 && (
                <div className="row-wrap">{final.summary.notes.map((n: any, i: number) => <span key={i} className="badge badge-accent">{n.icon ?? "✨"} {n.text}</span>)}</div>
              )}
              <div className="grid grid-2" style={{ alignItems: "start" }}>
                <RatingList players={final.result.players} side={0} title={home.name} motm={final.result.motm} />
                <RatingList players={final.result.players} side={1} title={away.name} motm={final.result.motm} />
              </div>
              <WeekSummaryView summary={{ ...final.summary, notes: [] }} base={base} onClose={() => {}} />
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card stack-sm">
            <h3>Spielstatistik</h3>
            {phase === "play1" ? <p className="faint small">Die Statistik gibt es in der Halbzeitpause.</p> : <StatRows stats={phase === "fulltime" && final ? final.result.stats : statsAt(m, phase)} />}
            <div className="row small faint" style={{ gap: 12 }}>
              <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, background: "var(--accent)", borderRadius: 2 }} />{home.short}</span>
              <span className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, background: "var(--blue)", borderRadius: 2 }} />{away.short}</span>
            </div>
          </div>
          <div className="card stack-sm">
            <h3>Ereignisse</h3>
            <div className="events">
              {[...visible].reverse().filter((e) => !["foul", "kickoff"].includes(e.type)).map((e, i) => (
                <div key={i} className={`event ${e.type.includes("goal") ? "goal" : ""}`}>
                  <span className="min">{e.minute}'</span><span>{EVENT_ICON[e.type] ?? "•"}</span><span className="txt">{e.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function statsAt(m: any, phase: Phase) {
  // Während der 1. Halbzeit zeigen wir den Stand zur Pause erst in der Kabine
  if (phase === "play1") return [zero(), zero()];
  return [m.teams[0].stats, m.teams[1].stats];
}

function zero() {
  return { shots: 0, onTarget: 0, xg: 0, possession: 1, passes: 0, passesOk: 0, fouls: 0, corners: 0, yellow: 0, red: 0 };
}

function resultText(r: any, side: number) {
  const gf = side === 0 ? r.homeGoals : r.awayGoals;
  const ga = side === 0 ? r.awayGoals : r.homeGoals;
  if (gf > ga) return `Sieg! ${r.homeGoals}:${r.awayGoals}`;
  if (gf === ga) return `Unentschieden ${r.homeGoals}:${r.awayGoals}`;
  return `Niederlage ${r.homeGoals}:${r.awayGoals}`;
}

function rgb(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function similar(a: string, b: string) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) < 120;
}

function ink(hex: string) {
  const [r, g, b] = rgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? "#111" : "#fff";
}
