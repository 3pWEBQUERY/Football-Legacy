"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/client/api";
import { MONTHS, fmtDate, isoParts } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Crest, ErrorBox, Icon, Loading } from "@/components/ui";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const FOCUS: Record<string, string> = { balanced: "Ausgewogen", attack: "Angriff", defense: "Abwehr", physical: "Athletik", mental: "Mental", technical: "Technik", recovery: "Regeneration" };

export default function CalendarPage() {
  const { id } = useGame();
  const { data, error } = useApi<any>(`careers/${id}/calendar`);
  const [offset, setOffset] = useState(0);
  const base = `/c/${id}`;

  const months = useMemo(() => {
    if (!data) return [];
    const list: { year: number; month: number }[] = [];
    for (const d of data.days) {
      const p = isoParts(d.date);
      if (!list.some((m) => m.year === p.year && m.month === p.month)) list.push({ year: p.year, month: p.month });
    }
    return list;
  }, [data]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const todayParts = isoParts(data.todayDate);
  const todayIdx = Math.max(0, months.findIndex((m) => m.year === todayParts.year && m.month === todayParts.month));
  const idx = Math.min(months.length - 1, Math.max(0, todayIdx + offset));
  const cur = months[idx];
  const monthDays = data.days.filter((d: any) => {
    const p = isoParts(d.date);
    return p.year === cur.year && p.month === cur.month;
  });
  const daysInMonth = new Date(Date.UTC(cur.year, cur.month + 1, 0)).getUTCDate();
  const cells: (any | null)[] = [];
  // Vor Saisonbeginn bzw. nach Saisonende bleiben die Tage leer
  const blankBefore = (new Date(Date.UTC(cur.year, cur.month, 1)).getUTCDay() + 6) % 7;
  for (let i = 0; i < blankBefore; i++) cells.push(null);
  for (let dt = 1; dt <= daysInMonth; dt++) {
    const entry = monthDays.find((d: any) => isoParts(d.date).date === dt);
    cells.push(entry ?? { outside: true, date: dt });
  }
  while (cells.length % 7) cells.push(null);
  const matches = monthDays.filter((d: any) => d.match);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Kalender</h1>
          <p>Heute: {fmtDate(data.todayDate, { long: true })} · Trainingsschwerpunkt {FOCUS[data.trainingFocus] ?? data.trainingFocus}</p>
        </div>
        <div className="row">
          <button className="btn btn-sm" disabled={idx === 0} onClick={() => setOffset(offset - 1)} aria-label="Vorheriger Monat"><Icon name="back" size={14} /></button>
          <strong className="cond up" style={{ fontSize: 18, minWidth: 150, textAlign: "center" }}>{MONTHS[cur.month]} {cur.year}</strong>
          <button className="btn btn-sm" disabled={idx === months.length - 1} onClick={() => setOffset(offset + 1)} aria-label="Nächster Monat"><span style={{ display: "inline-flex", transform: "scaleX(-1)" }}><Icon name="back" size={14} /></span></button>
          {offset !== 0 && <button className="btn btn-ghost btn-sm" onClick={() => setOffset(0)}>Heute</button>}
        </div>
      </div>

      <div className="grid grid-side" style={{ alignItems: "start" }}>
        <section className="card card-flush">
          <div className="cal-grid cal-head">{WEEKDAYS.map((w) => <div key={w}>{w}</div>)}</div>
          <div className="cal-grid">
            {cells.map((d, i) => {
              if (!d) return <div key={i} className="cal-cell empty" />;
              if (d.outside) return <div key={i} className="cal-cell empty"><span className="cal-date">{d.date}</span></div>;
              const p = isoParts(d.date);
              const past = d.day < data.today;
              return (
                <div key={i} className={`cal-cell t-${d.type} ${d.day === data.today ? "today" : ""} ${past ? "past" : ""}`}>
                  <div className="between" style={{ gap: 4, flexWrap: "nowrap" }}>
                    <span className="cal-date">{p.date}</span>
                    {d.window && <span className="cal-window" title="Transferfenster offen">TF</span>}
                  </div>
                  {d.match ? (
                    <Link href={d.match.played ? `${base}/report/${d.match.fixtureId}` : `${base}/club/${d.match.opponent?.id}`} className="cal-match">
                      {d.match.opponent && <Crest colors={d.match.opponent.colors} name={d.match.opponent.name} size={18} />}
                      <span style={{ minWidth: 0 }}>
                        <span className="truncate" style={{ display: "block", fontWeight: 700 }}>{d.match.opponent?.short} ({d.match.home ? "H" : "A"})</span>
                        <span className="faint truncate" style={{ display: "block", fontSize: 11 }}>
                          {d.match.played ? <b className={d.match.goalsFor > d.match.goalsAgainst ? "pos-txt" : d.match.goalsFor < d.match.goalsAgainst ? "neg-txt" : ""}>{d.match.goalsFor}:{d.match.goalsAgainst}</b> : d.match.continental ? "Kontinentalpokal" : d.match.cup ? "Pokal" : d.match.competition}
                        </span>
                      </span>
                    </Link>
                  ) : (
                    <span className="cal-type">{d.label}</span>
                  )}
                  {d.international && <span className="cal-intl">Länderspiele</span>}
                </div>
              );
            })}
          </div>
          <div className="cal-legend">
            <span><i className="t-match" /> Pflichtspiel</span>
            <span><i className="t-friendly" /> Testspiel</span>
            <span><i className="t-prep" /> Spielvorbereitung</span>
            <span><i className="t-recovery" /> Regeneration</span>
            <span><i className="t-training" /> Training</span>
            <span><i className="t-off" /> Frei / Winterpause</span>
            <span><b className="cal-window">TF</b> Transferfenster</span>
            <span><b className="cal-intl" style={{ marginTop: 0 }}>Länderspiele</b> Länderspielpause</span>
          </div>
        </section>

        <section className="card card-flush">
          <div className="card-head"><h3><Icon name="calendar" size={15} /> Spiele im {MONTHS[cur.month]}</h3></div>
          {matches.length === 0 ? <p className="dim small" style={{ padding: 14 }}>Keine Pflichtspiele in diesem Monat.</p> : (
            <table className="table">
              <tbody>
                {matches.map((d: any) => (
                  <tr key={d.day} className={d.day === data.today ? "highlight" : ""}>
                    <td className="nowrap faint small">{fmtDate(d.date, { year: false })}</td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        {d.match.opponent && <Crest colors={d.match.opponent.colors} name={d.match.opponent.name} size={18} />}
                        <span style={{ minWidth: 0 }}>
                          <span className="name truncate" style={{ display: "block" }}>{d.match.opponent?.name}</span>
                          <span className="faint small truncate" style={{ display: "block" }}>{d.match.home ? "Heim" : "Auswärts"} · {d.match.competition}</span>
                        </span>
                      </div>
                    </td>
                    <td className="r cond" style={{ fontWeight: 700, fontSize: 15 }}>
                      {d.match.played ? <Link href={`${base}/report/${d.match.fixtureId}`}>{d.match.goalsFor}:{d.match.goalsAgainst}</Link> : <span className="faint">–</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
