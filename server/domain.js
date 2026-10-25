// Game + family rules. Every function takes the db object and mutates it; the
// HTTP layer wraps calls in store.mutate(). Throw GameError for user-facing
// validation problems.
import { uid } from "./store.js";
import { transfer, BankError } from "./bank.js";
import {
  PLACES, LESSONS, COSMETICS, MILESTONES, POINTS, SLOTS, placeStatus, bonusDiscoveries,
} from "./catalog.js";

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const ADVENTURE_MS = Number(process.env.ADVENTURE_SECONDS || 15) * 1000;
const dollars = (c) => `$${(c / 100).toFixed(2)}`;
const today = (now) => new Date(now).toISOString().slice(0, 10);

// Side-effect hooks the server wires up (buddy re-planning). Kept out of the
// db so domain logic stays pure and testable.
const hooks = { moneyChanged: () => {} };
export function onMoneyChanged(fn) {
  hooks.moneyChanged = fn;
}

// ------------------------------------------------------------------ utilities
export function audit(db, actor, action, detail, data = {}) {
  db.audit.push({ id: uid("aud"), ts: Date.now(), actor, action, detail, data });
  if (db.audit.length > 500) db.audit.splice(0, db.audit.length - 500);
}

export function notify(db, to, text, kind = "info", ref = null) {
  db.notifications.push({ id: uid("ntf"), ts: Date.now(), to, text, kind, ref, read: false });
  if (db.notifications.length > 200) db.notifications.splice(0, db.notifications.length - 200);
}

function addPoints(db, n, reason) {
  db.child.points += n;
  audit(db, "system", "points_awarded", `+${n} adventure points: ${reason}`, { points: n });
}

function moneyMoved(db, reason) {
  checkMilestones(db);
  hooks.moneyChanged(reason);
}

function dailyTrackingBonus(db, now) {
  const key = today(now);
  if (db.child.lastTrackedDay === key) return false;
  db.child.lastTrackedDay = key;
  db.child.stats.tracked += 1;
  addPoints(db, POINTS.track, "recorded today's money");
  return true;
}

export function checkMilestones(db) {
  const saved = db.accounts.savings.balance;
  for (const m of MILESTONES) {
    if (saved >= m.at && !db.child.milestonesUnlocked.includes(m.at)) {
      db.child.milestonesUnlocked.push(m.at);
      addPoints(db, POINTS.milestone, `savings milestone ${dollars(m.at)}`);
      notify(db, "child", `${db.child.bear.name} reached the ${m.label} stage! ${m.reward}.`, "celebrate");
      notify(db, "parent", `${db.child.name} passed a ${dollars(m.at)} savings milestone.`, "info");
      audit(db, "system", "milestone_unlocked", `Savings milestone ${dollars(m.at)} unlocked permanently`, { at: m.at });
    }
  }
}

// ------------------------------------------------------------------ parent goals
function bumpGoals(db, type) {
  for (const g of db.parentGoals) {
    if (g.status !== "active" || g.type !== type) continue;
    g.progress = Math.min(g.count, g.progress + 1);
    if (g.progress >= g.count) {
      g.status = "awaiting_approval";
      g.completedAt = Date.now();
      const approval = {
        id: uid("apr"), kind: "reward", status: "pending", createdAt: Date.now(),
        goalId: g.id, amount: g.reward,
        title: `${db.child.name} completed "${g.title}"`,
        detail: `Approve the ${dollars(g.reward)} reward?`,
      };
      db.approvals.push(approval);
      notify(db, "parent", `Your child completed their goal! Would you like to approve the ${dollars(g.reward)} reward?`, "approval", approval.id);
      notify(db, "child", `You finished "${g.title}"! We asked your grown-up to approve your ${dollars(g.reward)} reward.`, "celebrate");
      audit(db, "system", "goal_completed", `Goal "${g.title}" verified complete (${g.progress}/${g.count}); escalated reward for parent approval`, { goalId: g.id, approvalId: approval.id });
    }
  }
}

