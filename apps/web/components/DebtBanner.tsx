"use client";
import Link from "next/link";
import { money } from "@/lib/client/format";
import { useGame } from "./GameShell";
import { Icon } from "./ui";

/** Hinweis bei negativem Kontostand: Transfersperre, Zinsen, drohender Zwangsverkauf. */
export function DebtBanner() {
  const { id, shell } = useGame();
  const balance = shell?.club?.balance;
  if (typeof balance !== "number" || balance >= 0) return null;
  return (
    <aside className="debt-banner" role="alert">
      <Icon name="euro" size={16} />
      <div>
        <b>Transfersperre – Konto {money(balance)}</b>
        <div className="small">Solange das Konto im Minus ist, sind keine Neuzugänge möglich und es fallen Überziehungszinsen an. Unter dem Kreditrahmen verkauft der Vorstand im Transferfenster deinen wertvollsten Spieler.</div>
      </div>
      <Link className="btn btn-sm" href={`/c/${id}/market/finances`}>Finanzen</Link>
    </aside>
  );
}
