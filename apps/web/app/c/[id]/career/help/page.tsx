"use client";
import { useMemo, useState } from "react";
import { HELP } from "@/lib/client/help";
import { useGame } from "@/components/GameShell";
import { useOnboarding } from "@/components/Onboarding";
import { Empty, Icon, useToast } from "@/components/ui";

/** Hilfe & Glossar: Kapitel zum Aufklappen, Suche über alle Einträge, Tipps zurücksetzen. */
export default function HelpPage() {
  useGame();
  const { state, act } = useOnboarding();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const term = q.trim().toLowerCase();
  const topics = useMemo(() => HELP.map((t) => ({
    ...t, items: term ? t.items.filter((i) => `${i.q} ${i.a}`.toLowerCase().includes(term)) : t.items,
  })).filter((t) => t.items.length), [term]);

  async function restore() {
    await act({ action: "restore" });
    toast("Seitentipps und „Erste Schritte“ werden wieder angezeigt.", "success");
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Hilfe & Glossar</h1><p>Alles Wichtige zum Spiel – kurz erklärt</p></div>
        <div className="row">
          <input className="input" placeholder="Suchen, z. B. Vertrautheit" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Hilfe durchsuchen" style={{ width: 240 }} />
        </div>
      </div>
      {state && (
        <div className="card help-status">
          <span><Icon name="star" size={15} /> Schwierigkeitsgrad: <b>{state.difficulty.label}</b> <span className="faint small">– {state.difficulty.text}</span></span>
          <span className="row" style={{ gap: 8 }}>
            <span className="faint small">Erste Schritte {state.done}/{state.total}</span>
            <button className="btn btn-sm" onClick={restore}>Tipps wieder anzeigen</button>
          </span>
        </div>
      )}
      {topics.length === 0 && <Empty>Nichts gefunden. Versuche ein anderes Stichwort.</Empty>}
      <div className="help-grid">
        {topics.map((t) => (
          <section key={t.id} className="card help-topic">
            <h3><Icon name={t.icon} size={15} /> {t.title}</h3>
            {t.items.map((i) => {
              const key = `${t.id}:${i.q}`;
              const isOpen = !!term || open === key;
              return (
                <div key={key} className={`help-item ${isOpen ? "open" : ""}`}>
                  <button className="help-q" aria-expanded={isOpen} onClick={() => setOpen(isOpen && !term ? null : key)}>
                    <span>{i.q}</span><Icon name={isOpen ? "up" : "down"} size={14} />
                  </button>
                  {isOpen && <p className="help-a">{i.a}</p>}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}
