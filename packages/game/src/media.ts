/**
 * Medien: Schlagzeilen und Artikel über Spiele, Liga, Transfers, Gerüchte und
 * Interviews. Artikel über den eigenen Verein sind markiert.
 */
import { Rng, computeStandings, dateOf, formatMoney, seedFor, squadRanks, type Player } from "@fl/sim";
import type pg from "pg";
import { pool, query, type Db } from "./db";
import { readCareer } from "./career";
import { type CareerRow, type ClubRow, type FixtureRow, getClub, getClubs, getLeague } from "./repo";

export type ArticleKind = "match" | "league" | "transfer" | "rumour" | "interview";

export interface Article {
  kind: ArticleKind;
  title: string;
  body: string;
  clubId?: number | null;
  playerId?: number | null;
  own?: boolean;
  importance?: number;
}

export async function addArticle(db: Db, career: CareerRow, a: Article) {
  await query(db,
    `insert into media(career_id, season, day, kind, title, body, club_id, player_id, own, importance)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [career.id, career.season, career.day, a.kind, a.title, a.body, a.clubId ?? null, a.playerId ?? null, !!a.own, a.importance ?? 1]);
}

const pick = <T>(rng: Rng, items: T[]) => items[rng.int(0, items.length - 1)];
const last = (name: string) => name.split(" ").slice(-1)[0];

interface ReportLine { playerId: number; name: string; side: 0 | 1; rating: number; goals: number; assists: number; started: boolean }

/** Spielbericht nach jedem eigenen Pflichtspiel. */
export async function matchArticle(
  db: pg.PoolClient, career: CareerRow, f: FixtureRow, home: ClubRow, away: ClubRow,
  score: { home: number; away: number; penHome?: number; penAway?: number }, position: number | null, competition: string,
) {
  const rng = new Rng(seedFor(career.seed, "media-match", f.id));
  const userHome = home.id === career.club_id;
  const own = userHome ? home : away;
  const opp = userHome ? away : home;
  const gf = userHome ? score.home : score.away;
  const ga = userHome ? score.away : score.home;
  const pens = score.penHome !== undefined;
  const won = gf > ga || (pens && (userHome ? score.penHome! > score.penAway! : score.penAway! > score.penHome!));
  const rep = await query<{ players: ReportLine[]; motm: number | null }>(db, "select data->'players' as players, (data->>'motm')::int as motm from match_reports where fixture_id = $1", [f.id]);
  const lines = rep[0]?.players ?? [];
  const mySide = userHome ? 0 : 1;
  const scorers = lines.filter((l) => l.side === mySide && l.goals > 0).sort((a, b) => b.goals - a.goals);
  const best = [...lines].sort((a, b) => b.rating - a.rating)[0];
  const myBest = lines.filter((l) => l.side === mySide).sort((a, b) => b.rating - a.rating)[0];
  const diff = gf - ga;
  const s = `${score.home}:${score.away}${pens ? ` (${score.penHome}:${score.penAway} i. E.)` : ""}`;
  const hero = scorers[0];
  let title: string;
  if (diff >= 3) title = pick(rng, [`${own.name} überrollt ${opp.name}`, `Gala von ${own.name}: ${s} gegen ${opp.name}`, `${opp.name} ohne Chance gegen ${own.name}`]);
  else if (won && hero && hero.goals >= 2) title = pick(rng, [`${hero.name} schiesst ${own.name} zum Sieg`, `${hero.goals >= 3 ? "Dreierpack" : "Doppelpack"} von ${last(hero.name)} – ${own.name} gewinnt ${s}`]);
  else if (won) title = pick(rng, [`${own.name} gewinnt ${s} gegen ${opp.name}`, `Wichtiger Sieg für ${own.name}`, `${own.name} setzt sich gegen ${opp.name} durch`]);
  else if (diff === 0) title = pick(rng, [`Remis zwischen ${home.name} und ${away.name}`, `${own.name} und ${opp.name} trennen sich ${s}`, `Punkteteilung für ${own.name}`]);
  else if (diff <= -3) title = pick(rng, [`Debakel für ${own.name}`, `${own.name} geht gegen ${opp.name} unter`, `Bittere Lehrstunde: ${s} gegen ${opp.name}`]);
  else title = pick(rng, [`Rückschlag für ${own.name}`, `${own.name} verliert ${s} gegen ${opp.name}`, `${opp.name} entführt die Punkte`].map((t) => (userHome ? t : t.replace("entführt die Punkte", "behält die Punkte zu Hause"))));
  const parts: string[] = [];
  parts.push(`${competition}: ${home.name} – ${away.name} ${s}.`);
  if (scorers.length) parts.push(`Für ${own.name} trafen ${scorers.map((x) => (x.goals > 1 ? `${x.name} (${x.goals})` : x.name)).join(", ")}.`);
  else if (gf === 0) parts.push(`${own.name} blieb ohne eigenen Treffer.`);
  if (best) parts.push(`Bester Spieler auf dem Platz war ${best.name} (Note ${best.rating.toFixed(1)}).`);
  if (position) parts.push(`${own.name} steht in der Tabelle nun auf Platz ${position}.`);
  const mood = won ? "Die Fans feierten ihre Mannschaft nach dem Schlusspfiff." : diff === 0 ? "Auf den Rängen hielt sich die Begeisterung in Grenzen." : "Nach dem Spiel gab es Pfiffe von den Rängen.";
  parts.push(mood);
  await addArticle(db, career, { kind: "match", title, body: parts.join(" "), clubId: own.id, own: true, importance: Math.abs(diff) >= 3 ? 3 : 2 });

  // Kurzinterview mit dem besten eigenen Spieler
  if (myBest && myBest.rating >= 7.8) {
    const quote = won
      ? pick(rng, ["Wir haben heute als Mannschaft funktioniert. So müssen wir weitermachen.", "Ich fühle mich im Moment richtig gut. Das Vertrauen des Trainers hilft enorm.", "Die drei Punkte sind das Wichtigste, meine Leistung ist zweitrangig."])
      : pick(rng, ["Persönlich lief es gut, aber das Ergebnis ärgert mich.", "Wir müssen schnell aufstehen. Nächste Woche zeigen wir ein anderes Gesicht."]);
    await addArticle(db, career, {
      kind: "interview", title: `${myBest.name}: „${quote.split(".")[0]}.“`,
      body: `${myBest.name} (Note ${myBest.rating.toFixed(1)}) nach dem Spiel gegen ${opp.name}: „${quote}“`,
      clubId: own.id, playerId: myBest.playerId, own: true,
    });
  }
}

/** Liga-Rundschau nach einem Ligaspieltag. */
export async function leagueRoundup(db: pg.PoolClient, career: CareerRow, leagueId: number, week: number) {
  const league = await getLeague(db, career.id, leagueId);
  if (!league) return;
  const fixtures = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and season = $2 and league_id = $3 and cup_id is null and played", [career.id, career.season, leagueId]);
  const today = fixtures.filter((f) => f.week === week);
  if (!today.length) return;
  const clubs = new Map((await getClubs(db, career.id, "league_id = $2", [leagueId])).map((c) => [c.id, c]));
  const table = computeStandings([...clubs.keys()], fixtures.map((f) => ({ homeId: f.home_id, awayId: f.away_id, homeGoals: f.home_goals ?? 0, awayGoals: f.away_goals ?? 0, round: f.round })));
  const leader = clubs.get(table[0].clubId)!;
  const second = table[1] ? clubs.get(table[1].clubId) : null;
  const gap = table[1] ? table[0].points - table[1].points : 0;
  const g = (f: FixtureRow) => ({ h: f.home_goals ?? 0, a: f.away_goals ?? 0 });
  const big = [...today].sort((x, y) => Math.abs(g(y).h - g(y).a) - Math.abs(g(x).h - g(x).a) || (g(y).h + g(y).a) - (g(x).h + g(x).a))[0];
  const bigHome = clubs.get(big.home_id)!;
  const bigAway = clubs.get(big.away_id)!;
  const round = today[0].round;
  const rng = new Rng(seedFor(career.seed, "media-league", career.season, week));
  const title = gap >= 6
    ? `${leader.name} enteilt der Konkurrenz`
    : gap === 0 && second ? `Spannung pur: ${leader.name} und ${second.name} punktgleich an der Spitze`
      : pick(rng, [`${leader.name} bleibt an der Spitze`, `${round}. Spieltag: ${leader.name} verteidigt Platz 1`]);
  const bottom = clubs.get(table[table.length - 1].clubId)!;
  const body = [
    `Nach dem ${round}. Spieltag der ${league.name} führt ${leader.name} mit ${table[0].points} Punkten${second ? `, ${gap === 0 ? "punktgleich mit" : `${gap} ${gap === 1 ? "Punkt" : "Punkte"} vor`} ${second.name}` : ""}.`,
    `Das Spiel des Tages: ${bigHome.name} – ${bigAway.name} ${big.home_goals}:${big.away_goals}.`,
    `Am Tabellenende steht ${bottom.name} mit ${table[table.length - 1].points} Punkten.`,
  ].join(" ");
  await addArticle(db, career, { kind: "league", title, body, clubId: leader.id, own: leader.id === career.club_id, importance: 1 });
}

/** Transfermeldungen der KI-Vereine. */
export async function transferArticles(db: Db, career: CareerRow, items: { text: string; clubId?: number; playerId?: number }[]) {
  for (const n of items.slice(0, 4)) {
    await addArticle(db, career, { kind: "transfer", title: n.text, body: n.text, clubId: n.clubId ?? null, playerId: n.playerId ?? null });
  }
}

/** Täglich: gelegentlich Transfergerüchte rund um den eigenen Verein. */
export async function dailyRumours(db: pg.PoolClient, career: CareerRow, squad: Player[], windowOpen: boolean): Promise<string | null> {
  if (!career.club_id) return null;
  const rng = new Rng(seedFor(career.seed, "media-rumour", career.season, career.day));
  if (!rng.chance(windowOpen ? 0.14 : 0.04)) return null;
  const own = (await getClub(db, career.id, career.club_id))!;
  const ranks = squadRanks(squad);
  const reliable = rng.chance(0.4);
  const source = reliable ? "Die Quelle gilt als gut informiert." : "Bestätigt ist bislang nichts.";
  if (rng.chance(0.55)) {
    // Ein grösserer Verein beobachtet einen eigenen Spieler
    const target = pick(rng, squad.filter((p) => (ranks.get(p.id) ?? 99) <= 8 && !p.loan));
    if (!target) return null;
    const suitors = (await getClubs(db, career.id, "players_generated and id <> $2 and reputation >= $3", [own.id, own.reputation - 3]))
      .sort((a, b) => b.reputation - a.reputation).slice(0, 30);
    if (!suitors.length) return null;
    const suitor = pick(rng, suitors);
    const title = pick(rng, [`${suitor.name} beobachtet ${target.firstName} ${target.lastName}`, `Gerücht: ${suitor.name} hat ${target.lastName} im Visier`, `Interesse an ${target.lastName}: ${suitor.name} schickt Scouts`]);
    await addArticle(db, career, {
      kind: "rumour", title,
      body: `${target.firstName} ${target.lastName} (${target.age}, ${target.position}) von ${own.name} soll bei ${suitor.name} auf dem Zettel stehen. Sein Marktwert wird auf ${formatMoney(target.value)} geschätzt. ${source}`,
      clubId: own.id, playerId: target.id, own: true,
    });
    return title;
  }
  // Der eigene Verein wird mit einem Spieler in Verbindung gebracht
  const rows = await query<{ data: Player; club_id: number; name: string }>(db,
    `select p.data, p.club_id, c.name from players p join clubs c on c.id = p.club_id and c.career_id = p.career_id
      where p.career_id = $1 and p.club_id <> $2 and c.players_generated and p.rating between $3 and $4 order by random() limit 1`,
    [career.id, own.id, own.rating - 2, own.rating + 8]);
  const r = rows[0];
  if (!r) return null;
  const title = pick(rng, [`${own.name} an ${r.data.firstName} ${r.data.lastName} interessiert?`, `Gerücht: ${own.name} beobachtet ${r.data.lastName} (${r.name})`]);
  await addArticle(db, career, {
    kind: "rumour", title,
    body: `Wie aus dem Umfeld von ${r.name} zu hören ist, soll ${own.name} ${r.data.firstName} ${r.data.lastName} (${r.data.age}, ${r.data.position}) beobachten. Sein Marktwert liegt bei rund ${formatMoney(r.data.value)}. ${source}`,
    clubId: own.id, playerId: r.data.id, own: true,
  });
  return title;
}

const KIND_LABEL: Record<ArticleKind, string> = { match: "Spielbericht", league: "Liga", transfer: "Transfers", rumour: "Gerücht", interview: "Interview" };

export async function mediaView(careerId: string, accountId: string, filter: string | null) {
  const career = await readCareer(careerId, accountId);
  const where = ["career_id = $1"];
  if (filter === "own") where.push("own");
  else if (filter && filter in KIND_LABEL) where.push(`kind = '${filter}'`);
  const rows = await query<{ id: number; season: number; day: number; kind: ArticleKind; title: string; body: string; club_id: number | null; player_id: number | null; own: boolean; importance: number }>(pool(),
    `select id, season, day, kind, title, body, club_id, player_id, own, importance from media where ${where.join(" and ")} order by id desc limit 80`, [career.id]);
  const playerIds = [...new Set(rows.map((r) => r.player_id).filter((x): x is number => x !== null))];
  const players = playerIds.length
    ? await query<{ id: number; data: Player; club_id: number | null }>(pool(), "select id, data, club_id from players where career_id = $1 and id = any($2::int[])", [career.id, playerIds])
    : [];
  const pmap = new Map(players.map((p) => [p.id, p]));
  const clubIds = [...new Set([...rows.map((r) => r.club_id), ...players.map((p) => p.club_id)].filter((x): x is number => x !== null))];
  const clubs = clubIds.length ? new Map((await getClubs(pool(), career.id, "id = any($2::int[])", [clubIds])).map((c) => [c.id, c])) : new Map<number, ClubRow>();
  const counts = await query<{ kind: string; n: string; own: string }>(pool(), "select kind, count(*) as n, count(*) filter (where own) as own from media where career_id = $1 group by kind", [career.id]);
  return {
    career: { season: career.season, day: career.day, clubId: career.club_id },
    counts: Object.fromEntries(counts.map((c) => [c.kind, Number(c.n)])),
    ownCount: counts.reduce((s, c) => s + Number(c.own), 0),
    articles: rows.map((r) => {
      const p = r.player_id !== null ? pmap.get(r.player_id) : undefined;
      const club = r.club_id !== null ? clubs.get(r.club_id) : undefined;
      const pclub = p?.club_id != null ? clubs.get(p.club_id) : undefined;
      return {
        id: r.id, kind: r.kind, kindLabel: KIND_LABEL[r.kind], title: r.title, body: r.body, own: r.own, importance: r.importance,
        date: dateOf(r.season, r.day).toISOString().slice(0, 10),
        club: club ? { id: club.id, name: club.name, colors: club.colors } : null,
        player: p ? { id: p.id, name: `${p.data.firstName} ${p.data.lastName}`, age: p.data.age, nationality: p.data.nationality, position: p.data.position, kit: pclub?.colors ?? null } : null,
      };
    }),
  };
}

/** Neueste Schlagzeilen für das Büro. */
export async function latestHeadlines(careerId: string, limit = 4) {
  const rows = await query<{ id: number; kind: ArticleKind; title: string; own: boolean; season: number; day: number }>(pool(),
    "select id, kind, title, own, season, day from media where career_id = $1 order by id desc limit $2", [careerId, limit]);
  return rows.map((r) => ({ id: r.id, kind: r.kind, kindLabel: KIND_LABEL[r.kind], title: r.title, own: r.own, date: dateOf(r.season, r.day).toISOString().slice(0, 10) }));
}

