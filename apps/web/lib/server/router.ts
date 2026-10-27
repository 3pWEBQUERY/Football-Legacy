/**
 * Schlanker Router für die JSON-API. Dieselbe API nutzt später auch die iOS-App
 * (Authentifizierung per Cookie oder "Authorization: Bearer <token>").
 */
import { type NextRequest, NextResponse } from "next/server";
import * as game from "@fl/game";
import type { Account } from "@fl/game";

export const SESSION_COOKIE = "fl_session";

type Params = Record<string, string>;
interface Ctx {
  req: NextRequest;
  params: Params;
  body: Record<string, unknown>;
  query: URLSearchParams;
  account: Account | null;
  token: string | null;
}
type Handler = (ctx: Ctx) => Promise<unknown>;

interface Route {
  method: string;
  parts: string[];
  auth: boolean;
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, pattern: string, handler: Handler, auth = true) {
  routes.push({ method, parts: pattern.split("/").filter(Boolean), auth, handler });
}

function match(parts: string[], path: string[]): Params | null {
  if (parts.length !== path.length) return null;
  const params: Params = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(":")) params[parts[i].slice(1)] = decodeURIComponent(path[i]);
    else if (parts[i] !== path[i]) return null;
  }
  return params;
}

const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new game.GameError("Ungültige Zahl");
  return n;
};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const acc = (c: Ctx) => c.account!.id;

// ---------------------------------------------------------------- Auth

// Vom Proxy gesetzte Adresse: X-Real-IP, sonst der letzte Eintrag von X-Forwarded-For
// (frühere Einträge kann der Browser selbst mitschicken)
const clientIp = (c: Ctx) => c.req.headers.get("x-real-ip")?.trim() || c.req.headers.get("x-forwarded-for")?.split(",").map((x) => x.trim()).filter(Boolean).pop() || null;

route("POST", "auth/register", async (c) => {
  const consent = game.requireConsent(c.body);
  const { account, token } = await game.register(str(c.body.email), str(c.body.password), str(c.body.displayName), consent, { ip: clientIp(c) });
  // Bestätigungs-Mail im Hintergrund – die Registrierung soll daran nicht scheitern
  void game.sendVerification(account.id, c.req.nextUrl.origin).catch((e) => console.warn("[verify]", (e as Error).message));
  return { account: publicAccount(account), token: c.body.returnToken ? token : undefined, setCookie: token };
}, false);

route("POST", "auth/login", async (c) => {
  const { account, token } = await game.login(str(c.body.email), str(c.body.password), { ip: clientIp(c) });
  return { account: publicAccount(account), token: c.body.returnToken ? token : undefined, setCookie: token };
}, false);

route("POST", "auth/logout", async (c) => {
  if (c.token) await game.logout(c.token);
  return { ok: true, clearCookie: true };
}, false);


route("POST", "auth/forgot", async (c) => game.requestPasswordReset(str(c.body.email), { ip: clientIp(c), origin: c.req.nextUrl.origin }), false);
route("GET", "auth/reset", async (c) => game.checkResetToken(c.query.get("token") ?? ""), false);
route("POST", "auth/reset", async (c) => {
  const r = await game.resetPassword(str(c.body.token), str(c.body.password));
  return { ok: true, account: { id: r.account.id, email: r.account.email, displayName: r.account.display_name }, setCookie: r.token };
}, false);
route("GET", "auth/export", async (c) => game.exportAccountData(acc(c)));
// Push-Mitteilungen (Geräte-Abos)
route("GET", "push/key", async () => game.pushPublicKey(), false);
route("GET", "push/status", async (c) => game.pushStatus(acc(c), c.query.get("endpoint")));
route("POST", "push/subscribe", async (c) => game.subscribePush(acc(c), c.body as never, c.req.headers.get("user-agent")));
route("POST", "push/unsubscribe", async (c) => game.unsubscribePush(acc(c), str(c.body.endpoint)));
route("POST", "push/test", async (c) => game.testPush(acc(c)));

