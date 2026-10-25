/**
 * Nachrichten-Engine: erzeugt abwechslungsreiche Posteingangsnachrichten mit
 * Absender (Trainerstab, Vorstand, Medien, Fans, Liga, Berater) und
 * strukturierten Inhalten (Kennzahlen, Spielerkarten, Statistik, Zitate).
 * Formulierungen werden pro Anlass aus mehreren Varianten gewählt.
 */
import type pg from "pg";
import { COUNTRY_BY_CODE, NAME_POOLS, type MatchResult, type Player, Rng, computeStandings, dateOf, formatMoney, hashString, seedFor } from "@fl/sim";
import { type Db, one, query } from "./db";
import { type CareerRow, type ClubRow, type FixtureRow, addInbox, getClub, getClubs, getLeague, getPlayers } from "./repo";
import { teamOf } from "./staff";

// ------------------------------------------------------------ Typen

export type SenderKind = "staff" | "board" | "media" | "player" | "club" | "fans" | "league" | "agent" | "system";
export interface Sender {
  name: string;
  role: string;
  kind: SenderKind;
  playerId?: number;
  clubId?: number;
  colors?: { primary: string; secondary: string };
  /** Für Gesichter von Personen (Spieler und Stab) */
  face?: { id: number; name: string; age: number; nationality: string };
}

export type Block =
  | { t: "p"; text: string }
  | { t: "kv"; rows: [string, string][] }
  | { t: "players"; title?: string; items: { id: number; name: string; pos: string; value?: string; note?: string }[] }
  | { t: "quote"; text: string; by: string }
  | { t: "stats"; home: string; away: string; rows: { label: string; home: string; away: string; hn: number; an: number }[] }
  | { t: "list"; items: string[] }
  | { t: "form"; label: string; form: string[] };

export interface Message {
  category: string;
  title: string;
  sender: Sender;
  blocks: Block[];
  priority?: number; // 0 Info, 1 normal, 2 wichtig
  kind: string;
  action?: unknown;
}

/** Klartext aus den Blöcken (für alte Ansichten und Benachrichtigungen). */
export function plainText(blocks: Block[]): string {
  return blocks.map((b) => {
    switch (b.t) {
      case "p": return b.text;
      case "kv": return b.rows.map(([k, v]) => `${k}: ${v}`).join("\n");
      case "players": return `${b.title ? `${b.title}\n` : ""}${b.items.map((i) => `• ${i.name} (${i.pos})${i.value ? ` – ${i.value}` : ""}`).join("\n")}`;
      case "quote": return `„${b.text}“ – ${b.by}`;
      case "stats": return b.rows.map((r) => `${r.label}: ${r.home} – ${r.away}`).join("\n");
      case "list": return b.items.map((i) => `• ${i}`).join("\n");
      case "form": return `${b.label}: ${b.form.join(" ")}`;
    }
  }).join("\n\n");
}

export async function send(db: Db, career: CareerRow, m: Message) {
  await addInbox(db, career.id, career.season, career.week, m.category, m.title, plainText(m.blocks), m.action ?? null, {
    sender: m.sender, blocks: m.blocks, priority: m.priority ?? 1, kind: m.kind,
  });
}

/** Wurde diese Art Nachricht in den letzten n Tagen schon verschickt? */
async function recently(db: Db, career: CareerRow, kind: string, days: number): Promise<boolean> {
  const r = await one(db, "select 1 from inbox where career_id = $1 and kind = $2 and season = $3 and day > $4 limit 1", [career.id, kind, career.season, career.day - days]);
  return !!r;
}

// ------------------------------------------------------------ Absender

const MEDIA = ["Der Sportbote", "Fussball Aktuell", "Tribüne Online", "Anpfiff", "Kurvenblatt", "Die Abseitsfalle", "Ballgeflüster"];
const STAFF_ROLE: Record<string, string> = { coach: "Co-Trainer", physio: "Chef-Physiotherapeut", scout: "Chefscout", youth: "Leiter Nachwuchs" };

function personName(seed: number, country: string, ...parts: (string | number)[]) {
  const pool = NAME_POOLS[COUNTRY_BY_CODE[country]?.region ?? "en"] ?? NAME_POOLS.en;
  const rng = new Rng(seedFor(seed, ...parts));
  return `${rng.pick(pool.first)} ${rng.pick(pool.last)}`;
}

