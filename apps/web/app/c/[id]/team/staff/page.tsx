"use client";
import { useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { PlayerFace } from "@/components/PlayerFace";
import { Empty, ErrorBox, Loading, Nat, Panel, Progress, Seg, useToast } from "@/components/ui";

type Role = "all" | "coach" | "physio" | "scout" | "youth";

function Quality({ q }: { q: number }) {
  return (
    <span className="row" style={{ gap: 8, minWidth: 120 }}>
      <b className="cond" style={{ fontSize: 16, width: 24 }}>{q}</b>
      <span style={{ flex: 1 }}><Progress value={q} max={20} tone={q < 7 ? "danger" : q < 11 ? "warn" : undefined} /></span>
    </span>
  );
}

export default function StaffPage() {
  const { id } = useGame();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`careers/${id}/staff`);
  const [role, setRole] = useState<Role>("all");
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  async function act(path: string, body: unknown, confirmText?: string) {
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

  const face = (m: any) => ({ id: m.faceId, name: m.name, age: m.age, nationality: m.nationality });
  const candidates = data.candidates.filter((c: any) => role === "all" || c.role === role);

  return (
    <>
      <div className="page-head">
        <div><h1>Trainerstab</h1><p>{data.club.name} · Gehälter Stab {money(data.weeklyTotal)} pro Woche · Vereinsruf {data.club.reputation}</p></div>
      </div>
      <div className="staff-grid">
        {data.roles.map((r: any) => (
          <section key={r.role} className="card staff-card">
            <div className="faint small up" style={{ fontWeight: 700 }}>{r.label}</div>
            {r.member ? (
              <>
                <div className="face-card" style={{ marginTop: 10 }}>
                  <PlayerFace player={face(r.member)} kit={data.club.colors} size={64} />
                  <div style={{ minWidth: 0 }}>
                    <div className="name" style={{ fontSize: 17 }}>{r.member.name}</div>
                    <div className="row small dim" style={{ gap: 6 }}><Nat code={r.member.nationality} /> {r.member.age} Jahre · {r.member.style}</div>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}><div className="faint small">Stärke</div><Quality q={r.member.quality} /></div>
                <div className="stack-sm" style={{ marginTop: 8 }}>
                  {Object.entries(r.member.traits).map(([k, v]: [string, any]) => (
                    <div key={k} className="between small"><span className="dim">{k}</span><b className="cond">{v}</b></div>
                  ))}
                </div>
                <div className="kv" style={{ marginTop: 8 }}><span className="k">Gehalt</span><span className="v">{money(r.member.wage)} / Woche</span></div>
                <div className="kv"><span className="k">Vertrag bis</span><span className="v" style={{ color: r.member.until <= data.season ? "var(--warn)" : undefined }}>{r.member.until}</span></div>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn btn-sm" disabled={busy || r.member.until > data.season + 1} title={r.member.until > data.season + 1 ? "Verlängerung erst im letzten Vertragsjahr" : undefined} onClick={() => act("staff/renew", { memberId: r.member.id })}>Verlängern</button>
                  <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => act("staff/fire", { memberId: r.member.id }, `${r.member.name} entlassen? Abfindung: ${money(r.member.severance)}`)}>Entlassen</button>
                </div>
              </>
            ) : (
              <div style={{ marginTop: 10 }}>
                <p className="neg-txt" style={{ fontWeight: 600, margin: 0 }}>Stelle unbesetzt</p>
                <p className="dim small">Eine Notlösung arbeitet auf Stärke {r.effective}. Stelle unten jemanden ein.</p>
              </div>
            )}
            <p className="faint small" style={{ marginTop: 10, marginBottom: 0 }}>{r.effect}</p>
          </section>
        ))}
      </div>
      <Panel title="Personalmarkt" icon="users" flush actions={<Seg<Role> value={role} onChange={setRole} options={[{ value: "all", label: "Alle" }, { value: "coach", label: "Co-Trainer" }, { value: "physio", label: "Physio" }, { value: "scout", label: "Scout" }, { value: "youth", label: "Jugend" }]} />}>
        {candidates.length === 0 ? <Empty>Keine Kandidaten. Neue Bewerbungen kommen alle vier Wochen.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Rolle</th><th>Stärke</th><th className="hide-sm">Stärken</th><th className="r">Gehalt</th><th className="r">Handgeld</th><th className="r" /></tr></thead>
              <tbody>
                {candidates.map((c: any) => {
                  const current = data.roles.find((r: any) => r.role === c.role);
                  const better = c.quality > current.effective;
                  const top = Object.entries(c.traits).sort((a: any, b: any) => b[1] - a[1]).slice(0, 2);
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="face-card" style={{ gap: 10 }}>
                          <PlayerFace player={face(c)} size={36} />
                          <div style={{ minWidth: 0 }}><div className="name">{c.name}</div><div className="row faint small" style={{ gap: 6 }}><Nat code={c.nationality} />{c.age} Jahre · {c.style}</div></div>
                        </div>
                      </td>
                      <td className="dim">{c.roleLabel}</td>
                      <td><span className="row" style={{ gap: 6 }}><Quality q={c.quality} />{better ? <span className="badge badge-blue">besser</span> : null}</span></td>
                      <td className="hide-sm dim small">{top.map(([k, v]: any) => `${k} ${v}`).join(" · ")}</td>
                      <td className="r">{money(c.wage)}</td>
                      <td className="r faint">{money(c.wage * 4)}</td>
                      <td className="r">
                        {c.interested
                          ? <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act("staff/hire", { candidateId: c.id }, `${c.name} als ${c.roleLabel} einstellen?${current.member ? ` ${current.member.name} erhält eine Abfindung von ${money(current.member.severance)}.` : ""}`)}>Einstellen</button>
                          : <span className="faint small" title={`Erwartet Vereinsruf ${c.requiredReputation}`}>Kein Interesse</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
