/** Aktionen des Nutzers: Taktik, Training, Transfers, Verträge, Scouting, Shop, Jobwechsel. */
import {
  CARD_PACK, COUNTRY_BY_CODE, FORMATIONS, ROLE_BY_ID, Rng, SKINS, askingPrice, evaluateFee, evaluateTerms, formatMoney,
  isUnlocked, renewalDemand, roundsFor, seedFor, squadRanks, transferWindow, validateTactic,
  type Formation, type Player, type Tactic, type TrainingPlan,
} from "@fl/sim";
import type pg from "pg";
import { one, query } from "./db";
import { activateClubs, activateLeague, boardObjectives, scheduleSeason, withCareer } from "./career";
import { GameError } from "./errors";
import {
  type CareerRow, type ClubRow, addFinance, addInbox, getClub, getClubs, getLeague, getLeagues, getPlayer, getPlayers,
  saveCareer, saveClubs, savePlayers,
} from "./repo";
import { type RewardNote, announceNotes, awardCard, completeMission, openPack, unlockAchievement } from "./rewards";

function requireClub(career: CareerRow): number {
  if (!career.club_id || career.status !== "active") throw new GameError("Du hast aktuell keinen Verein.");
  return career.club_id;
}

// ---------------------------------------------------------------- Taktik & Training

export async function saveTactic(careerId: string, accountId: string, input: Tactic) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    if (career.pending_match) throw new GameError("Während eines laufenden Spiels kannst du die Taktik nur in der Halbzeit ändern.");
    const club = (await getClub(db, career.id, clubId))!;
    const squad = await getPlayers(db, career.id, [clubId]);
    if (!FORMATIONS[input.formation as Formation]) throw new GameError("Unbekannte Formation");
    const ids = new Set(squad.map((p) => p.id));
    const slots = FORMATIONS[input.formation];
    const lineup = slots.map((_, i) => {
      const id = input.lineup?.[i];
      return typeof id === "number" && ids.has(id) ? id : null;
    });
    const dup = lineup.filter((x) => x !== null);
    if (new Set(dup).size !== dup.length) throw new GameError("Ein Spieler ist doppelt aufgestellt.");
    const clean: Tactic = {
      formation: input.formation,
      style: Object.fromEntries(
        Object.entries(input.style ?? {}).map(([k, v]) => [k, Math.max(0, Math.min(100, Math.round(Number(v) || 50)))]),
      ) as unknown as Tactic["style"],
      lineup,
      bench: (input.bench ?? []).filter((id) => ids.has(id) && !lineup.includes(id)).slice(0, 9),
      roles: slots.map((s, i) => (ROLE_BY_ID[input.roles?.[i]]?.positions.includes(s.position) ? input.roles[i] : "")),
      slotOffsets: (input.slotOffsets ?? []).slice(0, 11).map((o) =>
        o && typeof o.x === "number" && typeof o.y === "number" ? { x: Math.max(0.02, Math.min(0.95, o.x)), y: Math.max(0.03, Math.min(0.97, o.y)) } : null,
      ),
      setPieces: {
        corners: ["near", "far", "short"].includes(input.setPieces?.corners) ? input.setPieces.corners : "far",
        cornerTaker: ids.has(input.setPieces?.cornerTaker ?? -1) ? input.setPieces.cornerTaker : null,
        freeKickTaker: ids.has(input.setPieces?.freeKickTaker ?? -1) ? input.setPieces.freeKickTaker : null,
        penaltyTaker: ids.has(input.setPieces?.penaltyTaker ?? -1) ? input.setPieces.penaltyTaker : null,
      },
    };
    for (const k of ["tempo", "passLength", "width", "risk", "pressing", "defensiveLine", "hardness"] as const) {
      if (typeof clean.style[k] !== "number") clean.style[k] = 50;
    }
    club.tactic = clean;
    await saveClubs(db, career.id, [club]);
    const notes: RewardNote[] = [];
    completeMission(career, "set_tactic", notes);
    await saveCareer(db, career);
    return { tactic: validateTactic(clean, squad), notes };
  });
}

