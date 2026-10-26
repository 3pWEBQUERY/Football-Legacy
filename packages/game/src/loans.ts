/**
 * Leihgeschäfte: Spieler bis Saisonende ausleihen oder verleihen – auf Wunsch mit
 * Kaufoption (du entscheidest, ob du kaufst) oder Kaufpflicht (der Kauf erfolgt
 * zum Saisonende automatisch). Eine Kaufoption kannst du jederzeit ziehen.
 */
import { Rng, askingPrice, formatMoney, roundMoney, seedFor, squadRanks } from "@fl/sim";
import { withCareer } from "./career";
import { query } from "./db";
import { GameError } from "./errors";
import { addFinance, addInbox, getClub, getClubs, getPlayer, getPlayers, saveCareer, saveClubs, savePlayers, type CareerRow, type ClubRow } from "./repo";
import { completeMission, type RewardNote } from "./rewards";
import { windowFor } from "./window";

function requireClub(career: CareerRow): number {
  if (!career.club_id || career.status !== "active") throw new GameError("Du hast aktuell keinen Verein.");
  return career.club_id;
}

function removeFromTactic(club: ClubRow, playerId: number) {
  if (!club.tactic) return;
  club.tactic.lineup = club.tactic.lineup.map((id) => (id === playerId ? null : id));
  club.tactic.bench = club.tactic.bench.filter((id) => id !== playerId);
}

export interface LoanOption { fee: number; obligation: boolean }

function optionText(loan: { optionFee?: number | null; obligation?: boolean }) {
  if (!loan.optionFee) return "";
  return loan.obligation ? ` mit Kaufpflicht über ${formatMoney(loan.optionFee)}` : ` mit Kaufoption über ${formatMoney(loan.optionFee)}`;
}

/**
 * Spieler bis Saisonende ausleihen. wageShare = Anteil am Gehalt, den du übernimmst.
 * Mit Kaufpflicht gibt der Stammverein auch Stammspieler ab und verlangt weniger Gehaltsanteil.
 */
export async function loanIn(careerId: string, accountId: string, playerId: number, wageShare: number, option: LoanOption | null = null) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    if (!windowFor(career).open) throw new GameError("Leihen sind nur im Transferfenster möglich.");
    const p = await getPlayer(db, career.id, playerId);
    if (!p || p.clubId === null || p.clubId === clubId) throw new GameError("Dieser Spieler kann nicht ausgeliehen werden.");
    if (p.loan) throw new GameError("Der Spieler ist bereits ausgeliehen.");
    const share = Math.max(0, Math.min(1, Math.round(wageShare * 100) / 100));
    const parent = (await getClub(db, career.id, p.clubId))!;
    const me = (await getClub(db, career.id, clubId))!;
    const squad = await getPlayers(db, career.id, [parent.id]);
    const own = await getPlayers(db, career.id, [clubId]);
    if (own.length >= 32) throw new GameError("Dein Kader ist voll (max. 32 Spieler).");
    const rank = squadRanks(squad).get(p.id) ?? 30;
    const ask = askingPrice(p, { season: career.season, squadRank: rank, squadSize: squad.length, sellerReputation: parent.reputation, isUserClub: false });
    const opt = option && option.fee > 0 ? { fee: Math.round(option.fee), obligation: !!option.obligation } : null;
    if (opt) {
      const minFee = roundMoney(ask * (opt.obligation ? 0.85 : 1));
      if (opt.fee < minFee) return { status: "countered", message: `${parent.name} verlangt für die ${opt.obligation ? "Kaufpflicht" : "Kaufoption"} mindestens ${formatMoney(minFee)}.`, minOptionFee: minFee };
      if (opt.obligation && opt.fee > me.transfer_budget + me.balance * 0.5) throw new GameError("Die Kaufpflicht übersteigt deine finanziellen Möglichkeiten.");
    }
    // Stammverein gibt ohne Kaufpflicht nur Ergänzungsspieler oder Talente ab
    if (rank <= 11 && p.age > 21 && !opt?.obligation) return { status: "rejected", message: `${parent.name} gibt einen Stammspieler nicht ohne Kaufpflicht ab.` };
    const minShare = Math.max(0, (rank > 16 ? 0.5 : p.age <= 21 ? 0.6 : 0.8) - (opt?.obligation ? 0.2 : opt ? 0.1 : 0));
    if (share < minShare) return { status: "countered", message: `${parent.name} verlangt, dass du mindestens ${Math.round(minShare * 100)} % des Gehalts übernimmst.`, minShare };
    if (me.reputation < parent.reputation - 30) return { status: "rejected", message: `${p.lastName} möchte nicht zu einem deutlich kleineren Verein wechseln.` };
    removeFromTactic(parent, p.id);
    await saveClubs(db, career.id, [parent]);
    p.clubId = clubId;
    p.listed = false;
    p.joined = { season: career.season };
    p.squadStatus = null;
    p.loan = { parentClubId: parent.id, untilSeason: career.season, wageShare: share, optionFee: opt?.fee ?? null, obligation: opt?.obligation ?? false };
    p.morale = Math.min(100, p.morale + 5);
    await savePlayers(db, career.id, [p]);
    const name = `${p.firstName} ${p.lastName}`;
    await query(db,
      `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, season, week, message)
       values ($1,$2,$3,$4,$5,0,$6,0,'loan','completed',$7,$8,$9)`,
      [career.id, p.id, name, parent.id, clubId, Math.round((p.contract?.wage ?? 0) * share), career.season, career.week, `Leihe bis Saisonende (${Math.round(share * 100)} % Gehalt)${optionText(p.loan)}`]);
    const notes: RewardNote[] = [];
    completeMission(career, "sign_player", notes);
    await saveCareer(db, career);
    await addInbox(db, career.id, career.season, career.week, "transfer", `Leihe: ${name}`,
      `${name} wechselt bis Saisonende von ${parent.name} zu ${me.name}${optionText(p.loan)}. Du übernimmst ${Math.round(share * 100)} % des Gehalts (${formatMoney(Math.round((p.contract?.wage ?? 0) * share))} pro Woche).`,
      { type: "player", playerId: p.id });
    return { status: "completed", message: `${name} ist bis Saisonende ausgeliehen${optionText(p.loan)}.`, notes };
  });
}

