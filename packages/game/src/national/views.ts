/** Nationaltrainer: Jobangebote, Übersicht, Kader nominieren und Spielberichte. */
import { COUNTRIES, FORMATIONS, STYLE_PRESETS, dateOf, type Formation } from "@fl/sim";
import { activateClubs, readCareer, withCareer } from "../career";
import { one, pool, query } from "../db";
import { GameError } from "../errors";
import { addArticle } from "../media";
import { addInbox, getClubs, getLeagues, saveCareer } from "../repo";
import { SQUAD_SIZE, autoSquad, createQualification, fmtDay, getNational, groupTable, nation, nationColors, nationPool, nationRating, objectiveFor, requiredReputation, saveNational, tournamentName, windowsOf, type NationalMatch, type NationalState } from "./core";

export async function nationalJobs(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const st = await getNational(pool(), career.id);
  const rep = Math.round(career.manager.reputation);
  const all = COUNTRIES.map((c) => ({ code: c.code, name: c.name, confed: c.confed, strength: c.strength, required: requiredReputation(c.code), rating: nationRating(c.code) }));
  // Die stärksten erreichbaren Posten, dazu die nächsten, die bald erreichbar sind, und das Heimatland
  const open = all.filter((c) => c.required <= rep).sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name)).slice(0, 20);
  const soon = all.filter((c) => c.required > rep).sort((a, b) => a.required - b.required || b.strength - a.strength).slice(0, 8);
  const home = all.find((c) => c.code === career.country_code);
  const list = [...new Map([...soon, ...open, ...(home ? [home] : [])].map((c) => [c.code, c])).values()]
    .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
  return {
    reputation: rep,
    current: st ? { code: st.code, name: nation(st.code).name } : null,
    jobs: list.map((c) => ({ ...c, colors: nationColors(c.code), available: career.manager.reputation >= c.required, home: c.code === career.country_code })),
  };
}

export async function takeNationalJob(careerId: string, accountId: string, code: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!nation(code)) throw new GameError("Unbekannte Nation");
    if (await getNational(db, career.id)) throw new GameError("Du betreust bereits eine Nationalmannschaft. Trete zuerst zurück.");
    if (career.manager.reputation < requiredReputation(code)) throw new GameError(`Für ${nation(code).name} brauchst du einen Manager-Ruf von mindestens ${requiredReputation(code)}.`);
    // Spieler der Nation verfügbar machen: oberste Liga des Landes simulieren
    const leagues = await getLeagues(db, career.id);
    const top = leagues.find((l) => l.country_code === code && l.tier === 1);
    if (top) {
      const clubs = await getClubs(db, career.id, "league_id = $2 and not players_generated", [top.id]);
      if (clubs.length) await activateClubs(db, career, clubs, new Map(leagues.map((l) => [l.id, l])));
    }
    const st: NationalState = {
      code, since: career.season, squad: [], starters: [], formation: "4-3-3", preset: "balanced",
      objective: objectiveFor(code), qualified: false, groupPos: null, record: { p: 0, w: 0, d: 0, l: 0 }, history: [],
    };
    st.squad = autoSquad(await nationPool(db, career, code));
    const qual = await createQualification(db, career, st);
    await saveNational(db, career.id, st);
    await addInbox(db, career.id, career.season, career.week, "international", `Neuer Job: Nationaltrainer von ${nation(code).name}`,
      `Der Verband von ${nation(code).name} stellt dich als Nationaltrainer vor. Ziel: ${st.objective.text}.\n\n` +
        (qual ? `Die Qualifikation zur ${tournamentName(career.season, code)} beginnt in der nächsten Länderspielpause.` : "In dieser Saison stehen nur noch Testspiele an; die Qualifikation beginnt nächste Saison."),
      { type: "national" });
    await addArticle(db, career, { kind: "league", title: `${career.manager_name} wird Nationaltrainer von ${nation(code).name}`, body: `Der Verband von ${nation(code).name} hat ${career.manager_name} verpflichtet. Ziel: ${st.objective.text}.`, own: true, importance: 3 });
    await saveCareer(db, career);
    return { message: `Du bist jetzt Nationaltrainer von ${nation(code).name}.` };
  });
}

