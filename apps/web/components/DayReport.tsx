"use client";
import Link from "next/link";
import { useEffect } from "react";
import { fmtDate, matchRatingColor, weekdayShort } from "@/lib/client/format";
import { CategoryIcon, Icon } from "./ui";

const INTENSITY: Record<string, string> = { low: "niedrige Intensität", normal: "normale Intensität", high: "hohe Intensität" };
const TODAY_TEXT: Record<string, string> = {
  recovery: "Nach dem Spiel stehen Auslaufen, Massage und Eisbad auf dem Plan. Die Kondition erholt sich deutlich.",
  off: "Trainingsfreier Tag. Die Spieler erholen sich.",
  holiday: "Die Mannschaft ist im Urlaub. Der Betrieb ruht, Verträge und Transfers laufen weiter.",
  friendly: "Heute stand ein Testspiel auf dem Programm. Das Ergebnis liegt im Posteingang.",
  match: "Heute ist Spieltag. Klicke auf „Zum Spiel“, um die Mannschaft aufs Feld zu schicken.",
};

/**
 * Tagesbericht nach jedem Klick auf „Weiter“: Training, neue Nachrichten,
 * Zustand der Mannschaft und Ausblick – rechts eingeblendet.
 */
export function DayReport({ report, base, busy, matchday, onContinue, onClose, onOpenMessage }: {
  report: any;
  base: string;
  busy: boolean;
  matchday: boolean;
  onContinue: () => void;
  onClose: () => void;
  onOpenMessage: (id: number) => void;
}) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && !busy) {
        e.preventDefault();
        onContinue();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [busy, onClose, onContinue]);

  const r = report;
  const tr = r.training;
  return (
    <>
      <div className="dr-backdrop" onClick={onClose} />
      <aside className="dayreport" role="dialog" aria-label="Tagesbericht">
        <div className="dr-head">
          <div style={{ minWidth: 0 }}>
            <span className="dr-kicker">Tagesbericht · {r.label}</span>
            <h2>{fmtDate(r.date, { long: true })}</h2>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Schliessen"><Icon name="close" size={16} /></button>
        </div>
        <div className={`dr-progress ${busy ? "on" : ""}`}><span /></div>

        <div className="dr-body">
          <section className="dr-section">
            <h4>Heute</h4>
            {tr ? (
              <>
                <div className="between" style={{ marginBottom: 8 }}>
                  <div><b>{tr.session}</b><div className="faint small">Trainingseinheit · {INTENSITY[tr.intensity] ?? tr.intensity}</div></div>
                  <div className="dr-avg"><span className="faint small">Ø Note</span><b style={{ color: matchRatingColor(tr.average) }}>{tr.average.toFixed(1)}</b></div>
                </div>
                <div className="dr-ratings">
                  <span className="faint small up">Beste Eindrücke</span>
                  {tr.top.map((p: any) => (
                    <Link key={p.id} href={`${base}/player/${p.id}`} onClick={onClose} className="dr-rating">
                      <span className="faint" style={{ width: 34 }}>{p.position}</span><span className="truncate" style={{ flex: 1 }}>{p.name}</span>
                      <b style={{ color: matchRatingColor(p.rating) }}>{p.rating.toFixed(1)}</b>
                    </Link>
                  ))}
                  <span className="faint small up" style={{ marginTop: 6 }}>Schwächste Eindrücke</span>
                  {tr.bottom.map((p: any) => (
                    <Link key={p.id} href={`${base}/player/${p.id}`} onClick={onClose} className="dr-rating">
                      <span className="faint" style={{ width: 34 }}>{p.position}</span><span className="truncate" style={{ flex: 1 }}>{p.name}</span>
                      <b style={{ color: matchRatingColor(p.rating) }}>{p.rating.toFixed(1)}</b>
                    </Link>
                  ))}
                </div>
              </>
            ) : <p className="dim small">{TODAY_TEXT[r.type] ?? "Ein ruhiger Tag im Verein."}</p>}
          </section>

          <section className="dr-section">
            <h4>Neue Nachrichten {r.inbox.length > 0 && <span className="badge badge-blue">{r.inbox.length}</span>}</h4>
            {r.inbox.length === 0 ? <p className="dim small">Keine neuen Nachrichten.</p> : (
              <div className="dr-list">
                {r.inbox.map((m: any) => (
                  <button key={m.id} className="dr-msg" onClick={() => onOpenMessage(m.id)}>
                    <span className="inbox-icon"><CategoryIcon category={m.category} /></span>
                    <span className="truncate" style={{ flex: 1, textAlign: "left" }}>{m.title}</span>
                    <Icon name="next" size={12} />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="dr-section">
            <h4>Mannschaft</h4>
            <div className="dr-stats">
              <div><span className="faint small">Ø Kondition</span><b style={{ color: r.squad.fitness < 80 ? "var(--warn)" : undefined }}>{r.squad.fitness}%</b></div>
              <div><span className="faint small">Verletzt</span><b style={{ color: r.squad.injured ? "var(--neg)" : undefined }}>{r.squad.injured}</b></div>
              <div><span className="faint small">Unzufrieden</span><b style={{ color: r.squad.unhappy ? "var(--warn)" : undefined }}>{r.squad.unhappy}</b></div>
            </div>
          </section>

          {r.next && (
            <section className="dr-section">
              <h4>Nächstes Spiel</h4>
              <div className="between">
                <div style={{ minWidth: 0 }}>
                  <b className="truncate" style={{ display: "block" }}>{r.next.home ? "vs" : "@"} {r.next.opponent}</b>
                  <span className="faint small">{r.next.competition}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <b className="cond" style={{ fontSize: 18 }}>{r.next.days === 0 ? "Heute" : r.next.days === 1 ? "Morgen" : `in ${r.next.days} Tagen`}</b>
                  <div className="faint small">{fmtDate(r.next.date)}</div>
                </div>
              </div>
            </section>
          )}

          <section className="dr-section">
            <h4>Ausblick</h4>
            <div className="dr-outlook">
              {r.outlook.map((o: any) => (
                <div key={o.day} className={`t-${o.type}`}><span className="faint small">{weekdayShort(o.date)} {fmtDate(o.date, { year: false }).slice(3)}</span><b>{o.label}</b></div>
              ))}
            </div>
          </section>
        </div>

        <div className="dr-foot">
          <Link href={`${base}/calendar`} className="btn btn-ghost" onClick={onClose}><Icon name="calendar" size={15} /> Kalender</Link>
          <button className={`btn ${matchday ? "btn-success" : "btn-primary"} ml-auto`} onClick={onContinue} disabled={busy}>
            {busy ? "Verarbeite …" : matchday ? "Zum Spiel" : "Weiter"} <Icon name="next" size={15} />
          </button>
        </div>
      </aside>
    </>
  );
}
