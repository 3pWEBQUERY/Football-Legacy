"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { Icon, Modal, Progress, useToast } from "./ui";

/**
 * Einstieg: Willkommens-Tour, Checkliste „Erste Schritte“ und einmalige
 * Seitentipps. Der Zustand liegt in der Karriere (Server), damit er auf
 * allen Geräten gleich ist.
 */

/** Seiten, deren Besuch einen Schritt der Checkliste erfüllt (wie im Spiel-Backend). */
const TRACKED = new Set(["/board", "/team", "/team/tactic", "/team/training", "/market/search", "/market/contracts"]);

interface OnboardingCtx {
  state: any | null;
  act: (body: Record<string, unknown>) => Promise<any>;
}
const Ctx = createContext<OnboardingCtx>({ state: null, act: async () => null });
export const useOnboarding = () => useContext(Ctx);

export function OnboardingProvider({ careerId, children }: { careerId: string; children: ReactNode }) {
  const [state, setState] = useState<any | null>(null);
  const toast = useToast();
  const path = usePathname();
  const base = `/c/${careerId}`;

  useEffect(() => {
    api<any>(`careers/${careerId}/onboarding`).then(setState).catch(() => setState(null));
  }, [careerId]);

  const act = useCallback(async (body: Record<string, unknown>) => {
    const r = await api<any>(`careers/${careerId}/onboarding`, { body });
    setState(r);
    for (const f of r.fresh ?? []) toast(`Erste Schritte: ${f} ✓`, "success");
    return r;
  }, [careerId, toast]);

  // Besuche zählen, solange die Checkliste läuft
  useEffect(() => {
    if (!state?.active || !path.startsWith(base)) return;
    const rel = path.slice(base.length) || "/";
    const step = state.steps.find((s: any) => s.href === rel);
    if (TRACKED.has(rel) && step && !step.done) act({ action: "visit", page: rel }).catch(() => {});
  }, [path, base, state, act]);

  return <Ctx.Provider value={{ state, act }}>{children}</Ctx.Provider>;
}

// ------------------------------------------------------------ Willkommens-Tour

const TOUR = [
  { icon: "office", title: "Willkommen im Büro", text: "Hier laufen alle Fäden zusammen: Posteingang, nächstes Spiel, Tabelle und Vorstand. Wichtige Nachrichten erkennst du an der Markierung – viele haben direkt Knöpfe zum Handeln." },
  { icon: "next", title: "Die Zeit läuft mit „Weiter“", text: "Oben rechts geht es Tag für Tag weiter: Training, Testspiele, Spieltage. „Weiter“ stoppt automatisch, wenn etwas Wichtiges passiert. Tastenkürzel: Strg + Leertaste." },
  { icon: "team", title: "Deine Mannschaft", text: "Unter Team findest du Kader, Taktik, Training, Jugend und Medizin. Vor jedem Spiel lohnt ein Blick auf Kondition, Verletzungen und Sperren." },
  { icon: "transfer", title: "Transfers und Verträge", text: "Spieler suchen, scouten und in zwei Stufen verhandeln: erst mit dem Verein, dann mit dem Spieler. Verlängere wichtige Verträge rechtzeitig." },
  { icon: "target", title: "Der Vorstand schaut zu", text: "Jede Saison gibt es ein Ziel und dazu eine Vision über drei Jahre. Das Vertrauen folgt deinem Tabellenplatz – fällt es zu tief, bist du den Job los." },
];

export function WelcomeTour({ clubName, objective }: { clubName?: string; objective?: string }) {
  const { state, act } = useOnboarding();
  const [i, setI] = useState(0);
  const [closed, setClosed] = useState(false);
  if (!state || state.tourDone || closed) return null;
  const s = TOUR[i];
  const last = i === TOUR.length - 1;
  const finish = () => { setClosed(true); act({ action: "tour" }).catch(() => {}); };
  return (
    <Modal open onClose={finish}>
      <div className="tour">
        <div className="tour-head">
          <span className="tour-icon"><Icon name={s.icon} size={26} /></span>
          <div>
            <span className="faint up small">{i === 0 && clubName ? `${clubName} · ` : ""}Schritt {i + 1} von {TOUR.length}</span>
            <h2>{s.title}</h2>
          </div>
        </div>
        <p>{s.text}</p>
        {i === TOUR.length - 1 && objective && <p className="tour-goal"><Icon name="target" size={14} /> Dein Saisonziel: <b>{objective}</b></p>}
        <div className="tour-dots" aria-hidden="true">{TOUR.map((_, j) => <span key={j} className={j === i ? "on" : ""} />)}</div>
        <div className="between">
          <button className="btn btn-ghost" onClick={finish}>Überspringen</button>
          <div className="row">
            {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Zurück</button>}
            <button className="btn btn-primary" onClick={() => (last ? finish() : setI(i + 1))}>{last ? "Los geht's" : "Weiter"}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ Erste Schritte

export function FirstSteps({ base }: { base: string }) {
  const { state, act } = useOnboarding();
  const [expanded, setExpanded] = useState(false);
  if (!state || !state.active) return null;
  // Auf dem Smartphone nur die nächsten drei offenen Schritte (Rest aufklappbar)
  const open = state.steps.filter((s: any) => !s.done).map((s: any) => s.id);
  const extra = new Set(open.slice(3));
  return (
    <section className={`card first-steps ${expanded ? "expanded" : ""}`}>
      <div className="between" style={{ gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3><Icon name="check" size={15} /> Erste Schritte</h3>
          <span className="faint small">Je Schritt +{state.reward.step} XP · alles erledigt: +{state.reward.complete} XP und {state.reward.points} Manager-Punkte</span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <b className="cond">{state.done}/{state.total}</b>
          <button className="btn btn-ghost btn-sm" onClick={() => act({ action: "dismiss" })}>Ausblenden</button>
        </div>
      </div>
      <Progress value={state.done} max={state.total} />
      <div className="steps-grid">
        {state.steps.map((s: any) => {
          const body = (
            <>
              <span className={`step-check ${s.done ? "done" : ""}`}>{s.done ? <Icon name="check" size={13} /> : null}</span>
              <span className="step-text"><b>{s.title}</b><small>{s.text}</small></span>
            </>
          );
          const cls = `step ${s.done ? "is-done" : ""} ${extra.has(s.id) ? "extra" : ""}`;
          return s.href && !s.done
            ? <Link key={s.id} href={`${base}${s.href}`} className={cls}>{body}<Icon name="next" size={13} /></Link>
            : <div key={s.id} className={cls}>{body}</div>;
        })}
      </div>
      {state.steps.length > 3 && (
        <button className="btn btn-ghost btn-sm steps-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Weniger anzeigen" : `Alle ${state.total} Schritte anzeigen`}
        </button>
      )}
    </section>
  );
}

// ------------------------------------------------------------ Seitentipps

/** Einmaliger Hinweis oben auf einer Seite; „Verstanden“ blendet ihn dauerhaft aus. */
export function PageTip({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const { state, act } = useOnboarding();
  const [hidden, setHidden] = useState(false);
  if (!state || hidden || state.tips?.[id]) return null;
  return (
    <aside className="page-tip" role="note">
      <span className="page-tip-icon"><Icon name="info" size={16} /></span>
      <div className="page-tip-body"><b>{title}</b><div className="small">{children}</div></div>
      <button className="btn btn-sm" onClick={() => { setHidden(true); act({ action: "tip", id }).catch(() => {}); }}>Verstanden</button>
    </aside>
  );
}
