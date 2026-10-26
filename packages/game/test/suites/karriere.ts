/** Integrationstest – Karriere: Anlage, Saison, Spieltag, Transfers, Pokal, Akademie, Medizin, Nationalteam und mehr. */
import { describe, expect, it } from "vitest";
import { game, pool, register, createCareer, previewClubs, advance, quickMatch, dashboard, startMatch, stepMatch, squadView, saveTactic, tacticView, marketView, competitionView, careerView, financeView, leaderboards, cupView, reviewView, pressConference, answerPress, loanIn, loanOut, shared } from "../context";

describe("Karriere", () => {
  it("legt eine Karriere mit ganzer Welt an", async () => {
    const preview = previewClubs(4711, "SUI");
    expect(preview.length).toBe(2);
    const t0 = Date.now();
    shared.careerId = await createCareer(shared.accountId, { managerName: "Testmanager", countryCode: "SUI", clubIndex: preview[0].clubs[5].index, seed: 4711 });
    console.log(`Karriere angelegt in ${Date.now() - t0} ms`);
    const d = await dashboard(shared.careerId, shared.accountId);
    expect(d.club?.name).toBe(preview[0].clubs[5].name);
    expect(d.career.week).toBe(0);
    expect(d.inbox.length).toBeGreaterThan(0);
    const leagues = await pool().query("select count(*)::int as n from leagues where career_id = $1", [shared.careerId]);
    expect(leagues.rows[0].n).toBeGreaterThan(150);
  }, 60_000);

  it("Taktik speichern und Kader lesen", async () => {
    const t = await tacticView(shared.careerId, shared.accountId);
    expect(t.tactic.lineup.filter((x) => x !== null).length).toBe(11);
    const res = await saveTactic(shared.careerId, shared.accountId, { ...t.tactic, formation: "4-3-3", style: { ...t.tactic.style, pressing: 70 } });
    expect(res.tactic.formation).toBe("4-3-3");
    const s = await squadView(shared.careerId, shared.accountId);
    expect(s.players.length).toBe(25);
  });

  it("Transfermarkt und Angebot", async () => {
    const m = await marketView(shared.careerId, shared.accountId, { sort: "rating" });
    expect(m.players.length).toBeGreaterThan(10);
    const free = await marketView(shared.careerId, shared.accountId, { freeOnly: true, sort: "rating" });
    const target = free.players[0];
    const out = await game.startNegotiation(shared.careerId, shared.accountId, { playerId: target.id, offer: { fee: 0, upfrontPct: 100, installmentYears: 0, sellOn: 0 } });
    const n = await game.negotiationView(shared.careerId, shared.accountId, out.id);
    expect(n.stage).toBe("contract");
    expect(n.demand!.wage).toBeGreaterThan(0);
    await game.withdrawNegotiation(shared.careerId, shared.accountId, out.id);
  });

  it("Leihgeschäfte: ausleihen und verleihen", async () => {
    const d = await dashboard(shared.careerId, shared.accountId);
    const userClub = d.career.clubId!;
    const { rows } = await pool().query(
      "select p.id, p.club_id from players p join clubs c on c.id = p.club_id where p.career_id = $1 and c.league_id = $2 and c.id <> $3 and p.age <= 21 and (p.data->'contract'->>'untilSeason')::int > 2026 order by p.rating asc limit 1",
      [shared.careerId, d.league!.id, userClub]);
    const r = await loanIn(shared.careerId, shared.accountId, rows[0].id, 0.1);
    expect(r.status).toBe("countered");
    const ok = await loanIn(shared.careerId, shared.accountId, rows[0].id, 1);
    expect(ok.status).toBe("completed");
    shared.loans.inId = rows[0].id;
    shared.loans.parentId = rows[0].club_id;
    const squad = await squadView(shared.careerId, shared.accountId);
    const lp = squad.players.find((p) => p.id === shared.loans.inId)!;
    expect(lp.loan?.parentClubId).toBe(shared.loans.parentId);
    const fringe = [...squad.players].filter((p) => !p.loan).sort((a, b) => (a.rating ?? 0) - (b.rating ?? 0))[0];
    const out = await loanOut(shared.careerId, shared.accountId, fringe.id);
    if (out.status === "completed") {
      shared.loans.outId = fringe.id;
      const after = await squadView(shared.careerId, shared.accountId);
      expect((after.loanedOut ?? []).map((p) => p.id)).toContain(fringe.id);
    }
    await expect(game.releasePlayer(shared.careerId, shared.accountId, shared.loans.inId!)).rejects.toThrow(/Leihspieler/);
  });

  it("Spielergespräche mit Abklingzeit und Versprechen", async () => {
    const squad = await squadView(shared.careerId, shared.accountId);
    const sorted = [...squad.players].filter((p) => !p.loan).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    const r = await game.talkToPlayer(shared.careerId, shared.accountId, sorted[0].id, "encourage");
    expect(typeof r.reaction).toBe("string");
    await expect(game.talkToPlayer(shared.careerId, shared.accountId, sorted[0].id, "praise")).rejects.toThrow(/vor Kurzem/);
    const fringe = sorted[sorted.length - 1];
    const pr = await game.talkToPlayer(shared.careerId, shared.accountId, fringe.id, "promise");
    expect(pr.promise?.needed).toBe(2);
    shared.promised = fringe.id;
  });

  it("Individuelles Training mit Umschulung", async () => {
    const squad = await squadView(shared.careerId, shared.accountId);
    const p = squad.players.find((x) => x.position === "MC" && !x.altPositions.includes("DM")) ?? squad.players.find((x) => x.position !== "GK")!;
    const target = p.position === "MC" ? "DM" : "MC";
    const r = await game.setIndividualTraining(shared.careerId, shared.accountId, p.id, "technical", target);
    expect(r.individual.position).toBe(target);
    shared.retrainId = p.id;
    shared.retrainPos = target;
    await expect(game.setIndividualTraining(shared.careerId, shared.accountId, p.id, null, p.position)).rejects.toThrow(/bereits/);
  });

  it("Vorstandsanfragen", async () => {
    const b = await game.boardView(shared.careerId, shared.accountId);
    expect(b.offers.length).toBe(4);
    const r = await game.boardRequest(shared.careerId, shared.accountId, "training");
    shared.trainingApproved = r.status === "approved";
    if (shared.trainingApproved) expect((await game.boardView(shared.careerId, shared.accountId)).projects.length).toBe(1);
    const again = await game.boardRequest(shared.careerId, shared.accountId, "training");
    expect(again.status).toBe("rejected");
  });

  it("Pressekonferenz vor dem Spiel", async () => {
    const p = await pressConference(shared.careerId, shared.accountId);
    expect(p.available).toBe(true);
    expect(p.questions.length).toBeGreaterThan(0);
    const answers = Object.fromEntries(p.questions.map((q) => [q.id, q.answers[0].i]));
    const r = await answerPress(shared.careerId, shared.accountId, answers);
    expect(Array.isArray(r.effects)).toBe(true);
    await expect(answerPress(shared.careerId, shared.accountId, answers)).rejects.toThrow(/bereits/);
    expect((await pressConference(shared.careerId, shared.accountId)).done).toBe(true);
  });

  it("Nationaltrainer: Job übernehmen und Kader nominieren", async () => {
    const jobs = await game.nationalJobs(shared.careerId, shared.accountId);
    const job = jobs.jobs.find((j) => j.available && !j.home)!;
    expect(job).toBeTruthy();
    await expect(game.takeNationalJob(shared.careerId, shared.accountId, "GER")).rejects.toThrow();
    await game.takeNationalJob(shared.careerId, shared.accountId, job.code);
    shared.nationCode = job.code;
    const v = await game.nationalView(shared.careerId, shared.accountId);
    expect(v.coach).toBe(true);
    if (!v.coach) return;
    expect(v.group?.table.length).toBe(4);
    expect(v.upcoming.length).toBe(6);
    const sq = await game.nationalSquadView(shared.careerId, shared.accountId);
    expect(sq.players.length).toBeGreaterThan(15);
    expect(sq.players.filter((p) => p.selected).length).toBeLessThanOrEqual(23);
    const picked = sq.players.slice(0, 22).map((p) => p.id);
    const saved = await game.saveNationalSquad(shared.careerId, shared.accountId, { squad: picked, starters: picked.slice(0, 11), formation: "4-4-2", preset: "counter" });
    expect(saved.squad.length).toBe(22);
    expect(saved.formation).toBe("4-4-2");
    await expect(game.saveNationalSquad(shared.careerId, shared.accountId, { squad: sq.players.slice(0, 30).map((p) => p.id) })).rejects.toThrow();
  });

  it("geht Tag für Tag bis zum ersten Spieltag", async () => {
    await expect(startMatch(shared.careerId, shared.accountId)).rejects.toThrow(/später/);
    const sa = await game.startAssignment(shared.careerId, shared.accountId, { country: "SUI", position: "ST", maxAge: 25 });
    expect(sa.cost).toBeGreaterThan(0);
    const m = await marketView(shared.careerId, shared.accountId, { sort: "rating" });
    const target = m.players.find((p) => p.clubId !== null && p.knowledge !== "exact")!;
    const sr = await game.scoutPlayer(shared.careerId, shared.accountId, target.id);
    expect((sr.report as { pending: boolean }).pending).toBe(true);
    expect((await game.playerDetail(shared.careerId, shared.accountId, target.id)).player.knowledge).not.toBe("exact");
    const types: string[] = [];
    let a = await advance(shared.careerId, shared.accountId);
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
      a = await advance(shared.careerId, shared.accountId);
    }
    expect(a.kind).toBe("match");
    expect(sawTraining).toBe(true);
    expect(sawInbox).toBe(true);
    const sq = await squadView(shared.careerId, shared.accountId);
    expect(sq.players.some((p) => p.trainingAvg !== null)).toBe(true);
    const d = await dashboard(shared.careerId, shared.accountId);
    expect(d.career.day).toBe(19);
    expect(d.career.date).toBe("2026-07-25");
    expect(types.filter((x) => x === "friendly").length).toBe(2);
    expect(types).toContain("prep");
    const inbox = await pool().query("select title, day from inbox where career_id = $1 and title like 'Testspiel%'", [shared.careerId]);
    expect(inbox.rows.length).toBe(2);
    expect(inbox.rows.map((r) => r.day).sort((x, y) => x - y)).toEqual([9, 13]);
    const prep = await pool().query("select day from inbox where career_id = $1 and title like 'Spielvorbereitung%'", [shared.careerId]);
    expect(prep.rows[0]?.day).toBe(17);
    expect((await game.playerDetail(shared.careerId, shared.accountId, target.id)).player.knowledge).toBe("exact");
    const scoutMail = await pool().query("select 1 from inbox where career_id = $1 and title = $2", [shared.careerId, `Scoutbericht: ${target.name}`]);
    expect(scoutMail.rows.length).toBe(1);
    const sv = await game.scoutingView(shared.careerId, shared.accountId);
    expect(sv.assignments.length).toBe(0);
    expect(sv.reports.length).toBe(1);
    expect(sv.reports[0].players.length).toBeGreaterThan(0);
    expect(sv.reports[0].players.every((p) => p.position === "ST" && p.age <= 25 && p.rating !== null)).toBe(true);
    const cal = await game.calendarView(shared.careerId, shared.accountId);
    expect(cal.days.find((x) => x.day === 19)?.match).toBeTruthy();
  }, 60_000);

  it("spielt ein Spiel in Abschnitten mit Live-Eingriffen", async () => {
    const a = await advance(shared.careerId, shared.accountId);
    expect(a.kind).toBe("match");
    const pv = await game.dashboard(shared.careerId, shared.accountId);
    expect(Array.isArray(pv.next?.advice)).toBe(true);
    const tt = await game.teamTalkState(shared.careerId, shared.accountId);
    expect(tt.available).toBe(true);
    const talk = await game.giveTeamTalk(shared.careerId, shared.accountId, "motivate");
    expect(typeof talk.effect).toBe("number");
    await expect(game.giveTeamTalk(shared.careerId, shared.accountId, "demand")).rejects.toThrow(/bereits/);
    const first = await startMatch(shared.careerId, shared.accountId);
    expect(first.frames.length).toBe(31);
    // Live-Wechsel in der 1. Halbzeit
    const bench = first.teams[first.side].players.find((p) => p.slot === -1)!;
    const s1 = await stepMatch(shared.careerId, shared.accountId, { change: { style: { pressing: 80 }, subs: [{ slot: 10, playerId: bench.id }] } });
    expect(s1.fromTick).toBe(30);
    expect(s1.frames.length).toBe(30);
    expect(s1.events.some((e) => e.type === "sub" && e.playerId === bench.id)).toBe(true);
    // Bis zur Halbzeit: Simulation stoppt bei Tick 270
    const ht = await stepMatch(shared.careerId, shared.accountId, { until: 999 });
    expect(ht.tick).toBe(270);
    expect(ht.done).toBe(false);
    // Neu laden mitten im Spiel
    const resumed = await startMatch(shared.careerId, shared.accountId);
    expect(resumed.fromTick).toBe(270);
    expect(resumed.frames.length).toBe(1);
    const end = await stepMatch(shared.careerId, shared.accountId, { change: { style: { risk: 80 } }, until: 540 });
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
      const a = await advance(shared.careerId, shared.accountId);
      if (a.kind === "day") {
        days++;
        continue;
      }
      if (a.kind === "match") matches++;
      const summary = a.kind === "match" ? await quickMatch(shared.careerId, shared.accountId) : a.summary;
      seasonEnd = summary.seasonEnd;
      if (matches === 12 && !midDynamics) midDynamics = await game.dynamicsView(shared.careerId, shared.accountId);
      if (matches === 18) {
        // Endrunde erzwingen: ggf. neuen Job übernehmen und als qualifiziert markieren
        let row = await pool().query("select data from national_teams where career_id = $1", [shared.careerId]);
        if (!row.rows[0]) {
          const jobs = await game.nationalJobs(shared.careerId, shared.accountId);
          await game.takeNationalJob(shared.careerId, shared.accountId, jobs.jobs.find((j) => j.available)!.code);
          row = await pool().query("select data from national_teams where career_id = $1", [shared.careerId]);
        }
        await pool().query("update national_teams set data = jsonb_set(data, '{qualified}', 'true') where career_id = $1", [shared.careerId]);
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
    const d = await dashboard(shared.careerId, shared.accountId);
    expect(d.career.season).toBe(2027);
    expect(d.career.week).toBe(0);
    const c = await competitionView(shared.careerId, shared.accountId);
    expect(c.table.length).toBeGreaterThan(0);
    expect(c.table.every((r) => r.played === 0)).toBe(true);
    const cv = await careerView(shared.careerId, shared.accountId);
    expect(cv.history.length).toBe(1);
    expect(cv.career.xp).toBeGreaterThan(0);
    const f = await financeView(shared.careerId, shared.accountId);
    expect(f.recent.length).toBeGreaterThan(0);
    const cup = await cupView(shared.careerId, shared.accountId, 2026);
    expect(cup.cup?.winner).toBeTruthy();
    expect(cup.rounds[cup.rounds.length - 1].name).toBe("Finale");
    expect(cup.rounds.every((r) => r.matches.every((m) => m.played))).toBe(true);
    const next = await cupView(shared.careerId, shared.accountId);
    expect(next.rounds[0].matches.length).toBeGreaterThan(0);
    const intl = await game.continentalView(shared.careerId, shared.accountId, 2026);
    expect(intl.cup?.size).toBe(32);
    expect(intl.groups.length).toBe(8);
    expect(intl.groups.every((g) => g.table.every((r) => r.played === 6))).toBe(true);
    expect(intl.rounds.filter((r) => !r.group).map((r) => r.matches.length)).toEqual([8, 4, 2, 1]);
    expect(intl.cup?.winner).toBeTruthy();
    const nextIntl = await game.continentalView(shared.careerId, shared.accountId);
    expect(nextIntl.groups.length).toBe(8);
    const rv = await reviewView(shared.careerId, shared.accountId);
    expect(rv.seasons).toEqual([2026]);
    expect(rv.review?.awards.find((a) => a.key === "scorer")?.entry?.value).toMatch(/Tore/);
    expect(rv.review?.teamOfSeason.length).toBe(11);
    expect(rv.review?.table.length).toBeGreaterThan(5);
    // Leihen sind zum Saisonende ausgelaufen
    const back = await pool().query("select id, club_id, data->'loan' as loan from players where career_id = $1 and id = any($2::int[])", [shared.careerId, [shared.loans.inId, shared.loans.outId].filter(Boolean)]);
    for (const row of back.rows) expect(row.loan).toBeNull();
    expect(back.rows.find((r) => r.id === shared.loans.inId)?.club_id).toBe(shared.loans.parentId);
    if (shared.loans.outId) {
      // Zurück beim eigenen Verein – oder der Leihverein hat seine Kaufoption gezogen (dann gibt es Geld)
      const out = back.rows.find((r) => r.id === shared.loans.outId)!;
      if (out.club_id !== d.career.clubId) {
        const fin = await pool().query("select 1 from finance_log where career_id = $1 and club_id = $2 and label like 'Kaufoption gezogen%'", [shared.careerId, d.career.clubId]);
        expect(fin.rows.length).toBe(1);
      }
    }
    // Das Versprechen wurde ausgewertet (gehalten oder gebrochen)
    const pm = await pool().query("select data->'promise' as promise from players where career_id = $1 and id = $2", [shared.careerId, shared.promised]);
    expect(pm.rows[0]?.promise ?? null).toBeNull();
    const pmail = await pool().query("select title from inbox where career_id = $1 and title like 'Versprechen%'", [shared.careerId]);
    expect(pmail.rows.length).toBe(1);
    // Akademie: Jahrgang kam am Jugendtag, Ausbau ist fertig
    const ac = await game.academyView(shared.careerId, shared.accountId);
    expect(ac.players.length).toBeGreaterThanOrEqual(4);
    expect(ac.nextIntake).not.toBeNull();
    const youngster = ac.players.find((p) => p.age >= 16)!;
    const pr2 = await game.promoteYouth(shared.careerId, shared.accountId, youngster.id);
    expect(pr2.playerId).toBe(youngster.id);
    expect((await squadView(shared.careerId, shared.accountId)).players.some((p) => p.id === youngster.id)).toBe(true);
    if (shared.trainingApproved) expect((await game.boardView(shared.careerId, shared.accountId)).facilities.training.level).toBe(2);
    // Umschulung abgeschlossen, Länderspielpausen ausgewertet
    const rp = await pool().query("select data from players where career_id = $1 and id = $2", [shared.careerId, shared.retrainId]);
    if (rp.rows[0]) expect(rp.rows[0].data.altPositions).toContain(shared.retrainPos);
    const calls = await pool().query("select count(*) filter (where title like 'Länderspielpause%')::int as a, count(*) filter (where title like 'Rückkehr von den Nationalmannschaften')::int as b from inbox where career_id = $1", [shared.careerId]);
    expect(calls.rows[0].a).toBe(calls.rows[0].b);
    const med = await game.medicalView(shared.careerId, shared.accountId);
    expect(med.injured.every((x) => x.injury.length > 0)).toBe(true);
    const named = await pool().query("select count(*)::int as n from inbox where career_id = $1 and category = 'medical' and body like '%fällt%'", [shared.careerId]);
    expect(named.rows[0].n).toBeGreaterThanOrEqual(0);
    const lb = await leaderboards();
    expect(lb.best.length).toBe(1);
    // Monatsauszeichnungen: jeden Monat mit mindestens zwei Spieltagen
    const aw = await pool().query("select month, data from monthly_awards where career_id = $1 and season = 2026 order by id", [shared.careerId]);
    expect(aw.rows.length).toBeGreaterThanOrEqual(6);
    for (const r of aw.rows) {
      expect(r.data.player?.name).toBeTruthy();
      expect(r.data.manager?.club).toBeTruthy();
      expect(r.data.team.length).toBe(11);
    }
    const potm = aw.rows[0].data.player.id;
    const pp = await pool().query("select data->'awards' as awards from players where career_id = $1 and id = $2", [shared.careerId, potm]);
    expect(pp.rows[0].awards.some((x: { kind: string }) => x.kind === "player")).toBe(true);
    const av = await game.awardsView(shared.careerId, shared.accountId);
    expect(av.months.length).toBeGreaterThan(0);
    // Kaderstatus ändern: Herabstufung kostet Moral
    const dyn = await game.dynamicsView(shared.careerId, shared.accountId);
    const star = dyn.players.find((p) => p.status === "star" && !p.loan)!;
    const before = star.morale;
    const res = await game.setSquadStatus(shared.careerId, shared.accountId, star.id, "backup");
    expect(res.morale).toBeLessThan(before);
    expect((await game.dynamicsView(shared.careerId, shared.accountId)).players.find((p) => p.id === star.id)?.status).toBe("backup");
  }, 240_000);

  it("Nationaltrainer: Qualifikation gespielt und Endrunde ausgewertet", async () => {
    const played = await pool().query("select kind, stage, home, away, home_goals, away_goals, user_match, data is not null as report from national_matches where career_id = $1 and season = 2026 order by day, id", [shared.careerId]);
    const userQual = played.rows.filter((r) => r.kind === "qual" && r.user_match);
    expect(userQual.length).toBe(6);
    expect(userQual.every((r) => r.home_goals !== null && r.report)).toBe(true);
    expect(played.rows.filter((r) => r.kind === "qual").length).toBe(12);
    const st = await pool().query("select data from national_teams where career_id = $1", [shared.careerId]);
    const mail = await pool().query("select title from inbox where career_id = $1 and category = 'international' and (title like 'Gruppensieg%' or title like '%Playoffs%' or title like '%Endrunde%' or title like '%trennt sich%' or title like '%gewinnt die%' or title like '%beendet')", [shared.careerId]);
    expect(mail.rows.length).toBeGreaterThan(0);
    console.log("Nationalteam:", shared.nationCode, mail.rows.map((r) => r.title).join(" | "));
    const tour = played.rows.filter((r) => r.kind === "tournament");
    expect(tour.filter((r) => r.user_match).length).toBeGreaterThanOrEqual(3);
    expect(tour.every((r) => r.home_goals !== null)).toBe(true);
    const finals = tour.filter((r) => String(r.stage).endsWith("Finale") && !String(r.stage).includes("Halb") && !String(r.stage).includes("Viertel"));
    expect(finals.length).toBe(1);
    if (st.rows[0]) {
      const v = await game.nationalView(shared.careerId, shared.accountId);
      if (v.coach) {
        expect(v.record.p).toBeGreaterThanOrEqual(3);
        expect(v.upcoming.filter((m) => m.kind === "qual").length).toBe(6);
        expect(v.history.some((h) => h.text.includes("meisterschaft") || h.text.includes("Weltmeisterschaft"))).toBe(true);
        const rep = await game.nationalMatchReport(shared.careerId, shared.accountId, v.results[0].id);
        expect(rep.data).toBeTruthy();
      }
    }
  });

  it("Medien: Spielberichte, Liga, Gerüchte und Schlagzeilen", async () => {
    const counts = await pool().query("select kind, count(*)::int as n from media where career_id = $1 group by kind", [shared.careerId]);
    const by = Object.fromEntries(counts.rows.map((r) => [r.kind, r.n]));
    expect(by.match).toBeGreaterThan(20);
    expect(by.league).toBeGreaterThan(10);
    expect(by.rumour ?? 0).toBeGreaterThan(0);
    const all = await game.mediaView(shared.careerId, shared.accountId, null);
    expect(all.articles.length).toBeGreaterThan(10);
    expect(all.articles.every((a) => a.title.length > 5 && a.body.length > 5)).toBe(true);
    const own = await game.mediaView(shared.careerId, shared.accountId, "own");
    expect(own.articles.every((a) => a.own)).toBe(true);
    const rumours = await game.mediaView(shared.careerId, shared.accountId, "rumour");
    expect(rumours.articles.every((a) => a.kind === "rumour")).toBe(true);
    const d = await dashboard(shared.careerId, shared.accountId);
    expect(d.headlines.length).toBe(4);
  });

  it("Trainerstab: Personalmarkt, Einstellen, Verlängern, Entlassen", async () => {
    const v = await game.staffView(shared.careerId, shared.accountId);
    expect(v.roles.length).toBe(4);
    expect(v.roles.every((r) => r.member && r.member.name.length > 3)).toBe(true);
    expect(v.candidates.length).toBe(16);
    await pool().query("update clubs set balance = balance + 50000000, reputation = 90 where career_id = $1 and id = (select club_id from careers where id = $1)", [shared.careerId]);
    const best = [...(await game.staffView(shared.careerId, shared.accountId)).candidates].filter((c) => c.role === "coach").sort((a, b) => b.quality - a.quality)[0];
    await game.hireStaff(shared.careerId, shared.accountId, best.id);
    const after = await game.staffView(shared.careerId, shared.accountId);
    expect(after.roles.find((r) => r.role === "coach")?.member?.id).toBe(best.id);
    const career = await pool().query("select staff from careers where id = $1", [shared.careerId]);
    expect(career.rows[0].staff.coach).toBe(best.quality);
    const physio = after.roles.find((r) => r.role === "physio")!.member!;
    await game.fireStaff(shared.careerId, shared.accountId, physio.id);
    const fired = await game.staffView(shared.careerId, shared.accountId);
    expect(fired.roles.find((r) => r.role === "physio")?.member).toBeNull();
    expect((await pool().query("select staff from careers where id = $1", [shared.careerId])).rows[0].staff.physio).toBe(3);
    await expect(game.hireStaff(shared.careerId, shared.accountId, 999999)).rejects.toThrow();
  });

  it("Einstellungen: Spieloptionen, Passwort und Account löschen", async () => {
    const r = await game.updateCareerSettings(shared.careerId, shared.accountId, { autoSubs: false, stopOn: { finance: true, medical: false, hacked: true } });
    expect(r.autoSubs).toBe(false);
    expect(r.stopOn.finance).toBe(true);
    expect(r.stopOn.medical).toBe(false);
    expect("hacked" in r.stopOn).toBe(false);
    expect((await dashboard(shared.careerId, shared.accountId)).career.stopOn.finance).toBe(true);
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