export async function setTraining(careerId: string, accountId: string, plan: TrainingPlan) {
  return withCareer(careerId, accountId, async (db, career) => {
    const focuses = ["balanced", "attack", "defense", "physical", "technical", "mental", "recovery"];
    const intensities = ["low", "normal", "high"];
    career.training = {
      focus: focuses.includes(plan.focus) ? plan.focus : "balanced",
      intensity: intensities.includes(plan.intensity) ? plan.intensity : "normal",
      youthFocus: !!plan.youthFocus,
    };
    await saveCareer(db, career);
    return career.training;
  });
}

export async function setAutoSubs(careerId: string, accountId: string, autoSubs: boolean) {
  return withCareer(careerId, accountId, async (db, career) => {
    career.manager.autoSubs = autoSubs;
    await saveCareer(db, career);
    return { autoSubs };
  });
}

// ---------------------------------------------------------------- Transfers

async function sellerContextFor(db: pg.PoolClient, career: CareerRow, p: Player) {
  const squad = p.clubId !== null ? await getPlayers(db, career.id, [p.clubId]) : [];
  const club = p.clubId !== null ? await getClub(db, career.id, p.clubId) : null;
  return {
    ctx: {
      season: career.season,
      squadRank: squadRanks(squad).get(p.id) ?? 30,
      squadSize: squad.length,
      sellerReputation: club?.reputation ?? 30,
      isUserClub: false,
    },
    club,
  };
}

export interface OfferInput {
  playerId: number;
  fee: number;
  wage: number;
  years: number;
  releaseClause?: number | null;
}

export type OfferOutcome =
  | { status: "completed"; message: string; notes: RewardNote[] }
  | { status: "countered"; message: string; counterFee?: number; counterWage?: number }
  | { status: "rejected"; message: string };

