/**
 * Trainer-Stellenmarkt: Jeder Verein der Welt hat einen Trainer. Wer sportlich
 * hinterherhinkt, wackelt und wird irgendwann entlassen; freie Stellen werden
 * nach einigen Wochen neu besetzt. Der Spieler kann sich bewerben (auch
 * initiativ), Interesse an wackelnden Posten bekunden, Angebote annehmen und
 * jederzeit – auch während der Saison – den Verein wechseln oder zurücktreten.
 */
export { absDay, chanceLabel, coachOf, getMarket, hireChance } from "./jobs/core";
export type { Application, JobMarket, JobStatus, Vacancy } from "./jobs/core";
export { jobsDaily, jobsSeasonEnd, jobsWeek } from "./jobs/timeline";
export { acceptJob, applyForJob, declineOffer, resignJob, toggleInterest, withdrawApplication } from "./jobs/actions";
export { jobsView } from "./jobs/view";
export type { JobFilter } from "./jobs/view";
