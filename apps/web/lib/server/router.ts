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

route("POST", "auth/register", async (c) => {
  const { account, token } = await game.register(str(c.body.email), str(c.body.password), str(c.body.displayName));
  return { account: publicAccount(account), token: c.body.returnToken ? token : undefined, setCookie: token };
}, false);

route("POST", "auth/login", async (c) => {
  const { account, token } = await game.login(str(c.body.email), str(c.body.password));
  return { account: publicAccount(account), token: c.body.returnToken ? token : undefined, setCookie: token };
}, false);

route("POST", "auth/logout", async (c) => {
  if (c.token) await game.logout(c.token);
  return { ok: true, clearCookie: true };
}, false);

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

function publicAccount(a: Account) {
  return { id: a.id, email: a.email, displayName: a.display_name, settings: a.settings, login_streak: a.login_streak };
}

// ---------------------------------------------------------------- Welt & Karrieren

route("GET", "health", async () => {
  await game.pool().query("select 1");
  return { ok: true };
}, false);
route("GET", "world", async () => game.worldMeta(), false);
route("GET", "world/preview", async (c) => game.previewClubs(num(c.query.get("seed") ?? 1), str(c.query.get("country"))), false);
route("GET", "leaderboards", async () => game.leaderboards(), false);

route("GET", "careers", async (c) => ({ careers: await game.listCareers(acc(c)) }));
route("POST", "careers", async (c) => ({
  id: await game.createCareer(acc(c), {
    managerName: str(c.body.managerName),
    countryCode: str(c.body.countryCode),
    clubIndex: num(c.body.clubIndex),
    seed: c.body.seed !== undefined ? num(c.body.seed) : undefined,
  }),
}));
route("DELETE", "careers/:id", async (c) => {
  await game.deleteCareer(acc(c), c.params.id);
  return { ok: true };
});

const career = (pattern: string) => `careers/:id/${pattern}`.replace(/\/$/, "");

route("POST", career("checkin"), async (c) => game.checkin(c.params.id, acc(c)));
route("GET", career("dashboard"), async (c) => game.dashboard(c.params.id, acc(c)));
route("POST", career("advance"), async (c) => game.advance(c.params.id, acc(c)));
route("GET", career("squad"), async (c) => game.squadView(c.params.id, acc(c)));
route("GET", career("tactic"), async (c) => game.tacticView(c.params.id, acc(c)));
route("PUT", career("tactic"), async (c) => game.saveTactic(c.params.id, acc(c), c.body as never));
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
    case "demand": return game.contractDemand(c.params.id, acc(c), pid);
    case "renew": return game.renewContract(c.params.id, acc(c), pid, num(c.body.wage), num(c.body.years));
    case "loan_in": return game.loanIn(c.params.id, acc(c), pid, Number(c.body.wageShare ?? 1));
    case "loan_out": return game.loanOut(c.params.id, acc(c), pid);
    case "talk": return game.talkToPlayer(c.params.id, acc(c), pid, String(c.body.topic) as never);
    case "individual": return game.setIndividualTraining(c.params.id, acc(c), pid, (c.body.focus as string) || null, (c.body.position as string) || null);
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
    listedOnly: q.get("listed") === "1", shortlistOnly: q.get("shortlist") === "1",
    sort: (q.get("sort") as never) ?? undefined, page: n("page"),
  });
});
route("POST", career("offers"), async (c) => game.makeOffer(c.params.id, acc(c), {
  playerId: num(c.body.playerId), fee: num(c.body.fee ?? 0), wage: num(c.body.wage ?? 0), years: num(c.body.years ?? 3),
  releaseClause: c.body.releaseClause ? num(c.body.releaseClause) : null,
}));
route("POST", career("offers/:tid"), async (c) => game.respondToOffer(
  c.params.id, acc(c), num(c.params.tid), str(c.body.decision) as never, c.body.counterFee ? num(c.body.counterFee) : undefined,
));
route("POST", career("scouting"), async (c) => game.scoutCountry(c.params.id, acc(c), str(c.body.countryCode)));
route("GET", career("contracts"), async (c) => game.contractsView(c.params.id, acc(c)));
route("GET", career("finances"), async (c) => game.financeView(c.params.id, acc(c)));
route("POST", career("staff"), async (c) => game.upgradeStaff(c.params.id, acc(c), str(c.body.role) as never));
route("GET", career("career"), async (c) => game.careerView(c.params.id, acc(c)));
route("POST", career("shop"), async (c) => (c.body.item === "pack" ? game.buyCardPack(c.params.id, acc(c)) : game.buySkin(c.params.id, acc(c), str(c.body.item))));
route("POST", career("job"), async (c) => game.acceptJob(c.params.id, acc(c), num(c.body.clubId)));
route("POST", career("inbox"), async (c) => game.markInboxRead(c.params.id, acc(c), c.body.ids === "all" ? "all" : ((c.body.ids as unknown[]) ?? []).map(num)));
route("GET", career("match/preview"), async (c) => {
  const cr = await game.readCareer(c.params.id, acc(c));
  return { preview: await game.matchPreview(game.pool(), cr), career: game.careerSummary(cr) };
});
route("GET", career("match/press"), async (c) => game.pressConference(c.params.id, acc(c)));
route("POST", career("match/press"), async (c) => game.answerPress(c.params.id, acc(c), (c.body.answers ?? {}) as Record<string, number>));
route("GET", career("match/teamtalk"), async (c) => game.teamTalkState(c.params.id, acc(c)));
route("POST", career("match/teamtalk"), async (c) => game.giveTeamTalk(c.params.id, acc(c), String(c.body.tone) as never));
route("POST", career("match/start"), async (c) => game.startMatch(c.params.id, acc(c)));
route("POST", career("match/continue"), async (c) => game.continueMatch(c.params.id, acc(c), (c.body ?? {}) as never));
route("POST", career("match/step"), async (c) => game.stepMatch(c.params.id, acc(c), {
  change: (c.body.change ?? undefined) as never,
  until: c.body.until !== undefined ? num(c.body.until) : undefined,
}));
route("POST", career("match/quick"), async (c) => game.quickMatch(c.params.id, acc(c)));

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
  try {
    const token = tokenFrom(req);
    const account = token ? await game.accountForToken(token) : null;
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
    console.error(e);
    return NextResponse.json({ error: "Interner Fehler. Bitte versuche es erneut." }, { status: 500 });
  }
}
