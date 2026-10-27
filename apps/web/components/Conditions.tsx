"use client";

export interface ConditionsView {
  weather: string; weatherLabel: string; weatherIcon: string; weatherText: string; temperature: number;
  referee: string; strictness: number; refereeStyle: "streng" | "normal" | "grosszügig";
}

/** Wetter und Schiedsrichter einer Partie in einer Zeile. */
export function ConditionsBar({ c, compact }: { c: ConditionsView | null | undefined; compact?: boolean }) {
  if (!c) return null;
  return (
    <div className={`conditions ${compact ? "compact" : ""}`}>
      <span title={c.weatherText}><span aria-hidden="true">{c.weatherIcon}</span> {c.weatherLabel} · {c.temperature} °C</span>
      <span title={c.refereeStyle === "streng" ? "Zeigt schnell Karten" : c.refereeStyle === "grosszügig" ? "Lässt viel laufen" : "Durchschnittliche Linie"}>
        <span aria-hidden="true">🟨</span> {c.referee}{c.refereeStyle !== "normal" && <span className={`ref-${c.refereeStyle === "streng" ? "strict" : "lenient"}`}> · {c.refereeStyle}</span>}
      </span>
      {!compact && c.weather !== "sunny" && c.weather !== "cloudy" && <span className="faint">{c.weatherText}</span>}
    </div>
  );
}
