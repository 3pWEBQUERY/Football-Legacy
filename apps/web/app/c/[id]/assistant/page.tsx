"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, useApi } from "@/lib/client/api";
import { useGame } from "@/components/GameShell";
import { ErrorBox, Icon, Loading, useToast } from "@/components/ui";
import { PlayerFace } from "@/components/PlayerFace";

const SUGGESTIONS = [
  "Wie sollen wir gegen den nächsten Gegner spielen?",
  "Wer ist im Moment in Form, wer schwächelt?",
  "Welche Position sollten wir im nächsten Transferfenster verstärken?",
  "Wie steht es um unsere Finanzen?",
];

export default function AssistantPage() {
  const { id } = useGame();
  const toast = useToast();
  const { data, error, reload } = useApi<any>(`careers/${id}/assistant`);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (data) setMessages(data.messages); }, [data]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const st = data.status;
  const coach = data.coach;
  const face = coach.face ? { ...coach.face, position: "MC" } : null;

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: question, at: new Date().toISOString() }]);
    setText("");
    try {
      const r = await api<any>(`careers/${id}/assistant`, { body: { message: question } });
      setMessages(r.messages);
    } catch (e) {
      toast((e as Error).message, "error");
      setMessages((m) => m.slice(0, -1));
      setText(question);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    await api(`careers/${id}/assistant/clear`, { body: {} });
    reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Co-Trainer</h1>
          <p>Frag {coach.name} um Rat – die Antworten stützen sich auf die aktuellen Daten deiner Karriere.</p>
        </div>
        {messages.length > 0 && <button className="btn btn-ghost btn-sm" onClick={clear}>Gespräch löschen</button>}
      </div>
      {!st.configured ? (
        <div className="card dim">Die KI-Funktionen sind auf diesem Server noch nicht eingerichtet.</div>
      ) : !st.enabled ? (
        <div className="card stack-sm">
          <b>KI-Funktionen sind ausgeschaltet</b>
          <span className="dim small">Der Co-Trainer-Chat nutzt Claude (Anthropic). Du kannst die KI-Funktionen in den Einstellungen einschalten; dort steht auch, welche Daten dafür übermittelt werden.</span>
          <div><Link className="btn btn-primary btn-sm" href={`/c/${id}/career/settings`}>Zu den Einstellungen</Link></div>
        </div>
      ) : (
        <section className="card card-flush aic">
          <div className="aic-log">
            {messages.length === 0 && (
              <div className="aic-empty">
                <span className="dim">Worüber möchtest du sprechen?</span>
                <div className="row-wrap" style={{ gap: 8, justifyContent: "center" }}>
                  {SUGGESTIONS.map((s) => <button key={s} className="btn btn-sm" onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`aic-msg ${m.role === "user" ? "me" : "coach"}`}>
                {m.role === "assistant" && (face ? <PlayerFace player={face} size={34} /> : <span className="aic-avatar"><Icon name="team" size={16} /></span>)}
                <div className="aic-bubble" translate={m.role === "user" ? "no" : undefined}>{m.content}</div>
              </div>
            ))}
            {busy && <div className="aic-msg coach"><span className="aic-avatar"><Icon name="team" size={16} /></span><div className="aic-bubble dim">{coach.name} überlegt …</div></div>}
            <div ref={end} />
          </div>
          <form className="aic-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <textarea className="input" rows={2} maxLength={500} value={text} placeholder="Deine Frage an den Co-Trainer …" aria-label="Frage an den Co-Trainer"
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
            <button className="btn btn-primary" disabled={busy || !text.trim()}>Senden</button>
          </form>
          <div className="faint small aic-foot">KI-Antworten (Claude Sonnet 5.5) können Fehler enthalten. {st.used}/{st.limit} KI-Anfragen heute.</div>
        </section>
      )}
    </>
  );
}
