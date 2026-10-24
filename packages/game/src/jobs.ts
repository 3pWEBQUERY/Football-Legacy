/**
 * Trainer-Stellenmarkt: Jeder Verein der Welt hat einen Trainer. Wer sportlich
 * hinterherhinkt, wackelt und wird irgendwann entlassen; freie Stellen werden
 * nach einigen Wochen neu besetzt. Der Spieler kann sich bewerben (auch
 * initiativ), Interesse an wackelnden Posten bekunden, Angebote annehmen und
 * jederzeit – auch während der Saison – den Verein wechseln oder zurücktreten.
 */
import type pg from "pg";
import { COUNTRY_BY_CODE, NAME_POOLS, Rng, coachName, hashString, seedFor } from "@fl/sim";
import { type Db, pool, query } from "./db";
import { GameError } from "./errors";
import { activateLeague, boardObjectives, readCareer, scheduleSeason, withCareer } from "./career";
import { addArticle } from "./media";
import { type CareerRow, type JobOffer, type LeagueRow, addInbox, getClub, getLeague, getLeagues, saveCareer } from "./repo";

export type JobStatus = "frei" | "unsicher" | "besetzt";

export interface Vacancy { clubId: number; since: number; reason: string; fillDay: number }
export interface Application {
  clubId: number; day: number; decideDay: number; status: "pending" | "rejected" | "offer" | "withdrawn"; text?: string; unsolicited: boolean;
}
export interface JobMarket {
  coaches: Record<string, { name: string; since: number }>;
  vacancies: Vacancy[];
  applications: Application[];
  interest: number[];
  contract: { clubId: number; wage: number; untilSeason: number } | null;
  warned: number | null;
  gen: number;
}

const MAX_APPLICATIONS = 5;
/** Unter dieser Jobsicherheit gilt ein Trainer als angezählt. */
const UNSAFE = 30;
const OFFER_DAYS = 10;

/** Fortlaufender Tag über Saisons hinweg (zum Vergleichen von Fristen). */
export const absDay = (c: { season: number; day: number }) => c.season * 1000 + c.day;

function fresh(): JobMarket {
  return { coaches: {}, vacancies: [], applications: [], interest: [], contract: null, warned: null, gen: 0 };
}

export async function getMarket(db: Db, careerId: string): Promise<JobMarket> {
  const rows = await query<{ jobs: JobMarket | null }>(db, "select jobs from careers where id = $1", [careerId]);
  return { ...fresh(), ...(rows[0]?.jobs ?? {}) };
}

async function saveMarket(db: Db, careerId: string, m: JobMarket) {
  // Historie knapp halten
  const open = m.applications.filter((a) => a.status === "pending");
  m.applications = [...m.applications.filter((a) => a.status !== "pending").slice(-30), ...open];
  await query(db, "update careers set jobs = $2 where id = $1", [careerId, JSON.stringify(m)]);
}

// ------------------------------------------------------------ Bewertung

interface LiteClub { id: number; name: string; short_name: string; city: string; colors: { primary: string; secondary: string }; reputation: number; rating: number; league_id: number; country_code: string; capacity: number }

async function liteClubs(db: Db, careerId: string, where = "true", params: unknown[] = []): Promise<LiteClub[]> {
  return query<LiteClub>(db, `select id, name, short_name, city, colors, reputation, rating, league_id, country_code, capacity from clubs where career_id = $1 and (${where})`, [careerId, ...params]);
}

interface Standing { p: number; pts: number; gd: number }