export async function makeOffer(careerId: string, accountId: string, input: OfferInput): Promise<OfferOutcome> {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    const p = await getPlayer(db, career.id, input.playerId);
    if (!p) throw new GameError("Spieler nicht gefunden", 404);
    if (p.clubId === clubId) throw new GameError("Der Spieler gehört bereits zu deinem Verein.");
    if (p.loan) throw new GameError("Der Spieler ist ausgeliehen und steht erst nach der Saison zur Verfügung.");
    const window = transferWindow(career.week, career.season_weeks);
    if (p.clubId !== null && !window.open) throw new GameError("Das Transferfenster ist geschlossen. Vereinslose Spieler kannst du jederzeit verpflichten.");
    const buyer = (await getClub(db, career.id, clubId))!;
    const fee = Math.max(0, Math.round(input.fee || 0));
    const wage = Math.max(0, Math.round(input.wage || 0));
    const years = Math.max(1, Math.min(5, Math.round(input.years || 3)));
    if (fee > buyer.transfer_budget) throw new GameError(`Die Ablöse übersteigt dein Transferbudget (${formatMoney(buyer.transfer_budget)}).`);
    const squad = await getPlayers(db, career.id, [clubId]);
    if (squad.length >= 32) throw new GameError("Dein Kader ist voll (max. 32 Spieler). Gib zuerst Spieler ab.");

    // Geduld des Vereins: nach drei gescheiterten Angeboten wird abgebrochen
    const tries = await one<{ n: number }>(
      db, "select count(*)::int as n from transfers where career_id = $1 and player_id = $2 and season = $3 and kind = 'buy' and status in ('rejected','countered')",
      [career.id, p.id, career.season],
    );
    if ((tries?.n ?? 0) >= 4) return { status: "rejected", message: "Der Verein hat die Verhandlungen abgebrochen." };

    const rng = new Rng(seedFor(career.seed, "offer", p.id, career.season, career.week, tries?.n ?? 0));
    const record = async (status: string, message: string, counterFee: number | null = null, counterWage: number | null = null) => {
      await query(
        db,
        `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, counter_fee, counter_wage, message, season, week)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'buy',$9,$10,$11,$12,$13,$14)`,
        [career.id, p.id, `${p.firstName} ${p.lastName}`, p.clubId, clubId, fee, wage, years, status, counterFee, counterWage, message, career.season, career.week],
      );
    };

    let seller: ClubRow | null = null;
    if (p.clubId !== null) {
      const { ctx, club } = await sellerContextFor(db, career, p);
      seller = club;
      const verdict = evaluateFee(p, fee, ctx, rng);
      if (verdict.kind === "reject") {
        await record("rejected", verdict.message);
        return { status: "rejected", message: verdict.message };
      }
      if (verdict.kind === "counter") {
        await record("countered", verdict.message, verdict.fee);
        return { status: "countered", message: `${verdict.message} Gegenangebot: ${formatMoney(verdict.fee)}.`, counterFee: verdict.fee };
      }
    }
    const terms = evaluateTerms(p, { wage, years, releaseClause: input.releaseClause ?? null }, buyer.reputation, seller?.reputation ?? Math.max(1, buyer.reputation - 20), rng);
    if (terms.kind === "reject") {
      await record("rejected", terms.message);
      return { status: "rejected", message: terms.message };
    }
    if (terms.kind === "counter") {
      await record("countered", terms.message, null, terms.wage);
      return { status: "countered", message: terms.message, counterWage: terms.wage };
    }

    // Abschluss
    if (seller) {
      seller.balance += fee;
      seller.transfer_budget += Math.round(fee * 0.6);
    }
    buyer.balance -= fee;
    buyer.transfer_budget -= fee;
    await saveClubs(db, career.id, seller ? [buyer, seller] : [buyer]);
    if (seller?.tactic) {
      seller.tactic.lineup = seller.tactic.lineup.map((id) => (id === p.id ? null : id));
      seller.tactic.bench = seller.tactic.bench.filter((id) => id !== p.id);
      await saveClubs(db, career.id, [seller]);
    }
    p.clubId = clubId;
    p.listed = false;
    p.contract = { wage, untilSeason: career.season + years - 1, releaseClause: input.releaseClause ?? null, goalBonus: 0 };
    p.morale = 80;
    await savePlayers(db, career.id, [p]);
    if (fee > 0) await addFinance(db, career.id, clubId, career.season, career.week, [{ kind: "transfer_out", amount: -fee, label: `Ablöse ${p.firstName} ${p.lastName}` }]);
    await record("completed", "Transfer abgeschlossen");
    const notes: RewardNote[] = [];
    career.manager.totals.signings++;
    unlockAchievement(career, "first_signing", notes);
    if (fee >= 10_000_000) unlockAchievement(career, "big_signing", notes);
    completeMission(career, "sign_player", notes);
    awardCard(career, p, "Verpflichtung", notes);
    await saveCareer(db, career);
    await addInbox(db, career.id, career.season, career.week, "transfer", `${p.firstName} ${p.lastName} unterschreibt!`,
      `${p.firstName} ${p.lastName} wechselt ${seller ? `von ${seller.name} ` : ""}zu ${buyer.name}${fee ? ` (Ablöse ${formatMoney(fee)})` : " (ablösefrei)"}. Gehalt: ${formatMoney(wage)} pro Woche, Vertrag bis ${career.season + years - 1}.`);
    await announceNotes(db, career, notes);
    return { status: "completed", message: `${p.firstName} ${p.lastName} ist verpflichtet!`, notes };
  });
}

