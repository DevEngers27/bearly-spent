// MoneyQuest API server.
import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { read, mutate, reset, subscribe } from "./store.js";
import * as game from "./domain.js";
import { GameError } from "./domain.js";
import { runGuardian, hasDueWork, spendPolicy, injectDuplicatePosting } from "./guardian.js";
import { chat, replan, buddyMode, offlinePlan } from "./buddy.js";
import { synthesize, voiceEnabled, mintAccessToken, voiceConfig, CARTESIA_VERSION } from "./voice.js";
import { setNessieAuditHook, nessieEnabled } from "./bank.js";
import { PLACES, HOME, LESSONS, COSMETICS, MILESTONES, POINTS, placeStatus } from "./catalog.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const app = express();
app.use(express.json({ limit: "64kb" }));

// ------------------------------------------------------------------ helpers
setNessieAuditHook((action, detail, data) => mutate((db) => game.audit(db, "bank", action, detail, data)));

// Re-plan (debounced) whenever real money moves — child actions or guardian payouts.
let replanTimer = null;
const pendingReasons = [];
function queueReplan(reason) {
  pendingReasons.push(reason);
  clearTimeout(replanTimer);
  replanTimer = setTimeout(() => {
    const why = pendingReasons.splice(0).join("; ");
    if (read().settings.buddyEnabled) replan(why).catch((e) => console.error("[replan]", e.message));
  }, 1500);
}
game.onMoneyChanged(queueReplan);

const PAYOUT = /Paid|Executed|reversed/i;
function guardianPass(db, trigger) {
  const actions = runGuardian(db, Date.now(), trigger);
  const paid = actions.filter((a) => PAYOUT.test(a));
  if (paid.length) queueReplan(paid.map((a) => a.replace(/^G\d:\s*/, "").split(" (")[0]).join("; "));
  return actions;
}

/** Run a mutation, then let the guardian react to the new state. */
function act(fn, trigger) {
  return mutate((db) => {
    const out = fn(db);
    guardianPass(db, trigger);
    return out;
  });
}

const route = (handler) => async (req, res) => {
  try {
    res.json((await handler(req, res)) ?? { ok: true });
  } catch (e) {
    if (e instanceof GameError) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: "Something went wrong" });
  }
};

// Parent session: PIN → bearer token (in-memory, demo-grade).
const parentTokens = new Set();
function requireParent(req, res, next) {
  const tok = req.get("x-parent-token");
  if (!tok || !parentTokens.has(tok)) return res.status(401).json({ error: "Parent PIN required" });
  next();
}
const cents = (v) => Math.round(Number(v) * 100);

// ------------------------------------------------------------------ views
function placesView(db) {
  const owned = game.visitedSet(db);
  const now = new Date();
  return Object.fromEntries(Object.entries(PLACES).map(([id, p]) => {
    const status = placeStatus(id, db.child, owned, owned, now);
    if (status.hidden) {
      return [id, { rarity: "secret", hidden: true, clue: p.discover.text, lon: id === "hawaii_volcanoes_national_park" ? p.lon : null, lat: id === "hawaii_volcanoes_national_park" ? p.lat : null }];
    }
    const { discover, ...rest } = p;
    return [id, { ...rest, image: `/postcards/${id}.png`, open: status.ok, lockReason: status.ok ? null : status.reason, progress: status.progress || null }];
  }));
}

function childView(db) {
  const now = Date.now();
  const d = new Date(now), onejan = new Date(d.getFullYear(), 0, 1);
  const week = `${d.getFullYear()}-w${Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)}`;
  return {
    version: db.version,
    now,
    offline: false,
    budgetDoneThisWeek: db.child.lastBudgetWeek === week,
    child: db.child,
    balances: { savings: db.accounts.savings.balance, spending: db.accounts.spending.balance },
    goals: db.savingsGoals.map((g) => ({ ...g, weeksLeft: game.weeksToGoal(db, g) })),
    allowance: { amount: db.allowance.amount, savePct: db.allowance.savePct, nextRun: db.allowance.nextRun, spendLimit: db.allowance.spendLimit },
    parentGoals: db.parentGoals,
    missions: db.missions,
    transactions: db.transactions.filter((t) => t.from !== "parent" || t.to !== "parent").slice(-30).reverse(),
    notifications: db.notifications.filter((n) => n.to === "child").slice(-20).reverse(),
    adventures: db.adventures.slice(-10).reverse(),
    postcards: db.postcards,
    friends: db.friends.filter((f) => f.status !== "declined").map(game.friendView),
    trades: db.trades.slice(-10).reverse(),
    pendingRequests: db.approvals.filter((a) => a.status === "pending" && ["spend", "extra", "reward", "task", "friend", "trade"].includes(a.kind)).map((a) => ({ id: a.id, kind: a.kind, title: a.title })),
    plan: db.buddy.plan,
    chat: db.buddy.chat.slice(-30),
    settings: db.settings,
    catalog: {
      // Secrets stay out of the payload until discovered.
      places: placesView(db),
      home: HOME,
      // Answers stay on the server.
      lessons: LESSONS.map((l) => ({ ...l, questions: l.questions.map(({ q, options }) => ({ q, options })) })),
      cosmetics: COSMETICS.map((c) => ({ ...c, unlocked: game.cosmeticUnlocked(db, c) })),
      milestones: MILESTONES,
      points: POINTS,
      greetings: game.GREETINGS,
    },
    integrations: { buddy: buddyMode(), voice: voiceEnabled() ? "cartesia" : "browser", bank: nessieEnabled() ? "nessie" : "simulated" },
  };
}

