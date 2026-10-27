/**
 * Vereinsverwaltung und Fans: Identität (Name, Kürzel, Farben, Stadion),
 * Ticketpreise, Fanzufriedenheit, Mitglieder, Fanstimmen und Fan-Aktionen.
 * Die Fans wirken auf Zuschauer, Ticket- und Fanartikel-Einnahmen und das
 * Vertrauen des Vorstands.
 */
import { Rng, formatMoney, seedFor, type ClubFinanceProfile } from "@fl/sim";
import type pg from "pg";
import { type Db, pool, query } from "./db";
import { readCareer, withCareer } from "./career";
import { GameError } from "./errors";
import { addArticle } from "./media";
import { type CareerRow, type ClubRow, addFinance, addInbox, getClub, getPlayers, saveCareer, saveClubs } from "./repo";
import { sponsorView } from "./sponsors";

export type TicketLevel = "low" | "normal" | "high" | "premium";
export const TICKET_LEVELS: Record<TicketLevel, { label: string; price: number; demand: number; mood: number }> = {
  low: { label: "Günstig", price: 0.8, demand: 1.08, mood: 0.5 },
  normal: { label: "Normal", price: 1, demand: 1, mood: 0 },
  high: { label: "Hoch", price: 1.25, demand: 0.9, mood: -0.6 },
  premium: { label: "Premium", price: 1.5, demand: 0.78, mood: -1.3 },
};

type FanActionKey = "training" | "autographs" | "fanclub" | "forum" | "familyday" | "assembly";
export const FAN_ACTIONS: Record<FanActionKey, { label: string; text: string; cost: number; gain: number; cooldown: number }> = {
  training: { label: "Öffentliches Training", text: "Die Fans schauen beim Training zu und kommen den Spielern nahe.", cost: 0, gain: 3, cooldown: 21 },
  autographs: { label: "Autogrammstunde", text: "Spieler schreiben Autogramme im Fanshop. Hebt auch die Moral der Mannschaft.", cost: 5_000, gain: 4, cooldown: 28 },
  forum: { label: "Fan-Fragerunde", text: "Du stellst dich den Fragen der Fans. Wirkt besonders, wenn es sportlich nicht läuft.", cost: 0, gain: 3, cooldown: 21 },
  fanclub: { label: "Fanclub-Besuch", text: "Mannschaft und Trainer besuchen einen Fanclub in der Region.", cost: 20_000, gain: 5, cooldown: 35 },
  familyday: { label: "Familientag im Stadion", text: "Ein Fest für Familien mit Stadionführung, Spielen und Verpflegung.", cost: 60_000, gain: 8, cooldown: 60 },
  assembly: { label: "Mitgliederversammlung", text: "Du berichtest den Mitgliedern über Kurs und Pläne. Stärkt auch das Vertrauen des Vorstands.", cost: 10_000, gain: 2, cooldown: 90 },
};

