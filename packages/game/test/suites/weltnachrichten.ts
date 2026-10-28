/** Integrationstest – Weltnachrichten nach „Weiter“: Gerüchte, Wechsel und Leihen mit Spieler und Vereinen, gelesen-Markierung. */
import { describe, expect, it } from "vitest";
import { game, pool, register, shared } from "../context";
import { squadArticles, worldRumours } from "../../src/world-news";
import type { CareerRow } from "../../src/repo";

describe("Weltnachrichten", () => {
  it("Gerüchte und Kaderpflege der KI erscheinen mit Spielerbild und Vereinen; „gesehen“ setzt den Zähler zurück", async () => {
    const id = shared.careerId;
    const career = (await pool().query<CareerRow>("select * from careers where id = $1", [id])).rows[0];
    await pool().query("update careers set media_seen_id = coalesce((select max(id) from media where career_id = $1), 0) where id = $1", [id]);
    expect((await game.worldNewsView(id, shared.accountId)).total).toBe(0);

    // Gerüchte im Transferfenster: an einigen Tagen gibt es sie sicher
    const db = await pool().connect();
    let made = 0;
    try {
      const start = career.day;
      for (let d = 0; d < 30 && made < 2; d++) made += await worldRumours(db, { ...career, day: start + d }, true);
      const other = (await db.query<{ id: number; club_id: number }>(
        "select p.id, p.club_id from players p join clubs c on c.id = p.club_id and c.career_id = p.career_id where p.career_id = $1 and c.players_generated and c.id <> $2 limit 2",
        [id, career.club_id])).rows;
      await squadArticles(db, career, [
        { text: "Test will den Verein verlassen.", userLeague: true, type: "unrest", playerId: other[0].id, clubId: other[0].club_id },
        { text: "Test verleiht Talent.", userLeague: true, type: "loan", playerId: other[1].id, clubId: other[1].club_id, toClubId: other[0].club_id },
      ]);
    } finally {
      db.release();
    }
    expect(made).toBeGreaterThan(0);

    const view = await game.worldNewsView(id, shared.accountId);
    expect(view.total).toBe(made + 2);
    const interest = view.items.find((i) => i.type === "interest")!;
    expect(interest).toMatchObject({ kind: "rumour", label: "Interesse" });
    expect(interest.player).toMatchObject({ id: expect.any(Number), name: expect.any(String), position: expect.any(String) });
    expect(interest.from?.id).not.toBe(interest.to?.id);
    const loan = view.items.find((i) => i.type === "loan")!;
    expect(loan).toMatchObject({ kind: "transfer", label: "Leihe", title: "Test verleiht Talent" });
    expect(loan.from && loan.to).toBeTruthy();
    expect(view.items.find((i) => i.type === "unrest")?.body).toMatch(/Transferliste/);
    expect((await game.dashboard(id, shared.accountId)).worldNews).toBe(made + 2);

    // Gesehen: nur bis zur zuletzt gezeigten Meldung, auch wenn mehr angefragt wird
    await game.markWorldNewsSeen(id, shared.accountId, Number.MAX_SAFE_INTEGER);
    expect((await game.worldNewsView(id, shared.accountId)).total).toBe(0);
    const seen = (await pool().query("select media_seen_id, (select max(id) from media where career_id = $1) as max from careers where id = $1", [id])).rows[0];
    expect(Number(seen.media_seen_id)).toBe(Number(seen.max));

    // Fremde Konten sehen die Nachrichten einer Karriere nicht
    const { account } = await register(`wn-fremd${Date.now()}@example.com`, "geheim123", "Fremd", { acceptTerms: true, ageConfirmed: true });
    await expect(game.worldNewsView(id, account.id)).rejects.toThrow();
  });
});
