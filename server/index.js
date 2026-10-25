// MoneyQuest API. Importable without opening sockets or starting timers.
import express from "express";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readChild, mutateChild, resetChild, subscribe, childIdFor, childrenWithDueWork, createChild, friendCode, childRecord, DEMO_FAMILY_ID } from "./store.js";
import * as game from "./domain.js";
import { GameError } from "./domain.js";
import { runGuardian, injectDuplicatePosting, reconcileNow } from "./guardian.js";
import { chat, queueReplan, cancelReplan, buddyMode, offlinePlan } from "./buddy.js";
import { actions } from "./actions.js";
import { dayKey, weekKey } from "./time.js";
import * as auth from "./auth.js";
import { takeLimit, withChat, openFamilyStream } from "./limits.js";
import { synthesize, voiceEnabled, mintAccessToken, voiceConfig, CARTESIA_VERSION } from "./voice.js";
import { setNessieAuditHook, nessieEnabled } from "./bank.js";
import { PLACES, HOME, LESSONS, COSMETICS, MILESTONES, POINTS, TRIP, placeStatus } from "./catalog.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SENT = Symbol("response sent");
const PAYOUT = /Paid|Executed|reversed/i;

// The hooks carry the document identity so async work never uses a global child.
game.onMoneyChanged((reason, db) => {
  const id = childIdFor(db);
  if (id) queueReplan(id, reason);
});
setNessieAuditHook((action, detail, data, document) => {
  const id = childIdFor(document);
  if (!id || readChild(id) !== document) return;
  mutateChild(id, (db) => {
    if (document.nessie) db.nessie = document.nessie;
    game.audit(db, "bank", action, detail, data);
  });
});

export function applyAction(db, fn, trigger, { now = Date.now(), onReplan = () => {} } = {}) {
  const repairs = reconcileNow(db, now, trigger);
  const out = fn(db);
  if (repairs.some((action) => /reversed/i.test(action))) onReplan("Guardian reversed a duplicate posting");
  const paid = runGuardian(db, now, trigger).filter((a) => PAYOUT.test(a));
  if (paid.length) onReplan(paid.map((a) => a.replace(/^G\d:\s*/, "").split(" (")[0]).join("; "));
  return out;
}

export function runChildAction(childId, fn, trigger, now = Date.now()) {
  return mutateChild(childId, (db) => applyAction(db, fn, trigger, { now, onReplan: (reason) => queueReplan(childId, reason) }));
}

export function tick(now = Date.now()) {
  const due = childrenWithDueWork(now);
  for (const childId of due) {
    game.expireSocialTrades(childId, now);
    runChildAction(childId, (db) => game.finalizeAdventures(db, now), "tick", now);
  }
  return due;
}

// ------------------------------------------------------------------ views
function placesView(db, now = Date.now()) {
  const owned = game.visitedSet(db);
  return Object.fromEntries(Object.entries(PLACES).map(([id, p]) => {
    const status = placeStatus(id, db.child, owned, owned, new Date(now), db.settings.timezone);
    if (status.hidden) {
      return [id, { rarity: "secret", hidden: true, clue: p.discover.text, lon: id === "hawaii_volcanoes_national_park" ? p.lon : null, lat: id === "hawaii_volcanoes_national_park" ? p.lat : null }];
    }
    const { discover, ...rest } = p;
    return [id, { ...rest, image: `/postcards/${id}.png`, open: status.ok, lockReason: status.ok ? null : status.reason, progress: status.progress || null }];
  }));
}

