/**
 * Selbsttest der KI-Anbindung beim Serverstart: ruft Claude mit den echten
 * Anfragen der drei Funktionen und Beispieldaten auf und schreibt das Ergebnis
 * ins Server-Protokoll. Läuft höchstens alle 12 Stunden (AI_SELFTEST=off
 * schaltet ihn ab, AI_SELFTEST=force erzwingt ihn).
 */
import { one, pool, query } from "../db";
import { aiConfigured, callClaude, parseJson, type AiRequest } from "./claude";
import { pressRequest, readFreeAnswer, type PressQuestion } from "./press";
import { matchFacts, matchRequest } from "./match";
import { assistantSystem } from "./assistant";

const QUESTION: PressQuestion = {
  id: "opponent", text: "Was erwartest du von FC Seewald?",
  answers: [
    { text: "Ein unangenehmer Gegner – wir sind gewarnt.", tone: "Respektvoll" },
    { text: "Wenn wir unser Spiel machen, gewinnen wir.", tone: "Selbstbewusst" },
    { text: "Wir schauen nur auf uns.", tone: "Neutral" },
  ],
};

const CONTEXT = `Aktuelle Daten (nur diese verwenden):
Verein: SV Musterberg, Stärke 72, Tabellenplatz 5 von 18 (21 Punkte, Tore 19:14)
Letzte Spiele: SV Musterberg 2:0 Union Talheim; Rot-Weiss Bergen 1:1 SV Musterberg; SV Musterberg 0:2 FC Altstadt
Nächster Gegner: FC Seewald (Heimspiel), Stärke 69, Spielidee Konter im 4-4-2
Eigene Taktik: 4-2-3-1, Spielidee Ballbesitz, Mentalität 0
Kader (Position, Alter, Stärke, Form, Moral, Fitness):
- Jonas Brandt: ST, 27, 76, Form 7.4, Moral 81, Fitness 95
- Mehmet Aydin: ST, 21, 70, Form 6.2, Moral 55, Fitness 88
- Luca Weber: AMC, 24, 74, Form 7.0, Moral 70, Fitness 64 (müde)`;

interface Case { name: string; req: AiRequest; check: (text: string) => string | null }

const cases: Case[] = [
  {
    name: "Pressekonferenz",
    req: { accountId: "selftest", ...pressRequest(QUESTION, "Wir haben Respekt vor Seewald, aber wir spielen zuhause und wollen die drei Punkte.", "Heimspiel gegen FC Seewald; letzte Ergebnisse: W D L.") },
    check: (text) => {
      const r = readFreeAnswer({ text, inputTokens: 0, outputTokens: 0 }, QUESTION);
      return r.headline ? `Antwort ${r.choice} (${r.tone}), Schlagzeile „${r.headline}“` : null;
    },
  },
  {
    name: "Spielbericht",
    req: { accountId: "selftest", ...matchRequest(matchFacts({ competition: "Meisterliga, 12. Spieltag", home: "SV Musterberg", away: "FC Seewald", own: "SV Musterberg", score: "2:1", position: 4 }, {
      events: [{ minute: 23, type: "goal", side: 0, text: "TOR für MUS! J. Brandt trifft." }, { minute: 58, type: "goal", side: 1, text: "TOR für SEE! P. Keller trifft per Kopf." }, { minute: 84, type: "goal", side: 0, text: "TOR für MUS! M. Aydin trifft." }],
      conditions: { weather: "rain", temperature: 9, referee: { name: "Thomas Frei" } },
    })) },
    check: (text) => {
      const r = parseJson<{ headline: string; body: string }>({ text, inputTokens: 0, outputTokens: 0 });
      return r?.headline && r.body ? `„${r.headline}“ (${r.body.split(/\s+/).length} Wörter)` : null;
    },
  },
  {
    name: "Co-Trainer",
    req: { accountId: "selftest", feature: "assistant", system: assistantSystem("Lena Weber", "SV Musterberg"), context: CONTEXT, messages: [{ role: "user", content: "Wen soll ich gegen Seewald im Sturm aufstellen?" }], maxTokens: 2500 },
    check: (text) => (text.length > 40 ? `${text.split(/\s+/).length} Wörter: „${text.slice(0, 90).replace(/\s+/g, " ")}…“` : null),
  },
];

export async function aiSelfTest(log: (m: string) => void = console.log) {
  const mode = process.env.AI_SELFTEST;
  if (!aiConfigured() || mode === "off") return;
  if (mode !== "force" && await one(pool(), "select 1 from ai_log where feature = 'selftest' and created_at > now() - interval '12 hours' limit 1")) return;
  for (const c of cases) {
    const t0 = Date.now();
    let ok = false;
    let tokens: [number | null, number | null] = [null, null];
    try {
      const res = await callClaude(c.req);
      const info = res ? c.check(res.text) : null;
      ok = !!info;
      tokens = [res?.inputTokens ?? null, res?.outputTokens ?? null];
      log(`[ai] Selbsttest ${c.name}: ${ok ? "ok" : "FEHLER (keine gültige Antwort)"} in ${((Date.now() - t0) / 1000).toFixed(1)} s${res ? `, ${res.inputTokens}/${res.outputTokens} Tokens` : ""}${info ? ` – ${info}` : ""}`);
    } catch (e) {
      log(`[ai] Selbsttest ${c.name}: FEHLER ${(e as Error).message}`);
    }
    await query(pool(), "insert into ai_log(account_id, feature, input_tokens, output_tokens, ok) values (null, 'selftest', $1, $2, $3)", [tokens[0], tokens[1], ok]).catch(() => {});
  }
}