export async function staffSender(db: Db, career: CareerRow, club: ClubRow, role: "coach" | "physio" | "scout" | "youth"): Promise<Sender> {
  const team = await teamOf(db, career, club);
  const m = team.members.find((x) => x.role === role);
  if (!m) return { name: STAFF_ROLE[role], role: `${STAFF_ROLE[role]} (vakant)`, kind: "staff" };
  return { name: m.name, role: STAFF_ROLE[role], kind: "staff", face: { id: 900_000 + m.id, name: m.name, age: m.age, nationality: m.nationality } };
}

export function presidentSender(career: CareerRow, club: ClubRow): Sender {
  return { name: personName(career.seed, club.country_code, "president", club.id), role: `Präsident, ${club.name}`, kind: "board", clubId: club.id, colors: club.colors };
}

export function mediaSender(career: CareerRow, club: ClubRow, salt: string | number): Sender {
  const rng = new Rng(seedFor(career.seed, "media", salt));
  const outlet = rng.pick(MEDIA);
  return { name: personName(career.seed, club.country_code, "journalist", outlet), role: `Reporter, ${outlet}`, kind: "media" };
}

export function fansSender(club: ClubRow): Sender {
  return { name: `Fanclub ${club.city}`, role: `Offizieller Fanclub von ${club.name}`, kind: "fans", clubId: club.id, colors: club.colors };
}

export function clubSender(club: ClubRow, role: string): Sender {
  return { name: club.name, role, kind: "club", clubId: club.id, colors: club.colors };
}

function playerSender(p: Player, role = "Spieler"): Sender {
  return { name: `${p.firstName} ${p.lastName}`, role, kind: "player", playerId: p.id, face: { id: p.id, name: `${p.firstName} ${p.lastName}`, age: p.age, nationality: p.nationality } };
}

/** Absender für ältere Nachrichten ohne gespeicherten Absender, abgeleitet aus der Kategorie. */
export async function senderResolver(db: Db, career: CareerRow) {
  const club = career.club_id ? await getClub(db, career.id, career.club_id) : null;
  const staff = club ? await teamOf(db, career, club) : null;
  const staffOf = (role: string): Sender => {
    const m = staff?.members.find((x) => x.role === role);
    return m ? { name: m.name, role: STAFF_ROLE[role], kind: "staff", face: { id: 900_000 + m.id, name: m.name, age: m.age, nationality: m.nationality } } : { name: STAFF_ROLE[role], role: "Trainerstab", kind: "staff" };
  };
  const byCategory: Record<string, () => Sender> = {
    match: () => staffOf("coach"), tips: () => staffOf("coach"), training: () => staffOf("coach"), medical: () => staffOf("physio"),
    scout: () => staffOf("scout"), youth: () => staffOf("youth"),
    board: () => (club ? presidentSender(career, club) : { name: "Vorstand", role: "Vereinsführung", kind: "board" }),
    finance: () => (club ? clubSender(club, "Finanzabteilung") : { name: "Finanzabteilung", role: "Verein", kind: "club" }),
    transfer: () => (club ? clubSender(club, "Sportdirektion") : { name: "Sportdirektion", role: "Verein", kind: "club" }),
    contract: () => (club ? clubSender(club, "Vertragsabteilung") : { name: "Vertragsabteilung", role: "Verein", kind: "club" }),
    club: () => (club ? fansSender(club) : { name: "Fans", role: "Anhänger", kind: "fans" }),
    news: () => ({ name: "Fussball Aktuell", role: "Nachrichten aus aller Welt", kind: "media" }),
    award: () => ({ name: "Ligaverband", role: "Auszeichnungen", kind: "league" }),
    international: () => ({ name: "Nationalverband", role: "Länderspiele", kind: "league" }),
    career: () => ({ name: "Karriere", role: "Jobangebote und Bewerbungen", kind: "system" }),
  };
  return (category: string): Sender => (byCategory[category] ?? (() => ({ name: "Football Legacy", role: "Nachricht", kind: "system" as const })))();
}

// ------------------------------------------------------------ Hilfen

const fullName = (p: Player) => `${p.firstName} ${p.lastName}`;
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function pick<T>(rng: Rng, items: T[]): T { return rng.pick(items); }

