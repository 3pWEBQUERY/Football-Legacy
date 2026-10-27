/**
 * Sponsorenverträge des eigenen Vereins. Zu jedem Saisonstart (oder wenn der
 * Vertrag ausläuft) gibt es drei Angebote:
 * - Festvertrag: voller Betrag, ein Jahr
 * - Leistungsvertrag: weniger fix, dafür Prämie je Sieg und für Titel
 * - Partnerschaft: etwas weniger, aber drei Jahre festgeschrieben – sichert
 *   gegen Abstiege ab, bremst nach Aufstiegen
 * Wer nicht wählt, bekommt nach drei Wochen den Festvertrag.
 */
import { Rng, formatMoney, seedFor } from "@fl/sim";
import { withCareer } from "./career";
import { query, type Db } from "./db";
import { GameError } from "./errors";
import { type CareerRow, type ClubRow, addFinance, addInbox, getClub } from "./repo";

export type SponsorKind = "fixed" | "performance" | "long";
export interface SponsorOffer { kind: SponsorKind; partner: string; weekly: number; winBonus: number; titleBonus: number; years: number }
export interface SponsorDeal extends SponsorOffer { untilSeason: number; signedSeason: number; earnedBonus: number }
export interface SponsorState { clubId: number; deal: SponsorDeal | null; offers: { season: number; day: number; items: SponsorOffer[] } | null }

export const SPONSOR_LABEL: Record<SponsorKind, { title: string; text: string }> = {
  fixed: { title: "Festvertrag", text: "Voller Betrag, garantiert – für eine Saison." },
  performance: { title: "Leistungsvertrag", text: "Weniger fix, dafür eine Prämie für jeden Sieg und für Titel." },
  long: { title: "Partnerschaft", text: "Etwas weniger, aber drei Saisons festgeschrieben – auch nach einem Abstieg." },
};

const PARTNERS = [
  "Nordwerk Energie", "Alpina Versicherung", "Brauerei Kesselring", "TechNova", "Sportwelt24", "Merkur Bank", "Autohaus Brandner", "Helvetia Logistik",
  "Bergquell Mineralwasser", "Lumen Telekom", "Falkner Bau", "Sonnhalde Immobilien", "Rheintal Möbel", "Pixelwerk Games", "Grünland Bio", "Atlas Reisen",
];
/** Tage, bis automatisch der Festvertrag gilt. */
const DECISION_DAYS = 21;
const round = (v: number) => Math.round(v / 500) * 500;

export async function getSponsor(db: Db, career: CareerRow, clubId: number): Promise<SponsorState> {
  const rows = await query<{ sponsor: SponsorState | null }>(db, "select sponsor from careers where id = $1", [career.id]);
  const s = rows[0]?.sponsor;
  return s && s.clubId === clubId ? s : { clubId, deal: null, offers: null };
}

async function saveSponsor(db: Db, career: CareerRow, s: SponsorState) {
  await query(db, "update careers set sponsor = $2 where id = $1", [career.id, JSON.stringify(s)]);
}

export function makeOffers(career: CareerRow, club: ClubRow): SponsorOffer[] {
  const base = club.finance?.sponsorWeekly ?? 20_000;
  const rng = new Rng(seedFor(career.seed, "sponsor", club.id, career.season));
  const names = rng.shuffle([...PARTNERS]);
  const mood = rng.range(0.95, 1.08);
  return [
    { kind: "fixed", partner: names[0], weekly: round(base * mood), winBonus: 0, titleBonus: 0, years: 1 },
    { kind: "performance", partner: names[1], weekly: round(base * 0.7 * mood), winBonus: round(base * 1.4), titleBonus: round(base * 10), years: 1 },
    { kind: "long", partner: names[2], weekly: round(base * 0.93 * mood), winBonus: 0, titleBonus: round(base * 3), years: 3 },
  ];
}

const active = (s: SponsorState, season: number) => !!s.deal && s.deal.untilSeason >= season;

/** Wöchentlicher Sponsorenbetrag des eigenen Vereins (null = Finanzprofil). */
export function sponsorWeekly(s: SponsorState | null, season: number): number | null {
  return s && active(s, season) ? s.deal!.weekly : null;
}

