/** Charakterzüge: Verteilung, Wirkung auf Moral, Gehalt, Entwicklung und grosse Spiele. */
import { describe, expect, it } from "vitest";
import {
  TRAITS, defaultTactic, generateSquad, growthFactor, moraleChange, playMatch, renewalDemand, traitsOf, type Player, type Trait,
} from "../src/index";

let nextPid = 70_000;
const squad = (n: number, clubId = 1, rating = 70) => generateSquad(n, { id: clubId, countryCode: "GER", rating, reputation: rating }, 2026, () => nextPid++);

describe("Charakterzüge", () => {
  it("sind deterministisch, höchstens zwei, ohne Widersprüche und sinnvoll verteilt", () => {
    const players = Array.from({ length: 80 }, (_, i) => squad(25, i + 1)).flat();
    const count = new Map<Trait, number>();
    for (const p of players) {
      const t = traitsOf(p);
      expect(t.length).toBeLessThanOrEqual(2);
      expect(traitsOf({ ...p, traits: undefined })).toEqual(t);
      expect(!(t.includes("bigGame") && t.includes("nervous"))).toBe(true);
      expect(!(t.includes("loyal") && t.includes("mercenary"))).toBe(true);
      for (const x of t) count.set(x, (count.get(x) ?? 0) + 1);
    }
    for (const key of Object.keys(TRAITS) as Trait[]) {
      const share = (count.get(key) ?? 0) / players.length;
      expect(share, key).toBeGreaterThan(0.01);
      expect(share, key).toBeLessThan(0.25);
    }
    const none = players.filter((p) => traitsOf(p).length === 0).length / players.length;
    expect(none).toBeGreaterThan(0.25);
  });

  it("wirken auf Moral, Entwicklung und Gehaltsforderung", () => {
    const p = squad(1)[0];
    const moody: Player = { ...p, morale: 50, traits: ["moody"] };
    const pro: Player = { ...p, morale: 50, traits: ["professional"] };
    moraleChange(moody, -10);
    moraleChange(pro, -10);
    expect(moody.morale).toBe(35);
    expect(pro.morale).toBe(42);
    expect(growthFactor({ ...p, traits: ["ambitious", "professional"] })).toBeGreaterThan(1.2);
    const contract = { wage: 1000, untilSeason: 2027, releaseClause: null, goalBonus: 0 };
    const greedy = renewalDemand({ ...p, contract, traits: ["mercenary"] }, 60, 5).wage;
    const loyal = renewalDemand({ ...p, contract, traits: ["loyal"] }, 60, 5).wage;
    expect(greedy).toBeGreaterThan(loyal * 1.2);
  });

  it("Wettkampftypen sind in grossen Spielen stärker als Nervöse", () => {
    const team = (clubId: number, trait: Trait) => {
      const players = squad(16, clubId, 70).map((p) => ({ ...p, traits: [trait] }));
      return { clubId, name: `T${clubId}`, shortName: `T${clubId}`, colors: { primary: "#f00", secondary: "#fff" }, tactic: defaultTactic(players), players };
    };
    const a = team(901, "bigGame");
    const b = team(902, "nervous");
    let big = 0;
    let normal = 0;
    for (let seed = 1; seed <= 80; seed++) {
      // Seiten tauschen, damit der Heimvorteil sich aufhebt
      const home = seed % 2 ? a : b;
      const away = seed % 2 ? b : a;
      const diff = (r: { homeGoals: number; awayGoals: number }) => (home === a ? r.homeGoals - r.awayGoals : r.awayGoals - r.homeGoals);
      big += diff(playMatch({ seed, home, away, big: true }));
      normal += diff(playMatch({ seed, home, away }));
    }
    expect(big).toBeGreaterThan(normal);
  });
});
