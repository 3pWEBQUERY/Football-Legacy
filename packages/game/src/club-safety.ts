/**
 * Absicherung des eigenen Vereins:
 * - Mindestkader: Fällt der Kader unter MIN_SQUAD Spieler (oder unter zwei
 *   Torhüter), rücken Talente aus der Akademie auf, sonst werden Vereinslose
 *   für ein Jahr verpflichtet – auch ausserhalb des Transferfensters.
 * - Schulden: Im Minus gilt eine Transfersperre, es fallen Überziehungszinsen
 *   an und der Vorstand verliert Geduld. Unter dem Kreditrahmen verkauft der
 *   Vorstand im offenen Transferfenster den wertvollsten Spieler.
 */
import { Rng, formatMoney, seedFor, wageBill, wageDemand, type Player } from "@fl/sim";
import { query, type Db } from "./db";
import { type CareerRow, type ClubRow, addFinance, addInbox, getClub, getClubs, getPlayers, insertPlayers, saveClubs, savePlayers } from "./repo";
import { windowFor } from "./window";

export const MIN_SQUAD = 16;
const MIN_GK = 2;
/** Wöchentliche Überziehungszinsen (rund 8 % im Jahr). */
const WEEKLY_INTEREST = 0.0015;
/** Kreditrahmen: ein Fünftel der Jahresgehälter, mindestens 1 Mio. */
export const creditLimit = (weeklyWages: number) => Math.max(1_000_000, Math.round(weeklyWages * 52 * 0.2));
const FORCED_SALE_GAP = 30;

const name = (p: Player) => `${p.firstName} ${p.lastName}`;

/** Füllt den eigenen Kader auf, bis MIN_SQUAD Spieler und zwei Torhüter da sind. Liefert Meldungen. */
export async function ensureMinimumSquad(db: Db, career: CareerRow): Promise<string[]> {
  if (!career.club_id) return [];
  // Schnelle Zählung – nur wenn es eng wird, den ganzen Kader laden
  const [count] = await query<{ n: number; gk: number }>(db,
    "select count(*)::int as n, count(*) filter (where position = 'GK')::int as gk from players where career_id = $1 and club_id = $2", [career.id, career.club_id]);
  if (count && count.n >= MIN_SQUAD && count.gk >= MIN_GK) return [];
  const squad = await getPlayers(db, career.id, [career.club_id]);
  const gk = () => squad.filter((p) => p.position === "GK").length;
  if (squad.length >= MIN_SQUAD && gk() >= MIN_GK) return [];
  const club = (await getClub(db, career.id, career.club_id))!;
  const promoted: string[] = [];
  const signed: string[] = [];
  const need = (p: Player) => (gk() < MIN_GK ? p.position === "GK" : squad.length < MIN_SQUAD);

  // 1. Akademie: die stärksten Talente ab 16
  const academy = (await query<{ data: Player }>(db, "select data from academy where career_id = $1", [career.id]))
    .map((r) => r.data).filter((p) => p.age >= 16).sort((a, b) => b.rating - a.rating);
  for (const p of [...academy.filter((x) => x.position === "GK"), ...academy.filter((x) => x.position !== "GK")]) {
    if (!need(p)) continue;
    p.clubId = club.id;
    p.youth = true;
    p.joined = { season: career.season };
    p.contract = { wage: Math.max(300, Math.round(((p.rating - 25) * 45) / 100) * 100), untilSeason: career.season + 2, releaseClause: null, goalBonus: 0 };
    await insertPlayers(db, career.id, [p]);
    await query(db, "delete from academy where career_id = $1 and id = $2", [career.id, p.id]);
    squad.push(p);
    promoted.push(`${name(p)} (${p.position}, ${p.age})`);
  }

  // 2. Vereinslose für ein Jahr zum Mindestgehalt ihrer Forderung
  if (squad.length < MIN_SQUAD || gk() < MIN_GK) {
    const free = (await query<{ data: Player }>(db,
      "select data from players where career_id = $1 and club_id is null and age <= 33 order by rating desc limit 300", [career.id])).map((r) => r.data);
    // Passend zum Niveau des Vereins: nicht die Stars, sondern solide Ergänzungen
    const fits = free.filter((p) => p.rating <= club.rating + 2).sort((a, b) => b.rating - a.rating);
    const pool = fits.length ? fits : free.sort((a, b) => a.rating - b.rating);
    const signedPlayers: Player[] = [];
    for (const p of [...pool.filter((x) => x.position === "GK"), ...pool.filter((x) => x.position !== "GK")]) {
      if (!need(p)) continue;
      p.clubId = club.id;
      p.joined = { season: career.season };
      p.contract = { wage: wageDemand(p, club.reputation), untilSeason: career.season, releaseClause: null, goalBonus: 0 };
      p.morale = 65;
      squad.push(p);
      signedPlayers.push(p);
      signed.push(`${name(p)} (${p.position}, ${p.age}, ${formatMoney(p.contract.wage)}/Woche)`);
    }
    await savePlayers(db, career.id, signedPlayers);
    for (const p of signedPlayers) {
      await query(db,
        `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, message, season, week)
         values ($1,$2,$3,null,$4,0,$5,1,'free','completed','Notverpflichtung',$6,$7)`,
        [career.id, p.id, name(p), club.id, p.contract!.wage, career.season, career.week]);
    }
  }
  if (!promoted.length && !signed.length) return [];
  await addInbox(db, career.id, career.season, career.week, "board", "Notmassnahme: Kader aufgefüllt",
    `Der Kader war zu klein für den Spielbetrieb (mindestens ${MIN_SQUAD} Spieler und ${MIN_GK} Torhüter). Der Vorstand hat gehandelt:\n\n` +
      (promoted.length ? `Aus der Akademie hochgezogen:\n${promoted.map((x) => `• ${x}`).join("\n")}\n\n` : "") +
      (signed.length ? `Vereinslose für ein Jahr verpflichtet:\n${signed.map((x) => `• ${x}`).join("\n")}\n\n` : "") +
      "Verlängere wichtige Verträge rechtzeitig und verstärke den Kader im Transferfenster.",
    { type: "page", path: "/team", label: "Zum Kader" });
  return [`Kader aufgefüllt (${promoted.length + signed.length} Spieler)`];
}

