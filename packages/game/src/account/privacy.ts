/** Datenauskunft: alle zu einem Account gespeicherten persönlichen Daten als JSON (Art. 15/20 DSGVO). */
import { one, pool, query } from "../db";
import { GameError } from "../errors";

export async function exportAccountData(accountId: string) {
  const db = pool();
  const account = await one<Record<string, unknown>>(db,
    "select id, email, display_name, settings, login_streak, best_login_streak, last_login_day, created_at from accounts where id = $1", [accountId]);
  if (!account) throw new GameError("Account nicht gefunden", 404);
  const careers = await query(db,
    `select k.id, k.manager_name, k.season, k.status, k.created_at, k.updated_at, c.name as club
       from careers k left join clubs c on c.career_id = k.id and c.id = k.club_id where k.account_id = $1 order by k.created_at`, [accountId]);
  const results = await query(db,
    "select season, club_name, league_name, position, points, champion, promoted, relegated from season_results where account_id = $1 order by season", [accountId]);
  const sessions = await one<{ n: number }>(db, "select count(*)::int as n from sessions where account_id = $1 and expires_at > now()", [accountId]);
  return {
    exportedAt: new Date().toISOString(),
    note: "Spielstände (Vereine, Spieler, Spiele) sind Spieldaten und können im Spiel eingesehen werden. Das Passwort wird nur als Hash gespeichert und ist nicht enthalten.",
    account, careers, seasonResults: results, activeSessions: sessions?.n ?? 0,
  };
}
