/** Nationaltrainer: Länderspieltage, Qualifikation, Endrunde und Saisonwechsel. */
import { COUNTRIES, Rng, seedFor, type Player } from "@fl/sim";
import type pg from "pg";
import { query, type Db } from "../db";
import { addArticle } from "../media";
import { addInbox, getPlayersByIds, type CareerRow } from "../repo";
import { SQUAD_SIZE, autoSquad, createQualification, fmtDay, getNational, groupTable, insertMatch, nation, nationPool, playUserMatch, qualMatches, quickNational, reportUserMatch, saveNational, scheduleFriendlies, scoreText, storeResult, tournamentName, windowsOf, winnerOf, type NationalMatch, type NationalState } from "./core";

/* ---------- Tageslauf ---------- */

/** Täglich: Erinnerung, Nominierung, Spiele und Auswertung der Länderspielpausen. */
export async function nationalDay(db: pg.PoolClient, career: CareerRow, clubSquad: Player[]): Promise<string[]> {
  const st = await getNational(db, career.id);
  if (!st) return [];
  const out: string[] = [];
  const windows = windowsOf(career);
  const day = career.day;
  for (const [i, w] of windows.entries()) {
    if (day === w[0] - 5) {
      await addInbox(db, career.id, career.season, career.week, "international", `${nation(st.code).name}: Kader nominieren`,
        `Am ${fmtDay(career.season, w[0])} beginnt die Länderspielpause. Nominiere bis dahin deinen Kader (${SQUAD_SIZE} Spieler) unter Nationalteam → Kader. Sonst stellt der Co-Trainer den Kader zusammen.`,
        { type: "national" });
      out.push("Nominierung");
    }
    if (day === w[0]) {
      // März: Playoff für Gruppenzweite, sonst Testspiele
      if (i === 3 && st.groupPos === 2 && !st.qualified) {
        const pool = COUNTRIES.filter((c) => c.confed === nation(st.code).confed && c.code !== st.code);
        const rng = new Rng(seedFor(career.seed, "nation-playoff", career.season));
        const opp = pool.sort((a, b) => Math.abs(a.strength - nation(st.code).strength) - Math.abs(b.strength - nation(st.code).strength))[rng.int(0, Math.min(5, pool.length - 1))];
        await insertMatch(db, career, { season: career.season, day: w[0] + 1, kind: "playoff", stage: "Playoff-Halbfinale", home: st.code, away: opp.code, user: true });
      } else {
        await scheduleFriendlies(db, career, st, w);
      }
      const pool = await nationPool(db, career, st.code);
      const own = new Map(clubSquad.map((p) => [p.id, p]));
      const current = pool.map((p) => own.get(p.id) ?? p);
      const before = st.squad.length;
      st.squad = autoSquad(current, st.squad);
      await addInbox(db, career.id, career.season, career.week, "international", `${nation(st.code).name}: Der Kader steht`,
        before >= SQUAD_SIZE ? `Dein Kader mit ${st.squad.length} Spielern ist angereist.` : `Der Co-Trainer hat den Kader auf ${st.squad.length} Spieler ergänzt.`, { type: "national" });
      // Eigene Vereinsspieler sind abgestellt
      for (const p of clubSquad) if (st.squad.includes(p.id)) p.away = { season: career.season, until: w[1] };
      out.push("Länderspielpause");
    }
  }

  const today = await query<NationalMatch>(db, "select *, user_match as user from national_matches where career_id = $1 and season = $2 and day = $3 and not played order by id", [career.id, career.season, day]);
  for (const m of today) {
    const knockout = m.kind === "playoff";
    const r = m.user ? await playUserMatch(db, career, st, m, clubSquad, knockout) : quickNational(career, m, knockout);
    await storeResult(db, m, r);
    if (m.user) {
      await reportUserMatch(db, career, st, m, r);
      out.push(m.stage);
      if (m.kind === "playoff") {
        const win = winnerOf(m) === st.code;
        if (win && m.stage === "Playoff-Halbfinale") {
          const w = windows.find(([a, b]) => day >= a && day <= b)!;
          const pool = COUNTRIES.filter((c) => c.confed === nation(st.code).confed && ![st.code, m.away].includes(c.code));
          const opp = pool[new Rng(seedFor(career.seed, "nation-playoff-final", career.season)).int(0, pool.length - 1)];
          await insertMatch(db, career, { season: career.season, day: w[0] + 3, kind: "playoff", stage: "Playoff-Finale", home: opp.code, away: st.code, user: true });
        } else if (win) {
          st.qualified = true;
          await addInbox(db, career.id, career.season, career.week, "international", `${nation(st.code).name} fährt zur Endrunde!`,
            `Über die Playoffs hat sich ${nation(st.code).name} für die ${tournamentName(career.season, st.code)} qualifiziert. Die Endrunde findet nach Saisonende statt.`, { type: "national" });
        } else if (await missedQualification(db, career, st, "in den Playoffs")) {
          return out;
        }
      }
    }
  }

  // Nach der dritten Pause: Qualifikationsgruppe auswerten
  const third = windows[2];
  if (third && day === third[1] + 1) {
    const qm = await qualMatches(db, career);
    if (qm.length && qm.every((m) => m.played)) {
      const codes = [...new Set(qm.flatMap((m) => [m.home, m.away]))];
      const table = groupTable(codes, qm);
      st.groupPos = table.findIndex((r) => r.code === st.code) + 1;
      if (st.groupPos === 1) {
        st.qualified = true;
        await addInbox(db, career.id, career.season, career.week, "international", `Gruppensieg! ${nation(st.code).name} ist qualifiziert`,
          `${nation(st.code).name} gewinnt die Qualifikationsgruppe mit ${table[0].points} Punkten und fährt zur ${tournamentName(career.season, st.code)}.`, { type: "national" });
        await addArticle(db, career, { kind: "league", title: `${nation(st.code).name} löst das Ticket zur Endrunde`, body: `Mit ${table[0].points} Punkten aus ${table[0].played} Spielen gewinnt ${nation(st.code).name} unter ${career.manager_name} die Qualifikationsgruppe.`, own: true, importance: 3 });
      } else if (st.groupPos === 2) {
        await addInbox(db, career.id, career.season, career.week, "international", `${nation(st.code).name}: Platz 2 – Playoffs im März`,
          "Der zweite Platz reicht nicht direkt. In der Länderspielpause im März geht es in den Playoffs um die letzten Tickets zur Endrunde.", { type: "national" });
      } else if (await missedQualification(db, career, st, `als Gruppen${st.groupPos}.`)) {
        return out;
      }
    }
  }
  await saveNational(db, career.id, st);
  return out;
}

