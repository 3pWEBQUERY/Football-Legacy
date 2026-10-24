import { buildCalendar, dateOf, dayType, internationalWindows, marketWindow, seasonStart } from "../src/calendar";
import { allocateSlots, drawGroups, groupMatchdays } from "../src/continental";
import { describe, expect, it } from "vitest";
import {
  COUNTRIES, Rng, computeStandings, createSchedule, evaluateFee, generatePlayer, generateSquad, generateWorld,
  quickResult, roundsFor, transferWindow, dailyMissions, levelFromXp, xpForLevel, flagEmoji,
} from "../src/index";

describe("Weltgenerator", () => {
  it("erzeugt alle Länder mit fiktiven Ligen und Vereinen", () => {
    const w = generateWorld(1, 2026);
    expect(new Set(w.leagues.map((l) => l.countryCode)).size).toBe(COUNTRIES.length);
    const total = COUNTRIES.reduce((s, c) => s + c.tiers.reduce((a, b) => a + b, 0), 0);
    expect(w.clubs.length).toBe(total);
    // Namen pro Land eindeutig
    for (const c of ["GER", "ENG", "BRA"]) {
      const names = w.clubs.filter((x) => x.countryCode === c).map((x) => x.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("ist reproduzierbar", () => {
    expect(generateWorld(9, 2026).clubs.slice(0, 50)).toEqual(generateWorld(9, 2026).clubs.slice(0, 50));
  });

  it("stärkere Länder haben stärkere Ligen", () => {
    const w = generateWorld(1, 2026);
    const avg = (key: string) => {
      const cs = w.clubs.filter((c) => c.leagueKey === key);
      return cs.reduce((s, c) => s + c.rating, 0) / cs.length;
    };
    expect(avg("ENG-1")).toBeGreaterThan(avg("SUI-1"));
    expect(avg("SUI-1")).toBeGreaterThan(avg("SMR-1"));
    expect(avg("GER-1")).toBeGreaterThan(avg("GER-2"));
  });

  it("Kader haben 25 Spieler und eine passende Stärke", () => {
    let id = 1;
    const squad = generateSquad(1, { id: 5, countryCode: "ESP", rating: 70, reputation: 70 }, 2026, () => id++);
    expect(squad.length).toBe(25);
    expect(squad.filter((p) => p.position === "GK").length).toBe(3);
    const avg = squad.reduce((s, p) => s + p.rating, 0) / squad.length;
    expect(avg).toBeGreaterThan(62);
    expect(avg).toBeLessThan(74);
  });

  it("Spieler-Stärke liegt nahe am Ziel", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 50; i++) {
      const p = generatePlayer(rng, { id: i, clubId: 1, nationality: "FRA", position: "MC", targetRating: 70, season: 2026, age: 26 });
      expect(Math.abs(p.rating - 70)).toBeLessThanOrEqual(4);
    }
  });

  it("Flaggen für Sonderfälle", () => {
    expect(flagEmoji("GER")).toBe("🇩🇪");
    expect(flagEmoji("ENG").length).toBeGreaterThan(4);
  });
});

describe("Saison", () => {
  it("Doppelrunde: jeder spielt zweimal gegen jeden, einmal zu Hause", () => {
    const ids = Array.from({ length: 18 }, (_, i) => i + 1);
    const s = createSchedule(ids, 34, new Rng(1));
    expect(s.length).toBe(18 * 17);
    expect(roundsFor(18)).toBe(34);
    for (const a of ids) {
      const home = s.filter((m) => m.homeId === a).length;
      expect(home).toBe(17);
      for (const b of ids) if (a !== b) expect(s.filter((m) => m.homeId === a && m.awayId === b).length).toBe(1);
    }
    // pro Woche spielt jeder höchstens einmal
    for (let w = 1; w <= 34; w++) {
      const wk = s.filter((m) => m.week === w);
      const seen = new Set<number>();
      for (const m of wk) {
        expect(seen.has(m.homeId) || seen.has(m.awayId)).toBe(false);
        seen.add(m.homeId).add(m.awayId);
      }
    }
  });

  it("grosse Ligen spielen auch unter der Woche", () => {
    const ids = Array.from({ length: 24 }, (_, i) => i + 1);
    const s = createSchedule(ids, 34, new Rng(1));
    expect(Math.max(...s.map((m) => m.week))).toBe(34);
    expect(new Set(s.map((m) => m.round)).size).toBe(46);
  });

  it("Tabelle sortiert nach Punkten und Tordifferenz", () => {
    const t = computeStandings([1, 2, 3], [
      { homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 0 },
      { homeId: 2, awayId: 3, homeGoals: 1, awayGoals: 1 },
      { homeId: 3, awayId: 1, homeGoals: 3, awayGoals: 0 },
    ]);
    expect(t.map((r) => r.clubId)).toEqual([3, 1, 2]);
    expect(t[0].points).toBe(4);
  });

  it("vereinfachte Simulation liegt im realistischen Torbereich", () => {
    const rng = new Rng(11);
    let goals = 0, home = 0, away = 0;
    for (let i = 0; i < 5000; i++) {
      const [h, a] = quickResult(rng, 60, 60);
      goals += h + a;
      if (h > a) home++;
      if (a > h) away++;
    }
    expect(goals / 5000).toBeGreaterThan(2.4);
    expect(goals / 5000).toBeLessThan(3.0);
    expect(home).toBeGreaterThan(away);
  });

  it("Transferfenster", () => {
    expect(transferWindow(0, 34).open).toBe(true);
    expect(transferWindow(10, 34).open).toBe(false);
    expect(transferWindow(17, 34).open).toBe(true);
  });
});

describe("Transfers & Gamification", () => {
  it("Ausstiegsklausel wird immer akzeptiert", () => {
    const p = generatePlayer(new Rng(1), { id: 1, clubId: 1, nationality: "GER", position: "ST", targetRating: 75, season: 2026 });
    p.contract!.releaseClause = 5_000_000;
    const v = evaluateFee(p, 5_000_000, { season: 2026, squadRank: 1, squadSize: 25, sellerReputation: 80, isUserClub: false }, new Rng(1));
    expect(v.kind).toBe("accept");
  });

  it("Level wachsen mit XP", () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(xpForLevel(5))).toBe(5);
    expect(levelFromXp(xpForLevel(5) - 1)).toBe(4);
  });

  it("Tagesmissionen sind pro Tag stabil", () => {
    expect(dailyMissions(1, "2026-10-23")).toEqual(dailyMissions(1, "2026-10-23"));
    expect(dailyMissions(1, "2026-10-23").length).toBe(3);
  });
});

