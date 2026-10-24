/**
 * Länderspielpausen: die besten Spieler werden für ihre Nationalmannschaft
 * abgestellt, verpassen das Training und kehren mit Länderspielen, Moral,
 * Müdigkeit oder auch einer Verletzung zurück.
 */
import { COUNTRIES, COUNTRY_BY_CODE, Rng, injure, internationalWindows, quickResult, seedFor, type Player } from "@fl/sim";
import type pg from "pg";
import { type CareerRow, addInbox } from "./repo";

/** Mindeststärke für eine Nominierung: je stärker das Land, desto höher. */
function threshold(nationality: string): number {
  return 48 + (COUNTRY_BY_CODE[nationality]?.strength ?? 3) * 3.6;
}

const nationRating = (code: string) => 40 + (COUNTRY_BY_CODE[code]?.strength ?? 3) * 5;

export function isAway(p: Player, career: CareerRow): boolean {
  return !!p.away && p.away.season === career.season && career.day <= p.away.until;
}

/** Am ersten und letzten Tag eines Fensters: Abstellung bzw. Rückkehr. Gibt Ereignistitel zurück. */
export async function internationalDuty(db: pg.PoolClient, career: CareerRow, squad: Player[]): Promise<string[]> {
  if (!career.calendar) return [];
  const windows = internationalWindows(career.calendar, career.season);
  const start = windows.find(([a]) => a === career.day);
  const end = windows.find(([, b]) => b + 1 === career.day);
  const out: string[] = [];
  if (start) {
    const called = squad.filter((p) => p.injuryWeeks === 0 && p.rating >= threshold(p.nationality));
    for (const p of called) p.away = { season: career.season, until: start[1] };
    if (called.length) {
      const byNation = new Map<string, Player[]>();
      for (const p of called) byNation.set(p.nationality, [...(byNation.get(p.nationality) ?? []), p]);
      await addInbox(db, career.id, career.season, career.week, "international", `Länderspielpause: ${called.length} ${called.length === 1 ? "Spieler" : "Spieler"} abgestellt`,
        `Diese Spieler reisen bis Donnerstag zu ihren Nationalmannschaften und fehlen im Training:\n` +
          [...byNation.entries()].map(([code, ps]) => `• ${COUNTRY_BY_CODE[code]?.name ?? code}: ${ps.map((p) => `${p.firstName} ${p.lastName}`).join(", ")}`).join("\n"));
      out.push("Länderspielpause");
    }
  }
  if (end) {
    const back = squad.filter((p) => p.away && p.away.season === career.season && p.away.until === end[1]);
    if (back.length) {
      const rng = new Rng(seedFor(career.seed, "international", career.season, end[0]));
      // Zwei Länderspiele je Nation gegen Gegner aus dem eigenen Verband
      const nations = [...new Set(back.map((p) => p.nationality))];
      const games = new Map<string, string[]>();
      for (const code of nations) {
        const confed = COUNTRY_BY_CODE[code]?.confed;
        const pool = COUNTRIES.filter((c) => c.confed === confed && c.code !== code);
        const lines: string[] = [];
        for (let g = 0; g < 2 && pool.length; g++) {
          const opp = pool[rng.int(0, pool.length - 1)];
          const home = rng.chance(0.5);
          const [a, b] = quickResult(rng, nationRating(home ? code : opp.code), nationRating(home ? opp.code : code));
          lines.push(`${home ? COUNTRY_BY_CODE[code].name : opp.name} – ${home ? opp.name : COUNTRY_BY_CODE[code].name} ${a}:${b}`);
        }
        games.set(code, lines);
      }
      const notes: string[] = [];
      for (const p of back) {
        p.away = null;
        const apps = rng.chance(0.75) ? 2 : 1;
        p.caps = (p.caps ?? 0) + apps;
        const scoreChance = ["ST", "AMC", "AML", "AMR"].includes(p.position) ? Math.max(0, Math.min(0.35, (p.attrs.finishing - 8) / 30)) : 0.04;
        let goals = 0;
        for (let i = 0; i < apps; i++) if (rng.chance(scoreChance)) goals++;
        p.intlGoals = (p.intlGoals ?? 0) + goals;
        p.fitness = Math.max(40, p.fitness - 8);
        p.morale = Math.min(100, p.morale + 4);
        let line = `• ${p.firstName} ${p.lastName} (${COUNTRY_BY_CODE[p.nationality]?.name}): ${apps} ${apps === 1 ? "Einsatz" : "Einsätze"}${goals ? `, ${goals} ${goals === 1 ? "Tor" : "Tore"}` : ""}`;
        if (rng.chance(0.04)) {
          injure(rng, p, rng.chance(0.6) ? 1 : 2, career.season, career.day);
          line += ` – kehrt verletzt zurück: ${p.injury?.name} (${p.injuryWeeks} ${p.injuryWeeks === 1 ? "Woche" : "Wochen"})`;
        }
        notes.push(line);
      }
      await addInbox(db, career.id, career.season, career.week, "international", "Rückkehr von den Nationalmannschaften",
        `${notes.join("\n")}\n\nErgebnisse:\n${[...games.values()].flat().map((l) => `• ${l}`).join("\n")}\n\nDie Rückkehrer sind müde und brauchen etwas Erholung.`);
      out.push("Rückkehr der Nationalspieler");
    }
  }
  return out;
}
