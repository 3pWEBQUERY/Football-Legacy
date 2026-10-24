/** Kennzeichen einer Nationalmannschaft: Farbbalken mit Länderkürzel. */
export function NationBadge({ code, colors, size = 28 }: { code: string; colors: { primary: string; secondary: string }; size?: number }) {
  const w = Math.round(size * 1.45);
  return (
    <svg className="nation-badge" width={w} height={size} viewBox="0 0 58 40" role="img" aria-label={`Nationalmannschaft ${code}`}>
      <rect x="1" y="1" width="56" height="38" rx="3" fill={colors.primary} stroke="rgba(127,127,127,0.45)" strokeWidth="1.5" />
      <rect x="1" y="27" width="56" height="12" fill={colors.secondary} />
      <text x="29" y="22" textAnchor="middle" fontSize="15" fontWeight="700" fontFamily="'Barlow Condensed', system-ui, sans-serif" letterSpacing="1"
        fill={isLight(colors.primary) ? "#111827" : "#ffffff"}>{code}</text>
    </svg>
  );
}

function isLight(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 170;
}
