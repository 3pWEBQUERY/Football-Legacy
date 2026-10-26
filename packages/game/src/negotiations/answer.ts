/** Transferverhandlungen: Antwort des abgebenden Vereins auf ein Angebot (Zusage, Gegenforderung, Absage). */
import { Rng, evaluateFee, seedFor } from "@fl/sim";
import { type Db } from "../db";
import { clubSender, send } from "../news";
import { getClub, getPlayer, type CareerRow } from "../repo";
import { describeOffer, log, nominalFor, offerValue, saveNeg, sellerCtx, toContractStage, type NegRow } from "./core";

export async function answerClubOffer(db: Db, career: CareerRow, n: NegRow) {
  const p = await getPlayer(db, career.id, n.player_id);
  if (!p || p.clubId !== n.from_club) {
    n.stage = "failed"; n.status = "rejected"; n.message = "Der Spieler ist nicht mehr verfügbar."; await saveNeg(db, n); return;
  }
  const { ctx, club: seller } = await sellerCtx(db, career, p);
  const o = n.offer!;
  const rng = new Rng(seedFor(career.seed, "neg-answer", n.id, o.attempts ?? 1));
  const verdict = evaluateFee(p, offerValue(p, o), ctx, rng);
  const buyer = (await getClub(db, career.id, n.to_club))!;
  let title: string;
  let text: string;
  if (verdict.kind === "accept") {
    await toContractStage(db, career, n, buyer);
    title = `${seller!.name} akzeptiert dein Angebot für ${n.player_name}`;
    text = (n.stage as string) === "failed" ? n.message! : "Wir sind mit den Konditionen einverstanden. Sie dürfen mit dem Spieler und seinem Berater sprechen.";
    log(n, career, "verein", "Angebot angenommen.");
  } else if (verdict.kind === "counter" && (o.attempts ?? 1) < 4) {
    const fee = nominalFor(p, verdict.fee, o);
    n.counter = { ...o, fee };
    n.status = "countered";
    n.message = `${seller!.name} fordert ${describeOffer(n.counter)}.`;
    title = `Gegenangebot von ${seller!.name}`;
    text = `${verdict.message} Für ${n.player_name} verlangen wir ${describeOffer(n.counter)}.`;
    log(n, career, "verein", `Gegenangebot: ${describeOffer(n.counter)}`);
  } else {
    n.status = "rejected";
    if ((o.attempts ?? 1) >= 4 || verdict.message.includes("unverkäuflich")) n.stage = "failed";
    n.message = verdict.kind === "reject" ? verdict.message : "Wir sehen keine Grundlage mehr für Gespräche.";
    title = `${seller!.name} lehnt ab`;
    text = `${n.message}${n.stage === "failed" ? " Die Gespräche sind beendet." : " Ein verbessertes Angebot wäre möglich."}`;
    log(n, career, "verein", n.message);
  }
  await saveNeg(db, n);
  await send(db, career, {
    category: "transfer", title, sender: clubSender(seller!, "Sportdirektor"),
    blocks: [
      { t: "p", text },
      { t: "kv", rows: [["Spieler", `${n.player_name} (${p.position}, ${p.age})`], ["Dein Angebot", describeOffer(o)], ...(n.counter && n.status === "countered" ? [["Forderung", describeOffer(n.counter)] as [string, string]] : [])] },
    ],
    priority: 2, kind: "negotiation", action: { type: "negotiation", negotiationId: n.id, playerId: p.id },
  });
}
