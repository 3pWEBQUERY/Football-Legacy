"use client";
import { POS_LABEL } from "@/lib/client/format";

const SPOTS: Record<string, [number, number]> = {
  GK: [34, 92], DR: [58, 75], DC: [34, 78], DL: [10, 75], DM: [34, 62], MR: [58, 48], MC: [34, 48], ML: [10, 48],
  AMR: [58, 30], AMC: [34, 33], AML: [10, 30], ST: [34, 14],
};

/** Positionskarte: Stammposition kräftig, Nebenpositionen hell. */
export function PositionMap({ natural, alt }: { natural: string; alt: string[] }) {
  return (
    <svg viewBox="0 0 68 100" width="100%" style={{ maxWidth: 170, display: "block", margin: "0 auto" }} role="img" aria-label={`Positionen: ${POS_LABEL[natural]}`}>
      <rect x="0" y="0" width="68" height="100" fill="#1f5c2e" />
      <g fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.5">
        <rect x="2" y="2" width="64" height="96" />
        <line x1="2" y1="50" x2="66" y2="50" />
        <circle cx="34" cy="50" r="8" />
        <rect x="16" y="2" width="36" height="14" />
        <rect x="16" y="84" width="36" height="14" />
      </g>
      {Object.entries(SPOTS).map(([pos, [x, y]]) => {
        const isNat = pos === natural;
        const isAlt = alt.includes(pos);
        return (
          <g key={pos}>
            <rect x={x - 7} y={y - 4} width="14" height="8" rx="1"
              fill={isNat ? "#3fe07f" : isAlt ? "#9fdcb4" : "rgba(0,0,0,0.35)"}
              stroke={isNat || isAlt ? "none" : "rgba(255,255,255,0.25)"} strokeWidth="0.4" />
            <text x={x} y={y + 1.9} textAnchor="middle" fontSize="5" fontWeight="700" fill={isNat || isAlt ? "#0b2414" : "rgba(255,255,255,0.55)"} fontFamily="'Barlow Condensed', sans-serif">{POS_LABEL[pos]}</text>
          </g>
        );
      })}
    </svg>
  );
}