function parentView(db) {
  return {
    ...childView(db),
    family: { parentName: db.family.parentName },
    accounts: db.accounts,
    allowance: db.allowance,
    approvals: db.approvals.slice().reverse(),
    notifications: db.notifications.filter((n) => n.to === "parent").slice(-30).reverse(),
    transactions: db.transactions.slice(-60).reverse(),
    audit: db.audit.slice(-120).reverse(),
    tracking: db.tracking.slice(-20).reverse(),
    friends: db.friends,
  };
}

// ------------------------------------------------------------------ routes: shared
app.get("/api/state", (req, res) => res.json(childView(read())));
app.get("/api/parent/state", requireParent, (req, res) => res.json(parentView(read())));

app.get("/api/stream", (req, res) => {
  // no-transform + X-Accel-Buffering ask proxies (tunnels, nginx) not to buffer.
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write(`: ${" ".repeat(2048)}\n\n`); // padding pushes the first chunk through buffering proxies
  res.write(`data: ${read().version}\n\n`);
  const off = subscribe((v) => res.write(`data: ${v}\n\n`));
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    off();
    clearInterval(ping);
  });
});

app.post("/api/parent/login", route((req) => {
  if (String(req.body.pin) !== read().family.parentPin) throw new GameError("Wrong PIN", 401);
  const token = crypto.randomBytes(16).toString("hex");
  parentTokens.add(token);
  return { token };
}));

// ------------------------------------------------------------------ routes: child
app.post("/api/child/save", route((req) => act((db) => game.childSave(db, cents(req.body.amount)), "child_save")));
app.post("/api/child/spend", route((req) => act((db) => game.childSpend(db, { amount: cents(req.body.amount), memo: req.body.memo }, spendPolicy), "child_spend")));
app.post("/api/child/journal", route((req) => act((db) => game.journal(db, { direction: req.body.direction, amount: cents(req.body.amount || 0), note: req.body.note }), "journal")));
app.post("/api/child/extra", route((req) => act((db) => game.requestExtraAllowance(db, { amount: cents(req.body.amount), reason: req.body.reason }), "extra_request")));
app.post("/api/child/lesson", route((req) => act((db) => game.completeLesson(db, req.body.lessonId, req.body.answers), "lesson")));
app.post("/api/child/budget", route((req) => act((db) => game.completeBudget(db, Object.fromEntries(Object.entries(req.body.allocations || {}).map(([k, v]) => [k, cents(v)]))), "budget")));
app.post("/api/child/mission/:id/done", route((req) => act((db) => game.childMarkMissionDone(db, req.params.id), "mission_done")));
app.post("/api/child/adventure", route((req) => act((db) => game.startAdventure(db, req.body.destId), "adventure")));
app.post("/api/child/cosmetic/buy", route((req) => act((db) => game.buyCosmetic(db, req.body.id), "cosmetic")));
app.post("/api/child/cosmetic/equip", route((req) => act((db) => game.equip(db, req.body.kind, req.body.value ?? null), "equip")));
app.post("/api/child/bear/name", route((req) => act((db) => game.renameBear(db, req.body.name), "rename")));
app.post("/api/child/friend", route((req) => act((db) => game.friendView(game.addFriendByCode(db, req.body.code)), "friend")));
app.post("/api/child/trade", route((req) => act((db) => game.proposeTrade(db, req.body.friendId, req.body.give, req.body.get), "trade")));
app.post("/api/child/greet", route((req) => act((db) => game.sendGreeting(db, req.body.friendId, Number(req.body.index)), "greet")));
app.post("/api/child/notifications/read", route(() => mutate((db) => db.notifications.forEach((n) => n.to === "child" && (n.read = true)))));
app.post("/api/buddy/chat", route(async (req) => {
  if (!read().settings.buddyEnabled) throw new GameError("Money Buddy is turned off by your grown-up");
  return chat(req.body.text);
}));
// Cartesia voice: hand the browser a short-lived TTS-only token (the API key
// stays here). Light rate limit, since anyone who can load the page can call it.
let tokenWindow = { start: 0, count: 0 };
app.post("/api/voice/token", async (req, res) => {
  if (!voiceEnabled()) return res.status(404).json({ error: "voice not configured" });
  const now = Date.now();
  if (now - tokenWindow.start > 60000) tokenWindow = { start: now, count: 0 };
  if (++tokenWindow.count > 20) return res.status(429).json({ error: "Too many voice requests, try again in a minute" });
  try {
    res.json({ token: await mintAccessToken(), version: CARTESIA_VERSION, request: voiceConfig() });
  } catch (e) {
    console.error("[voice]", e.message);
    res.status(502).json({ error: "voice unavailable" });
  }
});
// Fallback proxy for clients that can't reach api.cartesia.ai directly.
app.post("/api/buddy/speak", async (req, res) => {
  if (!voiceEnabled()) return res.status(404).json({ error: "voice not configured" });
  try {
    const audio = await synthesize(String(req.body.text || ""));
    res.set("Content-Type", "audio/mpeg").send(audio);
  } catch (e) {
    console.error("[voice]", e.message);
    res.status(502).json({ error: "voice unavailable" });
  }
});

