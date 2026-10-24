"use client";

/** Land- und Ligaauswahl für Tabellen und Statistiken. */
export function LeaguePicker({ countries, league, onChange }: { countries: any[]; league: any; onChange: (leagueId: number) => void }) {
  const country = countries.find((c) => c.code === league.countryCode);
  return (
    <div className="row-wrap">
      <select className="select" value={league.countryCode} aria-label="Land" onChange={(e) => {
        const c = countries.find((x) => x.code === e.target.value);
        if (c?.leagues[0]) onChange(c.leagues[0].id);
      }}>
        {[...countries].sort((a, b) => a.name.localeCompare(b.name, "de")).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
      <select className="select" value={league.id} aria-label="Liga" onChange={(e) => onChange(Number(e.target.value))}>
        {country?.leagues.map((l: any) => <option key={l.id} value={l.id}>{l.tier}. {l.name}</option>)}
      </select>
    </div>
  );
}
