/** Stellenmarkt: Datenmodell, Bewertung der Trainerposten, Entlassungen, Neubesetzungen und Bewerbungen. */
import { COUNTRY_BY_CODE, NAME_POOLS, Rng, coachName, hashString, seedFor } from "@fl/sim";
import { query, type Db } from "../db";
import { addArticle } from "../media";
import { addInbox, getLeagues, type CareerRow, type JobOffer, type LeagueRow } from "../repo";

export type JobStatus = "frei" | "unsicher" | "besetzt";

export interface Vacancy { clubId: number; since: number; reason: string; fillDay: number }
export interface Application {
  clubId: number; day: number; decideDay: number; status: "pending" | "rejected" | "offer" | "withdrawn"; text?: string; unsolicited: boolean;
}
export interface JobMarket {
  coaches: Record<string, { name: string; since: number; preset?: string; formation?: string }>;
  vacancies: Vacancy[];
  applications: Application[];
  interest: number[];
  contract: { clubId: number; wage: number; untilSeason: number } | null;
  warned: number | null;
  gen: number;
}

export const MAX_APPLICATIONS = 5;
/** Unter dieser Jobsicherheit gilt ein Trainer als angezählt. */
export const UNSAFE = 30;
export const OFFER_DAYS = 10;

/** Fortlaufender Tag über Saisons hinweg (zum Vergleichen von Fristen). */
export const absDay = (c: { season: number; day: number }) => c.season * 1000 + c.day;

function fresh(): JobMarket {
  return { coaches: {}, vacancies: [], applications: [], interest: [], contract: null, warned: null, gen: 0 };
}

export async function getMarket(db: Db, careerId: string): Promise<JobMarket> {
  const rows = await query<{ jobs: JobMarket | null }>(db, "select jobs from careers where id = $1", [careerId]);
  return { ...fresh(), ...(rows[0]?.jobs ?? {}) };
}

export async function saveMarket(db: Db, careerId: string, m: JobMarket) {
  // Historie knapp halten
  const open = m.applications.filter((a) => a.status === "pending");
  m.applications = [...m.applications.filter((a) => a.status !== "pending").slice(-30), ...open];
  await query(db, "update careers set jobs = $2 where id = $1", [careerId, JSON.stringify(m)]);
}

// ------------------------------------------------------------ Bewertung

interface LiteClub { id: number; name: string; short_name: string; city: string; colors: { primary: string; secondary: string }; reputation: number; rating: number; league_id: number; country_code: string; capacity: number }

export async function liteClubs(db: Db, careerId: string, where = "true", params: unknown[] = []): Promise<LiteClub[]> {
  return query<LiteClub>(db, `select id, name, short_name, city, colors, reputation, rating, league_id, country_code, capacity from clubs where career_id = $1 and (${where})`, [careerId, ...params]);
}

interface Standing { p: number; pts: number; gd: number }

export async function standings(db: Db, career: CareerRow): Promise<Map<number, Standing>> {
  const rows = await query<{ club: number; p: number; pts: number; gd: number }>(
    db,
    `select club, count(*)::int as p, sum(pts)::int as pts, sum(gd)::int as gd from (
       select home_id as club, case when home_goals > away_goals then 3 when home_goals = away_goals then 1 else 0 end as pts, home_goals - away_goals as gd
         from fixtures where career_id = $1 and season = $2 and played and cup_id is null
       union all
       select away_id, case when away_goals > home_goals then 3 when home_goals = away_goals then 1 else 0 end, away_goals - home_goals
         from fixtures where career_id = $1 and season = $2 and played and cup_id is null
     ) x group by club`,
    [career.id, career.season],
  );
  return new Map(rows.map((r) => [r.club, { p: r.p, pts: r.pts, gd: r.gd }]));
}

interface Assessed { club: LiteClub; league: LeagueRow; position: number | null; expected: number; security: number }

