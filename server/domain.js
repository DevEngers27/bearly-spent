// Game + family rules. Every function takes the db object and mutates it; the
// HTTP layer wraps calls in store.mutateChild(). Throw GameError for user-facing
// validation problems.
import { randomInt } from "node:crypto";
import { uid, childIdFor, childRecord, readChild, mutateChild, mutateChildren, childForFriendCode, familyLabel, DEMO_FAMILY_ID } from "./store.js";
import { object, id, str, bool, integer } from "./validate.js";
import { transfer, BankError } from "./bank.js";
import { dayKey, weekKey } from "./time.js";
import {
  PLACES, LESSONS, COSMETICS, MILESTONES, POINTS, MISSION_POOL, TRIP, SLOTS, placeStatus, bonusDiscoveries,
} from "./catalog.js";

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const ADVENTURE_MS = Number(process.env.ADVENTURE_SECONDS || 60) * 1000;
const dollars = (c) => `$${(c / 100).toFixed(2)}`;

// Side-effect hooks the server wires up (buddy re-planning). Kept out of the
// db so domain logic stays pure and testable.
const hooks = { moneyChanged: () => {} };
export function onMoneyChanged(fn) {
  hooks.moneyChanged = fn;
}

// ------------------------------------------------------------------ utilities
export function audit(db, actor, action, detail, data = {}) {
  db.audit.push({ id: uid("aud"), ts: Date.now(), actor, action, detail, data });
  if (db.audit.length > 2000) db.audit.splice(0, db.audit.length - 2000);
}

export function recordFunding(db, amount, note) {
  const txn = {
    id: uid("txn"), ts: Date.now(), from: "external", to: "parent", amount,
    kind: "funding_in", memo: note || `Added by ${db.family.parentName}`,
    idempotencyKey: null, status: "posted",
  };
  db.accounts.parent.balance += amount;
  db.transactions.push(txn);
  audit(db, "parent", "funding_added", `Recorded ${dollars(amount)} added to ${db.child.name}'s funding — real money stays with you`, { txnId: txn.id, amount });
}

export function notify(db, to, text, kind = "info", ref = null) {
  if (ref && db.notifications.some((n) => n.to === to && n.ref === ref)) return;
  db.notifications.push({ id: uid("ntf"), ts: Date.now(), to, text, kind, ref, read: false });
  const own = db.notifications.filter((n) => n.to === to);
  const remove = new Set(own.slice(0, Math.max(0, own.length - 200)).map((n) => n.id));
  if (remove.size) db.notifications = db.notifications.filter((n) => !remove.has(n.id));
}

function addPoints(db, n, reason) {
  if (!Number.isInteger(db.child.points) || !Number.isInteger(n) || !Number.isInteger(db.child.points + n)) throw new GameError("Points need a whole number");
  db.child.points += n;
  audit(db, "system", "points_awarded", `+${n} adventure points: ${reason}`, { points: n });
}

function moneyMoved(db, reason) {
  checkMilestones(db);
  hooks.moneyChanged(reason, db);
}

function dailyTrackingBonus(db, now) {
  const key = dayKey(now, db.settings.timezone);
  if (db.child.lastTrackedDay === key) return false;
  ensureDailyMissions(db, now);
  db.child.lastTrackedDay = key;
  db.child.stats.tracked += 1;
  addPoints(db, POINTS.track, "recorded today's money");
  missionEvent(db, "track", now);
  return true;
}

export function checkMilestones(db) {
  checkSavingsGoal(db);
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

// ------------------------------------------------------------------ savings goals
export const GOAL_ICONS = ["bike", "game", "book", "gift", "trip", "toy", "other"];
const liveGoal = (g) => ["active", "reached"].includes(g.status);

// Also used by storage migration. Keep one current ID while history exists.
export function normalizeGoals(db) {
  db.savingsGoals ||= [];
  for (const g of db.savingsGoals) {
    g.status ||= "active";
    g.icon ||= "other";
  }
  const previous = db.savingsGoals.find((g) => g.id === db.child.currentGoalId);
  const current = (previous && liveGoal(previous) ? previous : null) || db.savingsGoals.find(liveGoal) || previous || db.savingsGoals[0];
  db.child.currentGoalId = current?.id || null;
  for (const g of db.savingsGoals) g.activeFlag = g.id === db.child.currentGoalId;
  return current || null;
}

export function currentGoal(db) {
  const g = normalizeGoals(db);
  return g && liveGoal(g) ? g : null;
}

export function checkSavingsGoal(db) {
  const g = currentGoal(db);
  if (g?.status === "active" && db.accounts.savings.balance >= g.target) {
    g.status = "reached";
    if (g.reachedAt) return;
    g.reachedAt = Date.now();
    notify(db, "child", `You did it, ${db.child.name}! Ask your grown-up to buy ${g.title}.`, "celebrate", `reached:${g.id}`);
    audit(db, "system", "savings_goal_reached", `${db.child.name} reached ${g.title} (${dollars(g.target)})`, { goalId: g.id });
  }
}

function savingsGoalById(db, id) {
  const g = db.savingsGoals.find((g) => g.id === id);
  if (!g) throw new GameError("That goal isn't here. Pick another one!");
  return g;
}

function purchaseWaiting(db, g) {
  return db.approvals.some((a) => a.kind === "goal_purchase" && a.goalId === g.id && ["pending", "approved"].includes(a.status) && !a.paidTxnId);
}

export function saveSavingsGoal(db, input, id = null, actor = "child") {
  // Validate everything before changing the document, including direct domain calls.
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new GameError("Fill in your goal");
  const update = {};
  if (!id || Object.hasOwn(input, "title")) {
    if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 40) throw new GameError("Give your goal a name up to 40 letters");
    update.title = input.title.trim();
  }
  if (!id || Object.hasOwn(input, "target")) {
    if (!Number.isInteger(input.target) || input.target < 100 || input.target > 100000) throw new GameError("Pick a goal from $1 to $1,000");
    update.target = input.target;
  }
  if (!id || Object.hasOwn(input, "icon")) {
    if (!GOAL_ICONS.includes(input.icon)) throw new GameError("Pick a goal picture");
    update.icon = input.icon;
  }
  let g;
  if (id) {
    g = savingsGoalById(db, id);
    if ((!liveGoal(g) && g.status !== "archived") || purchaseWaiting(db, g)) throw new GameError("This goal is a memory or waiting for your grown-up");
    if (g.status === "archived") {
      if (!currentGoal(db)) db.child.currentGoalId = g.id;
      g.status = "active";
      audit(db, actor, "savings_goal_restored", `Brought back goal: ${g.title}`, { goalId: g.id });
    }
    const targetChanged = update.target !== undefined && update.target !== g.target;
    Object.assign(g, update);
    if (targetChanged && g.status === "reached" && db.accounts.savings.balance < g.target) g.status = "active";
  } else {
    g = { id: uid("goal"), ...update, createdAt: Date.now(), status: "active" };
    db.savingsGoals.push(g);
    if (actor === "child") notify(db, "parent", `${db.child.name} set a new goal: ${g.title} (${dollars(g.target)})`, "info", `new:${g.id}`);
  }
  normalizeGoals(db);
  checkSavingsGoal(db);
  db.buddy.plan = null;
  audit(db, actor, id ? "savings_goal_edited" : "savings_goal_created", `${id ? "Updated" : "Set a new goal:"} ${g.title} (${dollars(g.target)})`, { goalId: g.id });
  hooks.moneyChanged("Savings goal changed", db);
  return g;
}

