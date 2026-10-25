"use client";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Rote Bestätigung für endgültige Aktionen (löschen, entlassen …) */
  danger?: boolean;
}
export interface PromptOptions {
  title: string;
  message?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  inputMode?: "text" | "decimal";
  maxLength?: number;
}

type Pending =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };

const Ctx = createContext<{ confirm: (o: ConfirmOptions | string) => Promise<boolean>; prompt: (o: PromptOptions) => Promise<string | null> } | null>(null);

/** Eigene Bestätigungs- und Eingabedialoge statt der Browser-Dialoge. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback((o: ConfirmOptions | string) => new Promise<boolean>((resolve) => {
    setPending({ kind: "confirm", opts: typeof o === "string" ? { title: o } : o, resolve });
  }), []);
  const prompt = useCallback((o: PromptOptions) => new Promise<string | null>((resolve) => {
    setPending({ kind: "prompt", opts: o, resolve });
  }), []);
  return (
    <Ctx.Provider value={{ confirm, prompt }}>
      {children}
      {pending && <DialogView pending={pending} close={() => setPending(null)} />}
    </Ctx.Provider>
  );
}

function DialogView({ pending, close }: { pending: Pending; close: () => void }) {
  const [value, setValue] = useState(pending.kind === "prompt" ? pending.opts.defaultValue ?? "" : "");
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const danger = pending.kind === "confirm" && pending.opts.danger;

  const finish = useCallback((ok: boolean) => {
    if (pending.kind === "confirm") pending.resolve(ok);
    else pending.resolve(ok ? value.trim() || null : null);
    close();
  }, [pending, value, close]);

  useEffect(() => {
    if (pending.kind === "prompt") { inputRef.current?.focus(); inputRef.current?.select(); } else okRef.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); finish(false); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [pending, finish]);

  const o = pending.opts;
  return (
    <div className="modal-back dialog-back" onMouseDown={(e) => e.target === e.currentTarget && finish(false)}>
      <form className={`dialog ${danger ? "danger" : ""}`} role="alertdialog" aria-modal="true" aria-labelledby="dlg-title"
        onSubmit={(e) => { e.preventDefault(); finish(true); }}>
        <div className="dialog-head">
          <span className="dialog-icon"><Icon name={danger ? "trash" : pending.kind === "prompt" ? "contract" : "info"} size={18} /></span>
          <h3 id="dlg-title">{o.title}</h3>
        </div>
        {o.message && <div className="dialog-msg">{o.message}</div>}
        {pending.kind === "prompt" && (
          <input ref={inputRef} className="input dialog-input" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder={pending.opts.placeholder} inputMode={pending.opts.inputMode} maxLength={pending.opts.maxLength ?? 60} aria-label={o.title} />
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => finish(false)}>{pending.kind === "confirm" ? pending.opts.cancelLabel ?? "Abbrechen" : "Abbrechen"}</button>
          <button ref={okRef} type="submit" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={pending.kind === "prompt" && !value.trim()}>
            {o.confirmLabel ?? (pending.kind === "prompt" ? "Übernehmen" : "Bestätigen")}
          </button>
        </div>
      </form>
    </div>
  );
}

export function useConfirm() {
  const c = useContext(Ctx);
  if (!c) throw new Error("DialogProvider fehlt");
  return c.confirm;
}

export function usePrompt() {
  const c = useContext(Ctx);
  if (!c) throw new Error("DialogProvider fehlt");
  return c.prompt;
}

/** Bestätigung aus einem Satz: endgültige Aktionen werden rot hervorgehoben. */
export function confirmFrom(text: string): ConfirmOptions {
  const danger = /lösch|entlass|auflös|zurücktret|verlass|entfern|kündig/i.test(text);
  return { title: text, danger, confirmLabel: danger ? "Ja, fortfahren" : "Bestätigen" };
}
