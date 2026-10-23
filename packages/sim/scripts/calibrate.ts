/** Statistik-Validierung der Matchengine: viele Partien, Durchschnittswerte ausgeben. */
import { defaultTactic, generateSquad, playMatch, type Player } from "../src/index";

let id = 1;
const nextId = () => id++;
function team(clubId: number, rating: number) {
  const players: Player[] = generateSquad(7, { id: clubId, countryCode: "GER", rating, reputation: rating }, 2026, nextId);
  return { clubId, name: `Team ${clubId}`, shortName: `T${clubId}`, colors: { primary: "#f00", secondary: "#fff" }, tactic: defaultTactic(players), players };
}

function run(label: string, ra: number, rb: number, n: number) {
  let goals = 0, hw = 0, d = 0, aw = 0, shots = 0, onT = 0, xg = 0, cards = 0, reds = 0, pens = 0, corners = 0, poss = 0, passAcc = 0, inj = 0;
  for (let i = 0; i < n; i++) {
    const h = team(1000 + (i % 20), ra);
    const a = team(2000 + (i % 20), rb);
    const r = playMatch({ seed: 12345 + i, home: h, away: a });
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
  const f = (v: number) => (v / n).toFixed(2);
  console.log(`${label}: Tore ${f(goals)} | H ${(hw / n * 100).toFixed(0)}% U ${(d / n * 100).toFixed(0)}% A ${(aw / n * 100).toFixed(0)}% | Schüsse ${f(shots)} aufs Tor ${f(onT)} xG ${f(xg)} | Gelb ${f(cards)} Rot ${f(reds)} Elfer ${f(pens)} Ecken ${f(corners)} | Ballbesitz H ${(poss / n * 100).toFixed(0)}% Passquote ${(passAcc / n * 100).toFixed(0)}% Verl. ${f(inj)}`);
}

const n = Number(process.argv[2] ?? 400);
const t0 = Date.now();
run("gleich stark 65/65", 65, 65, n);
run("Favorit Heim 72/62", 72, 62, n);
run("Favorit Gast 62/72", 62, 72, n);
run("Krasser Favorit 80/55", 80, 55, n);
run("Niedriges Niveau 45/45", 45, 45, n);
console.log(`${((Date.now() - t0) / (n * 5)).toFixed(1)} ms pro Spiel`);