async function standings(db: Db, career: CareerRow): Promise<Map<number, Standing>> {
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
function assess(career: CareerRow, clubs: LiteClub[], leagues: Map<number, LeagueRow>, table: Map<number, Standing>): Map<number, Assessed> {
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

function expectationText(expected: number, league: LeagueRow): string {
  if (expected <= 2 && league.tier === 1) return expected === 1 ? "Meisterschaft" : "Titelkampf";
  if (league.promotion > 0 && expected <= league.promotion + 1) return "Aufstieg";
  if (expected <= Math.ceil(league.size * 0.35)) return "Obere Tabellenhälfte";
  if (expected > league.size - league.relegation - 2) return "Klassenerhalt";
  return "Gesichertes Mittelfeld";
}

function wageFor(club: { reputation: number }, league: LeagueRow): number {
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

async function vacate(db: Db, career: CareerRow, m: JobMarket, club: LiteClub, reason: string, rng: Rng, announce = true) {
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

function fill(career: CareerRow, m: JobMarket, club: LiteClub) {
  m.gen++;
  const name = newCoachName(career, club.id, club.country_code, m.gen);
  m.coaches[club.id] = { name, since: absDay(career) };
  m.vacancies = m.vacancies.filter((v) => v.clubId !== club.id);
  return name;
}

async function resolveApplications(db: Db, career: CareerRow, m: JobMarket, assessed: Map<number, Assessed> | null, rng: Rng) {
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

function addOffer(career: CareerRow, offer: JobOffer) {
  career.job_offers = [...career.job_offers.filter((o) => o.clubId !== offer.clubId), offer];
}

function pruneOffers(career: CareerRow) {
  const now = absDay(career);
  career.job_offers = career.job_offers.filter((o) => (o.expiresDay ?? (o.expires + 1) * 1000) > now && o.clubId !== career.club_id);
}

/** Täglich: Bewerbungen beantworten, freie Stellen neu besetzen, Angebote verfallen lassen. */
export async function jobsDaily(db: pg.PoolClient, career: CareerRow): Promise<string[]> {
  const m = await getMarket(db, career.id);
  const rng = new Rng(seedFor(career.seed, "jobs-day", career.season, career.day));
  const now = absDay(career);
  const events: string[] = [];
  const before = career.job_offers.length;
  await resolveApplications(db, career, m, null, rng);
  if (career.job_offers.length > before) events.push("Neues Jobangebot");
  const due = m.vacancies.filter((v) => v.fillDay <= now && v.clubId !== career.club_id);
  if (due.length) {
    const clubs = await liteClubs(db, career.id, "id = any($2::int[])", [due.map((v) => v.clubId)]);
    for (const club of clubs) {
      // Liegt dir ein Angebot dieses Vereins vor, wartet er noch auf deine Antwort
      if (career.job_offers.some((o) => o.clubId === club.id)) continue;
      const name = fill(career, m, club);
      for (const a of m.applications.filter((x) => x.clubId === club.id && x.status === "pending")) {
        a.status = "rejected";
        a.text = `Der Verein hat ${name} verpflichtet.`;
        await addInbox(db, career.id, career.season, career.week, "career", `Absage von ${club.name}`, `${club.name} hat sich für ${name} als neuen Trainer entschieden.`, { type: "jobs" });
      }
      if (club.reputation >= 55 || m.interest.includes(club.id)) {
        await addArticle(db, career, { kind: "league", title: `${name} übernimmt ${club.name}`, body: `${club.name} hat einen neuen Trainer: ${name} unterschreibt und soll den Verein wieder in die Spur bringen.`, clubId: club.id, own: false, importance: 1 });
      }
    }
  }
  // Weltweit gibt es immer eine Handvoll freier Posten (Rücktritte, Wechsel, Ruhestand)
  if (m.vacancies.length < 18) {
    const taken = new Set([...m.vacancies.map((v) => v.clubId), career.club_id]);
    const pool_ = (await liteClubs(db, career.id)).filter((c) => !taken.has(c.id));
    for (let i = 0; i < 2 && pool_.length; i++) {
      const c = pool_.splice(rng.int(0, pool_.length - 1), 1)[0];
      await vacate(db, career, m, c, rng.pick(["Rücktritt", "Wechsel ins Ausland", "Ruhestand", "Vertrag aufgelöst"]), rng, c.reputation >= 65);
    }
  }
  pruneOffers(career);
  await saveMarket(db, career.id, m);
  return events;
}

/** Wöchentlich: Entlassungen in aller Welt, Angebote an dich, eigener Stuhl. */
export async function jobsWeek(db: pg.PoolClient, career: CareerRow): Promise<void> {
  const m = await getMarket(db, career.id);
  const rng = new Rng(seedFor(career.seed, "jobs-week", career.season, career.week));
  const clubs = await liteClubs(db, career.id);
  const leagues = new Map((await getLeagues(db, career.id)).map((l) => [l.id, l]));
  const assessed = assess(career, clubs, leagues, await standings(db, career));
  const vacant = new Set(m.vacancies.map((v) => v.clubId));

  // Entlassungen: wer deutlich hinter den Erwartungen liegt, fliegt irgendwann
  if (career.week >= 6) {
    const hot = [...assessed.values()].filter((a) => a.security < 25 && a.club.id !== career.club_id && !vacant.has(a.club.id) && (a.position ?? 0) > 0);
    let sacked = 0;
    for (const a of rng.shuffle(hot)) {
      if (sacked >= 5) break;
      if (rng.chance(((25 - a.security) / 25) * 0.05)) {
        await vacate(db, career, m, a.club, "entlassen", rng);
        sacked++;
      }
    }
  }

  // Angebote an dich: Vereine mit freier Stelle, die zu deinem Ansehen passen
  pruneOffers(career);
  const rep = career.manager.reputation;
  const ownRep = career.club_id ? assessed.get(career.club_id)?.club.reputation ?? 0 : 0;
  if (career.job_offers.length < 3) {
    for (const v of rng.shuffle([...m.vacancies])) {
      const a = assessed.get(v.clubId);
      if (!a || v.clubId === career.club_id || career.job_offers.some((o) => o.clubId === v.clubId)) continue;
      const fits = a.club.reputation <= rep + 6 && a.club.reputation >= rep - 22 && (!career.club_id || a.club.reputation >= ownRep - 2);
      if (!fits || !rng.chance(career.club_id ? 0.07 : 0.22)) continue;
      addOffer(career, makeOffer(career, a.club, a.league, a.expected, "angebot"));
      await addInbox(db, career.id, career.season, career.week, "career", `Anfrage von ${a.club.name}`,
        `${a.club.name} (${a.league.name}) sucht einen neuen Trainer und hat sich bei dir gemeldet. Der Vorstand traut dir den Job zu.\n\n` +
        `Erwartung: ${expectationText(a.expected, a.league)}\n\nDas Angebot gilt ${OFFER_DAYS} Tage – Details unter Karriere → Freie Stellen.`,
        { type: "jobs" });
      if (career.job_offers.length >= 3) break;
    }
  }

  // Eigener Stuhl: Warnung und Entlassung während der Saison
  if (career.club_id && career.status === "active" && career.week >= 8 && career.week < career.season_weeks) {
    const conf = career.board.confidence;
    if (conf < 12) {
      await dismissUser(db, career, m, "Der Vorstand hat das Vertrauen verloren und dich mit sofortiger Wirkung freigestellt.");
    } else if (conf < 25 && m.warned !== career.season) {
      m.warned = career.season;
      await addInbox(db, career.id, career.season, career.week, "board", "Ultimatum des Vorstands",
        `Die Ergebnisse reichen nicht. Das Vertrauen des Vorstands liegt bei ${conf}/100 – wenn sich nicht schnell etwas ändert, bist du deinen Job los.`);
    }
  }
  await saveMarket(db, career.id, m);
}

/** Saisonwechsel: Trainerkarussell im Sommer, Entlassung des Spielers vollziehen. */
export async function jobsSeasonEnd(db: pg.PoolClient, career: CareerRow, dismissed: boolean, oldClubId: number | null) {
  const m = await getMarket(db, career.id);
  const rng = new Rng(seedFor(career.seed, "jobs-season", career.season));
  const clubs = await liteClubs(db, career.id);
  const vacant = new Set(m.vacancies.map((v) => v.clubId));
  let changes = 0;
  for (const c of rng.shuffle(clubs)) {
    if (c.id === career.club_id || c.id === oldClubId || vacant.has(c.id)) continue;
    if (rng.chance(0.035)) {
      await vacate(db, career, m, c, rng.pick(["Vertrag nicht verlängert", "Rücktritt", "Ruhestand", "Wechsel ins Ausland"]), rng, c.reputation >= 60);
      changes++;
    }
    if (changes >= 90) break;
  }
  if (m.contract && m.contract.untilSeason < career.season && career.club_id && !dismissed) {
    // Auslaufender Vertrag wird bei ordentlicher Arbeit automatisch verlängert
    m.contract.untilSeason = career.season + 1 + (career.board.confidence >= 60 ? 1 : 0);
    await addInbox(db, career.id, career.season, 0, "career", "Vertrag verlängert", `Der Vorstand hat deinen Vertrag bis Sommer ${m.contract.untilSeason + 1} verlängert.`);
  }
  // Angebote vom Saisonende: Frist, Gehalt und Erwartung ergänzen
  const leagues = new Map((await getLeagues(db, career.id)).map((l) => [l.id, l]));
  career.job_offers = career.job_offers.map((o) => {
    const c = clubs.find((x) => x.id === o.clubId);
    const league = c ? leagues.get(c.league_id) : undefined;
    if (!c || !league || o.wage) return o;
    const expected = clubs.filter((x) => x.league_id === c.league_id).sort((x, y) => y.rating - x.rating).findIndex((x) => x.id === c.id) + 1;
    return { ...makeOffer(career, c, league, expected, "angebot"), expiresDay: absDay(career) + 30 };
  });
  if (dismissed && oldClubId) {
    const old = clubs.find((c) => c.id === oldClubId);
    career.club_id = null;
    career.status = "unemployed";
    m.contract = null;
    if (old) await vacate(db, career, m, old, "entlassen", rng, false);
  }
  await saveMarket(db, career.id, m);
}

async function dismissUser(db: pg.PoolClient, career: CareerRow, m: JobMarket, text: string) {
  const old = career.club_id ? (await liteClubs(db, career.id, "id = $2", [career.club_id]))[0] : null;
  career.club_id = null;
  career.status = "unemployed";
  career.pending_match = null;
  m.contract = null;
  m.applications.forEach((a) => { if (a.status === "pending") a.status = "withdrawn"; });
  career.manager.reputation = Math.max(1, career.manager.reputation - 3);
  const rng = new Rng(seedFor(career.seed, "dismiss", career.season, career.day));
  if (old) {
    await vacate(db, career, m, old, "entlassen", rng, false);
    await addArticle(db, career, { kind: "league", title: `${old.name} entlässt ${career.manager_name}`, body: `${text} ${old.name} sucht nun einen Nachfolger.`, clubId: old.id, own: true, importance: 3 });
  }
  await query(db, "update transfers set status = 'expired' where career_id = $1 and status = 'pending'", [career.id]);
  await addInbox(db, career.id, career.season, career.week, "board", `Entlassen${old ? ` bei ${old.name}` : ""}`,
    `${text}\n\nUnter Karriere → Freie Stellen findest du offene Trainerposten in aller Welt. Bewirb dich oder warte auf Anfragen – die Zeit läuft weiter, auch ohne Verein.`,
    { type: "jobs" });
}

// ------------------------------------------------------------ Aktionen

export async function applyForJob(careerId: string, accountId: string, clubId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const m = await getMarket(db, career.id);
    const club = (await liteClubs(db, career.id, "id = $2", [clubId]))[0];
    if (!club) throw new GameError("Verein nicht gefunden", 404);
    if (club.id === career.club_id) throw new GameError("Das ist dein eigener Verein.");
    if (career.job_offers.some((o) => o.clubId === club.id)) throw new GameError("Von diesem Verein liegt dir bereits ein Angebot vor.");
    const open = m.applications.filter((a) => a.status === "pending");
    if (open.some((a) => a.clubId === club.id)) throw new GameError("Deine Bewerbung läuft bereits.");
    if (open.length >= MAX_APPLICATIONS) throw new GameError(`Du hast schon ${MAX_APPLICATIONS} offene Bewerbungen. Warte Antworten ab oder ziehe eine zurück.`);
    const now = absDay(career);
    const recent = m.applications.find((a) => a.clubId === club.id && a.status === "rejected" && now - a.day < 30);
    if (recent) throw new GameError("Der Verein hat dir gerade erst abgesagt. Versuche es in einigen Wochen erneut.");
    const vacant = m.vacancies.some((v) => v.clubId === club.id);
    const rng = new Rng(seedFor(career.seed, "apply", club.id, now));
    m.applications.push({ clubId: club.id, day: now, decideDay: now + (vacant ? rng.int(3, 7) : rng.int(4, 9)), status: "pending", unsolicited: !vacant });
    await saveMarket(db, career.id, m);
    const p = chanceLabel(hireChance(career.manager.reputation, club.reputation));
    return { message: `${vacant ? "Bewerbung" : "Initiativbewerbung"} an ${club.name} verschickt (Chance: ${p.label}). Die Antwort kommt in den nächsten Tagen.` };
  });
}

export async function withdrawApplication(careerId: string, accountId: string, clubId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const m = await getMarket(db, career.id);
    const a = m.applications.find((x) => x.clubId === clubId && x.status === "pending");
    if (!a) throw new GameError("Keine offene Bewerbung bei diesem Verein.");
    a.status = "withdrawn";
    await saveMarket(db, career.id, m);
    return { message: "Bewerbung zurückgezogen." };
  });
}

export async function toggleInterest(careerId: string, accountId: string, clubId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const m = await getMarket(db, career.id);
    const club = (await liteClubs(db, career.id, "id = $2", [clubId]))[0];
    if (!club || club.id === career.club_id) throw new GameError("Verein nicht gefunden", 404);
    const on = !m.interest.includes(club.id);
    m.interest = on ? [...m.interest, club.id].slice(-12) : m.interest.filter((x) => x !== club.id);
    await saveMarket(db, career.id, m);
    return { message: on ? `Interesse an ${club.name} hinterlegt. Wird die Stelle frei, bist du sofort im Gespräch.` : `Interesse an ${club.name} zurückgezogen.`, interest: on };
  });
}

