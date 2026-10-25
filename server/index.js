// MoneyQuest API server.
import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { read, mutate, reset, subscribe } from "./store.js";
import * as game from "./domain.js";
import { GameError } from "./domain.js";
import { runGuardian, hasDueWork, injectDuplicatePosting, reconcileNow } from "./guardian.js";
import { replan, queueReplan, cancelReplan, buddyMode, offlinePlan } from "./buddy.js";
import { actions } from "./actions.js";
import { synthesize, voiceEnabled, mintAccessToken, voiceConfig, CARTESIA_VERSION } from "./voice.js";
import { setNessieAuditHook, nessieEnabled } from "./bank.js";
import { PLACES, HOME, LESSONS, COSMETICS, MILESTONES, POINTS, TRIP, placeStatus } from "./catalog.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const app = express();
app.use(express.json({ limit: "64kb" }));

// ------------------------------------------------------------------ helpers
setNessieAuditHook((action, detail, data) => mutate((db) => game.audit(db, "bank", action, detail, data)));

// Re-plan (debounced) whenever real money moves — child actions or guardian payouts.
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
    const repairs = reconcileNow(db, Date.now(), trigger);
    const out = fn(db);
    if (repairs.some((action) => /reversed/i.test(action))) queueReplan("Guardian reversed a duplicate posting");
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
    adventures: db.adventures.slice(-10).reverse().map(({ destId, ...adventure }) => adventure.status === "away" ? adventure : { ...adventure, destId }),
    postcards: db.postcards,
    friends: db.friends.filter((f) => f.status !== "declined").map(game.friendView),
    trades: db.trades.slice(-10).reverse(),
    pendingRequests: db.approvals.filter((a) => a.status === "pending" && ["spend", "extra", "reward", "task", "friend", "trade"].includes(a.kind)).map((a) => ({ id: a.id, kind: a.kind, title: a.title })),
    plan: db.buddy.plan,
    chat: db.buddy.chat,
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
      trip: TRIP,
      greetings: game.GREETINGS,
    },
    integrations: { buddy: buddyMode(), voice: voiceEnabled() ? "cartesia" : "browser", bank: nessieEnabled() ? "nessie" : "simulated" },
  };
}

function parentView(db) {
  return {
    ...childView(db),
    adventures: db.adventures.slice(-10).reverse(),
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
  actions.login(read(), req.body);
  const token = crypto.randomBytes(16).toString("hex");
  parentTokens.add(token);
  return { token };
}));

// ------------------------------------------------------------------ routes: child
app.post("/api/child/save", route((req) => act((db) => actions.save(db, req.body), "child_save")));
app.post("/api/child/spend", route((req) => act((db) => actions.spend(db, req.body), "child_spend")));
app.post("/api/child/journal", route((req) => act((db) => actions.journal(db, req.body), "journal")));
app.post("/api/child/extra", route((req) => act((db) => actions.extra(db, req.body), "extra_request")));
app.post("/api/child/lesson", route((req) => act((db) => actions.lesson(db, req.body), "lesson")));
app.post("/api/child/budget", route((req) => act((db) => actions.budget(db, req.body), "budget")));
app.post("/api/child/mission/:id/done", route((req) => act((db) => actions.missionDone(db, req.params.id), "mission_done")));
app.post("/api/child/trip", route((req) => {
  const { destId, ...adventure } = act((db) => actions.trip(db, req.body), "trip");
  return adventure;
}));
app.post("/api/child/adventure", route((req) => {
  const { destId, ...adventure } = act((db) => actions.adventure(db, req.body), "adventure");
  return adventure;
}));
app.post("/api/child/cosmetic/buy", route((req) => act((db) => actions.buyCosmetic(db, req.body), "cosmetic")));
app.post("/api/child/cosmetic/equip", route((req) => act((db) => actions.equip(db, req.body), "equip")));
app.post("/api/child/bear/name", route((req) => act((db) => actions.renameBear(db, req.body), "rename")));
app.post("/api/child/friend", route((req) => act((db) => actions.friend(db, req.body), "friend")));
app.post("/api/child/trade", route((req) => act((db) => actions.trade(db, req.body), "trade")));
app.post("/api/child/greet", route((req) => act((db) => actions.greet(db, req.body), "greet")));
app.post("/api/child/notifications/read", route(() => mutate((db) => db.notifications.forEach((n) => n.to === "child" && (n.read = true)))));
app.post("/api/buddy/chat", route((req) => actions.chat(read(), req.body)));
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
    const audio = await synthesize(actions.speakText(null, req.body));
    res.set("Content-Type", "audio/mpeg").send(audio);
  } catch (e) {
    if (e instanceof GameError) return res.status(e.status).json({ error: e.message });
    console.error("[voice]", e.message);
    res.status(502).json({ error: "voice unavailable" });
  }
});

// ------------------------------------------------------------------ routes: parent
app.use("/api/parent", requireParent);
app.post("/api/parent/approval/:id", route((req) => act((db) => actions.approval(db, req.body, req.params.id), "parent_decision")));
app.post("/api/parent/goal", route((req) => act((db) => actions.goal(db, req.body), "goal_created")));
app.post("/api/parent/mission", route((req) => act((db) => actions.mission(db, req.body), "mission_created")));
app.post("/api/parent/allowance", route((req) => act((db) => actions.allowance(db, req.body), "allowance_settings")));
// Demo control: fast-forward the schedule so the guardian pays this week's allowance now.
app.post("/api/parent/allowance/run-now", route(() => act((db) => {
  game.requestAllowanceRun(db);
}, "fast_forward")));
app.post("/api/parent/topup", route((req) => act((db) => actions.topup(db, req.body), "topup")));
app.post("/api/parent/settings", route((req) => act((db) => actions.settings(db, req.body), "settings")));
app.post("/api/parent/savings-goal", route((req) => act((db) => actions.savingsGoal(db, req.body), "savings_goal")));
app.post("/api/parent/inject-fault", route(() => mutate((db) => {
  const dup = injectDuplicatePosting(db);
  if (!dup) throw new GameError("Nothing to duplicate yet — approve a reward or run an allowance first");
  return { injected: dup.id };
  // No guardian run here on purpose: the next tick has to find it on its own.
})));
app.post("/api/parent/reset", route(() => {
  cancelReplan();
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
