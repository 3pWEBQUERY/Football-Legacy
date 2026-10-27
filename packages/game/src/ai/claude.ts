/**
 * Anbindung an Claude (Anthropic) für Texte im Spiel: freie Antworten in der
 * Pressekonferenz, Spielberichte und den Co-Trainer-Chat. Die Spiellogik
 * bleibt regelbasiert – Claude formuliert Texte und ordnet freie Eingaben
 * festen Antwortmöglichkeiten zu.
 *
 * Nur aktiv, wenn ANTHROPIC_API_KEY gesetzt ist und der Spieler die
 * KI-Funktionen in den Einstellungen eingeschaltet hat. Bei Fehlern, Absagen
 * oder erreichtem Tageslimit fällt das Spiel auf die Vorlagen zurück.
 */
import Anthropic from "@anthropic-ai/sdk";
import { one, pool, query } from "../db";
import { GameError } from "../errors";
import { attempts, record, type Limit } from "../account/limits";

export const AI_MODEL = "claude-sonnet-5-5";
/** KI-Anfragen je Konto und Tag. */
export const AI_DAILY: Limit = { kind: "ai_text", max: 80, minutes: 24 * 60 };

export interface AiRequest {
  accountId: string;
  feature: "press" | "match" | "assistant";
  /** Gleichbleibende Anweisungen (werden zwischengespeichert) */
  system: string;
  /** Wechselnde Spieldaten als Teil der Anweisungen (optional) */
  context?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** JSON-Schema für strukturierte Antworten; ohne Schema kommt Fliesstext zurück */
  schema?: Record<string, unknown>;
  maxTokens?: number;
}

export interface AiResponse { text: string; inputTokens: number; outputTokens: number }
export type AiTransport = (req: AiRequest) => Promise<AiResponse | null>;

let client: Anthropic | null = null;

/** Standard: Anthropic-API mit Sonnet 5.5, wenig Denkaufwand, Rückfallmodell bei Absagen. */
const anthropic: AiTransport = async (req) => {
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 });
  const res = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: req.maxTokens ?? 1500,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", ...(req.schema ? { format: { type: "json_schema" as const, schema: req.schema } } : {}) },
    system: [
      { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
      ...(req.context ? [{ type: "text" as const, text: req.context }] : []),
    ],
    messages: req.messages,
  });
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  if (!text) return null;
  return { text, inputTokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0), outputTokens: res.usage.output_tokens };
};

let transport: AiTransport = anthropic;

/** Für Tests: Antworten vorgeben. Ohne Argument wieder die echte API. */
export function setAiTransport(t?: AiTransport) {
  transport = t ?? anthropic;
}

/** Ist ein API-Schlüssel hinterlegt (oder in Tests eine Attrappe)? */
export function aiConfigured(): boolean {
  return transport !== anthropic || !!process.env.ANTHROPIC_API_KEY;
}

/** Hat der Spieler die KI-Funktionen eingeschaltet? */
export async function aiEnabled(accountId: string): Promise<boolean> {
  if (!aiConfigured()) return false;
  const r = await one<{ on: boolean }>(pool(), "select coalesce((settings->>'ai')::boolean, false) as on from accounts where id = $1", [accountId]);
  return !!r?.on;
}

export async function aiStatus(accountId: string) {
  const used = await attempts(AI_DAILY, accountId);
  return { configured: aiConfigured(), enabled: await aiEnabled(accountId), model: "Claude Sonnet 5.5", used, limit: AI_DAILY.max };
}

/**
 * Anfrage an Claude. Liefert null, wenn die KI aus ist, das Tageslimit
 * erreicht ist oder etwas schiefgeht – der Aufrufer nutzt dann die Vorlage.
 * Mit `required` wird stattdessen ein verständlicher Fehler geworfen.
 */
export async function generate(req: AiRequest, required = false): Promise<AiResponse | null> {
  const fail = (msg: string, status = 400) => { if (required) throw new GameError(msg, status); return null; };
  if (!(await aiEnabled(req.accountId))) return fail("Die KI-Funktionen sind ausgeschaltet. Du kannst sie in den Einstellungen aktivieren.");
  if ((await attempts(AI_DAILY, req.accountId)) >= AI_DAILY.max) return fail(`Tageslimit für KI-Texte erreicht (${AI_DAILY.max}). Morgen geht es weiter.`, 429);
  await record(AI_DAILY, req.accountId);
  let res: AiResponse | null = null;
  try {
    res = await transport(req);
  } catch (e) {
    console.error("[ai]", req.feature, (e as Error).message);
  }
  await query(pool(), "insert into ai_log(account_id, feature, input_tokens, output_tokens, ok) values ($1,$2,$3,$4,$5)",
    [req.accountId, req.feature, res?.inputTokens ?? null, res?.outputTokens ?? null, !!res]).catch(() => {});
  if (Math.random() < 0.02) await query(pool(), "delete from ai_log where created_at < now() - interval '30 days'").catch(() => {});
  if (!res) return fail("Der Co-Trainer ist gerade nicht erreichbar. Versuche es gleich noch einmal.", 503);
  return res;
}

/** Strukturierte Antwort lesen; null bei ungültigem JSON. */
export function parseJson<T>(res: AiResponse | null): T | null {
  if (!res) return null;
  try {
    return JSON.parse(res.text) as T;
  } catch {
    return null;
  }
}

/** Gemeinsame Stilregeln für alle Texte. */
export const STYLE_RULES = [
  "Schreibe auf Deutsch in Schweizer Rechtschreibung (ss statt ß).",
  "Football Legacy ist ein fiktives Fussballspiel: alle Vereine, Spieler und Ereignisse sind erfunden.",
  "Nutze ausschliesslich die mitgelieferten Spieldaten. Erfinde keine Namen, Zahlen, Ergebnisse oder Ereignisse.",
  "Keine Beleidigungen, keine Diskriminierung, keine Inhalte ausserhalb des Fussballs.",
].join("\n");
