/**
 * Pressekonferenz vor dem Spiel: kontextabhängige Fragen, deren Antworten auf
 * Mannschaftsmoral, einzelne Spieler und das Vertrauen des Vorstands wirken.
 */
import type { Player } from "@fl/sim";
import { Rng, seedFor } from "@fl/sim";
import type pg from "pg";
import { query } from "./db";
import { withCareer } from "./career";
import { GameError } from "./errors";
import { type CareerRow, type FixtureRow, getClub, getPlayers, saveCareer, savePlayers } from "./repo";
import { type RewardNote, grantXp } from "./rewards";

interface Effect {
  team?: number; // Moral aller Spieler
  star?: number; // Moral des Leistungsträgers
  young?: number; // Moral der Talente (bis 21)
  board?: number; // Vertrauen des Vorstands
}

interface Answer {
  text: string;
  tone: string;
  effect: Effect;
}

interface Question {
  id: string;
  text: string;
  answers: Answer[];
}

interface Context {
  fixture: FixtureRow;
  ownRating: number;
  oppRating: number;
  oppName: string;
  form: ("W" | "D" | "L")[];
  star: Player | null;
  injuredStarters: number;
  cup: boolean;
  underPressure: boolean;
}

function questions(ctx: Context): Question[] {
  const diff = ctx.ownRating - ctx.oppRating;
  const last3 = ctx.form.slice(0, 3);
  const last4 = ctx.form.slice(0, 4);
  const out: Question[] = [];
  if (ctx.cup) {
    out.push({
      id: "cup", text: `Pokalspiel gegen ${ctx.oppName}: Welchen Stellenwert hat der Wettbewerb für euch?`,
      answers: [
        { text: "Wir wollen den Pokal holen – jedes Spiel ist ein Finale.", tone: "Ehrgeizig", effect: { team: 3, board: 2 } },
        { text: "Wir nehmen es Runde für Runde.", tone: "Sachlich", effect: { team: 1 } },
        { text: "Die Liga hat Vorrang.", tone: "Nüchtern", effect: { team: -2, board: -1 } },
      ],
    });
  }
  if (diff >= 5) {
    out.push({
      id: "favourite", text: `Ihr geht als klarer Favorit gegen ${ctx.oppName} ins Spiel. Ist ein Sieg Pflicht?`,
      answers: [
        { text: "Ja. Alles andere wäre eine Enttäuschung.", tone: "Selbstbewusst", effect: { team: 2, board: 2 } },
        { text: "Jeder Gegner muss erst geschlagen werden.", tone: "Zurückhaltend", effect: { team: 1 } },
        { text: "Die Favoritenrolle interessiert mich nicht.", tone: "Ausweichend", effect: { board: -1 } },
      ],
    });
  } else if (diff <= -5) {
    out.push({
      id: "underdog", text: `${ctx.oppName} gilt als Favorit. Was ist für euch drin?`,
      answers: [
        { text: "Wir haben keine Angst – wir wollen gewinnen.", tone: "Kämpferisch", effect: { team: 4, board: -1 } },
        { text: "Wir wollen uns so teuer wie möglich verkaufen.", tone: "Realistisch", effect: { team: 1, board: 1 } },
        { text: "Ein Punkt wäre schon ein Erfolg.", tone: "Defensiv", effect: { team: -2, board: 1 } },
      ],
    });
  }
  if (last3.length >= 3 && last3.filter((r) => r === "L").length >= 2) {
    out.push({
      id: "crisis", text: "Kaum Punkte in den letzten Spielen. Steckt die Mannschaft in der Krise?",
      answers: [
        { text: "Ich stehe voll hinter meinen Spielern.", tone: "Schützend", effect: { team: 5, board: -1 } },
        { text: "Die Leistungen müssen besser werden – das wissen alle.", tone: "Fordernd", effect: { team: -2, board: 3 } },
        { text: "Dazu sage ich nichts.", tone: "Abweisend", effect: { team: -1, board: -1 } },
      ],
    });
  } else if (last4.length >= 4 && last4.filter((r) => r === "W").length >= 3) {
    out.push({
      id: "form", text: "Ihr seid in starker Form. Ist die Mannschaft im Moment zu stoppen?",
      answers: [
        { text: "Wir bleiben bescheiden und arbeiten weiter.", tone: "Bodenständig", effect: { team: 1, board: 1 } },
        { text: "So wie wir spielen, schlagen wir jeden.", tone: "Euphorisch", effect: { team: 4, board: -1 } },
        { text: "Der Verdienst gehört allein der Mannschaft.", tone: "Lobend", effect: { team: 3 } },
      ],
    });
  }
  if (ctx.star) {
    const n = `${ctx.star.firstName} ${ctx.star.lastName}`;
    out.push({
      id: "star", text: `${n} ist in herausragender Form. Wie wichtig ist er für das Team?`,
      answers: [
        { text: `${ctx.star.lastName} ist im Moment der beste Spieler der Liga.`, tone: "Lobend", effect: { star: 8, team: -1 } },
        { text: "Bei uns zählt die Mannschaft, nicht der Einzelne.", tone: "Teamorientiert", effect: { team: 2 } },
        { text: "Er kann noch mehr – ich erwarte noch eine Steigerung.", tone: "Fordernd", effect: { star: -3, board: 1 } },
      ],
    });
  }
  if (ctx.injuredStarters >= 2) {
    out.push({
      id: "injuries", text: "Mehrere Stammspieler fallen aus. Wie wollt ihr das auffangen?",
      answers: [
        { text: "Das ist die Chance für die jungen Spieler.", tone: "Optimistisch", effect: { team: 1, young: 6 } },
        { text: "Das wird schwer zu kompensieren.", tone: "Ehrlich", effect: { team: -2, board: 1 } },
        { text: "Ausreden gibt es bei uns nicht.", tone: "Kämpferisch", effect: { team: 2 } },
      ],
    });
  }
  if (ctx.underPressure) {
    out.push({
      id: "pressure", text: "Der Vorstand erwartet mehr. Wackelt dein Stuhl?",
      answers: [
        { text: "Ich bin überzeugt von meinem Weg.", tone: "Selbstbewusst", effect: { team: 2, board: -1 } },
        { text: "Ich verstehe die Erwartungen und nehme sie an.", tone: "Diplomatisch", effect: { board: 3 } },
        { text: "Ich bin hier, um zu arbeiten, nicht um zu reden.", tone: "Gereizt", effect: { team: 1, board: -3 } },
      ],
    });
  }
  out.push({
    id: "opponent", text: `Was erwartest du von ${ctx.oppName}?`,
    answers: [
      { text: "Ein unangenehmer Gegner – wir sind gewarnt.", tone: "Respektvoll", effect: { team: 1 } },
      { text: "Wenn wir unser Spiel machen, gewinnen wir.", tone: "Selbstbewusst", effect: { team: 2, board: 1 } },
      { text: "Wir schauen nur auf uns.", tone: "Neutral", effect: {} },
    ],
  });
  return out.slice(0, 3);
}