/** Kaufoption ziehen: Der Leihspieler wird fest verpflichtet. */
export async function exerciseLoanOption(careerId: string, accountId: string, playerId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    const p = await getPlayer(db, career.id, playerId);
    if (!p || p.clubId !== clubId || !p.loan || p.loan.parentClubId === clubId) throw new GameError("Das ist kein Leihspieler deines Vereins.");
    if (!p.loan.optionFee) throw new GameError("Für diese Leihe wurde keine Kaufoption vereinbart.");
    const me = (await getClub(db, career.id, clubId))!;
    const parent = await getClub(db, career.id, p.loan.parentClubId);
    const fee = p.loan.optionFee;
    if (fee > me.transfer_budget) throw new GameError(`Die Kaufoption (${formatMoney(fee)}) übersteigt dein Transferbudget (${formatMoney(me.transfer_budget)}).`);
    me.balance -= fee;
    me.transfer_budget -= fee;
    if (parent) parent.balance += fee;
    await saveClubs(db, career.id, parent ? [me, parent] : [me]);
    p.loan = null;
    p.squadStatus = null;
    await savePlayers(db, career.id, [p]);
    const name = `${p.firstName} ${p.lastName}`;
    await addFinance(db, career.id, me.id, career.season, career.week, [{ kind: "transfer_out", amount: -fee, label: `Kaufoption ${name}` }]);
    await query(db,
      `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, message, season, week)
       values ($1,$2,$3,$4,$5,$6,$7,0,'buy','completed','Kaufoption gezogen',$8,$9)`,
      [career.id, p.id, name, parent?.id ?? null, me.id, fee, p.contract?.wage ?? 0, career.season, career.week]);
    return { status: "completed", message: `Kaufoption gezogen: ${name} gehört jetzt fest zu ${me.name}.` };
  });
}

/** Eigenen Spieler verleihen: Ein passender Verein übernimmt ihn bis Saisonende, manchmal mit Kaufoption. */
export async function loanOut(careerId: string, accountId: string, playerId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    if (!windowFor(career).open) throw new GameError("Leihen sind nur im Transferfenster möglich.");
    const p = await getPlayer(db, career.id, playerId);
    if (!p || p.clubId !== clubId) throw new GameError("Spieler nicht in deinem Kader.");
    if (p.loan) throw new GameError("Leihspieler kannst du nicht weiterverleihen.");
    const own = await getPlayers(db, career.id, [clubId]);
    if (own.length <= 18) throw new GameError("Du brauchst mindestens 18 Spieler im Kader.");
    const me = (await getClub(db, career.id, clubId))!;
    const candidates = await getClubs(db, career.id, "players_generated and id <> $2 and abs(rating - $3) <= 8 and reputation <= $4", [clubId, p.rating, me.reputation + 5]);
    if (!candidates.length) return { status: "rejected", message: `Kein Verein hat Interesse an einer Leihe von ${p.lastName}.` };
    const rng = new Rng(seedFor(career.seed, "loan-out", p.id, career.season, career.week));
    // Bevorzugt Vereine, bei denen der Spieler Stammspieler wäre
    const target = candidates.sort((a, b) => Math.abs(a.rating - (p.rating - 2)) - Math.abs(b.rating - (p.rating - 2)))[rng.int(0, Math.min(2, candidates.length - 1))];
    const share = Math.round(rng.range(0.5, 1) * 20) / 20;
    const withOption = rng.chance(0.35) && target.transfer_budget > p.value;
    removeFromTactic(me, p.id);
    await saveClubs(db, career.id, [me]);
    p.clubId = target.id;
    p.listed = false;
    p.loan = { parentClubId: clubId, untilSeason: career.season, wageShare: share, optionFee: withOption ? roundMoney(p.value * rng.range(1, 1.3)) : null, obligation: withOption && rng.chance(0.3) };
    await savePlayers(db, career.id, [p]);
    await query(db,
      `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, season, week, message)
       values ($1,$2,$3,$4,$5,0,$6,0,'loan_out','completed',$7,$8,$9)`,
      [career.id, p.id, `${p.firstName} ${p.lastName}`, clubId, target.id, Math.round((p.contract?.wage ?? 0) * share), career.season, career.week, `Verliehen an ${target.name}${optionText(p.loan)}`]);
    return { status: "completed", message: `${p.firstName} ${p.lastName} wird bis Saisonende an ${target.name} verliehen${optionText(p.loan)}. ${target.name} übernimmt ${Math.round(share * 100)} % des Gehalts.` };
  });
}
