/**
 * Teamdynamik: Kaderstatus mit Einsatzzeit-Erwartung, Unzufriedenheit und
 * Wechselwünsche, Hierarchie in der Kabine und Zusammenhalt.
 */
import {
  EXPECTED_SHARE, HIERARCHY_LABEL, SQUAD_STATUS, SQUAD_STATUS_LABEL, cohesion, cohesionLabel, defaultStatuses, hierarchy,
  moodLabel, playingTimeHappiness, restlessness, squadRanks, statusChange, statusOf, type Formation, type Player, type SquadStatus,
} from "@fl/sim";
import { councilView } from "./council";
import { pool, query, type Db } from "./db";
import { readCareer, withCareer } from "./career";
import { GameError } from "./errors";
import { addArticle } from "./media";
import { type CareerRow, addInbox, getClub, getPlayer, getPlayers, savePlayers } from "./repo";

const clamp = (v: number, max = 100) => Math.max(5, Math.min(max, Math.round(v)));

/** Pflichtspiele des eigenen Vereins in dieser Saison. */
async function matchesPlayed(db: Db, career: CareerRow): Promise<number> {
  const rows = await query<{ n: string }>(db,
    "select count(*) as n from fixtures where career_id = $1 and season = $2 and played and (home_id = $3 or away_id = $3)",
    [career.id, career.season, career.club_id]);
  return Number(rows[0]?.n ?? 0);
}

/** Nach jedem eigenen Pflichtspiel: Einsatzzeit zählen und Moral nach Kaderstatus anpassen. */
export function trackPlayingTime(squad: Player[], playedIds: Set<number>, startedIds: Set<number>, season: number, formation?: Formation) {
  const defaults = defaultStatuses(squad, formation);
  for (const p of squad) {
    if (!p.playing || p.playing.season !== season) p.playing = { season, matches: 0, starts: 0 };
    if (p.injuryWeeks > 0 || p.suspendedWeeks > 0) continue;
    p.playing.matches++;
    if (startedIds.has(p.id)) p.playing.starts++;
    if (!playedIds.has(p.id)) {
      const status = statusOf(p, defaults);
      const delta = { star: -3, important: -2, regular: -1, rotation: 0, backup: 1, prospect: 1 }[status];
      p.morale = clamp(p.morale + delta, delta > 0 ? 75 : 100);
      p.form = Math.max(1, Math.round((p.form * 0.9 + 0.6) * 10) / 10);
    }
  }
}

/**
 * Wöchentlich: Zufriedenheit mit der Einsatzzeit, Wechselwünsche und der
 * Einfluss des Zusammenhalts auf die Stimmung. Liefert Ereignisse für den Tag.
 */
export async function weeklyDynamics(db: Db, career: CareerRow, squad: Player[]): Promise<string[]> {
  const out: string[] = [];
  const club = career.club_id ? await getClub(db, career.id, career.club_id) : null;
  const defaults = defaultStatuses(squad, club?.tactic?.formation);
  const coh = cohesion(squad, career.season, await matchesPlayed(db, career));
  for (const p of squad) {
    if (p.loan) continue;
    const status = statusOf(p, defaults);
    const h = playingTimeHappiness(p, status, career.season);
    if (h !== null) {
      if (h <= -0.4) p.morale = clamp(p.morale - 2);
      else if (h >= 0.2) p.morale = clamp(p.morale + 1);
    }
    if (coh < 40) p.morale = clamp(p.morale - 1);
    else if (coh >= 75) p.morale = clamp(p.morale + 1);
    if (!p.transferRequest && h !== null && h <= -0.6 && p.morale < 30 * restlessness(p) && (p.playing?.matches ?? 0) >= 8) {
      p.transferRequest = true;
      await addInbox(db, career.id, career.season, career.week, "transfer", `${p.firstName} ${p.lastName} bittet um Freigabe`,
        `${p.firstName} ${p.lastName} ist mit seiner Einsatzzeit unzufrieden. Als ${SQUAD_STATUS_LABEL[status]} hat er nur ` +
          `${p.playing!.starts} von ${p.playing!.matches} Spielen begonnen und möchte den Verein verlassen.\n\n` +
          "Du kannst ihm mehr Einsatzzeit versprechen, ihn öffentlich auf die Transferliste setzen oder seinen Status anpassen.",
        { type: "player", playerId: p.id });
      await addArticle(db, career, {
        kind: "interview", title: `${p.lastName}: „Ich will spielen“`,
        body: `${p.firstName} ${p.lastName} macht seinem Ärger Luft: „Ich bin hierhergekommen, um zu spielen. ${p.playing!.starts} Einsätze von Beginn an aus ${p.playing!.matches} Spielen sind zu wenig. Ich habe den Verein gebeten, mich gehen zu lassen.“`,
        clubId: career.club_id, playerId: p.id, own: true, importance: 2,
      });
      out.push(`Wechselwunsch: ${p.lastName}`);
    } else if (p.transferRequest && p.morale >= 60) {
      p.transferRequest = false;
      await addInbox(db, career.id, career.season, career.week, "transfer", `${p.firstName} ${p.lastName} zieht Wechselwunsch zurück`,
        `${p.firstName} ${p.lastName} ist wieder zufrieden und möchte bleiben.`, { type: "player", playerId: p.id });
      out.push(`Wechselwunsch zurückgezogen: ${p.lastName}`);
    }
  }
  return out;
}

