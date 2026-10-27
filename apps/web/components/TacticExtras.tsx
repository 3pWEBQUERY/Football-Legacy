"use client";
import { Select } from "./Select";
import { Crest, Icon, Panel, Pos, Rating } from "./ui";

/** Gegneranweisungen: bis zu drei gegnerische Spieler gezielt bearbeiten. */
export const OPP_KINDS: { value: "tight" | "hard" | "weakfoot"; label: string; text: string }[] = [
  { value: "tight", label: "Eng decken", text: "Weniger Raum: der Spieler wirkt in allen Aktionen schwächer." },
  { value: "hard", label: "Hart angehen", text: "Er verliert mehr Zweikämpfe – aber es gibt mehr Fouls und Karten." },
  { value: "weakfoot", label: "Auf den schwachen Fuss", text: "Schwächt Abschluss, Dribbling, Flanken und Pässe." },
];

interface Props {
  t: any;
  update: (fn: (n: any) => void) => void;
  leaders: { id: number; name: string; position: string; value: number }[];
  opponent: { club: any; home: boolean; players: any[] } | null;
  byId: Map<number, any>;
}

export function TacticExtras({ t, update, leaders, opponent, byId }: Props) {
  const inXI = new Set<number>(t.lineup.filter((x: number | null) => x != null));
  const leaderOptions = (exclude?: number | null) => [
    { value: "auto", label: "Automatisch", description: "Der beste Anführer in der Startelf" },
    ...leaders.filter((l) => l.id !== exclude).map((l) => ({ value: String(l.id), label: l.name, description: `Führung ${l.value}${inXI.has(l.id) ? "" : " · nicht in der Startelf"}` })),
  ];
  const opp = t.opposition && opponent && t.opposition.clubId === opponent.club.id ? t.opposition.items : [];
  const setOpp = (items: any[]) => update((n) => { n.opposition = opponent ? { clubId: opponent.club.id, items } : null; });
  const captain = t.captain != null ? byId.get(t.captain) : null;
  return (
    <div className="grid grid-2 tactic-extras">
      <Panel title="Kapitän" icon="star">
        <p className="faint small" style={{ marginTop: 0 }}>Ein guter Anführer auf dem Platz verbessert alle Aktionen der Mannschaft leicht (bis etwa 1,5 %). Fällt der Kapitän aus, übernimmt der Stellvertreter.</p>
        <div className="grid grid-2" style={{ gap: 10 }}>
          <div className="field">
            <label>Kapitän</label>
            <Select label="Kapitän" value={t.captain != null ? String(t.captain) : "auto"} options={leaderOptions()}
              onChange={(v) => update((n) => { n.captain = v === "auto" ? null : Number(v); if (n.viceCaptain === n.captain) n.viceCaptain = null; })} />
          </div>
          <div className="field">
            <label>Stellvertreter</label>
            <Select label="Stellvertreter" value={t.viceCaptain != null ? String(t.viceCaptain) : "auto"} options={leaderOptions(t.captain)}
              onChange={(v) => update((n) => { n.viceCaptain = v === "auto" ? null : Number(v); })} />
          </div>
        </div>
        {captain && !inXI.has(captain.id) && <p className="small" style={{ color: "var(--warn)", marginBottom: 0 }}><Icon name="info" size={13} /> {captain.name} steht nicht in der Startelf – die Binde trägt dann der Stellvertreter.</p>}
      </Panel>
      <Panel title="Gegneranweisungen" icon="target" actions={opponent && <span className="row faint small" style={{ gap: 6 }}><Crest colors={opponent.club.colors} name={opponent.club.name} size={16} />{opponent.home ? "Heim" : "Auswärts"} gegen {opponent.club.short}</span>}>
        {!opponent ? <p className="faint small" style={{ margin: 0 }}>Kein nächster Gegner angesetzt.</p> : !opponent.players.length ? (
          <p className="faint small" style={{ margin: 0 }}>Zu {opponent.club.name} liegen noch keine Spielerinformationen vor.</p>
        ) : (
          <div className="stack-sm">
            <p className="faint small" style={{ margin: 0 }}>Gilt nur für das nächste Spiel gegen {opponent.club.name}. Bis zu drei Spieler.</p>
            {[0, 1, 2].map((i) => {
              const row = opp[i];
              const p = row ? opponent.players.find((x: any) => x.id === row.playerId) : null;
              return (
                <div key={i} className="opp-row">
                  <Select label={`Gegenspieler ${i + 1}`} value={row ? String(row.playerId) : "none"}
                    options={[{ value: "none", label: "– kein Spieler –" }, ...opponent.players
                      .filter((x: any) => x.id === row?.playerId || !opp.some((o: any) => o.playerId === x.id))
                      .map((x: any) => ({ value: String(x.id), label: x.name, description: `${x.position} · Stärke ${x.rating ?? `${x.ratingRange?.[0]}–${x.ratingRange?.[1]}`}` }))]}
                    onChange={(v) => {
                      const next = [...opp];
                      if (v === "none") next.splice(i, 1);
                      else next[i] = { playerId: Number(v), kind: row?.kind ?? "tight" };
                      setOpp(next.filter(Boolean));
                    }} />
                  {row && (
                    <Select label="Anweisung" value={row.kind} options={OPP_KINDS.map((k) => ({ value: k.value, label: k.label, description: k.text }))}
                      onChange={(v) => setOpp(opp.map((o: any, j: number) => (j === i ? { ...o, kind: v } : o)))} />
                  )}
                  {p && <span className="row small faint" style={{ gap: 6 }}><Pos p={p.position} /><Rating value={p.rating} range={p.ratingRange} /></span>}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
