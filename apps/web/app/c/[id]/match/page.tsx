"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SKINS } from "@fl/sim";
import { api, refreshAll } from "@/lib/client/api";
import { POS_LABEL, matchRatingColor } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { MatchCanvas } from "@/components/MatchCanvas";
import { RatingList, StatRows } from "@/components/MatchStats";
import { WeekSummaryView } from "@/components/WeekSummary";
import { PressConference } from "@/components/PressConference";
import { Crest, EventIcon, Icon, Loading, Panel, Pos, Progress, useNotes, useToast } from "@/components/ui";

type Phase = "preview" | "loading" | "live" | "halftime" | "fulltime";
const SPEEDS = [{ label: "1×", tps: 4 }, { label: "2×", tps: 9 }, { label: "4×", tps: 20 }];
const HIGHLIGHT = new Set(["goal", "penalty_goal", "own_goal", "penalty_miss", "save", "miss", "red"]);
const STYLE_KEYS: [string, string][] = [["tempo", "Tempo"], ["risk", "Risiko"], ["pressing", "Pressing"], ["defensiveLine", "Abwehrlinie"], ["width", "Breite"], ["passLength", "Passlänge"], ["hardness", "Härte"]];
const HALF = 270;
const END = 540;

export default function MatchDay() {
  const { id, shell } = useGame();
  const toast = useToast();
  const showNotes = useNotes();
  const base = `/c/${id}`;
  const [phase, setPhase] = useState<Phase>("preview");
  const [preview, setPreview] = useState<any | null>(null);
  const [m, setM] = useState<any | null>(null); // Präsentation (Teams, Seite, Aufstellungsverlauf)
  const [frames, setFrames] = useState<number[][]>([]); // Index = Tick
  const [events, setEvents] = useState<any[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [change, setChange] = useState<any>({ style: {}, subs: [] });
  const [subSlot, setSubSlot] = useState<number | null>(null);
  const [final, setFinal] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [talk, setTalk] = useState(false); // Eingreifen-Dialog während des Spiels
  const [secondHalf, setSecondHalf] = useState(false);
  const [applyFrom, setApplyFrom] = useState<number | null>(null);
  const inflight = useRef(false);
  const queued = useRef<any | null>(null);
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const bufferEnd = frames.length - 1;
  const serverDone = !!final && !final.quick;

  useEffect(() => {
    api<any>(`careers/${id}/match/preview`).then((r) => {
      setPreview(r.preview);
      if (r.career.pendingMatch) start(); // Spiel bereits angepfiffen (z. B. nach Neuladen)
    }).catch((e) => toast(e.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function resetChange(team: any) {
    setChange({ style: { ...team.style }, subs: [], autoSubs: change.autoSubs ?? shell?.career?.autoSubs ?? true });
  }

  /** Übernimmt eine Server-Antwort in den Puffer. */
  function absorb(r: any) {
    setFrames((old) => {
      const next = old.length ? old.slice(0, r.fromTick + 1) : [];
      while (next.length <= r.fromTick) next.push(r.frames[0]);
      // start: frames beginnen bei fromTick; step: frames beginnen bei fromTick + 1
      const add = r.frames.length && next.length === r.fromTick + 1 && old.length === 0 ? r.frames.slice(1) : r.frames;
      return [...next, ...add];
    });
    setEvents(r.events);
    setM((old: any) => ({ ...(old ?? {}), ...r, side: old?.side ?? r.side, formations: old?.formations ?? r.formations }));
    if (r.done) setFinal(r);
  }

  async function start() {
    setPhase("loading");
    try {
      const r = await api<any>(`careers/${id}/match/start`, { body: {} });
      setFrames([]);
      absorb(r);
      setM(r);
      resetChange(r.teams[r.side]);
      setPlayhead(r.fromTick);
      setSecondHalf(r.fromTick > HALF);
      setPhase(r.fromTick === HALF ? "halftime" : "live");
    } catch (e) {
      toast((e as Error).message, "error");
      setPhase("preview");
    }
  }

  /** Nächsten Abschnitt holen (optional mit Änderungen oder bis zu einem Tick). */
  const step = useCallback(async (opts: { change?: any; until?: number } = {}) => {
    if (inflight.current) {
      if (opts.change) queued.current = opts.change;
      return null;
    }
    inflight.current = true;
    try {
      const body: any = {};
      const ch = opts.change ?? queued.current;
      if (ch) body.change = ch;
      queued.current = null;
      if (opts.until !== undefined) body.until = opts.until;
      const r = await api<any>(`careers/${id}/match/step`, { body });
      absorb(r);
      if (ch) setApplyFrom(null);
      return r;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    } finally {
      inflight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, toast]);

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

  async function kickoffSecondHalf() {
    setBusy(true);
    const r = await step({ change: cleanChange(change) });
    setBusy(false);
    if (!r) return;
    setSecondHalf(true);
    resetChange(r.teams[m.side]);
    setPaused(false);
    setPlayhead(HALF + 0.01);
    setPhase("live");
  }

  /** Eingreifen während des Spiels: gilt ab dem nächsten Abschnitt. */
  async function applyLive() {
    const ch = cleanChange(change);
    setTalk(false);
    setPaused(false);
    setApplyFrom(bufferEnd);
    toast(`Anweisungen greifen ab Minute ${Math.floor(bufferEnd / 6) + 1}.`, "success");
    await step({ change: ch });
  }

  async function skip() {
    const limit = playhead < HALF || (!secondHalf && bufferEnd <= HALF) ? HALF : END;
    setBusy(true);
    while (inflight.current) await new Promise((res) => setTimeout(res, 40));
    const r = bufferEnd >= limit ? true : await step({ until: limit });
    setBusy(false);
    if (r) setPlayhead(limit);
  }

  // Puffer auffüllen: immer einen Abschnitt voraus
  useEffect(() => {
    if (phase !== "live" || serverDone || inflight.current || frames.length === 0) return;
    const stopAtHalf = !secondHalf && bufferEnd >= HALF;
    if (stopAtHalf) return;
    if (playhead > bufferEnd - 24) step();
  }, [phase, playhead, bufferEnd, secondHalf, serverDone, frames.length, step]);

  // Wiedergabe-Schleife
  const tickLoop = useCallback((ts: number) => {
    if (last.current === null) last.current = ts;
    const dt = Math.min(0.1, (ts - last.current) / 1000);
    last.current = ts;
    setPlayhead((p) => Math.min(Math.max(bufferEnd, 0), p + dt * SPEEDS[speed].tps));
    raf.current = requestAnimationFrame(tickLoop);
  }, [bufferEnd, speed]);

  useEffect(() => {
    if (phase === "live" && !paused && !talk) {
      last.current = null;
      raf.current = requestAnimationFrame(tickLoop);
    }
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [phase, paused, talk, tickLoop]);

  useEffect(() => {
    if (phase !== "live") return;
    if (!secondHalf && playhead >= HALF && bufferEnd >= HALF) {
      setPhase("halftime");
      if (m) resetChange(m.teams[m.side]);
    }
    if (serverDone && playhead >= END) {
      setPhase("fulltime");
      showNotes(final?.summary?.notes?.filter((n: any) => n.kind === "level" || n.kind === "achievement"));
      refreshAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, phase, bufferEnd, serverDone, secondHalf]);

  const visible = useMemo(() => events.filter((e) => e.tick + 0.5 <= playhead || phase === "fulltime" || (phase === "halftime" && e.tick <= HALF)), [events, playhead, phase]);
  const score = useMemo(() => {
    const goals = visible.filter((e) => e.score).pop();
    return goals?.score ?? [0, 0];
  }, [visible]);
  const lastGoal = useMemo(() => [...visible].reverse().find((e) => e.type.includes("goal")), [visible]);
  const flash = lastGoal && playhead - lastGoal.tick < 8 && phase === "live" ? "TOR!" : null;
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
  const myClubId = shell?.career?.clubId;
  const previewMine = preview ? (preview.home.id === myClubId ? 0 : preview.away.id === myClubId ? 1 : null) : null;
  if (phase === "preview" || phase === "loading") {
    return (
      <div className="match-shell">
        <div className="content" style={{ maxWidth: 980 }}>
          <Link href={base} className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}><Icon name="back" size={15} /> Büro</Link>
          {!preview ? <Loading /> : (
            <section className="card card-flush" style={{ ["--home" as string]: preview.home.colors.primary, ["--away" as string]: preview.away.colors.primary }}>
              <div className="card-head"><h3><Icon name={preview.competition?.kind === "cup" ? "trophy" : "calendar"} size={15} /> {preview.competition?.label} · Vorbericht</h3></div>
              <div className="scoreboard" style={{ borderBottom: "1px solid var(--line)", minHeight: 110 }}>
                <div className={`team home ${previewMine === 0 ? "mine" : "opp"}`} style={previewMine === 0 ? { ["--mine" as string]: preview.home.colors.primary } : undefined}><Crest colors={preview.home.colors} name={preview.home.name} size={64} /><div><strong>{preview.home.name}</strong><div className="faint small">Heim · Stärke {preview.home.rating}</div>{previewMine === 0 && <span className="mine-tag">Dein Team</span>}</div></div>
                <div className="center"><div className="score" style={{ fontSize: 28 }}>VS</div></div>
                <div className={`team away ${previewMine === 1 ? "mine" : "opp"}`} style={previewMine === 1 ? { ["--mine" as string]: preview.away.colors.primary } : undefined}><div><strong>{preview.away.name}</strong><div className="faint small">Gast · Stärke {preview.away.rating}</div>{previewMine === 1 && <span className="mine-tag">Dein Team</span>}</div><Crest colors={preview.away.colors} name={preview.away.name} size={64} /></div>
              </div>
              {preview.analysis && (
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }} className="small">
                  <span className="faint up">Gegneranalyse</span> · Formation <b>{preview.analysis.formation}</b> · Schlüsselspieler: {preview.analysis.keyPlayers.map((p: any) => `${p.name} (${p.rating})`).join(", ")}
                </div>
              )}
              <div className="row" style={{ padding: 14, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <Link className="btn btn-lg" href={`${base}/team/tactic`}><Icon name="board" size={16} /> Taktik</Link>
                <button className="btn btn-lg" onClick={quick} disabled={busy || phase === "loading"}>Sofortergebnis</button>
                <button className="btn btn-primary btn-lg" onClick={start} disabled={phase === "loading"}><Icon name="whistle" size={16} /> {phase === "loading" ? "Anpfiff …" : "Anpfiff"}</button>
              </div>
            </section>
          )}
          {preview && <PressConference careerId={id} />}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ Sofortergebnis
  if (final?.quick) {
    return (
      <div className="match-shell"><div className="content" style={{ maxWidth: 900 }}>
        <div className="card"><WeekSummaryView summary={final.summary} base={base} onClose={() => {}} /></div>
        <div><Link className="btn btn-primary btn-lg" href={base}>Zurück ins Büro</Link></div>
      </div></div>
    );
  }

  if (!m) return <Loading />;
  const side = m.side as 0 | 1;
  const mine = m.teams[side];
  const [home, away] = m.teams;
  // Nur bereits gesehene Szenen – sonst würden die Highlights das Ergebnis verraten
  const highlights = events.filter((e) => HIGHLIGHT.has(e.type) && e.tick + 0.5 <= playhead);
  const teamVars = { ["--home" as string]: colors[0].fill, ["--away" as string]: colors[1].fill, ["--mine" as string]: colors[side].fill };
  const sideClass = (s: 0 | 1) => (s === side ? "mine" : "opp");

  return (
    <div className="match-shell" style={teamVars}>
      <div className="scoreboard">
        <div className={`team home ${sideClass(0)}`}><Crest colors={home.colors} name={home.name} size={34} /><strong className="truncate">{home.name}</strong>{side === 0 && <span className="mine-tag">Du</span>}</div>
        <div className="center">
          <div className="score">{score[0]} – {score[1]}</div>
          <div className="clock">{phase === "halftime" ? "HZ" : phase === "fulltime" ? "Ende" : `${minute}'`}</div>
        </div>
        <div className={`team away ${sideClass(1)}`}>{side === 1 && <span className="mine-tag">Du</span>}<strong className="truncate">{away.name}</strong><Crest colors={away.colors} name={away.name} size={34} /></div>
      </div>
      <div className="progress blue" style={{ height: 3, borderRadius: 0 }}><span style={{ width: `${(playhead / 540) * 100}%` }} /></div>

      <div className="match-body">
        <div className="stack match-left">
          <Panel title="Statistik" icon="chart">
            {phase === "live" ? <p className="faint small">Die Statistik gibt es in der Halbzeitpause und nach dem Abpfiff.</p> : <StatRows stats={phase === "fulltime" && final ? final.result.stats : statsAt(m, phase)} names={[home.short, away.short]} mine={side} />}
          </Panel>
          <Panel title={`Dein Team · ${mine.short}`} icon="users" flush className="panel-mine">
            <table className="table">
              <tbody>
                {mine.players.filter((p: any) => p.slot >= 0).sort((a: any, b: any) => a.slot - b.slot).map((p: any) => (
                  <tr key={p.id}>
                    <td style={{ width: 40 }}><Pos p={p.position} /></td>
                    <td className="name truncate">{p.short}</td>
                    <td className="r" style={{ width: 70 }}><Progress value={p.stamina} tone={p.stamina < 60 ? "danger" : p.stamina < 75 ? "warn" : undefined} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <div className="stack">
          <div className="match-canvas-wrap">
            <div className="pitch-legend">
              <span className="mine"><i style={{ background: colors[side].fill }} /> Dein Team · {mine.name}</span>
              <span className="opp"><i style={{ background: colors[1 - side].fill }} /> Gegner · {m.teams[1 - side].name}</span>
            </div>
            <MatchCanvas frames={frames} playhead={Math.min(playhead, frames.length - 1)} colors={colors} numbers={numbers} skin={skinDef} flash={flash} mySide={side} />
          </div>
          {phase === "live" && !talk && (
            <div className="card row-wrap" style={{ padding: 8 }}>
              <button className="btn" onClick={() => setPaused((p) => !p)}><Icon name={paused ? "play" : "pause"} size={15} /> {paused ? "Weiter" : "Pause"}</button>
              <div className="seg">{SPEEDS.map((s, i) => <button key={s.label} className={speed === i ? "active" : ""} onClick={() => setSpeed(i)}>{s.label}</button>)}</div>
              <button className="btn btn-primary" onClick={() => { setPaused(true); setTalk(true); if (m) resetChange(m.teams[m.side]); }}><Icon name="board" size={15} /> Eingreifen</button>
              <button className="btn" disabled={busy} onClick={skip}><Icon name="fast" size={15} /> {secondHalf ? "Zum Abpfiff" : "Zur Halbzeit"}</button>
              {applyFrom !== null && <span className="badge badge-blue">Neue Anweisungen ab Min. {Math.floor(applyFrom / 6) + 1}</span>}
              {highlights.length > 0 && <span className="faint small up ml-auto">Highlights</span>}
              {highlights.map((e, i) => (
                <button key={i} className="btn btn-sm" title={e.text} onClick={() => { setPlayhead(Math.max(secondHalf ? HALF + 1 : 0, e.tick - 4)); setPaused(false); }}>
                  <EventIcon type={e.type} /> {e.minute}'
                </button>
              ))}
            </div>
          )}

          {(phase === "halftime" || talk) && (
            <section className="card card-flush">
              <div className="card-head">
                <h3><Icon name="board" size={15} /> {phase === "halftime" ? "Kabine · Halbzeitansprache" : `Eingreifen · Minute ${Math.floor(playhead / 6) + 1}`}</h3>
                <div className="row" style={{ gap: 6 }}>
                  {talk && <button className="btn btn-ghost" onClick={() => { setTalk(false); setPaused(false); }}>Abbrechen</button>}
                  {phase === "halftime"
                    ? <button className="btn btn-primary" onClick={kickoffSecondHalf} disabled={busy}><Icon name="whistle" size={15} /> {busy ? "Simuliere …" : "2. Halbzeit"}</button>
                    : <button className="btn btn-primary" onClick={applyLive}><Icon name="check" size={15} /> Übernehmen</button>}
                </div>
              </div>
              <div className="grid grid-2" style={{ alignItems: "start", padding: 14 }}>
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
                      <span className="cond" style={{ fontWeight: 700 }}>{change.style[k] ?? mine.style[k]}</span>
                    </div>
                  ))}
                  <label className="row small"><input type="checkbox" checked={change.autoSubs ?? true} onChange={(e) => setChange({ ...change, autoSubs: e.target.checked })} /> Co-Trainer wechselt in der 2. Halbzeit automatisch</label>
                </div>
                <div className="stack-sm">
                  <div className="between"><span className="faint small up">Wechsel</span><span className="cond" style={{ fontWeight: 700 }}>{mine.subsUsed + change.subs.length} / 5</span></div>
                  <table className="table">
                    <tbody>
                      {mine.players.filter((p: any) => p.slot >= 0).sort((a: any, b: any) => a.slot - b.slot).map((p: any) => {
                        const sub = change.subs.find((s: any) => s.slot === p.slot);
                        const incoming = sub && mine.players.find((x: any) => x.id === sub.playerId);
                        return (
                          <tr key={p.id} className={`clickable ${subSlot === p.slot ? "highlight" : ""}`} onClick={() => setSubSlot(subSlot === p.slot ? null : p.slot)}>
                            <td style={{ width: 40 }}><Pos p={p.position} /></td>
                            <td className="name">{incoming ? <><s className="faint">{p.short}</s> <Icon name="swap" size={12} /> {incoming.short}</> : p.short}</td>
                            <td className="c cond" style={{ fontWeight: 700, color: matchRatingColor(p.rating) }}>{p.rating.toFixed(1)}</td>
                            <td style={{ width: 60 }}><Progress value={p.stamina} tone={p.stamina < 60 ? "danger" : p.stamina < 75 ? "warn" : undefined} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {subSlot !== null && (
                    <div className="card-soft stack-sm">
                      <span className="faint small up">Einwechseln für {POS_LABEL[mine.players.find((p: any) => p.slot === subSlot)?.position] ?? ""}</span>
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
            </section>
          )}

          {phase === "fulltime" && final && (
            <section className="card card-flush">
              <div className="card-head">
                <h3><Icon name="whistle" size={15} /> {resultText(final.result, side, final.summary.cupResults?.find((x: any) => x.fixtureId === final.summary.userFixtureId))}</h3>
                <Link className="btn btn-primary" href={base}>Zurück ins Büro</Link>
              </div>
              {final.summary.notes?.length > 0 && (
                <div className="row-wrap" style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>{final.summary.notes.map((n: any, i: number) => <span key={i} className={`badge ${n.kind === "xp" ? "" : "badge-blue"}`}>{n.text}</span>)}</div>
              )}
              <div className="grid grid-2" style={{ gap: 0, alignItems: "start" }}>
                <RatingList players={final.result.players} side={0} title={home.name} motm={final.result.motm} mine={side === 0} />
                <RatingList players={final.result.players} side={1} title={away.name} motm={final.result.motm} mine={side === 1} />
              </div>
              <div style={{ padding: 14, borderTop: "1px solid var(--line)" }}>
                <WeekSummaryView summary={{ ...final.summary, notes: [] }} base={base} onClose={() => {}} />
              </div>
            </section>
          )}
        </div>

        <Panel title="Live-Ticker" icon="news">
          <div className="events" style={{ margin: "-4px 0" }}>
            {[...visible].reverse().filter((e) => !["foul", "kickoff", "corner", "freekick"].includes(e.type)).map((e, i) => (
              <div key={i} className={`event ${eventClass(e, side)}`}>
                <span className="min">{e.minute}'</span><span className="ico"><EventIcon type={e.type} /></span><span className="txt">{e.text}</span>
              </div>
            ))}
            {visible.length <= 1 && <p className="faint small">Das Spiel läuft …</p>}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** Ticker: eigene Ereignisse markieren, Gegentore rot statt grün. */
function eventClass(e: { side: "home" | "away" | null; type: string }, side: 0 | 1) {
  const s = e.side === "home" ? 0 : e.side === "away" ? 1 : null;
  if (s === null) return "";
  const own = s === side;
  const goal = e.type.includes("goal") ? (own ? " goal" : " goal-against") : "";
  return (own ? "mine" : "opp") + goal;
}

function statsAt(m: any, phase: Phase) {
  // Während der 1. Halbzeit zeigen wir den Stand zur Pause erst in der Kabine
  if (phase === "live") return [zero(), zero()];
  return [m.teams[0].stats, m.teams[1].stats];
}

function zero() {
  return { shots: 0, onTarget: 0, xg: 0, possession: 1, passes: 0, passesOk: 0, fouls: 0, corners: 0, yellow: 0, red: 0 };
}

function resultText(r: any, side: number, cupLine?: any) {
  const gf = side === 0 ? r.homeGoals : r.awayGoals;
  const ga = side === 0 ? r.awayGoals : r.homeGoals;
  if (gf === ga && cupLine?.penHome !== undefined && cupLine?.penHome !== null) {
    const pf = side === 0 ? cupLine.penHome : cupLine.penAway;
    const pa = side === 0 ? cupLine.penAway : cupLine.penHome;
    return `${pf > pa ? "Weiter im Elfmeterschiessen" : "Aus im Elfmeterschiessen"} · ${r.homeGoals}:${r.awayGoals} (${cupLine.penHome}:${cupLine.penAway} i.E.)`;
  }
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

/** Nur echte Änderungen an den Server schicken. */
function cleanChange(change: any) {
  const out: any = {};
  if (change.formation) out.formation = change.formation;
  if (change.style && Object.keys(change.style).length) out.style = change.style;
  if (change.subs?.length) out.subs = change.subs;
  if (typeof change.autoSubs === "boolean") out.autoSubs = change.autoSubs;
  return out;
}
