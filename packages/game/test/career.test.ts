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

  it("geht Tag für Tag bis zum ersten Spieltag", async () => {
    await expect(startMatch(careerId, accountId)).rejects.toThrow(/später/);
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
    for (let i = 0; i < 1000 && !seasonEnd; i++) {
      const a = await advance(careerId, accountId);
      if (a.kind === "day") {
        days++;
        continue;
      }
      const summary = a.kind === "match" ? await quickMatch(careerId, accountId) : a.summary;
      seasonEnd = summary.seasonEnd;
    }
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
    const lb = await leaderboards();
    expect(lb.best.length).toBe(1);
  }, 240_000);
});