/** Platzhalter {name} etc. ersetzen. */
function fill(text: string, vars: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

async function leagueTable(db: Db, career: CareerRow, leagueId: number) {
  const clubs = await getClubs(db, career.id, "league_id = $2", [leagueId]);
  const fx = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and season = $2 and league_id = $3 and played and cup_id is null", [career.id, career.season, leagueId]);
  const table = computeStandings(clubs.map((c) => c.id), fx.map((f) => ({ homeId: f.home_id, awayId: f.away_id, homeGoals: f.home_goals, awayGoals: f.away_goals, round: f.round })));
  return { clubs: new Map(clubs.map((c) => [c.id, c])), table };
}

// ------------------------------------------------------------ Spielvorbereitung

export async function matchPreview(db: pg.PoolClient, career: CareerRow, f: FixtureRow, when: string, competition: string) {
  const club = (await getClub(db, career.id, career.club_id!))!;
  const oppId = f.home_id === club.id ? f.away_id : f.home_id;
  const opp = (await getClub(db, career.id, oppId))!;
  const oppSquad = await getPlayers(db, career.id, [opp.id]);
  const key = [...oppSquad].filter((p) => p.injuryWeeks === 0).sort((a, b) => b.rating - a.rating).slice(0, 3);
  const recent = await query<FixtureRow>(db, "select * from fixtures where career_id = $1 and season = $2 and played and $3 in (home_id, away_id) order by week desc limit 5", [career.id, career.season, opp.id]);
  const form = recent.reverse().map((r) => {
    const gf = r.home_id === opp.id ? r.home_goals! : r.away_goals!;
    const ga = r.home_id === opp.id ? r.away_goals! : r.home_goals!;
    return gf > ga ? "S" : gf === ga ? "U" : "N";
  });
  const injured = oppSquad.filter((p) => p.injuryWeeks > 0).length;
  const home = f.home_id === club.id;
  const diff = club.rating - opp.rating;
  const rng = new Rng(seedFor(career.seed, "preview", f.id));
  let pos: string | null = null;
  if (!f.cup_id) {
    const { table } = await leagueTable(db, career, opp.league_id);
    const i = table.findIndex((r) => r.clubId === opp.id);
    if (i >= 0 && table[i].played > 0) pos = `${i + 1}.`;
  }
  const intro = pick(rng, [
    "Ich habe mir {opp} genau angesehen. Hier meine Einschätzung vor dem Spiel.",
    "Unser nächster Gegner ist {opp}. Das Trainerteam hat die letzten Partien ausgewertet.",
    "Die Analyse von {opp} ist fertig – das Wichtigste auf einen Blick.",
  ]);
  const verdict = diff > 6
    ? pick(rng, ["Auf dem Papier sind wir klarer Favorit. Wichtig ist, dass wir das Spiel von Beginn an kontrollieren und nicht nachlässig werden.", "Wir sind besser besetzt – aber genau solche Spiele verliert man, wenn man sie zu leicht nimmt."])
    : diff < -6
      ? pick(rng, ["{opp} ist stärker einzuschätzen. Ich empfehle, kompakt zu stehen und auf Konter zu setzen.", "Ein schweres Spiel. Mit einer tieferen Grundordnung und schnellem Umschalten können wir sie ärgern."])
      : pick(rng, ["Ein Duell auf Augenhöhe. Kleinigkeiten werden entscheiden – Standards könnten den Unterschied machen.", "Beide Teams sind ähnlich stark. Wer die Zweikämpfe im Mittelfeld gewinnt, gewinnt das Spiel."]);
  const blocks: Block[] = [
    { t: "p", text: fill(intro, { opp: opp.name }) },
    { t: "kv", rows: [["Wettbewerb", competition], ["Anstoss", `${when}, ${home ? "zu Hause" : "auswärts"}`], ["Formation", opp.tactic?.formation ?? "unbekannt"], ["Stärke", `${opp.rating} (wir: ${club.rating})`], ...(pos ? [["Tabellenplatz", pos] as [string, string]] : []), ["Ausfälle", injured ? String(injured) : "keine"]] },
    ...(form.length ? [{ t: "form" as const, label: "Form", form }] : []),
    { t: "players", title: "Auf diese Spieler müssen wir achten", items: key.map((p) => ({ id: p.id, name: fullName(p), pos: p.position, value: String(p.rating), note: `${p.age} Jahre${p.stats?.goals ? ` · ${p.stats.goals} Tore` : ""}` })) },
    { t: "p", text: fill(verdict, { opp: opp.name }) },
  ];
  await send(db, career, {
    category: "match", title: `Spielvorbereitung: ${opp.name}`, sender: await staffSender(db, career, club, "coach"),
    blocks, priority: 2, kind: "preview", action: { type: "fixture", fixtureId: f.id },
  });
}

// ------------------------------------------------------------ Spielanalyse

export async function matchAnalysis(db: pg.PoolClient, career: CareerRow, f: FixtureRow, home: ClubRow, away: ClubRow, hg: number, ag: number, position: number | null, competition: string, pens?: [number, number]) {
  const club = home.id === career.club_id ? home : away;
  const userHome = home.id === club.id;
  const opp = userHome ? away : home;
  const gf = userHome ? hg : ag;
  const ga = userHome ? ag : hg;
  const rep = await one<{ data: Partial<MatchResult> & { stats?: MatchResult["stats"]; players?: MatchResult["players"] } }>(db, "select data from match_reports where fixture_id = $1", [f.id]);
  const rng = new Rng(seedFor(career.seed, "analysis", f.id));
  const res = gf > ga ? (gf - ga >= 3 ? "big_win" : "win") : gf === ga ? "draw" : ga - gf >= 3 ? "big_loss" : "loss";
  const score = `${gf}:${ga}`;
  const head: Record<string, string[]> = {
    big_win: ["Gala gegen {opp}: {score}", "Machtdemonstration – {score} gegen {opp}", "Kantersieg gegen {opp}"],
    win: ["Sieg gegen {opp} ({score})", "Drei Punkte gegen {opp}", "{score}-Erfolg gegen {opp}"],
    draw: ["Remis gegen {opp} ({score})", "Punkteteilung mit {opp}", "{score} gegen {opp}"],
    loss: ["Niederlage gegen {opp} ({score})", "{score} – keine Punkte gegen {opp}", "Rückschlag gegen {opp}"],
    big_loss: ["Debakel gegen {opp}: {score}", "Bittere {score}-Pleite gegen {opp}", "Rabenschwarzer Tag gegen {opp}"],
  };
  const sum: Record<string, string[]> = {
    big_win: ["Das war eine eindrucksvolle Leistung. Die Mannschaft hat {opp} keine Chance gelassen.", "So stelle ich mir das vor: dominant, konzentriert und eiskalt vor dem Tor."],
    win: ["Ein verdienter Sieg. Wir hatten das Spiel über weite Strecken im Griff.", "Nicht alles war glänzend, aber am Ende zählen die drei Punkte."],
    draw: ["Mit dem Punkt können wir leben, auch wenn mehr drin war.", "Ein leistungsgerechtes Unentschieden. In der Offensive fehlte die letzte Präzision."],
    loss: ["Heute hat es nicht gereicht. Wir müssen die Fehler aufarbeiten.", "Eine ärgerliche Niederlage – vor allem in den entscheidenden Momenten waren wir nicht wach genug."],
    big_loss: ["Das war deutlich zu wenig. Ich erwarte eine Reaktion der Mannschaft.", "Ein Tag zum Vergessen. Wir müssen schnell die richtigen Schlüsse ziehen."],
  };
  const blocks: Block[] = [
    { t: "p", text: `${competition}: ${home.name} – ${away.name} ${hg}:${ag}${pens ? ` (${pens[0]}:${pens[1]} i. E.)` : ""}.${position ? ` ${club.name} steht jetzt auf Platz ${position}.` : ""}` },
    { t: "p", text: fill(pick(rng, sum[res]), { opp: opp.name }) },
  ];
  const st = rep?.data?.stats;
  if (st) {
    const [h, a] = st;
    const total = Math.max(1, h.possession + a.possession);
    const pct = (x: { passesOk: number; passes: number }) => Math.round((x.passesOk / Math.max(1, x.passes)) * 100);
    blocks.push({
      t: "stats", home: home.name, away: away.name, rows: [
        { label: "Ballbesitz", home: `${Math.round((h.possession / total) * 100)} %`, away: `${Math.round((a.possession / total) * 100)} %`, hn: h.possession, an: a.possession },
        { label: "Schüsse (aufs Tor)", home: `${h.shots} (${h.onTarget})`, away: `${a.shots} (${a.onTarget})`, hn: h.shots, an: a.shots },
        { label: "Erwartete Tore", home: h.xg.toFixed(2), away: a.xg.toFixed(2), hn: h.xg, an: a.xg },
        { label: "Passquote", home: `${pct(h)} %`, away: `${pct(a)} %`, hn: pct(h), an: pct(a) },
      ],
    });
  }
  const lines = (rep?.data?.players ?? []).filter((p) => p.side === (userHome ? 0 : 1) && p.minutes >= 30).sort((x, y) => y.rating - x.rating);
  if (lines.length) {
    const best = lines[0];
    const worst = lines[lines.length - 1];
    const items = [{ id: best.playerId, name: best.name, pos: "Bester Spieler", value: best.rating.toFixed(1), note: best.goals ? `${best.goals} Tor${best.goals > 1 ? "e" : ""}` : undefined }];
    if (res === "loss" || res === "big_loss" || res === "draw") items.push({ id: worst.playerId, name: worst.name, pos: "Schwächste Note", value: worst.rating.toFixed(1), note: undefined });
    blocks.push({ t: "players", title: "Einzelkritik", items });
  }
  await send(db, career, {
    category: "match", title: fill(pick(rng, head[res]), { opp: opp.name, score }), sender: await staffSender(db, career, club, "coach"),
    blocks, priority: res === "big_loss" || res === "big_win" ? 2 : 1, kind: "analysis", action: { type: "fixture", fixtureId: f.id },
  });

  // Fans melden sich nach besonderen Ergebnissen
  if (res === "big_win" || res === "big_loss") {
    const q = res === "big_win"
      ? pick(rng, ["Was für ein Abend! So feiern wir unsere Mannschaft gerne – weiter so!", "Gänsehaut pur. Die Kurve hat gebebt, danke an das ganze Team!", "Genau dafür fahren wir jedes Wochenende durchs Land. Großartig!"])
      : pick(rng, ["So geht das nicht weiter. Wir erwarten Einsatz und Leidenschaft für dieses Wappen!", "Eine Blamage. Die Mannschaft schuldet uns eine Reaktion.", "Wir stehen hinter dem Team – aber so eine Leistung dürfen wir nicht hinnehmen."]);
    await send(db, career, {
      category: "club", title: res === "big_win" ? `Fans begeistert nach dem ${score}` : `Fans enttäuscht nach dem ${score}`, sender: fansSender(club),
      blocks: [{ t: "quote", text: q, by: `Fanclub ${club.city}` }, { t: "p", text: res === "big_win" ? "Die Stimmung im Umfeld ist ausgezeichnet." : "Im Umfeld wächst der Unmut. Ein Fan-Kontakt unter Verein & Fans könnte die Wogen glätten." }],
      priority: 1, kind: "fans", action: { type: "club" },
    });
  }
}

// ------------------------------------------------------------ Meilensteine

const APPS_MILESTONES = [50, 100, 150, 200, 250, 300, 400, 500];
const GOAL_MILESTONES = [10, 15, 20, 25, 30, 40];

export async function milestones(db: pg.PoolClient, career: CareerRow, club: ClubRow, squad: Player[], lines: { playerId: number; goals: number; minutes: number }[]) {
  const played = new Map(lines.map((l) => [l.playerId, l]));
  for (const p of squad) {
    const l = played.get(p.id);
    if (!l) continue;
    const career_apps = (p.history ?? []).reduce((s, h) => s + h.apps, 0) + p.stats.apps;
    const hitApps = APPS_MILESTONES.find((m) => career_apps === m);
    const goals = p.stats.goals;
    const hitGoals = l.goals > 0 ? GOAL_MILESTONES.find((m) => goals >= m && goals - l.goals < m) : undefined;
    const firstGoal = l.goals > 0 && goals === l.goals && (p.history ?? []).every((h) => h.goals === 0);
    if (!hitApps && !hitGoals && !firstGoal) continue;
    const title = firstGoal ? `Erstes Profitor für ${fullName(p)}` : hitGoals ? `${fullName(p)} erzielt sein ${hitGoals}. Saisontor` : `${hitApps}. Pflichtspiel für ${fullName(p)}`;
    const text = firstGoal
      ? `${fullName(p)} hat sein erstes Tor im Profifussball erzielt – ein besonderer Moment für den ${p.age}-Jährigen.`
      : hitGoals
        ? `Mit seinem Treffer steht ${fullName(p)} jetzt bei ${goals} Saisontoren. Eine starke Quote.`
        : `${fullName(p)} hat sein ${hitApps}. Pflichtspiel als Profi bestritten. Glückwunsch zu diesem Meilenstein!`;
    await send(db, career, {
      category: "news", title, sender: clubSender(club, "Medienabteilung"),
      blocks: [{ t: "p", text }, { t: "kv", rows: [["Einsätze (Karriere)", String(career_apps)], ["Tore diese Saison", String(goals)], ["Alter", `${p.age} Jahre`]] }],
      priority: 0, kind: "milestone", action: { type: "player", playerId: p.id },
    });
    p.morale = Math.min(100, p.morale + 3);
  }
}

// ------------------------------------------------------------ Täglich

export async function newsDaily(db: pg.PoolClient, career: CareerRow, squad: Player[], ctx: { type: string; nextMatchDay: number | null }) {
  if (!career.club_id) return;
  const club = (await getClub(db, career.id, career.club_id))!;
  const date = dateOf(career.season, career.day);
  const doy = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000);

  // Geburtstage (Tag aus der Spieler-ID abgeleitet)
  for (const p of squad) {
    if (hashString(`bday|${p.id}`) % 365 !== doy) continue;
    const rng = new Rng(seedFor(career.seed, "bday", p.id, career.season));
    await send(db, career, {
      category: "news", title: `${fullName(p)} hat Geburtstag`, sender: clubSender(club, "Medienabteilung"),
      blocks: [{ t: "p", text: pick(rng, [`Heute feiert ${fullName(p)} Geburtstag. Die Mannschaft hat ihm vor dem Training ein Ständchen gesungen.`, `Alles Gute! ${fullName(p)} feiert heute Geburtstag – in der Kabine gab es Kuchen für alle.`, `${fullName(p)} hat heute Geburtstag. Der Verein gratuliert herzlich!`]) }],
      priority: 0, kind: "birthday", action: { type: "player", playerId: p.id },
    });
    p.morale = Math.min(100, p.morale + 2);
  }

  // Tag vor dem Spiel: Belastungswarnung der Physios
  if (ctx.nextMatchDay !== null && ctx.nextMatchDay - career.day === 1 && club.tactic) {
    const xi = new Set(club.tactic.lineup.filter((x): x is number => x !== null));
    const tired = squad.filter((p) => xi.has(p.id) && p.injuryWeeks === 0 && p.fitness < 72).sort((a, b) => a.fitness - b.fitness);
    if (tired.length >= 2 && !(await recently(db, career, "fatigue", 12))) {
      await send(db, career, {
        category: "medical", title: `Belastung: ${tired.length} Stammspieler angeschlagen`, sender: await staffSender(db, career, club, "physio"),
        blocks: [
          { t: "p", text: "Einige Spieler der geplanten Startelf sind nicht bei voller Kraft. Ein Einsatz von Beginn an erhöht das Verletzungsrisiko." },
          { t: "players", title: "Kondition", items: tired.slice(0, 5).map((p) => ({ id: p.id, name: fullName(p), pos: p.position, value: `${Math.round(p.fitness)} %` })) },
          { t: "p", text: "Mein Rat: rotieren oder die Spieler früh auswechseln." },
        ],
        priority: 2, kind: "fatigue", action: { type: "tactic" },
      });
    }
  }

  // Monatsanfang: Gespräch mit dem Vorstand und Berateranfrage
  if (date.getUTCDate() === 1 && career.week > 0) {
    await boardFeedback(db, career, club, date);
    await agentContact(db, career, club, squad);
  }
}

