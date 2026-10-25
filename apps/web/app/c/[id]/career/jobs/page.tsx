"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Crest, Empty, ErrorBox, Icon, Loading, Nat, Panel, Progress, Seg, useToast } from "@/components/ui";
import { confirmFrom, useConfirm } from "@/components/Dialog";

const CONFED: Record<string, string> = { UEFA: "Europa", CONMEBOL: "Südamerika", CONCACAF: "Nord-/Mittelamerika", AFC: "Asien", CAF: "Afrika", OFC: "Ozeanien" };
const TONE: Record<string, string> = { pos: "var(--pos)", warn: "var(--warn)", neg: "var(--neg)", neutral: "var(--text-3)" };
const APP_STATUS: Record<string, string> = { pending: "Wartet auf Antwort", rejected: "Absage", offer: "Angebot erhalten" };

function Stars({ value }: { value: number }) {
  const n = Math.max(1, Math.min(5, Math.round(value / 20)));
  return <span className="rep-stars" title={`Ansehen ${value}/100`}>{"★".repeat(n)}<span>{"★".repeat(5 - n)}</span></span>;
}

export default function JobsPage() {
  const { id, reloadShell } = useGame();
  const router = useRouter();
  const toast = useToast();
  const ask = useConfirm();
  const [filter, setFilter] = useState({ status: "alle", confed: "", country: "", tier: "", q: "", reachable: false, page: 1 });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  // Suche leicht verzögert, damit nicht jeder Tastendruck lädt
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.q === q ? f : { ...f, q, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [q]);
  const params = new URLSearchParams({ status: filter.status, confed: filter.confed, country: filter.country, tier: filter.tier, q: filter.q, reachable: filter.reachable ? "1" : "", page: String(filter.page) });
  const { data, error, reload } = useApi<any>(`careers/${id}/jobs?${params}`);
  const set = (patch: Partial<typeof filter>) => setFilter((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  async function act(path: string, body: unknown, confirmText?: string, after?: () => void) {
    if (confirmText && !(await ask(confirmFrom(confirmText)))) return;
    setBusy(true);
    try {
      const r = await api<any>(`careers/${id}/${path}`, { body });
      toast(r.message ?? "Erledigt", "success");
      reload();
      reloadShell();
      refreshAll();
      after?.();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const me = data.me;
  const countries = data.countries.filter((c: any) => !filter.confed || c.confed === filter.confed);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Freie Stellen</h1>
          <p>Trainerposten in aller Welt: freie Stellen, wackelnde Trainer und Vereine, bei denen du dich initiativ bewerben kannst.</p>
        </div>
        <div className="row job-counts">
          <span><b>{data.counts.frei}</b> frei</span>
          <span><b>{data.counts.unsicher}</b> unsicher</span>
          <span><b>{data.counts.besetzt}</b> besetzt</span>
        </div>
      </div>

      <div className="grid grid-3 jobs-top" style={{ alignItems: "start" }}>
        <Panel title="Deine Situation" icon="career">
          {me.club ? (
            <div className="stack-sm">
              <div className="row" style={{ gap: 10 }}>
                <Crest colors={me.club.colors} name={me.club.name} size={36} />
                <div style={{ minWidth: 0 }}><b className="truncate" style={{ display: "block" }}>{me.club.name}</b><span className="dim small">{me.club.league}{me.club.position ? ` · Platz ${me.club.position}` : ""}</span></div>
              </div>
              <div className="kv"><span className="k">Vertrag bis</span><span className="v">Sommer {me.contract ? me.contract.untilSeason + 1 : "–"}</span></div>
              <div className="kv"><span className="k">Gehalt</span><span className="v">{me.contract ? `${money(me.contract.wage)} / Jahr` : "–"}</span></div>
              <div className="kv"><span className="k">Ziel</span><span className="v">{me.objective}</span></div>
              <div>
                <div className="between small"><span className="dim">Jobsicherheit (Vorstand)</span><b>{me.confidence}/100</b></div>
                <Progress value={me.confidence} tone={me.confidence < 25 ? "danger" : me.confidence < 45 ? "warn" : undefined} />
              </div>
            </div>
          ) : (
            <div className="stack-sm">
              <div className="row" style={{ gap: 10 }}>
                <span className="unemployed-mark big"><Icon name="search" size={20} /></span>
                <div><b>Vereinslos</b><div className="dim small">Bewirb dich oder warte auf Anfragen – mit „Weiter“ läuft die Zeit.</div></div>
              </div>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <div className="between small"><span className="dim">Dein Ansehen</span><b>{me.reputation}/100</b></div>
            <Progress value={me.reputation} />
          </div>
          {me.club && (
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("jobs/resign", {}, `Wirklich bei ${me.club.name} zurücktreten? Du bist dann vereinslos und dein Ansehen sinkt leicht.`)}>
                Zurücktreten
              </button>
            </div>
          )}
        </Panel>

        <Panel title={`Angebote (${data.offers.length})`} icon="contract" flush>
          {data.offers.length === 0 ? <Empty>Aktuell keine Angebote. Gute Ergebnisse und ein steigendes Ansehen locken Anfragen an.</Empty> : data.offers.map((o: any) => (
            <div key={o.clubId} className="job-offer">
              <div className="row" style={{ gap: 10 }}>
                {o.colors && <Crest colors={o.colors} name={o.clubName} size={32} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b className="truncate" style={{ display: "block" }}>{o.clubName}</b>
                  <span className="dim small"><Nat code={o.countryCode} /> {o.leagueName}</span>
                </div>
                <span className={`badge ${o.daysLeft <= 3 ? "badge-warn" : "badge-blue"}`}>noch {o.daysLeft} T.</span>
              </div>
              <div className="job-terms small">
                {o.expectation && <span><span className="faint">Erwartung</span> {o.expectation}</span>}
                {o.wage && <span><span className="faint">Gehalt</span> {money(o.wage)}/Jahr</span>}
                {o.years && <span><span className="faint">Vertrag</span> {o.years} {o.years === 1 ? "Jahr" : "Jahre"}</span>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act("job", { clubId: o.clubId }, me.club ? `Zu ${o.clubName} wechseln? Du verlässt ${me.club.name} sofort.` : undefined, () => router.push(`/c/${id}`))}>Annehmen</button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("jobs/decline", { clubId: o.clubId })}>Ablehnen</button>
                <Link className="btn btn-ghost btn-sm" href={`/c/${id}/club/${o.clubId}`}>Verein ansehen</Link>
              </div>
            </div>
          ))}
        </Panel>

        <Panel title="Bewerbungen" icon="mail" flush>
          {data.applications.length === 0 ? <Empty>Noch keine Bewerbungen verschickt.</Empty> : data.applications.map((a: any, i: number) => (
            <div key={`${a.clubId}-${i}`} className="job-app">
              {a.colors && <Crest colors={a.colors} name={a.club} size={24} />}
              <div style={{ minWidth: 0, flex: 1 }}>
                <b className="truncate" style={{ display: "block" }}>{a.club}</b>
                <span className="faint small">{a.status === "pending" ? `${a.unsolicited ? "Initiativbewerbung · " : ""}Antwort in ca. ${Math.max(1, a.decideIn)} T.` : a.text ?? (a.ago === 0 ? "heute" : `vor ${a.ago} T.`)}</span>
              </div>
              <span className={`badge ${a.status === "offer" ? "badge-accent" : a.status === "rejected" ? "badge-danger" : "badge-blue"}`}>{APP_STATUS[a.status]}</span>
              {a.status === "pending" && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("jobs/withdraw", { clubId: a.clubId })} aria-label="Bewerbung zurückziehen"><Icon name="close" size={13} /></button>}
            </div>
          ))}
        </Panel>
      </div>

      <div className="card job-filters">
        <Seg value={filter.status} onChange={(v) => set({ status: v })} options={[
          { value: "alle", label: "Alle" },
          { value: "frei", label: `Frei (${data.counts.frei})` },
          { value: "unsicher", label: `Unsicher (${data.counts.unsicher})` },
          { value: "besetzt", label: `Bewerben (${data.counts.besetzt})` },
        ]} />
        <select className="input" value={filter.confed} onChange={(e) => set({ confed: e.target.value, country: "" })} aria-label="Kontinent">
          <option value="">Alle Kontinente</option>
          {Object.entries(CONFED).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" value={filter.country} onChange={(e) => set({ country: e.target.value })} aria-label="Land">
          <option value="">Alle Länder</option>
          {countries.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select className="input" value={filter.tier} onChange={(e) => set({ tier: e.target.value })} aria-label="Liga-Stufe">
          <option value="">Alle Ligen</option>
          {[1, 2, 3, 4].map((t) => <option key={t} value={t}>{t}. Liga</option>)}
        </select>
        <input className="input" placeholder="Verein oder Stadt …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Suchen" />
        <label className="row small" style={{ gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={filter.reachable} onChange={(e) => set({ reachable: e.target.checked })} /> Nur realistische
        </label>
      </div>

      <section className="card card-flush">
        <div className="table-wrap">
          <table className="table jobs-table">
            <thead>
              <tr><th>Verein</th><th className="hide-sm">Liga</th><th className="hide-sm">Ansehen</th><th className="hide-sm">Trainer</th><th className="hide-sm">Status</th><th className="hide-sm">Chance</th><th /></tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={7}><Empty>Keine Vereine für diese Auswahl.</Empty></td></tr>}
              {data.rows.map((r: any) => (
                <tr key={r.clubId} className={r.offered ? "highlight" : ""}>
                  <td>
                    <Link href={`/c/${id}/club/${r.clubId}`} className="row" style={{ gap: 8, minWidth: 0 }}>
                      <Crest colors={r.colors} name={r.name} size={22} />
                      <span style={{ minWidth: 0 }}>
                        <b className="truncate" style={{ display: "block" }}>{r.name}</b>
                        <span className="faint small show-sm">
                          <span className={r.status === "frei" ? "pos-txt" : r.status === "unsicher" ? "warn-txt" : ""}>{r.status === "frei" ? `Frei${r.vacantDays ? ` seit ${r.vacantDays} T.` : ""}` : r.status === "unsicher" ? "Trainer wackelt" : "Besetzt"}</span>
                          {" · "}{r.league} · <span style={{ color: TONE[r.chance.tone] }}>Chance {r.chance.label}</span>
                        </span>
                        <span className="faint small hide-sm">{r.city}{r.position ? ` · Platz ${r.position}` : ""} · Ziel: {r.expectation}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="hide-sm"><span className="row" style={{ gap: 6 }}><Nat code={r.countryCode} /><span className="truncate">{r.league}</span></span></td>
                  <td className="hide-sm"><Stars value={r.reputation} /></td>
                  <td className="hide-sm dim truncate">{r.coach ?? <span className="faint">– vakant –</span>}</td>
                  <td className="hide-sm">
                    {r.status === "frei" ? (
                      <span className="badge badge-accent" title={r.reason ?? undefined}>Frei{r.vacantDays ? ` · ${r.vacantDays} T.` : ""}</span>
                    ) : r.status === "unsicher" ? (
                      <span className="job-security" title={`Jobsicherheit ${r.security}/100`}><span className="badge badge-warn">Unsicher</span><i style={{ width: `${Math.max(6, r.security)}%` }} /></span>
                    ) : <span className="badge">Besetzt</span>}
                  </td>
                  <td className="hide-sm"><b style={{ color: TONE[r.chance.tone] }}>{r.chance.label}</b></td>
                  <td className="r nowrap">
                    {r.offered ? <span className="badge badge-accent">Angebot!</span>
                      : r.applied ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act("jobs/withdraw", { clubId: r.clubId })} title="Bewerbung zurückziehen">Läuft …</button>
                      : (
                        <span className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                          {r.status === "unsicher" && (
                            <button className={`btn btn-sm ${r.interest ? "btn-primary" : "btn-ghost"}`} disabled={busy} onClick={() => act("jobs/interest", { clubId: r.clubId })} title="Interesse bekunden: wird die Stelle frei, bist du sofort im Gespräch">
                              <Icon name="eye" size={13} /><span className="hide-sm"> {r.interest ? "Vorgemerkt" : "Interesse"}</span>
                            </button>
                          )}
                          <button className={`btn btn-sm ${r.status === "frei" ? "btn-primary" : "btn-ghost"}`} disabled={busy} onClick={() => act("jobs/apply", { clubId: r.clubId })}>
                            {r.status === "besetzt" ? "Initiativ" : "Bewerben"}
                          </button>
                        </span>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.pages > 1 && (
          <div className="between" style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
            <button className="btn btn-ghost btn-sm" disabled={data.page <= 1} onClick={() => set({ page: data.page - 1 })}><Icon name="back" size={13} /> Zurück</button>
            <span className="faint small">Seite {data.page} von {data.pages} · {data.total} Vereine</span>
            <button className="btn btn-ghost btn-sm" disabled={data.page >= data.pages} onClick={() => set({ page: data.page + 1 })}>Weiter <Icon name="next" size={13} /></button>
          </div>
        )}
      </section>
    </>
  );
}
