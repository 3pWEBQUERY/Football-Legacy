/** Stellenmarkt: täglicher und wöchentlicher Ablauf, Saisonende, Entlassung des Spielers. */
import { Rng, seedFor } from "@fl/sim";
import type pg from "pg";
import { query } from "../db";
import { addArticle } from "../media";
import { addInbox, getLeagues, type CareerRow } from "../repo";
import { OFFER_DAYS, absDay, addOffer, assess, expectationText, fill, getMarket, liteClubs, makeOffer, pruneOffers, resolveApplications, saveMarket, standings, vacate, type JobMarket } from "./core";

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