async function boardFeedback(db: pg.PoolClient, career: CareerRow, club: ClubRow, date: Date) {
  const league = await getLeague(db, career.id, club.league_id);
  if (!league) return;
  const { table } = await leagueTable(db, career, league.id);
  const pos = table.findIndex((r) => r.clubId === club.id) + 1;
  if (pos <= 0 || !table[pos - 1].played) return;
  const target = career.board.targetPosition;
  const conf = career.board.confidence;
  const rng = new Rng(seedFor(career.seed, "board", career.season, career.day));
  const mood = pos <= target ? "good" : pos <= target + 3 ? "ok" : "bad";
  const text = {
    good: ["Der Vorstand ist mit der Entwicklung sehr zufrieden. Machen Sie weiter so.", "Wir liegen im Soll – das Präsidium spricht Ihnen ausdrücklich sein Vertrauen aus."],
    ok: ["Wir liegen knapp hinter den Erwartungen. Der Vorstand ist geduldig, erwartet aber eine Steigerung.", "Noch ist nichts verloren, doch wir wollen bald wieder auf Kurs sein."],
    bad: ["Die Ergebnisse entsprechen nicht unseren Ansprüchen. Der Vorstand erwartet zeitnah eine klare Verbesserung.", "Ich mache keinen Hehl daraus: Wir sind besorgt. Die nächsten Wochen werden entscheidend."],
  }[mood];
  await send(db, career, {
    category: "board", title: `Monatsgespräch mit dem Vorstand (${MONTHS[date.getUTCMonth()]})`, sender: presidentSender(career, club),
    blocks: [
      { t: "p", text: pick(rng, text) },
      { t: "kv", rows: [["Saisonziel", career.board.objective], ["Aktueller Platz", `${pos}. (Ziel: ${target}.)`], ["Kontostand", formatMoney(club.balance)], ["Vertrauen", `${conf}/100`]] },
    ],
    priority: mood === "bad" ? 2 : 1, kind: "board_monthly",
  });
}

