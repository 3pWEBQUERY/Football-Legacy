"use client";
import { Traits } from "@/components/Traits";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { COMPARE_MAX, compareList, saveCompare } from "@/lib/client/compare";
import { ATTR_GROUPS, money, seasonLabel } from "@/lib/client/format";
import { useGame } from "@/components/GameShell";
import { CATS, GK_CATS } from "@/components/Radar";
import { PlayerFace } from "@/components/PlayerFace";
import { Empty, ErrorBox, Icon, Loading, Nat, Panel, Pos, Rating } from "@/components/ui";

const COLORS = ["#3d8bfd", "#f59e0b", "#a855f7"];

/** Attributwert: genau oder Mitte der geschätzten Spanne. */
const attr = (p: any, k: string): { v: number; exact: boolean } =>
  p.attrs ? { v: p.attrs[k], exact: true } : { v: (p.attrRanges[k][0] + p.attrRanges[k][1]) / 2, exact: false };

function CompareRadar({ players }: { players: any[] }) {
  const gk = players.every((p) => p.position === "GK");
  const cats = gk ? GK_CATS : CATS;
  const size = 320, c = size / 2, r = size / 2 - 52;
  const pt = (i: number, f: number) => {
    const a = -Math.PI / 2 + (i / cats.length) * Math.PI * 2;
    return [c + Math.cos(a) * r * f, c + Math.sin(a) * r * f];
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="compare-radar" role="img" aria-label="Stärkenprofil im Vergleich">
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={cats.map((_, i) => pt(i, f).join(",")).join(" ")} className="radar-grid" />)}
      {cats.map((cat, i) => {
        const [x, y] = pt(i, 1.2);
        return <text key={cat.label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="radar-label">{cat.label}</text>;
      })}
      {players.map((p, j) => {
        const vals = cats.map((cat) => cat.keys.reduce((s, k) => s + attr(p, k).v, 0) / cat.keys.length / 20);
        return <polygon key={p.id} points={vals.map((v, i) => pt(i, Math.max(0.05, v)).join(",")).join(" ")} fill={COLORS[j]} fillOpacity={0.14} stroke={COLORS[j]} strokeWidth={2} />;
      })}
    </svg>
  );
}