export function childView(db, now = Date.now()) {
  const day = dayKey(now, db.settings.timezone);
  const week = weekKey(now, db.settings.timezone);
  return {
    version: db.version,
    demo: game.isDemoChild(db),
    friendCode: childIdFor(db) ? friendCode(childIdFor(db)) : null,
    now,
    dayKey: day,
    weekKey: week,
    offline: false,
    budgetDoneThisWeek: db.child.lastBudgetWeek === week,
    child: db.child,
    balances: { savings: db.accounts.savings.balance, spending: db.accounts.spending.balance, wallet: db.accounts.wallet.balance },
    walletLastTransaction: db.transactions.findLast((t) => ["wallet_in", "wallet_spend"].includes(t.kind)) || null,
    goals: db.savingsGoals.map((g) => ({ ...g, weeksLeft: game.weeksToGoal(db, g) })),
    allowance: { amount: db.allowance.amount, savePct: db.allowance.savePct, nextRun: db.allowance.nextRun, spendLimit: db.allowance.spendLimit },
    parentGoals: db.parentGoals,
    missions: db.missions,
    transactions: db.transactions.filter((t) => t.kind !== "funding_in" && (t.from !== "parent" || t.to !== "parent")).slice(-30).reverse(),
    notifications: db.notifications.filter((n) => n.to === "child").slice(-20).reverse(),
    adventures: db.adventures.slice(-10).reverse().map(({ destId, ...adventure }) => adventure.status === "away" ? adventure : { ...adventure, destId }),
    postcards: db.postcards,
    metrics: { postcards: game.postcardMetrics(db) },
    friends: game.socialFriendsView(db),
    trades: game.socialTradesView(db),
    pendingRequests: game.socialApprovalsView(db).filter((a) => a.status === "pending" && ["spend", "extra", "reward", "task", "friend", "friend_request", "trade"].includes(a.kind)).map((a) => ({ id: a.id, kind: a.kind, title: a.real && a.kind === "friend_request" ? "Friend request waiting for grown-ups" : a.title })),
    plan: db.buddy.plan,
    chat: db.buddy.chat.slice(-30),
    settings: { ...db.settings, coopChallenge: game.isDemoChild(db) && db.settings.coopChallenge },
    catalog: {
      // Secrets stay out of the payload until discovered.
      places: placesView(db, now),
      home: HOME,
      // Answers stay on the server.
      lessons: LESSONS.map((l) => ({ ...l, questions: l.questions.map(({ q, options }) => ({ q, options })) })),
      cosmetics: COSMETICS.map((c) => ({ ...c, unlocked: game.cosmeticUnlocked(db, c) })),
      milestones: MILESTONES,
      points: POINTS,
      trip: TRIP,
      greetings: game.GREETINGS,
    },
    integrations: { buddy: buddyMode(), voice: voiceEnabled() ? "cartesia" : "browser", bank: nessieEnabled() ? "nessie" : "simulated" },
  };
}

export function parentView(db, before) {
  let end = db.buddy.chat.length;
  if (before !== undefined) {
    if (typeof before !== "string" || before.length > 64) throw new GameError("Pick a chat message");
    end = db.buddy.chat.findIndex((m) => m.id === before);
    if (end < 0) throw new GameError("That chat message is no longer available");
  }
  const chat = db.buddy.chat.slice(Math.max(0, end - 200), end);
  return {
    ...childView(db),
    adventures: db.adventures.slice(-10).reverse(),
    family: { parentName: db.family.parentName },
    chat,
    chatNextBefore: end > chat.length ? chat[0]?.id : null,
    accounts: db.accounts,
    allowance: db.allowance,
    approvals: game.socialApprovalsView(db).slice().reverse(),
    notifications: db.notifications.filter((n) => n.to === "parent").slice().reverse()
      .filter((n, i, all) => !n.ref || all.findIndex((other) => other.ref === n.ref) === i).slice(0, 30),
    transactions: db.transactions.slice(-60).reverse(),
    audit: db.audit.slice(-120).reverse(),
    tracking: db.tracking.slice(-20).reverse(),
    walletTransactions: db.transactions.filter((t) => ["wallet_in", "wallet_spend"].includes(t.kind)).slice(-60).reverse(),
    walletLastPing: db.walletLastPing || null,
    friends: game.socialFriendsView(db),
  };
}

