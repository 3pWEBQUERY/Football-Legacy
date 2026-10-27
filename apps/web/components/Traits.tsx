"use client";

export interface TraitView { key: string; label: string; text: string; tone: "pos" | "neg" | "neutral" }

/** Charakterzüge als Abzeichen; null = noch nicht bekannt (Scoutbericht nötig). */
export function Traits({ traits, compact }: { traits: TraitView[] | null | undefined; compact?: boolean }) {
  if (traits === null || traits === undefined) return <span className="faint small">Charakter unbekannt{compact ? "" : " – ein Scoutbericht verrät mehr"}</span>;
  if (!traits.length) return <span className="faint small">Keine besonderen Charakterzüge</span>;
  return (
    <span className="trait-list">
      {traits.map((t) => (
        <span key={t.key} className={`trait trait-${t.tone}`} title={t.text} tabIndex={0}>
          {t.label}
          {!compact && <span className="trait-tip" role="tooltip">{t.text}</span>}
        </span>
      ))}
    </span>
  );
}
