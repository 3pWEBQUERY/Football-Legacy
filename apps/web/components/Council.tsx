"use client";
/** Mannschaftsrat: Mitglieder, Stimmung, offenes Anliegen mit Antworten und die letzten Sitzungen. */
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Panel, Progress, moraleLabel, useToast } from "@/components/ui";
import { PlayerFace } from "@/components/PlayerFace";

export function CouncilPanel({ careerId, council, kit, onChanged }: { careerId: string; council: any; kit: any; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!council) return null;
  async function answer(choice: string) {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${careerId}/council`, { body: { choice } });
      toast(r.message, "success");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  const p = council.pending;
  return (
    <Panel title="Mannschaftsrat" icon="users" actions={<span className="faint small">Stimmung im Rat: <b style={{ color: moraleLabel(council.mood).color }}>{moraleLabel(council.mood).text}</b></span>}>
      <div className="council">
        <div className="council-members">
          {council.members.map((m: any) => (
            <Link key={m.id} href={`/c/${careerId}/player/${m.id}`} className="council-member">
              <PlayerFace player={m} kit={kit} size={44} />
              <span className="small name truncate">{m.name}</span>
              <span className="faint small">{m.captain ? "Kapitän" : m.position}</span>
              <Progress value={m.morale} tone={m.morale < 35 ? "danger" : m.morale < 50 ? "warn" : undefined} />
            </Link>
          ))}
        </div>
        {p ? (
          <div className="council-concern">
            <div className="between"><b>{p.title}</b><span className="badge badge-warn">noch {p.daysLeft} Tage</span></div>
            <p className="dim small">{p.text}</p>
            <div className="council-options">
              {p.options.map((o: any) => (
                <button key={o.key} className="btn" disabled={busy} onClick={() => answer(o.key)} title={o.text}>
                  <span>{o.label}</span><span className="faint small">{o.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : <p className="faint small">Kein offenes Anliegen. Der Rat trifft sich einmal im Monat mit dir.</p>}
        {council.history.length > 0 && (
          <div className="council-history">
            <div className="faint small up">Letzte Sitzungen</div>
            {council.history.map((h: any, i: number) => (
              <div key={i} className="small"><b>{h.title}</b> · {h.choice} <span className="faint">– {h.outcome}</span></div>
            ))}
          </div>
        )}
        <p className="faint small">Die Stimmung des Rats färbt auf die Kabine ab: ein zufriedener Rat hebt die Moral, ein verärgerter zieht sie nach unten.</p>
      </div>
    </Panel>
  );
}