route("GET", "auth/me", async (c) => {
  if (!c.account) return { account: null };
  const streak = await game.touchLoginStreak(c.account.id);
  return { account: { ...publicAccount(c.account), login_streak: streak.streak } };
}, false);

route("POST", "account/settings", async (c) => {
  const allowed: Record<string, unknown> = {};
  if (c.body.theme === "dark" || c.body.theme === "light" || c.body.theme === "system") allowed.theme = c.body.theme;
  if (typeof c.body.reducedMotion === "boolean") allowed.reducedMotion = c.body.reducedMotion;
  await game.updateSettings(acc(c), allowed);
  return { ok: true };
});

route("POST", "auth/verify", async (c) => game.verifyEmail(str(c.body.token)), false);
route("POST", "account/verify/resend", async (c) => game.sendVerification(acc(c), c.req.nextUrl.origin));
// Fehlerüberwachung: Meldungen aus dem Browser und Übersicht für Administratoren
route("POST", "errors", async (c) => {
  await game.guardErrorReports(clientIp(c));
  await game.reportError({
    source: "client", message: str(c.body.message) || "Unbekannter Fehler", stack: str(c.body.stack) || null,
    path: str(c.body.path) || null, accountId: c.account?.id ?? null, userAgent: c.req.headers.get("user-agent"),
  });
  return { ok: true };
}, false);
route("GET", "admin/errors", async (c) => game.errorOverview(c.account!.email));
route("GET", "admin/me", async (c) => ({ admin: game.isAdmin(c.account?.email) }), false);
route("POST", "account/terms", async (c) => game.acceptTerms(acc(c), c.body));
route("POST", "account/profile", async (c) => game.updateProfile(acc(c), str(c.body.displayName)));
route("POST", "account/password", async (c) => game.changePassword(acc(c), c.token ?? null, str(c.body.oldPassword), str(c.body.newPassword)));
route("POST", "account/delete", async (c) => game.deleteAccount(acc(c), str(c.body.password)));

function publicAccount(a: Account) {
  return {
    id: a.id, email: a.email, displayName: a.display_name, settings: a.settings, login_streak: a.login_streak,
    termsAccepted: (a.terms_version ?? 0) >= game.TERMS_VERSION, emailVerified: !!a.email_verified_at, verificationRequired: game.mailConfigured(),
  };
}

// ---------------------------------------------------------------- Welt & Karrieren

route("GET", "health", async () => {
  await game.pool().query("select 1");
  const w = await game.workerStatus().catch(() => null);
  return { ok: true, workers: w?.workers ?? 0, queued: w?.queued ?? 0 };
}, false);
route("GET", "world", async () => game.worldMeta(), false);
route("GET", "world/preview", async (c) => game.previewClubs(num(c.query.get("seed") ?? 1), str(c.query.get("country"))), false);
route("GET", "leaderboards", async () => game.leaderboards(), false);

route("GET", "careers", async (c) => ({ careers: await game.listCareers(acc(c)) }));
route("POST", "careers", async (c) => ({
  id: await game.bg.createCareer(acc(c), {
    managerName: str(c.body.managerName),
    countryCode: str(c.body.countryCode),
    clubIndex: num(c.body.clubIndex),
    seed: c.body.seed !== undefined ? num(c.body.seed) : undefined,
    custom: c.body.custom && typeof c.body.custom === "object" ? (c.body.custom as never) : null,
    difficulty: c.body.difficulty,
  }),
}));
route("GET", "difficulties", async () => game.DIFFICULTY, false);
route("DELETE", "careers/:id", async (c) => {
  await game.deleteCareer(acc(c), c.params.id);
  return { ok: true };
});

// ---------------------------------------------------------------- Online-Ligen