export function selectSavingsGoal(db, id, actor = "child") {
  const g = savingsGoalById(db, id);
  if (!liveGoal(g)) throw new GameError("Pick a goal you're still saving for");
  db.child.currentGoalId = id;
  normalizeGoals(db);
  checkSavingsGoal(db);
  db.buddy.plan = null;
  audit(db, actor, "savings_goal_current", `Now saving for ${g.title}`, { goalId: id });
  hooks.moneyChanged("Current savings goal changed", db);
  return g;
}

export function restoreSavingsGoal(db, id, actor = "child") {
  const g = savingsGoalById(db, id);
  if (g.status !== "archived" || purchaseWaiting(db, g)) throw new GameError("Pick a put-away goal to bring back");
  if (!currentGoal(db)) db.child.currentGoalId = id;
  g.status = "active";
  normalizeGoals(db);
  checkSavingsGoal(db);
  db.buddy.plan = null;
  audit(db, actor, "savings_goal_restored", `Brought back goal: ${g.title}`, { goalId: id });
  hooks.moneyChanged("Savings goal brought back", db);
  return g;
}

export function retireSavingsGoal(db, id, actor = "child", remove = false) {
  const g = savingsGoalById(db, id);
  if (purchaseWaiting(db, g)) throw new GameError("Your grown-up is checking this goal first");
  if (remove) {
    if (actor !== "parent") throw new GameError("Ask your grown-up to delete a goal", 403);
    if (g.status === "bought") throw new GameError("Keep bought goals to remember your success");
    if (db.child.currentGoalId === id) throw new GameError("Choose another current goal first");
    db.savingsGoals = db.savingsGoals.filter((g) => g.id !== id);
  } else {
    if (!liveGoal(g)) throw new GameError("That goal is already resting");
    g.status = "archived";
  }
  normalizeGoals(db);
  checkSavingsGoal(db);
  db.buddy.plan = null;
  audit(db, actor, remove ? "savings_goal_deleted" : "savings_goal_archived", `${remove ? "Deleted" : "Put away"} goal: ${g.title}`, { goalId: id });
  hooks.moneyChanged("Savings goal changed", db);
  return g;
}

export function requestGoalPurchase(db, id) {
  checkSavingsGoal(db);
  const g = savingsGoalById(db, id);
  const existing = db.approvals.find((a) => a.kind === "goal_purchase" && a.goalId === id && ["pending", "approved"].includes(a.status));
  if (existing) return existing;
  if (g.id !== db.child.currentGoalId || g.status !== "reached") throw new GameError("Reach your current goal first — you can do it!");
  const a = { id: uid("apr"), kind: "goal_purchase", status: "pending", createdAt: Date.now(), goalId: id, amount: g.target,
    title: `${db.child.name} reached ${g.title} (${dollars(g.target)}) — buy it and take ${dollars(g.target)} out of savings?`,
    detail: "Approve after buying it. MoneyQuest records the purchase; it does not buy or send real money.", memo: g.title };
  db.approvals.push(a);
  notify(db, "parent", a.title, "approval", a.id);
  audit(db, "child", "goal_purchase_requested", `Asked your grown-up about buying ${g.title}`, { goalId: id, approvalId: a.id });
  return a;
}

