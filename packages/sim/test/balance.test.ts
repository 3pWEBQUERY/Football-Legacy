/**
 * Balancing-Grenzen: Die Matchengine soll realistische Durchschnittswerte
 * liefern, Finanzprofile sollen einen normal geführten Verein knapp im Plus
 * halten. Schlägt ein Test fehl, hat sich das Gleichgewicht verschoben.
 */
import { describe, expect, it } from "vitest";
import { attendance, defaultTactic, financeProfile, generateSquad, playMatch, retirementChance, tierMoney, wageBill, weeklyFinances, type Player } from "../src/index";

let nextPid = 1;
function team(clubId: number, rating: number) {
  const players: Player[] = generateSquad(7, { id: clubId, countryCode: "GER", rating, reputation: rating }, 2026, () => nextPid++);
  return { clubId, name: `Team ${clubId}`, shortName: `T${clubId}`, colors: { primary: "#f00", secondary: "#fff" }, tactic: defaultTactic(players), players };
}

function series(ra: number, rb: number, n: number) {
  let goals = 0, home = 0, draws = 0;
  for (let i = 0; i < n; i++) {
    const r = playMatch({ seed: 900 + i, home: team(100 + (i % 10), ra), away: team(200 + (i % 10), rb) });
    goals += r.homeGoals + r.awayGoals;
    if (r.homeGoals > r.awayGoals) home++;
    else if (r.homeGoals === r.awayGoals) draws++;
  }
  return { goals: goals / n, home: home / n, draws: draws / n };
}

describe("Balancing", () => {
  it("Gleich starke Teams: Tore, Heimvorteil und Unentschieden wie im echten Fussball", () => {
    const s = series(65, 65, 160);
    expect(s.goals).toBeGreaterThan(2.3);
    expect(s.goals).toBeLessThan(3.2);
    expect(s.home).toBeGreaterThan(0.36);
    expect(s.home).toBeLessThan(0.54);
    expect(s.draws).toBeGreaterThan(0.16);
    expect(s.draws).toBeLessThan(0.34);
  }, 60_000);

  it("Der Favorit gewinnt meistens, aber nicht immer", () => {
    const s = series(72, 62, 120);
    expect(s.home).toBeGreaterThan(0.55);
    expect(s.home).toBeLessThan(0.85);
  }, 60_000);

  it("Finanzprofil: eine echte Saison deckt alle Kosten mit kleinem Überschuss – bei kleinen wie grossen Vereinen", () => {
    // Laufende Posten über 42 Wochen, 18 Heimspiele mit der Zuschauerformel des Spiels
    const clubs = [
      { rating: 52, reputation: 22, capacity: 9_000, tier: 3 },
      { rating: 60, reputation: 40, capacity: 18_000, tier: 2 },
      { rating: 66, reputation: 60, capacity: 30_000, tier: 1 },
      { rating: 76, reputation: 88, capacity: 70_000, tier: 1 },
    ];
    for (const c of clubs) {
      const squad = generateSquad(11, { id: c.rating, countryCode: "GER", rating: c.rating, reputation: c.reputation }, 2026, () => nextPid++);
      const wages = wageBill(squad);
      for (const margin of [1.0, 1.06, 1.14]) {
        const profile = financeProfile({ countryCode: "GER", reputation: c.reputation, capacity: c.capacity }, wages, c.tier, margin);
        const fans = attendance(c.capacity, c.reputation, 7, c.reputation);
        let sum = 0;
        for (let w = 0; w < 42; w++) sum += weeklyFinances(profile, wages, w % 7 < 3 ? { attendance: fans } : null).reduce((s, e) => s + e.amount, 0);
        const perWeek = sum / 42 / wages;
        expect(perWeek, `Ruf ${c.reputation}, Marge ${margin}`).toBeGreaterThan(margin - 1 - 0.03);
        expect(perWeek, `Ruf ${c.reputation}, Marge ${margin}`).toBeLessThan(margin - 1 + 0.03);
      }
    }
    expect(tierMoney(1)).toBeGreaterThan(tierMoney(2));
    expect(tierMoney(9)).toBeGreaterThan(0);
  });

  it("Karriereende: unter 33 nie, mit 36 sehr wahrscheinlich", () => {
    const p = generateSquad(3, { id: 2, countryCode: "GER", rating: 60, reputation: 50 }, 2026, () => nextPid++)[0];
    expect(retirementChance({ ...p, age: 31 })).toBe(0);
    expect(retirementChance({ ...p, age: 36, rating: 60 })).toBeGreaterThan(0.6);
  });
});