export interface ClubMgmt {
  clubId: number;
  satisfaction: number;
  members: number;
  ticketLevel: TicketLevel;
  stadiumName: string;
  actions: Partial<Record<FanActionKey, { season: number; day: number }>>;
  voices: { season: number; day: number; text: string; tone: "pos" | "neg" | "neutral" }[];
  history: { season: number; day: number; value: number }[];
  renamed: number;
  lastProtest: { season: number; day: number } | null;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

function fresh(club: ClubRow): ClubMgmt {
  return {
    clubId: club.id, satisfaction: 60, members: Math.round(club.capacity * (0.35 + club.reputation / 160)), ticketLevel: "normal",
    stadiumName: `${club.city}-Arena`, actions: {}, voices: [], history: [], renamed: 0, lastProtest: null,
  };
}

export async function getMgmt(db: Db, career: CareerRow, club: ClubRow): Promise<ClubMgmt> {
  const rows = await query<{ club_mgmt: ClubMgmt | null }>(db, "select club_mgmt from careers where id = $1", [career.id]);
  const m = rows[0]?.club_mgmt;
  return m && m.clubId === club.id ? m : fresh(club);
}

async function saveMgmt(db: Db, career: CareerRow, m: ClubMgmt) {
  await query(db, "update careers set club_mgmt = $2 where id = $1", [career.id, JSON.stringify(m)]);
}

export function moodLabel(v: number) {
  return v >= 85 ? "Euphorisch" : v >= 70 ? "Begeistert" : v >= 55 ? "Zufrieden" : v >= 40 ? "Geteilt" : v >= 25 ? "Unzufrieden" : "Wütend";
}

/** Zuschauer und Preise für Heimspiele des eigenen Vereins. */
export function fanAdjusted(m: ClubMgmt, profile: ClubFinanceProfile, attendance: number, capacity: number): { profile: ClubFinanceProfile; attendance: number } {
  const t = TICKET_LEVELS[m.ticketLevel];
  const fanFactor = 0.85 + m.satisfaction / 400;
  return {
    attendance: Math.min(capacity, Math.round(attendance * t.demand * fanFactor)),
    profile: { ...profile, ticketPrice: Math.round(profile.ticketPrice * t.price), merchWeekly: Math.round(profile.merchWeekly * (0.75 + m.satisfaction / 200)) },
  };
}

/** Lädt den Fanzustand für die Wochenverarbeitung (null ohne Verein). */
export async function loadMgmtForWeek(db: Db, career: CareerRow): Promise<ClubMgmt | null> {
  if (!career.club_id) return null;
  const club = await getClub(db, career.id, career.club_id);
  return club ? getMgmt(db, career, club) : null;
}

/**
 * Wöchentlich nach dem Spieltag: Stimmung nach Ergebnis, Tabellenplatz,
 * Ticketpreisen; Mitgliederentwicklung, Fanstimmen, Proteste.
 */
export async function weeklyFans(
  db: pg.PoolClient, career: CareerRow, m: ClubMgmt, club: ClubRow,
  result: { gf: number; ga: number; opponent: string; home: boolean; derby?: boolean } | null, position: number | null, soldStars: string[],
) {
  const rng = new Rng(seedFor(career.seed, "fans", career.season, career.week));
  let delta = TICKET_LEVELS[m.ticketLevel].mood;
  const voices: ClubMgmt["voices"] = [];
  const say = (text: string, tone: "pos" | "neg" | "neutral") => voices.push({ season: career.season, day: career.day, text, tone });
  if (result) {
    const diff = result.gf - result.ga;
    // Im Derby zählt das Ergebnis für die Fans doppelt
    delta += (diff > 0 ? 2 + Math.min(2, diff - 1) * 0.5 : diff === 0 ? -0.3 : -2 - Math.min(2, -diff - 1) * 0.5) * (result.derby ? 2 : 1);
    if (result.derby) say(diff > 0 ? `Derbysieger! Gegen ${result.opponent} zählt nur das.` : diff < 0 ? `Gegen ${result.opponent} verloren – das darf nicht passieren.` : `Unentschieden gegen ${result.opponent}. Nächstes Mal holen wir uns die Stadt.`, diff > 0 ? "pos" : diff < 0 ? "neg" : "neutral");
    if (diff >= 3) say(rng.pick([`Was für ein Auftritt gegen ${result.opponent}! So wollen wir unsere Mannschaft sehen.`, `${result.gf}:${result.ga} – das war Werbung für den Verein.`]), "pos");
    else if (diff > 0) say(rng.pick(["Drei Punkte, die Richtung stimmt.", `Verdienter Sieg gegen ${result.opponent}. Weiter so!`, "Die Mannschaft kämpft – das honorieren wir."]), "pos");
    else if (diff === 0) say(rng.pick(["Ein Punkt ist zu wenig für unsere Ansprüche.", `Gegen ${result.opponent} muss mehr drin sein.`, "Ordentlich, aber vorne fehlt die Durchschlagskraft."]), "neutral");
    else if (diff <= -3) say(rng.pick([`Eine Blamage gegen ${result.opponent}. Wir erwarten eine Reaktion!`, "So eine Leistung hat das Trikot nicht verdient."]), "neg");
    else say(rng.pick(["Wieder eine Niederlage – langsam wird es ungemütlich.", `Gegen ${result.opponent} haben wir zu wenig gezeigt.`]), "neg");
  }
  if (position !== null) {
    const exp = career.board.expectedPosition;
    if (position < exp - 1) delta += 0.6;
    else if (position > exp + 2) delta -= 0.6;
    if (position === 1 && rng.chance(0.5)) say("Tabellenführer! Die ganze Stadt träumt vom Titel.", "pos");
  }
  if (m.ticketLevel === "premium" && rng.chance(0.4)) say("Die Ticketpreise sind eine Frechheit. Fussball muss bezahlbar bleiben!", "neg");
  if (m.ticketLevel === "low" && rng.chance(0.25)) say("Danke für die fairen Preise – so geht Fannähe.", "pos");
  for (const name of soldStars) {
    delta -= 5;
    say(`Wie kann man ${name} verkaufen? Das tut weh.`, "neg");
  }
  m.satisfaction = Math.round(clamp(m.satisfaction + delta) * 10) / 10;
  m.members = Math.max(100, Math.round(m.members * (1 + (m.satisfaction - 50) / 4000)));
  m.history = [...m.history.slice(-59), { season: career.season, day: career.day, value: Math.round(m.satisfaction) }];
  m.voices = [...voices, ...m.voices].slice(0, 14);
  // Vorstand reagiert auf die Stimmung
  if (m.satisfaction < 30) career.board.confidence = Math.max(0, career.board.confidence - 1);
  else if (m.satisfaction > 75) career.board.confidence = Math.min(100, career.board.confidence + 0.3);
  // Proteste bei sehr schlechter Stimmung
  const since = m.lastProtest ? (m.lastProtest.season === career.season ? career.day - m.lastProtest.day : 999) : 999;
  if (m.satisfaction < 25 && since > 30) {
    m.lastProtest = { season: career.season, day: career.day };
    await addInbox(db, career.id, career.season, career.week, "board", "Fanproteste vor dem Stadion",
      `Mehrere hundert Fans haben vor dem Stadion protestiert. Die Stimmung ist ${moodLabel(m.satisfaction).toLowerCase()} (${Math.round(m.satisfaction)}/100).\n\nSuche den Kontakt: Unter Büro → Verein & Fans kannst du mit Fan-Aktionen gegensteuern oder die Ticketpreise senken.`,
      { type: "club" });
    await addArticle(db, career, { kind: "league", title: `Fanproteste bei ${club.name}`, body: `Die Anhänger von ${club.name} machen ihrem Ärger Luft. Die Stimmung rund um den Verein ist auf dem Tiefpunkt.`, clubId: club.id, own: true, importance: 2 });
  }
  await saveMgmt(db, career, m);
}

/* ---------- Ansicht und Aktionen ---------- */

const cooldownLeft = (m: ClubMgmt, key: FanActionKey, career: CareerRow) => {
  const a = m.actions[key];
  if (!a) return 0;
  const passed = a.season === career.season ? career.day - a.day : 999;
  return Math.max(0, FAN_ACTIONS[key].cooldown - passed);
};

export async function clubManagementView(careerId: string, accountId: string) {
  const career = await readCareer(careerId, accountId);
  if (!career.club_id) throw new GameError("Kein Verein");
  const club = (await getClub(pool(), career.id, career.club_id))!;
  const m = await getMgmt(pool(), career, club);
  const att = await query<{ label: string }>(pool(),
    "select label from finance_log where career_id = $1 and club_id = $2 and season = $3 and kind = 'tickets' order by id desc limit 10", [career.id, club.id, career.season]);
  const crowds = att.map((r) => Number(r.label.replace(/[^0-9]/g, ""))).filter((n) => n > 0);
  const t = TICKET_LEVELS[m.ticketLevel];
  return {
    club: { id: club.id, name: club.name, short: club.short_name, city: club.city, colors: club.colors, founded: club.founded, capacity: club.capacity, reputation: club.reputation },
    stadiumName: m.stadiumName,
    fans: {
      satisfaction: Math.round(m.satisfaction), label: moodLabel(m.satisfaction), members: m.members,
      history: m.history, voices: m.voices,
      avgAttendance: crowds.length ? Math.round(crowds.reduce((s, n) => s + n, 0) / crowds.length) : null,
    },
    tickets: {
      level: m.ticketLevel,
      basePrice: club.finance?.ticketPrice ?? 0,
      levels: Object.entries(TICKET_LEVELS).map(([k, v]) => ({ value: k, label: v.label, price: Math.round((club.finance?.ticketPrice ?? 0) * v.price), demand: v.demand })),
      current: Math.round((club.finance?.ticketPrice ?? 0) * t.price),
    },
    actions: Object.entries(FAN_ACTIONS).map(([k, a]) => ({ key: k, ...a, wait: cooldownLeft(m, k as FanActionKey, career) })),
    renamed: m.renamed,
    balance: club.balance,
    sponsor: await sponsorView(pool(), career, club),
  };
}

export async function setTicketLevel(careerId: string, accountId: string, level: TicketLevel) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!(level in TICKET_LEVELS)) throw new GameError("Unbekannte Preisstufe");
    const club = (await getClub(db, career.id, career.club_id!))!;
    const m = await getMgmt(db, career, club);
    m.ticketLevel = level;
    await saveMgmt(db, career, m);
    return { message: `Ticketpreise: ${TICKET_LEVELS[level].label} (${formatMoney(Math.round((club.finance?.ticketPrice ?? 0) * TICKET_LEVELS[level].price))} pro Ticket).` };
  });
}

