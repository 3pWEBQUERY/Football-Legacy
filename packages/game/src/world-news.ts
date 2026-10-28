/**
 * Weltnachrichten: nach jedem „Weiter“ zeigt das Spiel, was in der
 * Fussballwelt passiert ist – Wechsel, Leihen, Interesse an Spielern,
 * Unruhe in Kadern, Spielberichte und Liga-Meldungen. Grundlage sind die
 * Medienartikel; `careers.media_seen_id` merkt sich, was schon gesehen wurde.
 */
import { Rng, dateOf, formatMoney, seedFor, type Player } from "@fl/sim";
import type pg from "pg";
import { one, pool, query, type Db } from "./db";
import { readCareer } from "./career";
import { type CareerRow, type ClubRow, getClub, getClubs } from "./repo";
import { addArticle, type ArticleKind, type WorldNewsData } from "./media";
import type { SquadNews } from "./ai-squads";

const LIMIT = 40;
const KIND_LABEL: Record<ArticleKind, string> = { match: "Spielbericht", league: "Liga", transfer: "Transfer", rumour: "Gerücht", interview: "Interview" };
const TYPE_LABEL: Record<WorldNewsData["type"], string> = { transfer: "Transfer", loan: "Leihe", interest: "Interesse", unrest: "Wechselwunsch" };

/** Wöchentliche Kaderpflege der KI als Artikel: Wechselwünsche und Leihen. */
export async function squadArticles(db: Db, career: CareerRow, items: SquadNews[]) {
  for (const n of items.slice(0, 6)) {
    await addArticle(db, career, n.type === "loan"
      ? { kind: "transfer", title: n.text.replace(/\.$/, ""), body: `${n.text} Der Verein will ihm Spielpraxis verschaffen; die Leihe läuft bis zum Saisonende.`, clubId: n.toClubId ?? n.clubId, playerId: n.playerId, data: { type: "loan", from: n.clubId, to: n.toClubId ?? null } }
      : { kind: "rumour", title: n.text.replace(/\.$/, ""), body: `${n.text} Er hat um ein Gespräch gebeten und steht ab sofort auf der Transferliste.`, clubId: n.clubId, playerId: n.playerId, data: { type: "unrest", from: n.clubId } });
  }
}

const pick = <T>(rng: Rng, items: T[]) => items[rng.int(0, items.length - 1)];

/**
 * Täglich: Gerüchte aus der Fussballwelt – ein grösserer Verein beobachtet
 * einen Spieler aus der eigenen Liga oder einen Star. Im Transferfenster öfter.
 */
export async function worldRumours(db: pg.PoolClient, career: CareerRow, windowOpen: boolean): Promise<number> {
  const rng = new Rng(seedFor(career.seed, "world-rumour", career.season, career.day));
  const count = windowOpen ? (rng.chance(0.45) ? 1 : 0) + (rng.chance(0.12) ? 1 : 0) : rng.chance(0.12) ? 1 : 0;
  if (!count) return 0;
  const own = career.club_id ? await getClub(db, career.id, career.club_id) : null;
  const rows = await query<{ data: Player; club_id: number }>(db, `
    select p.data, p.club_id from players p join clubs c on c.career_id = p.career_id and c.id = p.club_id
     where p.career_id = $1 and c.players_generated and ($2::int is null or c.id <> $2)
       and (p.data->>'loan') is null
       and (($3::int is not null and c.league_id = $3 and p.rating >= c.rating) or p.rating >= 80)
     order by md5(p.id::text || $4) limit $5`,
    [career.id, own?.id ?? null, own?.league_id ?? null, `${career.season}-${career.day}`, count]);
  let made = 0;
  for (const r of rows) {
    const p = r.data;
    const club = await getClub(db, career.id, r.club_id);
    if (!club) continue;
    const suitors = await getClubs(db, career.id, "players_generated and id <> $2 and ($3::int is null or id <> $3) and reputation between $4 and $5",
      [club.id, own?.id ?? null, club.reputation + 2, club.reputation + 30]);
    if (!suitors.length) continue;
    const suitor = pick(rng, suitors);
    const name = `${p.firstName} ${p.lastName}`;
    const title = pick(rng, [
      `${suitor.name} beobachtet ${name}`,
      `Gerücht: ${suitor.name} hat ${p.lastName} im Visier`,
      `${suitor.name} schickt Scouts zu ${p.lastName}`,
      `Interesse an ${p.lastName}: ${suitor.name} erkundigt sich bei ${club.name}`,
    ]);
    const source = rng.chance(0.45) ? "Die Quelle gilt als gut informiert." : "Bestätigt ist bislang nichts.";
    await addArticle(db, career, {
      kind: "rumour", title,
      body: `${name} (${p.age}, ${p.position}) von ${club.name} soll bei ${suitor.name} weit oben auf der Liste stehen. Sein Marktwert wird auf ${formatMoney(p.value)} geschätzt, ${p.contract ? `sein Vertrag läuft bis Sommer ${p.contract.untilSeason + 1}` : "er ist vereinslos"}. ${source}`,
      clubId: suitor.id, playerId: p.id, importance: p.rating >= 82 ? 2 : 1,
      data: { type: "interest", from: club.id, to: suitor.id },
    });
    made++;
  }
  return made;
}

