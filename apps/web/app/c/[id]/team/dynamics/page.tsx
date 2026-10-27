"use client";
import Link from "next/link";
import { useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { useGame } from "@/components/GameShell";
import { Empty, ErrorBox, Loading, Panel, Pos, Progress, moraleLabel, useToast } from "@/components/ui";
import { FaceName, PlayerFace } from "@/components/PlayerFace";
import { CouncilPanel } from "@/components/Council";

function happinessText(h: number | null) {
  if (h === null) return { text: "Noch offen", color: "var(--text-3)" };
  if (h <= -0.6) return { text: "Sehr unzufrieden", color: "var(--neg)" };
  if (h <= -0.25) return { text: "Unzufrieden", color: "var(--warn)" };
  if (h >= 0.3) return { text: "Mehr als erwartet", color: "var(--pos)" };
  return { text: "Zufrieden", color: "var(--text-2)" };
}

export default function DynamicsPage() {
  const { id } = useGame();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`careers/${id}/dynamics`);
  const [busy, setBusy] = useState<number | null>(null);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  async function setStatus(pid: number, status: string) {
    setBusy(pid);
    try {
      const r = await api<any>(`careers/${id}/players/${pid}`, { body: { action: "status", status } });
      toast(r.message, "info");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const tone = (v: number) => (v < 35 ? "danger" : v < 50 ? "warn" : undefined);
  return (
    <>
      <div className="page-head">
        <div><h1>Teamdynamik</h1><p>Stimmung, Hierarchie und Kaderstatus · Saison {data.career.season}</p></div>
      </div>
      <div className="card dyn-kpis">
        <div className="stat">
          <span className="label">Stimmung in der Kabine</span>
          <span className="value">{data.mood.label}</span>
          <Progress value={data.mood.value} tone={tone(data.mood.value)} />
          <span className="faint small">Ø Moral {data.mood.value} · Mannschaftsführer {data.mood.leaders}</span>
        </div>
        <div className="stat">
          <span className="label">Zusammenhalt</span>
          <span className="value">{data.cohesion.label}</span>
          <Progress value={data.cohesion.value} tone={tone(data.cohesion.value)} />
          <span className="faint small">{data.cohesion.matches} Pflichtspiele zusammen · {data.cohesion.newPlayers} Neuzugänge</span>
        </div>
        <div className="stat">
          <span className="label">Unzufriedene Spieler</span>
          <span className="value" style={{ color: data.unhappy.length ? "var(--warn)" : undefined }}>{data.unhappy.length}</span>
          <span className="faint small">{data.players.filter((p: any) => p.transferRequest).length} mit Wechselwunsch</span>
        </div>
      </div>

      <CouncilPanel careerId={id} council={data.council} kit={data.kit} onChanged={reload} />

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <Panel title="Kaderstatus und Einsatzzeit" icon="users" flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Pos</th><th>Name</th><th>Status</th><th className="c" title="Startelfeinsätze / Pflichtspiele">Startelf</th><th className="c">Erwartet</th><th>Einsatzzeit</th><th>Moral</th></tr>
              </thead>
              <tbody>
                {data.players.map((p: any) => {
                  const h = happinessText(p.happiness);
                  const m = moraleLabel(p.morale);
                  return (
                    <tr key={p.id}>
                      <td><Pos p={p.position} /></td>
                      <td className="name">
                        <Link href={`/c/${id}/player/${p.id}`}><FaceName player={p} kit={data.kit}>{p.name}</FaceName></Link>
                        {p.transferRequest && <span className="badge badge-danger" style={{ marginLeft: 6 }}>Wechselwunsch</span>}
                        {p.loan && <span className="badge badge-accent" style={{ marginLeft: 6 }}>Leihe</span>}
                      </td>
                      <td>
                        <select className="select select-sm" value={p.status} disabled={busy === p.id || p.loan} onChange={(e) => setStatus(p.id, e.target.value)} aria-label={`Kaderstatus ${p.name}`}>
                          {data.statuses.map((s: any) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        {p.custom && p.suggested !== p.status && <div className="faint small">Sieht sich als {data.statuses.find((s: any) => s.value === p.suggested)?.label}</div>}
                      </td>
                      <td className="c cond" style={{ fontWeight: 700 }}>{p.matches ? `${p.starts}/${p.matches}` : "–"}</td>
                      <td className="c faint">{p.expected} %</td>
                      <td><span style={{ color: h.color, fontWeight: 600 }}>{h.text}</span>{p.share !== null && <span className="faint small"> · {p.share} %</span>}</td>
                      <td><span style={{ color: m.color, fontWeight: 600 }}>{m.text}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="stack">
          <Panel title="Hierarchie" icon="star" flush>
            {data.hierarchy.map((g: any) => (
              <div key={g.level} className="dyn-group">
                <div className="dyn-group-head">{g.label}</div>
                {g.players.length === 0 ? <div className="faint small" style={{ padding: "8px 14px" }}>–</div> : g.players.slice(0, g.level === "other" ? 6 : 8).map((p: any) => (
                  <Link key={p.id} href={`/c/${id}/player/${p.id}`} className="dyn-row">
                    <PlayerFace player={p} kit={data.kit} size={g.level === "leader" ? 36 : 28} />
                    <span className="name truncate" style={{ flex: 1 }}>{p.name}</span>
                    <span className="faint small">Einfluss {p.influence}</span>
                  </Link>
                ))}
                {g.level === "other" && g.players.length > 6 && <div className="faint small" style={{ padding: "6px 14px" }}>und {g.players.length - 6} weitere</div>}
              </div>
            ))}
          </Panel>
          <Panel title="Unzufriedene Spieler" icon="mail" flush>
            {data.unhappy.length === 0 ? <Empty>Alle Spieler sind zufrieden.</Empty> : (
              <table className="table"><tbody>
                {data.unhappy.map((p: any) => (
                  <tr key={p.id}>
                    <td><div className="face-card"><PlayerFace player={p} kit={data.kit} size={32} /><div><Link href={`/c/${id}/player/${p.id}`} className="name">{p.name}</Link><div className="faint small">{p.reasons.length ? p.reasons.join(" · ") : "Niedrige Moral"}</div></div></div></td>
                    <td className="r"><span style={{ color: moraleLabel(p.morale).color, fontWeight: 600 }}>{moraleLabel(p.morale).text}</span></td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Panel>
          <div className="card-soft small dim">
            Der Kaderstatus legt fest, wie viel Einsatzzeit ein Spieler erwartet. Wer weniger spielt als versprochen, verliert Moral und bittet irgendwann um seine Freigabe.
            Neuzugänge senken den Zusammenhalt, gemeinsame Spiele stärken ihn.
          </div>
        </div>
      </div>
    </>
  );
}
