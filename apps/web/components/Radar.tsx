"use client";

const CATS: { label: string; keys: string[] }[] = [
  { label: "Angriff", keys: ["finishing", "offTheBall", "composure"] },
  { label: "Technik", keys: ["technique", "firstTouch", "dribbling"] },
  { label: "Passspiel", keys: ["passing", "vision", "crossing"] },
  { label: "Abwehr", keys: ["tackling", "marking", "positioning"] },
  { label: "Physis", keys: ["pace", "strength", "stamina"] },
  { label: "Mental", keys: ["decisions", "anticipation", "workRate"] },
];
const GK_CATS: { label: string; keys: string[] }[] = [
  { label: "Torwartspiel", keys: ["goalkeeping"] },
  { label: "Reflexe", keys: ["agility", "anticipation"] },
  { label: "Stellungsspiel", keys: ["positioning", "decisions"] },
  { label: "Spieleröffnung", keys: ["passing", "firstTouch"] },
  { label: "Lufthoheit", keys: ["jumping", "strength"] },
  { label: "Nervenstärke", keys: ["composure", "workRate"] },
];

/** Sechseck-Diagramm der Stärken (bei geschätzten Werten die Mitte der Spanne). */
export function Radar({ value, gk, size = 220 }: { value: (key: string) => number; gk?: boolean; size?: number }) {
  const cats = gk ? GK_CATS : CATS;
  const c = size / 2;
  const r = size / 2 - 34;
  const pt = (i: number, f: number) => {
    const a = -Math.PI / 2 + (i / cats.length) * Math.PI * 2;
    return [c + Math.cos(a) * r * f, c + Math.sin(a) * r * f];
  };
  const vals = cats.map((cat) => cat.keys.reduce((s, k) => s + value(k), 0) / cat.keys.length / 20);
  const poly = vals.map((v, i) => pt(i, Math.max(0.05, v)).join(",")).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: size }} role="img" aria-label="Stärkenprofil">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={cats.map((_, i) => pt(i, f).join(",")).join(" ")} fill="none" stroke="var(--border-strong)" strokeWidth="1" />
      ))}
      {cats.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--border)" />;
      })}
      <polygon points={poly} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      {cats.map((cat, i) => {
        const [x, y] = pt(i, 1.2);
        return (
          <text key={cat.label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="10.5" fill="var(--text-dim)" fontWeight="600">
            {cat.label} {Math.round(vals[i] * 20)}
          </text>
        );
      })}
    </svg>
  );
}