// These are the actual HTTP actions, also exercised directly by socket-free tests.
export const routeActions = [];
function register(method, path, access, handler) {
  routeActions.push({ method, path, access, handler });
}
function options(req, now) {
  return { ip: req.ip || "unknown", ua: req.get?.("user-agent") || req.headers?.["user-agent"], now };
}
function signedIn(req, res, result, now) {
  res.set("Set-Cookie", auth.cookieHeader(req, result.session, result.token, now));
  return auth.me(auth.resolveContext({ headers: { authorization: `Bearer ${result.token}` } }, {}, now));
}
register("POST", "/api/auth/register", "public", (req, ctx, res, now) => signedIn(req, res, auth.register(req.body, options(req, now)), now));
register("POST", "/api/auth/login", "public", (req, ctx, res, now) => signedIn(req, res, auth.login(req.body, options(req, now)), now));
register("POST", "/api/auth/link", "public", (req, ctx, res, now) => signedIn(req, res, auth.redeemLink(req.body, options(req, now)), now));
register("POST", "/api/auth/logout", "session", (req, ctx, res, now) => {
  auth.logout(ctx.session);
  res.set("Set-Cookie", auth.cookieHeader(req, ctx.session, null, now));
  return { ok: true };
});
register("POST", "/api/auth/logout-all", "parent", (req, ctx, res, now) => {
  auth.logoutAll(ctx.session);
  res.set("Set-Cookie", auth.cookieHeader(req, ctx.session, null, now));
  return { ok: true };
});
register("GET", "/api/auth/me", "session", (req, ctx) => auth.me(ctx));
register("POST", "/api/demo/login", "public", (req, ctx, res, now) => signedIn(req, res, auth.demoLogin(options(req, now)), now));
register("POST", "/api/parent/pin", "parent", (req, ctx, res, now) => auth.setPin(ctx, req.body, now));
register("POST", "/api/parent/unlock", "lockedParent", (req, ctx, res, now) => auth.unlock(ctx, req.body, now));
register("POST", "/api/parent/lock", "lockedParent", (req, ctx) => auth.lock(ctx));
register("POST", "/api/parent/pin/reset", "lockedParent", (req, ctx, res, now) => auth.resetPin(ctx, req.body, options(req, now)));
register("GET", "/api/parent/children/:id/devices", "parent", (req, ctx, res, now) => auth.childDevices(ctx, req.params.id, now));
register("DELETE", "/api/parent/children/:id/devices/:sessionId", "parent", (req, ctx) => auth.unlinkDevice(ctx, req.params.id, req.params.sessionId));
register("POST", "/api/parent/children", "parent", (req, ctx) => createChild(ctx.family.id, req.body));
register("POST", "/api/parent/children/:id/link", "parent", (req, ctx, res, now) => auth.createLink(ctx, req.params.id, now));
register("GET", "/api/state", "child", (req, ctx, res, now) => { game.expireSocialTrades(ctx.childId, now); return { childId: ctx.childId, ...childView(readChild(ctx.childId), now) }; });
register("GET", "/api/parent/state", "parent", (req, ctx, res, now) => { game.expireSocialTrades(ctx.childId, now); return { childId: ctx.childId, ...parentView(readChild(ctx.childId), req.query?.before) }; });
register("GET", "/api/child/wallet/token", "parent", (req, ctx, res, now) => auth.walletToken(ctx, { now }));
register("POST", "/api/child/wallet/token", "parent", (req, ctx, res, now) => {
  actions.walletPing(null, req.body);
  return auth.walletToken(ctx, { rotate: true, now });
});
register("POST", "/api/child/wallet/ping", "child", (req, ctx, res, now) => {
  takeLimit("walletPing", `${ctx.childId}:${ctx.session.token_hash}`, now, { retryAfter: true });
  actions.walletPing(null, req.body);
  mutateChild(ctx.childId, (db) => { db.walletLastPing = now; });
  return { ok: true, childId: ctx.childId, at: now };
});
register("POST", "/api/child/wallet/spend", "child", (req, ctx, res, now) => {
  takeLimit("walletSpend", `${ctx.childId}:${ctx.session.token_hash}`, now, { retryAfter: true });
  return runChildAction(ctx.childId, (db) => actions.walletSpend(db, req.body), "walletSpend", now);
});
register("POST", "/api/parent/wallet/send", "parent", (req, ctx, res, now) => runChildAction(ctx.childId, (db) => actions.walletSend(db, req.body), "wallet_in", now));