/** Liefert true, wenn der Verband dich entlässt. */
async function missedQualification(db: Db, career: CareerRow, st: NationalState, how: string): Promise<boolean> {
  const dismissed = st.objective.level !== "group2" || (st.groupPos ?? 4) > 2;
  st.history.push({ season: career.season, text: `Qualifikation verpasst (${how})` });
  if (dismissed) {
    await addInbox(db, career.id, career.season, career.week, "international", `Der Verband trennt sich von dir`,
      `${nation(st.code).name} hat die Endrunde ${how} verpasst. Das Ziel „${st.objective.text}“ wurde nicht erreicht – der Verband beendet die Zusammenarbeit.`);
    await addArticle(db, career, { kind: "league", title: `${nation(st.code).name} entlässt ${career.manager_name}`, body: `Nach der verpassten Qualifikation trennt sich der Verband von Nationaltrainer ${career.manager_name}.`, own: true, importance: 3 });
    await query(db, "delete from national_teams where career_id = $1", [career.id]);
    await query(db, "delete from national_matches where career_id = $1 and not played", [career.id]);
    career.manager.reputation = Math.max(1, career.manager.reputation - 5);
    return true;
  }
  {
    await addInbox(db, career.id, career.season, career.week, "international", `${nation(st.code).name}: Endrunde verpasst`,
      `Die Qualifikation ist ${how} gescheitert. Der Verband ist trotzdem zufrieden, da das Ziel erreicht wurde.`);
  }
  return false;
}

