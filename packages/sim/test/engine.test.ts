import { describe, expect, it } from "vitest";
import {
  TICKS, applyChange, createMatch, defaultTactic, generateSquad, playMatch, result, simulate, type Player,
} from "../src/index";

let id = 1;
const nextId = () => id++;
const squads = new Map<number, Player[]>();
function team(clubId: number, rating: number) {
  const key = clubId * 1000 + rating;
  if (!squads.has(key)) squads.set(key, generateSquad(7, { id: clubId, countryCode: "GER", rating, reputation: rating }, 2026, nextId));
  const players = squads.get(key)!;
  return { clubId, name: `Team ${clubId}`, shortName: `T${clubId}`, colors: { primary: "#f00", secondary: "#fff" }, tactic: defaultTactic(players), players };
}

describe("Matchengine", () => {
  it("ist deterministisch bei gleichem Seed", () => {
    const a = playMatch({ seed: 42, home: team(1, 65), away: team(2, 65) });
    const b = playMatch({ seed: 42, home: team(1, 65), away: team(2, 65) });
    expect(a.homeGoals).toBe(b.homeGoals);
    expect(a.awayGoals).toBe(b.awayGoals);
    expect(a.events).toEqual(b.events);
  });

  it("liefert in zwei Hälften dasselbe wie in einem Durchlauf (Halbzeit speicherbar)", () => {
    const full = createMatch({ seed: 7, home: team(1, 65), away: team(2, 63) });
    simulate(full, TICKS);
    const split = createMatch({ seed: 7, home: team(1, 65), away: team(2, 63) });
    simulate(split, 270);
    const restored = JSON.parse(JSON.stringify(split));
    simulate(restored, TICKS);
    expect(result(restored).homeGoals).toBe(result(full).homeGoals);
    expect(result(restored).awayGoals).toBe(result(full).awayGoals);
  });

  it("erzeugt Positionsdaten für 22 Spieler und den Ball", () => {
    const s = createMatch({ seed: 3, home: team(1, 60), away: team(2, 60) });
    const frames = simulate(s, 60, { frames: true });
    expect(frames.length).toBe(61);
    expect(frames[0].length).toBe(3 + 44);
  });

  it("verarbeitet Wechsel und Taktikänderung in der Halbzeit", () => {
    const s = createMatch({ seed: 5, home: team(1, 65), away: team(2, 65) });
    simulate(s, 270);
    const bench = s.teams[0].players.find((p) => p.slot === -1)!;
    applyChange(s, 0, { formation: "4-3-3", style: { pressing: 80 }, subs: [{ slot: 9, playerId: bench.id }] });
    simulate(s, TICKS);
    expect(s.teams[0].formation).toBe("4-3-3");
    expect(s.events.some((e) => e.type === "sub" && e.playerId === bench.id)).toBe(true);
    expect(s.finished).toBe(true);
  });

  it("bleibt über viele Partien realistisch (Tore, Heimvorteil, Favoriten)", () => {
    const n = 600;
    let goals = 0, home = 0, away = 0, favWins = 0, favLosses = 0;
    for (let i = 0; i < n; i++) {
      const r = playMatch({ seed: 1000 + i, home: team(10 + (i % 6), 65), away: team(20 + (i % 6), 65) });
      goals += r.homeGoals + r.awayGoals;
      if (r.homeGoals > r.awayGoals) home++;
      if (r.homeGoals < r.awayGoals) away++;
      const f = playMatch({ seed: 5000 + i, home: team(30 + (i % 6), 60), away: team(40 + (i % 6), 72) });
      if (f.awayGoals > f.homeGoals) favWins++;
      if (f.awayGoals < f.homeGoals) favLosses++;
    }
    const avg = goals / n;
    expect(avg).toBeGreaterThan(2.3);
    expect(avg).toBeLessThan(3.2);
    expect(home).toBeGreaterThan(away); // Heimvorteil
    expect(favWins / n).toBeGreaterThan(0.5); // Favorit gewinnt meistens …
    expect(favLosses / n).toBeGreaterThan(0.05); // … aber nicht immer
  }, 60_000);
});

