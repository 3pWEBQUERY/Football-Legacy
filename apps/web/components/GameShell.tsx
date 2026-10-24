"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
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
  { key: "office", label: "Büro", icon: "office", href: "", subs: [{ href: "", label: "Übersicht & Posteingang" }] },
  { key: "team", label: "Team", icon: "team", href: "/team", subs: [{ href: "/team", label: "Kader" }, { href: "/team/tactic", label: "Taktik" }, { href: "/team/training", label: "Training & Stab" }] },
  { key: "market", label: "Transfers", icon: "transfer", href: "/market", subs: [{ href: "/market", label: "Spielersuche" }, { href: "/market/contracts", label: "Verträge" }, { href: "/market/finances", label: "Finanzen" }] },
  { key: "competition", label: "Wettbewerb", icon: "trophy", href: "/competition", subs: [{ href: "/competition", label: "Tabelle & Spielplan" }, { href: "/competition/stats", label: "Statistiken" }] },
  { key: "career", label: "Karriere", icon: "star", href: "/career", subs: [{ href: "/career", label: "Manager" }, { href: "/career/collection", label: "Sammlung & Shop" }, { href: "/career/leaderboards", label: "Ranglisten" }] },
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

  // Tastenkürzel wie im Original-Manager: Strg + Leertaste = Weiter
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (fullscreen || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
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
  const hasMatch = !!d?.next;
  const nextLabel = c?.pendingMatch ? "Spiel fortsetzen" : hasMatch ? "Spieltag" : "Weiter";
  const nextSub = c ? (hasMatch ? `${d.next.home.short} – ${d.next.away.short}` : c.week === 0 ? "Saisonvorbereitung" : `Woche ${c.week + 1}`) : "";
  const clubStyle = d?.club ? ({ "--club": d.club.colors.primary, "--club-2": d.club.colors.secondary } as CSSProperties) : undefined;
  const nav = NAV.find((n) => n.key === section)!;

  return (
    <Ctx.Provider value={ctx}>
      <div className="app" style={clubStyle}>
        <header className="topbar">
          <Link href="/careers" className="brand" title="Karrieren">
            <div className="brand-mark">FL</div>
            <div className="brand-name">Football Legacy<small>Manager</small></div>
          </Link>
          <div className="clubbar">
            {d?.club ? (
              <Link href={base} className="club">
                <Crest colors={d.club.colors} name={d.club.name} size={30} />
                <div style={{ minWidth: 0 }}>
                  <strong className="truncate">{d.club.name}</strong>
                  <span className="truncate">{d.league?.name} · {c?.managerName}</span>
                </div>
              </Link>
            ) : (
              <strong className="cond up">{c?.status === "unemployed" ? "Vereinslos" : ""}</strong>
            )}
            <div className="metabar">
              {c && (
                <div className="meta-cell">
                  <span className="k">Saison {seasonLabel(c.season)}</span>
                  <span className="v">{c.week === 0 ? "Vorbereitung" : `Woche ${c.week} / ${c.seasonWeeks}`}</span>
                </div>
              )}
              {d?.club && (
                <div className="meta-cell opt">
                  <span className="k">Kontostand</span>
                  <span className="v" style={{ color: d.club.balance < 0 ? "var(--neg)" : undefined }}>{money(d.club.balance)}</span>
                </div>
              )}
              {d?.club && (
                <div className="meta-cell opt">
                  <span className="k">Transferbudget</span>
                  <span className="v">{money(d.club.transferBudget)}</span>
                </div>
              )}
              {d?.window?.open && (
                <div className="meta-cell opt">
                  <span className="k">Transferfenster</span>
                  <span className="v pos-txt">Offen</span>
                </div>
              )}
            </div>
          </div>
          <button className="continue" onClick={advance} disabled={busy || !d || c?.status !== "active"} title="Weiter (Strg + Leertaste)">
            <span style={{ textAlign: "left" }}>
              {busy ? "Simuliere" : nextLabel}
              <span className="sub">{busy ? "Bitte warten" : nextSub}</span>
            </span>
            <Icon name="next" size={18} stroke={2.2} />
          </button>
        </header>

        <aside className="rail" aria-label="Hauptnavigation">
          <div className="rail-group">Verein</div>
          {NAV.map((n) => (
            <Link key={n.key} href={base + n.href} className={`nav-item ${section === n.key ? "active" : ""}`}>
              <Icon name={n.icon} size={17} />
              {n.label}
              {n.key === "office" && d?.unread > 0 && <span className="nav-badge">{d.unread}</span>}
            </Link>
          ))}
          {d?.next && (
            <>
              <div className="rail-group" style={{ marginTop: 10 }}>Nächstes Spiel</div>
              <Link href={`${base}/club/${d.next.home.id === c?.clubId ? d.next.away.id : d.next.home.id}`} className="row" style={{ padding: "4px 16px", gap: 10 }}>
                <Crest colors={(d.next.home.id === c?.clubId ? d.next.away : d.next.home).colors} name={(d.next.home.id === c?.clubId ? d.next.away : d.next.home).name} size={22} />
                <div style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 600 }}>{(d.next.home.id === c?.clubId ? d.next.away : d.next.home).name}</div>
                  <div className="faint small">{d.next.home.id === c?.clubId ? "Heim" : "Auswärts"} · {d.next.week}. Spieltag</div>
                </div>
              </Link>
            </>
          )}
          <div className="rail-foot">
            {c && (
              <>
                <div className="between small"><span className="cond up" style={{ fontWeight: 700 }}>Level {c.level}</span><span className="faint">{c.title}</span></div>
                <Progress value={c.xp - c.xpLevelStart} max={c.xpNextLevel - c.xpLevelStart} tone={undefined} />
                <div className="between small faint"><span>{c.xp - c.xpLevelStart} / {c.xpNextLevel - c.xpLevelStart} XP</span><span>{c.points} MP</span></div>
              </>
            )}
            <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
              <ThemeToggle />
              <Link className="btn btn-ghost btn-sm" href="/careers" title="Alle Karrieren"><Icon name="users" size={15} /></Link>
            </div>
          </div>
        </aside>

        <nav className="subnav" aria-label={`${nav.label} – Unterbereiche`}>
          {nav.subs.map((s) => (
            <Link key={s.href} href={base + s.href} className={path === base + s.href ? "active" : ""}>{s.label}</Link>
          ))}
        </nav>

        <main className="main"><div className="content">{children}</div></main>

        <nav className="tabbar" aria-label="Navigation">
          {NAV.map((n) => (
            <Link key={n.key} href={base + n.href} className={section === n.key ? "active" : ""}>
              <Icon name={n.icon} size={19} />
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

/** Früher die mobile Unternavigation – die Unternavigation ist jetzt immer sichtbar. */
export function MobileSubnav(_: { section: string }) {
  return null;
}
