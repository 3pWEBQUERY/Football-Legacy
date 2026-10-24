/** Mannschaftsansprache vor dem Anpfiff: wirkt auf die Moral aller Spieler. */
import { withCareer } from "./career";
import { GameError } from "./errors";
import { one } from "./db";
import { type FixtureRow, getClub, getPlayers, saveCareer, savePlayers } from "./repo";

export type TalkTone = "motivate" | "relax" | "demand";

const TONES: Record<TalkTone, { label: string; text: string }> = {
  motivate: { label: "Motivieren", text: "„Heute können wir jeden schlagen. Geht raus und zeigt es!“" },
  relax: { label: "Druck rausnehmen", text: "„Genießt das Spiel. Spielt frei und mutig.“" },
  demand: { label: "Fordern", text: "„Ich erwarte heute einen Sieg. Alles andere ist zu wenig.“" },
};

async function nextFixture(db: import("pg").PoolClient, careerId: string, season: number, week: number, clubId: number) {
  return one<FixtureRow>(db, "select * from fixtures where career_id = $1 and season = $2 and week = $3 and not played and $4 in (home_id, away_id)", [careerId, season, week, clubId]);
}

export async function teamTalkState(careerId: string, accountId: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) return { available: false, done: false, tones: [] };
    const f = await nextFixture(db, career.id, career.season, career.week + 1, career.club_id);
    if (!f) return { available: false, done: false, tones: [] };
    return {
      available: true,
      done: career.manager.teamTalkDone === f.id,
      tones: (Object.keys(TONES) as TalkTone[]).map((k) => ({ id: k, ...TONES[k] })),
    };
  });
}

export async function giveTeamTalk(careerId: string, accountId: string, tone: TalkTone) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) throw new GameError("Kein Verein");
    if (!TONES[tone]) throw new GameError("Unbekannte Ansprache");
    const f = await nextFixture(db, career.id, career.season, career.week + 1, career.club_id);
    if (!f) throw new GameError("Heute steht kein Spiel an.");
    if (career.manager.teamTalkDone === f.id) throw new GameError("Die Ansprache hast du bereits gehalten.");
    const own = (await getClub(db, career.id, career.club_id))!;
    const opp = (await getClub(db, career.id, f.home_id === own.id ? f.away_id : f.home_id))!;
    const diff = own.rating - opp.rating + (f.home_id === own.id ? 2 : -2);
    const role = diff >= 5 ? "favourite" : diff <= -5 ? "underdog" : "even";
    const squad = await getPlayers(db, career.id, [own.id]);
    const avgMorale = squad.reduce((s, p) => s + p.morale, 0) / Math.max(1, squad.length);
    const effect = {
      motivate: { underdog: 6, even: 3, favourite: 1 },
      relax: { underdog: 3, even: 2, favourite: 0 },
      demand: { underdog: -4, even: 1, favourite: 5 },
    }[tone][role] + (tone === "relax" && avgMorale < 45 ? 5 : 0) + (tone === "demand" && avgMorale < 40 ? -3 : 0);
    for (const p of squad) p.morale = Math.max(5, Math.min(100, Math.round(p.morale + effect)));
    await savePlayers(db, career.id, squad);
    career.manager.teamTalkDone = f.id;
    await saveCareer(db, career);
    const reaction = effect >= 4 ? "Die Mannschaft ist hochmotiviert." : effect >= 1 ? "Die Spieler nehmen die Worte auf." : effect === 0 ? "Die Ansprache verpufft." : "Einige Spieler wirken verunsichert.";
    return { effect, reaction, role: role === "favourite" ? "Favorit" : role === "underdog" ? "Aussenseiter" : "Ausgeglichen" };
  });
}