/** Jobsicherheit aller Trainer (0 = vor dem Aus, 100 = unantastbar). */
export function assess(career: CareerRow, clubs: LiteClub[], leagues: Map<number, LeagueRow>, table: Map<number, Standing>): Map<number, Assessed> {
  const byLeague = new Map<number, LiteClub[]>();
  for (const c of clubs) byLeague.set(c.league_id, [...(byLeague.get(c.league_id) ?? []), c]);
  const out = new Map<number, Assessed>();
  const phase = Math.floor(career.week / 4);
  for (const [leagueId, list] of byLeague) {
    const league = leagues.get(leagueId);
    if (!league) continue;
    const expectedOrder = [...list].sort((a, b) => b.rating - a.rating || b.reputation - a.reputation);
    const actual = [...list].sort((a, b) => {
      const x = table.get(a.id) ?? { p: 0, pts: 0, gd: 0 };
      const y = table.get(b.id) ?? { p: 0, pts: 0, gd: 0 };
      return y.pts - x.pts || y.gd - x.gd || b.reputation - a.reputation;
    });
    const ambitionOrder = [...list].sort((a, b) => b.reputation - a.reputation || b.rating - a.rating);
    const size = list.length;
    for (const c of list) {
      const expected = expectedOrder.indexOf(c) + 1;
      const st = table.get(c.id);
      const played = st?.p ?? 0;
      const position = played > 0 ? actual.indexOf(c) + 1 : null;
      // Etwas Rauschen: Vorstände ticken unterschiedlich
      const h = hashString(`sec|${career.seed}|${c.id}|${career.season}|${phase}`);
      const noise = (h % 17) - 8;
      // Vor der Saison: Druck entsteht, wenn der Kader hinter den Ansprüchen des Vereins zurückbleibt
      const gap = (expected - (ambitionOrder.indexOf(c) + 1)) / size;
      const preseason = 72 - gap * 120 + ((h >> 5) % 21) - 10;
      let security = preseason;
      if (played > 0 && position !== null) {
        const perf = (expected - position) / size;
        const expectedPpg = 1.35 + ((size / 2 - expected) / size) * 1.3;
        const ppg = st!.pts / played;
        const form = 64 + perf * 110 + (ppg - expectedPpg) * 22 + noise;
        // Je mehr gespielt ist, desto mehr zählt die Tabelle
        const weight = Math.min(1, played / 8);
        security = preseason * (1 - weight) + form * weight;
      }
      out.set(c.id, { club: c, league, position, expected, security: Math.max(0, Math.min(100, Math.round(security))) });
    }
  }
  return out;
}

/** Wahrscheinlichkeit, dass ein Verein dich will (0–1). */
export function hireChance(managerRep: number, clubRep: number, bonus = 0): number {
  const p = 1 / (1 + Math.exp(-(managerRep - clubRep + 12) / 7));
  return Math.max(0.01, Math.min(0.97, p + bonus));
}

export function chanceLabel(p: number): { label: string; tone: "pos" | "warn" | "neg" | "neutral" } {
  if (p >= 0.6) return { label: "Hoch", tone: "pos" };
  if (p >= 0.3) return { label: "Mittel", tone: "warn" };
  if (p >= 0.1) return { label: "Gering", tone: "neg" };
  return { label: "Kaum", tone: "neutral" };
}

export function expectationText(expected: number, league: LeagueRow): string {
  if (expected <= 2 && league.tier === 1) return expected === 1 ? "Meisterschaft" : "Titelkampf";
  if (league.promotion > 0 && expected <= league.promotion + 1) return "Aufstieg";
  if (expected <= Math.ceil(league.size * 0.35)) return "Obere Tabellenhälfte";
  if (expected > league.size - league.relegation - 2) return "Klassenerhalt";
  return "Gesichertes Mittelfeld";
}

export function wageFor(club: { reputation: number }, league: LeagueRow): number {
  const tier = [1, 0.55, 0.32, 0.2, 0.14][league.tier - 1] ?? 0.12;
  const strength = (COUNTRY_BY_CODE[league.country_code]?.strength ?? 5) / 10;
  return Math.round(((club.reputation ** 2) * 650 + 45_000) * tier * (0.5 + strength * 0.6) / 5_000) * 5_000;
}

function newCoachName(career: CareerRow, clubId: number, countryCode: string, gen: number) {
  const names = NAME_POOLS[COUNTRY_BY_CODE[countryCode]?.region ?? "en"] ?? NAME_POOLS.en;
  const rng = new Rng(seedFor(career.seed, "coach", clubId, gen));
  return `${rng.pick(names.first)} ${rng.pick(names.last)}`;
}

export function coachOf(m: JobMarket, club: { id: number; country_code: string }): string {
  return m.coaches[club.id]?.name ?? coachName(club.id, club.country_code);
}

export function makeOffer(career: CareerRow, club: LiteClub | { id: number; name: string; reputation: number; country_code: string; colors?: { primary: string; secondary: string } }, league: LeagueRow, expected: number, kind: "angebot" | "bewerbung"): JobOffer {
  const rng = new Rng(seedFor(career.seed, "offer", club.id, career.season, career.day));
  return {
    clubId: club.id, clubName: club.name, leagueName: league.name, countryCode: club.country_code, reputation: club.reputation,
    expires: career.season + 1, expiresDay: absDay(career) + OFFER_DAYS, kind, wage: wageFor(club, league), years: rng.int(1, 3),
    expectation: expectationText(expected, league), tier: league.tier, colors: "colors" in club ? club.colors : undefined,
  };
}

// ------------------------------------------------------------ Ereignisse