/** Auf ein KI-Angebot für einen eigenen Spieler reagieren. */
export async function respondToOffer(careerId: string, accountId: string, transferId: number, decision: "accept" | "reject" | "counter", counterFee?: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    const t = await one<{ id: number; player_id: number; to_club: number; fee: number; status: string }>(
      db, "select * from transfers where career_id = $1 and id = $2 and kind = 'offer_in'", [career.id, transferId],
    );
    if (!t || t.status !== "pending") throw new GameError("Dieses Angebot ist nicht mehr gültig.");
    if (decision === "reject") {
      await query(db, "update transfers set status = 'rejected' where id = $1", [t.id]);
      return { status: "rejected", message: "Angebot abgelehnt." };
    }
    const buyer = (await getClub(db, career.id, t.to_club))!;
    let fee = t.fee;
    if (decision === "counter") {
      const ask = Math.round(counterFee ?? 0);
      const rng = new Rng(seedFor(career.seed, "counter", t.id));
      const p0 = await getPlayer(db, career.id, t.player_id);
      if (!p0) throw new GameError("Spieler nicht gefunden");
      const maxPay = Math.min(buyer.transfer_budget, p0.value * rng.range(1.15, 1.6));
      if (ask > maxPay) {
        await query(db, "update transfers set status = 'rejected', message = $2 where id = $1", [t.id, `${buyer.name} zieht das Angebot zurück.`]);
        return { status: "rejected", message: `${buyer.name} ist nicht bereit, so viel zu zahlen, und zieht das Angebot zurück.` };
      }
      fee = ask;
    }
    const p = await getPlayer(db, career.id, t.player_id);
    if (!p || p.clubId !== clubId) throw new GameError("Der Spieler gehört nicht mehr zu deinem Verein.");
    const seller = (await getClub(db, career.id, clubId))!;
    seller.balance += fee;
    seller.transfer_budget += Math.round(fee * 0.75);
    buyer.balance -= fee;
    buyer.transfer_budget -= fee;
    if (seller.tactic) {
      seller.tactic.lineup = seller.tactic.lineup.map((id) => (id === p.id ? null : id));
      seller.tactic.bench = seller.tactic.bench.filter((id) => id !== p.id);
    }
    await saveClubs(db, career.id, [seller, buyer]);
    p.clubId = buyer.id;
    p.listed = false;
    p.contract = { wage: Math.round((p.contract?.wage ?? 1000) * 1.2 / 100) * 100, untilSeason: career.season + 3, releaseClause: null, goalBonus: 0 };
    await savePlayers(db, career.id, [p]);
    await query(db, "update transfers set status = 'completed', fee = $2 where id = $1", [t.id, fee]);
    await addFinance(db, career.id, clubId, career.season, career.week, [{ kind: "transfer_in", amount: fee, label: `Verkauf ${p.firstName} ${p.lastName}` }]);
    return { status: "completed", message: `${p.firstName} ${p.lastName} wechselt für ${formatMoney(fee)} zu ${buyer.name}.` };
  });
}

export async function toggleTransferList(careerId: string, accountId: string, playerId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    const p = await getPlayer(db, career.id, playerId);
    if (!p || p.clubId !== clubId) throw new GameError("Spieler nicht in deinem Kader.");
    if (p.loan) throw new GameError("Leihspieler kannst du nicht auf die Transferliste setzen.");
    p.listed = !p.listed;
    if (p.listed) p.morale = Math.max(5, p.morale - 10);
    await savePlayers(db, career.id, [p]);
    return { listed: p.listed };
  });
}

/** Vertrag auflösen: 50 % der Restgehälter als Abfindung. */
export async function releasePlayer(careerId: string, accountId: string, playerId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    const p = await getPlayer(db, career.id, playerId);
    if (!p || p.clubId !== clubId) throw new GameError("Spieler nicht in deinem Kader.");
    if (p.loan) throw new GameError("Leihspieler kannst du nicht entlassen.");
    const squad = await getPlayers(db, career.id, [clubId]);
    if (squad.length <= 16) throw new GameError("Du brauchst mindestens 16 Spieler im Kader.");
    const weeksLeft = ((p.contract?.untilSeason ?? career.season) - career.season) * career.season_weeks + (career.season_weeks - career.week);
    const compensation = Math.round(((p.contract?.wage ?? 0) * weeksLeft * 0.5) / 1000) * 1000;
    const club = (await getClub(db, career.id, clubId))!;
    club.balance -= compensation;
    if (club.tactic) {
      club.tactic.lineup = club.tactic.lineup.map((id) => (id === p.id ? null : id));
      club.tactic.bench = club.tactic.bench.filter((id) => id !== p.id);
    }
    await saveClubs(db, career.id, [club]);
    p.clubId = null;
    p.contract = null;
    p.listed = false;
    await savePlayers(db, career.id, [p]);
    if (compensation) await addFinance(db, career.id, clubId, career.season, career.week, [{ kind: "other", amount: -compensation, label: `Abfindung ${p.firstName} ${p.lastName}` }]);
    return { compensation };
  });
}

export async function contractDemand(careerId: string, accountId: string, playerId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    const p = await getPlayer(db, career.id, playerId);
    if (!p || p.clubId !== clubId) throw new GameError("Spieler nicht in deinem Kader.");
    const club = (await getClub(db, career.id, clubId))!;
    const squad = await getPlayers(db, career.id, [clubId]);
    return renewalDemand(p, club.reputation, squadRanks(squad).get(p.id) ?? 20);
  });
}

