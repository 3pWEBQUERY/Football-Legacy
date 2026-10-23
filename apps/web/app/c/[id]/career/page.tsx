"use client";
import { useApi } from "@/lib/client/api";
import { seasonLabel } from "@/lib/client/format";
import { MobileSubnav, useGame } from "@/components/GameShell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ErrorBox, Loading, Progress, Stat } from "@/components/ui";

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
            <div className="brand-mark" style={{ width: 52, height: 52, fontSize: 20, borderRadius: 14 }}>{c.level}</div>
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
          <div className="between"><h3>Erfolge</h3><span className="faint">{unlocked}/{data.achievements.length}</span></div>
          <div className="grid grid-2" style={{ gap: 8 }}>
            {data.achievements.map((a: any) => (
              <div key={a.id} className="card-soft row" style={{ opacity: a.unlockedAt ? 1 : 0.5 }}>
                <span style={{ fontSize: 24, filter: a.unlockedAt ? "none" : "grayscale(1)" }}>{a.icon}</span>
                <div style={{ flex: 1 }}>
                  <b>{a.name}</b>
                  <div className="faint small">{a.description}</div>
                </div>
                {a.unlockedAt ? <span className="badge badge-accent">✓</span> : <span className="faint small nowrap">+{a.xp} XP</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="stack">
          <div className="card stack-sm">
            <h3>Freischaltungen</h3>
            {data.unlocks.map((u: any) => (
              <div key={u.id} className="row" style={{ opacity: u.unlocked ? 1 : 0.55 }}>
                <span>{u.unlocked ? "🔓" : "🔒"}</span>
                <div style={{ flex: 1 }}><b>{u.name}</b> <span className="faint small">· Level {u.level}</span><div className="faint small">{u.description}</div></div>
              </div>
            ))}
          </div>
          <div className="card stack-sm">
            <h3>Karriereverlauf</h3>
            {data.history.length === 0 && <p className="faint small">Noch keine abgeschlossene Saison.</p>}
            {[...data.history].reverse().map((h: any) => (
              <div key={h.season} className="between small">
                <span>{seasonLabel(h.season)} · {h.clubName} <span className="faint">({h.leagueName})</span></span>
                <span>{h.champion ? "🏆 " : h.promoted ? "📈 " : h.relegated ? "📉 " : ""}<b>Platz {h.position}</b> · {h.points} P</span>
              </div>
            ))}
          </div>
          {data.jobOffers?.length > 0 && (
            <div className="card stack-sm">
              <h3>Jobangebote</h3>
              <p className="faint small">Wechsel sind in der Saisonvorbereitung (Woche 0) im Büro möglich.</p>
              {data.jobOffers.map((o: any) => <div key={o.clubId} className="small">• {o.clubName} <span className="faint">({o.leagueName})</span></div>)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
