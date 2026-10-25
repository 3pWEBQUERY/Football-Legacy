"use client";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
}

/**
 * Eigenes Auswahlfeld im Stil des Spiels (statt der nativen Browser-Auswahl).
 * Bedienung per Maus, Touch und Tastatur (Pfeile, Enter, Escape, Anfangsbuchstabe).
 */
export function Select<T extends string>({ value, options, onChange, label, placeholder, width, menuWidth }: {
  value: T | null;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  label: string;
  placeholder?: string;
  width?: number;
  menuWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const down = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("touchstart", down);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("touchstart", down); };
  }, [open, options, value]);

  // Liste nicht über den Bildschirmrand hinausragen lassen
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const w = Math.min(menuWidth ?? box.width, window.innerWidth - 16);
    setAlignRight(box.left + w > window.innerWidth - 8 && box.right - w >= 8);
  }, [open, menuWidth]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function pick(i: number) {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "Escape" || e.key === "Tab") setOpen(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(active); }
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const i = options.findIndex((o, idx) => idx > active && o.label.toLowerCase().startsWith(k));
      const j = i >= 0 ? i : options.findIndex((o) => o.label.toLowerCase().startsWith(k));
      if (j >= 0) setActive(j);
    }
  }

  return (
    <div className={`fl-select ${open ? "open" : ""}`} ref={ref} style={width ? { width } : undefined}>
      <button type="button" className="fl-select-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current?.label ?? placeholder ?? ""}`}
        aria-controls={`${id}-list`} onClick={() => setOpen(!open)} onKeyDown={onKey}>
        {current?.icon && <span className="fl-select-icon">{current.icon}</span>}
        <span className="fl-select-value">{current?.label ?? <span className="faint">{placeholder}</span>}</span>
        <svg className="fl-select-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>
      </button>
      {open && (
        <ul ref={listRef} id={`${id}-list`} className={`fl-select-list ${alignRight ? "right" : ""}`} role="listbox" aria-label={label} style={menuWidth ? { width: menuWidth } : undefined}>
          {options.map((o, i) => (
            <li key={o.value} data-i={i} role="option" aria-selected={o.value === value}
              className={`fl-select-opt ${i === active ? "active" : ""} ${o.value === value ? "selected" : ""}`}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
              {o.icon && <span className="fl-select-icon">{o.icon}</span>}
              <span className="fl-select-text"><b>{o.label}</b>{o.description && <small>{o.description}</small>}</span>
              {o.value === value && <svg className="fl-select-check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" /></svg>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