export async function renewContract(careerId: string, accountId: string, playerId: number, wage: number, years: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    const p = await getPlayer(db, career.id, playerId);
    if (!p || p.clubId !== clubId) throw new GameError("Spieler nicht in deinem Kader.");
    if (p.loan) throw new GameError("Den Vertrag eines Leihspielers verlängert sein Stammverein.");
    const club = (await getClub(db, career.id, clubId))!;
    const squad = await getPlayers(db, career.id, [clubId]);
    const demand = renewalDemand(p, club.reputation, squadRanks(squad).get(p.id) ?? 20);
    const y = Math.max(1, Math.min(5, Math.round(years)));
    if (p.age >= 33 && y > 2) return { status: "rejected", message: `${p.lastName} möchte sich nur noch kurzfristig binden.` };
    if (wage < demand.wage * 0.95) {
      p.morale = Math.max(5, p.morale - 3);
      await savePlayers(db, career.id, [p]);
      return { status: "countered", message: `${p.lastName} verlangt mindestens ${formatMoney(demand.wage)} pro Woche.`, counterWage: demand.wage };
    }
    p.contract = { wage: Math.round(wage), untilSeason: career.season + y, releaseClause: p.contract?.releaseClause ?? null, goalBonus: p.contract?.goalBonus ?? 0 };
    p.morale = Math.min(100, p.morale + 8);
    await savePlayers(db, career.id, [p]);
    const notes: RewardNote[] = [];
    completeMission(career, "renew_contract", notes);
    await saveCareer(db, career);
    return { status: "completed", message: `${p.firstName} ${p.lastName} verlängert bis ${career.season + y}.`, notes };
  });
}

// ---------------------------------------------------------------- Scouting

export function scoutLimit(career: CareerRow): number {
  return 3 + Math.floor(career.staff.scout / 4);
}

export async function scoutPlayer(careerId: string, accountId: string, playerId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    requireClub(career);
    const p = await getPlayer(db, career.id, playerId);
    if (!p) throw new GameError("Spieler nicht gefunden", 404);
    const used = await one<{ n: number }>(
      db, "select count(*)::int as n from shortlist where career_id = $1 and (report->>'season')::int = $2 and (report->>'week')::int = $3",
      [career.id, career.season, career.week],
    );
    if ((used?.n ?? 0) >= scoutLimit(career)) throw new GameError(`Dein Scout schafft diese Woche nur ${scoutLimit(career)} Berichte.`);
    const rng = new Rng(seedFor(career.seed, "scout", p.id));
    const accuracy = career.staff.scout;
    const potentialGuess = Math.round(p.potential + rng.normal(0, Math.max(1, 8 - accuracy / 3)));
    const report = {
      season: career.season, week: career.week, rating: p.rating,
      potentialMin: Math.max(p.rating, potentialGuess - 4), potentialMax: Math.max(p.rating, potentialGuess + 4),
      verdict: p.potential - p.rating >= 12 ? "Grosses Talent – unbedingt beobachten." : p.rating >= 75 ? "Sofortige Verstärkung für fast jeden Verein." : p.rating >= 65 ? "Solider Spieler mit klaren Stärken." : "Eher ein Ergänzungsspieler.",
    };
    await query(
      db, "insert into shortlist(career_id, player_id, report) values ($1,$2,$3) on conflict (career_id, player_id) do update set report = excluded.report",
      [career.id, p.id, JSON.stringify(report)],
    );
    const notes: RewardNote[] = [];
    completeMission(career, "scout_report", notes);
    await saveCareer(db, career);
    return { report, notes };
  });
}

export async function toggleShortlist(careerId: string, accountId: string, playerId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const existing = await one(db, "select 1 from shortlist where career_id = $1 and player_id = $2", [career.id, playerId]);
    if (existing) await query(db, "delete from shortlist where career_id = $1 and player_id = $2", [career.id, playerId]);
    else await query(db, "insert into shortlist(career_id, player_id) values ($1,$2)", [career.id, playerId]);
    return { shortlisted: !existing };
  });
}

