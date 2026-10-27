/** Integrationstest – Charakterzüge im Profil, Push-Abos, Hintergrunddienst und tägliche Online-Spieltage. */
import { describe, expect, it } from "vitest";
import { game, pool, shared } from "../context";

const sent: { endpoint: string; payload: { title: string; body: string; url?: string; tag?: string } }[] = [];
const waitFor = async (cond: () => boolean | Promise<boolean>, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

describe("Charakter, Push und Hintergrunddienst", () => {
  it("Charakterzüge: bei eigenen Spielern sichtbar, bei unbekannten verborgen", async () => {
    const own = (await pool().query("select p.id from players p join careers c on c.id = p.career_id and c.club_id = p.club_id where p.career_id = $1 limit 1", [shared.careerId])).rows[0];
    const detail = await game.playerDetail(shared.careerId, shared.accountId, own.id);
    expect(Array.isArray(detail.player.traits)).toBe(true);
    for (const t of detail.player.traits!) expect(t.label.length).toBeGreaterThan(2);
    const foreign = (await pool().query(
      `select p.id from players p join clubs c on c.career_id = p.career_id and c.id = p.club_id
       where p.career_id = $1 and c.league_id <> (select league_id from clubs where career_id = $1 and id = (select club_id from careers where id = $1))
         and p.id not in (select player_id from shortlist where career_id = $1) limit 1`, [shared.careerId])).rows[0];
    expect((await game.playerDetail(shared.careerId, shared.accountId, foreign.id)).player.traits).toBeNull();
  });

  it("Push: Abo speichern, ungültige Abos ablehnen, Testmitteilung zustellen", async () => {
    game.setPushTransport(async (sub, payload) => { sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); });
    const key = await game.pushPublicKey();
    expect(key.publicKey.length).toBeGreaterThan(40);
    expect((await game.pushPublicKey()).publicKey).toBe(key.publicKey); // gespeichert, nicht neu erzeugt
    await expect(game.subscribePush(shared.accountId, { endpoint: "http://unsicher", keys: { p256dh: "x", auth: "y" } })).rejects.toThrow();
    const s = await game.subscribePush(shared.accountId, { endpoint: "https://push.example/abc", keys: { p256dh: "BPkey", auth: "authkey" }, topics: ["online", "jobs"] }, "Vitest");
    expect(s.subscribed).toBe(true);
    expect(s.topics).toEqual(["online", "jobs"]);
    expect((await game.testPush(shared.accountId)).sent).toBe(1);
    expect(sent.at(-1)?.payload.body).toContain("eingerichtet");
  });

  it("Tägliche Online-Liga: fälliger Spieltag wird im Hintergrund gespielt und gemeldet", async () => {
    const l = await game.createOnlineLeague(shared.accountId, { name: "Pushliga", careerId: shared.careerId, maxMembers: 6, rhythm: "daily", public: false });
    await game.addOnlineBots(shared.accountId, l.id, 3);
    await game.startOnlineLeague(shared.accountId, l.id);
    await pool().query("update online_leagues set next_at = now() - interval '1 minute' where id = $1", [l.id]);
    const before = sent.length;
    expect(await game.playDueOnlineLeagues()).toBe(1);
    expect((await pool().query("select round from online_leagues where id = $1", [l.id])).rows[0].round).toBe(1);
    expect(await waitFor(() => sent.length > before)).toBe(true);
    const msg = sent.slice(before).find((m) => m.payload.title.includes("1. Spieltag"));
    expect(msg?.payload.url).toBe(`/online/${l.id}`);
    expect(msg?.payload.body).toMatch(/\d+:\d+/);
    expect(await game.playDueOnlineLeagues()).toBe(0); // nächster Spieltag erst morgen
  });

  it("Hintergrunddienst: Aufträge laufen über die Warteschlange, Fehler kommen an, Push wenn niemand wartet", async () => {
    const w = game.startWorker({ concurrency: 1, idleMs: 100, schedule: false });
    await w.ready;
    game.resetWorkerCache();
    try {
      expect(await game.workerOnline()).toBe(true);
      const r = await game.bg.advance(shared.careerId, shared.accountId);
      expect(["day", "match", "week"]).toContain(r.kind);
      const job = (await pool().query("select kind, status, worker from sim_jobs order by id desc limit 1")).rows[0];
      expect(job).toEqual({ kind: "advance", status: "done", worker: w.id });

      // Fremde Karriere: der Fehler des Spiels kommt mit Status bei der Anfrage an
      const other = (await game.register(`fremd${Date.now()}@example.com`, "geheim123", "Fremd")).account.id;
      const err = await game.bg.advance(shared.careerId, other).catch((e) => e);
      expect(err).toBeInstanceOf(game.GameError);
      expect(err.status).toBe(404);

      // Auftrag, auf den niemand mehr wartet (Seite geschlossen): Mitteilung nach Abschluss
      process.env.JOB_PUSH_AFTER_MS = "0";
      const before = sent.length;
      const id = (await pool().query(
        "insert into sim_jobs(kind, account_id, career_id, payload, polled_at) values ('advance', $1, $2, $3, now() - interval '1 minute') returning id",
        [shared.accountId, shared.careerId, JSON.stringify([shared.careerId, shared.accountId])])).rows[0].id;
      await pool().query("select pg_notify('fl_jobs', $1)", [String(id)]);
      expect(await waitFor(() => sent.length > before)).toBe(true);
      expect(sent.at(-1)?.payload.url).toBe(`/c/${shared.careerId}`);
      const status = await game.workerStatus();
      expect(status.workers).toBeGreaterThanOrEqual(1);
    } finally {
      delete process.env.JOB_PUSH_AFTER_MS;
      await w.stop();
      game.resetWorkerCache();
      game.setPushTransport(null);
    }
    expect(await game.workerOnline()).toBe(false);
  }, 60_000);
});
