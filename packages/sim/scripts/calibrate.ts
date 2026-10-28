/** Statistik-Validierung der Matchengine: viele Partien, Durchschnittswerte ausgeben. */
import { defaultTactic, generateSquad, playMatch, refereeFor, type MatchConditions, type Player, type WeatherKind } from "../src/index";

let id = 1;
const nextId = () => id++;
function team(clubId: number, rating: number) {
  const players: Player[] = generateSquad(7, { id: clubId, countryCode: "GER", rating, reputation: rating }, 2026, nextId);
  return { clubId, name: `Team ${clubId}`, shortName: `T${clubId}`, colors: { primary: "#f00", secondary: "#fff" }, tactic: defaultTactic(players), players };
}

let runs = 0;
function run(label: string, ra: number, rb: number, n: number, weather?: WeatherKind, strictness?: number) {
  let goals = 0, hw = 0, d = 0, aw = 0, shots = 0, onT = 0, xg = 0, cards = 0, reds = 0, pens = 0, corners = 0, poss = 0, passAcc = 0, inj = 0, offs = 0;
  for (let i = 0; i < n; i++) {
    const h = team(1000 + (i % 20), ra);
    const a = team(2000 + (i % 20), rb);
    const conditions: MatchConditions | undefined = weather || strictness
      ? { weather: weather ?? "cloudy", temperature: weather === "heat" ? 33 : 12, referee: { ...refereeFor(1, i, "GER"), strictness: strictness ?? 1 } } : undefined;
    const r = playMatch({ seed: 12345 + i, home: h, away: a, conditions });
    offs += (r.stats[0].offsides ?? 0) + (r.stats[1].offsides ?? 0);
    goals += r.homeGoals + r.awayGoals;
    if (r.homeGoals > r.awayGoals) hw++; else if (r.homeGoals === r.awayGoals) d++; else aw++;
    shots += r.stats[0].shots + r.stats[1].shots;
    onT += r.stats[0].onTarget + r.stats[1].onTarget;
    xg += r.stats[0].xg + r.stats[1].xg;
    cards += r.stats[0].yellow + r.stats[1].yellow;
    reds += r.stats[0].red + r.stats[1].red;
    corners += r.stats[0].corners + r.stats[1].corners;
    poss += r.stats[0].possession / (r.stats[0].possession + r.stats[1].possession);
    passAcc += (r.stats[0].passesOk + r.stats[1].passesOk) / (r.stats[0].passes + r.stats[1].passes);
    pens += r.events.filter((e) => e.type === "penalty_goal" || e.type === "penalty_miss").length;
    inj += r.events.filter((e) => e.type === "injury").length;
  }
  runs++;
  const f = (v: number) => (v / n).toFixed(2);
  console.log(`${label}: Tore ${f(goals)} | H ${(hw / n * 100).toFixed(0)}% U ${(d / n * 100).toFixed(0)}% A ${(aw / n * 100).toFixed(0)}% | Schüsse ${f(shots)} aufs Tor ${f(onT)} xG ${f(xg)} | Gelb ${f(cards)} Rot ${f(reds)} Elfer ${f(pens)} Ecken ${f(corners)} Abseits ${f(offs)} | Ballbesitz H ${(poss / n * 100).toFixed(0)}% Passquote ${(passAcc / n * 100).toFixed(0)}% Verl. ${f(inj)}`);
}

const n = Number(process.argv[2] ?? 400);
const t0 = Date.now();
run("gleich stark 65/65", 65, 65, n);
run("Favorit Heim 72/62", 72, 62, n);
run("Favorit Gast 62/72", 62, 72, n);
run("Krasser Favorit 80/55", 80, 55, n);
run("Niedriges Niveau 45/45", 45, 45, n);
if (process.argv.includes("--conditions")) {
  run("Regen 65/65", 65, 65, n, "rain");
  run("Starkregen 65/65", 65, 65, n, "heavyRain");
  run("Schnee 65/65", 65, 65, n, "snow");
  run("Hitze 65/65", 65, 65, n, "heat");
  run("Strenger Schiri 65/65", 65, 65, n, undefined, 1.3);
  run("Grosszügiger Schiri 65/65", 65, 65, n, undefined, 0.75);
}
if (process.argv.includes("--styles")) styles(n);
console.log(`${((Date.now() - t0) / (n * runs)).toFixed(1)} ms pro Spiel`);

/** Karten und Verletzungen je Team bei verschiedenen Spielstilen und Fitness (Team A gegen Standard). */
function styles(n: number) {
  const variants: [string, Record<string, number>, number][] = [
    ["Standard", {}, 100],
    ["Gegenpressing (Pressing 85, Härte 60)", { pressing: 85, tempo: 75, hardness: 60 }, 100],
    ["Pressing 100, Härte 100", { pressing: 100, tempo: 90, hardness: 100 }, 100],
    ["Fair (Härte 0)", { hardness: 0 }, 100],
    ["Müde (Fitness 70)", {}, 70],
    ["Müde und hart (Fitness 70, Härte 90)", { hardness: 90, pressing: 80 }, 70],
  ];
  for (const [label, style, fitness] of variants) {
    let y = 0, r = 0, inj = 0, injOpp = 0, fouls = 0;
    for (let i = 0; i < n; i++) {
      const h = team(3000 + (i % 20), 65);
      const a = team(4000 + (i % 20), 65);
      h.tactic = { ...h.tactic, style: { ...h.tactic.style, ...style } };
      for (const p of h.players) p.fitness = fitness;
      const res = playMatch({ seed: 777 + i, home: h, away: a });
      y += res.stats[0].yellow; r += res.stats[0].red; fouls += res.stats[0].fouls;
      inj += res.events.filter((e) => e.type === "injury" && e.side === "home").length;
      injOpp += res.events.filter((e) => e.type === "injury" && e.side === "away").length;
    }
    runs++;
    const f = (v: number) => (v / n).toFixed(2);
    console.log(`${label.padEnd(40)} je Team: Fouls ${f(fouls)} Gelb ${f(y)} Rot ${f(r)} Verletzte ${f(inj)} (Gegner ${f(injOpp)})`);
  }
}
