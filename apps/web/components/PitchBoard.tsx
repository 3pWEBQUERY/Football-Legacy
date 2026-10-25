"use client";
import { type ReactNode, useRef } from "react";
import { POS_LABEL } from "@/lib/client/format";

export type SlotGroup = "gk" | "def" | "mid" | "att";

export interface BoardSlot {
  position: string;
  x: number; // 0 eigenes Tor → 1 gegnerisches Tor
  y: number; // 0 links → 1 rechts
  /** Rollenkürzel im Kartenkopf, z. B. "IV" oder "F9" */
  role: string;
  roleName: string;
  group: SlotGroup;
  name: string | null;
  number: number | null;
  /** 0–5 in halben Schritten (Eignung) */
  stars: number | null;
  /** Alternative Anzeige statt Sternen (Kondition, Moral …) */
  meter?: { value: number; label: string; tone: "pos" | "warn" | "neg" } | null;
  kit: { primary: string; secondary: string };
  warn?: string | null;
}

/**
 * Senkrechte Taktiktafel im Stil moderner Manager-Spiele: Trikot mit Nummer,
 * darunter eine Rollenkarte. Klick wählt, Ziehen verschiebt, Rechtsklick
 * (oder langer Druck) öffnet das Kontextmenü der Position.
 */
export function PitchBoard({ slots, selected, onSelect, onMove, onContext, toolbar }: {
  slots: BoardSlot[];
  selected: number | null;
  onSelect: (i: number) => void;
  onMove?: (i: number, x: number, y: number) => void;
  onContext?: (i: number, clientX: number, clientY: number) => void;
  toolbar?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; moved: boolean; x0: number; y0: number; timer: ReturnType<typeof setTimeout> | null; opened: boolean } | null>(null);

  function pos(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    const y = Math.max(0.03, Math.min(0.97, (e.clientX - r.left) / r.width));
    const x = Math.max(0.02, Math.min(0.95, 1 - (e.clientY - r.top) / r.height));
    return { x, y };
  }

  function end() {
    if (drag.current?.timer) clearTimeout(drag.current.timer);
    drag.current = null;
  }

  return (
    <div
      ref={ref}
      className="pitch-board fm"
      onPointerMove={(e) => {
        if (!drag.current || !onMove) return;
        // Kleine Zitterbewegungen beim Klicken (Trackpad) gelten nicht als Verschieben
        if (!drag.current.moved && Math.hypot(e.clientX - drag.current.x0, e.clientY - drag.current.y0) < 6) return;
        if (drag.current.timer) clearTimeout(drag.current.timer);
        drag.current.moved = true;
        const p = pos(e);
        onMove(drag.current.i, p.x, p.y);
      }}
      onPointerUp={(e) => {
        if (drag.current && !drag.current.moved && !drag.current.opened && e.button === 0) onSelect(drag.current.i);
        end();
      }}
      onPointerLeave={end}
      onPointerCancel={end}
    >
      <svg viewBox="0 0 68 100" width="100%" height="100%" style={{ position: "absolute", inset: 0 }} preserveAspectRatio="none" aria-hidden="true">
        {Array.from({ length: 10 }).map((_, i) => <rect key={i} x="0" y={i * 10} width="68" height="10" fill={i % 2 ? "var(--pitch-a)" : "var(--pitch-b)"} />)}
        <g fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.3">
          <rect x="1.5" y="1.5" width="65" height="97" />
          <line x1="1.5" y1="50" x2="66.5" y2="50" />
          <circle cx="34" cy="50" r="8.7" />
          <circle cx="34" cy="50" r="0.5" fill="rgba(255,255,255,0.75)" />
          <rect x="14" y="1.5" width="40" height="15.7" />
          <rect x="24.8" y="1.5" width="18.4" height="5.2" />
          <path d="M 27.5 17.2 A 8.7 8.7 0 0 0 40.5 17.2" />
          <rect x="14" y="82.8" width="40" height="15.7" />
          <rect x="24.8" y="93.3" width="18.4" height="5.2" />
          <path d="M 27.5 82.8 A 8.7 8.7 0 0 1 40.5 82.8" />
        </g>
      </svg>
      {toolbar && <div className="pitch-toolbar" onPointerDown={(e) => e.stopPropagation()}>{toolbar}</div>}
      {slots.map((s, i) => (
        <div
          key={i}
          className={`fm-slot ${selected === i ? "selected" : ""} ${s.name ? "" : "empty"}`}
          style={{ left: `${Math.max(0.12, Math.min(0.88, s.y)) * 100}%`, top: `${Math.max(0.08, Math.min(0.9, 1 - s.x)) * 100}%` }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            const x0 = e.clientX;
            const y0 = e.clientY;
            // Langer Druck (Touch) öffnet das Menü wie ein Rechtsklick
            const timer = onContext ? setTimeout(() => {
              if (drag.current && !drag.current.moved) {
                drag.current.opened = true;
                onContext(i, x0, y0);
              }
            }, 550) : null;
            drag.current = { i, moved: false, x0, y0, timer, opened: false };
          }}
          onContextMenu={(e) => {
            if (!onContext) return;
            e.preventDefault();
            if (drag.current?.opened) return;
            end();
            onContext(i, e.clientX, e.clientY);
          }}
          role="button"
          tabIndex={0}
          aria-label={`${POS_LABEL[s.position] ?? s.position}, ${s.roleName}: ${s.name ?? "frei"}`}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSelect(i);
            if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && onContext) {
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              onContext(i, r.right, r.top);
            }
          }}
        >
          <Shirt kit={s.kit} number={s.number} keeper={s.group === "gk"} empty={!s.name} />
          <div className="fm-card">
            <div className={`fm-role g-${s.group}`} title={s.roleName}>{s.role}</div>
            <div className="fm-body">
              {s.meter ? (
                <div className={`fm-meter tone-${s.meter.tone}`} title={s.meter.label}><i style={{ width: `${Math.max(4, Math.min(100, s.meter.value))}%` }} /><span>{s.meter.label}</span></div>
              ) : s.stars !== null ? <Stars value={s.stars} /> : <div className="fm-stars faint">–</div>}
              <div className="fm-name">
                <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.5" r="3" /><path d="M2.5 15c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5z" /></svg>
                <span>{s.name ?? "Frei"}</span>
              </div>
            </div>
            {s.warn && <span className="fm-warn" title={s.warn}>!</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Stars({ value }: { value: number }) {
  return (
    <div className="fm-stars" aria-label={`${value} von 5 Sternen`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <svg key={i} viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient id={`st-${i}-${Math.round(fill * 2)}`}>
                <stop offset={`${fill * 100}%`} stopColor="var(--star-on)" />
                <stop offset={`${fill * 100}%`} stopColor="transparent" />
              </linearGradient>
            </defs>
            <path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5L2.6 9.4l6.5-.8z" fill={`url(#st-${i}-${Math.round(fill * 2)})`} stroke="var(--star-on)" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        );
      })}
    </div>
  );
}

