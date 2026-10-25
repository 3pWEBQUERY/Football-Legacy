/** Sichten: Spielersuche, Verträge und Finanzen. */
import { COUNTRIES, FINANCE_LABEL, Rng, flagEmoji, formatMoney, isUnlocked, seedFor, wageBill, type Player } from "@fl/sim";
import { staffUpgradeCost } from "../actions";
import { readCareer } from "../career";
import { pool, query } from "../db";
import { GameError } from "../errors";
import { getClub, getLeagues, getPlayers } from "../repo";
import { windowFor } from "../window";
import { careerSummary, clubSummary, knowledgeFor, loanedOut, playerView } from "./common";

// ---------------------------------------------------------------- Markt

export interface MarketFilter {
  q?: string;
  position?: string;
  minAge?: number;
  maxAge?: number;
  maxValue?: number;
  country?: string;
  freeOnly?: boolean;
  listedOnly?: boolean;
  shortlistOnly?: boolean;
  expiring?: boolean;
  maxWage?: number;
  sort?: "rating" | "value" | "age" | "potential" | "wage" | "contract";
  page?: number;
}

/** Halbe Sterne (0,5–5) relativ zur eigenen Stammelf: 3 Sterne ≈ Niveau der eigenen Startelf. */
const starsRel = (r: number, ref: number) => Math.max(0.5, Math.min(5, Math.round((3 + (r - ref) / 5) * 2) / 2));

export async function marketView(careerId: string, accountId: string, f: MarketFilter) {
  const career = await readCareer(careerId, accountId);
  const userClub = career.club_id ? await getClub(pool(), career.id, career.club_id) : null;
  const where: string[] = ["p.career_id = $1", "(p.club_id is distinct from $2)"];
  const params: unknown[] = [career.id, career.club_id ?? -1];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.position) add("p.position = ?", f.position);
  if (f.minAge) add("p.age >= ?", f.minAge);
  if (f.maxAge) add("p.age <= ?", f.maxAge);
  if (f.maxValue) add("p.value <= ?", f.maxValue);
  if (f.country) add("p.nationality = ?", f.country);
  if (f.freeOnly) where.push("p.club_id is null");
  if (f.listedOnly) where.push("p.listed");
  if (f.shortlistOnly) where.push(`p.id in (select player_id from shortlist where career_id = $1)`);
  if (f.expiring) add("coalesce((p.data->'contract'->>'untilSeason')::int, 0) <= ?", career.season);
  if (f.maxWage) add("coalesce((p.data->'contract'->>'wage')::int, 0) <= ?", f.maxWage);
  if (f.q) {
    params.push(`%${f.q}%`);
    where.push(`(p.data->>'lastName' ilike $${params.length} or p.data->>'firstName' ilike $${params.length})`);
  }
  const order = f.sort === "value" ? "p.value desc" : f.sort === "age" ? "p.age asc" : f.sort === "potential" ? "p.potential desc"
    : f.sort === "wage" ? "coalesce((p.data->'contract'->>'wage')::int, 0) desc" : f.sort === "contract" ? "coalesce((p.data->'contract'->>'untilSeason')::int, 0) asc, p.rating desc" : "p.rating desc";
  const page = Math.max(0, f.page ?? 0);
  const rows = await query<{ data: Player; club_id: number | null; club_name: string | null; club_colors: unknown; league_name: string | null; country_code: string | null }>(
    pool(),
    `select p.data, p.club_id, c.name as club_name, c.colors as club_colors, l.name as league_name, l.country_code
       from players p left join clubs c on c.id = p.club_id left join leagues l on l.id = c.league_id
      where ${where.join(" and ")}
      order by ${order} limit 51 offset ${page * 50}`,
    params,
  );
  const players = rows.map((r) => ({ ...r.data, clubId: r.club_id }));
  const k = await knowledgeFor(career, players, userClub?.league_id ?? null);
  const transfers = await query(pool(),
    "select * from transfers where career_id = $1 and season = $2 and kind in ('buy','offer_in') order by id desc limit 30", [career.id, career.season]);
  const negs = await query<{ player_id: number; stage: string; status: string }>(pool(),
    "select distinct on (player_id) player_id, stage, status from negotiations where career_id = $1 and player_id = any($2::int[]) order by player_id, id desc",
    [career.id, players.map((p) => p.id)]);
  const own = userClub ? (await getPlayers(pool(), career.id, [userClub.id])).map((p) => p.rating).sort((a, b) => b - a).slice(0, 11) : [];
  const ref = own.length ? own.reduce((a, b) => a + b, 0) / own.length : 60;
  const negOf = new Map(negs.filter((n) => n.stage === "club" || n.stage === "contract").map((n) => [n.player_id, n]));
  return {
    career: careerSummary(career),
    club: userClub ? { ...clubSummary(userClub), balance: userClub.balance, transferBudget: userClub.transfer_budget } : null,
    window: windowFor(career),
    players: rows.slice(0, 50).map((r, i) => ({
      ...playerView(players[i], k.of(players[i])),
      clubName: r.club_name, kit: r.club_colors ?? null, leagueName: r.league_name, leagueCountry: r.country_code, shortlisted: k.shortlisted.has(players[i].id),
      negotiation: negOf.get(players[i].id) ?? null,
      stars: k.of(players[i]) === "exact"
        ? { current: starsRel(players[i].rating, ref), potential: starsRel(players[i].potential, ref), exact: true }
        : { current: starsRel(players[i].rating + Math.round(new Rng(seedFor("star-noise", players[i].id)).normal(0, 2)), ref), potential: null, exact: false },
    })),
    hasMore: rows.length > 50,
    page,
    transfers,
    scoutingNetwork: isUnlocked(career.manager, "scouting_network"),
    activeCountries: [...new Set((await getLeagues(pool(), career.id)).filter((l) => l.active).map((l) => l.country_code))],
    countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name, flag: flagEmoji(c.code), strength: c.strength })),
  };
}

