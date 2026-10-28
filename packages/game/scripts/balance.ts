/**
 * Balancing-Messung: legt eine Karriere an, simuliert mehrere Saisons ohne
 * Eingriffe (Schnellsimulation) und gibt je Saison Kennzahlen aus – Wirtschaft
 * des eigenen Vereins und der KI-Vereine, Torquote, Spielerniveau, Transfers
 * und Vorstand. Nutzt eine eigene Datenbank (BALANCE_DATABASE_URL).
 *
 *   pnpm --filter @fl/game balance [Saisons] [Land] [Vereinsindex] [Seed] [--active] [--check]
 *
 * --check prüft am Ende Grenzwerte für die Langzeit-Stabilität (Wirtschaft,
 * Altersstruktur, Torquote, Vereinslose, Rechenzeit) und endet bei einer
 * Verletzung mit Fehlercode 1.
 */
process.env.DATABASE_URL = process.env.BALANCE_DATABASE_URL ?? "postgres://fl:fl@localhost:5432/football_legacy_balance";

const game = await import("../src/index");
const { pool } = game;

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
/** --active: verlängert zu Saisonbeginn die Verträge der Stammspieler (wie ein aktiver Manager). */
const active = process.argv.includes("--active");
const check = process.argv.includes("--check");
/** --unemployed: tritt zu Beginn zurück und bleibt vereinslos (prüft die Welt ohne eigenen Verein). */
const unemployed = process.argv.includes("--unemployed");
const [seasons = "3", country = "GER", clubIndex = "8", seed = "4242"] = args;
const db = pool();
await db.query("drop schema public cascade; create schema public;");
await game.migrate();
const { account } = await game.register(`balance${Date.now()}@example.com`, "geheim123", "Balance");
const preview = game.previewClubs(Number(seed), country);
const club = preview[0].clubs[Number(clubIndex)];
const cid = await game.createCareer(account.id, { managerName: "Balance", countryCode: country, clubIndex: club.index, seed: Number(seed) });
const acc = account.id;
if (unemployed) await game.resignJob(cid, acc);
const q = async <T = Record<string, number>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];
const mio = (v: number) => `${(v / 1e6).toFixed(1)} Mio.`;
const pct = (v: number) => `${Math.round(v * 100)} %`;

async function world() {
  const [p] = await q(`select avg(p.rating)::float as rating, avg((p.data->>'age')::int)::float as age, avg((p.data->>'value')::bigint)::float as value,
      count(*) filter (where p.rating >= 80)::int as stars, count(*)::int as n,
      count(*) filter (where (p.data->>'age')::int <= 21 and p.rating >= 65)::int as talents
    from players p join clubs c on c.career_id = p.career_id and c.id = p.club_id where p.career_id = $1 and c.players_generated`, [cid]);
  const clubs = await q<{ balance: number; rating: number; own: boolean }>(`select balance::float as balance, rating, id = (select club_id from careers where id = $1) as own
    from clubs where career_id = $1 and players_generated`, [cid]);
  const [sq] = await q(`select percentile_cont(0.5) within group (order by n)::float as median, max(n)::int as max, count(*)::int as clubs,
      (select count(*)::int from players where career_id = $1 and club_id is null) as free,
      (select avg(top)::float from (select avg(r) as top from (select p.club_id, p.rating as r, row_number() over (partition by p.club_id order by p.rating desc) as rk
         from players p join clubs c on c.career_id = p.career_id and c.id = p.club_id where p.career_id = $1 and c.players_generated) t where rk <= 11 group by club_id) x) as best11
    from (select p.club_id, count(*) as n from players p join clubs c on c.career_id = p.career_id and c.id = p.club_id where p.career_id = $1 and c.players_generated group by p.club_id) s`, [cid]);
  const [fixed] = await q(`select avg(top)::float as best11, count(*) filter (where top >= 78)::int as elite from (select avg(r) as top from (
      select p.club_id, p.rating as r, row_number() over (partition by p.club_id order by p.rating desc) as rk
        from players p where p.career_id = $1 and p.club_id = any($2::int[])) t where rk <= 11 group by club_id) x`, [cid, initial]);
  return { p, clubs, sq, fixed };
}

