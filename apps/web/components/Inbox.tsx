"use client";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { dayIso, fmtDate } from "@/lib/client/format";
import { PlayerFace } from "./PlayerFace";
import { Crest, Empty, FormChips, Icon, useToast } from "./ui";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "unread", label: "Ungelesen" },
  { key: "match", label: "Spiele" },
  { key: "squad", label: "Kader" },
  { key: "transfer", label: "Transfers" },
  { key: "club", label: "Verein" },
  { key: "media", label: "Medien" },
  { key: "career", label: "Karriere" },
];

const KIND_ICON: Record<string, string> = { media: "news", league: "trophy", agent: "contract", system: "star", staff: "team", player: "users" };

export function SenderAvatar({ sender, size = 34 }: { sender: any; size?: number }) {
  if (sender?.face) return <span className="inbox-avatar face" style={{ width: size, height: size }}><PlayerFace player={sender.face} size={size} /></span>;
  if ((sender?.kind === "board" || sender?.kind === "club" || sender?.kind === "fans") && sender?.colors) {
    return (
      <span className={`inbox-avatar crest k-${sender.kind}`} style={{ width: size, height: size }}>
        <Crest colors={sender.colors} name={sender.name} size={Math.round(size * 0.78)} />
        {sender.kind !== "club" && <span className="inbox-avatar-badge"><Icon name={sender.kind === "board" ? "board" : "users"} size={10} /></span>}
      </span>
    );
  }
  return <span className={`inbox-avatar icon k-${sender?.kind ?? "system"}`} style={{ width: size, height: size }}><Icon name={KIND_ICON[sender?.kind] ?? "mail"} size={Math.round(size * 0.47)} /></span>;
}

/** Strukturierte Nachrichteninhalte (Kennzahlen, Spieler, Statistik, Zitat …). */
export function MessageBlocks({ blocks, body, base }: { blocks: any[] | null; body: string; base: string }) {
  if (!blocks?.length) return <p className="inbox-body">{body}</p>;
  return (
    <div className="msg-blocks">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p": return <p key={i} className="msg-p">{b.text}</p>;
          case "kv": return (
            <dl key={i} className="msg-kv">{b.rows.map(([k, v]: [string, string]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          );
          case "players": return (
            <div key={i} className="msg-players">
              {b.title && <div className="msg-sub">{b.title}</div>}
              {b.items.map((p: any) => (
                <Link key={`${p.id}-${p.pos}`} href={`${base}/player/${p.id}`} className="msg-player">
                  <span className="msg-player-pos">{p.pos}</span>
                  <span className="msg-player-name"><b>{p.name}</b>{p.note && <small>{p.note}</small>}</span>
                  {p.value && <span className="msg-player-val">{p.value}</span>}
                  <Icon name="next" size={13} />
                </Link>
              ))}
            </div>
          );
          case "quote": return (
            <blockquote key={i} className="msg-quote"><p>{b.text}</p><cite>– {b.by}</cite></blockquote>
          );
          case "stats": return (
            <div key={i} className="msg-stats">
              <div className="msg-stats-head"><b>{b.home}</b><b>{b.away}</b></div>
              {b.rows.map((r: any) => {
                const sum = Math.max(0.0001, r.hn + r.an);
                return (
                  <div key={r.label} className="msg-stat">
                    <div className="msg-stat-row"><b>{r.home}</b><span>{r.label}</span><b>{r.away}</b></div>
                    <div className="msg-stat-bar"><i style={{ flex: r.hn / sum || 0.001 }} /><i style={{ flex: r.an / sum || 0.001 }} /></div>
                  </div>
                );
              })}
            </div>
          );
          case "list": return <ul key={i} className="msg-list">{b.items.map((x: string, j: number) => <li key={j}>{x}</li>)}</ul>;
          case "form": return (
            <div key={i} className="msg-form"><span className="msg-sub">{b.label}</span><FormChips form={b.form.map((f: string) => (f === "S" ? "W" : f === "U" ? "D" : "L"))} /></div>
          );
          default: return null;
        }
      })}
    </div>
  );
}

function dayLabel(m: any, today: { season: number; day: number }) {
  if (m.day === null || m.day === undefined) return m.week === 0 ? "Saisonvorbereitung" : `Runde ${m.week}`;
  if (m.season === today.season && m.day === today.day) return "Heute";
  if (m.season === today.season && m.day === today.day - 1) return "Gestern";
  return fmtDate(dayIso(m.season, m.day), { long: true });
}

/**
 * Posteingang im Stil des Manager-Spiels: Filter, nach Tagen gruppierte Liste
 * mit Absender, Lesebereich mit strukturiertem Inhalt und Aktionen.
 */
