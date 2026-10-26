/** Stellenmarkt: Bewerben, Interesse bekunden, Angebote annehmen oder ablehnen, Rücktritt. */
import { Rng, seedFor } from "@fl/sim";
import { activateLeague, boardObjectives, scheduleSeason, withCareer } from "../career";
import { query } from "../db";
import { GameError } from "../errors";
import { addArticle } from "../media";
import { addInbox, getClub, getLeague, saveCareer } from "../repo";
import { MAX_APPLICATIONS, absDay, chanceLabel, getMarket, hireChance, liteClubs, pruneOffers, saveMarket, vacate, wageFor } from "./core";

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
    const visionHistory = career.board?.visionHistory ?? [];
    career.board = await boardObjectives(db, career, freshClub, league);
    career.board.confidence = 60;
    career.board.visionHistory = visionHistory;
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
