"use client";
import { useApi } from "@/lib/client/api";
import { ErrorBox, Loading } from "@/components/ui";

type Tab = "overview" | "reports" | "accounts" | "ai" | "log";

/** Kennzahlen auf einen Blick. */
export function AdminOverview({ onOpen }: { onOpen: (t: Tab) => void }) {
  const { data, error } = useApi<any>("admin/overview");
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const tiles: [string, string | number, string, Tab?][] = [
    ["Konten", data.accounts, `${data.newAccounts7} neu in 7 Tagen`, "accounts"],
    ["Aktiv heute", data.active1, `${data.active7} in den letzten 7 Tagen`],
    ["Karrieren", data.careers, `${data.careersActive7} in 7 Tagen gespielt`],
    ["Online-Ligen", data.onlineLeagues, "insgesamt"],
    ["Offene Meldungen", data.openReports, "Chat-Nachrichten", "reports"],
    ["Gesperrt", data.banned, "Konten", "accounts"],
    ["Fehler heute", data.errors1, "im Fehlerprotokoll"],
    ["KI heute", `$${data.ai.costUsd.toFixed(2)}`, `${data.ai.requests} Anfragen · ${data.ai.failed} ohne Antwort`, "ai"],
  ];
  return (
    <div className="admin-tiles">
      {tiles.map(([label, value, note, tab]) => (
        <button key={label} type="button" className={`card admin-tile ${tab ? "clickable" : ""}`} onClick={() => tab && onOpen(tab)} disabled={!tab}>
          <span className="label">{label}</span>
          <span className={`value ${label === "Offene Meldungen" && Number(value) > 0 ? "warn" : ""}`}>{value}</span>
          <span className="faint small">{note}</span>
        </button>
      ))}
    </div>
  );
}
