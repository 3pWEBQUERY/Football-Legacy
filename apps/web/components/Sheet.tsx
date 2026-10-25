"use client";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./ui";

/**
 * Popover am Auslöser (Desktop) bzw. Sheet von unten (Handy).
 * Schliesst bei Klick ausserhalb, Escape und Fenstergrössenänderung.
 */
export function Sheet({ open, anchor, title, onClose, children, width = 380 }: {
  open: boolean; anchor: HTMLElement | null; title: ReactNode; onClose: () => void; children: ReactNode; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; narrow: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const narrow = window.innerWidth < 860;
    const r = anchor?.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 400;
    const left = r ? Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) : 8;
    let top = r ? r.bottom + 6 : 80;
    if (top + h > window.innerHeight - 8) top = Math.max(8, (r ? r.top : 80) - h - 6);
    setPlace({ left, top, narrow });
  }, [open, anchor, width]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => { document.addEventListener("mousedown", down); document.addEventListener("touchstart", down); }, 0);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", down); document.removeEventListener("touchstart", down); document.removeEventListener("keydown", key); window.removeEventListener("resize", onClose); };
  }, [open, anchor, onClose]);

  if (!open) return null;
  return (
    <>
      {place?.narrow && <div className="sheet-backdrop" aria-hidden="true" />}
      <div ref={ref} role="dialog" aria-label={typeof title === "string" ? title : undefined}
        className={`sheet ${place?.narrow ? "narrow" : ""}`}
        style={place && !place.narrow ? { left: place.left, top: place.top, width } : place ? undefined : { visibility: "hidden", width }}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Schliessen"><Icon name="close" size={15} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}