async function context(db: pg.PoolClient, career: CareerRow): Promise<{ ctx: Context; squad: Player[] } | null> {
  if (!career.club_id) return null;
  const rows = await query<FixtureRow>(
    db, "select * from fixtures where career_id = $1 and season = $2 and week = $3 and not played and $4 in (home_id, away_id)",
    [career.id, career.season, career.week + 1, career.club_id],
  );
  const f = rows[0];
  if (!f) return null;
  const own = (await getClub(db, career.id, career.club_id))!;
  const opp = (await getClub(db, career.id, f.home_id === own.id ? f.away_id : f.home_id))!;
  const recent = await query<FixtureRow>(
    db, "select * from fixtures where career_id = $1 and season = $2 and played and $3 in (home_id, away_id) order by week desc limit 5",
    [career.id, career.season, own.id],
  );
  const form = recent.map((r) => {
    const gf = r.home_id === own.id ? r.home_goals! : r.away_goals!;
    const ga = r.home_id === own.id ? r.away_goals! : r.home_goals!;
    return (gf > ga ? "W" : gf === ga ? "D" : "L") as "W" | "D" | "L";
  });
  const squad = await getPlayers(db, career.id, [own.id]);
  const starIdx = [...squad].filter((p) => p.stats.apps >= 3 && p.form >= 7).sort((a, b) => b.form - a.form || b.rating - a.rating)[0] ?? null;
  const top14 = new Set([...squad].sort((a, b) => b.rating - a.rating).slice(0, 14).map((p) => p.id));
  const injuredStarters = squad.filter((p) => top14.has(p.id) && p.injuryWeeks > 0).length;
  return {
    ctx: {
      fixture: f, ownRating: own.rating, oppRating: opp.rating, oppName: opp.name, form, star: starIdx, injuredStarters,
      cup: !!f.cup_id, underPressure: (career.board?.confidence ?? 60) < 40,
    },
    squad,
  };
}