export async function declineOffer(careerId: string, accountId: string, clubId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const o = career.job_offers.find((x) => x.clubId === clubId);
    if (!o) throw new GameError("Dieses Angebot gibt es nicht (mehr).");
    career.job_offers = career.job_offers.filter((x) => x.clubId !== clubId);
    await saveCareer(db, career);
    return { message: `Angebot von ${o.clubName} abgelehnt.` };
  });
}

/** Angebot annehmen: Vereinswechsel sofort, auch während der Saison. */
export async function acceptJob(careerId: string, accountId: string, clubId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    pruneOffers(career);
    const offer = career.job_offers.find((o) => o.clubId === clubId);
    if (!offer) throw new GameError("Dieses Angebot gibt es nicht (mehr).");
    if (career.pending_match) throw new GameError("Beende zuerst das laufende Spiel.");
    const club = await getClub(db, career.id, clubId);
    if (!club) throw new GameError("Verein nicht gefunden");
    const league = (await getLeague(db, career.id, club.league_id))!;
    const m = await getMarket(db, career.id);
    const rng = new Rng(seedFor(career.seed, "accept", clubId, absDay(career)));
    const oldId = career.club_id;
    const old = oldId ? (await liteClubs(db, career.id, "id = $2", [oldId]))[0] : null;
    if (!league.active) await activateLeague(db, career, league.id);
    const freshClub = (await getClub(db, career.id, clubId))!;
    career.club_id = clubId;
    career.status = "active";
    career.job_offers = [];
    if (career.week === 0) {
      // Saisonvorbereitung: Kalender (Spieltage und Pokal) für den neuen Verein planen
      await query(db, "delete from fixtures where career_id = $1 and season = $2", [career.id, career.season]);
      await query(db, "delete from cups where career_id = $1 and season = $2", [career.id, career.season]);
      await scheduleSeason(db, career);
    }
    career.board = await boardObjectives(db, career, freshClub, league);
    career.board.confidence = 60;
    // Anlagen und Trainerstab gehören zum Verein
    const level = Math.max(1, Math.min(5, Math.round(freshClub.reputation / 22)));
    career.facilities = { training: level, youth: level, projects: [], requests: {} } as never;
    await query(db, "update careers set staff_team = null where id = $1", [career.id]);
    await query(db, "update transfers set status = 'expired' where career_id = $1 and status = 'pending'", [career.id]);
    m.vacancies = m.vacancies.filter((v) => v.clubId !== clubId);
    m.applications.forEach((a) => { if (a.status === "pending") a.status = "withdrawn"; });
    m.interest = [];
    m.contract = { clubId, wage: offer.wage ?? wageFor(freshClub, league), untilSeason: career.season + (offer.years ?? 2) - 1 };
    m.warned = null;
    if (old) {
      // Abgeworben zu werden spricht für dich
      await vacate(db, career, m, old, "Trainer abgeworben", rng, false);
      career.manager.reputation = Math.min(100, career.manager.reputation + 1);
    }
    await saveMarket(db, career.id, m);
    await saveCareer(db, career);
    await addArticle(db, career, {
      kind: "league", title: `${career.manager_name} ist neuer Trainer von ${freshClub.name}`,
      body: `${freshClub.name} präsentiert ${career.manager_name} als neuen Trainer${old ? ` – er kommt von ${old.name}` : ""}. Der Vertrag läuft bis Sommer ${m.contract.untilSeason + 1}. Ziel: ${career.board.objective}`,
      clubId: freshClub.id, own: true, importance: 3,
    });
    await addInbox(db, career.id, career.season, career.week, "board", `Neuer Job: ${freshClub.name}`,
      `Willkommen bei ${freshClub.name}! Der Vorstand freut sich auf die Zusammenarbeit.\n\nSaisonziel: ${career.board.objective}\nVertrag bis Sommer ${m.contract.untilSeason + 1}.\n\n` +
      "Stelle unter Team → Stab deinen Trainerstab zusammen und schau dir den neuen Kader an.");
    return { clubId, message: `Willkommen bei ${freshClub.name}!` };
  });
}