async function agentContact(db: pg.PoolClient, career: CareerRow, club: ClubRow, squad: Player[]) {
  const top = [...squad].sort((a, b) => b.rating - a.rating).slice(0, 14);
  const p = top.find((x) => x.contract && x.contract.untilSeason <= career.season && !x.loan);
  if (!p || (await recently(db, career, `agent_${p.id}`, 400))) return;
  const agency = `${personName(career.seed, p.nationality, "agent", p.id).split(" ")[1]} Sports Management`;
  const rng = new Rng(seedFor(career.seed, "agent", p.id, career.day));
  const happy = p.morale >= 55;
  await send(db, career, {
    category: "contract", title: `Berater von ${fullName(p)} meldet sich`,
    sender: { name: personName(career.seed, p.nationality, "agentname", p.id), role: `Spielerberater, ${agency}`, kind: "agent", playerId: p.id },
    blocks: [
      { t: "p", text: happy
        ? pick(rng, [`Mein Klient fühlt sich bei ${club.name} wohl und wäre offen für Gespräche über eine Verlängerung.`, `${p.firstName} möchte gerne bleiben. Lassen Sie uns zeitnah über einen neuen Vertrag sprechen.`])
        : pick(rng, [`Mein Klient prüft seine Optionen. Es gibt Interesse anderer Vereine – wir sollten bald reden.`, `Ohne neues Angebot wird ${p.firstName} den Verein im Sommer ablösefrei verlassen.`]) },
      { t: "kv", rows: [["Spieler", `${fullName(p)} (${p.position}, ${p.age})`], ["Vertrag bis", `Sommer ${p.contract!.untilSeason + 1}`], ["Gehalt", `${formatMoney(p.contract!.wage)} / Woche`], ["Stimmung", happy ? "zufrieden" : "unentschlossen"]] },
    ],
    priority: 2, kind: `agent_${p.id}`, action: { type: "player", playerId: p.id },
  });
}

