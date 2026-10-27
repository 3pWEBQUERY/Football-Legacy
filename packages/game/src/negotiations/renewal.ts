/** Transferverhandlungen: Vertragsverlängerung mit dem Berater eines eigenen Spielers. */
import { SQUAD_STATUS_LABEL, formatMoney, renewalDemand, roundMoney, squadRanks } from "@fl/sim";
import { withCareer } from "../career";
import { one, type Db } from "../db";
import { GameError } from "../errors";
import { clubSender, send } from "../news";
import { addFinance, getClub, getPlayer, getPlayers, saveClubs, savePlayers, type CareerRow } from "../repo";
import { ACTIVE, describeTerms, expectedRole, insertNeg, log, newNeg, requireClub, type ContractTerms, type NegRow } from "./core";

/** Gespräche über eine Verlängerung eröffnen (oder die laufende Verhandlung zurückgeben). */
export async function startRenewal(careerId: string, accountId: string, playerId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    const p = await getPlayer(db, career.id, playerId);
    if (!p || p.clubId !== clubId) throw new GameError("Spieler nicht in deinem Kader.");
    if (p.loan) throw new GameError("Mit Leihspielern kannst du nicht verlängern.");
    if (p.precontract) throw new GameError(`${p.firstName} ${p.lastName} hat bereits einen Vorvertrag bei einem anderen Verein unterschrieben.`);
    const open = await one<{ id: number; kind: string }>(db, "select id, kind from negotiations where career_id = $1 and player_id = $2 and stage = any($3::text[])", [career.id, p.id, ACTIVE]);
    if (open?.kind === "renew") return { id: open.id, message: "Die Gespräche laufen bereits." };
    if (open) throw new GameError("Über den Spieler wird gerade mit einem anderen Verein verhandelt.");
    const yearsLeft = (p.contract?.untilSeason ?? career.season) - career.season;
    if (yearsLeft >= 3) throw new GameError(`${p.firstName} ${p.lastName} ist noch bis ${(p.contract?.untilSeason ?? 0) + 1} gebunden und sieht keinen Grund, jetzt zu verlängern.`);
    if (p.transferRequest) throw new GameError(`${p.firstName} ${p.lastName} hat einen Wechselwunsch geäussert und lehnt Gespräche über eine Verlängerung ab.`);
    if (p.morale < 25) throw new GameError(`${p.firstName} ${p.lastName} ist unzufrieden und möchte im Moment nicht über seinen Vertrag sprechen.`);
    const club = (await getClub(db, career.id, clubId))!;
    const squad = await getPlayers(db, career.id, [clubId]);
    const base = renewalDemand(p, club.reputation, squadRanks(squad).get(p.id) ?? 20);
    const demand: ContractTerms = {
      wage: base.wage,
      years: base.years,
      role: expectedRole(p, squad),
      signingBonus: Math.round((base.wage * 4) / 1000) * 1000,
      releaseClause: p.age <= 25 && p.potential >= p.rating + 4 ? roundMoney(p.value * 2.5) : null,
      agentFee: roundMoney(Math.max(base.wage * 2, 5_000)),
    };
    const n = newNeg(career, "renew", p, clubId, clubId);
    n.stage = "contract";
    n.status = "open";
    n.demand = demand;
    n.message = `Der Berater von ${n.player_name} ist gesprächsbereit.`;
    log(n, career, "berater", `Forderung: ${describeTerms(demand)}`);
    await insertNeg(db, n);
    return { id: n.id, message: n.message };
  });
}

/** Einigung über die Verlängerung: neuer Vertrag, Handgeld und Beraterhonorar werden fällig. */
export async function completeRenewal(db: Db, career: CareerRow, n: NegRow, t: ContractTerms) {
  const p = (await getPlayer(db, career.id, n.player_id))!;
  const club = (await getClub(db, career.id, n.to_club))!;
  const until = Math.max(p.contract?.untilSeason ?? career.season, career.season + t.years - 1);
  const old = p.contract?.wage ?? 0;
  p.contract = { wage: t.wage, untilSeason: until, releaseClause: t.releaseClause, goalBonus: p.contract?.goalBonus ?? 0 };
  p.squadStatus = t.role;
  p.morale = Math.min(100, p.morale + 8);
  await savePlayers(db, career.id, [p]);
  const once = t.signingBonus + t.agentFee;
  club.balance -= once;
  club.transfer_budget = Math.max(0, club.transfer_budget - once);
  await saveClubs(db, career.id, [club]);
  if (once) {
    await addFinance(db, career.id, club.id, career.season, career.week, [
      ...(t.signingBonus ? [{ kind: "bonus", amount: -t.signingBonus, label: `Handgeld Verlängerung ${n.player_name}` }] : []),
      ...(t.agentFee ? [{ kind: "other", amount: -t.agentFee, label: `Beraterhonorar Verlängerung ${n.player_name}` }] : []),
    ]);
  }
  n.stage = "done";
  n.status = "agreed";
  n.message = `${n.player_name} verlängert bis Sommer ${until + 1}!`;
  await send(db, career, {
    category: "squad", title: `${n.player_name} verlängert`, sender: clubSender(club, "Sportdirektion"),
    blocks: [
      { t: "p", text: `${n.player_name} hat seinen Vertrag bei ${club.name} verlängert.` },
      { t: "kv", rows: [["Gehalt", `${formatMoney(t.wage)} / Woche (bisher ${formatMoney(old)})`], ["Vertrag bis", `Sommer ${until + 1}`], ["Rolle", SQUAD_STATUS_LABEL[t.role]], ["Handgeld", formatMoney(t.signingBonus)], ["Beraterhonorar", formatMoney(t.agentFee)]] },
    ],
    priority: 1, kind: "renewal", action: { type: "player", playerId: p.id },
  });
  return { status: "completed", message: n.message, notes: [] };
}
