"use client";
import { useApi } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { MobileSubnav, useGame } from "@/components/GameShell";
import { BarList, LineChart } from "@/components/Charts";
import { ErrorBox, Loading, Stat } from "@/components/ui";
import { PageTip } from "@/components/Onboarding";
import { DebtBanner } from "@/components/DebtBanner";

export default function Finances() {
  const { id } = useGame();
  const { data, error } = useApi<any>(`careers/${id}/finances`);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const income = data.byKind.filter((k: any) => k.amount > 0).sort((a: any, b: any) => b.amount - a.amount);
  const expenses = data.byKind.filter((k: any) => k.amount < 0).sort((a: any, b: any) => a.amount - b.amount);
  const totalIn = income.reduce((s: number, k: any) => s + k.amount, 0);
  const totalOut = expenses.reduce((s: number, k: any) => s + k.amount, 0);
  const p = data.profile;
  return (
    <>
      <MobileSubnav section="market" />
      <DebtBanner />
      <PageTip id="finances" title="Finanzen">Gehälter sind der grösste Kostenblock. Einnahmen kommen aus Tickets, Sponsoren, TV-Geldern und Prämien – nach einem Aufstieg steigen TV- und Sponsorengelder spürbar.</PageTip>
      <div className="page-head">
        <div><h1>Finanzen</h1><p>Saisonbilanz bisher: <b style={{ color: totalIn + totalOut < 0 ? "var(--danger)" : "var(--accent)" }}>{money(totalIn + totalOut)}</b></p></div>
      </div>
      <div className="grid grid-4">
        <div className="card"><Stat label="Kontostand" value={money(data.club.balance)} sub={`Vorgabe Vorstand: mind. ${money(data.board.financeTarget)}`} /></div>
        <div className="card"><Stat label="Transferbudget" value={money(data.club.transferBudget)} /></div>
        <div className="card"><Stat label="Gehälter / Woche" value={money(data.wages)} sub={`Budget ${money(data.club.wageBudget)}`} /></div>
        <div className="card"><Stat label="Ticketpreis" value={p ? `${p.ticketPrice} €` : "–"} sub={`${data.club.capacity.toLocaleString("de-CH")} Plätze`} /></div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Kontostand im Saisonverlauf</h3></div>
        <LineChart points={data.balanceSeries.map((b: any) => ({ x: b.week, y: b.balance }))} format={money} label="Kontostand pro Woche" />
      </div>
      <div className="grid grid-2">
        <div className="card stack">
          <div className="between"><h3>Einnahmen</h3><b className="num">{money(totalIn)}</b></div>
          {income.length ? <BarList rows={income.map((k: any) => ({ label: k.label, value: k.amount }))} format={money} /> : <p className="faint">Noch keine Einnahmen.</p>}
        </div>
        <div className="card stack">
          <div className="between"><h3>Ausgaben</h3><b className="num">{money(totalOut)}</b></div>
          {expenses.length ? <BarList rows={expenses.map((k: any) => ({ label: k.label, value: -k.amount }))} format={money} color="var(--text-3)" /> : <p className="faint">Noch keine Ausgaben.</p>}
        </div>
      </div>
      <div className="card card-flush">
        <div className="card-head" style={{ paddingBottom: 8 }}><h3>Letzte Buchungen</h3></div>
        <table className="table">
          <thead><tr><th>Woche</th><th>Buchung</th><th className="r">Betrag</th></tr></thead>
          <tbody>
            {data.recent.map((r: any, i: number) => (
              <tr key={i}><td className="faint">{r.week}</td><td>{r.label}</td><td className="r num" style={{ color: r.amount < 0 ? "var(--danger)" : "var(--accent)" }}>{money(r.amount)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