export async function contractsView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Kein Verein");
  const players = await getPlayers(pool(), career.id, [career.club_id]);
  const club = await getClub(pool(), career.id, career.club_id);
  return {
    career: careerSummary(career),
    kit: club?.colors ?? null,
    players: players.sort((a, b) => (a.contract?.untilSeason ?? 0) - (b.contract?.untilSeason ?? 0) || b.rating - a.rating).map((p) => playerView(p, "exact")),
  };
}

export async function financeView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Kein Verein");
  const club = (await getClub(pool(), career.id, career.club_id))!;
  const byKind = await query<{ kind: string; amount: number }>(pool(),
    "select kind, sum(amount)::bigint as amount from finance_log where career_id = $1 and club_id = $2 and season = $3 group by kind order by kind", [career.id, club.id, career.season]);
  const byWeek = await query<{ week: number; amount: number }>(pool(),
    "select week, sum(amount)::bigint as amount from finance_log where career_id = $1 and club_id = $2 and season = $3 group by week order by week", [career.id, club.id, career.season]);
  const recent = await query(pool(),
    "select week, kind, amount, label from finance_log where career_id = $1 and club_id = $2 order by id desc limit 40", [career.id, club.id]);
  const players = await getPlayers(pool(), career.id, [club.id]);
  const wages = wageBill(players, await loanedOut(career.id, club.id));
  // Kontostandsverlauf rückwärts rekonstruieren
  let running = club.balance;
  const balanceSeries: { week: number; balance: number }[] = [];
  for (const w of [...byWeek].reverse()) {
    balanceSeries.unshift({ week: w.week, balance: running });
    running -= w.amount;
  }
  balanceSeries.unshift({ week: 0, balance: running });
  return {
    career: careerSummary(career),
    club: { ...clubSummary(club), balance: club.balance, transferBudget: club.transfer_budget, wageBudget: club.wage_budget },
    profile: club.finance,
    wages,
    byKind: byKind.map((r) => ({ ...r, label: FINANCE_LABEL[r.kind as keyof typeof FINANCE_LABEL] ?? r.kind })),
    balanceSeries,
    recent,
    board: career.board,
    staff: career.staff,
    staffCosts: Object.fromEntries(Object.entries(career.staff).map(([k, v]) => [k, v >= 20 ? null : staffUpgradeCost(v + 1)])),
    training: career.training,
    formatted: { balance: formatMoney(club.balance) },
  };
}
