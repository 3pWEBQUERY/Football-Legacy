/**
 * Seitenlinie im eigenen Spiel: Zurufe während der Partie, Halbzeitansprache
 * und Schlussansprache nach dem Abpfiff (wirkt auf die Moral der Spieler).
 */
import { HALFTIME_TONES, SHOUTS, halftimeTalk, shout, type HalftimeTone, type MatchState, type ShoutKind } from "@fl/sim";
import { withCareer } from "./career";
import { one, type Db } from "./db";
import { GameError } from "./errors";
import { getClub, getPlayers, saveCareer, savePlayers, type CareerRow, type FixtureRow } from "./repo";

export type PostTone = "praise" | "satisfied" | "disappointed" | "angry";

export const POST_TONES: Record<PostTone, { label: string; text: string }> = {
  praise: { label: "Loben", text: "„Großartige Leistung – ich bin stolz auf euch.“" },
  satisfied: { label: "Zufrieden", text: "„Ordentlich gemacht. Darauf bauen wir auf.“" },
  disappointed: { label: "Enttäuscht", text: "„Das war unter unseren Möglichkeiten.“" },
  angry: { label: "Wütend", text: "„So eine Leistung will ich nie wieder sehen!“" },
};

/** Moralwirkung nach Ergebnis (S/U/N) und Rolle vor dem Spiel. */
const POST_EFFECT: Record<PostTone, Record<"W" | "D" | "L", Record<"fav" | "even" | "dog", number>>> = {
  praise: { W: { fav: 3, even: 5, dog: 6 }, D: { fav: -2, even: 1, dog: 4 }, L: { fav: -4, even: -3, dog: 1 } },
  satisfied: { W: { fav: 3, even: 3, dog: 3 }, D: { fav: 0, even: 2, dog: 3 }, L: { fav: -3, even: -2, dog: 2 } },
  disappointed: { W: { fav: -2, even: -4, dog: -5 }, D: { fav: 2, even: -1, dog: -4 }, L: { fav: 3, even: 2, dog: -2 } },
  angry: { W: { fav: -5, even: -7, dog: -8 }, D: { fav: 1, even: -3, dog: -6 }, L: { fav: 3, even: 0, dog: -5 } },
};

function pendingState(career: CareerRow) {
  const pending = career.pending_match;
  if (!pending) throw new GameError("Kein laufendes Spiel.");
  return { pending, state: pending.state as MatchState };
}

/** Zuruf an die eigene Mannschaft. */
export async function matchShout(careerId: string, accountId: string, kind: ShoutKind) {
  return withCareer(careerId, accountId, async (db, career) => {
    const { pending, state } = pendingState(career);
    if (!SHOUTS[kind]) throw new GameError("Unbekannter Zuruf");
    const r = shout(state, pending.side, kind);
    if (!r.ok) throw new GameError(r.text);
    await saveCareer(db, career);
    const team = state.teams[pending.side];
    return { ...r, events: state.events, shout: team.shout, shoutReady: team.shoutReady ?? 0 };
  });
}

/** Halbzeitansprache (nur in der Pause, einmal pro Spiel). */
export async function halftimeAddress(careerId: string, accountId: string, tone: HalftimeTone) {
  return withCareer(careerId, accountId, async (db, career) => {
    const { pending, state } = pendingState(career);
    if (!HALFTIME_TONES[tone]) throw new GameError("Unbekannte Ansprache");
    const r = halftimeTalk(state, pending.side, tone);
    if (!r.ok) throw new GameError(r.text);
    await saveCareer(db, career);
    return { ...r, events: state.events };
  });
}

async function lastUserMatch(db: Db, career: CareerRow) {
  if (!career.club_id) return null;
  return one<FixtureRow>(db,
    "select * from fixtures where career_id = $1 and season = $2 and played and $3 in (home_id, away_id) order by week desc, id desc limit 1",
    [career.id, career.season, career.club_id]);
}

