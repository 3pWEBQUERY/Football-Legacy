/**
 * Nationaltrainer: Neben (oder ohne) Verein betreust du eine Nationalmannschaft.
 * In den Länderspielpausen nominierst du den Kader, spielst die Qualifikation
 * (Gruppe mit vier Nationen, Playoffs im März) und am Saisonende die Endrunde
 * (abwechselnd Weltmeisterschaft und Kontinentalmeisterschaft).
 */
export { getNational, nationColors, nationRating, requiredReputation, tournamentName } from "./national/core";
export type { NationalState, ObjectiveLevel } from "./national/core";
export { nationalDay, nationalNewSeason, nationalTournament } from "./national/season";
export { nationalJobs, nationalMatchReport, nationalSquadView, nationalView, resignNationalJob, saveNationalSquad, takeNationalJob } from "./national/views";
