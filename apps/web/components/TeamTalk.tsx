"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Icon, useToast } from "./ui";

/** Mannschaftsansprache in der Kabine vor dem Anpfiff. */
export function TeamTalk({ careerId }: { careerId: string }) {
  const toast = useToast();
  const [data, setData] = useState<any | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<any>(`careers/${careerId}/match/teamtalk`).then(setData).catch(() => {});
  }, [careerId]);

  if (!data?.available) return null;
  if (data.done && !result) {
    return <div className="card small dim row" style={{ gap: 8 }}><Icon name="check" size={14} /> Die Mannschaftsansprache hast du bereits gehalten.</div>;
  }

  async function give(tone: string) {
    setBusy(true);
    try {
      setResult(await api<any>(`careers/${careerId}/match/teamtalk`, { body: { tone } }));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card-flush">
      <div className="card-head"><h3><Icon name="users" size={15} /> Mannschaftsansprache</h3></div>
      {result ? (
        <div className="row-wrap" style={{ padding: 14, gap: 12 }}>
          <span className={`badge ${result.effect > 0 ? "badge-accent" : result.effect < 0 ? "badge-danger" : ""}`}>Moral {result.effect > 0 ? "+" : ""}{result.effect}</span>
          <span>{result.reaction}</span>
          <span className="faint small">Ausgangslage: {result.role}</span>
        </div>
      ) : (
        <div className="talk-grid">
          {data.tones.map((t: any) => (
            <button key={t.id} className="talk-option" disabled={busy} onClick={() => give(t.id)}>
              <b>{t.label}</b>
              <span className="dim small">{t.text}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