export function createParentGoal(db, { title, type, count, reward }) {
  const allowedTypes = ["lessons", "tasks", "save_actions"];
  if (!allowedTypes.includes(type)) throw new GameError("Unknown goal type");
  count = Number(count);
  reward = Math.round(Number(reward) * 100);
  if (!title?.trim()) throw new GameError("Give the goal a title");
  if (!(count >= 1 && count <= 50)) throw new GameError("Count must be between 1 and 50");
  if (!(reward >= 0 && reward <= 10000)) throw new GameError("Reward must be between $0 and $100");
  const g = { id: uid("pg"), title: title.trim(), type, count, reward, progress: 0, status: "active", createdAt: Date.now() };
  db.parentGoals.push(g);
  notify(db, "child", `New goal from your grown-up: "${g.title}" — earn ${dollars(reward)}!`, "mission");
  audit(db, "parent", "goal_created", `Created goal "${g.title}" (${count} ${type}) for ${dollars(reward)}`, { goalId: g.id });
  return g;
}

// ------------------------------------------------------------------ missions
export function createParentMission(db, { title, points = POINTS.parent, by = "parent" }) {
  if (!title?.trim()) throw new GameError("Mission needs a title");
  points = Math.max(5, Math.min(100, Number(points) || POINTS.parent));
  const m = { id: uid("msn"), title: title.trim(), points, status: "open", createdBy: by, createdAt: Date.now() };
  db.missions.push(m);
  notify(db, "child", `New mission: ${m.title} (+${points} pts)`, "mission");
  audit(db, by, "mission_created", `Mission "${m.title}" (+${points})`, { missionId: m.id });
  return m;
}

export function childMarkMissionDone(db, missionId) {
  const m = db.missions.find((x) => x.id === missionId);
  if (!m || m.status !== "open") throw new GameError("That mission isn't open");
  m.status = "pending_review";
  m.submittedAt = Date.now();
  const approval = { id: uid("apr"), kind: "task", status: "pending", createdAt: Date.now(), missionId: m.id,
    title: `${db.child.name} says they finished "${m.title}"`, detail: `Confirm to award +${m.points} points.` };
  db.approvals.push(approval);
  notify(db, "parent", `${db.child.name} finished "${m.title}". Confirm?`, "approval", approval.id);
  return m;
}

export function completeLesson(db, lessonId, answers) {
  const lesson = LESSONS.find((l) => l.id === lessonId);
  if (!lesson) throw new GameError("Unknown lesson");
  if (!Array.isArray(answers) || answers.length !== lesson.questions.length) throw new GameError("Answer every question");
  const correct = lesson.questions.filter((q, i) => q.answer === answers[i]).length;
  const passed = correct / lesson.questions.length >= 0.6;
  if (!passed) {
    audit(db, "child", "lesson_attempt", `Tried "${lesson.title}" (${correct}/${lesson.questions.length})`);
    return { passed, correct, total: lesson.questions.length };
  }
  const firstTime = !db.child.lessonsDone.includes(lessonId);
  if (firstTime) {
    db.child.lessonsDone.push(lessonId);
    db.child.stats.learningDone += 1;
    addPoints(db, POINTS.lesson, `finished lesson "${lesson.title}"`);
    bumpGoals(db, "lessons");
    coopProgress(db);
  }
  return { passed, correct, total: lesson.questions.length, firstTime };
}

export function completeBudget(db, allocations) {
  // allocations: { save, needs, fun, give } in cents, must total $20
  const vals = ["save", "needs", "fun", "give"].map((k) => Math.round(Number(allocations?.[k]) || 0));
  if (vals.some((v) => v < 0)) throw new GameError("No negative amounts");
  const total = vals.reduce((a, b) => a + b, 0);
  if (total !== 2000) throw new GameError(`Your budget adds up to ${dollars(total)} — it needs to be exactly $20.00`);
  if (vals[0] < 400) throw new GameError("Try saving at least $4 (20%) — future you will say thanks!");
  if (vals[1] < 500) throw new GameError("Don't forget needs! Put at least $5 there.");
  const week = weekKey(Date.now());
  const repeat = db.child.lastBudgetWeek === week;
  db.child.lastBudgetWeek = week;
  db.child.stats.budgetsDone += 1;
  if (!repeat) addPoints(db, POINTS.budget, "weekly budgeting challenge");
  audit(db, "child", "budget_done", `Weekly budget: save ${dollars(vals[0])}, needs ${dollars(vals[1])}, fun ${dollars(vals[2])}, give ${dollars(vals[3])}`);
  return { pointsAwarded: repeat ? 0 : POINTS.budget };
}