import { cupRoundName, cupWeekPositions, drawCupRound, penaltyShootout, planCup } from "../src/index";

describe("Pokal", () => {
  it("Vorrunde füllt auf eine Zweierpotenz auf", () => {
    const entrants = Array.from({ length: 56 }, (_, i) => ({ id: i + 1, tier: i < 18 ? 1 : i < 36 ? 2 : 3, rating: 80 - i / 2 }));
    const plan = planCup(entrants);
    expect(plan.prelim.length).toBe(48);
    expect(plan.byes.length).toBe(8);
    expect(plan.prelim.length / 2 + plan.byes.length).toBe(32);
    expect(plan.rounds).toBe(6);
    // Erstligisten haben Freilos
    expect(plan.byes.every((id) => id <= 18)).toBe(true);
    expect(cupRoundName(6, 6)).toBe("Finale");
    expect(cupRoundName(3, 6)).toBe("Achtelfinale");
  });

  it("Klassentieferer Verein hat Heimrecht", () => {
    const pairs = drawCupRound(new Rng(2), [{ id: 1, tier: 1, rating: 80 }, { id: 2, tier: 3, rating: 50 }]);
    expect(pairs[0]).toEqual([2, 1]);
  });

  it("Pokalwochen sind aufsteigend und innerhalb der Saison", () => {
    const w = cupWeekPositions(6, 34);
    expect(w.length).toBe(6);
    expect([...w].sort((a, b) => a - b)).toEqual(w);
    expect(w[w.length - 1]).toBeLessThanOrEqual(34);
  });

  it("Elfmeterschiessen hat immer einen Sieger", () => {
    const rng = new Rng(5);
    const s = Array.from({ length: 11 }, () => ({ penalties: 12, composure: 12 }));
    for (let i = 0; i < 200; i++) {
      const [h, a] = penaltyShootout(rng, s, s, 12, 12);
      expect(h).not.toBe(a);
      expect(Math.max(h, a)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("Saisonkalender", () => {
  it("legt Ligaspiele auf Samstage, Pokalrunden auf Mittwoche und macht eine Winterpause", () => {
    const kinds = Array.from({ length: 34 }, () => "league" as const) as ("league" | "cup")[];
    kinds.splice(3, 0, "cup");
    kinds.splice(10, 0, "cup");
    const cal = buildCalendar(kinds);
    expect(seasonStart(2026).toISOString().slice(0, 10)).toBe("2026-07-06");
    expect(dateOf(2026, cal.slots[0].day).getUTCDay()).toBe(6);
    const cups = cal.slots.filter((s) => s.kind === "cup");
    for (const c of cups) expect(dateOf(2026, c.day).getUTCDay()).toBe(3);
    for (let i = 1; i < cal.slots.length; i++) expect(cal.slots[i].day).toBeGreaterThan(cal.slots[i - 1].day);
    expect(cal.winterBreak).not.toBeNull();
    const last = dateOf(2026, cal.slots[cal.slots.length - 1].day);
    expect(last.getUTCFullYear()).toBe(2027);
    expect(dayType(cal, cal.slots[0].day - 1, new Set([cal.slots[0].day]))).toBe("prep");
    expect(dayType(cal, 9, new Set())).toBe("friendly");
  });
});

describe("Transferfenster und Kontinentalpokal", () => {
  it("öffnet das Fenster im Sommer bis Ende August und in der Winterpause", () => {
    const cal = buildCalendar(Array.from({ length: 34 }, () => "league" as const));
    expect(marketWindow(cal, 0).open).toBe(true);
    expect(dateOf(2026, marketWindow(cal, 0).closes!).toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(marketWindow(cal, 70).open).toBe(false);
    expect(marketWindow(cal, cal.winterBreak![0] + 10).open).toBe(true);
  });

  it("verteilt 32 Startplätze und lost Gruppen ohne Duelle aus demselben Land", () => {
    const countries = COUNTRIES.filter((c) => c.confed === "UEFA").map((c) => ({ code: c.code, strength: c.strength, leagueSize: c.tiers[0] }));
    const slots = allocateSlots(countries, 32);
    expect([...slots.values()].reduce((a, b) => a + b, 0)).toBe(32);
    expect(slots.get("ENG")).toBe(4);
    const teams = [...slots.entries()].flatMap(([code, n]) => Array.from({ length: n }, (_, i) => ({ id: teams0++, rating: 80 - i * 3, country: code })));
    const groups = drawGroups(new Rng(7), teams);
    expect(groups.length).toBe(8);
    for (const g of groups) {
      const countriesInGroup = g.map((id) => teams.find((t) => t.id === id)!.country);
      expect(new Set(countriesInGroup).size).toBe(4);
    }
    const md = groupMatchdays([1, 2, 3, 4]);
    const games = md.flat();
    expect(games.length).toBe(12);
    expect(new Set(games.map((g) => g.join("-"))).size).toBe(12);
  });
});
let teams0 = 1;

describe("Länderspielfenster", () => {
  it("liegt im Sep/Okt/Nov/Mär auf Montag bis Donnerstag ohne Spielrunde", () => {
    const kinds = Array.from({ length: 34 }, () => "league" as const) as ("league" | "cup" | "intl")[];
    kinds.splice(4, 0, "cup");
    const cal = buildCalendar(kinds);
    const ws = internationalWindows(cal, 2026);
    expect(ws.length).toBe(4);
    const busy = new Set(cal.slots.map((s) => s.day));
    for (const [a, b] of ws) {
      expect(dateOf(2026, a).getUTCDay()).toBe(1);
      for (let d = a; d <= b; d++) expect(busy.has(d)).toBe(false);
    }
    expect(ws.map(([a]) => dateOf(2026, a).getUTCMonth())).toEqual([8, 9, 10, 2]);
  });
});
