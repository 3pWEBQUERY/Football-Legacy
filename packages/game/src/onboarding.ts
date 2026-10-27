/**
 * Einstieg: Schwierigkeitsgrad, Willkommens-Tour, Checkliste „Erste Schritte“
 * (mit kleinen Belohnungen) und einmalige Seitentipps.
 */
import { readCareer, withCareer } from "./career";
import { DIFFICULTY, difficultyOf } from "./difficulty";
import { GameError } from "./errors";
import { type CareerRow, saveCareer } from "./repo";
import { type RewardNote, announceNotes, grantXp } from "./rewards";

// ------------------------------------------------------------ Erste Schritte

export interface OnboardingState {
  tourDone?: boolean;
  dismissed?: boolean;
  visited: Record<string, boolean>;
  tips: Record<string, boolean>;
  rewarded: Record<string, boolean>;
}

interface Step { id: string; title: string; text: string; href: string; done: (c: CareerRow, o: OnboardingState) => boolean }

const STEP_XP = 25;
const COMPLETE_XP = 150;
const COMPLETE_POINTS = 50;

const visited = (page: string) => (_: CareerRow, o: OnboardingState) => !!o.visited[page];

export const STEPS: Step[] = [
  { id: "board", title: "Saisonziel kennenlernen", text: "Der Vorstand erwartet eine Platzierung und eine Dreijahres-Vision.", href: "/board", done: visited("board") },
  { id: "squad", title: "Kader ansehen", text: "Stärke, Kondition, Moral und Verträge deiner Spieler.", href: "/team", done: visited("squad") },
  { id: "tactic", title: "Taktik prüfen", text: "Formation, Startelf und Spielweise festlegen.", href: "/team/tactic", done: visited("tactic") },
  { id: "training", title: "Training planen", text: "Schwerpunkt und Intensität bestimmen die Entwicklung.", href: "/team/training", done: visited("training") },
  { id: "market", title: "Transfermarkt erkunden", text: "Spieler suchen, Scouts losschicken, Budget im Blick behalten.", href: "/market/search", done: visited("market") },
  { id: "contracts", title: "Verträge prüfen", text: "Wichtige Spieler rechtzeitig verlängern – sonst gehen sie ablösefrei.", href: "/market/contracts", done: visited("contracts") },
  {
    id: "talk", title: "Vor dem Spiel sprechen", text: "Mannschaftsansprache oder Pressekonferenz vor einem Pflichtspiel.", href: "",
    done: (c) => !!c.manager.teamTalkDone || !!c.manager.pressDone,
  },
  {
    id: "match", title: "Erstes Pflichtspiel bestreiten", text: "Mit „Weiter“ geht es Tag für Tag bis zum Spieltag.", href: "/match",
    done: (c) => c.manager.totals.wins + c.manager.totals.draws + c.manager.totals.losses > 0,
  },
];

/** Seiten, deren Besuch einen Schritt erfüllt. */
export const TRACKED_PAGES: Record<string, string> = {
  "/board": "board", "/team": "squad", "/team/tactic": "tactic", "/team/training": "training", "/market/search": "market", "/market/contracts": "contracts",
};

export function onboardingOf(career: CareerRow): OnboardingState {
  const o = career.manager.onboarding ?? {};
  return { visited: {}, tips: {}, rewarded: {}, ...o };
}

/** Belohnt neu erledigte Schritte und den Abschluss der Checkliste. */
function reward(career: CareerRow, o: OnboardingState, notes: RewardNote[]) {
  const fresh: string[] = [];
  for (const s of STEPS) {
    if (!o.rewarded[s.id] && s.done(career, o)) {
      o.rewarded[s.id] = true;
      grantXp(career, STEP_XP, notes);
      fresh.push(s.title);
    }
  }
  if (!o.rewarded.complete && STEPS.every((s) => o.rewarded[s.id])) {
    o.rewarded.complete = true;
    grantXp(career, COMPLETE_XP, notes);
    career.manager.points += COMPLETE_POINTS;
    fresh.push("Alle ersten Schritte erledigt");
  }
  return fresh;
}

function payload(career: CareerRow, o: OnboardingState) {
  const steps = STEPS.map((s) => ({ id: s.id, title: s.title, text: s.text, href: s.href, done: s.done(career, o) }));
  const done = steps.filter((s) => s.done).length;
  const d = difficultyOf(career);
  return {
    steps, done, total: steps.length, complete: done === steps.length,
    dismissed: !!o.dismissed, tourDone: !!o.tourDone, tips: o.tips,
    active: !o.dismissed && done < steps.length,
    reward: { step: STEP_XP, complete: COMPLETE_XP, points: COMPLETE_POINTS },
    difficulty: { id: d, ...DIFFICULTY[d] },
  };
}

export async function onboardingView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  return payload(career, onboardingOf(career));
}

export type OnboardingAction =
  | { action: "visit"; page: string }
  | { action: "tour" }
  | { action: "dismiss" }
  | { action: "restore" }
  | { action: "tip"; id: string };

export async function onboardingAction(careerId: string, accountId: string, input: OnboardingAction) {
  return withCareer(careerId, accountId, async (db, career) => {
    const o = onboardingOf(career);
    switch (input.action) {
      case "visit": {
        const step = TRACKED_PAGES[input.page];
        if (step) o.visited[step] = true;
        break;
      }
      case "tour": o.tourDone = true; break;
      case "dismiss": o.dismissed = true; break;
      case "restore": o.dismissed = false; o.tips = {}; break;
      case "tip":
        if (!/^[a-z-]{2,32}$/.test(input.id)) throw new GameError("Unbekannter Tipp");
        o.tips[input.id] = true;
        break;
      default: throw new GameError("Unbekannte Aktion");
    }
    const notes: RewardNote[] = [];
    const fresh = reward(career, o, notes);
    career.manager.onboarding = o;
    await saveCareer(db, career);
    if (notes.some((n) => n.kind === "level")) await announceNotes(db, career, notes);
    return { ...payload(career, o), fresh };
  });
}

/** Nach einem Spieltag: Schritte, die sich aus dem Spielstand ergeben, belohnen. */
export function onboardingTick(career: CareerRow, notes: RewardNote[]) {
  const o = onboardingOf(career);
  if (o.dismissed && o.rewarded.complete) return;
  reward(career, o, notes);
  career.manager.onboarding = o;
}