function weekKey(ts) {
  const d = new Date(ts);
  const onejan = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}-w${Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)}`;
}

// ------------------------------------------------------------------ money actions
export function childSave(db, amountCents, now = Date.now()) {
  if (!(amountCents >= 100)) throw new GameError("Save at least $1.00");
  try {
    transfer(db, { from: "spending", to: "savings", amount: amountCents, kind: "save", memo: "Moved to savings", ts: now });
  } catch (e) {
    if (e instanceof BankError && e.code === "insufficient_funds") throw new GameError("You don't have that much in spending money");
    throw e;
  }
  const key = today(now);
  db.child.stats.savingsActions += 1;
  if (db.child.lastSaveDay !== key) {
    db.child.lastSaveDay = key;
    addPoints(db, POINTS.save, "saved toward a goal");
  }
  dailyTrackingBonus(db, now);
  bumpGoals(db, "save_actions");
  audit(db, "child", "saved", `Moved ${dollars(amountCents)} from spending to savings`);
  moneyMoved(db, `${db.child.name} saved ${dollars(amountCents)}`);
}

/**
 * Child records a purchase. The guardian's spending policy decides whether it
 * posts immediately or is held for a parent.
 */
export function childSpend(db, { amount, memo }, policy, now = Date.now()) {
  if (!(amount >= 1)) throw new GameError("Enter how much you spent");
  if (!memo?.trim()) throw new GameError("What did you buy?");
  if (db.accounts.spending.balance < amount) throw new GameError("That's more than your spending money");
  const verdict = policy(db, amount, memo);
  if (verdict.hold) {
    const approval = { id: uid("apr"), kind: "spend", status: "pending", createdAt: now, amount, memo: memo.trim(),
      title: `${db.child.name} wants to buy "${memo.trim()}" for ${dollars(amount)}`, detail: verdict.reason };
    db.approvals.push(approval);
    notify(db, "parent", `Purchase needs your OK: ${memo.trim()} (${dollars(amount)})`, "approval", approval.id);
    audit(db, "guardian", "spend_held", verdict.reason, { approvalId: approval.id, policy: verdict.policy });
    dailyTrackingBonus(db, now);
    return { held: true, reason: verdict.reason };
  }
  transfer(db, { from: "spending", to: "merchant", amount, kind: "spend", memo: memo.trim(), ts: now });
  dailyTrackingBonus(db, now);
  audit(db, "child", "spent", `Spent ${dollars(amount)} on ${memo.trim()}`);
  moneyMoved(db, `${db.child.name} spent ${dollars(amount)} on ${memo.trim()}`);
  return { held: false };
}

export function journal(db, { direction, amount, note }, now = Date.now()) {
  if (!["received", "spent", "saved"].includes(direction)) throw new GameError("Pick what happened");
  if (!note?.trim()) throw new GameError("Add a short note");
  db.tracking.push({ id: uid("trk"), ts: now, direction, amount: Math.round(amount) || 0, note: note.trim() });
  const bonus = dailyTrackingBonus(db, now);
  return { bonus };
}

export function requestExtraAllowance(db, { amount, reason }) {
  if (!(amount >= 100 && amount <= 5000)) throw new GameError("Ask for between $1 and $50");
  if (!reason?.trim()) throw new GameError("Tell your grown-up why");
  const approval = { id: uid("apr"), kind: "extra", status: "pending", createdAt: Date.now(), amount, reason: reason.trim(),
    title: `${db.child.name} asked for ${dollars(amount)} extra`, detail: `"${reason.trim()}"` };
  db.approvals.push(approval);
  notify(db, "parent", `${db.child.name} asked for ${dollars(amount)} extra allowance.`, "approval", approval.id);
  return approval;
}

// ------------------------------------------------------------------ approvals
export function decide(db, approvalId, approve, note = "") {
  const a = db.approvals.find((x) => x.id === approvalId);
  if (!a || a.status !== "pending") throw new GameError("That request was already handled");
  a.status = approve ? "approved" : "declined";
  a.decidedAt = Date.now();
  a.note = note;
  audit(db, "parent", a.kind === "topup" ? "handled" : approve ? "approved" : "declined", `${a.kind === "topup" ? "Handled" : approve ? "Approved" : "Declined"}: ${a.title}`, { approvalId: a.id, kind: a.kind });

  switch (a.kind) {
    case "reward": {
      const g = db.parentGoals.find((x) => x.id === a.goalId);
      if (g) g.status = approve ? "approved" : "declined";
      notify(db, "child", approve ? `Your grown-up approved your ${dollars(a.amount)} reward!` : `Your reward for "${g?.title}" wasn't approved this time. Keep going!`, approve ? "celebrate" : "info");
      // The guardian performs the actual payout on its next pass (idempotently).
      break;
    }
    case "task": {
      const m = db.missions.find((x) => x.id === a.missionId);
      if (!m) break;
      if (approve) {
        m.status = "done";
        m.completedAt = Date.now();
        addPoints(db, m.points, `parent confirmed "${m.title}"`);
        bumpGoals(db, "tasks");
        notify(db, "child", `"${m.title}" confirmed! +${m.points} pts`, "celebrate");
      } else {
        m.status = "open";
        notify(db, "child", `Your grown-up says "${m.title}" isn't quite finished yet.`, "info");
      }
      break;
    }
    case "spend":
    case "extra":
      notify(db, "child", approve ? `Approved: ${a.title.replace(`${db.child.name} `, "")}` : `Not this time: ${a.memo || a.reason}`, approve ? "celebrate" : "info");
      break; // guardian executes approved money movement
    case "friend": {
      const f = db.friends.find((x) => x.id === a.friendId);
      if (f) f.status = approve ? "approved" : "declined";
      notify(db, "child", approve ? `You and ${f?.name} are now friends!` : `Friend request with ${f?.name} wasn't approved.`, "info");
      break;
    }
    case "trade": {
      const t = db.trades.find((x) => x.id === a.tradeId);
      if (!t) break;
      if (approve) executeTrade(db, t);
      else {
        t.status = "declined";
        for (const card of db.postcards) {
          if (card.lockedForTrade === t.id) delete card.lockedForTrade;
        }
        notify(db, "child", `Your postcard trade wasn't approved.`, "info");
      }
      break;
    }
    case "mission_proposal":
      if (approve) createParentMission(db, { title: a.missionTitle, points: a.points, by: "buddy+parent" });
      break;
    case "topup":
      a.handled = true;
      break;
  }
  return a;
}

