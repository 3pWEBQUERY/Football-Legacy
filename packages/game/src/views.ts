/** Lesende Sichten für die Oberfläche (aufgeteilt nach Bereichen unter views/). */
export { careerSummary, clubSummary, playerView } from "./views/common";
export { checkin, dashboard } from "./views/office";
export { clubView, playerDetail, squadView, tacticView } from "./views/team";
export { competitionView, matchReport } from "./views/competition";
export { contractsView, financeView, marketView } from "./views/market";
export type { MarketFilter } from "./views/market";
export { careerView, leaderboards, worldMeta } from "./views/career";
export type { LeagueRow } from "./repo";
