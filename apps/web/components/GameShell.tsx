"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, refreshAll, useApi } from "@/lib/client/api";
import { fmtDate, money, seasonLabel } from "@/lib/client/format";
import { Crest, Icon, Modal, Progress, useNotes, useToast } from "./ui";
import { ThemeToggle } from "./ThemeToggle";
import { WeekSummaryView } from "./WeekSummary";

interface ShellCtx {
  id: string;
  shell: any | null;
  advance: () => Promise<void>;
  busy: boolean;
  reloadShell: () => void;
  /** Nachricht, die das Büro öffnen soll (aus dem Tagesbericht) */
  pendingMessage: number | null;
  clearPendingMessage: () => void;
}

/** Standard: diese Kategorien halten die Verarbeitung nicht an (in den Einstellungen änderbar). */
const QUIET = new Set(["news", "finance", "training"]);
const MAX_DAYS = 120;
/** Kurze Beschriftungen für die Tab-Leiste auf dem Smartphone */
const TAB_LABEL: Record<string, string> = { competition: "Liga", national: "Nation", market: "Transfers" };

const Ctx = createContext<ShellCtx>({ id: "", shell: null, advance: async () => {}, busy: false, reloadShell: () => {}, pendingMessage: null, clearPendingMessage: () => {} });
export const useGame = () => useContext(Ctx);

const NAV = [
  { key: "office", label: "Büro", icon: "office", href: "", subs: [{ href: "", label: "Übersicht & Posteingang" }, { href: "/calendar", label: "Kalender" }, { href: "/media", label: "Medien" }, { href: "/board", label: "Vorstand" }] },
  { key: "team", label: "Team", icon: "team", href: "/team", subs: [{ href: "/team", label: "Kader" }, { href: "/team/tactic", label: "Taktik" }, { href: "/team/dynamics", label: "Dynamik" }, { href: "/team/training", label: "Training" }, { href: "/team/staff", label: "Stab" }, { href: "/team/youth", label: "Jugend" }, { href: "/team/medical", label: "Medizin" }] },
  { key: "market", label: "Transfers", icon: "transfer", href: "/market", subs: [{ href: "/market", label: "Spielersuche" }, { href: "/market/scouting", label: "Scouting" }, { href: "/market/contracts", label: "Verträge" }, { href: "/market/finances", label: "Finanzen" }] },
  { key: "competition", label: "Wettbewerb", icon: "trophy", href: "/competition", subs: [{ href: "/competition", label: "Tabelle & Spielplan" }, { href: "/competition/cup", label: "Pokal" }, { href: "/competition/continental", label: "Kontinentalpokal" }, { href: "/competition/stats", label: "Statistiken" }, { href: "/competition/awards", label: "Auszeichnungen" }] },
  { key: "national", label: "Nationalteam", icon: "flag", href: "/national", subs: [{ href: "/national", label: "Übersicht" }, { href: "/national/squad", label: "Kader & Taktik" }, { href: "/national/matches", label: "Spiele" }] },
  { key: "career", label: "Karriere", icon: "star", href: "/career", subs: [{ href: "/career", label: "Manager" }, { href: "/career/review", label: "Saisonrückblick" }, { href: "/career/collection", label: "Sammlung & Shop" }, { href: "/career/leaderboards", label: "Ranglisten" }, { href: "/career/settings", label: "Einstellungen" }] },
];