export async function fanAction(careerId: string, accountId: string, key: FanActionKey) {
  return withCareer(careerId, accountId, async (db, career) => {
    const a = FAN_ACTIONS[key];
    if (!a) throw new GameError("Unbekannte Aktion");
    const club = (await getClub(db, career.id, career.club_id!))!;
    const m = await getMgmt(db, career, club);
    const wait = cooldownLeft(m, key, career);
    if (wait > 0) throw new GameError(`${a.label} ist erst in ${wait} Tagen wieder sinnvoll.`);
    if (club.balance < a.cost) throw new GameError("Dafür reicht das Geld nicht.");
    if (a.cost) {
      club.balance -= a.cost;
      await saveClubs(db, career.id, [club]);
      await addFinance(db, career.id, club.id, career.season, career.week, [{ kind: "other", amount: -a.cost, label: a.label }]);
    }
    let gain = a.gain;
    if (key === "forum" && m.satisfaction < 45) gain += 2;
    m.satisfaction = clamp(m.satisfaction + gain);
    m.actions[key] = { season: career.season, day: career.day };
    m.voices = [{ season: career.season, day: career.day, text: key === "forum" ? "Gut, dass sich der Trainer unseren Fragen stellt." : key === "familyday" ? "Ein toller Tag im Stadion – die Kinder waren begeistert!" : key === "autographs" ? "Endlich mal wieder nah dran an den Spielern." : key === "fanclub" ? "Grosse Geste, dass die Mannschaft zu uns kommt." : key === "assembly" ? "Klare Worte auf der Mitgliederversammlung." : "Schön, beim Training zuschauen zu dürfen.", tone: "pos" as const }, ...m.voices].slice(0, 14);
    if (key === "autographs") {
      const squad = await getPlayers(db, career.id, [club.id]);
      for (const p of squad) p.morale = Math.min(100, p.morale + 2);
      const { savePlayers } = await import("./repo");
      await savePlayers(db, career.id, squad);
    }
    if (key === "assembly") career.board.confidence = Math.min(100, career.board.confidence + 2);
    await saveMgmt(db, career, m);
    await saveCareer(db, career);
    await addArticle(db, career, { kind: "league", title: `${club.name}: ${a.label}`, body: `${a.text} Die Fans reagieren positiv.`, clubId: club.id, own: true });
    return { message: `${a.label}: Die Stimmung steigt auf ${Math.round(m.satisfaction)}/100.`, satisfaction: m.satisfaction };
  });
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Name, Kürzel, Stadt, Farben und Stadionname ändern. Traditionsbruch kostet Fanstimmung. */
export async function updateIdentity(careerId: string, accountId: string, input: { name?: unknown; short?: unknown; primary?: unknown; secondary?: unknown; stadiumName?: unknown }) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) throw new GameError("Kein Verein");
    const club = (await getClub(db, career.id, career.club_id))!;
    const m = await getMgmt(db, career, club);
    const changes: string[] = [];
    let hit = 0;
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 40) : club.name;
    const short = typeof input.short === "string" ? input.short.trim().toUpperCase().slice(0, 4) : club.short_name;
    if (name.length < 3) throw new GameError("Der Vereinsname muss mindestens 3 Zeichen haben.");
    if (short.length < 2) throw new GameError("Das Kürzel muss 2 bis 4 Zeichen haben.");
    if (name !== club.name || short !== club.short_name) {
      const taken = await query(db, "select 1 from clubs where career_id = $1 and id <> $2 and lower(name) = lower($3)", [career.id, club.id, name]);
      if (taken.length) throw new GameError("Diesen Namen trägt bereits ein anderer Verein.");
      if (name !== club.name) {
        changes.push(`Neuer Name: ${name}`);
        hit += 12 + m.renamed * 4;
        m.renamed++;
      }
      if (short !== club.short_name) changes.push(`Kürzel: ${short}`);
    }
    const primary = typeof input.primary === "string" && HEX.test(input.primary) ? input.primary : club.colors.primary;
    const secondary = typeof input.secondary === "string" && HEX.test(input.secondary) ? input.secondary : club.colors.secondary;
    if (primary !== club.colors.primary || secondary !== club.colors.secondary) {
      changes.push("Neue Vereinsfarben");
      hit += 6;
    }
    const stadium = typeof input.stadiumName === "string" ? input.stadiumName.trim().slice(0, 40) : m.stadiumName;
    if (stadium.length < 3) throw new GameError("Der Stadionname muss mindestens 3 Zeichen haben.");
    if (stadium !== m.stadiumName) {
      changes.push(`Stadion: ${stadium}`);
      hit += 4;
    }
    if (!changes.length) return { message: "Keine Änderungen." };
    await query(db, "update clubs set name = $3, short_name = $4, colors = $5 where career_id = $1 and id = $2", [career.id, club.id, name, short, JSON.stringify({ primary, secondary })]);
    m.stadiumName = stadium;
    m.satisfaction = clamp(m.satisfaction - hit);
    m.voices = [{ season: career.season, day: career.day, text: hit >= 12 ? "Ein neuer Name? Unsere Tradition ist nicht verhandelbar!" : "Mal sehen, ob wir uns daran gewöhnen.", tone: (hit >= 12 ? "neg" : "neutral") as "neg" | "neutral" }, ...m.voices].slice(0, 14);
    await saveMgmt(db, career, m);
    await addInbox(db, career.id, career.season, career.week, "board", "Vereinsidentität geändert", `${changes.join("\n")}\n\nDie Fans reagieren ${hit >= 12 ? "verärgert" : "zurückhaltend"} (Stimmung −${hit}).`, { type: "club" });
    await addArticle(db, career, { kind: "league", title: name !== club.name ? `Aus ${club.name} wird ${name}` : `${club.name} ändert sein Erscheinungsbild`, body: changes.join(". ") + ".", clubId: club.id, own: true, importance: name !== club.name ? 3 : 1 });
    return { message: `Gespeichert. Die Fanstimmung sinkt um ${hit} Punkte.` };
  });
}