export function stream(req, context, res) {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  let closed = false;
  let off = () => {}, release = () => {}, ping;
  const close = () => {
    if (closed) return;
    closed = true;
    off();
    release();
    clearInterval(ping);
    res.end();
  };
  const send = (version, childId) => {
    if (closed || (context.role === "child" && childId !== context.childId)) return;
    try { auth.authenticate(req); } catch { close(); return; }
    if (res.write(`data: ${JSON.stringify({ childId, version })}\n\n`) === false) close();
  };
  release = openFamilyStream(context.family.id, close);
  off = subscribe(context.family.id, send);
  send(readChild(context.childId).version, context.childId);
  if (!closed) {
    ping = setInterval(() => {
      // Long-lived streams must stop when a session expires or logs out too.
      try { auth.authenticate(req); } catch { close(); return; }
      if (res.write(": ping\n\n") === false) close();
    }, 25000);
    ping.unref?.();
    req.on("close", close);
    res.on?.("close", close);
  }
  return SENT;
}
register("GET", "/api/stream", "child", stream);

const childActions = {
  save: "save", spend: "spend", journal: "journal", extra: "extra", lesson: "lesson", budget: "budget",
  "cosmetic/buy": "buyCosmetic", "cosmetic/equip": "equip", "bear/name": "renameBear",
};
for (const [path, action] of Object.entries(childActions)) {
  register("POST", `/api/child/${path}`, "child", (req, ctx, res, now) => runChildAction(ctx.childId, (db) => actions[action](db, req.body), action, now));
}
for (const action of ["friend", "trade", "greet"]) {
  register("POST", `/api/child/${action}`, "child", (req, ctx, res, now) => {
    game.expireSocialTrades(ctx.childId, now);
    const d = readChild(ctx.childId);
    const practice = ctx.family.id === DEMO_FAMILY_ID && (action === "friend"
      ? typeof req.body?.code === "string" && /-/.test(req.body.code)
      : d.friends.some((f) => f.id === req.body?.friendId && !f.real));
    if (practice) return runChildAction(ctx.childId, (db) => actions[action](db, req.body), action, now);
    return game.runSocialAction(ctx.childId, action, req.body, undefined, now);
  });
}
register("POST", "/api/child/friend/:id/respond", "child", (req, ctx, res, now) => game.runSocialAction(ctx.childId, "friendRespond", req.body, req.params.id, now));
register("POST", "/api/child/trade/:id/respond", "child", (req, ctx, res, now) => game.runSocialAction(ctx.childId, "tradeRespond", req.body, req.params.id, now));
register("POST", "/api/parent/friend/:id/remove", "parent", (req, ctx, res, now) => game.runSocialAction(ctx.childId, "unfriend", req.body, req.params.id, now));
register("POST", "/api/parent/children/:id/friend-code", "parent", (req, ctx) => {
  if (childRecord(req.params.id)?.family_id !== ctx.family.id) throw new GameError("Child not found", 404);
  return mutateChild(req.params.id, (d) => {
    const code = friendCode(req.params.id, true);
    game.audit(d, "parent", "friend_code_regenerated", "Friend code replaced");
    return { friendCode: code };
  });
});
// Surprise destinations stay private in action responses as well as state.
for (const action of ["trip", "adventure"]) {
  register("POST", `/api/child/${action}`, "child", (req, ctx, res, now) => {
    const { destId, ...adventure } = runChildAction(ctx.childId, (db) => actions[action](db, req.body), action, now);
    return adventure;
  });
}
register("POST", "/api/child/adventure/:id/seen", "child", (req, ctx, res, now) => runChildAction(ctx.childId, (db) => actions.adventureSeen(db, req.params.id), "adventure_seen", now));
register("POST", "/api/parent/goal/:id/cancel", "parent", (req, ctx, res, now) => runChildAction(ctx.childId, (db) => actions.cancelGoal(db, req.params.id), "goal_cancelled", now));
register("POST", "/api/child/mission/:id/done", "child", (req, ctx, res, now) => runChildAction(ctx.childId, (db) => actions.missionDone(db, req.params.id), "mission_done", now));
register("POST", "/api/child/notifications/read", "child", (req, ctx) => {
  mutateChild(ctx.childId, (db) => { db.notifications.forEach((n) => { if (n.to === "child") n.read = true; }); });
});
register("POST", "/api/buddy/chat", "child", (req, ctx, res, now) => actions.chat(readChild(ctx.childId), req.body,
  (text) => withChat(ctx.childId, () => chat(ctx.childId, text), now)));
