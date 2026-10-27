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
  board: "M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-6 10 6z",
  info: "M12 8h.01M11 12h1v5h1M12 3a9 9 0 100 18 9 9 0 000-18z",
  ball: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7.5l4 2.9-1.5 4.7h-5L8 10.4zM12 3v4.5M16 10.4l4.4-1.4M14.5 15.1l2.7 3.8M9.5 15.1l-2.7 3.8M8 10.4L3.6 9",
  transfer: "M4 8h13l-4-4M20 16H7l4 4",
  medical: "M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z",
  contract: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  youth: "M12 21V11M12 11c0-4 3-7 7-7 0 4-3 7-7 7zM12 14c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5z",
  news: "M4 5h13v14H6a2 2 0 01-2-2zM17 9h3v8a2 2 0 01-2 2M8 9h5M8 13h5M8 16h3",
  target: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7a5 5 0 100 10 5 5 0 000-10zM12 11a1 1 0 100 2 1 1 0 000-2z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  swap: "M7 4v16M7 4L3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4",
  card: "M8 3h8v18H8z",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  lock: "M6 11h12v10H6zM9 11V7a3 3 0 016 0v4",
  unlock: "M6 11h12v10H6zM9 11V7a3 3 0 015.8-1",
  trophy: "M8 4h8v5a4 4 0 01-8 0zM5 5H3a3 3 0 003 4M19 5h2a3 3 0 01-3 4M12 13v4M8 20h8",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  fire: "M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-3 2-4 2-7 1.5 1 2 2 2 3 1-2 1-4 1-6z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z",
  stadium: "M3 9c0-2 4-4 9-4s9 2 9 4v8c0 2-4 4-9 4s-9-2-9-4zM3 9c0 2 4 4 9 4s9-2 9-4",
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
      <path d="M20 1.5 L37.5 6 V22 C37.5 32.5 30 39.5 20 43.5 C10 39.5 2.5 32.5 2.5 22 V6 Z" fill={colors.primary} stroke={colors.secondary} strokeWidth="2" />
      <path d="M2.5 13 H37.5" stroke={colors.secondary} strokeWidth="2" />
      <text x="20" y="31.5" textAnchor="middle" fontSize="13.5" fontWeight="700" fill={ink} fontFamily="'Barlow Condensed', system-ui, sans-serif" letterSpacing="0.5">{initials}</text>
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
  return <div className="card error-box" role="alert" style={{ borderColor: "var(--danger)" }}><strong>Fehler:</strong> {message}</div>;
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
      toast(n.text, "success");
    }
  }, [toast]);
}

// ---------------------------------------------------------------- Ereignis-Symbole

const EVENT_SHAPE: Record<string, { icon?: string; color: string; block?: boolean }> = {
  goal: { icon: "ball", color: "var(--pos)" }, penalty_goal: { icon: "ball", color: "var(--pos)" }, own_goal: { icon: "ball", color: "var(--neg)" },
  penalty_miss: { icon: "close", color: "var(--neg)" }, save: { icon: "shield", color: "var(--accent)" }, miss: { icon: "target", color: "var(--text-3)" },
  yellow: { color: "#f2c230", block: true }, red: { color: "#e5534b", block: true }, sub: { icon: "swap", color: "var(--accent)" },
  injury: { icon: "medical", color: "var(--neg)" }, corner: { icon: "flag", color: "var(--text-3)" }, freekick: { icon: "target", color: "var(--text-3)" },
  halftime: { icon: "pause", color: "var(--text-3)" }, fulltime: { icon: "whistle", color: "var(--text-3)" }, tactic: { icon: "board", color: "var(--text-3)" },
  foul: { icon: "close", color: "var(--warn)" }, kickoff: { icon: "whistle", color: "var(--text-3)" },
};

export function EventIcon({ type }: { type: string }) {
  const s = EVENT_SHAPE[type] ?? { icon: "info", color: "var(--text-3)" };
  if (s.block) return <span className="ev-dot" style={{ width: 9, height: 12, background: s.color }} aria-label={type === "red" ? "Rote Karte" : "Gelbe Karte"} />;
  return <span style={{ color: s.color, display: "inline-flex" }}><Icon name={s.icon!} size={15} stroke={2} /></span>;
}

const CATEGORY_ICONS: Record<string, string> = {
  board: "board", tips: "info", match: "ball", transfer: "transfer", medical: "medical", contract: "contract", youth: "youth",
  news: "news", finance: "euro", career: "star", scout: "search", training: "team", international: "flag", award: "trophy",
};

export function CategoryIcon({ category }: { category: string }) {
  return <Icon name={CATEGORY_ICONS[category] ?? "mail"} size={16} />;
}

/** Panel mit Kopfzeile im Manager-Stil. */
export function Panel({ title, icon, actions, children, flush, className }: {
  title: ReactNode; icon?: string; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string;
}) {
  return (
    <section className={`card ${flush ? "card-flush" : ""} ${className ?? ""}`}>
      <div className="card-head">
        <h3>{icon && <Icon name={icon} size={15} />}{title}</h3>
        {actions && <div className="row" style={{ gap: 6 }}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Nationalität als kompaktes Länderkürzel (Flaggen-Emojis rendern nicht überall). */
export function Nat({ code }: { code: string }) {
  return (
    <span className="cond" title={code} style={{ display: "inline-block", minWidth: 30, padding: "0 3px", border: "1px solid var(--line-2)", borderRadius: 2, fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", textAlign: "center", lineHeight: "16px", letterSpacing: "0.04em" }}>
      {code}
    </span>
  );
}

export function moraleLabel(m: number): { text: string; color: string } {
  if (m >= 80) return { text: "Super", color: "var(--a4)" };
  if (m >= 62) return { text: "Gut", color: "var(--a3)" };
  if (m >= 42) return { text: "Okay", color: "var(--text-2)" };
  if (m >= 25) return { text: "Mässig", color: "var(--warn)" };
  return { text: "Schlecht", color: "var(--neg)" };
}

export function Condition({ value }: { value: number }) {
  const color = value >= 90 ? "var(--a4)" : value >= 80 ? "var(--a3)" : value >= 70 ? "var(--warn)" : "var(--neg)";
  return <span className="cond" style={{ fontWeight: 700, color, fontSize: 14 }}>{value}%</span>;
}
