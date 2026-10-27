"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/client/api";
import { fmtDate } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { Crest, Empty, ErrorBox, Loading, Seg } from "@/components/ui";
import { PlayerFace } from "@/components/PlayerFace";

type Filter = "all" | "own" | "match" | "transfer" | "rumour" | "interview" | "league";

export default function MediaPage() {
  const { id } = useGame();
  const [filter, setFilter] = useState<Filter>("all");
  const { data, error } = useApi<any>(`careers/${id}/media${filter === "all" ? "" : `?filter=${filter}`}`);
  if (error) return <ErrorBox message={error} />;

  const articles: any[] = data?.articles ?? [];
  const lead = articles.find((a) => a.importance >= 2) ?? articles[0];
  const rest = articles.filter((a) => a !== lead);

  return (
    <>
      <div className="page-head">
        <div><h1>Medien</h1><p>Spielberichte, Transfers, Gerüchte und Interviews</p></div>
        <Seg<Filter> value={filter} onChange={setFilter} options={[
          { value: "all", label: "Alle" }, { value: "own", label: "Dein Verein" }, { value: "match", label: "Spielberichte" },
          { value: "transfer", label: "Transfers" }, { value: "rumour", label: "Gerüchte" }, { value: "interview", label: "Interviews" }, { value: "league", label: "Liga" },
        ]} />
      </div>
      {!data ? <Loading /> : articles.length === 0 ? (
        <div className="card"><Empty>Noch keine Meldungen. Die Presse berichtet über Spiele, Transfers und Gerüchte, sobald die Saison läuft.</Empty></div>
      ) : (
        <div className="grid grid-main" style={{ alignItems: "start" }}>
          <div className="stack">
            {lead && (
              <article className={`card news-lead ${lead.own ? "own" : ""}`}>
                <div className="news-kicker">{lead.kindLabel} · {fmtDate(lead.date, { year: false })}{lead.own && <span className="badge badge-accent">Dein Verein</span>}{lead.ai && <AiBadge />}</div>
                <div className="news-lead-body">
                  {lead.player ? <PlayerFace player={lead.player} kit={lead.player.kit} size={96} /> : lead.club ? <Crest colors={lead.club.colors} name={lead.club.name} size={72} /> : null}
                  <div style={{ minWidth: 0 }}>
                    <h2 className="news-title">{lead.title}</h2>
                    <p className="news-text">{lead.body}</p>
                    <Links id={id} a={lead} />
                  </div>
                </div>
              </article>
            )}
            <div className="card card-flush">
              {rest.map((a) => (
                <article key={a.id} className={`news-item ${a.own ? "own" : ""}`}>
                  {a.player ? <PlayerFace player={a.player} kit={a.player.kit} size={44} /> : a.club ? <Crest colors={a.club.colors} name={a.club.name} size={36} /> : <span style={{ width: 44 }} />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="news-kicker">{a.kindLabel} · {fmtDate(a.date, { year: false })}{a.ai && <AiBadge />}</div>
                    <div className="news-item-title">{a.title}</div>
                    {a.body !== a.title && <div className="dim small">{a.body}</div>}
                    <Links id={id} a={a} />
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div className="stack">
            <div className="card">
              <div className="faint small up" style={{ fontWeight: 700, marginBottom: 8 }}>Übersicht</div>
              {[["match", "Spielberichte"], ["transfer", "Transfers"], ["rumour", "Gerüchte"], ["interview", "Interviews"], ["league", "Liga"]].map(([k, label]) => (
                <div key={k} className="kv"><span className="k">{label}</span><span className="v">{data.counts[k] ?? 0}</span></div>
              ))}
              <div className="kv"><span className="k">Über deinen Verein</span><span className="v">{data.ownCount}</span></div>
            </div>
            <div className="card-soft small dim">
              Gerüchte sind nicht immer wahr: Wenn ein grösserer Verein einen deiner Spieler beobachtet, kann bald ein Angebot folgen.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Links({ id, a }: { id: string; a: any }) {
  if (!a.player && !a.club) return null;
  return (
    <div className="row small" style={{ gap: 12, marginTop: 6 }}>
      {a.player && <Link href={`/c/${id}/player/${a.player.id}`}>Profil von {a.player.name}</Link>}
      {a.club && <Link href={`/c/${id}/club/${a.club.id}`}>{a.club.name}</Link>}
    </div>
  );
}

function AiBadge() {
  return <span className="badge badge-blue" title="Von Claude geschrieben (KI)">KI-Text</span>;
}