function sign(s: SponsorState, offer: SponsorOffer, season: number) {
  s.deal = { ...offer, signedSeason: season, untilSeason: season + offer.years - 1, earnedBonus: 0 };
  s.offers = null;
}

/** Täglich: Angebote zum Saisonstart, nach drei Wochen ohne Wahl gilt der Festvertrag. */
export async function sponsorDaily(db: Db, career: CareerRow): Promise<string[]> {
  if (!career.club_id) return [];
  const club = await getClub(db, career.id, career.club_id);
  if (!club?.finance) return [];
  const s = await getSponsor(db, career, club.id);
  if (active(s, career.season)) return [];
  if (!s.offers || s.offers.season !== career.season) {
    s.offers = { season: career.season, day: career.day, items: makeOffers(career, club) };
    await saveSponsor(db, career, s);
    await addInbox(db, career.id, career.season, career.week, "finance", "Sponsorenangebote liegen vor",
      `Drei Unternehmen wollen ${club.name} als Hauptsponsor unterstützen:\n` +
        s.offers.items.map((o) => `• ${o.partner} – ${SPONSOR_LABEL[o.kind].title}: ${formatMoney(o.weekly)}/Woche` +
          (o.winBonus ? ` + ${formatMoney(o.winBonus)} je Sieg` : "") + (o.years > 1 ? ` · ${o.years} Saisons` : "")).join("\n") +
        `\n\nEntscheide dich unter Büro → Verein & Fans. Ohne Entscheidung gilt in ${DECISION_DAYS} Tagen der Festvertrag.`,
      { type: "page", path: "/verein", label: "Zu den Sponsoren" });
    return ["Sponsorenangebote"];
  }
  if (career.day - s.offers.day >= DECISION_DAYS) {
    const offer = s.offers.items.find((o) => o.kind === "fixed")!;
    sign(s, offer, career.season);
    await saveSponsor(db, career, s);
    await addInbox(db, career.id, career.season, career.week, "finance", `Sponsor: ${offer.partner}`,
      `Weil keine Entscheidung fiel, hat der Vorstand den Festvertrag mit ${offer.partner} unterschrieben (${formatMoney(offer.weekly)}/Woche).`);
    return [`Sponsor ${offer.partner}`];
  }
  return [];
}

export async function chooseSponsor(careerId: string, accountId: string, kind: SponsorKind) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!career.club_id) throw new GameError("Kein Verein");
    const s = await getSponsor(db, career, career.club_id);
    if (active(s, career.season)) throw new GameError(`Der Vertrag mit ${s.deal!.partner} läuft noch bis ${s.deal!.untilSeason}.`);
    const offer = s.offers?.season === career.season ? s.offers.items.find((o) => o.kind === kind) : undefined;
    if (!offer) throw new GameError("Dieses Angebot liegt nicht vor.");
    sign(s, offer, career.season);
    await saveSponsor(db, career, s);
    return { message: `${offer.partner} ist neuer Hauptsponsor (${SPONSOR_LABEL[kind].title}).`, deal: s.deal };
  });
}

/** Prämien aus dem Leistungsvertrag: je Sieg, und für Meisterschaft oder Pokalsieg. */
export async function sponsorBonus(db: Db, career: CareerRow, club: ClubRow, reason: "win" | "title", label?: string): Promise<number> {
  const s = await getSponsor(db, career, club.id);
  if (!active(s, career.season)) return 0;
  const amount = reason === "win" ? s.deal!.winBonus : s.deal!.titleBonus;
  if (!amount) return 0;
  s.deal!.earnedBonus += amount;
  await saveSponsor(db, career, s);
  await addFinance(db, career.id, club.id, career.season, career.week, [{ kind: "sponsor", amount, label: label ?? `Prämie ${s.deal!.partner}` }]);
  return amount;
}

export async function sponsorView(db: Db, career: CareerRow, club: ClubRow) {
  const s = await getSponsor(db, career, club.id);
  return {
    deal: active(s, career.season) ? s.deal : null,
    offers: !active(s, career.season) && s.offers?.season === career.season ? s.offers.items : [],
    decideBy: s.offers ? s.offers.day + DECISION_DAYS : null,
    labels: SPONSOR_LABEL,
  };
}