// Feste Vergleichsgruppe: Vereine, die schon zum Start einen Kader haben (später aktivierte verzerren sonst den Schnitt)
const initial = (await q<{ id: number }>("select id from clubs where career_id = $1 and players_generated", [cid])).map((c) => c.id);
console.log(`Karriere ${cid}: ${club.name} (${preview[0].name}), ${seasons} Saisons`);
let before = await world();
const start = before;
const rows: Record<string, string | number>[] = [];
for (let s = 0; s < Number(seasons); s++) {
  const t0 = Date.now();
  const career = await game.readCareer(cid, acc);
  const season = career.season;
  let renewed = 0;
  if (active && career.club_id) {
    const squad = await q<{ id: number; until: number }>(`select id, (data->'contract'->>'untilSeason')::int as until from players
      where career_id = $1 and club_id = $2 and data->'loan' is null order by rating desc limit 22`, [cid, career.club_id]);
    for (const p of squad.filter((x) => x.until <= season)) {
      try {
        const r = await game.startRenewal(cid, acc, p.id);
        const v = await game.negotiationView(cid, acc, r.id);
        if (v.demand && (await game.offerContract(cid, acc, r.id, v.demand)).status === "completed") renewed++;
      } catch { /* Spieler will nicht verlängern */ }
    }
  }
  let end = null;
  const trace: number[] = [];
  const fans: number[] = [];
  // Verfügbarkeit je Spieltag: Verletzte und Gesperrte im eigenen Verein und im Schnitt der eigenen Liga
  const avail = { own: [] as number[], league: [] as number[], ownSusp: [] as number[], leagueSusp: [] as number[] };
  for (let i = 0; i < 2000 && !end; i++) {
    const a = await game.advance(cid, acc);
    if (a.kind === "day") continue;
    const summary = a.kind === "match" ? await game.quickMatch(cid, acc) : a.summary;
    end = summary.seasonEnd;
    if (a.kind === "match" && !end) {
      const c = await game.readCareer(cid, acc);
      const [h] = await q(`select
          count(*) filter (where p.club_id = $2 and (p.data->>'injuryWeeks')::int > 0)::float as own,
          count(*) filter (where (p.data->>'injuryWeeks')::int > 0)::float / nullif(count(distinct p.club_id), 0) as league,
          count(*) filter (where p.club_id = $2 and (p.data->>'suspendedWeeks')::int > 0)::float as own_susp,
          count(*) filter (where (p.data->>'suspendedWeeks')::int > 0)::float / nullif(count(distinct p.club_id), 0) as league_susp
        from players p join clubs cl on cl.career_id = p.career_id and cl.id = p.club_id
        where p.career_id = $1 and cl.league_id = (select league_id from clubs where career_id = $1 and id = $2)`, [cid, c.club_id]);
      if (c.club_id && h.league !== null) { avail.own.push(h.own); avail.league.push(h.league); avail.ownSusp.push(h.own_susp); avail.leagueSusp.push(h.league_susp); }
      trace.push(Math.round(c.board.confidence));
      fans.push(Math.round((await q<{ s: number }>("select (club_mgmt->>'satisfaction')::float as s from careers where id = $1", [cid]))[0]?.s ?? -1));
    }
  }
  console.log(`Vertrauen je Spiel: ${trace.join(" ")}`);
  console.log(`Fanstimmung je Spiel: ${fans.join(" ")}`);
  if (!end) throw new Error("Saisonende nicht erreicht");
  const own = (await game.readCareer(cid, acc));
  const fin = await q<{ kind: string; sum: number }>("select kind, sum(amount)::float as sum from finance_log where career_id = $1 and club_id = $2 and season = $3 group by kind order by kind", [cid, own.club_id, season]);
  const tr = await q(`select count(*)::int as n, coalesce(avg(fee),0)::float as avg, coalesce(max(fee),0)::float as max,
      count(*) filter (where to_club = $3 or from_club = $3)::int as own
    from transfers where career_id = $1 and season = $2 and status = 'completed' and fee > 0`, [cid, season, own.club_id]);
  const cs = await q(`select avg(gf + ga)::float / nullif(avg(played),0) as gpg from club_seasons where career_id = $1 and season = $2 and played > 0`, [cid, season]);
  // Karten und Verletzungen aus den Spielberichten der eigenen Liga
  const [cards] = await q(`select count(*)::int as matches,
      coalesce(sum((select coalesce(sum((l->>'yellow')::int), 0) from jsonb_array_elements(r.data->'players') l)), 0)::float / greatest(count(*), 1) as yellow,
      coalesce(sum((select count(*) from jsonb_array_elements(r.data->'players') l where (l->>'red')::boolean)), 0)::float / greatest(count(*), 1) as red,
      coalesce(sum((select count(*) from jsonb_array_elements(r.data->'players') l where (l->>'injured')::boolean)), 0)::float / greatest(count(*), 1) as injured
    from match_reports r join fixtures f on f.id = r.fixture_id where r.career_id = $1 and f.season = $2 and f.cup_id is null`, [cid, season]);
  const avg = (xs: number[]) => xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : 0;
  const after = await world();
  const ai = after.clubs.filter((c) => !c.own);
  const aiBal = ai.map((c) => c.balance).sort((a, b) => a - b);
  const median = (xs: number[]) => xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  const beforeAi = before.clubs.filter((c) => !c.own).map((c) => c.balance).sort((a, b) => a - b);
  const ownBefore = before.clubs.find((c) => c.own)?.balance ?? 0;
  const ownAfter = after.clubs.find((c) => c.own)?.balance ?? 0;
  const income = fin.filter((f) => f.sum > 0).reduce((a, f) => a + f.sum, 0);
  const costs = fin.filter((f) => f.sum < 0).reduce((a, f) => a + f.sum, 0);
  console.log(`\n=== Saison ${season} (${((Date.now() - t0) / 1000).toFixed(0)} s) – Platz ${end.position}, ${end.points} Punkte${end.champion ? ", Meister" : ""}${end.promoted ? ", Aufstieg" : ""}${end.relegated ? ", Abstieg" : ""}${end.dismissed ? ", ENTLASSEN" : ""}`);
  console.log(`Eigener Verein: ${mio(ownBefore)} → ${mio(ownAfter)} (${ownAfter >= ownBefore ? "+" : ""}${mio(ownAfter - ownBefore)}) | Einnahmen ${mio(income)} Ausgaben ${mio(-costs)} | Vertrauen ${own.board.confidence}${active ? ` | verlängert ${renewed}` : ""}`);
  console.log(`  ${fin.map((f) => `${f.kind} ${mio(f.sum)}`).join(" · ")}`);
  console.log(`KI-Vereine: Median ${mio(median(beforeAi))} → ${mio(median(aiBal))} | im Minus ${ai.filter((c) => c.balance < 0).length}/${ai.length} | reichster ${mio(aiBal[aiBal.length - 1] ?? 0)}`);
  console.log(`Spieler: Ø Stärke ${before.p.rating.toFixed(1)} → ${after.p.rating.toFixed(1)} | Stars ≥80 ${before.p.stars} → ${after.p.stars} | Talente ${before.p.talents} → ${after.p.talents} | Ø Alter ${after.p.age.toFixed(1)} | Ø Marktwert ${mio(after.p.value)} | Spieler ${before.p.n} → ${after.p.n}`);
  console.log(`Kader: Median ${after.sq.median} Spieler, grösster ${after.sq.max}, Vereine ${after.sq.clubs} | Vereinslose ${before.sq.free} → ${after.sq.free} | Ø beste Elf ${before.sq.best11.toFixed(1)} → ${after.sq.best11.toFixed(1)} (Startvereine ${before.fixed.best11.toFixed(1)} → ${after.fixed.best11.toFixed(1)})`);
  console.log(`Karten je Spiel: Gelb ${cards.yellow.toFixed(2)}, Rot ${cards.red.toFixed(2)} | Verletzungen im Spiel ${cards.injured.toFixed(2)} je Spiel (${cards.matches} Ligaspiele)`);
  console.log(`Verfügbarkeit: Verletzte Ø ${avg(avail.own).toFixed(1)} eigener Verein (max ${Math.max(0, ...avail.own)}), Ø ${avg(avail.league).toFixed(1)} je Ligaverein | Gesperrte Ø ${avg(avail.ownSusp).toFixed(2)} / ${avg(avail.leagueSusp).toFixed(2)}`);
  console.log(`Transfers mit Ablöse: ${tr[0].n} (eigene ${tr[0].own}), Ø ${mio(tr[0].avg)}, Rekord ${mio(tr[0].max)} | Tore/Spiel ${(cs[0]?.gpg ?? 0).toFixed(2)}`);
  rows.push({ seconds: Math.round((Date.now() - t0) / 1000), aiMinus: +(ai.filter((c) => c.balance < 0).length / Math.max(1, ai.length)).toFixed(2), aiMedianAbs: Math.round(median(aiBal)), age: +after.p.age.toFixed(1), talents: after.p.talents, clubs: after.sq.clubs, season, position: end.position, own: Math.round(ownAfter - ownBefore), aiMedian: Math.round(median(aiBal) - median(beforeAi)), rating: +after.p.rating.toFixed(1), stars: after.p.stars, starShare: +(after.p.stars / Math.max(1, after.p.n)).toFixed(4), best11: +after.fixed.best11.toFixed(1), squad: after.sq.median, free: after.sq.free, gpg: +(cs[0]?.gpg ?? 0).toFixed(2), confidence: own.board.confidence,
    matches: cards.matches, weeks: (await game.readCareer(cid, acc)).season_weeks, yellow: +cards.yellow.toFixed(2), red: +cards.red.toFixed(3), injOwn: +avg(avail.own).toFixed(2), injLeague: +avg(avail.league).toFixed(2), maxInjOwn: Math.max(0, ...avail.own) });
  before = after;
}
console.log("\nZusammenfassung", JSON.stringify(rows));
await db.end();