/** Scouting-Netzwerk: Topliga eines Landes für Detailsimulation und Markt öffnen. */
export async function scoutCountry(careerId: string, accountId: string, countryCode: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!isUnlocked(career.manager, "scouting_network")) throw new GameError("Das Scouting-Netzwerk wird mit Manager-Level 5 freigeschaltet.");
    const country = COUNTRY_BY_CODE[countryCode];
    if (!country) throw new GameError("Unbekanntes Land");
    const leagues = (await getLeagues(db, career.id)).filter((l) => l.country_code === countryCode);
    const activeForeign = (await getLeagues(db, career.id)).filter((l) => l.active && l.country_code !== career.country_code).length;
    const max = 2 + Math.floor(career.staff.scout / 5);
    const top = leagues.find((l) => l.tier === 1)!;
    if (top.active) return { activated: false, message: `${country.name} ist bereits im Scouting-Netzwerk.` };
    if (activeForeign >= max) throw new GameError(`Dein Scouting-Netzwerk umfasst höchstens ${max} ausländische Ligen. Verbessere den Scout im Trainerstab.`);
    await activateLeague(db, career, top.id);
    return { activated: true, message: `${top.name} (${country.name}) ist jetzt im Scouting-Netzwerk.` };
  });
}

/** Kader eines Vereins bei Bedarf erzeugen (Club-Ansicht einer vereinfachten Liga). */
export async function ensureClubSquad(careerId: string, accountId: string, clubId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const club = await getClub(db, career.id, clubId);
    if (!club) throw new GameError("Verein nicht gefunden", 404);
    if (club.players_generated) return false;
    const leagues = new Map((await getLeagues(db, career.id)).map((l) => [l.id, l]));
    await activateClubs(db, career, [club], leagues);
    return true;
  });
}

// ---------------------------------------------------------------- Shop & Sammlung

export async function buySkin(careerId: string, accountId: string, skinId: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!isUnlocked(career.manager, "skins")) throw new GameError("Stadion-Skins werden mit Level 3 freigeschaltet.");
    const skin = SKINS.find((s) => s.id === skinId);
    if (!skin) throw new GameError("Unbekannter Skin");
    const m = career.manager;
    if (!m.skins.includes(skin.id)) {
      if (m.points < skin.price) throw new GameError("Nicht genug Manager-Punkte.");
      m.points -= skin.price;
      m.skins.push(skin.id);
    }
    m.activeSkin = skin.id;
    await saveCareer(db, career);
    return { skins: m.skins, activeSkin: m.activeSkin, points: m.points };
  });
}

export async function buyCardPack(careerId: string, accountId: string) {
  return withCareer(careerId, accountId, async (db, career) => {
    if (!isUnlocked(career.manager, "card_packs")) throw new GameError("Kartenpakete werden mit Level 2 freigeschaltet.");
    if (career.manager.points < CARD_PACK.price) throw new GameError("Nicht genug Manager-Punkte.");
    career.manager.points -= CARD_PACK.price;
    const rows = await query<{ data: Player }>(db, "select data from players where career_id = $1 and club_id is not null order by random() limit 1500", [career.id]);
    const notes: RewardNote[] = [];
    const drawn = openPack(career, rows.map((r) => r.data), notes);
    await saveCareer(db, career);
    await announceNotes(db, career, notes);
    return { drawn, points: career.manager.points, notes };
  });
}

// ---------------------------------------------------------------- Trainerstab

export function staffUpgradeCost(level: number): number {
  return Math.round(150_000 * Math.pow(1.45, level - 8) / 10_000) * 10_000;
}

export async function upgradeStaff(careerId: string, accountId: string, role: "coach" | "physio" | "scout" | "youth") {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    if (!isUnlocked(career.manager, "staff_upgrade")) throw new GameError("Der Ausbau des Trainerstabs wird mit Level 7 freigeschaltet.");
    if (!["coach", "physio", "scout", "youth"].includes(role)) throw new GameError("Unbekannte Rolle");
    const current = career.staff[role];
    if (current >= 20) throw new GameError("Bereits auf höchster Stufe.");
    const cost = staffUpgradeCost(current + 1);
    const club = (await getClub(db, career.id, clubId))!;
    if (club.balance - cost < 0) throw new GameError("Dafür reicht das Geld nicht.");
    club.balance -= cost;
    if (club.finance) club.finance.staffWeekly += Math.round(cost / 200 / 100) * 100;
    career.staff[role] = current + 1;
    await saveClubs(db, career.id, [club]);
    await addFinance(db, career.id, clubId, career.season, career.week, [{ kind: "staff", amount: -cost, label: "Ausbau Trainerstab" }]);
    await saveCareer(db, career);
    return { staff: career.staff, cost };
  });
}

