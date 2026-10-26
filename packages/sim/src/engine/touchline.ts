/**
 * Matchengine: Einfluss von der Seitenlinie. Zurufe wirken 15 Minuten, die
 * Halbzeitansprache die ganze zweite Halbzeit. Wie gut etwas ankommt, hängt
 * vom Spielstand, der Spielminute und der Rolle (Favorit/Aussenseiter) ab.
 */
import { HALF_TICK, type MatchState, type Side } from "./types";
import { minuteOf, onPitch, pushEvent } from "./util";

export type ShoutKind = "encourage" | "demand" | "focus" | "calm" | "praise" | "attack";
export type HalftimeTone = "praise" | "encourage" | "calm" | "demand" | "disappointed";

export const SHOUTS: Record<ShoutKind, { label: string; hint: string }> = {
  encourage: { label: "Ermutigen", hint: "Hilft vor allem bei Rückstand oder Gleichstand." },
  demand: { label: "Mehr fordern", hint: "Wirkt, wenn ein Favorit nicht führt – Aussenseiter verunsichert es." },
  focus: { label: "Konzentrieren", hint: "In engen Spielen und in der Schlussphase wichtig." },
  calm: { label: "Ruhe bewahren", hint: "Sichert eine Führung ab – bei Rückstand wirkt es passiv." },
  praise: { label: "Loben", hint: "Bestärkt eine Mannschaft, die führt." },
  attack: { label: "Alles nach vorne!", hint: "Letzte Viertelstunde bei Rückstand – sonst riskant." },
};

export const HALFTIME_TONES: Record<HalftimeTone, { label: string; text: string }> = {
  praise: { label: "Loben", text: "„Starke erste Hälfte – genau so weiter!“" },
  encourage: { label: "Aufmuntern", text: "„Kopf hoch, wir sind noch voll drin!“" },
  calm: { label: "Ruhig bleiben", text: "„Bleibt geduldig und konzentriert.“" },
  demand: { label: "Mehr verlangen", text: "„Das reicht nicht. Ich will mehr sehen!“" },
  disappointed: { label: "Enttäuscht", text: "„Das war nichts. Ich bin enttäuscht von euch.“" },
};

/** Wirkt ein Zuruf frühestens wieder nach dieser Zeit (5 Spielminuten). */
export const SHOUT_COOLDOWN = 30;
const SHOUT_TICKS = 90;

function situation(state: MatchState, side: Side) {
  const own = state.teams[side];
  const opp = state.teams[side === 0 ? 1 : 0];
  const avg = (t: typeof own) => {
    const ids = onPitch(t);
    if (!ids.length) return 0;
    return ids.reduce((s, i) => s + Object.values(t.players[i].attrs).reduce((a, b) => a + b, 0), 0) / ids.length;
  };
  const strength = avg(own) - avg(opp) + (side === 0 ? 4 : -4);
  return { diff: own.goals - opp.goals, minute: minuteOf(state.tick), favourite: strength > 6, underdog: strength < -6 };
}

function reactionText(v: number) {
  if (v >= 0.025) return "Die Mannschaft reagiert begeistert.";
  if (v >= 0.012) return "Die Spieler nehmen den Zuruf auf.";
  if (v > 0) return "Kaum eine Reaktion.";
  return "Die Spieler wirken verunsichert.";
}

/** Zuruf von der Seitenlinie. Liefert die Wirkung (−0,03 … +0,04) und einen Text. */
export function shout(state: MatchState, side: Side, kind: ShoutKind): { ok: boolean; boost: number; text: string } {
  const team = state.teams[side];
  if (!SHOUTS[kind]) return { ok: false, boost: 0, text: "Unbekannter Zuruf." };
  if (state.finished) return { ok: false, boost: 0, text: "Das Spiel ist vorbei." };
  if ((team.shoutReady ?? 0) > state.tick) return { ok: false, boost: 0, text: "Die Spieler brauchen einen Moment – warte ein paar Minuten bis zum nächsten Zuruf." };
  const { diff, minute, favourite, underdog } = situation(state, side);
  let v: number;
  switch (kind) {
    case "encourage": v = diff < 0 ? 0.03 : diff === 0 ? 0.02 : 0.01; break;
    case "demand": v = diff > 0 ? 0.005 : favourite ? 0.035 : underdog && diff < 0 ? -0.02 : 0.015; break;
    case "focus": v = minute >= 75 || Math.abs(diff) === 1 ? 0.025 : 0.01; break;
    case "calm": v = diff > 0 ? 0.025 : diff === 0 ? 0.01 : -0.01; break;
    case "praise": v = diff > 0 ? 0.03 : diff === 0 ? 0.01 : -0.015; break;
    case "attack": v = diff < 0 && minute >= 75 ? 0.04 : diff < 0 ? 0.01 : -0.02; break;
  }
  // Derselbe Zuruf direkt hintereinander nutzt sich ab
  if (team.shout?.kind === kind) v = v > 0 ? v / 2 : v;
  team.shout = { kind, until: state.tick + SHOUT_TICKS, boost: v };
  team.shoutReady = state.tick + SHOUT_COOLDOWN;
  const text = `Zuruf von der Seitenlinie: „${SHOUTS[kind].label}“ – ${reactionText(v)}`;
  pushEvent(state, "tactic", side, text, {});
  return { ok: true, boost: v, text };
}

/** Halbzeitansprache: bestimmt die Einstellung für die zweite Halbzeit. */
export function halftimeTalk(state: MatchState, side: Side, tone: HalftimeTone): { ok: boolean; spirit: number; text: string } {
  const team = state.teams[side];
  if (!HALFTIME_TONES[tone]) return { ok: false, spirit: 0, text: "Unbekannte Ansprache." };
  if (state.tick < HALF_TICK || state.tick > HALF_TICK + 6) return { ok: false, spirit: 0, text: "Die Halbzeitansprache ist nur in der Pause möglich." };
  if (team.spirit !== undefined) return { ok: false, spirit: team.spirit, text: "Die Ansprache hast du bereits gehalten." };
  const { diff, favourite, underdog } = situation(state, side);
  let v: number;
  switch (tone) {
    case "praise": v = diff > 0 ? 0.03 : diff === 0 ? 0.01 : -0.02; break;
    case "encourage": v = diff === -1 ? 0.03 : diff < -1 ? 0.01 : diff === 0 ? 0.02 : 0.01; break;
    case "calm": v = diff > 0 ? 0.02 : diff === 0 ? 0.015 : 0.005; break;
    case "demand": v = favourite ? (diff <= 0 ? 0.035 : 0.01) : underdog ? (diff < 0 ? -0.02 : 0.005) : diff <= 0 ? 0.02 : 0.005; break;
    case "disappointed": v = diff <= -2 ? 0.03 : diff === -1 ? 0.01 : -0.03; break;
  }
  team.spirit = v;
  // Die Ansprache färbt auf die Moral der Spieler ab
  for (const i of onPitch(team)) team.players[i].morale = Math.max(5, Math.min(100, team.players[i].morale + Math.round(v * 200)));
  const reaction = v >= 0.025 ? "Die Mannschaft kommt hochmotiviert aus der Kabine." : v >= 0.012 ? "Die Worte kommen an." : v > 0 ? "Die Ansprache bewirkt wenig." : "Die Spieler wirken getroffen und verunsichert.";
  const text = `Halbzeitansprache: „${HALFTIME_TONES[tone].label}“ – ${reaction}`;
  pushEvent(state, "tactic", side, text, {});
  return { ok: true, spirit: v, text };
}
