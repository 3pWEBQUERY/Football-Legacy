"use client";
import { money, seasonLabel } from "@/lib/client/format";
import { Panel } from "./ui";

/** Hauptsponsor: laufender Vertrag oder die drei Angebote zur Wahl. */
export function SponsorPanel({ sponsor, busy, choose }: { sponsor: any; busy: boolean; choose: (kind: string) => void }) {
  if (!sponsor) return null;
  const d = sponsor.deal;
  return (
    <Panel title="Hauptsponsor" icon="euro">
      {d ? (
        <div className="stack-sm">
          <div className="between"><b style={{ fontSize: 16 }}>{d.partner}</b><span className="badge badge-accent">{sponsor.labels[d.kind].title}</span></div>
          <div className="kv"><span className="k">Pro Woche</span><span className="v">{money(d.weekly)}</span></div>
          {d.winBonus > 0 && <div className="kv"><span className="k">Prämie je Sieg</span><span className="v">{money(d.winBonus)}</span></div>}
          {d.titleBonus > 0 && <div className="kv"><span className="k">Titelprämie</span><span className="v">{money(d.titleBonus)}</span></div>}
          {d.earnedBonus > 0 && <div className="kv"><span className="k">Bisher an Prämien</span><span className="v pos-text">{money(d.earnedBonus)}</span></div>}
          <div className="kv"><span className="k">Laufzeit</span><span className="v">bis Saison {seasonLabel(d.untilSeason)}</span></div>
        </div>
      ) : sponsor.offers.length ? (
        <div className="stack-sm">
          <p className="faint small" style={{ margin: 0 }}>Wähle einen Partner. Ohne Entscheidung unterschreibt der Vorstand nach drei Wochen den Festvertrag.</p>
          <div className="sponsor-offers">
            {sponsor.offers.map((o: any) => (
              <div key={o.kind} className="sponsor-offer">
                <span className="faint up small">{sponsor.labels[o.kind].title}</span>
                <b>{o.partner}</b>
                <span className="cond sponsor-amount">{money(o.weekly)}<small> / Woche</small></span>
                <span className="small dim">{sponsor.labels[o.kind].text}</span>
                <ul className="small">
                  {o.winBonus > 0 && <li>+ {money(o.winBonus)} je Sieg</li>}
                  {o.titleBonus > 0 && <li>+ {money(o.titleBonus)} bei Meisterschaft oder Pokalsieg</li>}
                  <li>{o.years > 1 ? `${o.years} Saisons fest` : "1 Saison"}</li>
                </ul>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => choose(o.kind)}>Unterschreiben</button>
              </div>
            ))}
          </div>
        </div>
      ) : <p className="faint small" style={{ margin: 0 }}>Neue Angebote kommen zum nächsten Saisonstart.</p>}
    </Panel>
  );
}