// ------------------------------------------------------------------ adventures
export function visitedSet(db) {
  return new Set(db.postcards.filter((p) => p.source === "trip" || (p.source === undefined && !p.from)).map((p) => p.defId));
}

export function startAdventure(db, destId, now = Date.now()) {
  const dest = PLACES[destId];
  if (!dest) throw new GameError("Unknown destination");
  const bear = db.child.bear.name;
  if (db.adventures.some((a) => a.status === "away")) throw new GameError(`${bear} is already on an adventure!`);
  const owned = visitedSet(db);
  const status = placeStatus(destId, db.child, owned, owned, new Date(now));
  if (!status.ok) throw new GameError(status.hidden ? "That place is still a secret!" : `Locked: ${status.reason}`);
  if (db.child.points < dest.cost) throw new GameError(`You need ${dest.cost - db.child.points} more points for ${dest.name}`);
  db.child.points -= dest.cost;
  const adv = { id: uid("adv"), destId, startedAt: now, returnsAt: now + ADVENTURE_MS, status: "away", postcardIds: [] };
  db.adventures.push(adv);
  audit(db, "child", "adventure_started", `Sent ${bear} to ${dest.name} for ${dest.cost} pts (savings untouched)`);
  return adv;
}

export function dueAdventures(db, now = Date.now()) {
  return db.adventures.filter((a) => a.status === "away" && a.returnsAt <= now);
}