export default function ComparePage() {
  const { id } = useGame();
  const router = useRouter();
  const params = useSearchParams();
  const [ids, setIds] = useState<number[] | null>(null);
  const [players, setPlayers] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[]>([]);

  useEffect(() => {
    const fromUrl = (params.get("ids") ?? "").split(",").map(Number).filter((x) => Number.isInteger(x) && x > 0);
    const list = fromUrl.length ? fromUrl.slice(0, COMPARE_MAX) : compareList(id);
    saveCompare(id, list);
    setIds(list);
  }, [id, params]);

  useEffect(() => {
    if (!ids) return;
    Promise.all(ids.map((pid) => api<any>(`careers/${id}/players/${pid}`).then((r) => ({ ...r.player, club: r.club, own: r.own })).catch(() => null)))
      .then((list) => setPlayers(list.filter(Boolean)))
      .catch((e) => setError((e as Error).message));
  }, [id, ids]);

  useEffect(() => {
    if (q.trim().length < 3) { setHits([]); return; }
    const t = setTimeout(() => {
      api<any>(`careers/${id}/market?q=${encodeURIComponent(q.trim())}`).then((r) => setHits((r.players ?? []).slice(0, 6))).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [id, q]);

  const set = (next: number[]) => { saveCompare(id, next); setIds(next); router.replace(`/c/${id}/compare?ids=${next.join(",")}`); };
  const best = useMemo(() => {
    const m = new Map<string, number>();
    if (!players) return m;
    for (const g of ATTR_GROUPS) for (const [k] of g.keys) m.set(k, Math.max(...players.map((p) => attr(p, k).v)));
    return m;
  }, [players]);

  if (error) return <ErrorBox message={error} />;
  if (!ids || !players) return <Loading />;

  return (
    <>
      <div className="page-head">
        <div><h1>Spielervergleich</h1><p>Bis zu {COMPARE_MAX} Spieler nebeneinander – Werte unbekannter Spieler sind Schätzungen (~).</p></div>
        <div className="compare-search">
          <input className="input" placeholder="Spieler hinzufügen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Spieler zum Vergleich suchen" disabled={ids.length >= COMPARE_MAX} />
          {hits.length > 0 && (
            <div className="compare-hits">
              {hits.map((h) => (
                <button key={h.id} onClick={() => { setQ(""); setHits([]); if (!ids.includes(h.id)) set([...ids, h.id].slice(-COMPARE_MAX)); }}>
                  <Pos p={h.position} /> <b>{h.name}</b> <span className="faint small">{h.clubName ?? "vereinslos"} · {h.age} J.</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {players.length === 0 ? (
        <Empty>Noch keine Spieler im Vergleich. Öffne ein Spielerprofil und klicke auf „Vergleichen“ – oder suche oben nach einem Namen.</Empty>
      ) : (
        <>
          <div className="compare-cards" style={{ gridTemplateColumns: `repeat(${players.length}, minmax(0, 1fr))` }}>
            {players.map((p, j) => (
              <div key={p.id} className="card compare-card" style={{ borderTopColor: COLORS[j] }}>
                <div className="row" style={{ gap: 10 }}>
                  <PlayerFace player={p} kit={p.club?.colors} size={44} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Link href={`/c/${id}/player/${p.id}`} className="name truncate" style={{ display: "block", fontWeight: 700 }}>{p.name}</Link>
                    <span className="row faint small" style={{ gap: 6 }}><Pos p={p.position} /><Nat code={p.nationality} />{p.age} J. · {p.club?.name ?? "vereinslos"}</span>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => set(ids.filter((x) => x !== p.id))} aria-label={`${p.name} entfernen`}><Icon name="close" size={14} /></button>
                </div>
                <div className="compare-kv">
                  <span>Stärke</span><Rating value={p.rating} range={p.ratingRange} />
                  <span>Marktwert</span><b>{money(p.value)}</b>
                  <span>Vertrag</span><b>{p.contract ? `bis ${seasonLabel(p.contract.untilSeason)}` : "–"}</b>
                  <span>Saison</span><b>{p.stats?.apps ?? 0} Sp · {p.stats?.goals ?? 0} T · {p.stats?.assists ?? 0} V</b>
                  <span>Charakter</span><span><Traits traits={p.traits} compact /></span>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-main" style={{ alignItems: "start" }}>
            <Panel title="Attribute" icon="chart" flush>
              <div className="table-wrap">
                <table className="table compare-table">
                  <thead><tr><th>Attribut</th>{players.map((p, j) => <th key={p.id} className="c" style={{ color: COLORS[j] }}>{p.lastName ?? p.name}</th>)}</tr></thead>
                  <tbody>
                    {ATTR_GROUPS.map((g) => [
                      <tr key={g.title} className="compare-group"><td colSpan={players.length + 1}>{g.title}</td></tr>,
                      ...g.keys.map(([k, label]) => (
                        <tr key={k}>
                          <td>{label}</td>
                          {players.map((p) => {
                            const a = attr(p, k);
                            const top = players.length > 1 && a.v === best.get(k);
                            return <td key={p.id} className={`c num ${top ? "compare-best" : ""}`}>{a.exact ? a.v : `~${Math.round(a.v)}`}</td>;
                          })}
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="Stärkenprofil" icon="target">
              <CompareRadar players={players} />
              <div className="row-wrap small" style={{ justifyContent: "center", gap: 12 }}>
                {players.map((p, j) => <span key={p.id} className="row" style={{ gap: 6 }}><i className="shot-swatch" style={{ background: COLORS[j] }} />{p.name}</span>)}
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