function activeSection(path: string, base: string) {
  const rest = path.slice(base.length);
  if (rest.startsWith("/team") || rest.startsWith("/player")) return "team";
  if (rest.startsWith("/market")) return "market";
  if (rest.startsWith("/competition") || rest.startsWith("/club") || rest.startsWith("/report")) return "competition";
  if (rest.startsWith("/career")) return "career";
  if (rest.startsWith("/national")) return "national";
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
  const [liveDate, setLiveDate] = useState<string | null>(null);
  const stopRef = useRef(false);
  const [pendingMessage, setPendingMessage] = useState<number | null>(null);
  const base = `/c/${id}`;
  const section = activeSection(path, base);
  const fullscreen = path.endsWith("/match");

  useEffect(() => {
    api(`careers/${id}/checkin`, { body: {} }).then((r: any) => showNotes(r.notes)).catch(() => {});
  }, [id, showNotes]);

  /**
   * „Weiter“ wie im Fussball Manager: die Tage laufen automatisch ab, bis
   * etwas Wichtiges passiert (Nachricht, Spieltag, Saisonende). Ein zweiter
   * Klick hält die Verarbeitung an.
   */
  const advance = useCallback(async () => {
    if (busy) {
      stopRef.current = true;
      return;
    }
    stopRef.current = false;
    setBusy(true);
    try {
      for (let i = 0; i < MAX_DAYS; i++) {
        const res = await api<any>(`careers/${id}/advance`, { body: {} });
        if (res.kind === "match") {
          router.push(`${base}/match`);
          break;
        }
        if (res.kind === "week") {
          // Spielrunde ohne eigenes Spiel: nur am Saisonende anhalten
          if (res.summary.seasonEnd) {
            setSummary(res.summary);
            showNotes(res.summary.notes);
            break;
          }
          continue;
        }
        setLiveDate(res.day.date);
        const stopOn: Record<string, boolean> | undefined = shell.data?.career?.stopOn;
        const important = res.day.inbox.filter((m: any) => (stopOn && m.category in stopOn ? stopOn[m.category] : !QUIET.has(m.category)));
        if (important.length) {
          setPendingMessage(important[0].id);
          if (path !== base) router.push(base);
          break;
        }
        if (stopRef.current) break;
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setLiveDate(null);
      refreshAll();
    }
  }, [busy, id, base, path, router, toast, showNotes, shell.data]);

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
  const ctx: ShellCtx = { id, shell: d, advance, busy, reloadShell: shell.reload, pendingMessage, clearPendingMessage: () => setPendingMessage(null) };
  if (fullscreen) return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;

  const c = d?.career;
  const hasMatch = !!d?.next;
  const matchday = !!c && c.nextMatchday !== null && c.day >= c.nextMatchday;
  const today = d?.schedule?.[0];
  const daysToMatch = c && d?.next?.day !== null && d?.next?.day !== undefined ? d.next.day - c.day : null;
  const nextLabel = busy ? "Stopp" : c?.pendingMatch ? "Spiel fortsetzen" : matchday ? (hasMatch ? "Zum Spiel" : "Spieltag") : "Weiter";
  const nextSub = !c ? "" : c.pendingMatch || (matchday && hasMatch) ? `${d.next.home.short} – ${d.next.away.short}` : matchday ? "Andere Spiele" : `Morgen: ${d?.schedule?.[1]?.label ?? ""}`;
  const clubStyle = d?.club ? ({ "--club": d.club.colors.primary, "--club-2": d.club.colors.secondary } as CSSProperties) : undefined;
  const nav = NAV.find((n) => n.key === section)!;
  const opp = d?.next ? (d.next.home.id === c?.clubId ? d.next.away : d.next.home) : null;

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
              {c && (
                <Link href={`${base}/calendar`} className="meta-cell date" title="Kalender öffnen">
                  <span className="k">Saison {seasonLabel(c.season)}{today ? ` · ${today.label}` : ""}</span>
                  <span className="v">{fmtDate(liveDate ?? c.date)}</span>
                </Link>
              )}
            </div>
          </div>
          <button className={`continue ${busy ? "running" : matchday && hasMatch ? "matchday" : ""}`} onClick={advance} disabled={!d || c?.status !== "active"} title={busy ? "Verarbeitung anhalten" : "Weiter (Strg + Leertaste)"}>
            <span style={{ textAlign: "left" }}>
              {nextLabel}
              <span className="sub">{busy ? `Verarbeite · ${fmtDate(liveDate ?? c?.date, { year: false })}` : nextSub}</span>
            </span>
            {busy ? <span className="continue-spin" aria-hidden="true" /> : <Icon name="next" size={18} stroke={2.2} />}
          </button>
          <div className={`processing-bar ${busy ? "on" : ""}`} aria-hidden="true"><span /></div>
        </header>

        <nav className="mainnav" aria-label="Hauptmenü">
          {NAV.map((n) => (
            <div key={n.key} className="mn-item">
              <Link href={base + n.href} className={`mn-link ${section === n.key ? "active" : ""}`}>
                <Icon name={n.icon} size={16} />
                {n.label}
                {n.key === "office" && d?.unread > 0 && <span className="mn-badge">{d.unread}</span>}
              </Link>
              <div className="mn-drop">
                {n.subs.map((s) => <Link key={s.href} href={base + s.href} className={path === base + s.href ? "active" : ""}>{s.label}</Link>)}
              </div>
            </div>
          ))}
          <div className="mn-right">
            {opp && d?.next && (
              <Link href={`${base}/club/${opp.id}`} className="mn-cell" title="Nächster Gegner">
                <Crest colors={opp.colors} name={opp.name} size={22} />
                <span style={{ minWidth: 0 }}>
                  <span className="k">{daysToMatch === 0 ? "Heute" : daysToMatch === 1 ? "Morgen" : daysToMatch !== null ? `In ${daysToMatch} Tagen` : "Nächstes Spiel"} · {d.next.home.id === c?.clubId ? "Heim" : "Auswärts"}</span>
                  <span className="v truncate">{opp.name}</span>
                </span>
              </Link>
            )}
            {d?.window?.open && (
              <div className="mn-cell"><span><span className="k">Transferfenster</span><span className="v pos-txt">Offen</span></span></div>
            )}
            {c && (
              <Link href={`${base}/career`} className="mn-cell" title={`${c.xp - c.xpLevelStart} / ${c.xpNextLevel - c.xpLevelStart} XP`}>
                <span>
                  <span className="k">Level {c.level} · {c.title}</span>
                  <span className="mn-xp" style={{ display: "block", marginTop: 4 }}><Progress value={c.xp - c.xpLevelStart} max={c.xpNextLevel - c.xpLevelStart} tone={undefined} /></span>
                </span>
              </Link>
            )}
            <div className="mn-cell" style={{ gap: 4 }}>
              <ThemeToggle compact />
              <Link className="btn btn-ghost btn-sm" href="/careers" title="Alle Karrieren"><Icon name="users" size={15} /></Link>
            </div>
          </div>
        </nav>

        <nav className="subnav" aria-label={`${nav.label} – Unterbereiche`}>
          {nav.subs.map((s) => (
            <Link key={s.href} href={base + s.href} className={path === base + s.href ? "active" : ""}>{s.label}</Link>
          ))}
        </nav>

        <main className="main"><div className="content">{children}</div></main>

        <nav className="tabbar" aria-label="Hauptmenü (mobil)">
          {NAV.map((n) => (
            <Link key={n.key} href={base + n.href} className={section === n.key ? "active" : ""} aria-current={section === n.key ? "page" : undefined}>
              <span className="tabbar-icon">
                <Icon name={n.icon} size={20} />
                {n.key === "office" && d?.unread > 0 && <span className="tabbar-badge">{d.unread > 99 ? "99+" : d.unread}</span>}
              </span>
              <span className="tabbar-label">{TAB_LABEL[n.key] ?? n.label}</span>
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
