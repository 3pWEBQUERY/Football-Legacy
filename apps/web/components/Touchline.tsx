"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Icon, useToast } from "./ui";

const SHOUTS: { id: string; label: string; hint: string }[] = [
  { id: "encourage", label: "Ermutigen", hint: "Hilft vor allem bei Rückstand oder Gleichstand." },
  { id: "demand", label: "Mehr fordern", hint: "Wirkt, wenn ein Favorit nicht führt – Aussenseiter verunsichert es." },
  { id: "focus", label: "Konzentrieren", hint: "In engen Spielen und in der Schlussphase wichtig." },
  { id: "calm", label: "Ruhe bewahren", hint: "Sichert eine Führung ab – bei Rückstand wirkt es passiv." },
  { id: "praise", label: "Loben", hint: "Bestärkt eine Mannschaft, die führt." },
  { id: "attack", label: "Alles nach vorne!", hint: "Letzte Viertelstunde bei Rückstand – sonst riskant." },
];
const SHOUT_LABEL = Object.fromEntries(SHOUTS.map((s) => [s.id, s.label]));

const HALFTIME: { id: string; label: string; text: string }[] = [
  { id: "praise", label: "Loben", text: "„Starke erste Hälfte – genau so weiter!“" },
  { id: "encourage", label: "Aufmuntern", text: "„Kopf hoch, wir sind noch voll drin!“" },
  { id: "calm", label: "Ruhig bleiben", text: "„Bleibt geduldig und konzentriert.“" },
  { id: "demand", label: "Mehr verlangen", text: "„Das reicht nicht. Ich will mehr sehen!“" },
  { id: "disappointed", label: "Enttäuscht", text: "„Das war nichts. Ich bin enttäuscht von euch.“" },
];

const tone = (v: number) => (v >= 0.025 ? "pos" : v >= 0.012 ? "ok" : v > 0 ? "flat" : "neg");

/**
 * Zurufe von der Seitenlinie: wirken etwa 15 Spielminuten. Nach einem Zuruf
 * brauchen die Spieler fünf Minuten, bevor der nächste ankommt.
 */
export function ShoutBar({ careerId, team, serverTick, onResult }: {
  careerId: string;
  team: { shout: { kind: string; until: number; boost: number } | null; shoutReady: number };
  serverTick: number;
  onResult: (r: any) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const cooling = (team.shoutReady ?? 0) > serverTick;
  const active = team.shout && team.shout.until > serverTick ? team.shout : null;

  async function send(kind: string) {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${careerId}/match/shout`, { body: { kind } });
      toast(r.text, r.boost > 0.01 ? "success" : "info");
      onResult(r);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card shout-bar">
      <span className="shout-title"><Icon name="whistle" size={14} /> Zuruf</span>
      <div className="shout-buttons" role="group" aria-label="Zurufe an die Mannschaft">
        {SHOUTS.map((s) => (
          <button key={s.id} className={`btn btn-sm ${active?.kind === s.id ? "active" : ""}`} disabled={busy || cooling} title={s.hint} onClick={() => send(s.id)}>{s.label}</button>
        ))}
      </div>
      {active ? (
        <span className={`shout-state t-${tone(active.boost)}`}>„{SHOUT_LABEL[active.kind]}“ wirkt bis Min. {Math.floor(active.until / 6)}</span>
      ) : cooling ? <span className="shout-state faint">Nächster Zuruf ab Min. {Math.floor((team.shoutReady ?? 0) / 6) + 1}</span> : null}
    </div>
  );
}

/** Halbzeitansprache in der Kabine – bestimmt die Einstellung für die zweite Halbzeit. */
export function HalftimeTalk({ careerId, spirit, onResult }: { careerId: string; spirit: number | null; onResult: (r: any) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [reaction, setReaction] = useState<{ text: string; spirit: number } | null>(null);

  async function send(id: string) {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${careerId}/match/halftime`, { body: { tone: id } });
      setReaction({ text: r.text, spirit: r.spirit });
      onResult(r);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const done = reaction ?? (spirit !== null ? { text: "Die Halbzeitansprache ist gehalten.", spirit } : null);
  return (
    <div className="talk-box">
      <div className="talk-box-head"><Icon name="users" size={15} /> <b>Halbzeitansprache</b><span className="faint small">Wirkt auf die ganze zweite Halbzeit.</span></div>
      {done ? (
        <div className={`talk-reaction t-${tone(done.spirit)}`}>{done.text}</div>
      ) : (
        <div className="talk-tones">
          {HALFTIME.map((t) => (
            <button key={t.id} className="talk-tone" disabled={busy} onClick={() => send(t.id)}>
              <b>{t.label}</b><small>{t.text}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const RESULT_TEXT: Record<string, string> = { W: "Sieg", D: "Unentschieden", L: "Niederlage" };
const ROLE_TEXT: Record<string, string> = { fav: "als Favorit", even: "im ausgeglichenen Duell", dog: "als Aussenseiter" };

/** Schlussansprache nach dem Abpfiff: wirkt auf die Moral der eingesetzten Spieler. */
export function PostMatchTalk({ careerId }: { careerId: string }) {
  const toast = useToast();
  const [talk, setTalk] = useState<any | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [reaction, setReaction] = useState<{ text: string; effect: number } | null>(null);
  useEffect(() => {
    api<any>(`careers/${careerId}/match/post-talk`).then((r) => setTalk(r.talk)).catch(() => setTalk(null));
  }, [careerId]);

  async function send(id: string) {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${careerId}/match/post-talk`, { body: { tone: id } });
      setReaction({ text: `${r.reaction} (${r.players} Spieler)`, effect: r.effect });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!talk && !reaction) return null;
  return (
    <div className="talk-box">
      <div className="talk-box-head"><Icon name="users" size={15} /> <b>Schlussansprache</b>{talk && <span className="faint small">{RESULT_TEXT[talk.result]} {ROLE_TEXT[talk.role]} – wie reagierst du?</span>}</div>
      {reaction ? (
        <div className={`talk-reaction t-${reaction.effect >= 3 ? "pos" : reaction.effect >= 1 ? "ok" : reaction.effect === 0 ? "flat" : "neg"}`}>{reaction.text}</div>
      ) : (
        <div className="talk-tones">
          {talk.tones.map((t: any) => (
            <button key={t.id} className="talk-tone" disabled={busy} onClick={() => send(t.id)}>
              <b>{t.label}</b><small>{t.text}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