describe("Mentalität, Pflichten, Vertrautheit", () => {
  const withTactic = (clubId: number, patch: Partial<ReturnType<typeof team>["tactic"]>, familiarity?: number) => {
    const t = team(clubId, 66);
    return { ...t, tactic: { ...t.tactic, ...patch }, familiarity };
  };

  it("offensive Mentalität bringt mehr Torschüsse als defensive", () => {
    let attack = 0;
    let defend = 0;
    for (let i = 0; i < 30; i++) {
      const a = playMatch({ seed: 9000 + i, home: withTactic(51, { mentality: 3, duties: Array(11).fill("attack") }), away: team(52, 66) });
      const d = playMatch({ seed: 9000 + i, home: withTactic(51, { mentality: -3, duties: Array(11).fill("defend") }), away: team(52, 66) });
      attack += a.stats[0].shots;
      defend += d.stats[0].shots;
    }
    expect(attack).toBeGreaterThan(defend);
  });

  it("hohe Vertrautheit hilft, niedrige schadet", () => {
    let hi = 0;
    let lo = 0;
    // Der Effekt ist klein (einige Prozent): genug Partien, damit der Zufall ihn nicht überdeckt
    for (let i = 0; i < 150; i++) {
      const h = playMatch({ seed: 12000 + i, home: withTactic(53, {}, 100), away: team(54, 66) });
      const l = playMatch({ seed: 12000 + i, home: withTactic(53, {}, 0), away: team(54, 66) });
      hi += h.homeGoals - h.awayGoals;
      lo += l.homeGoals - l.awayGoals;
    }
    expect(hi).toBeGreaterThan(lo);
  });

  it("Spieleranweisungen und Pflichten lassen sich live ändern", () => {
    const state = createMatch({ seed: 77, home: team(55, 66), away: team(56, 66) });
    simulate(state, 100);
    applyChange(state, 0, { mentality: 2, duties: Array(11).fill("attack"), instructions: Array(11).fill(["shoot_more"]) });
    expect(state.teams[0].mentality).toBe(2);
    expect(state.teams[0].style.risk).toBeGreaterThan(state.teams[0].baseStyle!.risk);
    simulate(state, TICKS);
    expect(result(state).players.length).toBeGreaterThanOrEqual(22);
  });
});

describe("Aufstellung prüfen", () => {
  it("ersetzt verletzte und gesperrte Spieler für Spiele, behält sie für die Taktik-Ansicht", async () => {
    const { validateTactic } = await import("../src/index");
    const tm = team(5, 66);
    const players = tm.players.map((p) => ({ ...p }));
    const tactic = tm.tactic;
    const [hurt, banned] = tactic.lineup.slice(0, 2) as number[];
    players.find((p) => p.id === hurt)!.injuryWeeks = 3;
    players.find((p) => p.id === banned)!.suspendedWeeks = 1;
    const strict = validateTactic(tactic, players);
    expect(strict.lineup).not.toContain(hurt);
    expect(strict.lineup).not.toContain(banned);
    expect(strict.lineup.filter((x) => x !== null).length).toBe(11);
    const view = validateTactic(tactic, players, { keepUnavailable: true });
    expect(view.lineup[0]).toBe(hurt);
    expect(view.lineup[1]).toBe(banned);
  });
});

describe("Seitenlinie und Schüsse", () => {
  it("erfasst jeden Torschuss mit xG, Ort und Ergebnis", () => {
    const r = playMatch({ seed: 11, home: team(1, 68), away: team(2, 62) });
    const shots = r.shots!;
    expect(shots.length).toBe(r.stats[0].shots + r.stats[1].shots);
    expect(shots.filter((s) => s.outcome === "goal" && s.side === 0).length).toBe(r.homeGoals - r.events.filter((e) => e.type === "own_goal" && e.side === "home").length);
    for (const s of shots) {
      expect(s.x).toBeGreaterThan(0.4);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.xg).toBeGreaterThan(0);
    }
  });

  it("Zuruf: Wirkung je nach Spielstand, Abklingzeit, Ereignis im Ticker", async () => {
    const { shout, SHOUT_COOLDOWN } = await import("../src/index");
    const s = createMatch({ seed: 5, home: team(1, 65), away: team(2, 65) });
    simulate(s, 120);
    s.teams[0].goals = 0; s.teams[1].goals = 1;
    const a = shout(s, 0, "encourage");
    expect(a.ok).toBe(true);
    expect(a.boost).toBeGreaterThan(0.02);
    expect(shout(s, 0, "praise").ok).toBe(false);
    simulate(s, 120 + SHOUT_COOLDOWN);
    const b = shout(s, 0, "praise");
    expect(b.ok).toBe(true);
    expect(b.boost).toBeLessThan(0);
    expect(s.events.some((e) => e.text.includes("Zuruf"))).toBe(true);
  });

  it("Halbzeitansprache nur in der Pause, einmalig, wirkt auf die zweite Halbzeit", async () => {
    const { halftimeTalk } = await import("../src/index");
    const s = createMatch({ seed: 8, home: team(1, 65), away: team(2, 65) });
    simulate(s, 100);
    expect(halftimeTalk(s, 1, "praise").ok).toBe(false);
    simulate(s, 270);
    s.teams[1].goals = 2; s.teams[0].goals = 0;
    const r = halftimeTalk(s, 1, "praise");
    expect(r.ok).toBe(true);
    expect(s.teams[1].spirit).toBeGreaterThan(0);
    expect(halftimeTalk(s, 1, "calm").ok).toBe(false);
    // Spielstand bleibt speicherbar
    const copy = JSON.parse(JSON.stringify(s));
    simulate(s, TICKS);
    simulate(copy, TICKS);
    expect(result(copy).homeGoals).toBe(result(s).homeGoals);
  });
});
