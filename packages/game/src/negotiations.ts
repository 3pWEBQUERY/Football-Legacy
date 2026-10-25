/**
 * Transferverhandlungen im Stil des FM: erst mit dem Verein (Ablöse, Raten,
 * Weiterverkaufsbeteiligung; Antwort nach ein bis zwei Tagen), dann mit dem
 * Berater (Gehalt, Laufzeit, Handgeld, Ausstiegsklausel, Kaderrolle, Beraterhonorar).
 * Dazu Ratenzahlungen, Budget-Umschichtung und die Transfer-Zentrale.
 */
export type { ClubOffer, ContractTerms } from "./negotiations/core";
export { acceptClubCounter, offerContract, reviseClubOffer, startNegotiation, withdrawNegotiation } from "./negotiations/actions";
export { BUDGET_RATIO, negotiationsDaily, paySellOn, paymentsSeasonStart, setWageBudget } from "./negotiations/timeline";
export { negotiationView, offerHint, playerNegotiation, transferHub } from "./negotiations/views";