// ------------------------------------------------------------------ parent goals
function bumpGoals(db, type) {
  for (const g of db.parentGoals) {
    if (g.status !== "active" || g.type !== type) continue;
    g.progress = Math.min(g.count, g.progress + 1);
    if (g.progress >= g.count) {
      g.completedAt = Date.now();
      if (g.reward === 0) {
        g.status = "done";
        notify(db, "child", `You finished ${g.title}!`, "celebrate");
        notify(db, "parent", `${db.child.name} finished ${g.title} (no cash reward)`, "info");
        audit(db, "system", "goal_completed", `Goal "${g.title}" verified complete (${g.progress}/${g.count}); no cash reward`, { goalId: g.id });
        continue;
      }
      g.status = "awaiting_approval";
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
  if (typeof title !== "string" || !title.trim() || title.trim().length > 120) throw new GameError("Give the goal a short title");
  if (!["number", "string"].includes(typeof count) || !Number.isInteger(Number(count)) || !(Number(count) >= 1 && Number(count) <= 50)) throw new GameError("Count must be between 1 and 50");
  if (!["number", "string"].includes(typeof reward) || (typeof reward === "string" && !reward.trim()) || !Number.isFinite(Number(reward)) || !(Number(reward) >= 0 && Number(reward) <= 100)) throw new GameError("Reward must be between $0 and $100");
  count = Number(count);
  const passed = LESSONS.filter((l) => db.child.lessonsDone.includes(l.id)).length;
  const remaining = LESSONS.length - passed;
  if (type === "lessons" && count > remaining) {
    if (remaining === 0) throw new GameError(`${db.child.name} has already passed all lessons — choose tasks`);
    if (passed === 0) throw new GameError(`Pick up to ${remaining} lessons for ${db.child.name}, or choose tasks`);
    throw new GameError(`${db.child.name} has already passed ${passed} lessons — pick ${remaining} or fewer, or choose tasks`);
  }
  reward = Math.round(Number(reward) * 100);
  const g = { id: uid("pg"), title: title.trim(), type, count, reward, progress: 0, status: "active", createdAt: Date.now() };
  db.parentGoals.push(g);
  notify(db, "child", `New goal from your grown-up: "${g.title}" — earn ${dollars(reward)}!`, "mission");
  audit(db, "parent", "goal_created", `Created goal "${g.title}" (${count} ${type}) for ${dollars(reward)}`, { goalId: g.id });
  return g;
}

export function cancelParentGoal(db, goalId) {
  const goal = db.parentGoals.find((g) => g.id === goalId);
  if (!goal || goal.status !== "active") throw new GameError("Only active goals can be cancelled");
  goal.status = "cancelled";
  goal.cancelledAt = Date.now();
  notify(db, "child", `Your grown-up cancelled "${goal.title}". You can pick a new goal together!`, "info");
  audit(db, "parent", "goal_cancelled", `Cancelled goal "${goal.title}"`, { goalId });
  return goal;
}

// Resolve both the request and its inbox reminder together.
export function resolveParentNotification(db, ref) {
  for (const n of db.notifications) if (n.to === "parent" && n.ref === ref) n.read = true;
}

export function resolveEscalation(db, approval, status = "resolved") {
  approval.status = status;
  resolveParentNotification(db, approval.id);
  notify(db, "parent", `Resolved: ${approval.title}`, "info", `resolved:${approval.id}`);
}

export function postcardMetrics(db) {
  return { places: visitedSet(db).size, cards: db.postcards.length, total: Object.keys(PLACES).length };
}

// ------------------------------------------------------------------ daily missions
export const DAILY_MISSION_CAP = 6;
const missionTitle = (db, m) => m.title.replaceAll("<bear>", db.child.bear.name);

function missionEligible(db, key, day) {
  if (key === "track") return db.child.lastTrackedDay !== day;
  if (key === "save") return db.child.lastSaveDay !== day && db.accounts.spending.balance >= 100;
  if (key === "lesson") return LESSONS.some((l) => !db.child.lessonsDone.includes(l.id));
  if (key === "greet") return db.friends.some((f) => f.status === "approved" && (isDemoChild(db) || f.real));
  if (key === "trip") return db.child.points >= TRIP.cost && !db.adventures.some((a) => a.status === "away");
  return true;
}

// Stable daily rotation keeps seed() untouched and repeat reads predictable.
export function ensureDailyMissions(db, now = Date.now()) {
  const day = dayKey(now, db.settings.timezone);
  const shape = db.child.dailyMissions;
  if (shape?.dayKey !== day || !Array.isArray(shape.active) || !Array.isArray(shape.done)) db.child.dailyMissions = { dayKey: day, active: [], done: [] };
  const daily = db.child.dailyMissions;
  if (daily.done.length >= DAILY_MISSION_CAP) { daily.active = []; return daily; }
  daily.active = daily.active.filter((m) => missionEligible(db, m.key, day));
  const rest = MISSION_POOL.filter((m) => !["track", "save"].includes(m.key));
  const offset = [...day].reduce((sum, c) => sum + c.charCodeAt(0), 0) % rest.length;
  const pool = [...MISSION_POOL.slice(0, 2), ...rest.slice(offset), ...rest.slice(0, offset)];
  for (const m of pool) {
    if (daily.active.length >= 3) break;
    if (!missionEligible(db, m.key, day) || daily.done.some((d) => d.key === m.key) || daily.active.some((a) => a.key === m.key)) continue;
    daily.active.push({ key: m.key, assignedAt: now });
  }
  return daily;
}

export function missionsToday(db, now = Date.now()) {
  const candidate = { ...db, child: { ...db.child, dailyMissions: structuredClone(db.child.dailyMissions) } };
  ensureDailyMissions(candidate, now);
  if (JSON.stringify(candidate.child.dailyMissions) !== JSON.stringify(db.child.dailyMissions)) {
    const childId = childIdFor(db);
    if (childId) mutateChild(childId, (d) => ensureDailyMissions(d, now));
    else ensureDailyMissions(db, now);
  }
  const daily = db.child.dailyMissions;
  const describe = (entry) => {
    const m = MISSION_POOL.find((m) => m.key === entry.key);
    return { ...m, ...entry, title: missionTitle(db, m) };
  };
  return { active: daily.active.map(describe), done: daily.done.map(describe), doneCount: daily.done.length, cap: DAILY_MISSION_CAP };
}

// Call before changing eligibility; track/save/lesson already paid their reward.
export function missionEvent(db, key, now = Date.now()) {
  // Gamification must never break a save or spend: any surprise here is logged, not thrown.
  try {
    const daily = db.child.dailyMissions?.dayKey === dayKey(now, db.settings.timezone) ? db.child.dailyMissions : ensureDailyMissions(db, now);
    const m = MISSION_POOL.find((m) => m.key === key);
    if (!m || daily.done.length >= DAILY_MISSION_CAP || !daily.active.some((a) => a.key === key) || daily.done.some((d) => d.key === key)) return false;
    daily.active = daily.active.filter((a) => a.key !== key);
    daily.done.push({ key, doneAt: now, pts: m.pts });
    db.child.stats.dailyMissionsDone = (db.child.stats.dailyMissionsDone || 0) + 1;
    if (!["track", "save", "lesson"].includes(key)) addPoints(db, m.pts, `mission: ${missionTitle(db, m)}`);
    audit(db, "child", "daily_mission_done", `Mission done: ${missionTitle(db, m)}`, { key, points: m.pts, dayKey: daily.dayKey });
    notify(db, "child", `Mission done! +${m.pts} points`, "celebrate", `daily:${daily.dayKey}:${key}`);
    ensureDailyMissions(db, now);
    return true;
  } catch (e) {
    console.error(`[missions] ${key}: ${e.message}`);
    return false;
  }
}

export function missionSeen(db, key, now = Date.now()) {
  const daily = ensureDailyMissions(db, now);
  if (!MISSION_POOL.some((m) => m.key === key && m.kind === "seen") || !daily.active.some((m) => m.key === key)) throw new GameError("Pick one of today's missions");
  missionEvent(db, key, now);
  return { ok: true };
}

// ------------------------------------------------------------------ missions
export function createParentMission(db, { title, points = POINTS.parent, by = "parent" }) {
  if (typeof title !== "string" || !title.trim() || title.trim().length > 120) throw new GameError("Mission needs a short title");
  if (!["number", "string"].includes(typeof points) || !Number.isInteger(Number(points)) || !(Number(points) >= 5 && Number(points) <= 100)) throw new GameError("Pick 5 to 100 whole points");
  points = Number(points);
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

export function completeLesson(db, lessonId, answers, now = Date.now()) {
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
    ensureDailyMissions(db, now);
    db.child.lessonsDone.push(lessonId);
    db.child.stats.learningDone += 1;
    addPoints(db, POINTS.lesson, `finished lesson "${lesson.title}"`);
    missionEvent(db, "lesson", now);
    bumpGoals(db, "lessons");
    coopProgress(db);
  }
  return { passed, correct, total: lesson.questions.length, firstTime };
}

export function completeBudget(db, allocations, now = Date.now(), total = 2000) {
  // Allocations and total are integer cents. Keep the existing clock argument.
  if (!Number.isInteger(total) || total < 100 || total > 20000) throw new GameError("Plan $1 to $200 for your week");
  const keys = ["save", "needs", "fun", "give"];
  if (!allocations || Object.keys(allocations).length !== keys.length) throw new GameError("Fill in every part of your budget");
  const vals = keys.map((k) => allocations[k]);
  if (vals.some((v) => !Number.isInteger(v) || v < 0)) throw new GameError("Use positive amounts or zero in your budget");
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum !== total) throw new GameError(`Your budget adds up to ${dollars(sum)} — plan exactly ${dollars(total)}`);
  if (vals[0] < Math.ceil(total * 0.2)) throw new GameError("Try saving at least 20% — future you will say thanks!");
  if (vals[1] < Math.ceil(total * 0.25)) throw new GameError("Don't forget needs! Put at least 25% there.");
  const week = weekKey(now, db.settings.timezone);
  const repeat = db.child.lastBudgetWeek === week;
  db.child.lastBudgetWeek = week;
  db.child.lastBudget = { total, allocations: Object.fromEntries(keys.map((k, i) => [k, vals[i]])), plannedAt: now };
  db.child.stats.budgetsDone += 1;
  if (!repeat) addPoints(db, POINTS.budget, "weekly budgeting challenge");
  audit(db, "child", "budget_done", `Weekly budget: save ${dollars(vals[0])}, needs ${dollars(vals[1])}, fun ${dollars(vals[2])}, give ${dollars(vals[3])}`);
  return { pointsAwarded: repeat ? 0 : POINTS.budget };
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
  ensureDailyMissions(db, now);
  const key = dayKey(now, db.settings.timezone);
  db.child.stats.savingsActions += 1;
  if (db.child.lastSaveDay !== key) {
    db.child.lastSaveDay = key;
    addPoints(db, POINTS.save, "saved toward a goal");
    missionEvent(db, "save", now);
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
  if (!Number.isInteger(amount) || !(amount >= 1 && amount <= 1000000)) throw new GameError("Enter how much you spent");
  if (typeof memo !== "string" || !memo.trim() || memo.trim().length > 120) throw new GameError("What did you buy?");
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

// Apple Cash receipts describe purchases already paid outside the app. Funding
// covers the record; short receipts wait for a parent deposit without a debit.
export function parentWalletSend() {
  throw new GameError("Use Add money in Allowance to fund Apple Cash", 410);
}

const FUNDING_SHORT = "Your grown-up's funding is short for that. Ask them to add money!";
function fundingShort(db, receipt) {
  return { error: FUNDING_SHORT, reason: "funding_short", shortBy: receipt.amount - db.accounts.parent.balance };
}

function postWalletReceipt(db, receipt, policy, now, actor = "child") {
  if (db.accounts.parent.balance < receipt.amount) return fundingShort(db, receipt);
  const verdict = policy(db, receipt.amount, receipt.merchant, { alreadyPaid: true });
  const txn = {
    id: uid("txn"), pendingId: receipt.id, ts: receipt.ts, recordedAt: now, from: "parent", to: "merchant",
    amount: receipt.amount, kind: "wallet_spend", memo: receipt.merchant, merchant: receipt.merchant,
    idempotencyKey: receipt.idempotencyKey, status: "posted",
    overLimit: !!verdict.overLimit, unusual: !!verdict.unusual,
  };
  if (receipt.external_id !== undefined) txn.external_id = receipt.external_id;
  // These receipts are local records, not instructions to the bank mirror.
  db.accounts.parent.balance -= txn.amount;
  db.transactions.push(txn);
  (db.walletReceipts ||= {})[receipt.idempotencyKey] = { ...txn };
  db.walletPending = (db.walletPending || []).filter((p) => p.id !== receipt.id);
  for (const n of db.notifications) if (n.ref === receipt.id) n.read = true;
  dailyTrackingBonus(db, now);
  audit(db, actor, "wallet_spend", `Recorded ${dollars(txn.amount)} paid with Apple Cash at ${txn.merchant}`, { txnId: txn.id, pendingId: receipt.id });
  moneyMoved(db, "Apple Cash purchase recorded");
  return { ...txn, duplicate: false };
}

export function childWalletSpend(db, { amount, merchant, at, external_id }, policy, now = Date.now()) {
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) throw new GameError("Enter how much you spent");
  if (typeof merchant !== "string" || !merchant.trim() || merchant.trim().length > 120) throw new GameError("Where did you spend it?");
  merchant = merchant.trim();
  if (external_id !== undefined && (typeof external_id !== "string" || !external_id.trim() || external_id.trim().length > 64)) throw new GameError("Use a short transaction ID");
  const key = external_id === undefined ? null : `wallet:${external_id.trim()}`;
  let ts = now;
  if (at !== undefined) {
    if (typeof at === "number") ts = at;
    else if (typeof at === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(at)) ts = Date.parse(at);
    else throw new GameError("Use an ISO date with a time zone or a timestamp");
    if (!Number.isSafeInteger(ts) || ts < 0 || !Number.isFinite(new Date(ts).getTime())) throw new GameError("Use a valid transaction date");
  }
  // Durable receipts preserve idempotency beyond rolling ledger/pending retention.
  const existing = key && (db.walletReceipts?.[key] || db.transactions.find((t) => t.idempotencyKey === key));
  if (existing && existing.status !== "waiting") return { ...existing, duplicate: true };
  const receipt = existing || {
    id: uid("wpend"), ts, createdAt: now, amount, merchant, status: "waiting",
    idempotencyKey: key || uid("wallet"), ...(key ? { external_id: external_id.trim() } : {}),
  };
  if (db.accounts.parent.balance >= receipt.amount) return postWalletReceipt(db, receipt, policy, now);
  if (!existing) {
    (db.walletReceipts ||= {})[receipt.idempotencyKey] = receipt;
    (db.walletPending ||= []).push(receipt);
    if (db.walletPending.length > 20) db.walletPending.splice(0, db.walletPending.length - 20);
    notify(db, "parent", `${db.child.name}'s Apple Cash spent ${dollars(amount)} at ${merchant} but funding only has ${dollars(db.accounts.parent.balance)} — add money, then record it.`, "guardian", receipt.id);
    audit(db, "child", "wallet_pending", `Apple Cash purchase of ${dollars(amount)} at ${merchant} is waiting for funding`, { pendingId: receipt.id });
  }
  return fundingShort(db, receipt);
}

export function recordWalletPending(db, pendingId, policy, now = Date.now()) {
  pendingId = id(pendingId);
  const receipt = db.walletPending?.find((p) => p.id === pendingId);
  if (!receipt) {
    const original = Object.values(db.walletReceipts || {}).find((r) => r.pendingId === pendingId);
    if (original) return { ...original, duplicate: true };
    throw new GameError("That receipt is no longer waiting", 404);
  }
  return postWalletReceipt(db, receipt, policy, now, "parent");
}

export function dismissWalletPending(db, pendingId) {
  pendingId = id(pendingId);
  const receipt = db.walletPending?.find((p) => p.id === pendingId);
  if (!receipt) throw new GameError("That receipt is no longer waiting", 404);
  db.walletReceipts[receipt.idempotencyKey] = { ...receipt, status: "dismissed" };
  db.walletPending = db.walletPending.filter((p) => p.id !== pendingId);
  for (const n of db.notifications) if (n.ref === pendingId) n.read = true;
  audit(db, "parent", "wallet_pending_dismissed", `Dismissed Apple Cash receipt of ${dollars(receipt.amount)} at ${receipt.merchant}`, { pendingId });
  return { ok: true };
}

export function journal(db, { direction, amount, note, prices }, now = Date.now()) {
  if (!["received", "spent", "saved"].includes(direction)) throw new GameError("Pick what happened");
  if (!Number.isInteger(amount) || !(amount >= 0 && amount <= 1000000)) throw new GameError("Enter an amount from $0 to $10,000");
  if (typeof note !== "string" || !note.trim() || note.trim().length > 120) throw new GameError("Add a short note");
  if (prices !== undefined && (!Array.isArray(prices) || prices.length !== 2 || !prices.every((p) => Number.isInteger(p) && p > 0 && p <= 1000000))) throw new GameError("Add two prices from $0.01 to $10,000");
  ensureDailyMissions(db, now);
  db.tracking.push({ id: uid("trk"), ts: now, direction, amount: Math.round(amount) || 0, note: note.trim(), ...(prices ? { prices } : {}) });
  const bonus = dailyTrackingBonus(db, now);
  missionEvent(db, "journal", now);
  if (prices) missionEvent(db, "compare", now);
  return { bonus };
}

export function requestExtraAllowance(db, { amount, reason }) {
  if (!Number.isInteger(amount) || !(amount >= 100 && amount <= 5000)) throw new GameError("Ask for between $1 and $50");
  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 120) throw new GameError("Tell your grown-up why");
  const approval = { id: uid("apr"), kind: "extra", status: "pending", createdAt: Date.now(), amount, reason: reason.trim(),
    title: `${db.child.name} asked for ${dollars(amount)} extra`, detail: `"${reason.trim()}"` };
  db.approvals.push(approval);
  notify(db, "parent", `${db.child.name} asked for ${dollars(amount)} extra allowance.`, "approval", approval.id);
  return approval;
}

// ------------------------------------------------------------------ approvals
export function decide(db, approvalId, approve, note = "") {
  const a = db.approvals.find((x) => x.id === approvalId);
  if (a?.real) throw new GameError("Use the family approval step");
  const canDecline = a && !approve && a.status === "approved" && !a.paidTxnId && ["reward", "extra", "spend", "goal_purchase"].includes(a.kind);
  if (!a || (a.status !== "pending" && !canDecline)) throw new GameError("That request was already handled");
  resolveParentNotification(db, a.id);
  a.status = approve ? "approved" : "declined";
  a.decidedAt = Date.now();
  a.note = note;
  audit(db, "parent", a.kind === "topup" ? "handled" : approve ? "approved" : "declined", `${a.kind === "topup" ? "Handled" : approve ? "Approved" : "Declined"}: ${a.title}`, { approvalId: a.id, kind: a.kind });
  if (!approve) {
    delete a.escalatedAt;
    for (const related of db.approvals) if (related.approvalId === a.id && ["topup", "child_funds"].includes(related.kind)) resolveEscalation(db, related);
  }

  switch (a.kind) {
    case "review": {
      const txn = db.transactions.find((t) => t.id === a.txnId);
      if (approve && txn) txn.acknowledged = true;
      break;
    }
    case "goal_purchase":
      if (!approve) notify(db, "child", `Let's wait a little on ${a.memo}. Your saving success still counts!${note ? ` ${note}` : ""}`, "info");
      break; // Guardian records the approved purchase.
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
      notify(db, "parent", `Funding request handled: ${a.title}`, "info", `resolved:${a.id}`);
      break;
  }
  return a;
}

// The period timestamp survives calendar-key changes. Older ledgers store the
// payout time, which is a conservative fallback until the next scheduled payout.
export function allowanceLastPaidAt(db) {
  if (db.allowance.lastPaidAt == null) {
    const paid = db.transactions.filter((t) => t.kind === "allowance" && t.status === "posted" && !t.injected);
    db.allowance.lastPaidAt = paid.length ? Math.max(...paid.map((t) => t.ts)) : null;
  }
  return db.allowance.lastPaidAt;
}

export function allowancePaidRecently(db, now) {
  const last = allowanceLastPaidAt(db);
  return last != null && now - last < db.allowance.cadenceDays * 86400000 - 6 * 3600000;
}

export function requestAllowanceRun(db, now = Date.now()) {
  const period = `allowance:${dayKey(now, db.settings.timezone)}`;
  if (allowancePaidRecently(db, now) || db.allowance.lastPeriod === period || db.transactions.some((t) => t.status === "posted" && (t.ref === period || t.idempotencyKey === `${period}:save` || t.idempotencyKey === `${period}:spend`))) {
    throw new GameError("Allowance for today was already paid");
  }
  db.allowance.nextRun = Math.min(db.allowance.nextRun, now);
}

// ------------------------------------------------------------------ adventures
export function visitedSet(db) {
  return new Set(db.postcards.filter((p) => p.source === "trip" || (p.source === undefined && !p.from)).map((p) => p.defId));
}

export function markAdventureSeen(db, adventureId, now = Date.now()) {
  const adventure = db.adventures.find((a) => a.id === adventureId);
  if (!adventure || adventure.status !== "returned") throw new GameError("That postcard hasn't arrived yet");
  adventure.revealedAt ??= now;
  return adventure;
}

export function startAdventure(db, destId, now = Date.now()) {
  if (typeof destId !== "string" || !Object.hasOwn(PLACES, destId)) throw new GameError("Unknown destination");
  const dest = PLACES[destId];
  if (!Number.isInteger(db.child.points) || !Number.isInteger(db.child.points - dest.cost)) throw new GameError("Points need a whole number");
  const bear = db.child.bear.name;
  if (db.adventures.some((a) => a.status === "away")) throw new GameError(`${bear} is already on an adventure!`);
  const owned = visitedSet(db);
  const status = placeStatus(destId, db.child, owned, owned, new Date(now), db.settings.timezone);
  if (!status.ok) throw new GameError(status.hidden ? "That place is still a secret!" : `Locked: ${status.reason}`);
  if (db.child.points < dest.cost) throw new GameError(`You need ${dest.cost - db.child.points} more points for ${dest.name}`);
  db.child.points -= dest.cost;
  const adv = { id: uid("adv"), destId, startedAt: now, returnsAt: now + ADVENTURE_MS, status: "away", postcardIds: [] };
  db.adventures.push(adv);
  audit(db, "child", "adventure_started", `Sent ${bear} to ${dest.name} for ${dest.cost} pts (savings untouched)`);
  return adv;
}

// Draw before mutating so a failed request never spends points. rng(max) is
// injectable; production uses crypto's unbiased integer draw.
export function startTrip(db, now = Date.now(), rng = randomInt) {
  const bear = db.child.bear.name;
  if (db.adventures.some((a) => a.status === "away")) throw new GameError(`${bear} is already on a trip!`);
  if (!Number.isInteger(db.child.points)) throw new GameError("Points need a whole number");
  if (db.child.points < TRIP.cost) throw new GameError(`Earn ${TRIP.cost - db.child.points} more points`);
  const collected = visitedSet(db);
  const open = Object.keys(PLACES).filter((id) => {
    const status = placeStatus(id, db.child, collected, collected, new Date(now), db.settings.timezone);
    return status.ok && !status.hidden;
  });
  const fresh = open.filter((id) => !collected.has(id));
  const pool = fresh.length ? fresh : open;
  if (!pool.length) throw new GameError("No trips are ready just yet");
  const weight = (id) => PLACES[id].rarity === "common" ? 3 : 1;
  const total = pool.reduce((sum, id) => sum + weight(id), 0);
  let ticket = rng(total);
  if (!Number.isInteger(ticket) || ticket < 0 || ticket >= total) throw new GameError("Let's try packing again");
  const destId = pool.find((id) => (ticket -= weight(id)) < 0);
  ensureDailyMissions(db, now);
  db.child.points -= TRIP.cost;
  const adv = { id: uid("adv"), destId, startedAt: now, returnsAt: now + ADVENTURE_MS, status: "away", postcardIds: [] };
  db.adventures.push(adv);
  audit(db, "child", "adventure_started", `Sent ${bear} on a surprise trip (${TRIP.cost} pts)`);
  missionEvent(db, "trip", now);
  return adv;
}

export function dueAdventures(db, now = Date.now()) {
  return db.adventures.filter((a) => a.status === "away" && a.returnsAt <= now);
}

const articleFor = (name) => /^[aeiou]/i.test(name) ? "an" : "a";

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
        : `${bear} is home with ${articleFor(PLACES[adv.destId].name)} ${PLACES[adv.destId].name} postcard!`,
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
  if (typeof id !== "string") throw new GameError("Unknown item");
  const c = COSMETICS.find((x) => x.id === id);
  if (!c) throw new GameError("Unknown item");
  if (cosmeticUnlocked(db, c)) throw new GameError("You already have it");
  if (c.cost == null) throw new GameError("This one is unlocked by a savings milestone");
  if (!Number.isInteger(db.child.points) || !Number.isInteger(db.child.points - c.cost)) throw new GameError("Points need a whole number");
  if (db.child.points < c.cost) throw new GameError(`You need ${c.cost - db.child.points} more points`);
  db.child.points -= c.cost;
  db.child.ownedCosmetics.push(c.id);
  db.child.bear[c.kind] = c.value; // put it on right away
  audit(db, "child", "cosmetic_bought", `Bought ${c.label} for ${c.cost} pts`);
}

