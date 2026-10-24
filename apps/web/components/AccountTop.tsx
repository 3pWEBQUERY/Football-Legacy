"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApi } from "@/lib/client/api";
import { Icon } from "./ui";
import { ThemeToggle } from "./ThemeToggle";

/** Kopfleiste der Account-Seiten (Spielstände, Online-Ligen). */
export function AccountTop({ onLogout }: { onLogout?: () => void }) {
  const me = useApi<{ account: any }>("auth/me");
  const path = usePathname();
  return (
    <header className="landing-top">
      <Link href="/careers" className="row" style={{ gap: 10 }}>
        <div className="brand-mark">FL</div>
        <div className="brand-name">Football Legacy<small>{me.data?.account?.displayName ?? "Manager"}</small></div>
      </Link>
      <nav className="row account-nav">
        <ThemeToggle compact />
        <Link className={`btn btn-ghost btn-sm ${path === "/careers" ? "active" : ""}`} href="/careers" aria-label="Spielstände"><Icon name="career" size={15} /> <span className="nav-lbl">Spielstände</span></Link>
        <Link className={`btn btn-ghost btn-sm ${path?.startsWith("/online") ? "active" : ""}`} href="/online" aria-label="Online-Ligen"><Icon name="users" size={15} /> <span className="nav-lbl">Online-Ligen</span></Link>
        <Link className="btn btn-ghost btn-sm" href="/leaderboards" aria-label="Ranglisten"><Icon name="trophy" size={15} /> <span className="nav-lbl">Ranglisten</span></Link>
        {onLogout && <button className="btn btn-ghost btn-sm" onClick={onLogout} aria-label="Abmelden"><Icon name="logout" size={15} /> <span className="nav-lbl">Abmelden</span></button>}
      </nav>
    </header>
  );
}
