import { describe, expect, it } from "vitest";
import { aiMentalityTarget, defaultTactic, generateSquad, playMatch, type Player } from "../src/index";

let id = 1;
const squads = new Map<number, Player[]>();
function team(clubId: number, rating: number) {
  if (!squads.has(clubId)) squads.set(clubId, generateSquad(21, { id: clubId, countryCode: "GER", rating, reputation: rating }, 2026, () => id++));
  const players = squads.get(clubId)!;
  return { clubId, name: `Team ${clubId}`, shortName: `T${clubId}`, colors: { primary: "#f00", secondary: "#fff" }, tactic: defaultTactic(players), players, aiCoach: true };
}

describe("KI-Trainer im Spiel", () => {
  it("Mentalität nach Spielstand: Rückstand → offensiver, knappe Führung spät → defensiver", () => {
    expect(aiMentalityTarget(0, 0, 70)).toBe(0);
    expect(aiMentalityTarget(0, -1, 55)).toBe(0);
    expect(aiMentalityTarget(0, -1, 65)).toBe(1);
    expect(aiMentalityTarget(0, -2, 82)).toBe(2);
    expect(aiMentalityTarget(0, 1, 78)).toBe(-1);
    expect(aiMentalityTarget(0, 1, 87)).toBe(-2);
    expect(aiMentalityTarget(-2, 1, 87)).toBe(-3);
    expect(aiMentalityTarget(0, 2, 87)).toBe(0);
  });

  it("Umstellungen erscheinen im Ticker, Torzahl bleibt realistisch", { timeout: 60_000 }, () => {
    let goals = 0, switches = 0;
    const n = 60;
    for (let i = 0; i < n; i++) {
      const r = playMatch({ seed: 500 + i, home: team(1, 68), away: team(2, 70) });
      goals += r.homeGoals + r.awayGoals;
      switches += r.events.filter((e) => e.type === "tactic").length;
    }
    expect(switches).toBeGreaterThan(n / 2);
    expect(goals / n).toBeGreaterThan(2.3);
    expect(goals / n).toBeLessThan(3.3);
  });
});