export function equip(db, kind, value, now = Date.now()) {
  if (!SLOTS.includes(kind)) throw new GameError("Unknown slot");
  if (value === null) {
    if (kind === "background") throw new GameError("Pick a scene");
    ensureDailyMissions(db, now);
    const changed = db.child.bear[kind] !== null;
    db.child.bear[kind] = null;
    if (changed) missionEvent(db, "dress", now);
    return;
  }
  if (typeof value !== "string") throw new GameError("Unlock it first");
  const c = COSMETICS.find((x) => x.kind === kind && x.value === value);
  if (!c || !cosmeticUnlocked(db, c)) throw new GameError("Unlock it first");
  ensureDailyMissions(db, now);
  const changed = db.child.bear[kind] !== value;
  db.child.bear[kind] = value;
  if (changed) missionEvent(db, "dress", now);
}

export function renameBear(db, name) {
  const clean = String(name || "").replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 16);
  if (!clean) throw new GameError("Pick a name");
  db.child.bear.name = clean;
}

// ------------------------------------------------------------------ friends
const DIRECTORY = {
  "SAM-12": { name: "Sam", bear: { name: "Biscuit", hat: "straw_hat", eyes: "sunglasses" }, postcards: ["chicago", "new_york_city", "zion_national_park"] },
  "ZOE-88": { name: "Zoe", bear: { name: "Clover", hat: "flower_crown", outfit: "striped_shirt" }, postcards: ["yosemite_national_park", "san_francisco"] },
};

