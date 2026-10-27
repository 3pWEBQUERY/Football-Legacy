/**
 * Derbys und Rivalitäten: Vereine aus derselben Stadt bestreiten Stadtderbys,
 * dazu bekommt jeder Verein der beiden obersten Ligen einen Erzrivalen
 * (ähnlicher Ruf, gleiche Liga). Die Paare werden einmal je Karriere
 * festgelegt. Derbys sind lauter: volles Stadion, mehr Härte, stärkerer
 * Heimvorteil – und Fans und Vorstand reagieren doppelt so stark.
 */
import type { MatchSetup } from "@fl/sim";
import { query, type Db } from "./db";
import type { CareerRow } from "./repo";

export type RivalryKind = "derby" | "rival";
export const RIVALRY_LABEL: Record<RivalryKind, string> = { derby: "Stadtderby", rival: "Erzrivale" };

export type RivalryMap = Map<string, RivalryKind>;
const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Legt die Rivalitäten der Karriere an (einmalig). */
export async function ensureRivalries(db: Db, career: Pick<CareerRow, "id">) {
  const exists = await query(db, "select 1 from rivalries where career_id = $1 limit 1", [career.id]);
  if (exists.length) return;
  const clubs = await query<{ id: number; country_code: string; city: string; reputation: number; league_id: number; tier: number }>(db,
    `select c.id, c.country_code, c.city, c.reputation, c.league_id, l.tier from clubs c join leagues l on l.career_id = c.career_id and l.id = c.league_id where c.career_id = $1`,
    [career.id]);
  const pairs = new Map<string, { a: number; b: number; kind: RivalryKind }>();
  const add = (a: number, b: number, kind: RivalryKind) => { if (!pairs.has(key(a, b))) pairs.set(key(a, b), { a: Math.min(a, b), b: Math.max(a, b), kind }); };
  // Stadtderbys
  const byCity = new Map<string, typeof clubs>();
  for (const c of clubs) byCity.set(`${c.country_code}|${c.city.toLowerCase()}`, [...(byCity.get(`${c.country_code}|${c.city.toLowerCase()}`) ?? []), c]);
  for (const group of byCity.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) add(group[i].id, group[j].id, "derby");
  // Erzrivalen in den beiden obersten Ligen: nächster Ruf in derselben Liga, jeder höchstens einmal
  const hasRival = new Set<number>([...pairs.values()].flatMap((p) => [p.a, p.b]));
  const byLeague = new Map<number, typeof clubs>();
  for (const c of clubs.filter((x) => x.tier <= 2)) byLeague.set(c.league_id, [...(byLeague.get(c.league_id) ?? []), c]);
  for (const league of byLeague.values()) {
    const sorted = [...league].sort((a, b) => b.reputation - a.reputation);
    for (const c of sorted) {
      if (hasRival.has(c.id)) continue;
      const partner = sorted.filter((x) => x.id !== c.id && !hasRival.has(x.id))
        .sort((x, y) => Math.abs(x.reputation - c.reputation) - Math.abs(y.reputation - c.reputation))[0];
      if (!partner) continue;
      add(c.id, partner.id, "rival");
      hasRival.add(c.id);
      hasRival.add(partner.id);
    }
  }
  const rows = [...pairs.values()];
  if (!rows.length) return;
  await query(db,
    "insert into rivalries(career_id, club_a, club_b, kind) select $1, a, b, k from unnest($2::int[], $3::int[], $4::text[]) as t(a, b, k) on conflict do nothing",
    [career.id, rows.map((r) => r.a), rows.map((r) => r.b), rows.map((r) => r.kind)]);
}

export async function loadRivalries(db: Db, career: Pick<CareerRow, "id">): Promise<RivalryMap> {
  await ensureRivalries(db, career);
  const rows = await query<{ club_a: number; club_b: number; kind: RivalryKind }>(db, "select club_a, club_b, kind from rivalries where career_id = $1", [career.id]);
  return new Map(rows.map((r) => [key(r.club_a, r.club_b), r.kind]));
}

export const rivalryOf = (map: RivalryMap, a: number, b: number): RivalryKind | null => map.get(key(a, b)) ?? null;

export async function rivalryBetween(db: Db, career: Pick<CareerRow, "id">, a: number, b: number): Promise<RivalryKind | null> {
  await ensureRivalries(db, career);
  const r = await query<{ kind: RivalryKind }>(db, "select kind from rivalries where career_id = $1 and club_a = $2 and club_b = $3", [career.id, Math.min(a, b), Math.max(a, b)]);
  return r[0]?.kind ?? null;
}

/** Rivalen eines Vereins. */
export async function rivalsOf(db: Db, career: Pick<CareerRow, "id">, clubId: number) {
  await ensureRivalries(db, career);
  return query<{ id: number; name: string; kind: RivalryKind }>(db,
    `select c.id, c.name, r.kind from rivalries r join clubs c on c.career_id = r.career_id and c.id = case when r.club_a = $2 then r.club_b else r.club_a end
      where r.career_id = $1 and $2 in (r.club_a, r.club_b) order by r.kind, c.reputation desc`, [career.id, clubId]);
}

/** Derby-Atmosphäre in der Matchengine: mehr Härte auf beiden Seiten, stärkerer Heimvorteil. */
export function derbySetup(setup: MatchSetup, kind: RivalryKind | null): MatchSetup {
  if (!kind) return setup;
  const harder = (t: MatchSetup["home"]) => ({ ...t, tactic: { ...t.tactic, style: { ...t.tactic.style, hardness: Math.min(100, t.tactic.style.hardness + (kind === "derby" ? 15 : 10)) } } });
  return { ...setup, home: harder(setup.home), away: harder(setup.away), homeAdvantage: kind === "derby" ? 1.08 : 1.07 };
}

/** Derby-Bilanz (alle gespeicherten Pflichtspiele) aus Sicht von clubId. */
export async function derbyRecord(db: Db, career: Pick<CareerRow, "id">, clubId: number, oppId: number) {
  const rows = await query<{ w: number; d: number; l: number; gf: number; ga: number }>(db,
    `select count(*) filter (where (home_id = $2 and home_goals > away_goals) or (away_id = $2 and away_goals > home_goals))::int as w,
            count(*) filter (where home_goals = away_goals)::int as d,
            count(*) filter (where (home_id = $2 and home_goals < away_goals) or (away_id = $2 and away_goals < home_goals))::int as l,
            coalesce(sum(case when home_id = $2 then home_goals else away_goals end), 0)::int as gf,
            coalesce(sum(case when home_id = $2 then away_goals else home_goals end), 0)::int as ga
       from fixtures where career_id = $1 and played and ((home_id = $2 and away_id = $3) or (home_id = $3 and away_id = $2))`,
    [career.id, clubId, oppId]);
  return rows[0] ?? { w: 0, d: 0, l: 0, gf: 0, ga: 0 };
}
