/**
 * Admin-Bereich (Zugang über ADMIN_EMAILS): Kennzahlen, gemeldete
 * Chat-Nachrichten, Konten (sperren, Namen zurücksetzen, löschen) und die
 * Kosten der KI-Funktionen. Jede Aktion wird im Admin-Protokoll vermerkt.
 */
import crypto from "node:crypto";
import { one, pool, query } from "./db";
import { GameError } from "./errors";
import { isAdmin } from "./monitoring";
import { layout, mailConfigured, sendMail } from "./account/mail";

/** Listenpreise Claude Sonnet 5.5 (US-Dollar pro Million Tokens) für die Kostenschätzung. */
const PRICE_IN = 2;
const PRICE_OUT = 10;

function requireAdmin(email: string | null | undefined): string {
  if (!isAdmin(email)) throw new GameError("Nur für Administratoren", 403);
  return email!;
}

async function logAction(admin: string, action: string, target: string | null, detail: Record<string, unknown> = {}) {
  await query(pool(), "insert into admin_actions(admin_email, action, target_account, detail) values ($1,$2,$3,$4)", [admin, action, target, JSON.stringify(detail)]);
}

const usd = (inTok: number, outTok: number) => Math.round(((inTok * PRICE_IN + outTok * PRICE_OUT) / 1_000_000) * 100) / 100;

export async function adminOverview(email: string) {
  requireAdmin(email);
  const n = async (sql: string) => (await one<{ n: number }>(pool(), sql))?.n ?? 0;
  const ai = await one<{ req: number; tin: number; tout: number; failed: number }>(pool(),
    "select count(*)::int as req, coalesce(sum(input_tokens),0)::int as tin, coalesce(sum(output_tokens),0)::int as tout, count(*) filter (where not ok)::int as failed from ai_log where created_at > now() - interval '1 day'");
  return {
    accounts: await n("select count(*)::int as n from accounts"),
    newAccounts7: await n("select count(*)::int as n from accounts where created_at > now() - interval '7 days'"),
    active1: await n("select count(*)::int as n from accounts where last_login_day >= current_date"),
    active7: await n("select count(*)::int as n from accounts where last_login_day >= current_date - 6"),
    banned: await n("select count(*)::int as n from accounts where banned_until > now()"),
    careers: await n("select count(*)::int as n from careers"),
    careersActive7: await n("select count(*)::int as n from careers where updated_at > now() - interval '7 days'"),
    onlineLeagues: await n("select count(*)::int as n from online_leagues"),
    openReports: await n("select count(distinct post_id)::int as n from online_reports where resolved_at is null"),
    errors1: await n("select count(*)::int as n from error_log where created_at > now() - interval '1 day'"),
    ai: { requests: ai?.req ?? 0, failed: ai?.failed ?? 0, costUsd: usd(ai?.tin ?? 0, ai?.tout ?? 0) },
  };
}

export async function adminReports(email: string) {
  requireAdmin(email);
  const rows = await query<{ post_id: number; body: string; author: string; account_id: string | null; league_id: string; league: string; hidden: boolean; reports: number; reasons: string[]; last_at: string; created_at: string }>(pool(), `
    select p.id as post_id, p.body, p.author, p.account_id, p.league_id, l.name as league, p.hidden, count(*)::int as reports,
           array_remove(array_agg(r.reason), null) as reasons, max(r.created_at) as last_at, p.created_at
      from online_reports r join online_posts p on p.id = r.post_id join online_leagues l on l.id = p.league_id
     where r.resolved_at is null
     group by p.id, l.name order by max(r.created_at) desc limit 100`);
  return { reports: rows };
}

/** Meldung bearbeiten: verwerfen (Nachricht wieder sichtbar) oder Nachricht entfernen, optional mit Sperre des Verfassers. */
export async function resolveReport(email: string, postId: number, action: "dismiss" | "remove" | "remove_ban", banDays = 7) {
  const admin = requireAdmin(email);
  const post = await one<{ id: number; account_id: string | null; body: string }>(pool(), "select id, account_id, body from online_posts where id = $1", [postId]);
  if (!post) throw new GameError("Nachricht nicht gefunden", 404);
  await query(pool(), "update online_posts set hidden = $2 where id = $1", [postId, action !== "dismiss"]);
  await query(pool(), "update online_reports set resolved_at = now(), resolution = $2 where post_id = $1 and resolved_at is null", [postId, action]);
  await logAction(admin, `report_${action}`, post.account_id, { postId, body: post.body.slice(0, 200) });
  if (action === "remove_ban" && post.account_id) await banAccount(email, post.account_id, banDays, "Verstoss gegen die Verhaltensregeln im Liga-Chat");
  return { ok: true, message: action === "dismiss" ? "Meldung verworfen – die Nachricht ist wieder sichtbar." : action === "remove" ? "Nachricht entfernt." : "Nachricht entfernt und Verfasser gesperrt." };
}