export async function resignJob(careerId: string, accountId: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) throw new GameError("Du hast keinen Verein.");
    if (career.pending_match) throw new GameError("Beende zuerst das laufende Spiel.");
    const m = await getMarket(db, career.id);
    const old = (await liteClubs(db, career.id, "id = $2", [career.club_id]))[0];
    const rng = new Rng(seedFor(career.seed, "resign", career.season, career.day));
    career.club_id = null;
    career.status = "unemployed";
    career.manager.reputation = Math.max(1, career.manager.reputation - 2);
    m.contract = null;
    await vacate(db, career, m, old, "Rücktritt", rng, false);
    await query(db, "update transfers set status = 'expired' where career_id = $1 and status = 'pending'", [career.id]);
    await saveMarket(db, career.id, m);
    await saveCareer(db, career);
    await addArticle(db, career, { kind: "league", title: `${career.manager_name} tritt bei ${old.name} zurück`, body: `Überraschung bei ${old.name}: ${career.manager_name} legt sein Amt nieder. Der Verein sucht einen Nachfolger.`, clubId: old.id, own: true, importance: 3 });
    await addInbox(db, career.id, career.season, career.week, "career", "Rücktritt", `Du bist bei ${old.name} zurückgetreten. Unter Karriere → Freie Stellen findest du offene Posten. Die Zeit läuft weiter, auch ohne Verein.`, { type: "jobs" });
    return { message: `Du bist bei ${old.name} zurückgetreten.` };
  });
}

