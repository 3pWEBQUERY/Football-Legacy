"use client";
import { useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { MobileSubnav, useGame } from "@/components/GameShell";
import { ErrorBox, Icon, Loading, Progress, Seg, useToast } from "@/components/ui";

const FOCUS = [
  { id: "balanced", label: "Ausgewogen", icon: "board", text: "Alle Bereiche gleichmässig – solide Entwicklung." },
  { id: "attack", label: "Angriff", icon: "target", text: "Abschluss, Laufwege, Dribbling, Flanken." },
  { id: "defense", label: "Abwehr", icon: "shield", text: "Tackling, Manndeckung, Stellungsspiel, Kopfball." },
  { id: "physical", label: "Physis", icon: "bolt", text: "Tempo, Ausdauer, Kraft. Bremst die Alterung." },
  { id: "technical", label: "Technik", icon: "ball", text: "Ballannahme, Passen, Technik, Standards." },
  { id: "mental", label: "Taktik & Mentalität", icon: "info", text: "Entscheidungen, Übersicht, Antizipation." },
  { id: "recovery", label: "Regeneration", icon: "medical", text: "Schnellere Erholung, kaum Entwicklung." },
];

const STAFF: Record<string, { label: string; text: string }> = {
  coach: { label: "Co-Trainer", text: "Beschleunigt die Entwicklung im Training." },
  physio: { label: "Physiotherapeut", text: "Verkürzt Ausfallzeiten und senkt das Verletzungsrisiko." },
  scout: { label: "Chefscout", text: "Mehr Berichte pro Woche, grösseres Scouting-Netzwerk." },
  youth: { label: "Jugendtrainer", text: "Bessere Talente im jährlichen Jugendjahrgang." },
};

export default function Training() {
  const { id, shell } = useGame();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`careers/${id}/finances`);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const plan = data.training;
  const unlockedStaff = shell?.career?.unlocked?.includes("staff_upgrade");

  async function setPlan(patch: any) {
    setBusy(true);
    try {
      await api(`careers/${id}/training`, { method: "PUT", body: { ...plan, ...patch } });
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function upgrade(role: string) {
    try {
      const r = await api<any>(`careers/${id}/staff`, { body: { role } });
      toast(`${STAFF[role].label} verbessert (${money(r.cost)})`, "success");
      reload();
      refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function autoSubs(v: boolean) {
    await api(`careers/${id}/autosubs`, { method: "PUT", body: { autoSubs: v } });
    refreshAll();
  }

  return (
    <>
      <MobileSubnav section="team" />
      <div className="page-head">
        <div>
          <h1>Training & Stab</h1>
          <p>Der Wochenplan wirkt jede Woche auf Entwicklung, Fitness und Verletzungsrisiko.</p>
        </div>
        {shell?.career?.trainingBoostWeeks > 0 && <span className="badge badge-gold">Trainingsbonus aktiv: noch {shell.career.trainingBoostWeeks} Wochen</span>}
      </div>
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <div className="card stack">
            <div className="card-head"><h3>Trainingsschwerpunkt</h3></div>
            <div className="grid grid-2" style={{ gap: 8 }}>
              {FOCUS.map((f) => (
                <button key={f.id} disabled={busy} onClick={() => setPlan({ focus: f.id })} className="card-soft row" style={{ cursor: "pointer", textAlign: "left", borderColor: plan.focus === f.id ? "var(--accent)" : undefined, background: plan.focus === f.id ? "var(--accent-soft)" : undefined }}>
                  <span style={{ color: plan.focus === f.id ? "var(--accent)" : "var(--text-3)", display: "inline-flex" }}><Icon name={f.icon} size={20} /></span>
                  <div><b>{f.label}</b><div className="faint small">{f.text}</div></div>
                </button>
              ))}
            </div>
          </div>
          <div className="card stack">
            <div className="card-head"><h3>Intensität & Optionen</h3></div>
            <div className="between">
              <div><b>Intensität</b><p className="faint small">Hoch: schnellere Entwicklung, weniger Erholung, mehr Verletzungen.</p></div>
              <Seg value={plan.intensity} onChange={(v) => setPlan({ intensity: v })} options={[{ value: "low", label: "Niedrig" }, { value: "normal", label: "Normal" }, { value: "high", label: "Hoch" }]} />
            </div>
            <label className="row" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={plan.youthFocus} onChange={(e) => setPlan({ youthFocus: e.target.checked })} />
              <span><b>Talentförderung</b> <span className="dim">– Spieler bis 21 erhalten Extraeinheiten (+30 % Entwicklung)</span></span>
            </label>
            <label className="row" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={shell?.career?.autoSubs ?? true} onChange={(e) => autoSubs(e.target.checked)} />
              <span><b>Automatische Wechsel</b> <span className="dim">– dein Co-Trainer wechselt in der 2. Halbzeit müde Spieler aus</span></span>
            </label>
          </div>
        </div>
        <div className="card stack">
          <div className="card-head"><h3>Trainerstab</h3></div>
          {!unlockedStaff && <p className="badge badge-blue" style={{ whiteSpace: "normal" }}>Ausbau ab Manager-Level 7</p>}
          {Object.entries(STAFF).map(([k, s]) => (
            <div key={k} className="stack-sm">
              <div className="between"><b>{s.label}</b><span className="num">{data.staff[k]}/20</span></div>
              <Progress value={data.staff[k]} max={20} />
              <div className="between">
                <span className="faint small">{s.text}</span>
                {unlockedStaff && data.staffCosts[k] && <button className="btn btn-sm" onClick={() => upgrade(k)}>+1 ({money(data.staffCosts[k])})</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