export async function vacate(db: Db, career: CareerRow, m: JobMarket, club: LiteClub, reason: string, rng: Rng, announce = true) {
  if (m.vacancies.some((v) => v.clubId === club.id)) return;
  const old = coachOf(m, club);
  const now = absDay(career);
  m.vacancies.push({ clubId: club.id, since: now, reason, fillDay: now + rng.int(14, 45) });
  if (announce) {
    await addArticle(db, career, {
      kind: "league", title: reason === "entlassen" ? `${club.name} trennt sich von ${old}` : `${club.name} sucht einen neuen Trainer`,
      body: reason === "entlassen"
        ? `Nach der sportlichen Talfahrt zieht ${club.name} die Reissleine: Trainer ${old} muss gehen. Der Verein sucht ab sofort einen Nachfolger.`
        : `Bei ${club.name} ist der Trainerposten frei (${reason}). Erste Namen werden bereits gehandelt.`,
      clubId: club.id, own: false, importance: club.reputation >= 70 ? 2 : 1,
    });
  }
  // Interesse bekundet? Dann landet deine Bewerbung automatisch auf dem Tisch
  if (m.interest.includes(club.id) && career.club_id !== club.id && !m.applications.some((a) => a.clubId === club.id && a.status === "pending")) {
    m.applications.push({ clubId: club.id, day: now, decideDay: now + rng.int(2, 5), status: "pending", unsolicited: false, text: "Interesse bekundet" });
    await addInbox(db, career.id, career.season, career.week, "career", `Stelle frei: ${club.name}`,
      `${club.name} hat sich von ${old} getrennt. Da du Interesse bekundet hattest, prüft der Vorstand jetzt deine Kandidatur. Eine Entscheidung fällt in den nächsten Tagen.`,
      { type: "jobs" });
  }
}

export function fill(career: CareerRow, m: JobMarket, club: LiteClub) {
  m.gen++;
  const name = newCoachName(career, club.id, club.country_code, m.gen);
  m.coaches[club.id] = { name, since: absDay(career) };
  m.vacancies = m.vacancies.filter((v) => v.clubId !== club.id);
  return name;
}

export async function resolveApplications(db: Db, career: CareerRow, m: JobMarket, assessed: Map<number, Assessed> | null, rng: Rng) {
  const now = absDay(career);
  const due = m.applications.filter((a) => a.status === "pending" && a.decideDay <= now);
  if (!due.length) return;
  const clubs = new Map((await liteClubs(db, career.id, "id = any($2::int[])", [due.map((a) => a.clubId)])).map((c) => [c.id, c]));
  const leagues = new Map((await getLeagues(db, career.id)).map((l) => [l.id, l]));
  for (const a of due) {
    const club = clubs.get(a.clubId);
    const league = club ? leagues.get(club.league_id) : undefined;
    if (!club || !league) { a.status = "withdrawn"; continue; }
    const vacant = m.vacancies.some((v) => v.clubId === club.id);
    const bonus = (m.interest.includes(club.id) ? 0.08 : 0) + (career.club_id ? 0 : 0.05);
    const p = hireChance(career.manager.reputation, club.reputation, bonus);
    const security = assessed?.get(club.id)?.security ?? 60;
    const peers = await liteClubs(db, career.id, "league_id = $2", [league.id]);
    const expected = [...peers].sort((x, y) => y.rating - x.rating).findIndex((c) => c.id === club.id) + 1;
    if (vacant && rng.chance(p)) {
      a.status = "offer";
      addOffer(career, makeOffer(career, club, league, expected, "bewerbung"));
      await addInbox(db, career.id, career.season, career.week, "career", `Jobangebot: ${club.name}`,
        `Das Gespräch mit dem Vorstand von ${club.name} verlief hervorragend. Der Verein bietet dir den Trainerposten an.\n\n` +
        `Liga: ${league.name}\nErwartung: ${expectationText(expected, league)}\n\nDas Angebot gilt ${OFFER_DAYS} Tage. Annehmen kannst du es unter Karriere → Freie Stellen.`,
        { type: "jobs" });
    } else if (!vacant && security < UNSAFE && rng.chance(p * 0.55)) {
      // Initiativbewerbung bei wackelndem Trainer: der Vorstand greift zu
      const old = coachOf(m, club);
      await vacate(db, career, m, club, "entlassen", rng);
      a.status = "offer";
      addOffer(career, makeOffer(career, club, league, expected, "bewerbung"));
      await addInbox(db, career.id, career.season, career.week, "career", `${club.name} will dich!`,
        `Deine Initiativbewerbung kam genau zur richtigen Zeit: ${club.name} trennt sich von ${old} und bietet dir den Posten an.\n\nDas Angebot gilt ${OFFER_DAYS} Tage.`,
        { type: "jobs" });
    } else {
      a.status = "rejected";
      const reason = vacant
        ? `Der Vorstand hat sich für einen anderen Kandidaten entschieden.${p < 0.3 ? " Für diesen Verein fehlt dir noch das nötige Ansehen." : ""}`
        : `Man sei mit Trainer ${coachOf(m, club)} zufrieden und plane keinen Wechsel.`;
      a.text = reason;
      await addInbox(db, career.id, career.season, career.week, "career", `Absage von ${club.name}`, `${club.name} hat auf deine Bewerbung geantwortet: ${reason}`, { type: "jobs" });
    }
  }
}

export function addOffer(career: CareerRow, offer: JobOffer) {
  career.job_offers = [...career.job_offers.filter((o) => o.clubId !== offer.clubId), offer];
}

export function pruneOffers(career: CareerRow) {
  const now = absDay(career);
  career.job_offers = career.job_offers.filter((o) => (o.expiresDay ?? (o.expires + 1) * 1000) > now && o.clubId !== career.club_id);
}
