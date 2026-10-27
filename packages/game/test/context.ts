/** Gemeinsamer Zustand der Integrationstests: Datenbank, Spiel-API und die Test-Karriere. */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://fl:fl@localhost:5432/football_legacy_test";

export const game = await import("../src/index");
export const neg = await import("../src/negotiations");
export const { pool, migrate, register, createCareer, previewClubs, advance, quickMatch, dashboard, startMatch, stepMatch,
  squadView, saveTactic, tacticView, marketView, competitionView, careerView, financeView, leaderboards, cupView, reviewView, pressConference, answerPress, loanIn, loanOut } = game;

/** Von mehreren Testblöcken geteilter Zustand (eine Karriere, die durch die Saison gespielt wird). */
export const shared = {
  accountId: "",
  careerId: "",
  loans: {} as { inId?: number; outId?: number; parentId?: number },
  promised: 0,
  trainingApproved: false,
  retrainId: 0,
  retrainPos: "",
  nationCode: "",
  onboardingId: "",
  sponsorCareer: null as { cid: string; acc: string } | null,
};