// ---------------------------------------------------------------- Karriere

export async function acceptJob(careerId: string, accountId: string, clubId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const offer = career.job_offers.find((o) => o.clubId === clubId);
    if (!offer) throw new GameError("Dieses Angebot gibt es nicht (mehr).");
    if (career.week !== 0) throw new GameError("Vereinswechsel sind nur in der Saisonvorbereitung möglich.");
    const club = await getClub(db, career.id, clubId);
    if (!club) throw new GameError("Verein nicht gefunden");
    const league = (await getLeague(db, career.id, club.league_id))!;
    if (!league.active) await activateLeague(db, career, league.id);
    const fresh = (await getClub(db, career.id, clubId))!;
    career.club_id = clubId;
    career.status = "active";
    career.job_offers = [];
    // Neuer Verein: Kalender (Spieltage und Pokal) neu planen
    await query(db, "delete from fixtures where career_id = $1 and season = $2", [career.id, career.season]);
    await query(db, "delete from cups where career_id = $1 and season = $2", [career.id, career.season]);
    await scheduleSeason(db, career);
    career.board = await boardObjectives(db, career, fresh, league);
    career.board.confidence = 60;
    await saveCareer(db, career);
    await addInbox(db, career.id, career.season, 0, "board", `Neuer Job: ${fresh.name}`,
      `Willkommen bei ${fresh.name}! Saisonziel: ${career.board.objective}`);
    return { clubId };
  });
}

export async function markInboxRead(careerId: string, accountId: string, ids: number[] | "all") {
  return withCareer(careerId, accountId, async (db, career) => {
    if (ids === "all") await query(db, "update inbox set read = true where career_id = $1", [career.id]);
    else await query(db, "update inbox set read = true where career_id = $1 and id = any($2::int[])", [career.id, ids]);
    return { ok: true };
  });
}

export { askingPrice, getClubs };

// ---------------------------------------------------------------- Leihgeschäfte

function removeFromTactic(club: ClubRow, playerId: number) {
  if (!club.tactic) return;
  club.tactic.lineup = club.tactic.lineup.map((id) => (id === playerId ? null : id));
  club.tactic.bench = club.tactic.bench.filter((id) => id !== playerId);
}

/** Spieler bis Saisonende ausleihen; wageShare = Anteil am Gehalt, den du übernimmst. */
export async function loanIn(careerId: string, accountId: string, playerId: number, wageShare: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    if (!transferWindow(career.week, career.season_weeks).open) throw new GameError("Leihen sind nur im Transferfenster möglich.");
    const p = await getPlayer(db, career.id, playerId);
    if (!p || p.clubId === null || p.clubId === clubId) throw new GameError("Dieser Spieler kann nicht ausgeliehen werden.");
    if (p.loan) throw new GameError("Der Spieler ist bereits ausgeliehen.");
    const share = Math.max(0, Math.min(1, Math.round(wageShare * 100) / 100));
    const parent = (await getClub(db, career.id, p.clubId))!;
    const me = (await getClub(db, career.id, clubId))!;
    const squad = await getPlayers(db, career.id, [parent.id]);
    const own = await getPlayers(db, career.id, [clubId]);
    if (own.length >= 32) throw new GameError("Dein Kader ist voll (max. 32 Spieler).");
    const rank = squadRanks(squad).get(p.id) ?? 30;
    // Stammverein gibt nur Ergänzungsspieler oder Talente ab
    if (rank <= 11 && p.age > 21) return { status: "rejected", message: `${parent.name} gibt einen Stammspieler nicht ab.` };
    const minShare = rank > 16 ? 0.5 : p.age <= 21 ? 0.6 : 0.8;
    if (share < minShare) return { status: "countered", message: `${parent.name} verlangt, dass du mindestens ${Math.round(minShare * 100)} % des Gehalts übernimmst.`, minShare };
    if (me.reputation < parent.reputation - 30) return { status: "rejected", message: `${p.lastName} möchte nicht zu einem deutlich kleineren Verein wechseln.` };
    removeFromTactic(parent, p.id);
    await saveClubs(db, career.id, [parent]);
    p.clubId = clubId;
    p.listed = false;
    p.loan = { parentClubId: parent.id, untilSeason: career.season, wageShare: share };
    p.morale = Math.min(100, p.morale + 5);
    await savePlayers(db, career.id, [p]);
    await query(
      db,
      `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, season, week, message)
       values ($1,$2,$3,$4,$5,0,$6,0,'loan','completed',$7,$8,$9)`,
      [career.id, p.id, `${p.firstName} ${p.lastName}`, parent.id, clubId, Math.round((p.contract?.wage ?? 0) * share), career.season, career.week, `Leihe bis Saisonende (${Math.round(share * 100)} % Gehalt)`],
    );
    const notes: RewardNote[] = [];
    completeMission(career, "sign_player", notes);
    await saveCareer(db, career);
    await addInbox(db, career.id, career.season, career.week, "transfer", `Leihe: ${p.firstName} ${p.lastName}`,
      `${p.firstName} ${p.lastName} wechselt bis Saisonende von ${parent.name} zu ${me.name}. Du übernimmst ${Math.round(share * 100)} % des Gehalts (${formatMoney(Math.round((p.contract?.wage ?? 0) * share))} pro Woche).`);
    return { status: "completed", message: `${p.firstName} ${p.lastName} ist bis Saisonende ausgeliehen.`, notes };
  });
}