function buddyEnabled(childId) {
  if (!readChild(childId).settings.buddyEnabled) throw new GameError("Money Buddy is turned off by your grown-up");
}
register("POST", "/api/buddy/speak", "child", async (req, ctx, res, now) => {
  buddyEnabled(ctx.childId);
  const text = actions.speakText(null, req.body);
  takeLimit("speak", ctx.childId, now);
  if (!voiceEnabled()) throw new GameError("Voice is not configured", 404);
  const audio = await synthesize(text);
  res.set("Content-Type", "audio/mpeg").send(audio);
  return SENT;
});
register("POST", "/api/voice/token", "child", async (req, ctx, res, now) => {
  buddyEnabled(ctx.childId);
  takeLimit("voice", ctx.childId, now);
  if (!voiceEnabled()) throw new GameError("Voice is not configured", 404);
  return { token: await mintAccessToken(), version: CARTESIA_VERSION, request: voiceConfig() };
});
for (const action of ["approval", "goal", "mission", "allowance", "settings", "savingsGoal", "fundingAdd"]) {
  const path = action === "fundingAdd" ? "funding/add" : action === "savingsGoal" ? "savings-goal" : action === "approval" ? "approval/:id" : action;
  register("POST", `/api/parent/${path}`, "parent", (req, ctx, res, now) => {
    if (action === "approval") {
      const a = readChild(ctx.childId).approvals.find((a) => a.id === req.params.id);
      if (a?.real) return game.runSocialAction(ctx.childId, "approval", req.body, req.params.id, now);
      // Foreign social approval IDs have the same response as unknown IDs.
      if (!a) throw new GameError("Request not found", 404);
    }
    const out = runChildAction(ctx.childId, (db) => actions[action](db, req.body, req.params.id), action, now);
    if (action === "settings" && !readChild(ctx.childId).settings.buddyEnabled) cancelReplan(ctx.childId);
    return out;
  });
}
export function demoRunNow(db, now = Date.now()) {
  game.requestAllowanceRun(db, now);
  game.audit(db, "parent", "demo_allowance_run", "Demo control: fast-forward allowance");
}
function demoControl(context) {
  if (process.env.MQ_DEMO !== "1" || context.family.id !== DEMO_FAMILY_ID) throw new GameError("Demo control unavailable", 404);
}
register("POST", "/api/parent/allowance/run-now", "parent", (req, ctx, res, now) => {
  demoControl(ctx);
  return runChildAction(ctx.childId, (db) => demoRunNow(db, now), "demo_fast_forward", now);
});
register("POST", "/api/parent/topup", "parent", (req, ctx, res, now) => {
  demoControl(ctx);
  return runChildAction(ctx.childId, (db) => {
    actions.topup(db, req.body);
    game.audit(db, "parent", "demo_topup", "Demo control: simulated funding deposit");
  }, "demo_topup", now);
});
register("POST", "/api/parent/inject-fault", "parent", (req, ctx) => {
  demoControl(ctx);
  return mutateChild(ctx.childId, (db) => {
    const duplicate = injectDuplicatePosting(db);
    if (!duplicate) throw new GameError("Nothing to duplicate yet — run an allowance first");
    game.audit(db, "parent", "demo_fault", "Demo control: injected a duplicate posting");
    return { injected: duplicate.id };
  });
});
register("POST", "/api/parent/reset", "parent", (req, ctx) => {
  demoControl(ctx);
  cancelReplan(ctx.childId);
  resetChild(ctx.childId);
  mutateChild(ctx.childId, (db) => {
    db.buddy.plan = offlinePlan(db, "starting plan");
    game.audit(db, "parent", "demo_reset", "Demo control: reset this child");
  });
  return { ok: true };
});

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(self)",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://api.cartesia.ai https://fonts.googleapis.com https://fonts.gstatic.com",
};