route("GET", "online", async (c) => game.onlineOverview(acc(c)));
route("POST", "online", async (c) => game.createOnlineLeague(acc(c), {
  name: str(c.body.name), careerId: str(c.body.careerId), maxMembers: num(c.body.maxMembers ?? 8), rhythm: str(c.body.rhythm), public: c.body.public !== false,
}));
route("POST", "online/join", async (c) => game.joinOnlineLeague(acc(c), { code: str(c.body.code), leagueId: str(c.body.leagueId), careerId: str(c.body.careerId) }));
route("GET", "online/:lid", async (c) => game.onlineLeagueView(acc(c), c.params.lid));
route("POST", "online/:lid/leave", async (c) => game.leaveOnlineLeague(acc(c), c.params.lid));
route("POST", "online/:lid/kick", async (c) => game.kickOnlineMember(acc(c), c.params.lid, num(c.body.memberId)));
route("POST", "online/:lid/bots", async (c) => game.addOnlineBots(acc(c), c.params.lid, num(c.body.count ?? 1)));
route("POST", "online/:lid/start", async (c) => game.startOnlineLeague(acc(c), c.params.lid));
route("POST", "online/:lid/play", async (c) => game.bg.playOnlineRound(acc(c), c.params.lid));
route("POST", "online/:lid/ready", async (c) => game.bg.setOnlineReady(acc(c), c.params.lid, c.body.ready !== false));
route("POST", "online/:lid/team", async (c) => game.switchOnlineTeam(acc(c), c.params.lid, str(c.body.careerId)));
route("POST", "online/:lid/posts", async (c) => game.postOnlineMessage(acc(c), c.params.lid, str(c.body.body)));
route("POST", "online/:lid/posts/:pid/report", async (c) => game.reportOnlinePost(acc(c), c.params.lid, num(c.params.pid), str(c.body.reason)));
route("POST", "online/:lid/posts/:pid/delete", async (c) => game.deleteOnlinePost(acc(c), c.params.lid, num(c.params.pid)));
route("POST", "online/:lid/posts/:pid/block", async (c) => game.blockOnlineAuthor(acc(c), c.params.lid, num(c.params.pid)));
route("GET", "account/blocks", async (c) => ({ blocked: await game.blockedList(acc(c)) }));
route("POST", "account/blocks/:bid/remove", async (c) => game.unblockOnline(acc(c), c.params.bid));
route("GET", "online/:lid/matches/:fid", async (c) => game.onlineMatchReport(acc(c), c.params.lid, num(c.params.fid)));

const career = (pattern: string) => `careers/:id/${pattern}`.replace(/\/$/, "");

