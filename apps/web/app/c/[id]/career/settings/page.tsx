"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, useApi } from "@/lib/client/api";
import { useTheme } from "@/lib/client/theme";
import { useGame } from "@/components/GameShell";
import { ErrorBox, Loading, Modal, Panel, Seg, useToast } from "@/components/ui";

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export default function SettingsPage() {
  const { id, reloadShell } = useGame();
  const toast = useToast();
  const router = useRouter();
  const [theme, setTheme] = useTheme();
  const me = useApi<any>("auth/me");
  const settings = useApi<any>(`careers/${id}/settings`);
  const [name, setName] = useState("");
  const [pw, setPw] = useState({ old: "", next: "", repeat: "" });
  const [del, setDel] = useState<{ open: boolean; password: string; confirm: string }>({ open: false, password: "", confirm: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me.data?.account) setName(me.data.account.displayName);
  }, [me.data]);

  if (me.error || settings.error) return <ErrorBox message={me.error ?? settings.error ?? ""} />;
  if (!me.data || !settings.data) return <Loading />;
  const account = me.data.account;
  const s = settings.data;

  async function run<T>(fn: () => Promise<T>, ok?: string) {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast(ok, "success");
      return r;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveCareer(patch: Record<string, unknown>) {
    const r = await run(() => api<any>(`careers/${id}/settings`, { body: patch }));
    if (r) {
      settings.setData({ ...s, ...r });
      reloadShell();
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.repeat) {
      toast("Die neuen Passwörter stimmen nicht überein.", "error");
      return;
    }
    const r = await run(() => api(`account/password`, { body: { oldPassword: pw.old, newPassword: pw.next } }), "Passwort geändert. Andere Geräte wurden abgemeldet.");
    if (r) setPw({ old: "", next: "", repeat: "" });
  }

  async function deleteAccount() {
    const r = await run(() => api(`account/delete`, { body: { password: del.password } }));
    if (r) router.replace("/");
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Einstellungen</h1><p>Konto, Darstellung und Spieloptionen</p></div>
      </div>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Konto" icon="users">
            <form className="stack" onSubmit={(e) => { e.preventDefault(); run(() => api(`account/profile`, { body: { displayName: name } }), "Name gespeichert").then(() => me.reload()); }}>
              <div className="field"><label>E-Mail</label><input className="input" value={account.email} disabled /></div>
              <div className="field"><label htmlFor="dn">Anzeigename (Ranglisten)</label><input id="dn" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></div>
              <div><button className="btn btn-primary" disabled={busy || name.trim() === account.displayName}>Speichern</button></div>
            </form>
          </Panel>
          <Panel title="Passwort ändern" icon="contract">
            <form className="stack" onSubmit={changePassword}>
              <div className="field"><label htmlFor="pw0">Aktuelles Passwort</label><input id="pw0" className="input" type="password" autoComplete="current-password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} /></div>
              <div className="field"><label htmlFor="pw1">Neues Passwort (mindestens 8 Zeichen)</label><input id="pw1" className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
              <div className="field"><label htmlFor="pw2">Neues Passwort wiederholen</label><input id="pw2" className="input" type="password" autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} /></div>
              <div><button className="btn btn-primary" disabled={busy || !pw.old || pw.next.length < 8}>Passwort ändern</button></div>
            </form>
          </Panel>
          <Panel title="Account löschen" icon="close">
            <p className="dim small" style={{ marginTop: 0 }}>Löscht deinen Account mit allen Karrieren und Spielständen endgültig. Das lässt sich nicht rückgängig machen.</p>
            <button className="btn btn-danger" onClick={() => setDel({ open: true, password: "", confirm: "" })}>Account löschen</button>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Darstellung" icon="sun">
            <div className="settings-row">
              <div><b>Farbschema</b><div className="faint small">Dunkel, hell oder wie dein Betriebssystem</div></div>
              <Seg value={theme} onChange={(v) => setTheme(v)} options={[{ value: "dark", label: "Dunkel" }, { value: "light", label: "Hell" }, { value: "system", label: "System" }]} />
            </div>
          </Panel>
          <Panel title="Spieltag" icon="whistle">
            <div className="settings-row">
              <div><b>Automatische Wechsel</b><div className="faint small">Der Co-Trainer wechselt bei Verletzungen und Erschöpfung selbst</div></div>
              <Switch label="Automatische Wechsel" checked={s.autoSubs} onChange={(v) => saveCareer({ autoSubs: v })} />
            </div>
          </Panel>
          <Panel title="Weiter: anhalten bei" icon="calendar">
            <p className="dim small" style={{ marginTop: 0 }}>„Weiter“ lässt die Tage ablaufen, bis etwas Wichtiges passiert. Lege fest, bei welchen Nachrichten angehalten wird. Spieltage halten immer an.</p>
            {Object.keys(s.labels).map((k) => (
              <div key={k} className="settings-row">
                <span>{s.labels[k]}</span>
                <Switch label={s.labels[k]} checked={!!s.stopOn[k]} onChange={(v) => saveCareer({ stopOn: { [k]: v } })} />
              </div>
            ))}
          </Panel>
        </div>
      </div>

      <Modal open={del.open} onClose={() => setDel({ ...del, open: false })}>
        <div className="stack">
          <h2>Account endgültig löschen?</h2>
          <p className="dim">Alle Karrieren, Spielstände und Ranglisten-Einträge werden gelöscht. Gib zur Bestätigung dein Passwort ein und tippe <b>LÖSCHEN</b>.</p>
          <div className="field"><label htmlFor="dpw">Passwort</label><input id="dpw" className="input" type="password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} /></div>
          <div className="field"><label htmlFor="dcf">Bestätigung</label><input id="dcf" className="input" value={del.confirm} placeholder="LÖSCHEN" onChange={(e) => setDel({ ...del, confirm: e.target.value })} /></div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setDel({ ...del, open: false })}>Abbrechen</button>
            <button className="btn btn-danger" disabled={busy || !del.password || del.confirm !== "LÖSCHEN"} onClick={deleteAccount}>Endgültig löschen</button>
          </div>
        </div>
      </Modal>
    </>
  );
}
