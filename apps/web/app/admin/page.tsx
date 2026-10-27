"use client";
import Link from "next/link";
import { useState } from "react";
import { AccountTop } from "@/components/AccountTop";
import { Seg } from "@/components/ui";
import { AdminOverview } from "@/components/admin/Overview";
import { AdminReports } from "@/components/admin/Reports";
import { AdminAccounts } from "@/components/admin/Accounts";
import { AdminAi, AdminActions } from "@/components/admin/Usage";

type Tab = "overview" | "reports" | "accounts" | "ai" | "log";

/** Admin-Bereich: Kennzahlen, Meldungen, Konten, KI-Kosten und Protokoll (nur ADMIN_EMAILS). */
export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <>
      <AccountTop />
      <main className="content">
        <div className="page-head">
          <div><h1>Admin-Bereich</h1><p>Betrieb, Moderation und Kosten von Football Legacy</p></div>
          <Link className="btn btn-sm" href="/admin/fehler">Fehlerprotokoll</Link>
        </div>
        <Seg<Tab> value={tab} onChange={setTab} options={[
          { value: "overview", label: "Übersicht" }, { value: "reports", label: "Meldungen" }, { value: "accounts", label: "Konten" },
          { value: "ai", label: "KI-Kosten" }, { value: "log", label: "Protokoll" },
        ]} />
        <div style={{ marginTop: 14 }}>
          {tab === "overview" && <AdminOverview onOpen={setTab} />}
          {tab === "reports" && <AdminReports />}
          {tab === "accounts" && <AdminAccounts />}
          {tab === "ai" && <AdminAi />}
          {tab === "log" && <AdminActions />}
        </div>
      </main>
    </>
  );
}
