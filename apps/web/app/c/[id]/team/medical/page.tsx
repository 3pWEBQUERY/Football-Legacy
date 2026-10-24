"use client";
import Link from "next/link";
import { useApi } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Empty, ErrorBox, Loading, Panel, Pos, Rating } from "@/components/ui";
import { FaceName, PlayerFace } from "@/components/PlayerFace";

const INTENSITY: Record<string, string> = { low: "niedrig", normal: "normal", high: "hoch" };

export default function MedicalPage() {
  const { id } = useGame();
  const { data, error } = useApi<any>(`careers/${id}/medical`);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div><h1>Medizinische Abteilung</h1><p>Physiotherapie Stufe {data.physio} · Trainingsintensität {INTENSITY[data.intensity]} · {data.available} von {data.squadSize} Spielern einsatzfähig</p></div>
      </div>
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title={`Verletzte Spieler (${data.injured.length})`} icon="medical" flush>
            {data.injured.length === 0 ? <Empty>Keine Verletzten. Der Kader ist fit.</Empty> : (
              <table className="table">
                <thead><tr><th>Pos</th><th>Name</th><th className="c">Stärke</th><th>Verletzung</th><th>Seit</th><th className="c">Ausfall</th><th>Rückkehr voraussichtlich</th></tr></thead>
                <tbody>
                  {data.injured.map((p: any) => (
                    <tr key={p.id}>
                      <td><Pos p={p.position} /></td>
                      <td className="name"><Link href={`/c/${id}/player/${p.id}`}><FaceName player={p} kit={data.kit} /></Link></td>
                      <td className="c"><Rating value={p.rating} /></td>
                      <td><span style={{ color: p.longTerm ? "var(--neg)" : undefined, fontWeight: p.longTerm ? 700 : 500 }}>{p.injury}</span></td>
                      <td className="faint small">{p.since ? fmtDate(p.since, { year: false }) : "–"}</td>
                      <td className="c cond" style={{ fontWeight: 700 }}>{p.weeksLeft} {p.weeksLeft === 1 ? "Woche" : "Wochen"}</td>
                      <td>{fmtDate(p.expectedReturn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          {data.suspended.length > 0 && (
            <Panel title="Gesperrte Spieler" icon="contract" flush>
              <table className="table"><tbody>
                {data.suspended.map((p: any) => (
                  <tr key={p.id}><td style={{ width: 44 }}><Pos p={p.position} /></td><td className="name"><Link href={`/c/${id}/player/${p.id}`}><FaceName player={p} kit={data.kit} /></Link></td><td className="r">{p.matches} {p.matches === 1 ? "Spiel" : "Spiele"}</td></tr>
                ))}
              </tbody></table>
            </Panel>
          )}
        </div>
        <div className="stack">
          <Panel title="Verletzungsrisiko" icon="target" flush>
            {data.risk.length === 0 ? <p className="dim small" style={{ padding: 14 }}>Kein Spieler mit erhöhtem Risiko.</p> : (
              <table className="table">
                <tbody>
                  {data.risk.map((r: any) => (
                    <tr key={r.id}>
                      <td style={{ width: 44 }}><Pos p={r.position} /></td>
                      <td><div className="face-card"><PlayerFace player={r} kit={data.kit} size={32} /><div><Link href={`/c/${id}/player/${r.id}`} className="name">{r.name}</Link><div className="faint small">{r.reasons.join(" · ")}</div></div></div></td>
                      <td className="r"><span className={`badge ${r.level === "hoch" ? "badge-danger" : r.level === "erhöht" ? "badge-warn" : ""}`}>{r.level}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <div className="card small dim">Müde Spieler verletzen sich häufiger. Rotation, Regenerationstage und eine niedrigere Trainingsintensität senken das Risiko; eine bessere Physiotherapie verkürzt die Ausfallzeiten.</div>
        </div>
      </div>
    </>
  );
}
