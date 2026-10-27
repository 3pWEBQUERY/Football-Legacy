"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Empty, Loading, Modal, useToast } from "@/components/ui";
import { useConfirm, usePrompt } from "@/components/Dialog";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("de-CH") : "–");

/** Konten suchen, Details ansehen, sperren, Namen zurücksetzen oder löschen. */
export function AdminAccounts() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  async function search(term = q) {
    try {
      setRows((await api<any>(`admin/accounts?q=${encodeURIComponent(term)}`)).accounts);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  useEffect(() => { search(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="E-Mail, Anzeigename oder Konto-ID" aria-label="Konten suchen" />
        <button className="btn btn-primary">Suchen</button>
      </form>
      {!rows ? <Loading /> : rows.length === 0 ? <div className="card"><Empty>Keine Konten gefunden.</Empty></div> : (
        <div className="card card-flush table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>E-Mail</th><th className="c">Karrieren</th><th className="c">Gemeldet</th><th>Zuletzt</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setOpen(a.id)}>
                  <td className="name">{a.display_name}</td>
                  <td className="small">{a.email}{!a.verified && <span className="faint"> · unbestätigt</span>}</td>
                  <td className="c">{a.careers}</td>
                  <td className="c">{a.reported ? <span className="badge badge-warn">{a.reported}</span> : "–"}</td>
                  <td className="small">{day(a.last_login_day)}</td>
                  <td>{a.banned ? <span className="badge badge-danger" title={a.ban_reason ?? ""}>Gesperrt {a.banned_until === "dauerhaft" ? "dauerhaft" : `bis ${a.banned_until}`}</span> : <span className="faint small">aktiv</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <AccountModal id={open} onClose={() => setOpen(null)} onChanged={() => search()} />}
    </div>
  );
}

function AccountModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const prompt = usePrompt();
  const [d, setD] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<any>(`admin/accounts/${id}`).then(setD).catch((e) => toast((e as Error).message, "error"));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(path: string, body: Record<string, unknown> = {}, close = false) {
    setBusy(true);
    try {
      const r = await api<any>(`admin/accounts/${id}/${path}`, { body });
      toast(r.message, "success");
      onChanged();
      if (close) onClose(); else load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function ban() {
    const days = await prompt({ title: "Konto sperren", message: "Wie viele Tage? Leer lassen für eine dauerhafte Sperre.", defaultValue: "7", inputMode: "decimal", confirmLabel: "Weiter" });
    if (days === null) return;
    const reason = await prompt({ title: "Grund der Sperre", message: "Der Grund wird dem Spieler beim Anmelden und per E-Mail angezeigt.", defaultValue: "Verstoss gegen die Verhaltensregeln", confirmLabel: "Sperren" });
    if (reason === null) return;
    run("ban", { days: days.trim() ? Number(days) : null, reason });
  }

  const a = d?.account;
  return (
    <Modal open onClose={onClose} wide>
      {!d ? <Loading /> : (
        <div className="stack">
          <div className="between">
            <div>
              <h2>{a.display_name}</h2>
              <div className="faint small">{a.email} · seit {day(a.created_at)} · Serie {a.login_streak} Tage{a.email_verified_at ? " · bestätigt" : " · unbestätigt"}</div>
            </div>
            {a.banned && <span className="badge badge-danger">Gesperrt {a.banned_until === "dauerhaft" ? "dauerhaft" : `bis ${a.banned_until}`}</span>}
          </div>
          {a.banned && <div className="card-soft small">Grund: {a.ban_reason}</div>}
          <div className="row-wrap" style={{ gap: 8 }}>
            {a.banned ? <button className="btn" disabled={busy} onClick={() => run("unban")}>Sperre aufheben</button> : <button className="btn btn-danger" disabled={busy} onClick={ban}>Sperren …</button>}
            <button className="btn" disabled={busy} onClick={async () => { if (await ask({ title: "Anzeigenamen zurücksetzen?", message: "Der Name wird durch einen neutralen ersetzt (z. B. Manager-3fa2c1).", confirmLabel: "Zurücksetzen" })) run("rename"); }}>Namen zurücksetzen</button>
            <button className="btn btn-ghost" disabled={busy} onClick={async () => { if (await ask({ title: `Konto von ${a.display_name} löschen?`, message: "Konto, Karrieren und Ligen-Mitgliedschaften werden endgültig gelöscht.", danger: true, confirmLabel: "Endgültig löschen" })) run("delete", {}, true); }}>Konto löschen</button>
          </div>
          <div className="grid grid-2" style={{ gap: 14, alignItems: "start" }}>
            <div>
              <div className="faint small up">Karrieren ({d.careers.length})</div>
              {d.careers.map((c: any) => <div key={c.id} className="small">{c.club ?? "ohne Verein"} · Saison {c.season} · {c.manager_name} <span className="faint">({day(c.updated_at)})</span></div>)}
              <div className="faint small up" style={{ marginTop: 10 }}>KI (30 Tage)</div>
              <div className="small">{d.ai.requests} Anfragen · ${d.ai.costUsd.toFixed(2)}</div>
            </div>
            <div>
              <div className="faint small up">Letzte Chat-Nachrichten</div>
              {d.posts.length === 0 && <div className="faint small">keine</div>}
              {d.posts.map((p: any) => <div key={p.id} className="small">{p.reports > 0 && <span className="badge badge-warn">{p.reports}</span>} {p.hidden && <span className="badge">ausgeblendet</span>} {p.body} <span className="faint">– {p.league}</span></div>)}
            </div>
          </div>
          {d.actions.length > 0 && (
            <div>
              <div className="faint small up">Admin-Protokoll</div>
              {d.actions.map((x: any, i: number) => <div key={i} className="small">{day(x.created_at)} · {x.action} · {x.admin_email}</div>)}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
