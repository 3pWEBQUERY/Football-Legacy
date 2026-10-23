"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { money, seasonLabel } from "@/lib/client/format";
import { Crest, Icon, Modal, Progress, useNotes, useToast } from "./ui";
import { ThemeToggle } from "./ThemeToggle";
import { WeekSummaryView } from "./WeekSummary";

interface ShellCtx {
  id: string;
  shell: any | null;
  advance: () => Promise<void>;
  busy: boolean;
  reloadShell: () => void;
}

const Ctx = createContext<ShellCtx>({ id: "", shell: null, advance: async () => {}, busy: false, reloadShell: () => {} });
export const useGame = () => useContext(Ctx);

const NAV = [
  { key: "office", label: "Büro", icon: "office", href: "", subs: [] as { href: string; label: string }[] },
  { key: "team", label: "Team", icon: "team", href: "/team", subs: [{ href: "/team", label: "Kader" }, { href: "/team/tactic", label: "Aufstellung & Taktik" }, { href: "/team/training", label: "Training" }] },
  { key: "market", label: "Markt", icon: "market", href: "/market", subs: [{ href: "/market", label: "Transfermarkt" }, { href: "/market/contracts", label: "Verträge" }, { href: "/market/finances", label: "Finanzen" }] },
  { key: "competition", label: "Wettbewerb", icon: "competition", href: "/competition", subs: [{ href: "/competition", label: "Tabelle & Spielplan" }, { href: "/competition/stats", label: "Statistiken" }] },
  { key: "career", label: "Karriere", icon: "career", href: "/career", subs: [{ href: "/career", label: "Profil & Erfolge" }, { href: "/career/collection", label: "Sammlung & Shop" }, { href: "/career/leaderboards", label: "Ranglisten" }] },
];

function activeSection(path: string, base: string) {
  const rest = path.slice(base.length);
  if (rest.startsWith("/team") || rest.startsWith("/player")) return "team";
  if (rest.startsWith("/market")) return "market";
  if (rest.startsWith("/competition") || rest.startsWith("/club") || rest.startsWith("/report")) return "competition";
  if (rest.startsWith("/career")) return "career";
  return "office";
}

export function GameShell({ id, children }: { id: string; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const toast = useToast();
  const showNotes = useNotes();
  const shell = useApi<any>(`careers/${id}/dashboard`);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<any | null>(null);
  const base = `/c/${id}`;
  const section = activeSection(path, base);
  const fullscreen = path.endsWith("/match");

  useEffect(() => {
    api(`careers/${id}/checkin`, { body: {} }).then((r: any) => showNotes(r.notes)).catch(() => {});
  }, [id, showNotes]);

  const advance = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api<any>(`careers/${id}/advance`, { body: {} });
      if (res.kind === "match") {
        router.push(`${base}/match`);
      } else {
        setSummary(res.summary);
        showNotes(res.summary.notes);
        refreshAll();
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }, [busy, id, base, router, toast, showNotes]);

  // Tastenkürzel: Leertaste = Weiter (ausserhalb von Eingabefeldern)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (fullscreen || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(t.tagName)) return;
      if (e.key === " " && e.ctrlKey) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [advance, fullscreen]);

  const d = shell.data;
  const ctx: ShellCtx = { id, shell: d, advance, busy, reloadShell: shell.reload };

  if (fullscreen) return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;

  const c = d?.career;
  const xpPct = c ? ((c.xp - c.xpLevelStart) / Math.max(1, c.xpNextLevel - c.xpLevelStart)) * 100 : 0;
  const hasMatch = !!d?.next;
  const nextLabel = c?.pendingMatch ? "Spiel fortsetzen" : hasMatch ? "Zum Spiel" : c?.week >= c?.seasonWeeks ? "Saisonabschluss" : "Weiter";

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <aside className="sidebar" aria-label="Hauptnavigation">
          <Link href="/careers" className="brand">
            <div className="brand-mark">FL</div>
            <div>Football Legacy<small>Schreibe Fussball Geschichte</small></div>
          </Link>
          {NAV.map((n) => (
            <div key={n.key}>
              <Link href={base + n.href} className={`nav-item ${section === n.key ? "active" : ""}`}>
                <Icon name={n.icon} />
                {n.label}
                {n.key === "office" && d?.unread > 0 && <span className="nav-badge">{d.unread}</span>}
              </Link>
              {section === n.key && n.subs.length > 0 && (
                <div className="nav-sub">
                  {n.subs.map((s) => (
                    <Link key={s.href} href={base + s.href} className={path === base + s.href ? "active" : ""}>{s.label}</Link>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="sidebar-foot">
            {c && (
              <div className="stack-sm" style={{ padding: "0 6px" }}>
                <div className="between small"><span><b>Level {c.level}</b> · {c.title}</span><span className="faint">{c.points} MP</span></div>
                <Progress value={xpPct} />
                <div className="faint small">{c.xp - c.xpLevelStart} / {c.xpNextLevel - c.xpLevelStart} XP</div>
              </div>
            )}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <ThemeToggle />
              <Link className="btn btn-ghost btn-sm" href="/careers" title="Karrieren"><Icon name="users" size={16} /></Link>
            </div>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            {d?.club ? (
              <Link href={base} className="club">
                <Crest colors={d.club.colors} name={d.club.name} size={30} />
                <div style={{ minWidth: 0 }}>
                  <strong className="truncate" style={{ display: "block" }}>{d.club.name}</strong>
                  <span className="faint small truncate" style={{ display: "block" }}>{d.league?.flag} {d.league?.name}</span>
                </div>
              </Link>
            ) : (
              <strong>{c?.status === "unemployed" ? "Vereinslos" : "…"}</strong>
            )}
            <div className="meta">
              {c && <span>Saison <b>{seasonLabel(c.season)}</b></span>}
              {c && <span className="hide-sm">Woche <b>{c.week}/{c.seasonWeeks}</b></span>}
              {d?.club && <span className="hide-sm">Konto <b style={{ color: d.club.balance < 0 ? "var(--danger)" : undefined }}>{money(d.club.balance)}</b></span>}
              {d?.window?.open && <span className="badge badge-accent hide-sm">Transferfenster offen</span>}
            </div>
            <div className="spacer" />
            <button className="btn btn-primary" onClick={advance} disabled={busy || !d || c?.status !== "active"} title="Weiter (Strg + Leertaste)">
              <Icon name={hasMatch || c?.pendingMatch ? "whistle" : "next"} size={16} />
              {busy ? "Simuliere …" : nextLabel}
            </button>
          </header>
          <main className="content">{children}</main>
        </div>
        <nav className="tabbar" aria-label="Navigation">
          {NAV.map((n) => (
            <Link key={n.key} href={base + n.href} className={section === n.key ? "active" : ""}>
              <Icon name={n.icon} size={20} />
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
      <Modal open={!!summary} onClose={() => setSummary(null)} wide>
        {summary && <WeekSummaryView summary={summary} base={base} onClose={() => setSummary(null)} />}
      </Modal>
    </Ctx.Provider>
  );
}

/** Untermenü für Smartphones (die Seitenleiste ist dort ausgeblendet). */
export function MobileSubnav({ section }: { section: string }) {
  const { id } = useGame();
  const path = usePathname();
  const n = NAV.find((x) => x.key === section);
  if (!n || !n.subs.length) return null;
  return (
    <div className="tabs subtabs-mobile">
      {n.subs.map((s) => (
        <Link key={s.href} href={`/c/${id}${s.href}`} className={`tab ${path === `/c/${id}${s.href}` ? "active" : ""}`}>{s.label}</Link>
      ))}
    </div>
  );
}
