/** Kapitän und Gegneranweisungen in der Matchengine. */
import { describe, expect, it } from "vitest";
import { createMatch, defaultTactic, generateSquad, leadership, playMatch, type Player } from "../src/index";

let nextPid = 50_000;
const team = (clubId: number, rating: number, tactic?: (players: Player[]) => Partial<ReturnType<typeof defaultTactic>>) => {
  const players: Player[] = generateSquad(11, { id: clubId, countryCode: "GER", rating, reputation: rating }, 2026, () => nextPid++);
  const base = defaultTactic(players);
  return { clubId, name: `T${clubId}`, shortName: `T${clubId}`, colors: { primary: "#f00", secondary: "#fff" }, tactic: { ...base, ...(tactic?.(players) ?? {}) }, players };
};

describe("Kapitän und Gegneranweisungen", () => {
  it("Führungsqualität steigt mit Erfahrung und Persönlichkeit", () => {
    const p = generateSquad(3, { id: 1, countryCode: "GER", rating: 70, reputation: 60 }, 2026, () => nextPid++)[0];
    expect(leadership({ ...p, age: 30 })).toBeGreaterThan(leadership({ ...p, age: 19 }));
    const calm = { ...p, attrs: { ...p.attrs, composure: 19, decisions: 19, workRate: 19 } };
    expect(leadership(calm)).toBeGreaterThan(leadership({ ...p, attrs: { ...p.attrs, composure: 5, decisions: 5, workRate: 5 } }));
  });

  it("Ohne Wahl trägt der beste Anführer der Startelf die Binde, eine Wahl wird übernommen", () => {
    const home = team(1, 70);
    const away = team(2, 70);
    const auto = createMatch({ seed: 1, home, away });
    expect(auto.teams[0].lead?.cap).not.toBeNull();
    expect(auto.teams[0].lead!.capBoost).toBeGreaterThan(0.004);
    const pick = home.tactic.lineup[5]!;
    const chosen = createMatch({ seed: 1, home: { ...home, tactic: { ...home.tactic, captain: pick } }, away });
    expect(chosen.teams[0].players[chosen.teams[0].lead!.cap!].id).toBe(pick);
  });

  it("Gegneranweisungen gelten nur gegen den genannten Gegner und schwächen den Spieler", () => {
    let base = 0;
    let marked = 0;
    for (let i = 0; i < 60; i++) {
      const away = team(200 + i, 68);
      const star = [...away.players].filter((p) => p.position === "ST").sort((a, b) => b.rating - a.rating)[0] ?? away.players[10];
      const plain = team(100 + i, 68);
      const tight = { ...plain, tactic: { ...plain.tactic, opposition: { clubId: away.clubId, items: [{ playerId: star.id, kind: "tight" as const }] } } };
      const m = createMatch({ seed: 7 + i, home: tight, away });
      expect(m.teams[0].marks?.[star.id]).toBe("tight");
      const other = createMatch({ seed: 7 + i, home: { ...tight, tactic: { ...tight.tactic, opposition: { clubId: 999, items: tight.tactic.opposition.items } } }, away });
      expect(other.teams[0].marks).toBeUndefined();
      const line = (r: ReturnType<typeof playMatch>) => r.players.find((x) => x.playerId === star.id);
      base += (line(playMatch({ seed: 7 + i, home: plain, away }))?.rating ?? 6);
      marked += (line(playMatch({ seed: 7 + i, home: tight, away }))?.rating ?? 6);
    }
    expect(marked).toBeLessThan(base);
  }, 60_000);
});