export async function adminAccounts(email: string, q: string) {
  requireAdmin(email);
  const term = `%${q.trim().toLowerCase()}%`;
  const rows = await query(pool(), `
    select a.id, a.email, a.display_name, a.created_at, a.last_login_day, a.email_verified_at is not null as verified, coalesce(a.banned_until > now(), false) as banned, case when a.banned_until = 'infinity' then 'dauerhaft' else to_char(a.banned_until, 'DD.MM.YYYY HH24:MI') end as banned_until, a.ban_reason,
           (select count(*)::int from careers k where k.account_id = a.id) as careers,
           (select count(*)::int from online_reports r join online_posts p on p.id = r.post_id where p.account_id = a.id) as reported
      from accounts a
     where $1 = '%%' or lower(a.email) like $1 or lower(a.display_name) like $1 or a.id::text = $2
     order by a.created_at desc limit 50`, [term, q.trim()]);
  return { accounts: rows };
}

export async function adminAccount(email: string, id: string) {
  requireAdmin(email);
  const account = await one(pool(), "select a.id, a.email, a.display_name, a.created_at, a.last_login_day, a.login_streak, a.email_verified_at, coalesce(a.banned_until > now(), false) as banned, case when a.banned_until = 'infinity' then 'dauerhaft' else to_char(a.banned_until, 'DD.MM.YYYY HH24:MI') end as banned_until, a.ban_reason, a.terms_accepted_at from accounts a where a.id = $1", [id]);
  if (!account) throw new GameError("Konto nicht gefunden", 404);
  const careers = await query(pool(), "select k.id, k.manager_name, k.season, k.updated_at, c.name as club from careers k left join clubs c on c.career_id = k.id and c.id = k.club_id where k.account_id = $1 order by k.updated_at desc", [id]);
  const posts = await query(pool(), "select p.id, p.body, p.hidden, p.created_at, l.name as league, (select count(*)::int from online_reports r where r.post_id = p.id) as reports from online_posts p join online_leagues l on l.id = p.league_id where p.account_id = $1 order by p.id desc limit 20", [id]);
  const actions = await query(pool(), "select admin_email, action, detail, created_at from admin_actions where target_account = $1 order by id desc limit 20", [id]);
  const ai = await one<{ req: number; tin: number; tout: number }>(pool(), "select count(*)::int as req, coalesce(sum(input_tokens),0)::int as tin, coalesce(sum(output_tokens),0)::int as tout from ai_log where account_id = $1 and created_at > now() - interval '30 days'", [id]);
  return { account, careers, posts, actions, ai: { requests: ai?.req ?? 0, costUsd: usd(ai?.tin ?? 0, ai?.tout ?? 0) } };
}

/** Sperren: days = null bedeutet dauerhaft. Laufende Sitzungen enden sofort. */
export async function banAccount(email: string, id: string, days: number | null, reason: string) {
  const admin = requireAdmin(email);
  const target = await one<{ email: string; display_name: string }>(pool(), "select email, display_name from accounts where id = $1", [id]);
  if (!target) throw new GameError("Konto nicht gefunden", 404);
  if (isAdmin(target.email)) throw new GameError("Administratoren können nicht gesperrt werden");
  const why = reason.trim().slice(0, 300) || "Verstoss gegen die Nutzungsbedingungen";
  const until = days && days > 0 ? `now() + interval '${Math.min(3650, Math.round(days))} days'` : "'infinity'::timestamptz";
  await query(pool(), `update accounts set banned_until = ${until}, ban_reason = $2 where id = $1`, [id, why]);
  await query(pool(), "delete from sessions where account_id = $1", [id]);
  await logAction(admin, "ban", id, { days, reason: why });
  if (mailConfigured()) {
    const lines = [`Hallo ${target.display_name},`, `dein Konto wurde ${days ? `für ${days} Tage` : "dauerhaft"} gesperrt.`, `Grund: ${why}`,
      "Wenn du die Sperre für ungerechtfertigt hältst, antworte auf diese E-Mail – wir hören dich gerne an."];
    await sendMail({ to: target.email, subject: "Dein Konto bei Football Legacy wurde gesperrt", html: layout("Konto gesperrt", lines), text: lines.join("\n\n") }).catch(() => {});
  }
  return { ok: true, message: days ? `Konto für ${days} Tage gesperrt.` : "Konto dauerhaft gesperrt." };
}

