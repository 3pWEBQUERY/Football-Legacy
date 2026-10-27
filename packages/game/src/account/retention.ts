/**
 * Speicherdauer: Konten ohne Anmeldung seit 12 Monaten werden gelöscht. Einen
 * Monat vorher kommt eine Erinnerung per E-Mail; wer sich danach anmeldet,
 * behält sein Konto. Ohne eingerichteten Mailversand wird nichts gelöscht –
 * niemand soll sein Konto ohne Vorwarnung verlieren. Administratoren sind
 * ausgenommen. Läuft stündlich im Hintergrunddienst.
 */
import { pool, query } from "../db";
import { isAdmin } from "../monitoring";
import { layout, mailConfigured, sendMail } from "./mail";
import { appUrl } from "./password-reset";

export const INACTIVE_MONTHS = 12;
export const WARN_DAYS = 30;
const BATCH = 200;

/** Letzte Aktivität: letzter Tag mit Anmeldung oder App-Start, sonst die Registrierung. */
const LAST_ACTIVE = "coalesce(last_login_day, created_at::date)";

export interface RetentionResult { sessions: number; links: number; warned: number; deleted: number }

export async function retentionSweep(): Promise<RetentionResult> {
  const db = pool();
  const sessions = (await db.query("delete from sessions where expires_at < now()")).rowCount ?? 0;
  await db.query("delete from email_verifications where expires_at < now()");
  const links = (await db.query("delete from password_resets where created_at < now() - interval '7 days'")).rowCount ?? 0;
  // Wer wieder aktiv war, bekommt bei der nächsten Inaktivität eine neue Erinnerung
  await query(db, `update accounts set inactivity_warned_at = null where inactivity_warned_at is not null and ${LAST_ACTIVE} > inactivity_warned_at::date`);
  if (!mailConfigured()) return { sessions, links, warned: 0, deleted: 0 };

  const warnBefore = `current_date - interval '${INACTIVE_MONTHS} months' + interval '${WARN_DAYS} days'`;
  const due = await query<{ id: string; email: string; display_name: string }>(db,
    `select id, email, display_name from accounts where inactivity_warned_at is null and ${LAST_ACTIVE} < ${warnBefore} order by ${LAST_ACTIVE} limit ${BATCH}`);
  let warned = 0;
  for (const a of due) {
    if (isAdmin(a.email)) continue;
    const res = await sendMail(inactivityMail(a.email, a.display_name)).catch(() => ({ sent: false }));
    if (!res.sent) continue; // ohne zugestellte Erinnerung keine Löschung
    await query(db, "update accounts set inactivity_warned_at = now() where id = $1", [a.id]);
    warned++;
  }

  const gone = await query<{ id: string; email: string }>(db,
    `select id, email from accounts where inactivity_warned_at < now() - interval '${WARN_DAYS} days'
       and ${LAST_ACTIVE} < current_date - interval '${INACTIVE_MONTHS} months' limit ${BATCH}`);
  let deleted = 0;
  for (const a of gone) {
    if (isAdmin(a.email)) continue;
    await query(db, "delete from admin_actions where target_account = $1", [a.id]);
    await query(db, "delete from accounts where id = $1", [a.id]);
    deleted++;
  }
  if (warned || deleted) console.log(`[retention] ${warned} Erinnerung(en) verschickt, ${deleted} inaktive(s) Konto/Konten gelöscht`);
  return { sessions, links, warned, deleted };
}

function inactivityMail(to: string, name: string) {
  const url = `${appUrl()}/login`;
  const lines = [
    `Hallo ${name},`,
    `du hast dich seit fast ${INACTIVE_MONTHS} Monaten nicht mehr bei Football Legacy angemeldet. Damit wir keine Daten unnötig aufbewahren, löschen wir inaktive Konten nach ${INACTIVE_MONTHS} Monaten.`,
    `Wenn du dein Konto und deine Spielstände behalten möchtest, melde dich einfach innerhalb der nächsten ${WARN_DAYS} Tage an. Sonst werden Konto, Karrieren und Ligen-Mitgliedschaften danach endgültig gelöscht.`,
  ];
  return {
    to,
    subject: "Dein Konto bei Football Legacy wird bald gelöscht",
    text: `${lines.join("\n\n")}\n\nAnmelden: ${url}`,
    html: layout("Dein Konto wird bald gelöscht", lines, { label: "Jetzt anmelden", url }),
  };
}
