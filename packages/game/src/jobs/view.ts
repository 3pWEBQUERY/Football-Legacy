/** Stellenmarkt: Ansicht „Freie Stellen“ mit Filtern und Seiten. */
import { COUNTRY_BY_CODE } from "@fl/sim";
import { readCareer } from "../career";
import { pool } from "../db";
import { getLeagues } from "../repo";
import { UNSAFE, absDay, assess, chanceLabel, coachOf, expectationText, getMarket, hireChance, liteClubs, standings, wageFor, type JobStatus } from "./core";

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