export function finalizeAdventures(db, now = Date.now()) {
  const returned = [];
  const bear = db.child.bear.name;
  for (const adv of dueAdventures(db, now)) {
    const defs = [adv.destId, ...bonusDiscoveries(adv.destId, db.child, visitedSet(db))];
    for (const defId of defs) {
      const pc = { id: uid("pc"), defId, source: "trip", collectedAt: now, fromAdventure: adv.id };
      db.postcards.push(pc);
      adv.postcardIds.push(pc.id);
    }
    adv.status = "returned";
    adv.returnedAt = now;
    db.child.stats.adventures += 1;
    const secret = defs.slice(1).map((d) => PLACES[d].name);
    notify(db, "child",
      secret.length
        ? `${bear} is home from ${PLACES[adv.destId].name}… and discovered ${secret.join(" + ")}!`
        : `${bear} is home with a ${PLACES[adv.destId].name} postcard!`,
      "celebrate", adv.id);
    audit(db, "system", "adventure_returned", `Returned from ${adv.destId} with ${defs.join(", ")}`);
    returned.push(adv);
  }
  return returned;
}

// ------------------------------------------------------------------ cosmetics
export function cosmeticUnlocked(db, c) {
  if (db.child.ownedCosmetics.includes(c.id)) return true;
  if (c.milestone && db.child.milestonesUnlocked.includes(c.milestone)) return true;
  return false;
}

export function buyCosmetic(db, id) {
  const c = COSMETICS.find((x) => x.id === id);
  if (!c) throw new GameError("Unknown item");
  if (cosmeticUnlocked(db, c)) throw new GameError("You already have it");
  if (c.cost == null) throw new GameError("This one is unlocked by a savings milestone");
  if (db.child.points < c.cost) throw new GameError(`You need ${c.cost - db.child.points} more points`);
  db.child.points -= c.cost;
  db.child.ownedCosmetics.push(c.id);
  db.child.bear[c.kind] = c.value; // put it on right away
  audit(db, "child", "cosmetic_bought", `Bought ${c.label} for ${c.cost} pts`);
}

export function equip(db, kind, value) {
  if (!SLOTS.includes(kind)) throw new GameError("Unknown slot");
  if (value === null) {
    if (kind === "background") throw new GameError("Pick a scene");
    db.child.bear[kind] = null;
    return;
  }
  const c = COSMETICS.find((x) => x.kind === kind && x.value === value);
  if (!c || !cosmeticUnlocked(db, c)) throw new GameError("Unlock it first");
  db.child.bear[kind] = value;
}

export function renameBear(db, name) {
  const clean = String(name || "").replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 16);
  if (!clean) throw new GameError("Pick a name");
  db.child.bear.name = clean;
}

// ------------------------------------------------------------------ friends
const DIRECTORY = {
  "SAM-12": { name: "Sam", bear: { name: "Biscuit", hat: "flower_sunhat", eyes: "heart_glasses" }, postcards: ["chicago", "new_york_city", "zion_national_park"] },
  "ZOE-88": { name: "Zoe", bear: { name: "Clover", hat: "flower_crown", outfit: "striped_shirt" }, postcards: ["yosemite_national_park", "san_francisco"] },
};

export function addFriendByCode(db, code) {
  code = String(code || "").trim().toUpperCase();
  const existing = db.friends.find((f) => f.code === code);
  if (existing && existing.status !== "declined") throw new GameError("You already added that friend");
  const entry = existing ? { name: existing.name, bear: existing.bear, postcards: existing.postcards } : DIRECTORY[code];
  if (!entry) throw new GameError("No friend found with that code. Try SAM-12 or ZOE-88 in the demo!");
  const f = { id: uid("fr"), code, status: "pending_parent", coopLearning: 0, ...structuredClone(entry) };
  if (existing) db.friends.splice(db.friends.indexOf(existing), 1, f);
  else db.friends.push(f);
  const approval = { id: uid("apr"), kind: "friend", status: "pending", createdAt: Date.now(), friendId: f.id,
    title: `${db.child.name} wants to add ${f.name} as a friend`, detail: `Invitation code ${code}. Friends only see bears and postcards — never balances.` };
  db.approvals.push(approval);
  notify(db, "parent", `Friend request: ${f.name} (${code})`, "approval", approval.id);
  return f;
}

