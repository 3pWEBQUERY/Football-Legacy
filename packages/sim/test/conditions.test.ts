import { describe, expect, it } from "vitest";
import {
  conditionsFor, defaultTactic, generateSquad, monthTemperature, playMatch, refereeFor, weatherFor, type MatchConditions, type Player,
} from "../src/index";

let id = 1;
const squads = new Map<number, Player[]>();
function team(clubId: number) {
  if (!squads.has(clubId)) squads.set(clubId, generateSquad(11, { id: clubId, countryCode: "GER", rating: 66, reputation: 66 }, 2026, () => id++));
  const players = squads.get(clubId)!;
  return { clubId, name: `Team ${clubId}`, shortName: `T${clubId}`, colors: { primary: "#f00", secondary: "#fff" }, tactic: defaultTactic(players), players };
}
const ref = (strictness: number): MatchConditions => ({ weather: "cloudy", temperature: 12, referee: { name: "Test", strictness } });
function totals(n: number, conditions: (i: number) => MatchConditions | undefined) {
  let cards = 0, offsides = 0, goals = 0;
  for (let i = 0; i < n; i++) {
    const r = playMatch({ seed: 900 + i, home: team(1), away: team(2), conditions: conditions(i) });
    cards += r.stats[0].yellow + r.stats[1].yellow;
    offsides += (r.stats[0].offsides ?? 0) + (r.stats[1].offsides ?? 0);
    goals += r.homeGoals + r.awayGoals;
  }
  return { cards: cards / n, offsides: offsides / n, goals: goals / n };
}

describe("Spielbedingungen", () => {
  it("Klima: Sommer wärmer als Winter, Südhalbkugel umgekehrt", () => {
    expect(monthTemperature("GER", 7)).toBeGreaterThan(monthTemperature("GER", 1) + 10);
    expect(monthTemperature("ARG", 1)).toBeGreaterThan(monthTemperature("ARG", 7));
  });

  it("Wetter und Schiedsrichter sind deterministisch, Schnee nur bei Kälte", () => {
    expect(conditionsFor(1, "f-1", "GER", 12)).toEqual(conditionsFor(1, "f-1", "GER", 12));
    for (let i = 0; i < 200; i++) {
      const w = weatherFor(5, i, "ESP", 7);
      expect(w.kind).not.toBe("snow");
    }
    const kinds = new Set(Array.from({ length: 300 }, (_, i) => weatherFor(5, i, "NOR", 1).kind));
    expect(kinds.has("snow")).toBe(true);
    const r = refereeFor(3, 1, "GER");
    expect(r.strictness).toBeGreaterThanOrEqual(0.7);
    expect(r.strictness).toBeLessThanOrEqual(1.35);
  });

  it("Abseits kommt vor, strenge Schiedsrichter zeigen mehr Karten", { timeout: 60_000 }, () => {
    const strict = totals(60, () => ref(1.35));
    const mild = totals(60, () => ref(0.7));
    expect(strict.cards).toBeGreaterThan(mild.cards * 1.3);
    expect(strict.offsides).toBeGreaterThan(1);
    expect(strict.offsides).toBeLessThan(7);
  });

  it("Ergebnis enthält die Bedingungen, Hitze kostet mehr Kondition", () => {
    const heat: MatchConditions = { weather: "heat", temperature: 34, referee: { name: "Test", strictness: 1 } };
    const a = playMatch({ seed: 77, home: team(1), away: team(2), conditions: heat });
    const b = playMatch({ seed: 77, home: team(1), away: team(2) });
    expect(a.conditions?.weather).toBe("heat");
    const avg = (r: typeof a) => r.players.reduce((s, p) => s + p.staminaEnd, 0) / r.players.length;
    expect(avg(a)).toBeLessThan(avg(b));
  });
});
