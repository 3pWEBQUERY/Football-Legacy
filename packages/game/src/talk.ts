/** Gespräche unter vier Augen: Lob, Kritik, Zuspruch und Versprechen. */
import { Rng, dateOf, seedFor, squadRanks, type Player } from "@fl/sim";
import type pg from "pg";
import { withCareer } from "./career";
import { GameError } from "./errors";
import { type CareerRow, addInbox, getPlayer, getPlayers, savePlayers } from "./repo";

export type TalkTopic = "praise" | "criticize" | "encourage" | "promise";

const clamp = (v: number) => Math.max(5, Math.min(100, Math.round(v)));

export async function talkToPlayer(careerId: string, accountId: string, playerId: number, topic: TalkTopic) {
  return withCareer(careerId, accountId, async (db, career) => {
    const p = await getPlayer(db, career.id, playerId);
    if (!p || p.clubId !== career.club_id) throw new GameError("Spieler nicht in deinem Kader.");
    if (p.talk && p.talk.season === career.season && career.day - p.talk.day < 7) {
      throw new GameError(`Du hast erst vor Kurzem mit ${p.lastName} gesprochen. Warte ein paar Tage.`);
    }
    const rng = new Rng(seedFor(career.seed, "talk", p.id, career.season, career.day));
    const name = p.lastName;
    let reaction: string;
    let tone: "positive" | "neutral" | "negative";
    const before = p.morale;
    switch (topic) {
      case "praise":
        if (p.form >= 6.8) {
          p.morale = clamp(p.morale + 8);
          reaction = `${name} freut sich über das Lob und will die Form halten.`;
          tone = "positive";
        } else if (p.form >= 6) {
          p.morale = clamp(p.morale + 3);
          reaction = `${name} nimmt das Lob dankend an.`;
          tone = "neutral";
        } else {
          p.morale = clamp(p.morale - 2);
          reaction = `${name} wirkt irritiert – das Lob passt nicht zu seinen Leistungen.`;
          tone = "negative";
        }
        break;
      case "criticize":
        if (p.form >= 6.8) {
          p.morale = clamp(p.morale - 12);
          reaction = `${name} versteht die Kritik nicht. Er sieht sich in guter Form.`;
          tone = "negative";
        } else if (rng.chance(0.4 + p.attrs.composure / 40)) {
          p.morale = clamp(p.morale - 2);
          p.form = Math.min(10, Math.round((p.form + 0.4) * 10) / 10);
          reaction = `${name} nimmt sich die Kritik zu Herzen und verspricht eine Reaktion.`;
          tone = "positive";
        } else {
          p.morale = clamp(p.morale - 10);
          reaction = `${name} reagiert verärgert und verlässt das Gespräch frühzeitig.`;
          tone = "negative";
        }
        break;
      case "encourage":
        if (p.morale < 45) {
          p.morale = clamp(p.morale + 7);
          reaction = `${name} schöpft neuen Mut.`;
          tone = "positive";
        } else {
          p.morale = clamp(p.morale + 2);
          reaction = `${name} bedankt sich, ihm geht es aber ohnehin gut.`;
          tone = "neutral";
        }
        break;
      case "promise": {
        if (p.promise && p.promise.season === career.season) throw new GameError(`Du hast ${name} bereits Einsatzzeit versprochen.`);
        const squad = await getPlayers(db, career.id, [career.club_id!]);
        const rank = squadRanks(squad).get(p.id) ?? 30;
        if (rank <= 11) {
          p.morale = clamp(p.morale + 2);
          reaction = `${name} sieht sich ohnehin als Stammspieler. Ein Versprechen braucht es nicht.`;
          tone = "neutral";
        } else {
          p.morale = clamp(p.morale + 12);
          p.promise = { season: career.season, until: career.day + 28, needed: 2, starts: 0 };
          const d = dateOf(career.season, p.promise.until);
          reaction = `${name} nimmt dich beim Wort: zwei Einsätze in der Startelf bis zum ${d.getUTCDate()}.${d.getUTCMonth() + 1}. Hältst du das Versprechen nicht, ist er enttäuscht.`;
          tone = "positive";
        }
        break;
      }
      default:
        throw new GameError("Unbekanntes Gesprächsthema");
    }
    p.talk = { season: career.season, day: career.day };
    await savePlayers(db, career.id, [p]);
    return { reaction, tone, moraleChange: p.morale - before, morale: p.morale, promise: p.promise ?? null };
  });
}

/** Täglich: Versprechen auswerten. Gibt Ereignistitel zurück. */
export async function checkPromises(db: pg.PoolClient, career: CareerRow, squad: Player[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of squad) {
    const pr = p.promise;
    if (!pr) continue;
    if (pr.season !== career.season) {
      p.promise = null;
      continue;
    }
    if (pr.starts >= pr.needed) {
      p.promise = null;
      p.morale = clamp(p.morale + 5);
      await addInbox(db, career.id, career.season, career.week, "contract", `Versprechen gehalten: ${p.firstName} ${p.lastName}`,
        `${p.firstName} ${p.lastName} hat die versprochenen Einsätze bekommen und ist zufrieden.`, { type: "player", playerId: p.id });
      out.push(`Versprechen gehalten: ${p.lastName}`);
    } else if (career.day > pr.until) {
      p.promise = null;
      p.morale = clamp(p.morale - 20);
      await addInbox(db, career.id, career.season, career.week, "contract", `Versprechen gebrochen: ${p.firstName} ${p.lastName}`,
        `Du hast ${p.firstName} ${p.lastName} ${pr.needed} Einsätze in der Startelf versprochen, er kam nur auf ${pr.starts}. Er ist schwer enttäuscht.`,
        { type: "player", playerId: p.id });
      out.push(`Versprechen gebrochen: ${p.lastName}`);
    }
  }
  return out;
}