/** Eigenen Spieler verleihen: ein passender Verein übernimmt ihn bis Saisonende. */
export async function loanOut(careerId: string, accountId: string, playerId: number) {
  return withCareer(careerId, accountId, async (db, career) => {
    const clubId = requireClub(career);
    if (!transferWindow(career.week, career.season_weeks).open) throw new GameError("Leihen sind nur im Transferfenster möglich.");
    const p = await getPlayer(db, career.id, playerId);
    if (!p || p.clubId !== clubId) throw new GameError("Spieler nicht in deinem Kader.");
    if (p.loan) throw new GameError("Leihspieler kannst du nicht weiterverleihen.");
    const own = await getPlayers(db, career.id, [clubId]);
    if (own.length <= 18) throw new GameError("Du brauchst mindestens 18 Spieler im Kader.");
    const me = (await getClub(db, career.id, clubId))!;
    const candidates = await getClubs(db, career.id, "players_generated and id <> $2 and abs(rating - $3) <= 8 and reputation <= $4", [clubId, p.rating, me.reputation + 5]);
    if (!candidates.length) return { status: "rejected", message: `Kein Verein hat Interesse an einer Leihe von ${p.lastName}.` };
    const rng = new Rng(seedFor(career.seed, "loan-out", p.id, career.season, career.week));
    // Bevorzugt Vereine, bei denen der Spieler Stammspieler wäre
    const target = candidates.sort((a, b) => Math.abs(a.rating - (p.rating - 2)) - Math.abs(b.rating - (p.rating - 2)))[rng.int(0, Math.min(2, candidates.length - 1))];
    const share = Math.round(rng.range(0.5, 1) * 20) / 20;
    removeFromTactic(me, p.id);
    await saveClubs(db, career.id, [me]);
    p.clubId = target.id;
    p.listed = false;
    p.loan = { parentClubId: clubId, untilSeason: career.season, wageShare: share };
    await savePlayers(db, career.id, [p]);
    await query(
      db,
      `insert into transfers(career_id, player_id, player_name, from_club, to_club, fee, wage, years, kind, status, season, week, message)
       values ($1,$2,$3,$4,$5,0,$6,0,'loan_out','completed',$7,$8,$9)`,
      [career.id, p.id, `${p.firstName} ${p.lastName}`, clubId, target.id, Math.round((p.contract?.wage ?? 0) * share), career.season, career.week, `Verliehen an ${target.name}`],
    );
    return { status: "completed", message: `${p.firstName} ${p.lastName} wird bis Saisonende an ${target.name} verliehen. ${target.name} übernimmt ${Math.round(share * 100)} % des Gehalts.` };
  });
}