export async function pressConference(careerId: string, accountId: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    const c = await context(db, career);
    if (!c) return { available: false, done: false, questions: [] };
    const done = career.manager.pressDone === c.ctx.fixture.id;
    // Reihenfolge der Antworten pro Spiel mischen; "i" ist der Index, der zurückgeschickt wird
    const rng = new Rng(seedFor(career.seed, "press", c.ctx.fixture.id));
    const qs = questions(c.ctx).map((q) => ({
      id: q.id,
      text: q.text,
      answers: rng.shuffle(q.answers.map((a, i) => ({ text: a.text, tone: a.tone, i }))),
    }));
    return { available: true, done, questions: qs };
  });
}

export async function answerPress(careerId: string, accountId: string, answers: Record<string, number>) {
  return withCareer(careerId, accountId, async (db, career) => {
    const c = await context(db, career);
    if (!c) throw new GameError("Diese Woche gibt es keine Pressekonferenz.");
    if (career.manager.pressDone === c.ctx.fixture.id) throw new GameError("Die Pressekonferenz hast du bereits gegeben.");
    const qs = questions(c.ctx);
    const total: Required<Effect> = { team: 0, star: 0, young: 0, board: 0 };
    const reactions: string[] = [];
    for (const q of qs) {
      const idx = answers[q.id];
      const a = typeof idx === "number" ? q.answers[idx] : undefined;
      if (!a) continue;
      total.team += a.effect.team ?? 0;
      total.star += a.effect.star ?? 0;
      total.young += a.effect.young ?? 0;
      total.board += a.effect.board ?? 0;
      reactions.push(a.tone);
    }
    const clamp = (v: number) => Math.max(5, Math.min(100, Math.round(v)));
    for (const p of c.squad) {
      let d = total.team;
      if (c.ctx.star && p.id === c.ctx.star.id) d += total.star;
      if (p.age <= 21) d += total.young;
      p.morale = clamp(p.morale + d);
    }
    await savePlayers(db, career.id, c.squad);
    career.board.confidence = Math.max(0, Math.min(100, career.board.confidence + total.board));
    career.manager.pressDone = c.ctx.fixture.id;
    const notes: RewardNote[] = [];
    grantXp(career, 15, notes);
    await saveCareer(db, career);
    const parts: string[] = [];
    if (total.team) parts.push(`Mannschaftsmoral ${total.team > 0 ? "+" : ""}${total.team}`);
    if (total.star && c.ctx.star) parts.push(`${c.ctx.star.lastName} ${total.star > 0 ? "+" : ""}${total.star}`);
    if (total.young) parts.push(`Talente ${total.young > 0 ? "+" : ""}${total.young}`);
    if (total.board) parts.push(`Vorstand ${total.board > 0 ? "+" : ""}${total.board}`);
    return { effects: parts, notes, reactions };
  });
}