async function execute(entry, req, res, now) {
  let context;
  if (entry.access !== "public") {
    context = auth.resolveContext(req, {
      parent: ["parent", "lockedParent"].includes(entry.access), unlocked: entry.access === "parent",
    }, now);
    const token = auth.sessionToken(req);
    res.set("Set-Cookie", auth.cookieHeader(req, context.session, token, now));
  }
  return entry.handler(req, context, res, now);
}

export async function dispatch(method, pathname, req, res, now = Date.now()) {
  res.set({ ...SECURITY_HEADERS, "Cache-Control": "no-store" });
  try {
    if (pathname.startsWith("/api/demo") && process.env.MQ_DEMO !== "1") throw new GameError("Not found", 404);
    for (const entry of routeActions) {
      if (entry.method !== method) continue;
      const names = [];
      const pattern = entry.path.replace(/:([a-zA-Z]+)/g, (_, name) => { names.push(name); return "([^/]+)"; });
      const match = new RegExp(`^${pattern}$`).exec(pathname);
      if (!match) continue;
      req.params = {};
      names.forEach((name, i) => { req.params[name] = match[i + 1]; });
      const result = await execute(entry, req, res, now);
      if (result !== SENT) res.json(result ?? { ok: true });
      return;
    }
    throw new GameError("Not found", 404);
  } catch (e) {
    if (e instanceof GameError) {
      const body = { error: e.message };
      for (const key of ["attemptsLeft", "retryAfterSeconds", "reason"]) if (e[key] !== undefined) body[key] = e[key];
      if (e.retryAfterSeconds !== undefined) res.set("Retry-After", String(e.retryAfterSeconds));
      if (method === "GET" && pathname === "/api/auth/me" && e.status === 401) body.demo = process.env.MQ_DEMO === "1";
      return res.status(e.status).json(body);
    }
    console.error(e);
    res.status(500).json({ error: "Something went wrong" });
  }
}

export function createApp() {
  const app = express();
  app.use((req, res, next) => { res.set(SECURITY_HEADERS); next(); });
  app.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (req, res) => dispatch(req.method, `/api${req.path}`, req, res));
  const dist = path.join(here, "..", "dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res, next) => res.sendFile(path.join(dist, "index.html"), (err) => err && next()));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === "entity.too.large") return res.status(413).json({ error: "That message is too big. Keep it short!" });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Send the form fields together" });
    if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: "Send a small JSON form, please" });
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  nessieEnabled(); // Reject an insecure mirror configuration before listening.
  auth.initializeAccounts();
  setInterval(() => {
    try { tick(); } catch (e) { console.error("[tick]", e.message); }
  }, 2000);
  createApp().listen(Number(process.env.PORT || 8787), () => {
    console.log(`MoneyQuest API ready (buddy: ${buddyMode()}, bank: ${nessieEnabled() ? "nessie" : "simulated"})`);
  });
}