route("POST", career("checkin"), async (c) => game.checkin(c.params.id, acc(c)));
route("GET", career("dashboard"), async (c) => game.dashboard(c.params.id, acc(c)));
route("POST", career("advance"), async (c) => game.bg.advance(c.params.id, acc(c)));
route("GET", career("squad"), async (c) => game.squadView(c.params.id, acc(c)));
route("GET", career("tactic"), async (c) => game.tacticView(c.params.id, acc(c)));
route("PUT", career("tactic"), async (c) => game.saveTactic(c.params.id, acc(c), c.body as never));
route("POST", career("tactic/slot"), async (c) => game.tacticSlotAction(c.params.id, acc(c), { action: str(c.body.action), index: c.body.index !== undefined ? num(c.body.index) : undefined, name: str(c.body.name) }));
route("PUT", career("training"), async (c) => game.setTraining(c.params.id, acc(c), c.body as never));
route("PUT", career("autosubs"), async (c) => game.setAutoSubs(c.params.id, acc(c), !!c.body.autoSubs));
route("GET", career("players/:pid"), async (c) => game.playerDetail(c.params.id, acc(c), num(c.params.pid)));
route("POST", career("players/:pid"), async (c) => {
  const pid = num(c.params.pid);
  switch (c.body.action) {
    case "scout": return game.scoutPlayer(c.params.id, acc(c), pid);
    case "shortlist": return game.toggleShortlist(c.params.id, acc(c), pid);
    case "list": return game.toggleTransferList(c.params.id, acc(c), pid);
    case "release": return game.releasePlayer(c.params.id, acc(c), pid);
    case "loan_in": return game.loanIn(c.params.id, acc(c), pid, Number(c.body.wageShare ?? 1),
      c.body.optionFee ? { fee: num(c.body.optionFee), obligation: !!c.body.obligation } : null);
    case "loan_option": return game.exerciseLoanOption(c.params.id, acc(c), pid);
    case "loan_out": return game.loanOut(c.params.id, acc(c), pid);
    case "talk": return game.talkToPlayer(c.params.id, acc(c), pid, String(c.body.topic) as never);
    case "individual": return game.setIndividualTraining(c.params.id, acc(c), pid, (c.body.focus as string) || null, (c.body.position as string) || null);
    case "status": return game.setSquadStatus(c.params.id, acc(c), pid, String(c.body.status) as never);
    default: throw new game.GameError("Unbekannte Aktion");
  }
});
route("GET", career("clubs/:cid"), async (c) => {
  await game.ensureClubSquad(c.params.id, acc(c), num(c.params.cid));
  return game.clubView(c.params.id, acc(c), num(c.params.cid));
});
route("GET", career("competition"), async (c) => game.competitionView(c.params.id, acc(c), c.query.get("league") ? num(c.query.get("league")) : undefined));
route("GET", career("continental"), async (c) => game.continentalView(c.params.id, acc(c), c.query.get("season") ? num(c.query.get("season")) : undefined));
route("GET", career("academy"), async (c) => game.academyView(c.params.id, acc(c)));
route("POST", career("academy/:pid"), async (c) => {
  const pid = num(c.params.pid);
  if (c.body.action === "promote") return game.promoteYouth(c.params.id, acc(c), pid);
  if (c.body.action === "release") return game.releaseYouth(c.params.id, acc(c), pid);
  throw new game.GameError("Unbekannte Aktion");
});
route("GET", career("boardroom"), async (c) => game.boardView(c.params.id, acc(c)));
route("GET", career("history"), async (c) => game.clubHistoryView(c.params.id, acc(c), c.query.get("club") ? num(c.query.get("club")) : undefined));
route("GET", career("hall-of-fame"), async (c) => game.hallOfFameView(c.params.id, acc(c)));
route("GET", career("onboarding"), async (c) => game.onboardingView(c.params.id, acc(c)));
route("POST", career("onboarding"), async (c) => game.onboardingAction(c.params.id, acc(c), {
  action: str(c.body.action) as never, page: String(c.body.page ?? ""), id: String(c.body.id ?? ""),
} as game.OnboardingAction));
route("POST", career("boardroom"), async (c) => game.boardRequest(c.params.id, acc(c), String(c.body.kind) as never));
route("GET", career("scouting"), async (c) => game.scoutingView(c.params.id, acc(c)));
route("POST", career("scouting"), async (c) => game.startAssignment(c.params.id, acc(c), {
  country: String(c.body.country), position: (c.body.position as string) || null, maxAge: c.body.maxAge ? num(c.body.maxAge) : null,
}));
route("POST", career("scouting/:aid/cancel"), async (c) => game.cancelAssignment(c.params.id, acc(c), num(c.params.aid)));
route("GET", career("medical"), async (c) => game.medicalView(c.params.id, acc(c)));
route("GET", career("calendar"), async (c) => game.calendarView(c.params.id, acc(c)));
route("GET", career("review"), async (c) => game.reviewView(c.params.id, acc(c), c.query.get("season") ? num(c.query.get("season")) : undefined));
route("GET", career("cup"), async (c) => game.cupView(c.params.id, acc(c), c.query.get("season") ? num(c.query.get("season")) : undefined));
route("GET", career("reports/:fid"), async (c) => game.matchReport(c.params.id, acc(c), num(c.params.fid)));
route("GET", career("market"), async (c) => {
  const q = c.query;
  const n = (k: string) => (q.get(k) ? num(q.get(k)) : undefined);
  return game.marketView(c.params.id, acc(c), {
    q: q.get("q") ?? undefined, position: q.get("position") ?? undefined, minAge: n("minAge"), maxAge: n("maxAge"),
    maxValue: n("maxValue"), country: q.get("country") ?? undefined, freeOnly: q.get("free") === "1",
    listedOnly: q.get("listed") === "1", shortlistOnly: q.get("shortlist") === "1", expiring: q.get("expiring") === "1", maxWage: n("maxWage"),
    sort: (q.get("sort") as never) ?? undefined, page: n("page"),
  });
});