export async function dynamicsView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Kein Verein");
  const club = (await getClub(pool(), career.id, career.club_id))!;
  const squad = await getPlayers(pool(), career.id, [club.id]);
  const ranks = squadRanks(squad);
  const defaults = defaultStatuses(squad, club.tactic?.formation);
  const played = await matchesPlayed(pool(), career);
  const coh = cohesion(squad, career.season, played);
  const avgMorale = squad.length ? squad.reduce((s, p) => s + p.morale, 0) / squad.length : 50;
  const hier = hierarchy(squad.filter((p) => !p.loan), career.season);
  const levelOf = new Map(hier.map((h) => [h.player.id, h]));
  const brief = (p: Player) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, age: p.age, nationality: p.nationality, position: p.position, rating: p.rating, morale: p.morale });
  const rows = squad
    .sort((a, b) => (ranks.get(a.id) ?? 99) - (ranks.get(b.id) ?? 99))
    .map((p) => {
      const rank = ranks.get(p.id) ?? 30;
      const status = statusOf(p, defaults);
      const pl = p.playing?.season === career.season ? p.playing : null;
      const h = playingTimeHappiness(p, status, career.season);
      const reasons: string[] = [];
      if (p.transferRequest) reasons.push("Wechselwunsch");
      if (h !== null && h <= -0.4) reasons.push("Zu wenig Einsatzzeit");
      if (p.contract && p.contract.untilSeason <= career.season && rank <= 14 && !p.loan) reasons.push("Vertrag läuft aus");
      if (p.promise) reasons.push("Versprochene Einsatzzeit");
      return {
        ...brief(p),
        status, statusLabel: SQUAD_STATUS_LABEL[status], custom: !!p.squadStatus, suggested: defaults.get(p.id) ?? "backup",
        expected: Math.round(EXPECTED_SHARE[status] * 100),
        matches: pl?.matches ?? 0, starts: pl?.starts ?? 0,
        share: pl && pl.matches ? Math.round((pl.starts / pl.matches) * 100) : null,
        happiness: h, influence: levelOf.get(p.id)?.influence ?? 0, level: levelOf.get(p.id)?.level ?? "other",
        transferRequest: !!p.transferRequest, loan: !!p.loan, reasons,
      };
    });
  const unhappy = rows.filter((r) => r.morale < 40 || r.transferRequest || (r.happiness !== null && r.happiness <= -0.4));
  const leaders = hier.filter((h) => h.level === "leader");
  const leaderMood = leaders.length ? leaders.reduce((s, h) => s + h.player.morale, 0) / leaders.length : avgMorale;
  return {
    career: { season: career.season, day: career.day },
    kit: club.colors,
    cohesion: { value: coh, label: cohesionLabel(coh), matches: played, newPlayers: squad.filter((p) => p.joined?.season === career.season).length },
    mood: { value: Math.round(avgMorale), label: moodLabel(avgMorale), leaders: Math.round(leaderMood) },
    hierarchy: (["leader", "influential", "other"] as const).map((level) => ({
      level, label: HIERARCHY_LABEL[level],
      players: hier.filter((h) => h.level === level).map((h) => ({ ...brief(h.player), influence: h.influence })),
    })),
    statuses: SQUAD_STATUS.map((s) => ({ value: s, label: SQUAD_STATUS_LABEL[s], expected: Math.round(EXPECTED_SHARE[s] * 100) })),
    players: rows,
    unhappy,
    council: await councilView(career, squad, club.tactic?.captain),
  };
}

export async function setSquadStatus(careerId: string, accountId: string, playerId: number, status: SquadStatus) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!SQUAD_STATUS.includes(status)) throw new GameError("Unbekannter Status");
    const p = await getPlayer(db, career.id, playerId);
    if (!p || p.clubId !== career.club_id) throw new GameError("Spieler nicht in deinem Kader.");
    const squad = await getPlayers(db, career.id, [career.club_id!]);
    const club = await getClub(db, career.id, career.club_id!);
    const defaults = defaultStatuses(squad, club?.tactic?.formation);
    const before = statusOf(p, defaults);
    if (before === status) return { message: `${p.lastName} ist bereits ${SQUAD_STATUS_LABEL[status]}.` };
    const expected = defaults.get(p.id) ?? "backup";
    const step = statusChange(before, status);
    const vsExpected = statusChange(expected, status);
    let message: string;
    if (step < 0 && status !== "prospect") {
      // Herabstufung: je weiter unter der eigenen Einschätzung, desto grösser die Enttäuschung
      const hit = 4 + Math.max(0, -vsExpected) * 4;
      p.morale = clamp(p.morale - hit);
      message = vsExpected < 0
        ? `${p.lastName} ist enttäuscht: Er sieht sich als ${SQUAD_STATUS_LABEL[expected]}, nicht als ${SQUAD_STATUS_LABEL[status]}.`
        : `${p.lastName} akzeptiert die neue Rolle als ${SQUAD_STATUS_LABEL[status]}.`;
    } else {
      p.morale = clamp(p.morale + 3 + Math.max(0, step) * 2);
      message = `${p.lastName} freut sich über das Vertrauen als ${SQUAD_STATUS_LABEL[status]}.`;
    }
    p.squadStatus = status;
    await savePlayers(db, career.id, [p]);
    await addInbox(db, career.id, career.season, career.week, "news", `Kaderstatus: ${p.firstName} ${p.lastName}`,
      `${p.firstName} ${p.lastName} ist jetzt ${SQUAD_STATUS_LABEL[status]} (erwartet ${Math.round(EXPECTED_SHARE[status] * 100)} % Startelfeinsätze).\n\n${message}`,
      { type: "player", playerId: p.id });
    return { message, morale: p.morale };
  });
}
