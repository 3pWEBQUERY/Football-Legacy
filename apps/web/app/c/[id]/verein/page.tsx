"use client";
import { useEffect, useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Crest, ErrorBox, Loading, Panel, Progress, Seg, useToast } from "@/components/ui";

export default function VereinPage() {
  const { id } = useGame();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`careers/${id}/verein`);
  const [form, setForm] = useState({ name: "", short: "", primary: "#000000", secondary: "#ffffff", stadiumName: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setForm({ name: data.club.name, short: data.club.short, primary: data.club.colors.primary, secondary: data.club.colors.secondary, stadiumName: data.stadiumName });
  }, [data]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  async function post(path: string, body: unknown, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    try {
      const r = await api<any>(`careers/${id}/${path}`, { body });
      toast(r.message, "success");
      reload();
      refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const f = data.fans;
  const tone = f.satisfaction < 30 ? "danger" : f.satisfaction < 50 ? "warn" : undefined;
  const changed = form.name !== data.club.name || form.short !== data.club.short || form.primary !== data.club.colors.primary || form.secondary !== data.club.colors.secondary || form.stadiumName !== data.stadiumName;
  const spark = f.history.slice(-30);

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <Crest colors={data.club.colors} name={data.club.name} size={44} />
          <div><h1>Verein & Fans</h1><p>{data.club.name} · gegründet {data.club.founded} · {data.stadiumName} ({data.club.capacity.toLocaleString("de-CH")} Plätze)</p></div>
        </div>
      </div>

      <div className="card dyn-kpis">
        <div className="stat">
          <span className="label">Fanstimmung</span>
          <span className="value">{f.label}</span>
          <Progress value={f.satisfaction} tone={tone} />
          <span className="faint small">{f.satisfaction}/100</span>
        </div>
        <div className="stat"><span className="label">Vereinsmitglieder</span><span className="value">{f.members.toLocaleString("de-CH")}</span><span className="faint small">wächst mit Erfolg und guter Stimmung</span></div>
        <div className="stat"><span className="label">Ø Zuschauer</span><span className="value">{f.avgAttendance ? f.avgAttendance.toLocaleString("de-CH") : "–"}</span><span className="faint small">{f.avgAttendance ? `${Math.round((f.avgAttendance / data.club.capacity) * 100)} % Auslastung` : "noch kein Heimspiel"}</span></div>
        <div className="stat">
          <span className="label">Verlauf</span>
          <svg viewBox="0 0 120 36" width="100%" height="40" preserveAspectRatio="none" aria-label="Verlauf der Fanstimmung">
            <line x1="0" y1="18" x2="120" y2="18" stroke="var(--line-2)" strokeDasharray="2 3" />
            {spark.length > 1 && <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={spark.map((h: any, i: number) => `${(i / (spark.length - 1)) * 120},${36 - (h.value / 100) * 36}`).join(" ")} />}
          </svg>
        </div>
      </div>

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Fan-Kontakt" icon="users" flush>
            {data.actions.map((a: any) => (
              <div key={a.key} className="fan-action">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{a.label}</b>
                  <div className="dim small">{a.text}</div>
                  <div className="faint small">Stimmung +{a.gain}{a.cost ? ` · Kosten ${money(a.cost)}` : " · kostenlos"} · alle {a.cooldown} Tage</div>
                </div>
                <button className="btn btn-sm btn-primary" disabled={busy || a.wait > 0 || data.balance < a.cost} onClick={() => post("verein/fans", { action: a.key })}>
                  {a.wait > 0 ? `in ${a.wait} Tagen` : "Durchführen"}
                </button>
              </div>
            ))}
          </Panel>
          <Panel title="Fanstimmen" icon="mail" flush>
            {f.voices.length === 0 ? <p className="dim small" style={{ padding: 14, margin: 0 }}>Nach den ersten Spielen melden sich die Fans zu Wort.</p> : f.voices.map((v: any, i: number) => (
              <div key={i} className={`fan-voice tone-${v.tone}`}>„{v.text}“</div>
            ))}
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Ticketpreise" icon="euro">
            <Seg value={data.tickets.level} onChange={(v) => post("verein/tickets", { level: v })} options={data.tickets.levels.map((l: any) => ({ value: l.value, label: l.label }))} />
            <div className="stack-sm" style={{ marginTop: 12 }}>
              {data.tickets.levels.map((l: any) => (
                <div key={l.value} className="kv"><span className="k">{l.label}</span><span className="v">{money(l.price)} · Nachfrage {Math.round(l.demand * 100)} %</span></div>
              ))}
            </div>
            <p className="faint small" style={{ marginBottom: 0 }}>Günstige Preise füllen das Stadion und machen die Fans glücklich, hohe Preise bringen mehr pro Ticket, kosten aber Zuschauer und Stimmung.</p>
          </Panel>
          <Panel title="Vereinsidentität" icon="stadium">
            <div className="stack">
              <div className="row" style={{ gap: 12 }}>
                <Crest colors={{ primary: form.primary, secondary: form.secondary }} name={form.name || "?"} size={48} />
                <span className="dim small">Vorschau des Wappens</span>
              </div>
              <div className="field"><label htmlFor="cn">Vereinsname</label><input id="cn" className="input" value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="row" style={{ gap: 12 }}>
                <div className="field" style={{ width: 110 }}><label htmlFor="cs">Kürzel</label><input id="cs" className="input" value={form.short} maxLength={4} onChange={(e) => setForm({ ...form, short: e.target.value.toUpperCase() })} /></div>
                <div className="field"><label htmlFor="cp">Hauptfarbe</label><input id="cp" type="color" className="color-input" value={form.primary} onChange={(e) => setForm({ ...form, primary: e.target.value })} /></div>
                <div className="field"><label htmlFor="cz">Zweitfarbe</label><input id="cz" type="color" className="color-input" value={form.secondary} onChange={(e) => setForm({ ...form, secondary: e.target.value })} /></div>
              </div>
              <div className="field"><label htmlFor="st">Stadionname</label><input id="st" className="input" value={form.stadiumName} maxLength={40} onChange={(e) => setForm({ ...form, stadiumName: e.target.value })} /></div>
              <p className="faint small" style={{ margin: 0 }}>Eine Namensänderung bricht mit der Tradition und kostet viel Fanstimmung (bei jeder weiteren mehr), neue Farben oder ein neuer Stadionname weniger.</p>
              <div><button className="btn btn-primary" disabled={busy || !changed} onClick={() => post("verein/identity", form, form.name !== data.club.name ? `Den Verein wirklich in „${form.name}“ umbenennen?` : undefined)}>Änderungen speichern</button></div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