route("GET", career("transfers"), async (c) => game.transferHub(c.params.id, acc(c)));
route("POST", career("transfers/budget"), async (c) => game.setWageBudget(c.params.id, acc(c), num(c.body.wageBudget)));
const clubOffer = (b: Record<string, unknown>) => ({ fee: num(b.fee ?? 0), upfrontPct: num(b.upfrontPct ?? 100), installmentYears: num(b.installmentYears ?? 0), sellOn: num(b.sellOn ?? 0) });
route("POST", career("negotiations"), async (c) => game.startNegotiation(c.params.id, acc(c), { playerId: num(c.body.playerId), offer: clubOffer(c.body) }));
route("POST", career("negotiations/renew"), async (c) => game.startRenewal(c.params.id, acc(c), num(c.body.playerId)));
route("GET", career("negotiations/:nid"), async (c) => game.negotiationView(c.params.id, acc(c), num(c.params.nid)));
route("POST", career("negotiations/:nid"), async (c) => {
  const nid = num(c.params.nid);
  switch (str(c.body.action)) {
    case "offer": return game.reviseClubOffer(c.params.id, acc(c), nid, clubOffer(c.body));
    case "accept": return game.acceptClubCounter(c.params.id, acc(c), nid);
    case "contract": return game.offerContract(c.params.id, acc(c), nid, c.body as never);
    case "withdraw": return game.withdrawNegotiation(c.params.id, acc(c), nid);
    case "sale_accept": return game.respondSale(c.params.id, acc(c), nid, "accept");
    case "sale_reject": return game.respondSale(c.params.id, acc(c), nid, "reject");
    case "sale_counter": return game.respondSale(c.params.id, acc(c), nid, "counter", clubOffer(c.body));
    default: throw new game.GameError("Unbekannte Aktion");
  }
});
route("POST", career("offers/:tid"), async (c) => game.respondToOffer(
  c.params.id, acc(c), num(c.params.tid), str(c.body.decision) as never, c.body.counterFee ? num(c.body.counterFee) : undefined,
));
route("POST", career("scouting"), async (c) => game.scoutCountry(c.params.id, acc(c), str(c.body.countryCode)));
route("GET", career("settings"), async (c) => {
  const cr = await game.readCareer(c.params.id, acc(c));
  return { autoSubs: cr.manager.autoSubs ?? true, stopOn: { ...game.DEFAULT_STOP_ON, ...(cr.manager.stopOn ?? {}) }, labels: game.STOP_ON_LABEL };
});
route("POST", career("settings"), async (c) => game.updateCareerSettings(c.params.id, acc(c), c.body));
route("GET", career("verein"), async (c) => game.clubManagementView(c.params.id, acc(c)));
route("POST", career("verein/tickets"), async (c) => game.setTicketLevel(c.params.id, acc(c), str(c.body.level) as never));
route("POST", career("verein/fans"), async (c) => game.fanAction(c.params.id, acc(c), str(c.body.action) as never));
route("POST", career("verein/identity"), async (c) => game.updateIdentity(c.params.id, acc(c), c.body));
route("POST", career("verein/sponsor"), async (c) => game.chooseSponsor(c.params.id, acc(c), str(c.body.kind) as never));
route("GET", career("staff"), async (c) => game.staffView(c.params.id, acc(c)));
route("POST", career("staff/hire"), async (c) => game.hireStaff(c.params.id, acc(c), num(c.body.candidateId)));
route("POST", career("staff/fire"), async (c) => game.fireStaff(c.params.id, acc(c), num(c.body.memberId)));
route("POST", career("staff/renew"), async (c) => game.renewStaff(c.params.id, acc(c), num(c.body.memberId)));
route("GET", career("national"), async (c) => game.nationalView(c.params.id, acc(c)));
route("POST", career("national/job"), async (c) => game.takeNationalJob(c.params.id, acc(c), str(c.body.code)));
route("POST", career("national/resign"), async (c) => game.resignNationalJob(c.params.id, acc(c)));
route("GET", career("national/squad"), async (c) => game.nationalSquadView(c.params.id, acc(c)));
route("POST", career("national/squad"), async (c) => game.saveNationalSquad(c.params.id, acc(c), c.body));
route("GET", career("national/matches/:mid"), async (c) => game.nationalMatchReport(c.params.id, acc(c), num(c.params.mid)));
route("GET", career("media"), async (c) => game.mediaView(c.params.id, acc(c), c.query.get("filter")));
route("GET", career("dynamics"), async (c) => game.dynamicsView(c.params.id, acc(c)));
route("GET", career("awards"), async (c) => game.awardsView(c.params.id, acc(c)));
route("GET", career("contracts"), async (c) => game.contractsView(c.params.id, acc(c)));
route("GET", career("finances"), async (c) => game.financeView(c.params.id, acc(c)));
route("GET", career("career"), async (c) => game.careerView(c.params.id, acc(c)));
route("POST", career("shop"), async (c) => (c.body.item === "pack" ? game.buyCardPack(c.params.id, acc(c)) : game.buySkin(c.params.id, acc(c), str(c.body.item))));
route("POST", career("job"), async (c) => game.acceptJob(c.params.id, acc(c), num(c.body.clubId)));
route("GET", career("jobs"), async (c) => game.jobsView(c.params.id, acc(c), {
  status: str(c.query.get("status")), confed: str(c.query.get("confed")), country: str(c.query.get("country")),
  tier: c.query.get("tier") ? num(c.query.get("tier")) : undefined, q: str(c.query.get("q")), reachable: c.query.get("reachable") === "1",
  page: c.query.get("page") ? num(c.query.get("page")) : 1,
}));
route("POST", career("jobs/apply"), async (c) => game.applyForJob(c.params.id, acc(c), num(c.body.clubId)));
route("POST", career("jobs/withdraw"), async (c) => game.withdrawApplication(c.params.id, acc(c), num(c.body.clubId)));
route("POST", career("jobs/interest"), async (c) => game.toggleInterest(c.params.id, acc(c), num(c.body.clubId)));
route("POST", career("jobs/decline"), async (c) => game.declineOffer(c.params.id, acc(c), num(c.body.clubId)));
route("POST", career("jobs/resign"), async (c) => game.resignJob(c.params.id, acc(c)));
route("GET", career("inbox"), async (c) => game.inboxView(c.params.id, acc(c), { filter: str(c.query.get("filter")) || undefined, before: c.query.get("before") ? num(c.query.get("before")) : undefined }));
route("POST", career("inbox/archive"), async (c) => game.archiveInbox(c.params.id, acc(c), ((c.body.ids as unknown[]) ?? []).map(num)));
route("POST", career("inbox"), async (c) => game.markInboxRead(c.params.id, acc(c), c.body.ids === "all" ? "all" : ((c.body.ids as unknown[]) ?? []).map(num)));
route("GET", career("match/preview"), async (c) => {
  const cr = await game.readCareer(c.params.id, acc(c));
  return { preview: await game.matchPreview(game.pool(), cr), career: game.careerSummary(cr) };
});
route("GET", career("match/press"), async (c) => game.pressConference(c.params.id, acc(c)));
route("POST", career("match/press"), async (c) => game.answerPress(c.params.id, acc(c), (c.body.answers ?? {}) as Record<string, number>));
route("GET", career("match/teamtalk"), async (c) => game.teamTalkState(c.params.id, acc(c)));
route("POST", career("match/teamtalk"), async (c) => game.giveTeamTalk(c.params.id, acc(c), String(c.body.tone) as never));
route("POST", career("match/start"), async (c) => game.bg.startMatch(c.params.id, acc(c)));
route("POST", career("match/continue"), async (c) => game.bg.continueMatch(c.params.id, acc(c), (c.body ?? {}) as never));
route("POST", career("match/step"), async (c) => game.bg.stepMatch(c.params.id, acc(c), {
  change: (c.body.change ?? undefined) as never,
  until: c.body.until !== undefined ? num(c.body.until) : undefined,
}));
route("POST", career("match/shout"), async (c) => game.matchShout(c.params.id, acc(c), str(c.body.kind) as never));
route("POST", career("match/halftime"), async (c) => game.halftimeAddress(c.params.id, acc(c), str(c.body.tone) as never));
route("GET", career("match/post-talk"), async (c) => ({ talk: await game.postMatchState(game.pool(), await game.readCareer(c.params.id, acc(c))) }));
route("POST", career("match/post-talk"), async (c) => game.postMatchTalk(c.params.id, acc(c), str(c.body.tone) as never));
route("POST", career("match/quick"), async (c) => game.bg.quickMatch(c.params.id, acc(c)));