export function addFriendByCode(db, code) {
  if (childIdFor(db) && childRecord(childIdFor(db)).family_id !== DEMO_FAMILY_ID) throw new GameError("Add a friend with their code");
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
  if (!f || f.real) throw new GameError("You can only trade with approved friends");
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
export function sendGreeting(db, friendId, idx, now = Date.now()) {
  const f = db.friends.find((x) => x.id === friendId && x.status === "approved");
  if (!f || f.real) throw new GameError("Not an approved friend");
  const text = GREETINGS[idx];
  if (!text) throw new GameError("Pick a greeting");
  ensureDailyMissions(db, now);
  f.greetings = [...(f.greetings || []), { ts: now, text, from: "me" }].slice(-10);
  missionEvent(db, "greet", now);
}

function coopProgress(db) {
  if (childIdFor(db) && childRecord(childIdFor(db)).family_id !== DEMO_FAMILY_ID) return;
  // Team challenge: friends contribute learning challenges (friends' side is simulated).
  db.child.coopLearning = (db.child.coopLearning || 0) + 1;
}

// ------------------------------------------------------------------ views
/** What a friend is allowed to see. Never includes money. */
export function friendView(f) {
  if (f.real) {
    if (f.status !== "approved") {
      const peer = !f.initiator && readChild(f.peerId);
      const consented = peer && peer.friends.some((a) => a.id === f.id && a.initiator && a.parentAccepted);
      return { id: f.id, real: true, status: f.status, incoming: !f.initiator, childAccepted: f.childAccepted, ...(consented ? { name: firstName(peer), familyLabel: familyLabel(f.peerId) } : {}) };
    }
    const peer = readChild(f.peerId);
    const bear = Object.fromEntries(["name", "hat", "eyes", "neck", "outfit", "held", "friend", "background"].map((key) => [key, peer.child.bear[key]]));
    return { id: f.id, real: true, status: f.status, name: firstName(peer), bear, postcards: peer.postcards.map((p) => p.defId), metrics: { postcards: postcardMetrics(peer) }, greetings: f.greetings || [] };
  }
  return { id: f.id, name: f.name, status: f.status, bear: f.bear, postcards: f.postcards, metrics: { postcards: { places: new Set(f.postcards).size, cards: f.postcards.length, total: Object.keys(PLACES).length } }, greetings: f.greetings || [], coopLearning: f.coopLearning };
}

export function weeksToGoal(db, goal = currentGoal(db), extraSaving = 0) {
  if (!goal || ["bought", "archived"].includes(goal.status)) return null;
  const saved = db.accounts.savings.balance + extraSaving;
  const remaining = goal.target - saved;
  if (remaining <= 0) return 0;
  const weekly = Math.round((db.allowance.amount * db.allowance.savePct) / 100);
  if (weekly <= 0) return null;
  return Math.ceil(remaining / weekly);
}

// Real friendships are mirrored in the two private child documents. Only the
// route orchestrator resolves peers; callers cannot supply a peer child ID.
const SOCIAL_TTL = 7 * 86400000;
const firstName = (d) => d.child.name.trim().split(/\s+/)[0];
const unavailable = () => new GameError("Request not found", 404);
const activeFriend = (f) => f?.real && f.status === "approved";

function socialApproval(d, kind, record, title, detail = "Friends only see bears and postcards — never money.", notification = title) {
  const a = { id: uid("apr"), kind, real: true, status: "pending", createdAt: Date.now(), socialId: record.id, title, detail };
  d.approvals.push(a);
  notify(d, "parent", notification, "approval", a.id);
  return a;
}

function closeSocialApprovals(d, socialId, status) {
  for (const a of d.approvals.filter((a) => a.real && a.socialId === socialId && a.status === "pending")) {
    a.status = status;
    resolveParentNotification(d, a.id);
  }
}

function endTrade(docs, trades, status) {
  docs.forEach((d, i) => {
    trades[i].status = status;
    for (const card of d.postcards) if (card.lockedForTrade === trades[i].id) delete card.lockedForTrade;
    closeSocialApprovals(d, trades[i].id, status);
    notify(d, "child", status === "expired" ? "Your postcard swap expired. Your cards are ready again." : "Your postcard swap didn't go through.", "info");
    audit(d, "system", `trade_${status}`, `Postcard swap ${status}`);
  });
}

function advanceTrade(docs, trades, now) {
  if (!trades.every((t) => t.childAccepted && (!t.parentRequired || t.parentAccepted))) return;
  if (!docs.every((d, i) => activeFriend(d.friends.find((f) => f.id === trades[i].friendId)))) throw unavailable();
  const cards = docs.map((d, i) => d.postcards.find((p) => p.id === trades[i].cardId && p.defId === trades[i].give && p.lockedForTrade === trades[i].id));
  if (cards.some((p) => !p || PLACES[p.defId]?.rarity === "secret")) throw new GameError("Those postcards aren't ready to swap");
  docs.forEach((d, i) => {
    d.postcards.splice(d.postcards.indexOf(cards[i]), 1);
    const peer = docs[1 - i];
    d.postcards.push({ id: uid("pc"), defId: cards[1 - i].defId, source: "trade", collectedAt: now, from: firstName(peer) });
    trades[i].status = "done";
    trades[i].executedAt = now;
    closeSocialApprovals(d, trades[i].id, "approved");
    notify(d, "child", `Trade complete! A postcard from ${firstName(peer)} is in your album.`, "celebrate");
    audit(d, "system", "trade_done", `Traded ${trades[i].give} for ${trades[i].get}`, { tradeId: trades[i].id });
  });
}

function advanceFriend(docs, friends) {
  const aIndex = friends[0].initiator ? 0 : 1;
  const a = friends[aIndex], b = friends[1 - aIndex];
  const status = !a.parentAccepted ? "pending_parent_a" : !b.parentAccepted || !b.childAccepted ? "pending_parent_b" : "approved";
  friends.forEach((f) => { f.status = status; });
  const sender = docs[aIndex], recipient = docs[1 - aIndex];
  let card = recipient.approvals.find((r) => r.real && r.socialId === a.id);
  if (!card) card = socialApproval(recipient, "friend_request", b, `A child from another family wants to be friends with ${firstName(recipient)} — their grown-up is checking too`);
  if (a.parentAccepted) {
    card.title = `${firstName(sender)} (from ${familyLabel(childIdFor(sender))}) wants to be friends with ${firstName(recipient)}`;
    for (const n of recipient.notifications.filter((n) => n.to === "parent" && n.ref === card.id)) n.text = card.title;
    if (!b.nameRevealed) notify(recipient, "child", `${firstName(sender)} wants to be friends`, "info");
    b.nameRevealed = true;
  }
  if (status === "approved") docs.forEach((d, i) => {
    notify(d, "child", `You and ${firstName(docs[1 - i])} are now friends!`, "celebrate");
    audit(d, "system", "friend_accepted", "Friend request accepted", { friendId: friends[i].id });
  });
}

export function socialFriendsView(d) {
  return d.friends.filter((f) => (isDemoChild(d) || f.real) && !["declined", "removed"].includes(f.status)).map(friendView);
}

export function socialTradesView(d) {
  return d.trades.filter((t) => isDemoChild(d) || t.real).slice(-10).reverse().map(({ peerId, cardId, ...t }) => t);
}

// Validated actions run outside mutateChild so there is exactly one transaction.
export function runSocialAction(childId, action, input, recordId, now = Date.now()) {
  const body = object(input);
  const own = readChild(childId);
  let peerId, record, approval;
  if (action === "friend") {
    const code = str(body.code, { max: 64 }).toUpperCase();
    peerId = childForFriendCode(code);
    // Valid and invalid codes have identical public receipts; no name lookup.
    if (!peerId || peerId === childId) return { ok: true, message: "Request sent" };
    if (own.friends.some((f) => f.real && f.peerId === peerId && !["declined", "removed"].includes(f.status))) return { ok: true, message: "Request sent" };
  } else {
    if (action === "approval") {
      approval = own.approvals.find((a) => a.id === id(recordId) && a.real);
      if (!approval) throw unavailable();
      recordId = approval.socialId;
      record = (approval.kind === "friend_request" ? own.friends : own.trades).find((r) => r.id === recordId);
    } else if (action === "friendRespond" || action === "unfriend") {
      record = own.friends.find((f) => f.id === id(recordId) && f.real);
    } else if (action === "tradeRespond") {
      record = own.trades.find((t) => t.id === id(recordId) && t.real);
    } else {
      record = own.friends.find((f) => f.id === id(body.friendId) && activeFriend(f));
    }
    if (!record) throw unavailable();
    peerId = record.peerId;
  }
  return mutateChildren([childId, peerId], (docs) => {
    const [d, peer] = docs;
    ensureDailyMissions(d, now);
    if (action === "friend") {
      const common = { id: uid("fr"), real: true, status: "pending_parent_a", createdAt: now, parentAccepted: false };
      const a = { ...common, peerId, initiator: true, childAccepted: true };
      const b = { ...common, peerId: childId, initiator: false, childAccepted: false };
      d.friends.push(a);
      peer.friends.push(b);
      socialApproval(d, "friend_request", a, `${firstName(d)} wants to add a friend`, "Both grown-ups and the other child need to say yes. Your child’s name stays private until you approve.", `${firstName(d)} wants to add a friend — check the request in your Inbox`);
      socialApproval(peer, "friend_request", b, `A child from another family wants to be friends with ${firstName(peer)} — their grown-up is checking too`);
      notify(peer, "child", "Someone sent you a friend request — your grown-ups are checking", "info");
      audit(d, "child", "friend_requested", "Friend request sent");
      return { ok: true, message: "Request sent" };
    }
    if (action === "greet") {
      const other = peer.friends.find((f) => f.id === record.id);
      if (!activeFriend(record) || !activeFriend(other)) throw unavailable();
      const text = GREETINGS[integer(body.index, { min: 0, max: GREETINGS.length - 1 })];
      if (/team challenge/i.test(text)) throw new GameError("Pick another greeting");
      // Shared rolling window: both directions together have 20 messages/day.
      const recent = (record.greetingTimes || []).filter((ts) => ts > now - 86400000);
      if (recent.length >= 20) throw new GameError("Let's send more notes tomorrow!", 429);
      ensureDailyMissions(d, now);
      for (const f of [record, other]) f.greetingTimes = [...recent, now];
      record.greetings = [...(record.greetings || []), { ts: now, text, from: "me" }].slice(-10);
      other.greetings = [...(other.greetings || []), { ts: now, text, from: firstName(d) }].slice(-10);
      notify(peer, "child", `${firstName(d)}: ${text}`, "greeting");
      missionEvent(d, "greet", now);
      return { ok: true };
    }
    if (action === "trade") {
      const other = peer.friends.find((f) => f.id === record.id);
      if (!activeFriend(other)) throw unavailable();
      const give = id(body.give), get = id(body.get);
      if (![give, get].every((key) => Object.hasOwn(PLACES, key))) throw new GameError("Pick two postcards");
      if ([give, get].some((key) => PLACES[key].rarity === "secret")) throw new GameError("Secret postcards are yours to keep!");
      const cards = docs.map((doc, i) => doc.postcards.find((p) => p.defId === [give, get][i] && !p.lockedForTrade));
      if (cards.some((p) => !p)) throw new GameError("Those postcards aren't ready to swap");
      const tradeId = uid("trd");
      docs.forEach((doc, i) => {
        const t = { id: tradeId, real: true, friendId: record.id, peerId: [peerId, childId][i], initiator: i === 0, give: [give, get][i], get: [get, give][i], cardId: cards[i].id, status: "pending", createdAt: now, expiresAt: now + SOCIAL_TTL, childAccepted: i === 0, parentRequired: doc.settings.requireTradeApproval, parentAccepted: false };
        doc.trades.push(t);
        cards[i].lockedForTrade = tradeId;
        audit(doc, "child", "trade_proposed", "Postcard swap proposed", { tradeId });
      });
      notify(peer, "child", `${firstName(d)} would like to swap postcards!`, "info");
      return socialTradesView(d).find((t) => t.id === tradeId);
    }
    const isTrade = action === "tradeRespond" || approval?.kind === "trade";
    const records = docs.map((doc) => (isTrade ? doc.trades : doc.friends).find((r) => r.id === record.id && r.real));
    if (records.some((r) => !r)) throw unavailable();
    if (action === "unfriend") {
      if (!activeFriend(records[0])) throw unavailable();
      docs.forEach((doc, i) => {
        records[i].status = "removed";
        audit(doc, "parent", "friend_removed", "Friendship ended");
        notify(doc, "child", "This friendship has ended.", "info");
      });
      for (const t of d.trades.filter((t) => t.real && t.friendId === record.id && t.status === "pending")) {
        const other = peer.trades.find((r) => r.id === t.id);
        if (other) endTrade(docs, [t, other], "cancelled");
      }
      return { ok: true };
    }
    if (isTrade && records[0].status === "pending" && now >= records[0].expiresAt) {
      endTrade(docs, records, "expired");
      return { ok: true, status: "expired" };
    }
    if (isTrade ? records[0].status !== "pending" : !["pending_parent_a", "pending_parent_b"].includes(records[0].status)) throw unavailable();
    if (isTrade) records.forEach((t, i) => { t.parentRequired ||= docs[i].settings.requireTradeApproval; });
    const approve = bool(body.approve);
    if (approval) {
      if (approval.status !== "pending") throw unavailable();
      // Validate optional notes but never send private decline reasons across families.
      if (Object.hasOwn(body, "note")) str(body.note, { required: false });
      approval.status = approve ? "approved" : "declined";
      approval.decidedAt = now;
      resolveParentNotification(d, approval.id);
      records[0].parentAccepted = approve;
      audit(d, "parent", approve ? "approved" : "declined", `${approve ? "Approved" : "Declined"}: ${approval.title}`);
    } else {
      if (records[0].initiator || records[0].childAccepted) throw unavailable();
      records[0].childAccepted = approve;
    }
    if (!approve) {
      if (isTrade) endTrade(docs, records, "declined");
      else docs.forEach((doc, i) => {
        records[i].status = "declined";
        closeSocialApprovals(doc, record.id, "declined");
        notify(doc, "child", records[i].initiator ? "Your friend request didn't go through." : "Request closed", "info");
        if (records[i].initiator && !records[0].initiator) notify(doc, "parent", `${firstName(docs[1 - i])}'s family said not right now`, "info");
        audit(doc, "system", "friend_declined", "Friend request did not go through");
      });
    } else if (!isTrade) advanceFriend(docs, records);
    else {
      if (records.every((t) => t.childAccepted)) docs.forEach((doc, i) => {
        if (records[i].parentRequired && !doc.approvals.some((a) => a.real && a.socialId === record.id)) {
          socialApproval(doc, "trade", records[i], `${firstName(doc)} wants to swap postcards with ${firstName(docs[1 - i])}`, `Give ${PLACES[records[i].give].name} ↔ get ${PLACES[records[i].get].name}`);
        }
      });
      advanceTrade(docs, records, now);
    }
    return approval ? { ...approval } : { ok: true, status: records[0].status };
  });
}

export function expireSocialTrades(childId, now = Date.now()) {
  for (const t of readChild(childId).trades.filter((t) => t.real && t.status === "pending" && now >= t.expiresAt)) {
    mutateChildren([childId, t.peerId], (docs) => {
      const trades = docs.map((d) => d.trades.find((r) => r.id === t.id));
      if (trades.every((r) => r?.status === "pending")) endTrade(docs, trades, "expired");
    });
  }
}

export function isDemoChild(d) {
  return !childIdFor(d) || childRecord(childIdFor(d)).family_id === DEMO_FAMILY_ID;
}

export function socialApprovalsView(d) {
  return d.approvals.filter((a) => isDemoChild(d) || a.real || !["friend", "trade"].includes(a.kind)).map((a) => {
    const friend = a.real && a.kind === "friend_request" && d.friends.find((f) => f.id === a.socialId);
    return friend?.status === "declined" ? { ...a, status: "declined" } : a;
  });
}
