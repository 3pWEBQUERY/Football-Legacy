/**
 * Spielberichte von Claude: Nach jedem eigenen Pflichtspiel entsteht sofort
 * der Vorlagenbericht; ist die KI aktiv, ersetzt Claude ihn kurz darauf durch
 * einen ausführlicheren Text auf Basis der echten Spieldaten.
 */
import { WEATHER, type WeatherKind } from "@fl/sim";
import { one, pool, query } from "../db";
import { STYLE_RULES, aiEnabled, generate, parseJson } from "./claude";

const SYSTEM = `Du bist Sportredakteur einer Fussballzeitung im Spiel "Football Legacy" und schreibst den Spielbericht über die Mannschaft des Spielers.
Länge: 90 bis 150 Wörter, zwei kurze Absätze, lebendig und sachlich wie in einer echten Sportzeitung. Erwähne das Ergebnis, die Torschützen mit Minute und die Besonderheiten aus den Daten (Wetter, Karten, Statistik, Tabellenplatz), wenn sie relevant sind.
Die Schlagzeile hat höchstens 9 Wörter.
${STYLE_RULES}`;

const SCHEMA = {
  type: "object",
  properties: { headline: { type: "string" }, body: { type: "string" } },
  required: ["headline", "body"],
  additionalProperties: false,
};

interface ReportData {
  events?: { minute: number; type: string; side: number | null; text: string }[];
  stats?: { possession?: number; shots?: number; onTarget?: number; xg?: number; yellow?: number; red?: number }[];
  conditions?: { weather: string; temperature: number; referee: { name: string } } | null;
  motm?: number | null;
  players?: { playerId: number; name: string; side: number; rating: number }[];
}

const KEY_EVENTS = new Set(["goal", "own_goal", "penalty_goal", "penalty_miss", "red", "injury"]);

/** Fakten für den Bericht aus dem gespeicherten Spielbericht. */
export function matchFacts(input: { competition: string; home: string; away: string; own: string; score: string; position: number | null }, data: ReportData | null): string {
  const lines = [
    `Wettbewerb: ${input.competition}`,
    `Spiel: ${input.home} – ${input.away} ${input.score}`,
    `Mannschaft des Spielers: ${input.own}`,
  ];
  if (input.position) lines.push(`Tabellenplatz danach: ${input.position}`);
  if (data?.conditions) lines.push(`Wetter: ${WEATHER[data.conditions.weather as WeatherKind]?.label ?? data.conditions.weather}, ${data.conditions.temperature} °C; Schiedsrichter: ${data.conditions.referee.name}`);
  const ev = (data?.events ?? []).filter((e) => KEY_EVENTS.has(e.type)).slice(0, 14);
  if (ev.length) lines.push("Wichtige Szenen:", ...ev.map((e) => `- ${e.minute}.: ${e.text}`));
  const s = data?.stats;
  if (s?.[0] && s[1]) {
    const pos = Math.round(((s[0].possession ?? 1) / ((s[0].possession ?? 1) + (s[1].possession ?? 1))) * 100);
    lines.push(`Statistik (${input.home} : ${input.away}): Ballbesitz ${pos} % : ${100 - pos} %, Schüsse ${s[0].shots ?? 0}:${s[1].shots ?? 0}, aufs Tor ${s[0].onTarget ?? 0}:${s[1].onTarget ?? 0}, xG ${(s[0].xg ?? 0).toFixed(2)}:${(s[1].xg ?? 0).toFixed(2)}, Gelb ${s[0].yellow ?? 0}:${s[1].yellow ?? 0}`);
  }
  const motm = data?.players?.find((p) => p.playerId === data?.motm);
  if (motm) lines.push(`Spieler des Spiels: ${motm.name} (Note ${motm.rating.toFixed(1)})`);
  return lines.join("\n");
}

/** Vorlagenartikel durch einen Claude-Text ersetzen (läuft nach dem Spieltag im Hintergrund). */
export async function rewriteMatchArticle(accountId: string, articleId: number, fixtureId: number, input: Parameters<typeof matchFacts>[0]) {
  if (!(await aiEnabled(accountId))) return;
  // Kurz warten, bis die Transaktion des Spieltags abgeschlossen ist
  for (let i = 0; i < 5; i++) {
    if (await one(pool(), "select 1 from media where id = $1", [articleId])) break;
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  const rep = await one<{ data: ReportData }>(pool(), "select data from match_reports where fixture_id = $1", [fixtureId]);
  const res = await generate({ accountId, feature: "match", system: SYSTEM, messages: [{ role: "user", content: matchFacts(input, rep?.data ?? null) }], schema: SCHEMA, maxTokens: 2000 });
  const out = parseJson<{ headline: string; body: string }>(res);
  if (!out?.headline || !out.body) return;
  await query(pool(), "update media set title = $2, body = $3, ai = true where id = $1", [articleId, out.headline.slice(0, 120), out.body.slice(0, 2000)]);
}
