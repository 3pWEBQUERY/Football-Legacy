/** Posteingang lesen: Absender ergänzen, filtern, seitenweise nachladen, archivieren. */
import { type Db, pool, query } from "./db";
import { readCareer, withCareer } from "./career";
import type { CareerRow } from "./repo";
import { senderResolver } from "./news";

export const INBOX_FILTERS: Record<string, string[]> = {
  match: ["match"],
  squad: ["medical", "training", "youth", "tips", "contract"],
  transfer: ["transfer", "scout"],
  club: ["board", "finance", "club"],
  media: ["news", "award", "international"],
  career: ["career"],
};

export async function inboxRows(db: Db, career: CareerRow, opts: { limit?: number; before?: number; filter?: string }) {
  const where = ["career_id = $1"];
  const params: unknown[] = [career.id];
  if (opts.before) { params.push(opts.before); where.push(`id < $${params.length}`); }
  if (opts.filter === "unread") where.push("not read");
  else if (opts.filter && INBOX_FILTERS[opts.filter]) { params.push(INBOX_FILTERS[opts.filter]); where.push(`category = any($${params.length}::text[])`); }
  const limit = Math.min(100, opts.limit ?? 40);
  const rows = await query<{ id: number; category: string; sender: unknown; title: string; body: string; read: boolean; day: number | null; season: number; week: number; action: unknown; blocks: unknown; priority: number; kind: string | null }>(db,
    `select id, season, week, day, category, title, body, read, action, created_at, sender, blocks, priority, kind
       from inbox where ${where.join(" and ")} order by id desc limit ${limit + 1}`, params);
  const resolve = await senderResolver(db, career);
  const more = rows.length > limit;
  return { rows: rows.slice(0, limit).map((r) => ({ ...r, sender: r.sender ?? resolve(r.category) })), more };
}

export async function inboxView(careerId: string, accountId: string, opts: { before?: number; filter?: string }) {
  const career = await readCareer(careerId, accountId);
  const { rows, more } = await inboxRows(pool(), career, { ...opts, limit: 40 });
  const counts = await query<{ category: string; n: number; unread: number }>(pool(),
    "select category, count(*)::int as n, count(*) filter (where not read)::int as unread from inbox where career_id = $1 group by category", [career.id]);
  const unreadBy: Record<string, number> = { all: 0, unread: 0 };
  for (const c of counts) {
    unreadBy.all += c.unread;
    unreadBy.unread += c.unread;
    for (const [f, cats] of Object.entries(INBOX_FILTERS)) if (cats.includes(c.category)) unreadBy[f] = (unreadBy[f] ?? 0) + c.unread;
  }
  return { messages: rows, more, unread: unreadBy };
}

export async function archiveInbox(careerId: string, accountId: string, ids: number[]) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!ids.length) return { removed: 0 };
    const r = await db.query("delete from inbox where career_id = $1 and id = any($2::int[])", [career.id, ids]);
    return { removed: r.rowCount ?? 0, message: ids.length === 1 ? "Nachricht archiviert" : `${ids.length} Nachrichten archiviert` };
  });
}