async function roleOf(db: Db, career: CareerRow, f: FixtureRow): Promise<"fav" | "even" | "dog"> {
  const own = (await getClub(db, career.id, career.club_id!))!;
  const opp = (await getClub(db, career.id, f.home_id === own.id ? f.away_id : f.home_id))!;
  const diff = own.rating - opp.rating + (f.home_id === own.id ? 2 : -2);
  return diff >= 5 ? "fav" : diff <= -5 ? "dog" : "even";
}

function outcome(career: CareerRow, f: FixtureRow): "W" | "D" | "L" {
  const home = f.home_id === career.club_id;
  const gf = (home ? f.home_goals : f.away_goals) ?? 0;
  const ga = (home ? f.away_goals : f.home_goals) ?? 0;
  if (gf === ga && f.pen_home !== null && f.pen_away !== null) return (home ? f.pen_home > f.pen_away : f.pen_away > f.pen_home) ? "W" : "L";
  return gf > ga ? "W" : gf === ga ? "D" : "L";
}

/** Ist für das letzte eigene Spiel noch eine Schlussansprache offen? */
export async function postMatchState(db: Db, career: CareerRow) {
  const f = await lastUserMatch(db, career);
  if (!f || career.manager.postTalkDone === f.id) return null;
  // Nur direkt nach dem Spiel (bis zum nächsten Spiel)
  const day = career.calendar?.slots[f.week - 1]?.day;
  if (day !== undefined && career.day - day > 1) return null;
  return { fixtureId: f.id, result: outcome(career, f), role: await roleOf(db, career, f), tones: (Object.keys(POST_TONES) as PostTone[]).map((k) => ({ id: k, ...POST_TONES[k] })) };
}

/** Schlussansprache: wirkt auf die Moral aller Spieler, die gespielt haben. */
export async function postMatchTalk(careerId: string, accountId: string, tone: PostTone) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!POST_TONES[tone]) throw new GameError("Unbekannte Ansprache");
    const st = await postMatchState(db, career);
    if (!st) throw new GameError("Für das letzte Spiel ist keine Schlussansprache mehr möglich.");
    const rep = await one<{ data: { players?: { playerId: number; side: number; rating: number }[] } }>(db, "select data from match_reports where fixture_id = $1", [st.fixtureId]);
    const f = (await one<FixtureRow>(db, "select * from fixtures where id = $1", [st.fixtureId]))!;
    const side = f.home_id === career.club_id ? 0 : 1;
    const lines = new Map((rep?.data.players ?? []).filter((l) => l.side === side).map((l) => [l.playerId, l.rating]));
    const base = POST_EFFECT[tone][st.result][st.role];
    const squad = await getPlayers(db, career.id, [career.club_id!]);
    const changed = [];
    for (const p of squad) {
      if (!lines.has(p.id)) continue;
      const rating = lines.get(p.id)!;
      // Wer gut gespielt hat, verträgt Kritik schlecht und freut sich über Lob – und umgekehrt
      const personal = rating >= 7.5 ? (tone === "praise" ? 2 : tone === "angry" || tone === "disappointed" ? -3 : 0) : rating < 6 ? (tone === "praise" ? -1 : tone === "disappointed" ? 1 : 0) : 0;
      p.morale = Math.max(5, Math.min(100, p.morale + base + personal));
      changed.push(p);
    }
    await savePlayers(db, career.id, changed);
    career.manager.postTalkDone = st.fixtureId;
    await saveCareer(db, career);
    const reaction = base >= 4 ? "Die Mannschaft nimmt die Worte begeistert auf." : base >= 1 ? "Die Spieler nicken zustimmend." : base === 0 ? "Die Ansprache verhallt." : base >= -3 ? "Einige Spieler wirken getroffen." : "Die Stimmung in der Kabine kippt.";
    return { effect: base, reaction, players: changed.length };
  });
}
