/** Integrationstest – Paket H: Claude im Spiel (mit Attrappe statt echter API). */
import { describe, expect, it } from "vitest";
import { game, pool, shared } from "../context";
import type { AiRequest } from "../../src/ai/claude";
import { rewriteMatchArticle } from "../../src/ai/match";
import { addArticle } from "../../src/media";
import { getCareer } from "../../src/repo";

const seen: AiRequest[] = [];
const fake = (answer: (req: AiRequest) => string | null) => game.setAiTransport(async (req) => {
  seen.push(req);
  const text = answer(req);
  return text === null ? null : { text, inputTokens: 900, outputTokens: 120 };
});

describe("Paket H: Claude", () => {
  it("Opt-in: ohne Einwilligung keine KI, danach Status und Limit sichtbar", async () => {
    const { cid, acc } = shared.sponsorCareer!;
    fake(() => "Hallo");
    await game.updateSettings(acc, { ai: false });
    expect((await game.aiStatus(acc)).enabled).toBe(false);
    await expect(game.askAssistant(cid, acc, "Wie spielen wir?")).rejects.toThrow(/ausgeschaltet/);
    await game.updateSettings(acc, { ai: true });
    const st = await game.aiStatus(acc);
    expect(st).toMatchObject({ configured: true, enabled: true, model: "Claude Sonnet 5.5" });
  });

  it("Co-Trainer-Chat: Antwort auf Basis der Spieldaten, Verlauf gespeichert und löschbar", async () => {
    const { cid, acc } = shared.sponsorCareer!;
    fake(() => "Ich würde gegen diesen Gegner tiefer stehen.");
    const r = await game.askAssistant(cid, acc, "Wie spielen wir gegen den nächsten Gegner?");
    expect(r.reply).toContain("tiefer");
    const req = seen.at(-1)!;
    expect(req.feature).toBe("assistant");
    expect(req.context).toMatch(/Tabellenplatz/);
    expect(req.context).toMatch(/Kader/);
    expect(req.context).not.toMatch(/@/); // keine E-Mail-Adresse
    expect((await game.assistantView(cid, acc)).messages).toHaveLength(2);
    await game.clearAssistant(cid, acc);
    expect((await game.assistantView(cid, acc)).messages).toHaveLength(0);
  });

  it("Pressekonferenz: freie Antwort wird einer festen Antwort zugeordnet, Artikel als KI-Text", async () => {
    const { cid, acc } = shared.sponsorCareer!;
    const press = await game.pressConference(cid, acc);
    if (!press.available || press.done) return;
    expect(press.ai).toBe(true);
    fake(() => JSON.stringify({ choice: 0, reaction: "Die Journalisten nicken anerkennend.", headline: "Trainer gibt sich kämpferisch", respectful: true }));
    const [q, ...rest] = press.questions;
    const answers: Record<string, number | string> = { [q.id]: "Wir fürchten niemanden und wollen gewinnen." };
    for (const x of rest) answers[x.id] = x.answers[0].i;
    const r = await game.answerPress(cid, acc, answers);
    expect(r.free).toHaveLength(1);
    expect(r.free[0].reaction).toContain("nicken");
    const art = (await pool().query("select title, ai from media where career_id = $1 order by id desc limit 1", [cid])).rows[0];
    expect(art).toMatchObject({ title: "Trainer gibt sich kämpferisch", ai: true });
  });

  it("Spielbericht: Vorlagentext wird durch Claude-Text ersetzt", async () => {
    const { cid, acc } = shared.sponsorCareer!;
    const career = (await getCareer(pool(), cid))!;
    const f = (await pool().query("select fixture_id from match_reports where career_id = $1 limit 1", [cid])).rows[0];
    const id = (await addArticle(pool(), career, { kind: "match", title: "Vorlage", body: "Vorlage", own: true }))!;
    fake((req) => (req.feature === "match" ? JSON.stringify({ headline: "Ein Abend für die Geschichtsbücher", body: "Zwei Absätze Spielbericht." }) : null));
    await rewriteMatchArticle(acc, id, f.fixture_id, { competition: "Liga", home: "A", away: "B", own: "A", score: "2:1", position: 3 });
    const row = (await pool().query("select title, body, ai from media where id = $1", [id])).rows[0];
    expect(row).toMatchObject({ title: "Ein Abend für die Geschichtsbücher", ai: true });
    expect(seen.at(-1)!.messages[0].content).toMatch(/Wettbewerb: Liga/);
  });

  it("Selbsttest beim Serverstart: drei Funktionen mit echten Anfragen", async () => {
    fake((req) => req.feature === "press" ? JSON.stringify({ choice: 1, reaction: "Die Journalisten notieren.", headline: "Kampfansage vor dem Heimspiel", respectful: true })
      : req.feature === "match" ? JSON.stringify({ headline: "Musterberg dreht das Spiel", body: "Ein Bericht in zwei Absätzen." })
      : "Ich würde Jonas Brandt aufstellen: Er ist in Form und fit.");
    process.env.AI_SELFTEST = "force";
    const lines: string[] = [];
    await game.aiSelfTest((l) => lines.push(l));
    delete process.env.AI_SELFTEST;
    expect(lines.filter((l) => l.includes(": ok in")).length).toBe(3);
    expect(seen.at(-1)!.context).toMatch(/SV Musterberg/);
  });

  it("Ausfall und Tageslimit: verständlicher Fehler, Protokoll ohne Inhalte", async () => {
    const { cid, acc } = shared.sponsorCareer!;
    fake(() => null);
    await expect(game.askAssistant(cid, acc, "Hallo?")).rejects.toMatchObject({ status: 503 });
    const log = (await pool().query("select feature, ok from ai_log where account_id = $1 order by id desc limit 1", [acc])).rows[0];
    expect(log).toEqual({ feature: "assistant", ok: false });
    await pool().query("insert into auth_attempts(kind, key) select 'ai_text', $1 from generate_series(1, 80)", [acc]);
    await expect(game.askAssistant(cid, acc, "Noch eine Frage")).rejects.toMatchObject({ status: 429 });
    await pool().query("delete from auth_attempts where kind = 'ai_text' and key = $1", [acc]);
    game.setAiTransport();
    await game.updateSettings(acc, { ai: false });
  });
});
