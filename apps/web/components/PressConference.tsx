"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Icon, useNotes, useToast } from "./ui";

/** Pressekonferenz vor dem Spiel. */
export function PressConference({ careerId }: { careerId: string }) {
  const toast = useToast();
  const showNotes = useNotes();
  const [data, setData] = useState<any | null>(null);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api<any>(`careers/${careerId}/match/press`).then(setData).catch(() => {});
  }, [careerId]);

  if (!data?.available) return null;
  if (data.done && !result) {
    return <div className="card small dim row" style={{ gap: 8 }}><Icon name="check" size={14} /> Die Pressekonferenz vor diesem Spiel hast du bereits gegeben.</div>;
  }

  async function submit() {
    setBusy(true);
    try {
      const r = await api<any>(`careers/${careerId}/match/press`, { body: { answers } });
      setResult(r);
      showNotes(r.notes?.filter((n: any) => n.kind !== "xp"));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  const answered = data.questions.every((q: any) => typeof answers[q.id] === "number" || (typeof answers[q.id] === "string" && (answers[q.id] as string).trim().length >= 3));

  return (
    <section className="card card-flush">
      <div className="card-head">
        <h3><Icon name="news" size={15} /> Pressekonferenz</h3>
        {!open && !result && <button className="btn btn-sm" onClick={() => setOpen(true)}>Zur Pressekonferenz</button>}
      </div>
      {!open && !result && <p className="dim small" style={{ padding: "10px 14px" }}>Die Journalisten warten. Deine Antworten wirken auf die Moral der Mannschaft und das Vertrauen des Vorstands.</p>}
      {open && !result && (
        <div className="stack" style={{ padding: 14 }}>
          {data.questions.map((q: any) => (
            <div key={q.id} className="stack-sm">
              <b>{q.text}</b>
              {q.answers.map((a: any) => (
                <label key={a.i} className="card-soft row" style={{ cursor: "pointer", gap: 10, borderColor: answers[q.id] === a.i ? "var(--accent)" : undefined }}>
                  <input type="radio" name={q.id} checked={answers[q.id] === a.i} onChange={() => setAnswers({ ...answers, [q.id]: a.i })} />
                  <span style={{ flex: 1 }}>„{a.text}“</span>
                  <span className="badge">{a.tone}</span>
                </label>
              ))}
              {data.ai && (
                <div className="card-soft stack-sm" style={{ borderColor: typeof answers[q.id] === "string" ? "var(--accent)" : undefined }}>
                  <label className="row" style={{ cursor: "pointer", gap: 10 }}>
                    <input type="radio" name={q.id} checked={typeof answers[q.id] === "string"} onChange={() => setAnswers({ ...answers, [q.id]: "" })} />
                    <span style={{ flex: 1 }}>Eigene Antwort formulieren</span>
                    <span className="badge badge-blue">KI</span>
                  </label>
                  {typeof answers[q.id] === "string" && (
                    <textarea className="input" rows={2} maxLength={data.maxFree} placeholder="Was sagst du den Journalisten?" value={answers[q.id] as string}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} aria-label={`Eigene Antwort: ${q.text}`} />
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Später</button>
            <button className="btn btn-primary" disabled={!answered || busy} onClick={submit}>{busy ? "Journalisten notieren …" : "Antworten geben"}</button>
          </div>
        </div>
      )}
      {result && (
        <div className="stack-sm" style={{ padding: 14 }}>
          {result.free?.map((x: any) => (
            <div key={x.question} className="card-soft stack-sm">
              <span className="faint small">{x.question}</span>
              <span>„{x.text}“ <span className="badge">{x.tone}</span></span>
              <span className="dim small">{x.reaction}</span>
            </div>
          ))}
          <span className="faint small up">Wirkung</span>
          <div className="row-wrap">
            {result.effects.length ? result.effects.map((e: string) => <span key={e} className={`badge ${e.includes("-") ? "badge-danger" : "badge-accent"}`}>{e}</span>) : <span className="dim small">Keine spürbare Wirkung.</span>}
          </div>
        </div>
      )}
    </section>
  );
}
