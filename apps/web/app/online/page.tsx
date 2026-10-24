"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { AccountTop } from "@/components/AccountTop";
import { Crest, Empty, ErrorBox, Icon, Loading, Panel, Seg, useToast } from "@/components/ui";

const STATUS_LABEL: Record<string, string> = { open: "Anmeldung offen", running: "Saison läuft", finished: "Saison beendet" };

export default function OnlinePage() {
  const router = useRouter();
  const toast = useToast();
  const { data, error, reload } = useApi<any>("online");
  const [careerId, setCareerId] = useState("");
  const [form, setForm] = useState({ name: "", maxMembers: 8, rhythm: "manual", public: true });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.careers.length && !careerId) setCareerId(data.careers[0].id);
  }, [data, careerId]);

  async function send(path: string, body: unknown) {
    setBusy(true);
    try {
      const r = await api<any>(path, { body });
      toast(r.message, "success");
      router.push(`/online/${r.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing">
      <AccountTop />
      <div className="content" style={{ maxWidth: 1100 }}>
        <div className="page-head">
          <div>
            <h1>Online-Ligen</h1>
            <p>Tritt mit dem Verein aus deiner Karriere gegen andere Manager an. Gespielt wird mit deinem aktuellen Kader und deiner gespeicherten Taktik.</p>
          </div>
        </div>
        {error && <ErrorBox message={error} />}
        {!data ? <Loading /> : (
          <div className="grid grid-main" style={{ alignItems: "start" }}>
            <div className="stack">
              <Panel title="Meine Ligen" icon="trophy" flush>
                {data.leagues.length === 0 ? <Empty>Du spielst noch in keiner Online-Liga. Gründe eine eigene oder tritt per Code bei.</Empty> : data.leagues.map((l: any) => (
                  <Link key={l.id} href={`/online/${l.id}`} className="online-row">
                    {l.team ? <Crest colors={l.team.colors} name={l.team.name} size={30} /> : <span style={{ width: 30 }} />}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b className="truncate" style={{ display: "block" }}>{l.name}</b>
                      <span className="dim small">{l.team?.name} · {l.members}/{l.maxMembers} Teams · {l.rhythm === "daily" ? "täglicher Spieltag" : "Spieltag auf Knopfdruck"}</span>
                    </span>
                    <span className="r">
                      <span className={`badge ${l.status === "running" ? "badge-accent" : l.status === "open" ? "badge-blue" : ""}`}>{STATUS_LABEL[l.status]}</span>
                      {l.status !== "open" && <span className="faint small" style={{ display: "block", marginTop: 4 }}>Saison {l.season} · Spieltag {l.round}/{l.rounds}</span>}
                    </span>
                  </Link>
                ))}
              </Panel>
              <Panel title="Offene Ligen" icon="users" flush>
                {data.open.length === 0 ? <Empty>Gerade sucht keine öffentliche Liga nach Mitspielern.</Empty> : data.open.map((l: any) => (
                  <div key={l.id} className="online-row">
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b className="truncate" style={{ display: "block" }}>{l.name}</b>
                      <span className="dim small">von {l.ownerName} · {l.members}/{l.maxMembers} Teams · {l.rhythm === "daily" ? "täglich" : "auf Knopfdruck"}</span>
                    </span>
                    <Link className="btn btn-ghost btn-sm" href={`/online/${l.id}`}>Ansehen</Link>
                    <button className="btn btn-primary btn-sm" disabled={busy || !careerId} onClick={() => send("online/join", { leagueId: l.id, careerId })}>Beitreten</button>
                  </div>
                ))}
              </Panel>
            </div>

            <div className="stack">
              {data.careers.length === 0 ? (
                <div className="card"><Empty>
                  <p>Für Online-Ligen brauchst du eine Karriere, in der du einen Verein trainierst.</p>
                  <div style={{ marginTop: 12 }}><Link className="btn btn-primary" href="/careers/new">Karriere starten</Link></div>
                </Empty></div>
              ) : (
                <>
                  <Panel title="Dein Team" icon="shield">
                    <div className="field">
                      <label htmlFor="career">Antreten mit</label>
                      <select id="career" className="input" value={careerId} onChange={(e) => setCareerId(e.target.value)}>
                        {data.careers.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>
                    <p className="faint small" style={{ marginBottom: 0 }}>Transfers, Training und Taktik aus dieser Karriere wirken sich direkt auf deine Online-Spiele aus.</p>
                  </Panel>
                  <Panel title="Per Code beitreten" icon="lock">
                    <div className="row" style={{ gap: 8 }}>
                      <input className="input mono" style={{ flex: 1, minWidth: 0, textTransform: "uppercase", letterSpacing: 2 }} maxLength={6} placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Einladungscode" />
                      <button className="btn btn-primary" disabled={busy || code.length !== 6} onClick={() => send("online/join", { code, careerId })}>Beitreten</button>
                    </div>
                  </Panel>
                  <Panel title="Liga gründen" icon="plus">
                    <div className="stack">
                      <div className="field"><label htmlFor="lname">Liganame</label><input id="lname" className="input" maxLength={40} placeholder="z. B. Freitagsrunde" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                      <div className="field">
                        <label htmlFor="lmax">Teams: {form.maxMembers}</label>
                        <input id="lmax" type="range" min={2} max={20} value={form.maxMembers} onChange={(e) => setForm({ ...form, maxMembers: Number(e.target.value) })} />
                        <span className="faint small">{(form.maxMembers - 1) * 2} Spieltage (Hin- und Rückrunde). Freie Plätze kannst du mit CPU-Teams füllen.</span>
                      </div>
                      <div className="field">
                        <label>Spielrhythmus</label>
                        <Seg value={form.rhythm} onChange={(v) => setForm({ ...form, rhythm: v })} options={[{ value: "manual", label: "Wenn alle bereit sind" }, { value: "daily", label: "Täglich" }]} />
                        <span className="faint small">{form.rhythm === "daily" ? "Jeden Tag wird automatisch ein Spieltag gespielt – oder früher, wenn alle bereit sind." : "Gespielt wird, sobald alle bereit sind oder du als Gründer startest."}</span>
                      </div>
                      <label className="row" style={{ gap: 8, cursor: "pointer" }}>
                        <input type="checkbox" checked={form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} />
                        <span className="small">Öffentlich auflisten (sonst nur per Code)</span>
                      </label>
                      <div><button className="btn btn-primary" disabled={busy || form.name.trim().length < 3} onClick={() => send("online", { ...form, careerId })}><Icon name="plus" size={15} /> Liga gründen</button></div>
                    </div>
                  </Panel>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
