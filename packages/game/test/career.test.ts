/**
 * Integrationstest gegen PostgreSQL: Account, Karriere, eine komplette Saison.
 * Benötigt TEST_DATABASE_URL (oder lokale Standard-DB football_legacy_test).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://fl:fl@localhost:5432/football_legacy_test";

const game = await import("../src/index");
const { pool, migrate, register, createCareer, previewClubs, advance, quickMatch, dashboard, startMatch, stepMatch,
  squadView, saveTactic, tacticView, marketView, makeOffer, competitionView, careerView, financeView, leaderboards, cupView, reviewView, pressConference, answerPress, loanIn, loanOut } = game;

let accountId = "";
let careerId = "";
const loans: { inId?: number; outId?: number; parentId?: number } = {};
let promised = 0;
let trainingApproved = false;
let retrainId = 0;
let retrainPos = "";
let nationCode = "";

beforeAll(async () => {
  await pool().query("drop schema public cascade; create schema public;");
  await migrate();
  const { account } = await register(`test${Date.now()}@example.com`, "geheim123", "Tester");
  accountId = account.id;
}, 60_000);

afterAll(async () => {
  await pool().end();
});

describe("Karriere", () => {
  it("legt eine Karriere mit ganzer Welt an", async () => {
    const preview = previewClubs(4711, "SUI");
    expect(preview.length).toBe(2);
    const t0 = Date.now();
    careerId = await createCareer(accountId, { managerName: "Testmanager", countryCode: "SUI", clubIndex: preview[0].clubs[5].index, seed: 4711 });
    console.log(`Karriere angelegt in ${Date.now() - t0} ms`);
    const d = await dashboard(careerId, accountId);
    expect(d.club?.name).toBe(preview[0].clubs[5].name);
    expect(d.career.week).toBe(0);
    expect(d.inbox.length).toBeGreaterThan(0);
    const leagues = await pool().query("select count(*)::int as n from leagues where career_id = $1", [careerId]);
    expect(leagues.rows[0].n).toBeGreaterThan(150);
  }, 60_000);

  it("Taktik speichern und Kader lesen", async () => {
    const t = await tacticView(careerId, accountId);
    expect(t.tactic.lineup.filter((x) => x !== null).length).toBe(11);
    const res = await saveTactic(careerId, accountId, { ...t.tactic, formation: "4-3-3", style: { ...t.tactic.style, pressing: 70 } });
    expect(res.tactic.formation).toBe("4-3-3");
    const s = await squadView(careerId, accountId);
    expect(s.players.length).toBe(25);
  });

  it("Transfermarkt und Angebot", async () => {
    const m = await marketView(careerId, accountId, { sort: "rating" });
    expect(m.players.length).toBeGreaterThan(10);
    const target = m.players.find((p) => p.clubId === null) ?? m.players[m.players.length - 1];
    const out = await makeOffer(careerId, accountId, { playerId: target.id, fee: 0, wage: 1000, years: 2 });
    expect(["completed", "countered", "rejected"]).toContain(out.status);
  });

  it("Leihgeschäfte: ausleihen und verleihen", async () => {
    const d = await dashboard(careerId, accountId);
    const userClub = d.career.clubId!;
    const { rows } = await pool().query(
      "select p.id, p.club_id from players p join clubs c on c.id = p.club_id where p.career_id = $1 and c.league_id = $2 and c.id <> $3 and p.age <= 21 and (p.data->'contract'->>'untilSeason')::int > 2026 order by p.rating asc limit 1",
      [careerId, d.league!.id, userClub]);
    const r = await loanIn(careerId, accountId, rows[0].id, 0.1);
    expect(r.status).toBe("countered");
    const ok = await loanIn(careerId, accountId, rows[0].id, 1);
    expect(ok.status).toBe("completed");
    loans.inId = rows[0].id;
    loans.parentId = rows[0].club_id;
    const squad = await squadView(careerId, accountId);
    const lp = squad.players.find((p) => p.id === loans.inId)!;
    expect(lp.loan?.parentClubId).toBe(loans.parentId);
    const fringe = [...squad.players].filter((p) => !p.loan).sort((a, b) => (a.rating ?? 0) - (b.rating ?? 0))[0];
    const out = await loanOut(careerId, accountId, fringe.id);
    if (out.status === "completed") {
      loans.outId = fringe.id;
      const after = await squadView(careerId, accountId);
      expect((after.loanedOut ?? []).map((p) => p.id)).toContain(fringe.id);
    }
    await expect(game.releasePlayer(careerId, accountId, loans.inId!)).rejects.toThrow(/Leihspieler/);
  });

  it("Spielergespräche mit Abklingzeit und Versprechen", async () => {
    const squad = await squadView(careerId, accountId);
    const sorted = [...squad.players].filter((p) => !p.loan).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    const r = await game.talkToPlayer(careerId, accountId, sorted[0].id, "encourage");
    expect(typeof r.reaction).toBe("string");
    await expect(game.talkToPlayer(careerId, accountId, sorted[0].id, "praise")).rejects.toThrow(/vor Kurzem/);
    const fringe = sorted[sorted.length - 1];
    const pr = await game.talkToPlayer(careerId, accountId, fringe.id, "promise");
    expect(pr.promise?.needed).toBe(2);
    promised = fringe.id;
  });

  it("Individuelles Training mit Umschulung", async () => {
    const squad = await squadView(careerId, accountId);
    const p = squad.players.find((x) => x.position === "MC" && !x.altPositions.includes("DM")) ?? squad.players.find((x) => x.position !== "GK")!;
    const target = p.position === "MC" ? "DM" : "MC";
    const r = await game.setIndividualTraining(careerId, accountId, p.id, "technical", target);
    expect(r.individual.position).toBe(target);
    retrainId = p.id;
    retrainPos = target;
    await expect(game.setIndividualTraining(careerId, accountId, p.id, null, p.position)).rejects.toThrow(/bereits/);
  });

  it("Vorstandsanfragen", async () => {
    const b = await game.boardView(careerId, accountId);
    expect(b.offers.length).toBe(4);
    const r = await game.boardRequest(careerId, accountId, "training");
    trainingApproved = r.status === "approved";
    if (trainingApproved) expect((await game.boardView(careerId, accountId)).projects.length).toBe(1);
    const again = await game.boardRequest(careerId, accountId, "training");
    expect(again.status).toBe("rejected");
  });

  it("Pressekonferenz vor dem Spiel", async () => {
    const p = await pressConference(careerId, accountId);
    expect(p.available).toBe(true);
    expect(p.questions.length).toBeGreaterThan(0);
    const answers = Object.fromEntries(p.questions.map((q) => [q.id, q.answers[0].i]));
    const r = await answerPress(careerId, accountId, answers);
    expect(Array.isArray(r.effects)).toBe(true);
    await expect(answerPress(careerId, accountId, answers)).rejects.toThrow(/bereits/);
    expect((await pressConference(careerId, accountId)).done).toBe(true);
  });

  it("Nationaltrainer: Job übernehmen und Kader nominieren", async () => {
    const jobs = await game.nationalJobs(careerId, accountId);
    const job = jobs.jobs.find((j) => j.available && !j.home)!;
    expect(job).toBeTruthy();
    await expect(game.takeNationalJob(careerId, accountId, "GER")).rejects.toThrow();
    await game.takeNationalJob(careerId, accountId, job.code);
    nationCode = job.code;
    const v = await game.nationalView(careerId, accountId);
    expect(v.coach).toBe(true);
    if (!v.coach) return;
    expect(v.group?.table.length).toBe(4);
    expect(v.upcoming.length).toBe(6);
    const sq = await game.nationalSquadView(careerId, accountId);
    expect(sq.players.length).toBeGreaterThan(15);
    expect(sq.players.filter((p) => p.selected).length).toBeLessThanOrEqual(23);
    const picked = sq.players.slice(0, 22).map((p) => p.id);
    const saved = await game.saveNationalSquad(careerId, accountId, { squad: picked, starters: picked.slice(0, 11), formation: "4-4-2", preset: "counter" });
    expect(saved.squad.length).toBe(22);
    expect(saved.formation).toBe("4-4-2");
    await expect(game.saveNationalSquad(careerId, accountId, { squad: sq.players.slice(0, 30).map((p) => p.id) })).rejects.toThrow();
  });

  it("geht Tag für Tag bis zum ersten Spieltag", async () => {
    await expect(startMatch(careerId, accountId)).rejects.toThrow(/später/);
    const sa = await game.startAssignment(careerId, accountId, { country: "SUI", position: "ST", maxAge: 25 });
    expect(sa.cost).toBeGreaterThan(0);
    const m = await marketView(careerId, accountId, { sort: "rating" });
    const target = m.players.find((p) => p.clubId !== null && p.knowledge !== "exact")!;
    const sr = await game.scoutPlayer(careerId, accountId, target.id);
    expect((sr.report as { pending: boolean }).pending).toBe(true);
    expect((await game.playerDetail(careerId, accountId, target.id)).player.knowledge).not.toBe("exact");
    const types: string[] = [];
    let a = await advance(careerId, accountId);
    let sawTraining = false;
    let sawInbox = false;
    for (let i = 0; i < 40 && a.kind === "day"; i++) {
      types.push(a.day.type);
      if (a.day.training) {
        sawTraining = true;
        expect(a.day.training.top.length).toBe(3);
      }
      if (a.day.inbox.length) sawInbox = true;
      expect(a.day.outlook.length).toBe(3);
      expect(a.day.date).toMatch(/^2026-07-/);
      a = await advance(careerId, accountId);
    }
    expect(a.kind).toBe("match");
    expect(sawTraining).toBe(true);
    expect(sawInbox).toBe(true);
    const sq = await squadView(careerId, accountId);
    expect(sq.players.some((p) => p.trainingAvg !== null)).toBe(true);
    const d = await dashboard(careerId, accountId);
    expect(d.career.day).toBe(19);
    expect(d.career.date).toBe("2026-07-25");
    expect(types.filter((x) => x === "friendly").length).toBe(2);
    expect(types).toContain("prep");
    const inbox = await pool().query("select title, day from inbox where career_id = $1 and title like 'Testspiel%'", [careerId]);
    expect(inbox.rows.length).toBe(2);
    expect(inbox.rows.map((r) => r.day).sort((x, y) => x - y)).toEqual([9, 13]);
    const prep = await pool().query("select day from inbox where career_id = $1 and title like 'Spielvorbereitung%'", [careerId]);
    expect(prep.rows[0]?.day).toBe(17);
    expect((await game.playerDetail(careerId, accountId, target.id)).player.knowledge).toBe("exact");
    const scoutMail = await pool().query("select 1 from inbox where career_id = $1 and title = $2", [careerId, `Scoutbericht: ${target.name}`]);
    expect(scoutMail.rows.length).toBe(1);
    const sv = await game.scoutingView(careerId, accountId);
    expect(sv.assignments.length).toBe(0);
    expect(sv.reports.length).toBe(1);
    expect(sv.reports[0].players.length).toBeGreaterThan(0);
    expect(sv.reports[0].players.every((p) => p.position === "ST" && p.age <= 25 && p.rating !== null)).toBe(true);
    const cal = await game.calendarView(careerId, accountId);
    expect(cal.days.find((x) => x.day === 19)?.match).toBeTruthy();
  }, 60_000);

  it("spielt ein Spiel in Abschnitten mit Live-Eingriffen", async () => {
    const a = await advance(careerId, accountId);
    expect(a.kind).toBe("match");
    const pv = await game.dashboard(careerId, accountId);
    expect(Array.isArray(pv.next?.advice)).toBe(true);
    const tt = await game.teamTalkState(careerId, accountId);
    expect(tt.available).toBe(true);
    const talk = await game.giveTeamTalk(careerId, accountId, "motivate");
    expect(typeof talk.effect).toBe("number");
    await expect(game.giveTeamTalk(careerId, accountId, "demand")).rejects.toThrow(/bereits/);
    const first = await startMatch(careerId, accountId);
    expect(first.frames.length).toBe(31);
    // Live-Wechsel in der 1. Halbzeit
    const bench = first.teams[first.side].players.find((p) => p.slot === -1)!;
    const s1 = await stepMatch(careerId, accountId, { change: { style: { pressing: 80 }, subs: [{ slot: 10, playerId: bench.id }] } });
    expect(s1.fromTick).toBe(30);
    expect(s1.frames.length).toBe(30);
    expect(s1.events.some((e) => e.type === "sub" && e.playerId === bench.id)).toBe(true);
    // Bis zur Halbzeit: Simulation stoppt bei Tick 270
    const ht = await stepMatch(careerId, accountId, { until: 999 });
    expect(ht.tick).toBe(270);
    expect(ht.done).toBe(false);
    // Neu laden mitten im Spiel
    const resumed = await startMatch(careerId, accountId);
    expect(resumed.fromTick).toBe(270);
    expect(resumed.frames.length).toBe(1);
    const end = await stepMatch(careerId, accountId, { change: { style: { risk: 80 } }, until: 540 });
    expect(end.done).toBe(true);
    if (!end.done) return;
    expect(end.summary.week).toBe(1);
    expect(end.summary.results.length).toBe(6);
  }, 60_000);

  it("spielt die komplette Saison bis zum Saisonwechsel", async () => {
    const t0 = Date.now();
    let seasonEnd = null;
    let days = 0;
    let matches = 0;
    let midDynamics: Awaited<ReturnType<typeof game.dynamicsView>> | null = null;
    for (let i = 0; i < 1000 && !seasonEnd; i++) {
      const a = await advance(careerId, accountId);
      if (a.kind === "day") {
        days++;
        continue;
      }
      if (a.kind === "match") matches++;
      const summary = a.kind === "match" ? await quickMatch(careerId, accountId) : a.summary;
      seasonEnd = summary.seasonEnd;
      if (matches === 12 && !midDynamics) midDynamics = await game.dynamicsView(careerId, accountId);
      if (matches === 18) {
        // Endrunde erzwingen: ggf. neuen Job übernehmen und als qualifiziert markieren
        let row = await pool().query("select data from national_teams where career_id = $1", [careerId]);
        if (!row.rows[0]) {
          const jobs = await game.nationalJobs(careerId, accountId);
          await game.takeNationalJob(careerId, accountId, jobs.jobs.find((j) => j.available)!.code);
          row = await pool().query("select data from national_teams where career_id = $1", [careerId]);
        }
        await pool().query("update national_teams set data = jsonb_set(data, '{qualified}', 'true') where career_id = $1", [careerId]);
      }
    }
    // Einsatzzeit wird pro Pflichtspiel gezählt, Status erwartet Startelfanteile
    expect(midDynamics).not.toBeNull();
    const regulars = midDynamics!.players.filter((p) => p.matches >= 8);
    expect(regulars.length).toBeGreaterThan(15);
    expect(regulars.some((p) => p.starts >= 8)).toBe(true);
    expect(midDynamics!.hierarchy[0].players.length).toBe(3);
    expect(midDynamics!.cohesion.value).toBeGreaterThan(0);
    console.log(`${days} Tage`);
    console.log(`Saison in ${Date.now() - t0} ms`, seasonEnd);
    expect(seasonEnd).not.toBeNull();
    const d = await dashboard(careerId, accountId);
    expect(d.career.season).toBe(2027);
    expect(d.career.week).toBe(0);
    const c = await competitionView(careerId, accountId);
    expect(c.table.length).toBeGreaterThan(0);
    expect(c.table.every((r) => r.played === 0)).toBe(true);
    const cv = await careerView(careerId, accountId);
    expect(cv.history.length).toBe(1);
    expect(cv.career.xp).toBeGreaterThan(0);
    const f = await financeView(careerId, accountId);
    expect(f.recent.length).toBeGreaterThan(0);
    const cup = await cupView(careerId, accountId, 2026);
    expect(cup.cup?.winner).toBeTruthy();
    expect(cup.rounds[cup.rounds.length - 1].name).toBe("Finale");
    expect(cup.rounds.every((r) => r.matches.every((m) => m.played))).toBe(true);
    const next = await cupView(careerId, accountId);
    expect(next.rounds[0].matches.length).toBeGreaterThan(0);
    const intl = await game.continentalView(careerId, accountId, 2026);
    expect(intl.cup?.size).toBe(32);
    expect(intl.groups.length).toBe(8);
    expect(intl.groups.every((g) => g.table.every((r) => r.played === 6))).toBe(true);
    expect(intl.rounds.filter((r) => !r.group).map((r) => r.matches.length)).toEqual([8, 4, 2, 1]);
    expect(intl.cup?.winner).toBeTruthy();
    const nextIntl = await game.continentalView(careerId, accountId);
    expect(nextIntl.groups.length).toBe(8);
    const rv = await reviewView(careerId, accountId);
    expect(rv.seasons).toEqual([2026]);
    expect(rv.review?.awards.find((a) => a.key === "scorer")?.entry?.value).toMatch(/Tore/);
    expect(rv.review?.teamOfSeason.length).toBe(11);
    expect(rv.review?.table.length).toBeGreaterThan(5);
    // Leihen sind zum Saisonende ausgelaufen
    const back = await pool().query("select id, club_id, data->'loan' as loan from players where career_id = $1 and id = any($2::int[])", [careerId, [loans.inId, loans.outId].filter(Boolean)]);
    for (const row of back.rows) expect(row.loan).toBeNull();
    expect(back.rows.find((r) => r.id === loans.inId)?.club_id).toBe(loans.parentId);
    if (loans.outId) expect(back.rows.find((r) => r.id === loans.outId)?.club_id).toBe(d.career.clubId);
    // Das Versprechen wurde ausgewertet (gehalten oder gebrochen)
    const pm = await pool().query("select data->'promise' as promise from players where career_id = $1 and id = $2", [careerId, promised]);
    expect(pm.rows[0]?.promise ?? null).toBeNull();
    const pmail = await pool().query("select title from inbox where career_id = $1 and title like 'Versprechen%'", [careerId]);
    expect(pmail.rows.length).toBe(1);
    // Akademie: Jahrgang kam am Jugendtag, Ausbau ist fertig
    const ac = await game.academyView(careerId, accountId);
    expect(ac.players.length).toBeGreaterThanOrEqual(4);
    expect(ac.nextIntake).not.toBeNull();
    const youngster = ac.players.find((p) => p.age >= 16)!;
    const pr2 = await game.promoteYouth(careerId, accountId, youngster.id);
    expect(pr2.playerId).toBe(youngster.id);
    expect((await squadView(careerId, accountId)).players.some((p) => p.id === youngster.id)).toBe(true);
    if (trainingApproved) expect((await game.boardView(careerId, accountId)).facilities.training.level).toBe(2);
    // Umschulung abgeschlossen, Länderspielpausen ausgewertet
    const rp = await pool().query("select data from players where career_id = $1 and id = $2", [careerId, retrainId]);
    if (rp.rows[0]) expect(rp.rows[0].data.altPositions).toContain(retrainPos);
    const calls = await pool().query("select count(*) filter (where title like 'Länderspielpause%')::int as a, count(*) filter (where title like 'Rückkehr von den Nationalmannschaften')::int as b from inbox where career_id = $1", [careerId]);
    expect(calls.rows[0].a).toBe(calls.rows[0].b);
    const med = await game.medicalView(careerId, accountId);
    expect(med.injured.every((x) => x.injury.length > 0)).toBe(true);
    const named = await pool().query("select count(*)::int as n from inbox where career_id = $1 and category = 'medical' and body like '%fällt%'", [careerId]);
    expect(named.rows[0].n).toBeGreaterThanOrEqual(0);
    const lb = await leaderboards();
    expect(lb.best.length).toBe(1);
    // Monatsauszeichnungen: jeden Monat mit mindestens zwei Spieltagen
    const aw = await pool().query("select month, data from monthly_awards where career_id = $1 and season = 2026 order by id", [careerId]);
    expect(aw.rows.length).toBeGreaterThanOrEqual(6);
    for (const r of aw.rows) {
      expect(r.data.player?.name).toBeTruthy();
      expect(r.data.manager?.club).toBeTruthy();
      expect(r.data.team.length).toBe(11);
    }
    const potm = aw.rows[0].data.player.id;
    const pp = await pool().query("select data->'awards' as awards from players where career_id = $1 and id = $2", [careerId, potm]);
    expect(pp.rows[0].awards.some((x: { kind: string }) => x.kind === "player")).toBe(true);
    const av = await game.awardsView(careerId, accountId);
    expect(av.months.length).toBeGreaterThan(0);
    // Kaderstatus ändern: Herabstufung kostet Moral
    const dyn = await game.dynamicsView(careerId, accountId);
    const star = dyn.players.find((p) => p.status === "star" && !p.loan)!;
    const before = star.morale;
    const res = await game.setSquadStatus(careerId, accountId, star.id, "backup");
    expect(res.morale).toBeLessThan(before);
    expect((await game.dynamicsView(careerId, accountId)).players.find((p) => p.id === star.id)?.status).toBe("backup");
  }, 240_000);

  it("Nationaltrainer: Qualifikation gespielt und Endrunde ausgewertet", async () => {
    const played = await pool().query("select kind, stage, home, away, home_goals, away_goals, user_match, data is not null as report from national_matches where career_id = $1 and season = 2026 order by day, id", [careerId]);
    const userQual = played.rows.filter((r) => r.kind === "qual" && r.user_match);
    expect(userQual.length).toBe(6);
    expect(userQual.every((r) => r.home_goals !== null && r.report)).toBe(true);
    expect(played.rows.filter((r) => r.kind === "qual").length).toBe(12);
    const st = await pool().query("select data from national_teams where career_id = $1", [careerId]);
    const mail = await pool().query("select title from inbox where career_id = $1 and category = 'international' and (title like 'Gruppensieg%' or title like '%Playoffs%' or title like '%Endrunde%' or title like '%trennt sich%' or title like '%gewinnt die%' or title like '%beendet')", [careerId]);
    expect(mail.rows.length).toBeGreaterThan(0);
    console.log("Nationalteam:", nationCode, mail.rows.map((r) => r.title).join(" | "));
    const tour = played.rows.filter((r) => r.kind === "tournament");
    expect(tour.filter((r) => r.user_match).length).toBeGreaterThanOrEqual(3);
    expect(tour.every((r) => r.home_goals !== null)).toBe(true);
    const finals = tour.filter((r) => String(r.stage).endsWith("Finale") && !String(r.stage).includes("Halb") && !String(r.stage).includes("Viertel"));
    expect(finals.length).toBe(1);
    if (st.rows[0]) {
      const v = await game.nationalView(careerId, accountId);
      if (v.coach) {
        expect(v.record.p).toBeGreaterThanOrEqual(3);
        expect(v.upcoming.filter((m) => m.kind === "qual").length).toBe(6);
        expect(v.history.some((h) => h.text.includes("meisterschaft") || h.text.includes("Weltmeisterschaft"))).toBe(true);
        const rep = await game.nationalMatchReport(careerId, accountId, v.results[0].id);
        expect(rep.data).toBeTruthy();
      }
    }
  });

  it("Medien: Spielberichte, Liga, Gerüchte und Schlagzeilen", async () => {
    const counts = await pool().query("select kind, count(*)::int as n from media where career_id = $1 group by kind", [careerId]);
    const by = Object.fromEntries(counts.rows.map((r) => [r.kind, r.n]));
    expect(by.match).toBeGreaterThan(20);
    expect(by.league).toBeGreaterThan(10);
    expect(by.rumour ?? 0).toBeGreaterThan(0);
    const all = await game.mediaView(careerId, accountId, null);
    expect(all.articles.length).toBeGreaterThan(10);
    expect(all.articles.every((a) => a.title.length > 5 && a.body.length > 5)).toBe(true);
    const own = await game.mediaView(careerId, accountId, "own");
    expect(own.articles.every((a) => a.own)).toBe(true);
    const rumours = await game.mediaView(careerId, accountId, "rumour");
    expect(rumours.articles.every((a) => a.kind === "rumour")).toBe(true);
    const d = await dashboard(careerId, accountId);
    expect(d.headlines.length).toBe(4);
  });

  it("Trainerstab: Personalmarkt, Einstellen, Verlängern, Entlassen", async () => {
    const v = await game.staffView(careerId, accountId);
    expect(v.roles.length).toBe(4);
    expect(v.roles.every((r) => r.member && r.member.name.length > 3)).toBe(true);
    expect(v.candidates.length).toBe(16);
    await pool().query("update clubs set balance = balance + 50000000, reputation = 90 where career_id = $1 and id = (select club_id from careers where id = $1)", [careerId]);
    const best = [...(await game.staffView(careerId, accountId)).candidates].filter((c) => c.role === "coach").sort((a, b) => b.quality - a.quality)[0];
    await game.hireStaff(careerId, accountId, best.id);
    const after = await game.staffView(careerId, accountId);
    expect(after.roles.find((r) => r.role === "coach")?.member?.id).toBe(best.id);
    const career = await pool().query("select staff from careers where id = $1", [careerId]);
    expect(career.rows[0].staff.coach).toBe(best.quality);
    const physio = after.roles.find((r) => r.role === "physio")!.member!;
    await game.fireStaff(careerId, accountId, physio.id);
    const fired = await game.staffView(careerId, accountId);
    expect(fired.roles.find((r) => r.role === "physio")?.member).toBeNull();
    expect((await pool().query("select staff from careers where id = $1", [careerId])).rows[0].staff.physio).toBe(3);
    await expect(game.hireStaff(careerId, accountId, 999999)).rejects.toThrow();
  });

  it("Einstellungen: Spieloptionen, Passwort und Account löschen", async () => {
    const r = await game.updateCareerSettings(careerId, accountId, { autoSubs: false, stopOn: { finance: true, medical: false, hacked: true } });
    expect(r.autoSubs).toBe(false);
    expect(r.stopOn.finance).toBe(true);
    expect(r.stopOn.medical).toBe(false);
    expect("hacked" in r.stopOn).toBe(false);
    expect((await dashboard(careerId, accountId)).career.stopOn.finance).toBe(true);
    const email = `pw${Date.now()}@example.com`;
    const { account, token } = await register(email, "geheim123", "PW");
    await expect(game.changePassword(account.id, token, "falsch123", "neuesPasswort1")).rejects.toThrow();
    await game.changePassword(account.id, token, "geheim123", "neuesPasswort1");
    await expect(game.login(email, "geheim123")).rejects.toThrow();
    expect((await game.login(email, "neuesPasswort1")).account.id).toBe(account.id);
    await game.updateProfile(account.id, "Neuer Name");
    await expect(game.deleteAccount(account.id, "geheim123")).rejects.toThrow();
    await game.deleteAccount(account.id, "neuesPasswort1");
    const gone = await pool().query("select 1 from accounts where id = $1", [account.id]);
    expect(gone.rows.length).toBe(0);
  });
});

describe("Verein, Fans und Online-Ligen", () => {
  let friendId = "";
  let friendCareer = "";
  let leagueId = "";

  it("Vereinsverwaltung: Fanstimmung, Tickets, Fan-Aktionen und Identität", async () => {
    const v = await game.clubManagementView(careerId, accountId);
    // nach einer ganzen Saison haben die Fans eine Geschichte und eine Meinung
    expect(v.fans.history.length).toBeGreaterThan(10);
    expect(v.fans.voices.length).toBeGreaterThan(0);
    expect(v.fans.members).toBeGreaterThan(0);
    expect(v.actions.length).toBe(6);
    await game.setTicketLevel(careerId, accountId, "low");
    expect((await game.clubManagementView(careerId, accountId)).tickets.level).toBe("low");
    await expect(game.setTicketLevel(careerId, accountId, "gratis" as never)).rejects.toThrow();
    const before = (await game.clubManagementView(careerId, accountId)).fans.satisfaction;
    const r = await game.fanAction(careerId, accountId, "training");
    expect(r.satisfaction).toBeGreaterThanOrEqual(Math.min(100, before));
    await expect(game.fanAction(careerId, accountId, "training")).rejects.toThrow(/Tagen/);
    const old = v.club.name;
    await game.updateIdentity(careerId, accountId, { name: "Testclub Legacy", short: "TCL", primary: "#123456", secondary: "#fedcba", stadiumName: "Legacy-Park" });
    const after = await game.clubManagementView(careerId, accountId);
    expect(after.club.name).toBe("Testclub Legacy");
    expect(after.club.colors.primary).toBe("#123456");
    expect(after.stadiumName).toBe("Legacy-Park");
    expect(after.renamed).toBe(1);
    expect(after.fans.satisfaction).toBeLessThan(r.satisfaction);
    await expect(game.updateIdentity(careerId, accountId, { name: "X" })).rejects.toThrow();
    expect(old).not.toBe("Testclub Legacy");
  });

  it("Eigenen Verein gründen", async () => {
    const { account } = await register(`friend${Date.now()}@example.com`, "geheim123", "Freundin");
    friendId = account.id;
    const preview = previewClubs(99, "GER");
    const base = preview[0].clubs[3];
    await expect(createCareer(friendId, { managerName: "F", countryCode: "GER", clubIndex: base.index, seed: 99, custom: { name: "X", shortName: "X", city: "", primary: "#000000", secondary: "#ffffff", founded: 2000, stadiumName: "" } })).rejects.toThrow();
    friendCareer = await createCareer(friendId, {
      managerName: "Freundin", countryCode: "GER", clubIndex: base.index, seed: 99,
      custom: { name: "FC Seeblick", shortName: "fcs", city: "Seeblick", primary: "#0a7d3b", secondary: "#ffffff", founded: 2024, stadiumName: "" },
    });
    const d = await dashboard(friendCareer, friendId);
    expect(d.club?.name).toBe("FC Seeblick");
    const v = await game.clubManagementView(friendCareer, friendId);
    expect(v.club.short).toBe("FCS");
    expect(v.club.founded).toBe(2024);
    expect(v.stadiumName).toBe("Seeblick-Arena");
    expect(v.club.colors.primary).toBe("#0a7d3b");
    const names = await pool().query("select count(*)::int as n from clubs where career_id = $1 and name = $2", [friendCareer, base.name]);
    expect(names.rows[0].n).toBe(0);
    expect(d.inbox.some((m) => String(m.title).includes("FC Seeblick"))).toBe(true);
  }, 60_000);

  it("Spielplan: Doppelrunde, jeder gegen jeden", () => {
    for (const n of [2, 3, 4, 7, 10]) {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const rounds = game.roundRobin(ids);
      expect(rounds.length).toBe((n % 2 ? n : n - 1) * 2);
      const pairs = rounds.flat();
      expect(pairs.length).toBe(n * (n - 1));
      expect(new Set(pairs.map(([h, a]) => `${h}-${a}`)).size).toBe(n * (n - 1));
      for (const r of rounds) expect(new Set(r.flat()).size).toBe(r.length * 2);
    }
  });

  it("Online-Liga: gründen, beitreten, CPU-Teams, Bereit-Meldung, Saison, Chat", async () => {
    await expect(game.createOnlineLeague(accountId, { name: "ab", careerId, maxMembers: 4, rhythm: "manual", public: true })).rejects.toThrow();
    const created = await game.createOnlineLeague(accountId, { name: "Testliga", careerId, maxMembers: 4, rhythm: "manual", public: false });
    leagueId = created.id;
    expect(created.code).toMatch(/^[A-Z2-9]{6}$/);
    // privat: nicht in der Liste offener Ligen, Fremde sehen sie nicht
    expect((await game.onlineOverview(friendId)).open.some((l: { id: string }) => l.id === leagueId)).toBe(false);
    await expect(game.onlineLeagueView(friendId, leagueId)).rejects.toThrow();
    await expect(game.joinOnlineLeague(friendId, { code: "ZZZZZZ", careerId: friendCareer })).rejects.toThrow();
    await expect(game.joinOnlineLeague(friendId, { code: created.code, careerId })).rejects.toThrow(); // fremde Karriere
    await game.joinOnlineLeague(friendId, { code: created.code.toLowerCase(), careerId: friendCareer });
    await expect(game.joinOnlineLeague(friendId, { code: created.code, careerId: friendCareer })).rejects.toThrow(/bereits/);
    await expect(game.addOnlineBots(friendId, leagueId, 2)).rejects.toThrow(/gründer/i);
    await game.addOnlineBots(accountId, leagueId, 5);
    let v = await game.onlineLeagueView(accountId, leagueId);
    expect(v.members.length).toBe(4);
    expect(v.members.filter((m: { bot: boolean }) => m.bot).length).toBe(2);
    expect(v.members.find((m: { mine: boolean }) => m.mine)?.team.name).toBe("Testclub Legacy");
    expect(v.members.every((m: { team: { rating: number } }) => m.team.rating > 0)).toBe(true);

    await game.startOnlineLeague(accountId, leagueId);
    v = await game.onlineLeagueView(accountId, leagueId);
    expect(v.status).toBe("running");
    expect(v.rounds).toBe(6);
    expect(v.schedule.length).toBe(6);
    expect(v.myNext?.bye).toBe(false);
    await expect(game.leaveOnlineLeague(friendId, leagueId)).rejects.toThrow();

    // erst wenn beide bereit sind, wird gespielt
    const r1 = await game.setOnlineReady(accountId, leagueId, true);
    expect(r1.played).toBe(false);
    expect((await game.onlineLeagueView(friendId, leagueId)).waitingFor).toEqual(["Freundin"]);
    const r2 = await game.setOnlineReady(friendId, leagueId, true);
    expect(r2.played).toBe(true);
    v = await game.onlineLeagueView(accountId, leagueId);
    expect(v.round).toBe(1);
    expect(v.table.reduce((s: number, r: { p: number }) => s + r.p, 0)).toBe(4);
    const played = v.schedule[0].matches[0] as { id: number; hasReport: boolean };
    expect(played.hasReport).toBe(true);
    const rep = await game.onlineMatchReport(friendId, leagueId, played.id);
    expect(rep.report?.players.length).toBeGreaterThanOrEqual(22);
    expect(rep.homeGoals).toBe(rep.report!.events.filter((e) => ["goal", "penalty_goal"].includes(e.type) && e.side === "home").length + rep.report!.events.filter((e) => e.type === "own_goal" && e.side === "away").length);

    // Gründer spielt den Rest
    await expect(game.playOnlineRound(friendId, leagueId)).rejects.toThrow();
    for (let i = 0; i < 5; i++) await game.playOnlineRound(accountId, leagueId);
    v = await game.onlineLeagueView(accountId, leagueId);
    expect(v.status).toBe("finished");
    expect(v.table.every((r: { p: number }) => r.p === 6)).toBe(true);
    expect(v.posts.some((p: { body: string }) => p.body.includes("Meister der Saison 1"))).toBe(true);

    await game.postOnlineMessage(friendId, leagueId, "  Glückwunsch   zum Titel! ");
    await expect(game.postOnlineMessage(friendId, leagueId, "  ")).rejects.toThrow();
    v = await game.onlineLeagueView(friendId, leagueId);
    expect(v.posts.at(-1)?.body).toBe("Glückwunsch zum Titel!");
    expect(v.posts.at(-1)?.mine).toBe(true);

    // neue Saison mit frischem Spielplan
    await game.startOnlineLeague(accountId, leagueId);
    v = await game.onlineLeagueView(accountId, leagueId);
    expect(v.season).toBe(2);
    expect(v.round).toBe(0);
    expect(v.table.every((r: { p: number }) => r.p === 0)).toBe(true);
    const ov = await game.onlineOverview(friendId);
    expect(ov.leagues[0].id).toBe(leagueId);
    expect(ov.careers.length).toBe(1);
  }, 60_000);

  it("Online-Liga: täglicher Rhythmus holt fällige Spieltage nach", async () => {
    const l = await game.createOnlineLeague(friendId, { name: "Tagesliga", careerId: friendCareer, maxMembers: 3, rhythm: "daily", public: true });
    expect((await game.onlineOverview(accountId)).open.some((x: { id: string }) => x.id === l.id)).toBe(true);
    await game.joinOnlineLeague(accountId, { leagueId: l.id, careerId });
    await game.addOnlineBots(friendId, l.id, 1);
    await game.startOnlineLeague(friendId, l.id);
    // zwei Tage vergangen
    await pool().query("update online_leagues set next_at = now() - interval '1 day 1 hour' where id = $1", [l.id]);
    const v = await game.onlineLeagueView(accountId, l.id);
    expect(v.round).toBe(2);
    expect(new Date(v.nextAt!).getTime()).toBeGreaterThan(Date.now());
    // Karriere gelöscht: Team spielt mit letztem Kaderstand weiter
    await game.deleteCareer(friendId, friendCareer);
    await game.playOnlineRound(friendId, l.id);
    const after = await game.onlineLeagueView(friendId, l.id);
    expect(after.round).toBe(3);
    expect(after.members.find((m: { mine: boolean }) => m.mine)?.orphan).toBe(true);
    expect(after.table.reduce((n: number, r: { p: number }) => n + r.p, 0)).toBe(6);
  }, 60_000);
});

describe("Stellenmarkt", () => {
  async function playOn(until: (c: { week: number }) => boolean, max = 80) {
    for (let i = 0; i < max; i++) {
      const c = (await pool().query("select week, club_id from careers where id = $1", [careerId])).rows[0];
      if (until(c)) return;
      const r = await advance(careerId, accountId);
      if (r.kind === "match") await quickMatch(careerId, accountId);
    }
    throw new Error("Ziel nicht erreicht");
  }

  it("Freie Stellen: alle Vereine der Welt mit Status, Filter und Seiten", async () => {
    const v = await game.jobsView(careerId, accountId, {});
    const total = v.counts.frei + v.counts.unsicher + v.counts.besetzt;
    expect(total).toBeGreaterThan(1000);
    expect(v.rows.length).toBe(40);
    expect(v.rows.every((r) => r.coach === null ? r.status === "frei" : r.coach.length > 3)).toBe(true);
    expect(v.me.club?.name).toBe("Testclub Legacy");
    const ger = await game.jobsView(careerId, accountId, { country: "GER", tier: 1 });
    expect(ger.total).toBe(18);
    expect(ger.rows.every((r) => r.countryCode === "GER" && r.tier === 1)).toBe(true);
    const page2 = await game.jobsView(careerId, accountId, { page: 2 });
    expect(page2.rows[0].clubId).not.toBe(v.rows[0].clubId);
    const reach = await game.jobsView(careerId, accountId, { reachable: true });
    expect(reach.total).toBeLessThan(total);
  });

  it("Bewerbung: verschicken, doppelt abgelehnt, Antwort nach einigen Tagen", async () => {
    const v = await game.jobsView(careerId, accountId, { country: "ESP", tier: 2 });
    const target = v.rows[0];
    const r = await game.applyForJob(careerId, accountId, target.clubId);
    expect(r.message).toMatch(/bewerbung/i);
    await expect(game.applyForJob(careerId, accountId, target.clubId)).rejects.toThrow(/läuft/);
    await expect(game.applyForJob(careerId, accountId, v.me.club!.id)).rejects.toThrow();
    let after = await game.jobsView(careerId, accountId, { country: "ESP", tier: 2 });
    expect(after.applications[0].status).toBe("pending");
    expect(after.rows.find((x) => x.clubId === target.clubId)?.applied).toBe(true);
    for (let i = 0; i < 12; i++) {
      const res = await advance(careerId, accountId);
      if (res.kind === "match") await quickMatch(careerId, accountId);
    }
    after = await game.jobsView(careerId, accountId, {});
    const app = after.applications.find((a) => a.clubId === target.clubId)!;
    expect(["rejected", "offer"]).toContain(app.status);
    const inbox = await pool().query("select title from inbox where career_id = $1 and title like $2", [careerId, `%${target.name}%`]);
    expect(inbox.rows.length).toBeGreaterThan(0);
  }, 60_000);

  it("Vereinswechsel mitten in der Saison und Rücktritt", async () => {
    await playOn((c) => c.week >= 2);
    const before = (await pool().query("select club_id, season from careers where id = $1", [careerId])).rows[0];
    // Angebot eines Vereins aus einer anderen Liga
    const pick = (await pool().query(
      `select c.id, c.name, c.reputation, c.country_code, l.name as league from clubs c join leagues l on l.id = c.league_id
        where c.career_id = $1 and l.country_code = 'ITA' and l.tier = 2 order by c.reputation desc limit 1`, [careerId])).rows[0];
    await pool().query("update careers set job_offers = $2 where id = $1", [careerId, JSON.stringify([{ clubId: pick.id, clubName: pick.name, leagueName: pick.league, countryCode: "ITA", reputation: pick.reputation, expires: before.season + 1, expiresDay: before.season * 1000 + 999, kind: "angebot", wage: 300000, years: 2 }])]);
    await expect(game.acceptJob(careerId, accountId, 999999)).rejects.toThrow();
    await game.acceptJob(careerId, accountId, pick.id);
    const d = await dashboard(careerId, accountId);
    expect(d.club?.id).toBe(pick.id);
    expect(d.career.week).toBeGreaterThanOrEqual(2);
    const squad = await squadView(careerId, accountId);
    expect(squad.players.length).toBeGreaterThan(15);
    const v = await game.jobsView(careerId, accountId, {});
    expect(v.me.contract?.untilSeason).toBe(before.season + 1);
    expect(v.offers.length).toBe(0);
    const old = await game.jobsView(careerId, accountId, { q: "Testclub Legacy" });
    expect(old.rows[0].status).toBe("frei");
    // weiterspielen mit dem neuen Verein: nächste Runde inklusive eigenem Spiel
    const week = d.career.week;
    await playOn((c) => c.week > week);
    const played = await pool().query("select count(*)::int as n from fixtures where career_id = $1 and season = $2 and played and $3 in (home_id, away_id)", [careerId, before.season, pick.id]);
    expect(played.rows[0].n).toBeGreaterThanOrEqual(week);

    await game.resignJob(careerId, accountId);
    const free = await dashboard(careerId, accountId);
    expect(free.career.status).toBe("unemployed");
    expect(free.club).toBeFalsy();
    await expect(game.resignJob(careerId, accountId)).rejects.toThrow();
    // ohne Verein läuft die Zeit weiter
    const w0 = free.career.week;
    await playOn((c) => c.week > w0 + 1, 40);
    const now = await dashboard(careerId, accountId);
    expect(now.career.week).toBeGreaterThan(w0 + 1);
    const jobs = await game.jobsView(careerId, accountId, { status: "frei" });
    expect(jobs.me.club).toBeNull();
    expect(jobs.total).toBeGreaterThan(0);
    // Interesse bekunden und zurücknehmen
    const t = (await game.jobsView(careerId, accountId, { status: "besetzt" })).rows[0];
    expect((await game.toggleInterest(careerId, accountId, t.clubId)).interest).toBe(true);
    expect((await game.toggleInterest(careerId, accountId, t.clubId)).interest).toBe(false);
    // wieder einsteigen über ein Angebot
    const pick2 = jobs.rows[0];
    await pool().query("update careers set job_offers = $2 where id = $1", [careerId, JSON.stringify([{ clubId: pick2.clubId, clubName: pick2.name, leagueName: pick2.league, countryCode: pick2.countryCode, reputation: pick2.reputation, expires: 9999, expiresDay: 9_999_999 }])]);
    await game.declineOffer(careerId, accountId, pick2.clubId);
    expect((await dashboard(careerId, accountId)).jobOffers.length).toBe(0);
    await pool().query("update careers set job_offers = $2 where id = $1", [careerId, JSON.stringify([{ clubId: pick2.clubId, clubName: pick2.name, leagueName: pick2.league, countryCode: pick2.countryCode, reputation: pick2.reputation, expires: 9999, expiresDay: 9_999_999 }])]);
    await game.acceptJob(careerId, accountId, pick2.clubId);
    const back = await dashboard(careerId, accountId);
    expect(back.career.status).toBe("active");
    expect(back.club?.id).toBe(pick2.clubId);
  }, 120_000);
});

describe("Taktik-Ausbau", () => {
  it("Mentalität, Pflichten, Anweisungen speichern; mehrere Taktiken; Vertrautheit", async () => {
    const v = await tacticView(careerId, accountId);
    expect(v.tactics.slots.length).toBe(1);
    expect(Object.keys(v.mentalities).length).toBe(7);
    expect(Object.keys(v.presets).length).toBeGreaterThanOrEqual(12);
    const fam0 = v.familiarity.total;
    const duties = v.tactic.lineup.map((_: unknown, i: number) => (i === 10 ? "attack" : i === 1 ? "defend" : null));
    const instructions = v.tactic.lineup.map((_: unknown, i: number) => (i === 10 ? ["shoot_more", "stay_back", "get_forward"] : i === 0 ? ["shoot_more"] : []));
    const res = await saveTactic(careerId, accountId, { ...v.tactic, mentality: 2, duties, instructions: instructions as never, style: { ...v.tactic.style, pressing: Math.min(100, v.tactic.style.pressing + 40) } });
    expect(res.tactic.mentality).toBe(2);
    expect(res.tactic.duties?.[10]).toBe("attack");
    expect(res.tactic.instructions?.[10]).toEqual(["shoot_more", "get_forward"]); // Widerspruch aufgelöst
    expect(res.tactic.instructions?.[0]).toEqual([]); // keine Anweisungen für den Torwart
    const after = await tacticView(careerId, accountId);
    expect(after.familiarity.style).toBeLessThan(v.familiarity.style); // Umstellung kostet Vertrautheit
    expect(after.intensity).toBeGreaterThan(v.intensity);

    // zweite Taktik als Kopie, umbenennen, wechseln, löschen
    await game.tacticSlotAction(careerId, accountId, { action: "add" });
    let t2 = await tacticView(careerId, accountId);
    expect(t2.tactics.slots.length).toBe(2);
    expect(t2.tactics.active).toBe(1);
    await saveTactic(careerId, accountId, { ...t2.tactic, formation: "4-4-2", mentality: -1, duties: [], instructions: [] });
    await game.tacticSlotAction(careerId, accountId, { action: "rename", index: 1, name: "Defensiv 4-4-2" });
    await game.tacticSlotAction(careerId, accountId, { action: "select", index: 0 });
    t2 = await tacticView(careerId, accountId);
    expect(t2.tactic.mentality).toBe(2);
    expect(t2.tactics.slots[1].name).toBe("Defensiv 4-4-2");
    expect(t2.tactics.slots[1].formation).toBe("4-4-2");
    await expect(game.tacticSlotAction(careerId, accountId, { action: "add" }).then(() => game.tacticSlotAction(careerId, accountId, { action: "add" }))).rejects.toThrow(/Höchstens/);
    await game.tacticSlotAction(careerId, accountId, { action: "delete", index: 2 });
    expect((await tacticView(careerId, accountId)).tactics.slots.length).toBe(2);

    // Training festigt die Taktik
    const before = (await tacticView(careerId, accountId)).familiarity;
    for (let i = 0; i < 10; i++) {
      const r = await advance(careerId, accountId);
      if (r.kind === "match") await quickMatch(careerId, accountId);
    }
    const later = (await tacticView(careerId, accountId)).familiarity;
    expect(later.total).toBeGreaterThan(before.total);
    expect(fam0).toBeGreaterThan(0);
  }, 120_000);
});
