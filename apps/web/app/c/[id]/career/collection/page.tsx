"use client";
import { useState } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { POS_LABEL } from "@/lib/client/format";
import { MobileSubnav, useGame } from "@/components/GameShell";
import { Empty, ErrorBox, Loading, Modal, useNotes, useToast } from "@/components/ui";

const RARITY: Record<string, string> = { common: "Gewöhnlich", rare: "Selten", epic: "Episch", legendary: "Legendär" };

export default function Collection() {
  const { id } = useGame();
  const toast = useToast();
  const showNotes = useNotes();
  const { data, error, reload } = useApi<any>(`careers/${id}/career`);
  const [pack, setPack] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const c = data.career;
  const cards = [...data.manager.cards].sort((a: any, b: any) => b.rating - a.rating);
  const has = (u: string) => c.unlocked.includes(u);

  async function buy(item: string) {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${id}/shop`, { body: { item } });
      if (item === "pack") {
        setPack(r.drawn);
        showNotes(r.notes?.filter((n: any) => n.kind === "achievement"));
      } else toast("Skin aktiviert – er gilt in der 2D-Ansicht.", "success");
      reload();
      refreshAll();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <MobileSubnav section="career" />
      <div className="page-head">
        <div><h1>Sammlung & Shop</h1><p>Belohnungen sind rein kosmetisch – sie verbessern nie deine Mannschaft.</p></div>
        <span className="badge badge-gold" style={{ fontSize: 14, padding: "4px 12px" }}>{c.points} MP</span>
      </div>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <div className="card stack">
          <div className="card-head"><h3>Kartenpaket</h3><b className="cond">{data.cardPack.price} MP</b></div>
          <p className="dim small">{data.cardPack.size} Spielerkarten aus der ganzen Welt. Offene Chancen pro Karte:</p>
          <div className="row-wrap">
            {Object.entries(data.cardPack.odds).map(([k, v]: [string, any]) => <span key={k} className="badge">{RARITY[k]}: {(v * 100).toLocaleString("de-CH", { maximumFractionDigits: 1 })} %</span>)}
          </div>
          <button className="btn btn-primary" disabled={!has("card_packs") || busy || c.points < data.cardPack.price} onClick={() => buy("pack")}>
            {has("card_packs") ? "Paket öffnen" : "Ab Level 2"}
          </button>
        </div>
        <div className="card stack">
          <div className="card-head"><h3>Stadion-Skins</h3></div>
          {!has("skins") && <span className="badge badge-blue">Ab Level 3</span>}
          <div className="grid grid-3" style={{ gap: 8 }}>
            {data.skins.map((s: any) => (
              <button key={s.id} disabled={!has("skins") || busy} onClick={() => buy(s.id)} className="card-soft stack-sm" style={{ cursor: "pointer", borderColor: s.active ? "var(--accent)" : undefined }}>
                <div style={{ height: 40, borderRadius: 6, background: `repeating-linear-gradient(90deg, ${s.grass[0]} 0 12px, ${s.grass[1]} 12px 24px)`, border: `2px solid ${s.lines}` }} />
                <b className="small">{s.name}</b>
                <span className="faint small">{s.active ? "aktiv" : s.owned ? "besessen" : `${s.price} MP`}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="card stack">
        <div className="card-head"><h3>Spielerkarten</h3><span className="faint">{cards.length}</span></div>
        {cards.length === 0 && <Empty>Karten bekommst du für Verpflichtungen, Wunderkinder aus der Jugend und aus Kartenpaketen.</Empty>}
        <div className="grid grid-4" style={{ gap: 10 }}>
          {cards.map((k: any) => (
            <div key={k.playerId} className={`pcard ${k.rarity}`}>
              <div className="between"><span className="big">{k.rating}</span><span className="badge">{POS_LABEL[k.position] ?? k.position}</span></div>
              <b>{k.name}</b>
              <span className="faint small">{RARITY[k.rarity]} · {k.reason} · {k.season}</span>
            </div>
          ))}
        </div>
      </div>
      <Modal open={!!pack} onClose={() => setPack(null)}>
        <div className="stack">
          <h2>Dein Kartenpaket</h2>
          <div className="grid grid-3" style={{ gap: 10 }}>
            {pack?.map((k, i) => (
              <div key={i} className={`pcard ${k.rarity}`} style={{ animation: `toast-in .4s ${i * 0.15}s both` }}>
                <span className="big">{k.rating}</span>
                <b>{k.name}</b>
                <span className="faint small">{RARITY[k.rarity]}</span>
              </div>
            ))}
          </div>
          {pack?.length === 0 && <p className="dim">Keine neuen Karten verfügbar.</p>}
          <button className="btn btn-primary" onClick={() => setPack(null)}>Super!</button>
        </div>
      </Modal>
    </>
  );
}
