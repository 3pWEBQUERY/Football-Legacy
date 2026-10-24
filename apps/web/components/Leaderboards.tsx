"use client";
import { useApi } from "@/lib/client/api";
import { seasonLabel } from "@/lib/client/format";
import { Empty, ErrorBox, Loading } from "./ui";

export function Leaderboards() {
  const { data, error } = useApi<any>("leaderboards");
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  return (
    <div className="grid grid-3" style={{ alignItems: "start" }}>
      <div className="card card-flush">
        <div className="card-head" ><h3>Beste Punkteausbeute</h3></div>
        {data.best.length === 0 ? <Empty>Noch keine abgeschlossenen Saisons.</Empty> : (
          <table className="table">
            <tbody>
              {data.best.map((r: any, i: number) => (
                <tr key={i}>
                  <td className="num faint">{i + 1}.</td>
                  <td><b>{r.display_name}</b><div className="faint small">{r.club_name} · {seasonLabel(r.season)} · Platz {r.position}{r.champion ? " · Meister" : r.promoted ? " · Aufstieg" : ""}</div></td>
                  <td className="r num"><b>{Number(r.ppg).toFixed(2)}</b><div className="faint small">P/Spiel</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card card-flush">
        <div className="card-head" ><h3>Manager-Level</h3></div>
        {data.levels.length === 0 ? <Empty>Noch keine Manager.</Empty> : (
          <table className="table">
            <tbody>
              {data.levels.map((r: any, i: number) => (
                <tr key={i}>
                  <td className="num faint">{i + 1}.</td>
                  <td><b>{r.display_name}</b><div className="faint small">{r.manager_name} · {r.club_name ?? "vereinslos"}</div></td>
                  <td className="r"><b>Lv {r.level}</b><div className="faint small">{r.xp} XP</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card card-flush">
        <div className="card-head" ><h3>Titel & Aufstiege</h3></div>
        {data.titles.length === 0 ? <Empty>Noch niemand hat einen Titel geholt.</Empty> : (
          <table className="table">
            <tbody>
              {data.titles.map((r: any, i: number) => (
                <tr key={i}>
                  <td className="num faint">{i + 1}.</td>
                  <td><b>{r.display_name}</b><div className="faint small">{r.manager_name} · {r.seasons} Saisons</div></td>
                  <td className="r cond" style={{ fontWeight: 700 }}>{r.titles} T · {r.promotions} A</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
