"use client";
/** Bausteine der Taktikseite: Anzeigen, Kennzahlen, Rückennummern und das Positionsmenü (Rechtsklick). */
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Stars, type SlotGroup } from "@/components/PitchBoard";
import { Icon } from "@/components/ui";
import { POS_LABEL } from "@/lib/client/format";

export function fill<T>(arr: T[] | undefined, n: number, v: T): T[] {
  const out = [...(arr ?? [])];
  while (out.length < n) out.push(v);
  return out;
}
export const MENTALITY_TEXT: Record<string, string> = {
  "-3": "Alles hinter den Ball, nur kontern", "-2": "Tief stehen, wenig Risiko", "-1": "Kontrolliert, Absicherung zuerst", "0": "Gleichgewicht aus Angriff und Abwehr",
  "1": "Mutig nach vorne, höhere Linie", "2": "Druck machen, viele Spieler im Angriff", "3": "Alles nach vorne – hohes Risiko",
};
export function MentalityIcon({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 28 10" width="28" height="10" aria-hidden="true">
      {[-3, -2, -1, 0, 1, 2, 3].map((l, i) => <rect key={l} x={i * 4} y={2} width="3" height="6" rx="1" fill={l === level ? (level < 0 ? "#3b82f6" : level > 0 ? "#ef4444" : "#e5e7eb") : "rgba(255,255,255,0.18)"} />)}
    </svg>
  );
}
export function Meter({ label, value, tone, title }: { label: string; value: number; tone: "fam" | "int"; title: string }) {
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
export function styleText(style: Record<string, number>) {
  return ["tempo", "passLength", "width", "pressing", "defensiveLine"].map((k) => `${STYLE_SHORT[k]} ${style[k]}`).join(" · ");
}
export function formationText(slots: { position: string }[]) {
  const back = slots.filter((s) => ["DC", "DR", "DL"].includes(s.position)).length;
  const top = slots.filter((s) => s.position === "ST").length;
  return `${back}er-Kette · ${top === 1 ? "eine Spitze" : `${top} Spitzen`}`;
}
export function FormationIcon({ slots }: { slots: { x: number; y: number; position: string }[] }) {
  return (
    <svg viewBox="0 0 30 40" width="22" height="30" aria-hidden="true" className="formation-icon">
      <rect x="0.5" y="0.5" width="29" height="39" rx="2" fill="#1d4d3f" stroke="rgba(255,255,255,0.35)" />
      <line x1="0.5" y1="20" x2="29.5" y2="20" stroke="rgba(255,255,255,0.3)" strokeWidth="0.6" />
      {slots.map((s, i) => <circle key={i} cx={2 + s.y * 26} cy={38 - s.x * 36} r="1.9" fill={s.position === "GK" ? "#f3c945" : "#fff"} />)}
    </svg>
  );
}

export type Phase = "base" | "attack" | "defend" | "both";
export type SheetKey = "attack" | "defend" | "set";
export const ATTACK_KEYS = ["tempo", "passLength", "width", "risk"];
export const DEFEND_KEYS = ["pressing", "defensiveLine", "hardness"];
export const CORNER_LABEL: Record<string, string> = { far: "Hoch an den zweiten Pfosten", near: "Scharf an den ersten Pfosten", short: "Kurz ausführen" };
export const PHASE_HINT: Record<Phase, string> = {
  base: "Grundordnung: Positionen lassen sich per Ziehen verschieben.",
  attack: "Mit Ball: So rücken die Spieler bei eigenem Ballbesitz auf – abhängig von Rolle, Breite, Risiko und Abwehrlinie.",
  defend: "Gegen den Ball: So formiert sich die Mannschaft ohne Ball – abhängig von Breite und Abwehrlinie.",
  both: "Beide: Karten zeigen die Position mit Ball, die Punkte den Platz gegen den Ball.",
};

export type ViewMode = "eignung" | "kondition" | "moral" | "staerke";
export const VIEW_LABEL: Record<ViewMode, string> = { eignung: "Eignung", kondition: "Kondition", moral: "Moral", staerke: "Stärke" };

/** Kurzbezeichnungen der Rollen für den Kartenkopf. */
export const ROLE_CODE: Record<string, string> = {
  gk: "TW", sweeper_keeper: "MTW", cb: "IV", bpd: "BIV", fb: "AV", wb: "FV", anchor: "AB", dlp: "TSM", b2b: "BTB",
  playmaker: "SM", winger: "FL", wide_mid: "BM", inside_fwd: "IF", am: "OM", poacher: "KN", target: "ZS", complete_fwd: "KS", false9: "F9",
};
export const GROUP: Record<string, SlotGroup> = {
  GK: "gk", DC: "def", DR: "def", DL: "def", DM: "mid", MC: "mid", MR: "mid", ML: "mid", AMC: "att", AMR: "att", AML: "att", ST: "att",
};
const SET_PIECES: [string, string, string][] = [["penaltyTaker", "Elfmeterschütze", "penalties"], ["freeKickTaker", "Freistossschütze", "freeKicks"], ["cornerTaker", "Eckenschütze", "corners"]];

/** Eignung als Sterne (halbe Schritte): 45 ≈ 0, 90 ≈ 5 Sterne. */
export function starsFor(rating: number) {
  return Math.max(0.5, Math.min(5, Math.round(((rating - 45) / 9) * 2) / 2));
}

/** Rückennummern: klassische Nummern je Mannschaftsteil, Beste zuerst. */
export function squadNumbers(players: any[]): Map<number, number> {
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
export function SlotMenu(props: {
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
