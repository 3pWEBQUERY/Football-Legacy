/**
 * Push-Mitteilungen (Web Push mit VAPID). Die Schlüssel kommen aus
 * VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY oder werden beim ersten Bedarf erzeugt
 * und in app_secrets abgelegt – Push funktioniert so ohne Einrichtung.
 * Abgelaufene Abos (404/410 vom Push-Dienst) werden automatisch entfernt.
 */
import webpush from "web-push";
import { one, pool, query } from "../db";
import { GameError } from "../errors";
import { appUrl } from "./password-reset";
import { accountLang, translatorFor } from "./lang";

export type PushTopic = "online" | "jobs";
export const PUSH_TOPICS: Record<PushTopic, { label: string; text: string }> = {
  online: { label: "Online-Ligen", text: "Gespielte Spieltage, neue Saison, Nachrichten und Beitritte in deinen Online-Ligen" },
  jobs: { label: "Lange Berechnungen", text: "Wenn ein Saisonwechsel oder eine neue Karriere fertig gerechnet ist" },
};
const ALL_TOPICS = Object.keys(PUSH_TOPICS) as PushTopic[];

export interface PushPayload { title: string; body: string; url?: string; tag?: string }
interface SubRow { id: number; account_id: string; endpoint: string; p256dh: string; auth: string; topics: string[] }
export type PushTransport = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<void>;

let keys: { publicKey: string; privateKey: string } | null = null;
let transport: PushTransport | null = null;

/** Für Tests: Versand abfangen (null = echter Versand). */
export function setPushTransport(t: PushTransport | null) {
  transport = t;
}

async function vapidKeys() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return keys;
  }
  const stored = await one<{ value: { publicKey: string; privateKey: string } }>(pool(), "select value from app_secrets where key = 'vapid'");
  if (stored) return (keys = stored.value);
  await query(pool(), "insert into app_secrets(key, value) values ('vapid', $1) on conflict (key) do nothing", [JSON.stringify(webpush.generateVAPIDKeys())]);
  // Bei gleichzeitigem Start gewinnt der erste Eintrag
  keys = (await one<{ value: { publicKey: string; privateKey: string } }>(pool(), "select value from app_secrets where key = 'vapid'"))!.value;
  return keys;
}

function subject() {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  const url = appUrl();
  if (url.startsWith("https://")) return url;
  return `mailto:${process.env.LEGAL_EMAIL || "noreply@football-legacy.app"}`;
}

export async function pushPublicKey() {
  return { publicKey: (await vapidKeys()).publicKey, topics: PUSH_TOPICS };
}

export async function pushStatus(accountId: string, endpoint?: string | null) {
  const rows = await query<{ endpoint: string; topics: string[] }>(pool(), "select endpoint, topics from push_subscriptions where account_id = $1", [accountId]);
  const mine = endpoint ? rows.find((r) => r.endpoint === endpoint) : null;
  return { devices: rows.length, subscribed: !!mine, topics: (mine?.topics ?? ALL_TOPICS) as PushTopic[], available: PUSH_TOPICS };
}

function validTopics(t: unknown): PushTopic[] {
  if (!Array.isArray(t)) return ALL_TOPICS;
  return ALL_TOPICS.filter((x) => t.includes(x));
}

export async function subscribePush(accountId: string, input: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; topics?: unknown }, userAgent?: string | null) {
  const endpoint = typeof input.endpoint === "string" ? input.endpoint : "";
  const p256dh = typeof input.keys?.p256dh === "string" ? input.keys.p256dh : "";
  const auth = typeof input.keys?.auth === "string" ? input.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    throw new GameError("Ungültiges Push-Abo");
  }
  const count = await one<{ n: number }>(pool(), "select count(*)::int as n from push_subscriptions where account_id = $1 and endpoint <> $2", [accountId, endpoint]);
  if ((count?.n ?? 0) >= 10) throw new GameError("Höchstens 10 Geräte pro Account");
  await query(pool(),
    `insert into push_subscriptions(account_id, endpoint, p256dh, auth, user_agent, topics) values ($1,$2,$3,$4,$5,$6)
     on conflict (endpoint) do update set account_id = excluded.account_id, p256dh = excluded.p256dh, auth = excluded.auth,
       user_agent = excluded.user_agent, topics = excluded.topics`,
    [accountId, endpoint, p256dh, auth, (userAgent ?? "").slice(0, 200), validTopics(input.topics)]);
  return pushStatus(accountId, endpoint);
}

export async function unsubscribePush(accountId: string, endpoint: string) {
  await query(pool(), "delete from push_subscriptions where account_id = $1 and endpoint = $2", [accountId, endpoint]);
  return pushStatus(accountId, null);
}

async function send(sub: SubRow, payload: PushPayload): Promise<boolean> {
  const tr = await translatorFor(await accountLang({ id: sub.account_id }).catch(() => "de" as const));
  const body = JSON.stringify({ ...payload, title: tr(payload.title), body: tr(payload.body), url: payload.url ?? "/careers" });
  const target = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
  try {
    if (transport) await transport(target, body);
    else {
      const k = await vapidKeys();
      await webpush.sendNotification(target, body, { TTL: 60 * 60 * 24, vapidDetails: { subject: subject(), publicKey: k.publicKey, privateKey: k.privateKey } });
    }
    await query(pool(), "update push_subscriptions set last_used = now() where id = $1", [sub.id]);
    return true;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) await query(pool(), "delete from push_subscriptions where id = $1", [sub.id]);
    else console.warn("[push] Versand fehlgeschlagen", status ?? (e as Error).message);
    return false;
  }
}

/** Mitteilung an alle Geräte der Accounts, die das Thema abonniert haben. Liefert die Zahl der Zustellungen. */
export async function notify(accountIds: (string | null | undefined)[], topic: PushTopic, payload: PushPayload): Promise<number> {
  const ids = [...new Set(accountIds.filter((x): x is string => !!x))];
  if (!ids.length) return 0;
  const subs = await query<SubRow>(pool(), "select * from push_subscriptions where account_id = any($1::uuid[]) and $2 = any(topics)", [ids, topic]);
  const results = await Promise.all(subs.map((s) => send(s, payload)));
  return results.filter(Boolean).length;
}

/** Ohne auf den Versand zu warten (Fehler landen nur im Log). */
export function notifyLater(accountIds: (string | null | undefined)[], topic: PushTopic, payload: PushPayload) {
  void notify(accountIds, topic, payload).catch((e) => console.warn("[push]", (e as Error).message));
}

export async function testPush(accountId: string) {
  const subs = await query<SubRow>(pool(), "select * from push_subscriptions where account_id = $1", [accountId]);
  const ok = await Promise.all(subs.map((x) => send(x, { title: "Football Legacy", body: "Push-Mitteilungen sind eingerichtet. ⚽", url: "/careers", tag: "test" })));
  const sent = ok.filter(Boolean).length;
  if (!sent) throw new GameError("Kein Gerät mit aktivem Push-Abo gefunden");
  return { sent };
}
