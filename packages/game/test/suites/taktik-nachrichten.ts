/** Integrationstest – Taktik-Ausbau und Nachrichten-Engine. */
import { describe, expect, it } from "vitest";
import { game, pool, advance, quickMatch, saveTactic, tacticView, shared } from "../context";

describe("Taktik-Ausbau", () => {
  it("Mentalität, Pflichten, Anweisungen speichern; mehrere Taktiken; Vertrautheit", async () => {
    const v = await tacticView(shared.careerId, shared.accountId);
    expect(v.tactics.slots.length).toBe(1);
    expect(Object.keys(v.mentalities).length).toBe(7);
    expect(Object.keys(v.presets).length).toBeGreaterThanOrEqual(12);
    const fam0 = v.familiarity.total;
    const duties = v.tactic.lineup.map((_: unknown, i: number) => (i === 10 ? "attack" : i === 1 ? "defend" : null));
    const instructions = v.tactic.lineup.map((_: unknown, i: number) => (i === 10 ? ["shoot_more", "stay_back", "get_forward"] : i === 0 ? ["shoot_more"] : []));
    const res = await saveTactic(shared.careerId, shared.accountId, { ...v.tactic, mentality: 2, duties, instructions: instructions as never, style: { ...v.tactic.style, pressing: Math.min(100, v.tactic.style.pressing + 40) } });
    expect(res.tactic.mentality).toBe(2);
    expect(res.tactic.duties?.[10]).toBe("attack");
    expect(res.tactic.instructions?.[10]).toEqual(["shoot_more", "get_forward"]); // Widerspruch aufgelöst
    expect(res.tactic.instructions?.[0]).toEqual([]); // keine Anweisungen für den Torwart
    const after = await tacticView(shared.careerId, shared.accountId);
    expect(after.familiarity.style).toBeLessThan(v.familiarity.style); // Umstellung kostet Vertrautheit
    expect(after.intensity).toBeGreaterThan(v.intensity);

    // zweite Taktik als Kopie, umbenennen, wechseln, löschen
    await game.tacticSlotAction(shared.careerId, shared.accountId, { action: "add" });
    let t2 = await tacticView(shared.careerId, shared.accountId);
    expect(t2.tactics.slots.length).toBe(2);
    expect(t2.tactics.active).toBe(1);
    await saveTactic(shared.careerId, shared.accountId, { ...t2.tactic, formation: "4-4-2", mentality: -1, duties: [], instructions: [] });
    await game.tacticSlotAction(shared.careerId, shared.accountId, { action: "rename", index: 1, name: "Defensiv 4-4-2" });
    await game.tacticSlotAction(shared.careerId, shared.accountId, { action: "select", index: 0 });
    t2 = await tacticView(shared.careerId, shared.accountId);
    expect(t2.tactic.mentality).toBe(2);
    expect(t2.tactics.slots[1].name).toBe("Defensiv 4-4-2");
    expect(t2.tactics.slots[1].formation).toBe("4-4-2");
    await expect(game.tacticSlotAction(shared.careerId, shared.accountId, { action: "add" }).then(() => game.tacticSlotAction(shared.careerId, shared.accountId, { action: "add" }))).rejects.toThrow(/Höchstens/);
    await game.tacticSlotAction(shared.careerId, shared.accountId, { action: "delete", index: 2 });
    expect((await tacticView(shared.careerId, shared.accountId)).tactics.slots.length).toBe(2);

    // Training festigt die Taktik
    const before = (await tacticView(shared.careerId, shared.accountId)).familiarity;
    for (let i = 0; i < 10; i++) {
      const r = await advance(shared.careerId, shared.accountId);
      if (r.kind === "match") await quickMatch(shared.careerId, shared.accountId);
    }
    const later = (await tacticView(shared.careerId, shared.accountId)).familiarity;
    expect(later.total).toBeGreaterThan(before.total);
    expect(fam0).toBeGreaterThan(0);
  }, 120_000);
});

describe("Nachrichten-Engine", () => {
  it("erzeugt unterschiedliche Nachrichten mit Absender und Inhalt; Filter und Archiv", async () => {
    const kinds = await pool().query("select distinct kind from inbox where career_id = $1 and kind is not null", [shared.careerId]);
    const set = new Set(kinds.rows.map((r: { kind: string }) => r.kind.replace(/_\d+$/, "")));
    for (const k of ["preview", "analysis", "milestone", "board_monthly"]) expect(set.has(k)).toBe(true);
    expect(set.size).toBeGreaterThanOrEqual(8);
    const v = await game.inboxView(shared.careerId, shared.accountId, {});
    expect(v.messages.length).toBe(40);
    expect(v.messages.every((m) => (m.sender as { name: string }).name.length > 1)).toBe(true);
    const rich = v.messages.find((m) => Array.isArray(m.blocks) && (m.blocks as unknown[]).length > 0);
    expect(rich).toBeTruthy();
    const older = await game.inboxView(shared.careerId, shared.accountId, { before: v.messages[39].id });
    expect(older.messages[0].id).toBeLessThan(v.messages[39].id);
    const matches = await game.inboxView(shared.careerId, shared.accountId, { filter: "match" });
    expect(matches.messages.every((m) => m.category === "match")).toBe(true);
    const preview = (await pool().query("select blocks, sender from inbox where career_id = $1 and kind = 'preview' order by id desc limit 1", [shared.careerId])).rows[0];
    expect(preview.sender.kind).toBe("staff");
    expect(preview.blocks.some((b: { t: string }) => b.t === "players")).toBe(true);
    const id = v.messages[0].id;
    await game.archiveInbox(shared.careerId, shared.accountId, [id]);
    expect((await game.inboxView(shared.careerId, shared.accountId, {})).messages.some((m) => m.id === id)).toBe(false);
  });
});