// ------------------------------------------------------------ Ansicht

export interface JobFilter { status?: string; confed?: string; country?: string; tier?: number; q?: string; reachable?: boolean; page?: number }

export async function jobsView(careerId: string, accountId: string, f: JobFilter) {
  const career = await readCareer(careerId, accountId);
  const db = pool();
  const m = await getMarket(db, career.id);
  const clubs = await liteClubs(db, career.id);
  const leagues = new Map((await getLeagues(db, career.id)).map((l) => [l.id, l]));
  const assessed = assess(career, clubs, leagues, await standings(db, career));
  const vacancy = new Map(m.vacancies.map((v) => [v.clubId, v]));
  const now = absDay(career);
  const rep = career.manager.reputation;
  const pending = new Map(m.applications.filter((a) => a.status === "pending").map((a) => [a.clubId, a]));
  const offered = new Set(career.job_offers.map((o) => o.clubId));

  const rows = [...assessed.values()].filter((a) => a.club.id !== career.club_id).map((a) => {
    const v = vacancy.get(a.club.id);
    const status: JobStatus = v ? "frei" : a.security < UNSAFE ? "unsicher" : "besetzt";
    const p = hireChance(rep, a.club.reputation, m.interest.includes(a.club.id) ? 0.08 : 0) * (status === "besetzt" ? 0.15 : status === "unsicher" ? 0.5 : 1);
    return { a, status, v, p };
  });
  const counts = { frei: 0, unsicher: 0, besetzt: 0 };
  for (const r of rows) counts[r.status]++;
  const q = (f.q ?? "").trim().toLowerCase();
  const filtered = rows.filter((r) =>
    (!f.status || f.status === "alle" || r.status === f.status) &&
    (!f.confed || COUNTRY_BY_CODE[r.a.club.country_code]?.confed === f.confed) &&
    (!f.country || r.a.club.country_code === f.country) &&
    (!f.tier || r.a.league.tier === f.tier) &&
    (!f.reachable || r.p >= 0.1) &&
    (!q || r.a.club.name.toLowerCase().includes(q) || r.a.club.city.toLowerCase().includes(q)),
  );
  const order: Record<JobStatus, number> = { frei: 0, unsicher: 1, besetzt: 2 };
  filtered.sort((x, y) => order[x.status] - order[y.status] || y.a.club.reputation - x.a.club.reputation || x.a.club.name.localeCompare(y.a.club.name));
  const pageSize = 40;
  const page = Math.max(1, Math.min(Math.ceil(filtered.length / pageSize) || 1, Math.round(f.page ?? 1)));

  const own = career.club_id ? assessed.get(career.club_id) : undefined;
  const contract = m.contract && m.contract.clubId === career.club_id ? m.contract
    : own ? { clubId: own.club.id, wage: wageFor(own.club, own.league), untilSeason: career.season + 1 } : null;
  const clubName = new Map(clubs.map((c) => [c.id, c]));
  const countries = [...new Set(clubs.map((c) => c.country_code))].map((code) => ({ code, name: COUNTRY_BY_CODE[code]?.name ?? code, confed: COUNTRY_BY_CODE[code]?.confed ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  return {
    season: career.season, day: career.day,
    me: {
      name: career.manager_name, reputation: rep, status: career.status,
      club: own ? { id: own.club.id, name: own.club.name, colors: own.club.colors, league: own.league.name, position: own.position } : null,
      confidence: career.board.confidence, objective: career.board.objective, contract,
      interest: m.interest,
    },
    offers: career.job_offers.map((o) => {
      const c = clubName.get(o.clubId);
      return { ...o, colors: c?.colors ?? o.colors, daysLeft: Math.max(0, (o.expiresDay ?? now + 30) - now), city: c?.city };
    }),
    applications: m.applications.filter((a) => a.status !== "withdrawn").slice(-12).reverse().map((a) => {
      const c = clubName.get(a.clubId);
      return { clubId: a.clubId, club: c?.name ?? "?", colors: c?.colors, status: a.status, unsolicited: a.unsolicited, text: a.text ?? null, ago: now - a.day, decideIn: Math.max(0, a.decideDay - now) };
    }),
    counts,
    total: filtered.length, page, pages: Math.ceil(filtered.length / pageSize) || 1,
    rows: filtered.slice((page - 1) * pageSize, page * pageSize).map(({ a, status, v, p }) => ({
      clubId: a.club.id, name: a.club.name, city: a.club.city, colors: a.club.colors, countryCode: a.club.country_code,
      league: a.league.name, tier: a.league.tier, reputation: a.club.reputation, position: a.position, expected: a.expected,
      coach: v ? null : coachOf(m, a.club), status, security: a.security, vacantDays: v ? now - v.since : null, reason: v?.reason ?? null,
      chance: chanceLabel(p), expectation: expectationText(a.expected, a.league),
      applied: pending.has(a.club.id), offered: offered.has(a.club.id), interest: m.interest.includes(a.club.id),
    })),
    countries,
  };
}