export async function unbanAccount(email: string, id: string) {
  const admin = requireAdmin(email);
  await query(pool(), "update accounts set banned_until = null, ban_reason = null where id = $1", [id]);
  await logAction(admin, "unban", id);
  return { ok: true, message: "Sperre aufgehoben." };
}

/** Anstössigen Anzeigenamen durch einen neutralen ersetzen. */
export async function resetDisplayName(email: string, id: string) {
  const admin = requireAdmin(email);
  const name = `Manager-${crypto.randomBytes(3).toString("hex")}`;
  const old = await one<{ display_name: string }>(pool(), "update accounts a set display_name = $2 from (select display_name from accounts where id = $1) o where a.id = $1 returning o.display_name", [id, name]);
  if (!old) throw new GameError("Konto nicht gefunden", 404);
  await logAction(admin, "rename", id, { from: old.display_name, to: name });
  return { ok: true, message: `Anzeigename zurückgesetzt auf ${name}.`, name };
}

export async function adminDeleteAccount(email: string, id: string) {
  const admin = requireAdmin(email);
  const target = await one<{ email: string }>(pool(), "select email from accounts where id = $1", [id]);
  if (!target) throw new GameError("Konto nicht gefunden", 404);
  if (isAdmin(target.email)) throw new GameError("Administratoren können hier nicht gelöscht werden");
  // Moderationsprotokoll des Kontos verschwindet mit; es bleibt nur ein Vermerk ohne persönliche Angaben
  await query(pool(), "delete from admin_actions where target_account = $1", [id]);
  await query(pool(), "delete from accounts where id = $1", [id]);
  await logAction(admin, "delete", null);
  return { ok: true, message: "Konto mit allen Karrieren gelöscht." };
}

export async function aiUsage(email: string) {
  requireAdmin(email);
  const days = await query<{ day: string; requests: number; failed: number; tin: number; tout: number }>(pool(), `
    select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as requests, count(*) filter (where not ok)::int as failed,
           coalesce(sum(input_tokens),0)::int as tin, coalesce(sum(output_tokens),0)::int as tout
      from ai_log where created_at > now() - interval '30 days' group by 1 order by 1 desc`);
  const features = await query<{ feature: string; requests: number; tin: number; tout: number }>(pool(), `
    select feature, count(*)::int as requests, coalesce(sum(input_tokens),0)::int as tin, coalesce(sum(output_tokens),0)::int as tout
      from ai_log where created_at > now() - interval '30 days' group by 1 order by 2 desc`);
  const top = await query<{ id: string; display_name: string; requests: number; tin: number; tout: number }>(pool(), `
    select a.id, a.display_name, count(*)::int as requests, coalesce(sum(l.input_tokens),0)::int as tin, coalesce(sum(l.output_tokens),0)::int as tout
      from ai_log l join accounts a on a.id = l.account_id where l.created_at > now() - interval '7 days' group by a.id order by 3 desc limit 10`);
  const enabled = (await one<{ n: number }>(pool(), "select count(*)::int as n from accounts where (settings->>'ai')::boolean"))?.n ?? 0;
  return {
    enabled,
    days: days.map((d) => ({ ...d, costUsd: usd(d.tin, d.tout) })),
    features: features.map((f) => ({ ...f, costUsd: usd(f.tin, f.tout) })),
    top: top.map((t) => ({ ...t, costUsd: usd(t.tin, t.tout) })),
    total30: usd(days.reduce((s, d) => s + d.tin, 0), days.reduce((s, d) => s + d.tout, 0)),
    prices: { input: PRICE_IN, output: PRICE_OUT },
  };
}

export async function adminActions(email: string) {
  requireAdmin(email);
  return { actions: await query(pool(), "select x.id, x.admin_email, x.action, x.target_account, x.detail, x.created_at, a.display_name from admin_actions x left join accounts a on a.id = x.target_account order by x.id desc limit 100") };
}