/** Darf der eigene Verein gerade Ablöse oder neue Gehälter zahlen? */
export function transferBan(club: Pick<ClubRow, "balance">): string | null {
  return club.balance < 0
    ? `Transfersperre: Das Vereinskonto ist mit ${formatMoney(-club.balance)} im Minus. Erst wenn es wieder ausgeglichen ist, sind Neuzugänge möglich.`
    : null;
}

/** Wöchentlich: Zinsen, Transfersperre, Vorstand und – unter dem Kreditrahmen – Zwangsverkauf. */
export async function debtWeek(db: Db, career: CareerRow): Promise<string[]> {
  if (!career.club_id) return [];
  const club = (await getClub(db, career.id, career.club_id))!;
  const m = career.manager;
  if (club.balance >= 0) {
    if (m.debt) {
      m.debt = undefined;
      await addInbox(db, career.id, career.season, career.week, "finance", "Wieder schwarze Zahlen",
        "Das Vereinskonto ist ausgeglichen. Die Transfersperre ist aufgehoben.");
      return ["Transfersperre aufgehoben"];
    }
    return [];
  }
  const out: string[] = [];
  const squad = await getPlayers(db, career.id, [club.id]);
  const limit = creditLimit(wageBill(squad));
  const interest = Math.round(-club.balance * WEEKLY_INTEREST);
  club.balance -= interest;
  club.transfer_budget = 0;
  await addFinance(db, career.id, club.id, career.season, career.week, [{ kind: "other", amount: -interest, label: "Überziehungszinsen" }]);
  career.board.confidence = Math.max(0, career.board.confidence - (club.balance < -limit ? 2 : 0.5));
  if (!m.debt) {
    m.debt = { season: career.season, day: career.day };
    await addInbox(db, career.id, career.season, career.week, "finance", "Konto im Minus – Transfersperre",
      `Das Vereinskonto steht bei ${formatMoney(club.balance)}. Solange es im Minus ist:\n` +
        `• gilt eine Transfersperre (keine Ablösen, keine neuen Verträge),\n• fallen wöchentlich Überziehungszinsen an,\n• sinkt das Vertrauen des Vorstands.\n\n` +
        `Der Kreditrahmen liegt bei ${formatMoney(-limit)}. Fällt das Konto darunter, verkauft der Vorstand im nächsten Transferfenster deinen wertvollsten Spieler.\n` +
        "Abhilfe: Spieler verkaufen oder verleihen, Gehälter senken, Ticketpreise anpassen.",
      { type: "page", path: "/market/finances", label: "Zu den Finanzen" });
    out.push("Konto im Minus");
  }
  if (club.balance < -limit) {
    const last = m.debt.lastSale;
    const since = last ? (last.season === career.season ? career.day - last.day : 999) : 999;
    if (windowFor(career).open && since >= FORCED_SALE_GAP) {
      const sold = await forcedSale(db, career, club, squad);
      if (sold) {
        m.debt.lastSale = { season: career.season, day: career.day };
        out.push(sold);
      }
    }
  }
  await saveClubs(db, career.id, [club]);
  return out;
}

