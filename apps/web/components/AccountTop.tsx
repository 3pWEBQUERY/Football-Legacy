"use client";
import { TermsGate } from "./TermsGate";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApi } from "@/lib/client/api";
import { Icon } from "./ui";
import { ThemeToggle } from "./ThemeToggle";
import { LangSwitch } from "./LangSwitch";

/** Kopfleiste der Account-Seiten (Spielstände, Online-Ligen). */
export function AccountTop({ onLogout }: { onLogout?: () => void }) {
  const me = useApi<{ account: any }>("auth/me");
  const admin = useApi<{ admin: boolean }>("admin/me");
  const path = usePathname();
  return (
    <>
    <TermsGate />
    <header className="landing-top">
      <Link href="/careers" className="row" style={{ gap: 10 }}>
        <div className="brand-mark" translate="no">FL</div>
        <div className="brand-name">Football Legacy<small>{me.data?.account?.displayName ?? "Manager"}</small></div>
      </Link>
      <nav className="row account-nav">
        <LangSwitch />
        <ThemeToggle compact />
        <Link className={`btn btn-ghost btn-sm ${path === "/careers" ? "active" : ""}`} href="/careers" aria-label="Spielstände"><Icon name="career" size={15} /> <span className="nav-lbl">Spielstände</span></Link>
        <Link className={`btn btn-ghost btn-sm ${path?.startsWith("/online") ? "active" : ""}`} href="/online" aria-label="Online-Ligen"><Icon name="users" size={15} /> <span className="nav-lbl">Online-Ligen</span></Link>
        <Link className="btn btn-ghost btn-sm" href="/neuigkeiten" aria-label="Neuigkeiten"><Icon name="news" size={15} /> <span className="nav-lbl">Neuigkeiten</span></Link>
        <Link className="btn btn-ghost btn-sm" href="/leaderboards" aria-label="Ranglisten"><Icon name="trophy" size={15} /> <span className="nav-lbl">Ranglisten</span></Link>
        {admin.data?.admin && <Link className={`btn btn-ghost btn-sm ${path?.startsWith("/admin") ? "active" : ""}`} href="/admin" aria-label="Admin-Bereich"><Icon name="shield" size={15} /> <span className="nav-lbl">Admin</span></Link>}
        {onLogout && <button className="btn btn-ghost btn-sm" onClick={onLogout} aria-label="Abmelden"><Icon name="logout" size={15} /> <span className="nav-lbl">Abmelden</span></button>}
      </nav>
    </header>
    </>
  );
}