export async function resignNationalJob(careerId: string, accountId: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    const st = await getNational(db, career.id);
    if (!st) throw new GameError("Du betreust keine Nationalmannschaft.");
    await query(db, "delete from national_teams where career_id = $1", [career.id]);
    await query(db, "delete from national_matches where career_id = $1 and not played", [career.id]);
    career.manager.reputation = Math.max(1, career.manager.reputation - 2);
    await saveCareer(db, career);
    await addInbox(db, career.id, career.season, career.week, "international", `Rücktritt als Nationaltrainer`, `Du hast dein Amt bei ${nation(st.code).name} niedergelegt.`);
    return { message: `Du bist als Nationaltrainer von ${nation(st.code).name} zurückgetreten.` };
  });
}

export async function nationalView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const st = await getNational(pool(), career.id);
  if (!st) return { coach: false as const, jobs: await nationalJobs(careerId, accountId) };
  const matches = await query<NationalMatch>(pool(), "select *, user_match as user from national_matches where career_id = $1 order by season desc, day desc, id desc limit 200", [career.id]);
  const season = matches.filter((m) => m.season === career.season);
  const qual = season.filter((m) => m.kind === "qual").sort((a, b) => a.day - b.day || a.id - b.id);
  const qualCodes = [...new Set(qual.flatMap((m) => [m.home, m.away]))];
  const windows = windowsOf(career);
  const nextWindow = windows.find(([, b]) => b >= career.day) ?? null;
  const fmt = (m: NationalMatch) => ({
    id: m.id, season: m.season, day: m.day, date: dateOf(m.season, m.day).toISOString().slice(0, 10), kind: m.kind, stage: m.stage,
    home: { code: m.home, name: nation(m.home)?.name ?? m.home, colors: nationColors(m.home) },
    away: { code: m.away, name: nation(m.away)?.name ?? m.away, colors: nationColors(m.away) },
    homeGoals: m.home_goals, awayGoals: m.away_goals, penHome: m.pen_home, penAway: m.pen_away, played: m.played, user: m.user, hasReport: !!m.data,
  });
  const lastTournament = matches.filter((m) => m.kind === "tournament");
  const tSeason = lastTournament[0]?.season ?? null;
  return {
    coach: true as const,
    career: { season: career.season, day: career.day },
    nation: { code: st.code, name: nation(st.code).name, confed: nation(st.code).confed, strength: nation(st.code).strength, colors: nationColors(st.code), rating: nationRating(st.code) },
    objective: st.objective,
    tournament: tournamentName(career.season, st.code),
    qualified: st.qualified,
    groupPos: st.groupPos,
    record: st.record,
    history: st.history,
    since: st.since,
    squadSize: st.squad.length,
    nextWindow: nextWindow ? { start: nextWindow[0], end: nextWindow[1], label: `${fmtDay(career.season, nextWindow[0])} – ${fmtDay(career.season, nextWindow[1])}`, deadline: fmtDay(career.season, nextWindow[0]) } : null,
    group: qualCodes.length ? { name: qual[0].stage, table: groupTable(qualCodes, qual).map((r) => ({ ...r, own: r.code === st.code, colors: nationColors(r.code) })) } : null,
    upcoming: season.filter((m) => !m.played && m.user).sort((a, b) => a.day - b.day).map(fmt),
    results: matches.filter((m) => m.played && m.user).slice(0, 30).map(fmt),
    qualMatches: qual.map(fmt),
    lastTournament: tSeason !== null ? { season: tSeason, matches: lastTournament.filter((m) => m.season === tSeason).sort((a, b) => a.day - b.day || a.id - b.id).map(fmt) } : null,
  };
}