export function Inbox({ careerId, today, openId, onSelect, actions, initialUnread }: {
  careerId: string;
  today: { season: number; day: number };
  openId: number | null;
  onSelect: (m: any) => void;
  actions: (m: any) => ReactNode;
  initialUnread: number;
}) {
  const toast = useToast();
  const base = `/c/${careerId}`;
  const [filter, setFilter] = useState("all");
  const { data, reload } = useApi<any>(`careers/${careerId}/inbox?filter=${filter}`);
  const [older, setOlder] = useState<any[]>([]);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => { setOlder([]); setMore(!!data?.more); }, [data]);

  const list = useMemo(() => [...(data?.messages ?? []), ...older], [data, older]);
  const open = list.find((m) => m.id === openId) ?? null;
  const unread = data?.unread ?? { all: initialUnread };

  useEffect(() => {
    // Erste Nachricht des Filters öffnen, wenn die geöffnete nicht dazugehört
    if (list.length && !list.some((m) => m.id === openId)) onSelect(list[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, data]);

  async function loadMore() {
    const last = list[list.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const r = await api<any>(`careers/${careerId}/inbox?filter=${filter}&before=${last.id}`);
      setOlder((o) => [...o, ...r.messages]);
      setMore(r.more);
    } finally {
      setLoadingMore(false);
    }
  }

  async function markAll() {
    await api(`careers/${careerId}/inbox`, { body: { ids: "all" } });
    reload();
    refreshAll();
  }

  async function archive(m: any) {
    const idx = list.findIndex((x) => x.id === m.id);
    const next = list[idx + 1] ?? list[idx - 1] ?? null;
    await api(`careers/${careerId}/inbox/archive`, { body: { ids: [m.id] } });
    toast("Nachricht archiviert");
    setOlder((o) => o.filter((x) => x.id !== m.id));
    if (next) onSelect(next);
    reload();
    refreshAll();
  }

  // Gruppen nach Datum
  const groups: { label: string; items: any[] }[] = [];
  for (const m of list) {
    const label = dayLabel(m, today);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(m);
    else groups.push({ label, items: [m] });
  }

  return (
    <section className="card card-flush inbox-card">
      <div className="card-head">
        <h3><Icon name="mail" size={15} /> Posteingang {unread.all > 0 && <span className="badge badge-blue">{unread.all} neu</span>}</h3>
        {unread.all > 0 && <button className="btn btn-ghost btn-sm" onClick={markAll}>Alle gelesen</button>}
      </div>
      <div className="inbox-filters" role="tablist" aria-label="Nachrichten filtern">
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key} className={`inbox-filter ${filter === f.key ? "active" : ""}`} onClick={() => setFilter(f.key)}>
            {f.label}{(unread[f.key] ?? 0) > 0 && f.key !== "all" && <span className="inbox-filter-n">{unread[f.key]}</span>}
          </button>
        ))}
      </div>
      {list.length === 0 ? <Empty>{filter === "unread" ? "Alles gelesen." : "Keine Nachrichten."}</Empty> : (
        <div className="inbox">
          <div className="inbox-list">
            {groups.map((g) => (
              <div key={g.label} className="inbox-group">
                <div className="inbox-day">{g.label}</div>
                {g.items.map((m) => (
                  <div key={m.id} className={`inbox-item ${m.read ? "" : "unread"} ${openId === m.id ? "active" : ""} ${m.priority >= 2 ? "important" : ""}`}
                    onClick={() => onSelect(m)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect(m)}>
                    <SenderAvatar sender={m.sender} />
                    <div style={{ minWidth: 0, flex: 1, paddingRight: 12 }}>
                      <div className="inbox-title truncate">{m.title}</div>
                      <div className="inbox-from truncate">{m.sender?.name}<span> · {m.sender?.role}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {more && <button className="btn btn-ghost btn-sm inbox-more" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Lade …" : "Ältere Nachrichten laden"}</button>}
          </div>
          <div className="inbox-read">
            {open ? (
              <>
                <div className="msg-head">
                  <SenderAvatar sender={open.sender} size={46} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="msg-from"><b>{open.sender?.name}</b><span>{open.sender?.role}</span></div>
                    <div className="faint small">{open.day !== null && open.day !== undefined ? fmtDate(dayIso(open.season, open.day), { long: true }) : dayLabel(open, today)}</div>
                  </div>
                  {open.priority >= 2 && <span className="badge badge-danger">Wichtig</span>}
                  <button className="btn btn-ghost btn-sm" onClick={() => archive(open)} title="Nachricht archivieren"><Icon name="trash" size={14} /> <span className="hide-sm">Archivieren</span></button>
                </div>
                <h2>{open.title}</h2>
                <MessageBlocks blocks={open.blocks} body={open.body} base={base} />
                <div className="msg-actions">{actions(open)}</div>
              </>
            ) : <Empty>Wähle eine Nachricht.</Empty>}
          </div>
        </div>
      )}
    </section>
  );
}
