/**
 * Moderation im Liga-Chat: Nachrichten melden (ab zwei Meldungen automatisch
 * ausgeblendet), eigene Nachrichten löschen, Gründer löschen jede Nachricht,
 * Mitglieder blockieren (deren Nachrichten und Mitteilungen siehst du nicht mehr).
 */
import { one, pool, query } from "./db";
import { GameError } from "./errors";
import { notifyLater } from "./account/push";

/** Ab so vielen Meldungen verschiedener Mitglieder wird eine Nachricht ausgeblendet. */
export const AUTO_HIDE_REPORTS = 2;

interface PostRow { id: number; league_id: string; account_id: string | null; author: string; system: boolean; body: string; hidden: boolean }

async function memberPost(accountId: string, leagueId: string, postId: number) {
  const member = await one<{ id: number }>(pool(), "select id from online_members where league_id = $1 and account_id = $2 and not bot", [leagueId, accountId]);
  if (!member) throw new GameError("Nur Teilnehmer der Liga können das", 403);
  const post = await one<PostRow>(pool(), "select * from online_posts where id = $1 and league_id = $2", [postId, leagueId]);
  if (!post || post.hidden) throw new GameError("Nachricht nicht gefunden", 404);
  return post;
}

export async function reportOnlinePost(accountId: string, leagueId: string, postId: number, reason: string) {
  const post = await memberPost(accountId, leagueId, postId);
  if (post.system) throw new GameError("Meldungen der Liga können nicht gemeldet werden");
  if (post.account_id === accountId) throw new GameError("Eigene Nachrichten kannst du löschen statt melden");
  await query(pool(), "insert into online_reports(post_id, reporter_id, reason) values ($1,$2,$3) on conflict do nothing", [post.id, accountId, reason.trim().slice(0, 200) || null]);
  const n = (await one<{ n: number }>(pool(), "select count(*)::int as n from online_reports where post_id = $1", [post.id]))?.n ?? 0;
  const hidden = n >= AUTO_HIDE_REPORTS;
  if (hidden) await query(pool(), "update online_posts set hidden = true where id = $1", [post.id]);
  const league = await one<{ name: string; owner_id: string }>(pool(), "select name, owner_id from online_leagues where id = $1", [leagueId]);
  if (league && league.owner_id !== accountId) {
    notifyLater([league.owner_id], "online", { title: league.name, body: `Eine Nachricht von ${post.author} wurde gemeldet${hidden ? " und ausgeblendet" : ""}.`, url: `/online/${leagueId}`, tag: `online-${leagueId}-report` });
  }
  return { ok: true, hidden, message: hidden ? "Gemeldet – die Nachricht ist jetzt ausgeblendet." : "Danke, die Nachricht wurde gemeldet." };
}

export async function deleteOnlinePost(accountId: string, leagueId: string, postId: number) {
  const post = await memberPost(accountId, leagueId, postId);
  const league = await one<{ owner_id: string }>(pool(), "select owner_id from online_leagues where id = $1", [leagueId]);
  if (post.account_id !== accountId && league?.owner_id !== accountId) throw new GameError("Nur eigene Nachrichten – oder als Gründer alle – lassen sich löschen", 403);
  if (post.system && league?.owner_id !== accountId) throw new GameError("Meldungen der Liga können nicht gelöscht werden", 403);
  await query(pool(), "update online_posts set hidden = true where id = $1", [post.id]);
  return { ok: true, message: "Nachricht gelöscht" };
}

/** Den Verfasser einer Nachricht blockieren (gilt für alle Ligen). */
export async function blockOnlineAuthor(accountId: string, leagueId: string, postId: number) {
  const post = await memberPost(accountId, leagueId, postId);
  if (!post.account_id || post.system) throw new GameError("Die Liga selbst kann nicht blockiert werden");
  if (post.account_id === accountId) throw new GameError("Du kannst dich nicht selbst blockieren");
  await query(pool(), "insert into online_blocks(account_id, blocked_id) values ($1,$2) on conflict do nothing", [accountId, post.account_id]);
  return { ok: true, message: `${post.author} ist blockiert. Du siehst seine Nachrichten nicht mehr.` };
}

export async function unblockOnline(accountId: string, blockedId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(blockedId)) throw new GameError("Unbekannter Eintrag", 404);
  await query(pool(), "delete from online_blocks where account_id = $1 and blocked_id = $2", [accountId, blockedId]);
  return { ok: true, message: "Blockierung aufgehoben" };
}

/** Blockierte Accounts mit ihrem Anzeigenamen (für die Liste in der Liga-Ansicht). */
export async function blockedList(accountId: string) {
  return query<{ id: string; name: string }>(pool(),
    "select a.id, a.display_name as name from online_blocks b join accounts a on a.id = b.blocked_id where b.account_id = $1 order by b.created_at desc", [accountId]);
}

/** Wer hat den Absender blockiert? (Diese Mitglieder bekommen keine Chat-Mitteilungen von ihm.) */
export async function blockersOf(authorId: string): Promise<Set<string>> {
  const rows = await query<{ account_id: string }>(pool(), "select account_id from online_blocks where blocked_id = $1", [authorId]);
  return new Set(rows.map((r) => r.account_id));
}
