"use client";
import { useRef } from "react";
import { POS_LABEL } from "@/lib/client/format";

export interface BoardSlot {
  position: string;
  x: number; // 0 eigenes Tor → 1 gegnerisches Tor
  y: number; // 0 links → 1 rechts
  label: string;
  sub?: string;
  color: string;
  ink: string;
  empty?: boolean;
}

/** Senkrechte Taktiktafel: eigenes Tor unten. Slots per Ziehen verschiebbar. */
export function PitchBoard({ slots, selected, onSelect, onMove }: {
  slots: BoardSlot[];
  selected: number | null;
  onSelect: (i: number) => void;
  onMove?: (i: number, x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; moved: boolean } | null>(null);

  function pos(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    const y = Math.max(0.03, Math.min(0.97, (e.clientX - r.left) / r.width));
    const x = Math.max(0.02, Math.min(0.95, 1 - (e.clientY - r.top) / r.height));
    return { x, y };
  }

  return (
    <div
      ref={ref}
      className="pitch-board"
      onPointerMove={(e) => {
        if (!drag.current || !onMove) return;
        drag.current.moved = true;
        const p = pos(e);
        onMove(drag.current.i, p.x, p.y);
      }}
      onPointerUp={() => {
        if (drag.current && !drag.current.moved) onSelect(drag.current.i);
        drag.current = null;
      }}
      onPointerLeave={() => (drag.current = null)}
    >
      <svg viewBox="0 0 68 100" width="100%" height="100%" style={{ position: "absolute", inset: 0 }} preserveAspectRatio="none">
        {Array.from({ length: 10 }).map((_, i) => <rect key={i} x="0" y={i * 10} width="68" height="10" fill={i % 2 ? "#2d773a" : "#2a6f36"} />)}
        <g fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="0.4">
          <rect x="1.5" y="1.5" width="65" height="97" />
          <line x1="1.5" y1="50" x2="66.5" y2="50" />
          <circle cx="34" cy="50" r="8.7" />
          <rect x="14" y="1.5" width="40" height="15.7" />
          <rect x="24.8" y="1.5" width="18.4" height="5.2" />
          <rect x="14" y="82.8" width="40" height="15.7" />
          <rect x="24.8" y="93.3" width="18.4" height="5.2" />
        </g>
      </svg>
      {slots.map((s, i) => (
        <div
          key={i}
          className={`pitch-slot ${selected === i ? "selected" : ""} ${s.empty ? "empty" : ""}`}
          style={{ left: `${Math.max(0.07, Math.min(0.93, s.y)) * 100}%`, top: `${Math.max(0.05, Math.min(0.9, 1 - s.x)) * 100}%` }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            drag.current = { i, moved: false };
          }}
          role="button"
          tabIndex={0}
          aria-label={`${POS_LABEL[s.position] ?? s.position}: ${s.label}`}
          onKeyDown={(e) => e.key === "Enter" && onSelect(i)}
        >
          <div className="dot" style={{ background: s.color, color: s.ink }}>{POS_LABEL[s.position] ?? s.position}</div>
          <div className="lbl">{s.label}</div>
          {s.sub && <div className="lbl" style={{ fontWeight: 600, opacity: 0.85 }}>{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}