// ------------------------------------------------------------------ routes: parent
app.use("/api/parent", requireParent);
app.post("/api/parent/approval/:id", route((req) => act((db) => game.decide(db, req.params.id, Boolean(req.body.approve), req.body.note), "parent_decision")));
app.post("/api/parent/goal", route((req) => act((db) => game.createParentGoal(db, req.body), "goal_created")));
app.post("/api/parent/mission", route((req) => act((db) => game.createParentMission(db, req.body), "mission_created")));
app.post("/api/parent/allowance", route((req) => act((db) => {
  const a = db.allowance;
  if (req.body.amount != null) a.amount = Math.max(0, Math.min(10000, cents(req.body.amount)));
  if (req.body.savePct != null) a.savePct = Math.max(0, Math.min(100, Math.round(Number(req.body.savePct))));
  if (req.body.spendLimit != null) a.spendLimit = Math.max(0, cents(req.body.spendLimit));
  if (req.body.rewardDestination) a.rewardDestination = req.body.rewardDestination === "spending" ? "spending" : "savings";
  game.audit(db, "parent", "allowance_updated", `Allowance ${(a.amount / 100).toFixed(2)}/wk, ${a.savePct}% saved, purchase limit $${(a.spendLimit / 100).toFixed(2)}`);
}, "allowance_settings")));
// Demo control: fast-forward the schedule so the guardian pays this week's allowance now.
app.post("/api/parent/allowance/run-now", route(() => act((db) => {
  db.allowance.nextRun = Date.now();
}, "fast_forward")));
app.post("/api/parent/topup", route((req) => act((db) => {
  const amount = cents(req.body.amount || 50);
  db.accounts.parent.balance += amount;
  // Unblock anything the guardian escalated for lack of funds.
  db.approvals.forEach((a) => {
    if (a.escalatedAt && !a.paidTxnId) delete a.escalatedAt;
    if (a.kind === "topup" && a.status === "pending") a.status = "approved";
  });
  game.audit(db, "parent", "topup", `Added $${(amount / 100).toFixed(2)} to the funding account (simulated deposit)`);
}, "topup")));
app.post("/api/parent/settings", route((req) => act((db) => {
  for (const k of ["requireTradeApproval", "buddyEnabled", "coopChallenge"]) if (k in req.body) db.settings[k] = Boolean(req.body[k]);
  game.audit(db, "parent", "settings", `Updated settings: ${JSON.stringify(req.body)}`);
}, "settings")));
app.post("/api/parent/savings-goal", route((req) => act((db) => {
  const g = db.savingsGoals[0];
  if (req.body.title) g.title = String(req.body.title).slice(0, 40);
  if (req.body.target) g.target = Math.max(100, cents(req.body.target));
}, "savings_goal")));
app.post("/api/parent/inject-fault", route(() => mutate((db) => {
  const dup = injectDuplicatePosting(db);
  if (!dup) throw new GameError("Nothing to duplicate yet — approve a reward or run an allowance first");
  return { injected: dup.id };
  // No guardian run here on purpose: the next tick has to find it on its own.
})));
app.post("/api/parent/reset", route(() => {
  reset();
  mutate((d) => (d.buddy.plan = offlinePlan(d, "starting plan")));
  return { ok: true };
}));

// ------------------------------------------------------------------ static (production)
const dist = path.join(here, "..", "dist");
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (req, res, next) => res.sendFile(path.join(dist, "index.html"), (err) => err && next()));

// ------------------------------------------------------------------ autonomy loop
setInterval(() => {
  const db = read();
  const now = Date.now();
  const adventureDue = game.dueAdventures(db, now).length > 0;
  if (!adventureDue && !hasDueWork(db, now)) return;
  mutate((d) => {
    game.finalizeAdventures(d, now);
    guardianPass(d, "tick");
  });
}, 2000);

app.listen(PORT, () => {
  const db = read();
  if (!db.buddy.plan) mutate((d) => (d.buddy.plan = offlinePlan(d, "starting plan")));
  console.log(`MoneyQuest API on http://localhost:${PORT}  (buddy: ${buddyMode()}, voice: ${voiceEnabled() ? "cartesia" : "browser"}, bank: ${nessieEnabled() ? "nessie mirror" : "simulated"}, child: ${db.child.name})`);
});