export async function nationalSquadView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const st = await getNational(pool(), career.id);
  if (!st) throw new GameError("Du betreust keine Nationalmannschaft.");
  const pool_ = await nationPool(pool(), career, st.code, 150);
  const selected = new Set(st.squad);
  const clubs = new Map((await getClubs(pool(), career.id, "id = any($2::int[])", [[...new Set(pool_.map((p) => p.clubId).filter((x): x is number => x !== null))]])).map((c) => [c.id, c]));
  return {
    nation: { code: st.code, name: nation(st.code).name, colors: nationColors(st.code) },
    formation: st.formation, preset: st.preset, starters: st.starters,
    formations: Object.keys(FORMATIONS), presets: Object.fromEntries(Object.entries(STYLE_PRESETS).map(([k, v]) => [k, v.name])),
    max: SQUAD_SIZE,
    players: pool_.map((p) => ({
      id: p.id, name: `${p.firstName} ${p.lastName}`, age: p.age, nationality: p.nationality, position: p.position, rating: p.rating, form: p.form,
      fitness: p.fitness, injuryWeeks: p.injuryWeeks, caps: p.caps ?? 0, intlGoals: p.intlGoals ?? 0,
      club: p.clubName, clubId: p.clubId, kit: p.clubId !== null ? clubs.get(p.clubId)?.colors ?? null : null, own: p.clubId === career.club_id,
      selected: selected.has(p.id), starter: st.starters.includes(p.id),
    })),
  };
}

export async function saveNationalSquad(careerId: string, accountId: string, input: { squad?: unknown; starters?: unknown; formation?: unknown; preset?: unknown; auto?: unknown }) {
  return withCareer(careerId, accountId, async (db, career) => {
    const st = await getNational(db, career.id);
    if (!st) throw new GameError("Du betreust keine Nationalmannschaft.");
    const poolPlayers = await nationPool(db, career, st.code, 400);
    const valid = new Set(poolPlayers.map((p) => p.id));
    if (input.auto === true) st.squad = autoSquad(poolPlayers);
    else if (Array.isArray(input.squad)) {
      const ids = [...new Set(input.squad.map(Number).filter((id) => valid.has(id)))];
      if (ids.length > SQUAD_SIZE) throw new GameError(`Höchstens ${SQUAD_SIZE} Spieler.`);
      st.squad = ids;
    }
    if (Array.isArray(input.starters)) st.starters = [...new Set(input.starters.map(Number))].filter((id) => st.squad.includes(id)).slice(0, 11);
    st.starters = st.starters.filter((id) => st.squad.includes(id));
    if (typeof input.formation === "string" && input.formation in FORMATIONS) st.formation = input.formation as Formation;
    if (typeof input.preset === "string" && input.preset in STYLE_PRESETS) st.preset = input.preset;
    await saveNational(db, career.id, st);
    const gks = poolPlayers.filter((p) => st.squad.includes(p.id) && p.position === "GK").length;
    return { squad: st.squad, starters: st.starters, formation: st.formation, preset: st.preset, warning: gks < 2 ? "Nominiere mindestens zwei Torhüter." : null };
  });
}

export async function nationalMatchReport(careerId: string, accountId: string, matchId: number) {
  const career = await readCareer(careerId, accountId);
  const m = await one<NationalMatch>(pool(), "select *, user_match as user from national_matches where career_id = $1 and id = $2", [career.id, matchId]);
  if (!m) throw new GameError("Spiel nicht gefunden", 404);
  return {
    id: m.id, stage: m.stage, date: dateOf(m.season, m.day).toISOString().slice(0, 10),
    home: { code: m.home, name: nation(m.home).name, colors: nationColors(m.home) }, away: { code: m.away, name: nation(m.away).name, colors: nationColors(m.away) },
    homeGoals: m.home_goals, awayGoals: m.away_goals, penHome: m.pen_home, penAway: m.pen_away, data: m.data,
  };
}