async function forcedSale(db: Db, career: CareerRow, club: ClubRow, squad: Player[]): Promise<string | null> {
  const gks = squad.filter((p) => p.position === "GK").length;
  const candidates = squad
    .filter((p) => !p.loan && p.value > 0 && !(p.position === "GK" && gks <= MIN_GK))
    .sort((a, b) => b.value - a.value);
  const p = candidates[0];
  if (!p || squad.length <= MIN_SQUAD) return null;
  const fee = Math.round((p.value * 0.85) / 50_000) * 50_000;
  const rng = new Rng(seedFor(career.seed, "forced-sale", career.season, career.day));
  const buyers = (await getClubs(db, career.id, "players_generated and id <> $2 and transfer_budget >= $3", [club.id, fee]))
    .filter((c) => Math.abs(c.rating - p.rating) <= 12);
  if (!buyers.length) return null;
  const buyer = rng.pick(buyers);
  club.balance += fee;
  buyer.balance -= fee;
  buyer.transfer_budget = Math.max(0, buyer.transfer_budget - fee);
  if (club.tactic) {
    club.tactic.lineup = club.tactic.lineup.map((x) => (x === p.id ? null : x));
    club.tactic.bench = club.tactic.bench.filter((x) => x !== p.id);
  }
  p.clubId = buyer.id;
  p.listed = false;
  p.squadStatus = null;
  p.joined = { season: career.season };
  await savePlayers(db, career.id, [p]);
  await saveClubs(db, career.id, [club, buyer]);
  await query(db,
    `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, message, season, week)
     values ($1,$2,$3,$4,$5,$6,$7,0,'forced','completed','Zwangsverkauf durch den Vorstand',$8,$9)`,
    [career.id, p.id, name(p), club.id, buyer.id, fee, p.contract?.wage ?? 0, career.season, career.week]);
  await addFinance(db, career.id, club.id, career.season, career.week, [{ kind: "transfer_in", amount: fee, label: `Zwangsverkauf ${name(p)}` }]);
  await addInbox(db, career.id, career.season, career.week, "board", `Zwangsverkauf: ${name(p)} geht zu ${buyer.name}`,
    `Das Vereinskonto lag unter dem Kreditrahmen. Um die Zahlungsfähigkeit zu sichern, hat der Vorstand ${name(p)} für ${formatMoney(fee)} an ${buyer.name} verkauft.\n\n` +
      "Weitere Verkäufe folgen, solange das Konto so tief im Minus bleibt.",
    { type: "page", path: "/market/finances", label: "Zu den Finanzen" });
  return `Zwangsverkauf: ${name(p)}`;
}