function Shirt({ kit, number, keeper, empty }: { kit: { primary: string; secondary: string }; number: number | null; keeper: boolean; empty: boolean }) {
  const gk = keeper ? keeperKit(kit.primary) : null;
  const body = gk ? gk[0] : kit.primary;
  const trim = gk ? gk[1] : kit.secondary;
  const ink = inkOn(body);
  return (
    <svg className={`fm-shirt ${empty ? "empty" : ""}`} viewBox="0 0 64 56" aria-hidden="true">
      <path d="M22 3 L12 7 L2 17 L9 27 L15 23 L15 53 L49 53 L49 23 L55 27 L62 17 L52 7 L42 3 C40 8 36 10 32 10 C28 10 24 8 22 3 Z" fill={body} stroke="rgba(0,0,0,0.35)" strokeWidth="1.2" strokeLinejoin="round" />
      {!keeper && <path d="M2 17 L9 27 L15 23 L15 17 L12 7 Z M62 17 L55 27 L49 23 L49 17 L52 7 Z" fill={trim} opacity="0.9" />}
      <path d="M22 3 C24 8 28 10 32 10 C36 10 40 8 42 3" fill="none" stroke={trim} strokeWidth="2.4" />
      {number !== null && <text x="32" y="40" textAnchor="middle" fontSize="20" fontWeight="800" fill={ink} stroke={ink === "#fff" ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.4)"} strokeWidth="0.6" fontFamily="var(--font-cond)">{number}</text>}
    </svg>
  );
}

const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Torwarttrikot, das sich klar von den Feldspielern abhebt. */
function keeperKit(primary: string): [string, string] {
  const options: [string, string][] = [["#d8392b", "#8f1d14"], ["#f2c230", "#9a7a12"], ["#2bb673", "#16704a"], ["#23262d", "#55595f"], ["#ef6c1a", "#94400b"]];
  const [r, g, b] = rgb(primary);
  return options.map((o) => { const [x, y, z] = rgb(o[0]); return { o, d: (x - r) ** 2 + (y - g) ** 2 + (z - b) ** 2 }; }).sort((a, b2) => b2.d - a.d)[0].o;
}

export function inkOn(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? "#111" : "#fff";
}