// ------------------------------------------------------------ Wöchentlich

export async function newsWeekly(db: pg.PoolClient, career: CareerRow, week: number) {
  if (!career.club_id) return;
  const club = (await getClub(db, career.id, career.club_id))!;
  const rng = new Rng(seedFor(career.seed, "news-week", career.season, week));
  const squad = await getPlayers(db, career.id, [club.id]);

  // Medien: Gerücht über einen unserer Leistungsträger
  if (rng.chance(0.3)) {
    const star = rng.pick([...squad].sort((a, b) => b.rating - a.rating).slice(0, 4));
    const suitors = await query<{ id: number; name: string; colors: { primary: string; secondary: string } }>(db,
      "select id, name, colors from clubs where career_id = $1 and reputation > $2 and id <> $3 order by random() limit 1", [career.id, club.reputation + 4, club.id]);
    const s = suitors[0];
    if (star && s) {
      const sender = mediaSender(career, club, `rumour-${week}`);
      await send(db, career, {
        category: "news", title: pick(rng, [`Gerücht: ${s.name} beobachtet ${fullName(star)}`, `${s.name} an ${fullName(star)} interessiert?`, `Medien: ${fullName(star)} auf dem Zettel von ${s.name}`]), sender,
        blocks: [
          { t: "p", text: pick(rng, [`Nach unseren Informationen haben Scouts von ${s.name} zuletzt mehrere Spiele von ${club.name} besucht – im Fokus: ${fullName(star)}.`, `Aus dem Umfeld von ${s.name} ist zu hören, dass man ${fullName(star)} als mögliche Verstärkung für den Sommer sieht.`]) },
          { t: "quote", text: pick(rng, ["Der Spieler hat sich in den letzten Monaten enorm entwickelt. Dass größere Vereine aufmerksam werden, ist logisch.", "Noch ist nichts konkret, aber man sollte das im Auge behalten."]), by: "Ein Insider" },
          { t: "players", items: [{ id: star.id, name: fullName(star), pos: star.position, value: String(star.rating), note: `${star.age} Jahre · Marktwert ${formatMoney(star.value)}` }] },
        ],
        priority: 1, kind: "rumour", action: { type: "player", playerId: star.id },
      });
    }
  }

  // Medien: Druck auf den Trainer
  if (career.board.confidence < 32 && career.week >= 6 && !(await recently(db, career, "pressure", 21))) {
    const sender = mediaSender(career, club, `pressure-${week}`);
    await send(db, career, {
      category: "news", title: pick(rng, [`Wackelt der Stuhl von ${career.manager_name}?`, `${club.name}: Trainer unter Druck`, `Krisenstimmung bei ${club.name}`]), sender,
      blocks: [
        { t: "p", text: `Die Ergebnisse bei ${club.name} bleiben hinter den Erwartungen zurück. Im Umfeld wird bereits über Alternativen auf der Trainerbank diskutiert.` },
        { t: "quote", text: pick(rng, ["Wir stehen hinter dem Trainer – aber es muss jetzt etwas passieren.", "Am Ende des Tages zählen Ergebnisse. Das weiß jeder in diesem Geschäft."]), by: "Ein Vorstandsmitglied" },
      ],
      priority: 2, kind: "pressure",
    });
  }

  // Scout-Empfehlung: Talent zu einem bezahlbaren Preis
  if (rng.chance(0.25) && club.transfer_budget > 0) {
    const avg = squad.length ? squad.reduce((s, p) => s + p.rating, 0) / squad.length : 60;
    const cands = await query<{ data: Player }>(db,
      `select data from players where career_id = $1 and (club_id is null or club_id <> $2) and age <= 21 and potential >= $3 and value <= $4
        order by potential desc, random() limit 1`, [career.id, club.id, Math.round(avg + 6), club.transfer_budget]);
    const t = cands[0]?.data;
    if (t) {
      const owner = t.clubId ? await getClub(db, career.id, t.clubId) : null;
      await send(db, career, {
        category: "scout", title: `Scout-Tipp: ${t.firstName} ${t.lastName}`, sender: await staffSender(db, career, club, "scout"),
        blocks: [
          { t: "p", text: pick(rng, ["Bei meinen Reisen ist mir ein Talent aufgefallen, das gut zu uns passen würde.", "Ich möchte dir einen jungen Spieler ans Herz legen – er könnte in zwei, drei Jahren ein Leistungsträger sein."]) },
          { t: "players", items: [{ id: t.id, name: `${t.firstName} ${t.lastName}`, pos: t.position, value: `Potenzial hoch`, note: `${t.age} Jahre · ${owner?.name ?? "vereinslos"} · ${formatMoney(t.value)}` }] },
          { t: "p", text: "Eine genaue Beobachtung kannst du in der Scouting-Zentrale in Auftrag geben." },
        ],
        priority: 1, kind: "scout_tip", action: { type: "player", playerId: t.id },
      });
    }
  }

  // Liga: alle vier Runden Zwischenstand mit Torjägern
  if (week % 4 === 0) {
    const league = await getLeague(db, career.id, club.league_id);
    if (league) {
      const { table, clubs } = await leagueTable(db, career, league.id);
      if (table.length && table[0].played >= 3) {
        const scorers = await query<{ data: Player }>(db,
          `select data from players where career_id = $1 and club_id = any($2::int[]) order by (data->'stats'->>'goals')::int desc nulls last limit 3`, [career.id, [...clubs.keys()]]);
        const own = table.findIndex((r) => r.clubId === club.id) + 1;
        await send(db, career, {
          category: "news", title: `${league.name}: Zwischenstand nach ${table[0].played} Spieltagen`, sender: { name: league.name, role: "Ligaverband", kind: "league" },
          blocks: [
            { t: "kv", rows: table.slice(0, 3).map((r, i) => [`${i + 1}. ${clubs.get(r.clubId)?.name ?? "?"}`, `${r.points} Pkt.`] as [string, string]).concat(own > 3 ? [[`${own}. ${club.name}`, `${table[own - 1].points} Pkt.`]] : []) },
            { t: "players", title: "Torjägerliste", items: scorers.map(({ data: p }) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, pos: clubs.get(p.clubId ?? -1)?.short_name ?? p.position, value: `${p.stats.goals} Tore` })) },
          ],
          priority: 0, kind: "league_table",
        });
      }
    }
  }
}

export { playerSender };
