/**
 * In-Memory-Sicht auf die Welt einer Karriere für eine Spielwoche:
 * Ligen, Vereine und alle Spieler aktiver Vereine.
 */
import type { Player } from "@fl/sim";
import type { Db } from "./db";
import { query } from "./db";
import { type CareerRow, type ClubRow, type LeagueRow, getClubs, getLeagues } from "./repo";

export interface WorldState {
  career: CareerRow;
  leagues: Map<number, LeagueRow>;
  clubs: Map<number, ClubRow>;
  players: Map<number, Player>;
  squads: Map<number, Player[]>; // clubId → Spieler
  freeAgents: Player[];
  dirtyPlayers: Set<number>;
  dirtyClubs: Set<number>;
  newPlayers: Player[];
  removedPlayers: Set<number>;
}

export async function loadWorld(db: Db, career: CareerRow): Promise<WorldState> {
  const leagues = new Map((await getLeagues(db, career.id)).map((l) => [l.id, l]));
  const clubs = new Map((await getClubs(db, career.id)).map((c) => [c.id, c]));
  const rows = await query<{ data: Player; club_id: number | null }>(
    db,
    `select p.data, p.club_id from players p
      where p.career_id = $1 and (p.club_id is null or p.club_id in (select id from clubs where career_id = $1 and players_generated))`,
    [career.id],
  );
  const players = new Map<number, Player>();
  const squads = new Map<number, Player[]>();
  const freeAgents: Player[] = [];
  for (const r of rows) {
    const p = { ...r.data, clubId: r.club_id };
    players.set(p.id, p);
    if (p.clubId === null) freeAgents.push(p);
    else squads.set(p.clubId, [...(squads.get(p.clubId) ?? []), p]);
  }
  return {
    career, leagues, clubs, players, squads, freeAgents,
    dirtyPlayers: new Set(), dirtyClubs: new Set(), newPlayers: [], removedPlayers: new Set(),
  };
}

export function squadOf(w: WorldState, clubId: number): Player[] {
  return w.squads.get(clubId) ?? [];
}

/** Verschiebt einen Spieler zwischen Vereinen (oder in die Vereinslosigkeit). */
export function movePlayer(w: WorldState, p: Player, toClub: number | null) {
  const from = p.clubId;
  if (from !== null) w.squads.set(from, squadOf(w, from).filter((x) => x.id !== p.id));
  else {
    const i = w.freeAgents.findIndex((x) => x.id === p.id);
    if (i >= 0) w.freeAgents.splice(i, 1);
  }
  p.clubId = toClub;
  p.listed = false;
  if (toClub !== null) w.squads.set(toClub, [...squadOf(w, toClub), p]);
  else w.freeAgents.push(p);
  w.dirtyPlayers.add(p.id);
  // Aus gespeicherten Aufstellungen entfernen
  for (const cid of [from, toClub]) {
    if (cid === null) continue;
    const club = w.clubs.get(cid);
    if (club?.tactic) {
      club.tactic.lineup = club.tactic.lineup.map((id) => (id === p.id ? null : id));
      club.tactic.bench = club.tactic.bench.filter((id) => id !== p.id);
      w.dirtyClubs.add(cid);
    }
  }
}

export function removePlayer(w: WorldState, p: Player) {
  if (p.clubId !== null) w.squads.set(p.clubId, squadOf(w, p.clubId).filter((x) => x.id !== p.id));
  else {
    const i = w.freeAgents.findIndex((x) => x.id === p.id);
    if (i >= 0) w.freeAgents.splice(i, 1);
  }
  w.players.delete(p.id);
  w.dirtyPlayers.delete(p.id);
  w.removedPlayers.add(p.id);
}