/* ---------- Endrunde ---------- */

/** Nach Saisonende: Endrunde mit 16 (bzw. 8) Nationen. Liefert eine Zusammenfassung oder null. */
export async function nationalTournament(db: pg.PoolClient, career: CareerRow): Promise<string | null> {
  const st = await getNational(db, career.id);
  if (!st) return null;
  if (!st.qualified) {
    await saveNational(db, career.id, st);
    return null;
  }
  const name = tournamentName(career.season, st.code);
  const world = name.startsWith("Weltmeisterschaft");
  const rng = new Rng(seedFor(career.seed, "nation-tournament", career.season));
  const candidates = COUNTRIES.filter((c) => c.code !== st.code && (world || c.confed === nation(st.code).confed));
  const size = candidates.length + 1 >= 16 ? 16 : candidates.length + 1 >= 8 ? 8 : 4;
  const field = [st.code, ...candidates.map((c) => ({ c, s: c.strength + rng.next() * 3 })).sort((a, b) => b.s - a.s).slice(0, size - 1).map((x) => x.c.code)];
  // Töpfe nach Stärke, Gruppen zu viert
  const pots = [...field].sort((a, b) => nation(b).strength - nation(a).strength);
  const groupCount = size / 4;
  const groups: string[][] = Array.from({ length: groupCount }, () => []);
  for (let p = 0; p < 4; p++) {
    const pot = rng.shuffle(pots.slice(p * groupCount, (p + 1) * groupCount));
    pot.forEach((code, i) => groups[i].push(code));
  }
  const baseDay = (career.calendar?.slots.at(-1)?.day ?? 320) + 14;
  const letters = "ABCD";
  const squad = await getPlayersByIds(db, career.id, st.squad);
  // Vor der Endrunde: Kader ohne Verletzte, aufgefüllt
  st.squad = autoSquad((await nationPool(db, career, st.code)).filter((p) => p.injuryWeeks === 0), squad.filter((p) => p.injuryWeeks === 0).map((p) => p.id));
  const lines: string[] = [];
  let userAlive = true;
  let reached = "Gruppenphase";

  const play = async (m: NationalMatch, knockout: boolean) => {
    const r = m.user ? await playUserMatch(db, career, st, m, [], knockout) : quickNational(career, m, knockout);
    await storeResult(db, m, r);
    if (m.user) await reportUserMatch(db, career, st, m, r);
    return m;
  };
  const make = async (day: number, stage: string, home: string, away: string): Promise<NationalMatch> => {
    const id = await insertMatch(db, career, { season: career.season, day, kind: "tournament", stage: `${name} · ${stage}`, home, away, user: home === st.code || away === st.code });
    return { id, season: career.season, day, kind: "tournament", stage: `${name} · ${stage}`, home, away, home_goals: null, away_goals: null, pen_home: null, pen_away: null, played: false, user: home === st.code || away === st.code, data: null };
  };

  // Gruppenphase
  const qualifiedFrom: string[][] = [];
  for (const [gi, g] of groups.entries()) {
    const ms: NationalMatch[] = [];
    const rounds: [number, number][][] = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
    for (const [ri, r] of rounds.entries()) for (const [h, a] of r) ms.push(await play(await make(baseDay + ri * 4, `Gruppe ${letters[gi]}`, g[h], g[a]), false));
    const table = groupTable(g, ms);
    qualifiedFrom.push(table.slice(0, 2).map((t) => t.code));
    if (g.includes(st.code)) {
      const pos = table.findIndex((t) => t.code === st.code) + 1;
      lines.push(`Gruppe ${letters[gi]}: Platz ${pos} (${table[pos - 1].points} Punkte)`);
      if (pos > 2) userAlive = false;
    }
  }
  // K.-o.-Runden
  let bracket: string[] = [];
  if (groupCount === 4) bracket = [qualifiedFrom[0][0], qualifiedFrom[1][1], qualifiedFrom[2][0], qualifiedFrom[3][1], qualifiedFrom[1][0], qualifiedFrom[0][1], qualifiedFrom[3][0], qualifiedFrom[2][1]];
  else if (groupCount === 2) bracket = [qualifiedFrom[0][0], qualifiedFrom[1][1], qualifiedFrom[1][0], qualifiedFrom[0][1]];
  else bracket = qualifiedFrom[0];
  const roundNames = bracket.length === 8 ? ["Viertelfinale", "Halbfinale", "Finale"] : bracket.length === 4 ? ["Halbfinale", "Finale"] : ["Finale"];
  let day = baseDay + 14;
  for (const rn of roundNames) {
    const next: string[] = [];
    for (let i = 0; i < bracket.length; i += 2) {
      const m = await play(await make(day, rn, bracket[i], bracket[i + 1]), true);
      const w = winnerOf(m);
      next.push(w);
      if (m.user) {
        lines.push(`${rn}: ${scoreText(m)}`);
        if (w === st.code) reached = rn === "Finale" ? "Turniersieg" : roundNames[roundNames.indexOf(rn) + 1];
        else {
          userAlive = false;
          reached = rn;
        }
      }
    }
    bracket = next;
    day += 5;
  }
  const champion = bracket[0];
  if (userAlive && champion === st.code) reached = "Turniersieg";
  if (reached === "Gruppenphase" && userAlive === false && !lines.some((l) => l.startsWith("Viertel") || l.startsWith("Halb"))) reached = "Gruppenphase";

  // Bewertung
  const order = ["Gruppenphase", "Viertelfinale", "Halbfinale", "Finale", "Turniersieg"];
  const reachedIdx = order.indexOf(reached);
  const failed = st.objective.level === "semi" && reachedIdx < order.indexOf("Halbfinale");
  st.history.push({ season: career.season, text: `${name}: ${reached === "Turniersieg" ? "Turniersieger" : `Aus im ${reached === "Gruppenphase" ? "Gruppenspiel" : reached}`}` });
  st.qualified = false;
  st.groupPos = null;
  career.manager.reputation = Math.max(1, Math.min(100, career.manager.reputation + [-2, 2, 4, 6, 12][reachedIdx]));
  const summary = `${name}: ${reached === "Turniersieg" ? `${nation(st.code).name} ist Turniersieger!` : `${nation(st.code).name} scheidet ${reached === "Gruppenphase" ? "in der Gruppenphase" : `im ${reached}`} aus.`} Sieger: ${nation(champion).name}.`;
  await addInbox(db, career.id, career.season, career.week, "international", reached === "Turniersieg" ? `${nation(st.code).name} gewinnt die ${name}!` : `${name} beendet`,
    `${lines.map((l) => `• ${l}`).join("\n")}\n\nTurniersieger: ${nation(champion).name}.` + (failed ? `\n\nDas Ziel „${st.objective.text}“ wurde verfehlt. Der Verband trennt sich von dir.` : ""), { type: "national" });
  await addArticle(db, career, { kind: "league", title: reached === "Turniersieg" ? `${nation(st.code).name} gewinnt die ${name}` : `${name}: ${nation(champion).name} holt den Titel`, body: summary, own: true, importance: 3 });
  if (failed) {
    await query(db, "delete from national_teams where career_id = $1", [career.id]);
    return summary;
  }
  await saveNational(db, career.id, st);
  return summary;
}

/** Neue Saison: Qualifikation für die nächste Endrunde ansetzen. */
export async function nationalNewSeason(db: pg.PoolClient, career: CareerRow) {
  const st = await getNational(db, career.id);
  if (!st) return;
  if (await createQualification(db, career, st)) {
    await addInbox(db, career.id, career.season, 0, "international", `${nation(st.code).name}: Qualifikation ausgelost`,
      `Die Qualifikation zur ${tournamentName(career.season, st.code)} beginnt in der Länderspielpause im September. Gruppengegner findest du unter Nationalteam.`, { type: "national" });
  }
  await saveNational(db, career.id, st);
}

/* ---------- Aktionen und Ansichten ---------- */