export function proposeTrade(db, friendId, giveDefId, getDefId) {
  const f = db.friends.find((x) => x.id === friendId && x.status === "approved");
  if (!f) throw new GameError("You can only trade with approved friends");
  const give = PLACES[giveDefId], get = PLACES[getDefId];
  if (!give || !get) throw new GameError("Pick two postcards");
  if (give.rarity === "secret") throw new GameError("Secret postcards are yours to keep!");
  if (!db.postcards.some((p) => p.defId === giveDefId && !p.lockedForTrade)) throw new GameError("You don't have that postcard to give");
  if (!f.postcards.includes(getDefId)) throw new GameError(`${f.name} doesn't have that postcard`);
  if (db.trades.some((t) => t.status === "pending")) throw new GameError("Finish your other trade first");
  const t = { id: uid("trd"), friendId, give: giveDefId, get: getDefId, status: "pending", createdAt: Date.now() };
  db.trades.push(t);
  const card = db.postcards.find((p) => p.defId === giveDefId && !p.lockedForTrade);
  card.lockedForTrade = t.id;
  if (db.settings.requireTradeApproval) {
    const approval = { id: uid("apr"), kind: "trade", status: "pending", createdAt: Date.now(), tradeId: t.id,
      title: `${db.child.name} wants to trade with ${f.name}`, detail: `Give ${give.name} ↔ get ${get.name}` };
    db.approvals.push(approval);
    notify(db, "parent", `Postcard trade needs approval: ${give.name} ↔ ${get.name} with ${f.name}`, "approval", approval.id);
  } else {
    executeTrade(db, t);
  }
  return t;
}

function executeTrade(db, t) {
  const f = db.friends.find((x) => x.id === t.friendId);
  const idx = db.postcards.findIndex((p) => p.lockedForTrade === t.id);
  if (!f || idx < 0 || !f.postcards.includes(t.get)) {
    t.status = "failed";
    for (const card of db.postcards) {
      if (card.lockedForTrade === t.id) delete card.lockedForTrade;
    }
    return;
  }
  db.postcards.splice(idx, 1);
  f.postcards.splice(f.postcards.indexOf(t.get), 1);
  f.postcards.push(t.give);
  db.postcards.push({ id: uid("pc"), defId: t.get, source: "trade", collectedAt: Date.now(), note: `Traded with ${f.name}!`, from: f.name });
  t.status = "done";
  notify(db, "child", `Trade complete! ${f.name} sent you ${PLACES[t.get].name}.`, "celebrate");
  audit(db, "system", "trade_done", `Traded ${t.give} for ${t.get} with ${f.name}`);
}

export const GREETINGS = [
  "Great job saving!", "Want to go on an adventure?", "Your bear looks so cozy!", "Happy trading!", "Let's finish our team challenge!",
];
export function sendGreeting(db, friendId, idx) {
  const f = db.friends.find((x) => x.id === friendId && x.status === "approved");
  if (!f) throw new GameError("Not an approved friend");
  const text = GREETINGS[idx];
  if (!text) throw new GameError("Pick a greeting");
  f.greetings = [...(f.greetings || []), { ts: Date.now(), text, from: "me" }].slice(-10);
}

function coopProgress(db) {
  // Team challenge: friends contribute learning challenges (friends' side is simulated).
  db.child.coopLearning = (db.child.coopLearning || 0) + 1;
}

// ------------------------------------------------------------------ views
/** What a friend is allowed to see. Never includes money. */
export function friendView(f) {
  return { id: f.id, name: f.name, status: f.status, bear: f.bear, postcards: f.postcards, greetings: f.greetings || [], coopLearning: f.coopLearning };
}

export function weeksToGoal(db, goal, extraSaving = 0) {
  const saved = db.accounts.savings.balance + extraSaving;
  const remaining = goal.target - saved;
  if (remaining <= 0) return 0;
  const weekly = Math.round((db.allowance.amount * db.allowance.savePct) / 100);
  if (weekly <= 0) return null;
  return Math.ceil(remaining / weekly);
}
