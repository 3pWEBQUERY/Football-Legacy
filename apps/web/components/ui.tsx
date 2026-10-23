"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { POS_LABEL, posGroup, ratingClass } from "@/lib/client/format";

// ---------------------------------------------------------------- Icons

const PATHS: Record<string, string> = {
  office: "M4 7h16v12H4zM9 7V5h6v2M4 12h16",
  team: "M8 4l-4 3 2 3 2-1v11h8V9l2 1 2-3-4-3-2 2h-4z",
  market: "M7 7h11l-3-3M17 17H6l3 3M4 12h16",
  competition: "M8 4h8v5a4 4 0 01-8 0zM5 5H3a3 3 0 003 4M19 5h2a3 3 0 01-3 4M12 13v4M8 20h8",
  career: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z",
  play: "M8 5l11 7-11 7z",
  next: "M5 5l7 7-7 7M13 5l7 7-7 7",
  logout: "M15 17l5-5-5-5M20 12H9M12 20H5V4h7",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 100 8 4 4 0 000-8z",
  moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4",
  star: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z",
  close: "M6 6l12 12M18 6L6 18",
  back: "M15 5l-7 7 7 7",
  check: "M5 12l5 5 9-10",
  pause: "M8 5v14M16 5v14",
  fast: "M4 5l8 7-8 7zM12 5l8 7-8 7z",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  chart: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  euro: "M17 6a7 7 0 100 12M4 10h9M4 14h9",
  users: "M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M16 3a4 4 0 010 8M22 21v-1a6 6 0 00-4-5.6",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  whistle: "M3 12a6 6 0 1012 0V8h6V5H9a6 6 0 00-6 7z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  mail: "M3 6h18v12H3zM3 6l9 7 9-7",
};

export function Icon({ name, size = 18, stroke = 1.8 }: { name: keyof typeof PATHS | string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.star} />
    </svg>
  );
}

// ---------------------------------------------------------------- Wappen

export function Crest({ colors, name, size = 32 }: { colors: { primary: string; secondary: string }; name: string; size?: number }) {
  const initials = name
    .replace(/^(FC|SV|VfB|1\.|SC|TSV|AC|AS|US|CD|UD|SD|CF|Real|Club|Al-)\s*/i, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const light = isLight(colors.primary);
  const ink = light ? "#111827" : "#ffffff";
  return (
    <svg className="crest" width={size} height={size * 1.12} viewBox="0 0 40 45" role="img" aria-label={`Wappen ${name}`}>
      <path d="M20 1 L38 6 V22 C38 33 30 40 20 44 C10 40 2 33 2 22 V6 Z" fill={colors.primary} stroke={colors.secondary} strokeWidth="2.5" />
      <path d="M20 1 L38 6 V14 H2 V6 Z" fill={colors.secondary} opacity="0.9" />
      <text x="20" y="31" textAnchor="middle" fontSize="13" fontWeight="800" fill={ink} fontFamily="system-ui, sans-serif">{initials}</text>
    </svg>
  );
}

function isLight(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 > 170;
}

// ---------------------------------------------------------------- Kleine Bausteine

export function Pos({ p }: { p: string }) {
  return <span className={`pos pos-${posGroup(p)}`}>{POS_LABEL[p] ?? p}</span>;
}

export function Rating({ value, range }: { value: number | null; range?: [number, number] | null }) {
  if (value === null && range) {
    return <span className={`rating ${ratingClass((range[0] + range[1]) / 2)}`} title="Geschätzt – lass den Spieler scouten">{range[0]}–{range[1]}</span>;
  }
  return <span className={`rating ${ratingClass(value)}`}>{value ?? "?"}</span>;
}

export function FormChips({ form }: { form: string[] }) {
  return (
    <span className="row" style={{ gap: 3 }}>
      {form.map((f, i) => (
        <span key={i} className={`form-chip form-${f}`} title={f === "W" ? "Sieg" : f === "D" ? "Unentschieden" : "Niederlage"}>
          {f === "W" ? "S" : f === "D" ? "U" : "N"}
        </span>
      ))}
    </span>
  );
}

export function Progress({ value, max = 100, tone }: { value: number; max?: number; tone?: "warn" | "danger" }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`progress ${tone ?? ""}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

export function Loading({ lines = 4 }: { lines?: number }) {
  return (
    <div className="stack" aria-busy="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: i === 0 ? 28 : 64, width: i === 0 ? "40%" : "100%" }} />
      ))}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="card" style={{ borderColor: "var(--danger)" }}><strong>Fehler:</strong> {message}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, children, wide }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Sortierbare Tabelle

export interface Column<T> {
  key: string;
  label: ReactNode;
  render: (row: T) => ReactNode;
  sort?: (row: T) => number | string;
  className?: string;
  title?: string;
}

export function SortTable<T>({ rows, columns, initialSort, onRowClick, rowClass, rowKey }: {
  rows: T[];
  columns: Column<T>[];
  initialSort?: { key: string; dir: 1 | -1 };
  onRowClick?: (row: T) => void;
  rowClass?: (row: T) => string;
  rowKey: (row: T) => string | number;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const va = col.sort!(a);
      const vb = col.sort!(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [rows, columns, sort]);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${c.sort ? "sortable" : ""} ${sort?.key === c.key ? "sorted" : ""} ${c.className ?? ""}`}
                title={c.title}
                onClick={() => c.sort && setSort((s) => ({ key: c.key, dir: s?.key === c.key ? ((s.dir * -1) as 1 | -1) : -1 }))}
                aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
              >
                {c.label}
                {sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className={`${onRowClick ? "clickable" : ""} ${rowClass?.(r) ?? ""}`} onClick={() => onRowClick?.(r)}>
              {columns.map((c) => (
                <td key={c.key} className={c.className}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- Toasts

interface Toast {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
  icon?: string;
}
const ToastCtx = createContext<(text: string, kind?: Toast["kind"], icon?: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "info", icon?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-4), { id, text, kind, icon }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.icon && <span>{t.icon}</span>}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/** Belohnungs-Notizen vom Server als Toasts anzeigen. */
export function useNotes() {
  const toast = useToast();
  return useCallback((notes: { text: string; icon?: string; kind?: string }[] | undefined) => {
    for (const n of notes ?? []) {
      if (n.kind === "xp") continue;
      toast(n.text, "success", n.icon);
    }
  }, [toast]);
}