// ---------------------------------------------------------------- Dispatcher

function tokenFrom(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return req.cookies.get(SESSION_COOKIE)?.value ?? null;
}

/** Schutz vor CSRF: schreibende Anfragen per Cookie nur von der eigenen Herkunft. */
function sameOrigin(req: NextRequest): boolean {
  if (req.headers.get("authorization")) return true;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function dispatch(req: NextRequest, path: string[]): Promise<NextResponse> {
  const method = req.method.toUpperCase();
  let params: Params | null = null;
  const found = routes.find((r) => r.method === method && (params = match(r.parts, path)) !== null);
  if (!found || !params) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (method !== "GET" && !sameOrigin(req)) return NextResponse.json({ error: "Ungültige Herkunft" }, { status: 403 });
  let account: Account | null = null;
  try {
    const token = tokenFrom(req);
    account = token ? await game.accountForToken(token) : null;
    if (found.auth && !account) return NextResponse.json({ error: "Bitte melde dich an." }, { status: 401 });
    let body: Record<string, unknown> = {};
    if (method !== "GET" && method !== "DELETE") {
      const text = await req.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          return NextResponse.json({ error: "Ungültiges JSON" }, { status: 400 });
        }
      }
    }
    const result = (await found.handler({ req, params, body, query: req.nextUrl.searchParams, account, token })) as Record<string, unknown>;
    if (Array.isArray(result) || result === null || typeof result !== "object") return NextResponse.json(result ?? null);
    const { setCookie, clearCookie, ...payload } = (result ?? {}) as Record<string, unknown>;
    const res = NextResponse.json(payload);
    if (typeof setCookie === "string") {
      res.cookies.set(SESSION_COOKIE, setCookie, {
        httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
      });
    }
    if (clearCookie) res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (e) {
    if (e instanceof game.GameError) return NextResponse.json({ error: e.message }, { status: e.status });
    game.captureException(e, { source: "server", path: `${method} /api/${path.join("/")}`, accountId: account?.id, userAgent: req.headers.get("user-agent") });
    return NextResponse.json({ error: "Interner Fehler. Bitte versuche es erneut." }, { status: 500 });
  }
}