if (check && rows.length) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const startAge = start.p.age;
  const startMedian = (() => { const xs = start.clubs.filter((c) => !c.own).map((c) => c.balance).sort((a, b) => a - b); return xs[Math.floor(xs.length / 2)] ?? 0; })();
  const n = (v: string | number) => Number(v);
  const played = rows.filter((r) => n(r.matches) > 0);
  const rules: [string, boolean][] = [
    [`KI-Vereine im Minus höchstens 12 % (zuletzt ${Math.round(n(last.aiMinus) * 100)} %)`, n(last.aiMinus) <= 0.12],
    [`KI-Kontostand (Median) mindestens 60 % des Starts (${mio(n(last.aiMedianAbs))} von ${mio(startMedian)})`, n(last.aiMedianAbs) >= startMedian * 0.6],
    [`Ø Alter höchstens 1 Jahr unter dem Start (${n(last.age)} statt ${startAge.toFixed(1)})`, n(last.age) >= startAge - 1],
    [`Tore pro Spiel in jeder Saison zwischen 2,5 und 3,0`, rows.every((r) => n(r.gpg) >= 2.5 && n(r.gpg) <= 3.0)],
    [`Vereinslose höchstens 1,6 je Verein (${last.free} bei ${last.clubs} Vereinen)`, n(last.free) <= n(last.clubs) * 1.6],
    [`Ø beste Elf der Startvereine stabil (±2: ${n(last.best11)} statt ${start.fixed.best11.toFixed(1)})`, Math.abs(n(last.best11) - start.fixed.best11) <= 2],
    [`Anteil Stars ≥80 höchstens 30 % über dem Start (${(n(last.starShare) * 100).toFixed(1)} % statt ${(start.p.stars / Math.max(1, start.p.n) * 100).toFixed(1)} %)`, n(last.starShare) <= (start.p.stars / Math.max(1, start.p.n)) * 1.3],
    // Karten und Verletzte nur in Saisons mit eigener Liga (ohne Verein gibt es keine Spielberichte)
    [`Gelbe Karten je Spiel in jeder Saison zwischen 2,4 und 4,2 (${played.map((r) => r.yellow).join(", ")})`, played.every((r) => n(r.yellow) >= 2.4 && n(r.yellow) <= 4.2)],
    [`Rote Karten je Spiel in jeder Saison höchstens 0,16 (${played.map((r) => r.red).join(", ")})`, played.every((r) => n(r.red) <= 0.16)],
    [`Verletzte je Verein im Schnitt höchstens 2,5, eigener Verein höchstens 3 (${played.map((r) => `${r.injLeague}/${r.injOwn}`).join(", ")})`, played.every((r) => n(r.injLeague) <= 2.5 && n(r.injOwn) <= 3)],
    [`Saisonlänge stabil: höchstens 4 Kalenderwochen mehr als zu Beginn (${rows.map((r) => r.weeks).join(", ")})`, rows.every((r) => n(r.weeks) <= n(first.weeks) + 4)],
    [`Rechenzeit der letzten Saison höchstens doppelt so lang wie die erste (${last.seconds} s statt ${first.seconds} s)`, n(last.seconds) <= n(first.seconds) * 2],
  ];
  console.log("\nPrüfung Langzeit-Stabilität");
  for (const [text, ok] of rules) console.log(`${ok ? "✔" : "✘"} ${text}`);
  if (rules.some(([, ok]) => !ok)) process.exit(1);
}
