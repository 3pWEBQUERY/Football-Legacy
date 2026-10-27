/** Integrationstest – Passwort zurücksetzen (E-Mail), Datenauskunft, Schuldenregeln und Mindestkader. */
import { describe, expect, it } from "vitest";
import { MIN_SQUAD, creditLimit, debtWeek, ensureMinimumSquad } from "../../src/club-safety";
import { setMailTransport, type MailMessage } from "../../src/account/mail";
import { createCareer, game, pool, previewClubs, register } from "../context";

describe("Startreife", () => {
  const mails: MailMessage[] = [];
  let email = "";
  let acc = "";
  let cid = "";
  const tokenFrom = (m: MailMessage) => /token=([A-Za-z0-9_-]+)/.exec(m.text)![1];

  it("Passwort vergessen: Link per E-Mail, einmal gültig, alle Sitzungen enden", async () => {
    setMailTransport(async (m) => { mails.push(m); return { sent: true, id: "test" }; });
    email = `reset${Date.now()}@example.com`;
    const { account, token: oldSession } = await register(email, "altesPasswort1", "Reset");
    acc = account.id;
    // Unbekannte Adressen verraten nichts
    const unknown = await game.requestPasswordReset(`niemand${Date.now()}@example.com`);
    expect(unknown.ok).toBe(true);
    expect(mails.length).toBe(0);
    await game.requestPasswordReset(email.toUpperCase(), { ip: "10.0.0.1" });
    expect(mails.length).toBe(1);
    expect(mails[0].to).toBe(email);
    expect(mails[0].html).toContain("Passwort zurücksetzen");
    const token = tokenFrom(mails[0]);
    expect((await game.checkResetToken(token)).valid).toBe(true);
    await expect(game.resetPassword(token, "kurz")).rejects.toThrow(/8 Zeichen/);
    const r = await game.resetPassword(token, "neuesPasswort1");
    expect(r.token).toBeTruthy();
    expect(await game.accountForToken(oldSession)).toBeNull();
    expect((await game.accountForToken(r.token))?.id).toBe(acc);
    await expect(game.resetPassword(token, "nochEinmal123")).rejects.toThrow(/ungültig|verwendet/);
    await expect(game.login(email, "altesPasswort1")).rejects.toThrow();
    expect((await game.login(email, "neuesPasswort1")).account.id).toBe(acc);
  });

  it("Neuer Link macht den alten ungültig; höchstens drei Links pro Stunde", async () => {
    mails.length = 0;
    await game.requestPasswordReset(email);
    await game.requestPasswordReset(email);
    expect(mails.length).toBe(2);
    expect((await game.checkResetToken(tokenFrom(mails[0]))).valid).toBe(false);
    expect((await game.checkResetToken(tokenFrom(mails[1]))).valid).toBe(true);
    await game.requestPasswordReset(email);
    expect(mails.length).toBe(2);
    setMailTransport();
  });

  it("Datenauskunft enthält Account und Karrieren, aber kein Passwort", async () => {
    const preview = previewClubs(808, "GER");
    cid = await createCareer(acc, { managerName: "Safe", countryCode: "GER", clubIndex: preview[1].clubs[4].index, seed: 808 });
    const data = await game.exportAccountData(acc);
    expect(data.account.email).toBe(email);
    expect(data.careers.length).toBe(1);
    expect(JSON.stringify(data)).not.toMatch(/scrypt|password_hash/);
  });

  it("Mindestkader: Akademie und Vereinslose füllen auf", async () => {
    const career = await game.readCareer(cid, acc);
    const ids = (await pool().query("select id from players where career_id = $1 and club_id = $2 order by rating", [cid, career.club_id])).rows.map((r) => r.id);
    // Kader künstlich auf 10 Spieler ohne Torhüter schrumpfen
    await pool().query("update players set club_id = null, data = jsonb_set(data, '{clubId}', 'null') where career_id = $1 and club_id = $2 and (position = 'GK' or id = any($3::int[]))", [cid, career.club_id, ids.slice(0, 12)]);
    const msgs = await ensureMinimumSquad(pool(), career);
    expect(msgs.length).toBe(1);
    const after = await pool().query("select count(*)::int as n, count(*) filter (where position = 'GK')::int as gk from players where career_id = $1 and club_id = $2", [cid, career.club_id]);
    expect(after.rows[0].n).toBeGreaterThanOrEqual(MIN_SQUAD);
    expect(after.rows[0].gk).toBeGreaterThanOrEqual(2);
    const inbox = await pool().query("select title from inbox where career_id = $1 and title like 'Notmassnahme%'", [cid]);
    expect(inbox.rows.length).toBe(1);
    expect(await ensureMinimumSquad(pool(), career)).toEqual([]);
  });

  it("Schulden: Transfersperre, Zinsen, Zwangsverkauf unter dem Kreditrahmen", async () => {
    const career = await game.readCareer(cid, acc);
    await pool().query("update clubs set balance = -500000 where career_id = $1 and id = $2", [cid, career.club_id]);
    const m = await game.marketView(cid, acc, { sort: "rating", maxValue: 2_000_000 });
    const target = m.players.find((x) => x.clubId !== null && !x.loan)!;
    await expect(game.startNegotiation(cid, acc, { playerId: target.id, offer: { fee: 100_000, upfrontPct: 100, installmentYears: 0, sellOn: 0 } })).rejects.toThrow(/Transfersperre/);
    const conf = career.board.confidence;
    await debtWeek(pool(), career);
    const club = (await pool().query("select balance from clubs where career_id = $1 and id = $2", [cid, career.club_id])).rows[0];
    expect(Number(club.balance)).toBeLessThan(-500000);
    expect(career.board.confidence).toBeLessThan(conf);
    expect(career.manager.debt).toBeTruthy();
    // Tief im Minus und Transferfenster offen: der Vorstand verkauft
    const squad = (await pool().query("select count(*)::int as n from players where career_id = $1 and club_id = $2", [cid, career.club_id])).rows[0].n;
    const wages = Number((await pool().query("select sum((data->'contract'->>'wage')::bigint) as w from players where career_id = $1 and club_id = $2", [cid, career.club_id])).rows[0].w);
    await pool().query("update clubs set balance = $3 where career_id = $1 and id = $2", [cid, career.club_id, -creditLimit(wages) - 5_000_000]);
    const out = await debtWeek(pool(), career);
    expect(out.some((x) => x.startsWith("Zwangsverkauf"))).toBe(squad > MIN_SQUAD);
    if (squad > MIN_SQUAD) {
      const t = await pool().query("select kind, fee from transfers where career_id = $1 and kind = 'forced'", [cid]);
      expect(t.rows.length).toBe(1);
      expect(Number(t.rows[0].fee)).toBeGreaterThan(0);
    }
    await pool().query("update clubs set balance = 1000000 where career_id = $1 and id = $2", [cid, career.club_id]);
    expect(await debtWeek(pool(), career)).toEqual(["Transfersperre aufgehoben"]);
    expect(career.manager.debt).toBeUndefined();
  });
});
