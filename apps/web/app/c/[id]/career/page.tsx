"use client";
import { useApi } from "@/lib/client/api";
import { seasonLabel } from "@/lib/client/format";
import { MobileSubnav, useGame } from "@/components/GameShell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ErrorBox, Icon, Loading, Progress, Stat } from "@/components/ui";

export default function CareerPage() {
  const { id } = useGame();
  const { data, error } = useApi<any>(`careers/${id}/career`);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const c = data.career;
  const m = data.manager;
  const t = m.totals;
  const games = t.wins + t.draws + t.losses;
  const unlocked = data.achievements.filter((a: any) => a.unlockedAt).length;
  return (
    <>
      <MobileSubnav section="career" />
      <div className="page-head">
        <div><h1>{c.managerName}</h1><p>{c.title} · Ruf {c.reputation}/100</p></div>
        <ThemeToggle />
      </div>
      <div className="card stack">
        <div className="between">
          <div className="row" style={{ gap: 14 }}>
            <div className="cond" style={{ width: 56, height: 56, fontSize: 30, fontWeight: 700, display: "grid", placeItems: "center", border: "2px solid var(--accent)", color: "var(--accent)", borderRadius: 2 }}>{c.level}</div>
            <div><h2>Level {c.level} – {c.title}</h2><span className="dim">{c.xp} XP gesamt · noch {c.xpNextLevel - c.xp} XP bis Level {c.level + 1}</span></div>
          </div>
          <span className="badge badge-gold" style={{ fontSize: 14, padding: "4px 12px" }}>{c.points} Manager-Punkte</span>
        </div>
        <Progress value={c.xp - c.xpLevelStart} max={c.xpNextLevel - c.xpLevelStart} />
        <div className="row-wrap">
          {data.levelTitles.map((lt: any) => (
            <span key={lt.level} className={`badge ${c.level >= lt.level ? "badge-accent" : ""}`}>Lv {lt.level}: {lt.title}</span>
          ))}
        </div>
      </div>
      <div className="grid grid-4">
        <div className="card"><Stat label="Spiele" value={games} sub={`${t.wins} S · ${t.draws} U · ${t.losses} N`} /></div>
        <div className="card"><Stat label="Siegquote" value={games ? `${Math.round((t.wins / games) * 100)}%` : "–"} sub={`Beste Serie: ${m.bestWinStreak} Siege`} /></div>
        <div className="card"><Stat label="Tore" value={`${t.goals}:${t.conceded}`} sub={`${t.seasons} Saisons`} /></div>
        <div className="card"><Stat label="Titel" value={t.titles} sub={`${t.promotions} Aufstiege · ${t.signings} Transfers`} /></div>
      </div>
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="card stack">
          <div className="card-head"><h3>Erfolge</h3><span className="faint">{unlocked}/{data.achievements.length}</span></div>
          <div className="grid grid-2" style={{ gap: 8 }}>
            {data.achievements.map((a: any) => (
              <div key={a.id} className="card-soft row" style={{ borderStyle: a.unlockedAt ? undefined : "dashed" }}>
                <span style={{ width: 30, height: 30, borderRadius: 2, display: "grid", placeItems: "center", background: a.unlockedAt ? "var(--gold-soft)" : "var(--panel-h)", color: a.unlockedAt ? "var(--gold)" : "var(--text-3)", flex: "none" }}><Icon name="trophy" size={16} /></span>
                <div style={{ flex: 1 }}>
                  <b className={a.unlockedAt ? undefined : "dim"}>{a.name}</b>
                  <div className="faint small">{a.description}</div>
                </div>
                {a.unlockedAt ? <span className="badge badge-accent">Erreicht</span> : <span className="faint small nowrap">+{a.xp} XP</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="stack">
          <div className="card stack-sm">
            <div className="card-head"><h3>Freischaltungen</h3></div>
            {data.unlocks.map((u: any) => (
              <div key={u.id} className="row">
                <span style={{ color: u.unlocked ? "var(--pos)" : "var(--text-3)", display: "inline-flex" }}><Icon name={u.unlocked ? "unlock" : "lock"} size={16} /></span>
                <div style={{ flex: 1 }}><b className={u.unlocked ? undefined : "dim"}>{u.name}</b> <span className="faint small">· Level {u.level}</span><div className="faint small">{u.description}</div></div>
              </div>
            ))}
          </div>
          <div className="card stack-sm">
            <div className="card-head"><h3>Karriereverlauf</h3></div>
            {data.history.length === 0 && <p className="faint small">Noch keine abgeschlossene Saison.</p>}
            {[...data.history].reverse().map((h: any) => (
              <div key={h.season} className="between small">
                <span>{seasonLabel(h.season)} · {h.clubName} <span className="faint">({h.leagueName})</span></span>
                <span>{h.champion ? <span className="badge badge-gold">Meister</span> : h.promoted ? <span className="badge badge-accent">Aufstieg</span> : h.relegated ? <span className="badge badge-danger">Abstieg</span> : null} <b>Platz {h.position}</b> · {h.points} P{h.cup ? ` · Pokal: ${h.cup}` : ""}</span>
              </div>
            ))}
          </div>
          {data.jobOffers?.length > 0 && (
            <div className="card stack-sm">
              <div className="card-head"><h3>Jobangebote</h3></div>
              <p className="faint small">Wechsel sind in der Saisonvorbereitung im Büro möglich.</p>
              {data.jobOffers.map((o: any) => <div key={o.clubId} className="small">• {o.clubName} <span className="faint">({o.leagueName})</span></div>)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