interface MediaRow {
  id: number; season: number; day: number; kind: ArticleKind; title: string; body: string;
  club_id: number | null; player_id: number | null; own: boolean; importance: number; ai: boolean; data: WorldNewsData | null;
}

/** Ungelesene Weltnachrichten (neueste zuerst) mit Spielern und Vereinen für die Darstellung. */
export async function worldNewsView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  const seen = Number((await one<{ s: string }>(pool(), "select media_seen_id as s from careers where id = $1", [career.id]))?.s ?? 0);
  const rows = await query<MediaRow>(pool(),
    "select id, season, day, kind, title, body, club_id, player_id, own, importance, ai, data from media where career_id = $1 and id > $2 order by id desc limit $3",
    [career.id, seen, LIMIT]);
  const total = Number((await one<{ n: string }>(pool(), "select count(*) as n from media where career_id = $1 and id > $2", [career.id, seen]))?.n ?? 0);
  const latest = Number((await one<{ id: string | null }>(pool(), "select max(id) as id from media where career_id = $1", [career.id]))?.id ?? 0);

  const playerIds = [...new Set(rows.map((r) => r.player_id).filter((x): x is number => x !== null))];
  const players = playerIds.length
    ? await query<{ id: number; data: Player; club_id: number | null }>(pool(), "select id, data, club_id from players where career_id = $1 and id = any($2::int[])", [career.id, playerIds])
    : [];
  const pmap = new Map(players.map((p) => [p.id, p]));
  const clubIds = [...new Set([
    ...rows.flatMap((r) => [r.club_id, r.data?.from ?? null, r.data?.to ?? null]),
    ...players.map((p) => p.club_id),
  ].filter((x): x is number => x !== null && x !== undefined))];
  const clubs = clubIds.length ? new Map((await getClubs(pool(), career.id, "id = any($2::int[])", [clubIds])).map((c) => [c.id, c])) : new Map<number, ClubRow>();
  const club = (id: number | null | undefined) => {
    const c = id != null ? clubs.get(id) : undefined;
    return c ? { id: c.id, name: c.name, short: c.short_name, colors: c.colors, own: c.id === career.club_id } : null;
  };

  return {
    total,
    latestId: latest,
    clubId: career.club_id,
    items: rows.map((r) => {
      const p = r.player_id !== null ? pmap.get(r.player_id) : undefined;
      const type = r.data?.type ?? null;
      return {
        id: r.id, kind: r.kind, type,
        label: type ? TYPE_LABEL[type] : KIND_LABEL[r.kind],
        title: r.title, body: r.body, own: r.own, importance: r.importance, ai: r.ai,
        date: dateOf(r.season, r.day).toISOString().slice(0, 10),
        fee: r.data?.fee ?? null,
        from: club(r.data?.from), to: club(r.data?.to), club: club(r.club_id),
        player: p ? {
          id: p.id, name: `${p.data.firstName} ${p.data.lastName}`, age: p.data.age, nationality: p.data.nationality,
          position: p.data.position, value: p.data.value, kit: p.club_id != null ? clubs.get(p.club_id)?.colors ?? null : null,
        } : null,
      };
    }),
  };
}

/** Alle Meldungen bis `upTo` als gesehen markieren. */
export async function markWorldNewsSeen(careerId: string, accountId: string, upTo: number) {
  const career = await readCareer(careerId, accountId);
  await query(pool(), `update careers set media_seen_id = greatest(media_seen_id, least($2::bigint, coalesce((select max(id) from media where career_id = $1), 0))) where id = $1`, [career.id, upTo]);
  return { ok: true };
}

/** Zahl der ungelesenen Weltnachrichten (für die Kopfleiste). */
export async function worldNewsCount(db: Db, careerId: string): Promise<number> {
  const r = await one<{ n: string }>(db, "select count(*) as n from media m join careers c on c.id = m.career_id where c.id = $1 and m.id > c.media_seen_id", [careerId]);
  return Number(r?.n ?? 0);
}
