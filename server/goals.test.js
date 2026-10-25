import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { seed, migrate, _clearStoreForTest, readChild, mutateChild, _setForTest } from "./store.js";
import { _databaseForTest, closeDatabase } from "./db.js";
import { cancelReplan, snapshot, offlinePlan, offlineReply, replan, _internals } from "./buddy.js";
import { _clearLimitsForTest } from "./limits.js";
import { actions } from "./actions.js";
import * as game from "./domain.js";
import { runGuardian, hasDueWork, pendingFindings } from "./guardian.js";
import { childView, parentView, dispatch } from "./index.js";

const fresh = () => { const db = seed(Date.now()); db.child.name = "Ben"; db.child.bear.name = "Bo"; return db; };
const create = (db, title = "Lego set", target = 60, actor = "child") => actions.goalSave(db, { title, target, icon: "toy" }, null, actor);
const invariant = (db) => {
  assert.equal(db.savingsGoals.filter((g) => g.activeFlag).length, db.savingsGoals.length ? 1 : 0);
  assert.equal(db.child.currentGoalId === null, db.savingsGoals.length === 0);
};

beforeEach(() => { cancelReplan(); _clearStoreForTest(); _clearLimitsForTest(); _databaseForTest(); });
after(() => { cancelReplan(); _clearStoreForTest(); closeDatabase(); });

test("G1.1 migration preserves goals and selects one current live goal", () => {
  const db = fresh();
  delete db.child.currentGoalId;
  delete db.savingsGoals[0].status;
  db.savingsGoals.push({ id: "legacy", title: "Book", target: 500, createdAt: 1 });
  migrate(db);
  assert.equal(db.child.currentGoalId, "goal_bike");
  assert.equal(db.savingsGoals[0].status, "active");
  invariant(db);
  const before = structuredClone(db);
  migrate(db);
  assert.deepEqual(db, before);
  db.child.currentGoalId = "missing";
  migrate(db); invariant(db);
});

test("G1.2/3 kid and parent CRUD preserve current selection and history", () => {
  for (const actor of ["child", "parent"]) {
    const db = fresh(), goal = create(db, "Lego set", 60, actor);
    assert.equal(db.child.currentGoalId, "goal_bike");
    assert.equal(db.notifications.some((n) => n.to === "parent" && n.text === "Ben set a new goal: Lego set ($60.00)"), actor === "child");
    actions.goalSave(db, { title: "My books", target: "50.25", icon: "book" }, goal.id, actor);
    assert.equal(goal.target, 5025);
    actions.goalCurrent(db, goal.id, actor); invariant(db);
    assert.throws(() => actions.goalDelete(db, goal.id), /Choose another/);
    actions.goalArchive(db, goal.id, actor); invariant(db);
    assert.equal(goal.status, "archived");
    assert.ok(db.savingsGoals.includes(goal));
    actions.goalDelete(db, goal.id);
    assert.ok(!db.savingsGoals.includes(goal));
    assert.ok(db.audit.some((a) => a.actor === actor && a.action === "savings_goal_created"));
    actions.goalArchive(db, "goal_bike", actor); invariant(db);
    assert.equal(db.child.currentGoalId, "goal_bike");
    const next = create(db); invariant(db);
    assert.equal(db.child.currentGoalId, next.id);
  }
});

test("G1.2 validation rejects invalid goals atomically and accepts boundaries", () => {
  const db = fresh();
  for (const body of [null, [], {}, { title: "x", target: 60, icon: "unknown" }, { title: {}, target: 60, icon: "toy" }, { title: " ", target: 60, icon: "toy" }, { title: "x".repeat(41), target: 60, icon: "toy" }, ...[null, [], "NaN", Infinity, 0.99, 1000.01].map((target) => ({ title: "x", target, icon: "book" }))]) {
    const before = structuredClone(db);
    assert.throws(() => actions.goalSave(db, body), { status: 400 });
    assert.deepEqual(db, before);
  }
  for (const target of [1, 1000]) assert.equal(create(db, "x".repeat(40), target).target, target * 100);
  for (const fn of [actions.goalCurrent, actions.goalArchive, actions.goalDelete, actions.goalPurchase]) assert.throws(() => fn(db, "missing"), { status: 400 });
});

function reached(db) {
  const g = create(db);
  actions.goalCurrent(db, g.id);
  db.accounts.savings.balance = g.target;
  game.checkMilestones(db);
  return g;
}

test("G1.4 reached purchase pays exactly once, preserves milestones and selects next goal", () => {
  const db = fresh(), goal = reached(db);
  assert.equal(goal.status, "reached");
  game.checkMilestones(db);
  assert.equal(db.notifications.filter((n) => n.ref === `reached:${goal.id}`).length, 1);
  const milestones = [...db.child.milestonesUnlocked];
  const a = actions.goalPurchase(db, goal.id);
  assert.equal(actions.goalPurchase(db, goal.id), a);
  assert.equal(childView(db).pendingRequests.find((r) => r.id === a.id).goalId, goal.id);
  for (const fn of [() => actions.goalSave(db, { target: 1 }, goal.id), () => actions.goalArchive(db, goal.id), () => actions.goalDelete(db, goal.id)]) assert.throws(fn, { status: 400 });
  game.decide(db, a.id, true);
  runGuardian(db);
  for (let i = 0; i < 3; i++) runGuardian(db);
  assert.equal(db.accounts.savings.balance, 0);
  const txns = db.transactions.filter((t) => t.idempotencyKey === `goal:${goal.id}`);
  assert.equal(txns.length, 1);
  assert.equal(txns[0].from, "savings");
  assert.equal(txns[0].to, "merchant");
  assert.equal(goal.status, "bought");
  assert.equal(db.child.currentGoalId, "goal_bike"); invariant(db);
  assert.deepEqual(db.child.milestonesUnlocked, milestones);
  assert.equal(pendingFindings(db).length, 0);
  assert.throws(() => actions.goalDelete(db, goal.id), /bought goals/);
  assert.throws(() => game.decide(db, a.id, false), /already handled/);
  // Even after rolling ledger retention, a bought goal cannot be bought again.
  db.transactions = [];
  actions.goalPurchase(db, goal.id);
  runGuardian(db);
  assert.equal(db.accounts.savings.balance, 0);
  assert.equal(db.transactions.length, 0);
  assert.ok(db.notifications.some((n) => n.ref === `bought:${goal.id}`));
});

test("G1.4 declining keeps reached status, sends a kind note and permits a fresh request", () => {
  const db = fresh(), g = reached(db), a = actions.goalPurchase(db, g.id);
  game.decide(db, a.id, false, "Let's wait until Saturday.");
  runGuardian(db);
  assert.equal(g.status, "reached");
  assert.equal(db.accounts.savings.balance, 6000);
  assert.ok(db.notifications.some((n) => n.to === "child" && n.text.includes("saving success still counts") && n.text.includes("Saturday")));
  assert.equal(db.notifications.find((n) => n.ref === a.id).read, true);
  assert.notEqual(actions.goalPurchase(db, g.id).id, a.id);
});

test("G1.4 short savings escalates once, retries savings only, and can be declined unpaid", () => {
  for (const recover of [true, false]) {
    const db = fresh(), g = reached(db), a = actions.goalPurchase(db, g.id);
    db.accounts.savings.balance = 500;
    game.decide(db, a.id, true);
    runGuardian(db); runGuardian(db);
    assert.equal(db.accounts.savings.balance, 500);
    assert.equal(g.status, "reached");
    assert.equal(hasDueWork(db), false);
    const escalations = db.approvals.filter((r) => r.approvalId === a.id);
    assert.equal(escalations.length, 1);
    assert.match(escalations[0].title, /savings are short now/);
    assert.equal(escalations[0].kind, "child_funds");
    assert.equal(childView(db).pendingRequests.some((r) => r.id === a.id), true);
    if (recover) {
      db.accounts.savings.balance = 6000;
      assert.equal(hasDueWork(db), true);
      runGuardian(db);
      assert.equal(g.status, "bought");
      assert.equal(db.accounts.savings.balance, 0);
      assert.equal(escalations[0].status, "resolved");
    } else {
      game.decide(db, a.id, false);
      runGuardian(db);
      assert.equal(g.status, "reached");
      assert.equal(db.accounts.savings.balance, 500);
      assert.equal(a.status, "declined");
    }
  }
});

test("G1.4 reward and purchase in one Guardian pass retain intermediate milestones", () => {
  const db = fresh(), g = reached(db);
  const a = actions.goalPurchase(db, g.id);
  db.accounts.savings.balance = 0;
  const reward = { id: "reward_first", kind: "reward", amount: 10000, status: "approved", title: "Ben completed tasks" };
  db.approvals.unshift(reward);
  game.decide(db, a.id, true);
  runGuardian(db);
  assert.equal(db.accounts.savings.balance, 4000);
  assert.ok(db.child.milestonesUnlocked.includes(10000));
  assert.equal(g.status, "bought");
});

test("G1.4 buying the only live goal leaves history and lets the next creation become current", () => {
  const db = fresh();
  actions.goalArchive(db, "goal_bike");
  const g = reached(db), a = actions.goalPurchase(db, g.id);
  game.decide(db, a.id, true); runGuardian(db); invariant(db);
  assert.equal(db.child.currentGoalId, g.id);
  assert.equal(childView(db).goals.find((x) => x.id === g.id).status, "bought");
  assert.equal(create(db, "Next book", 10).id, db.child.currentGoalId);
});

test("G1.5/6 views and Buddy use current goal, list live goals and custom names", () => {
  const db = fresh(), g = create(db, "Trip", 90);
  actions.goalCurrent(db, g.id);
  assert.equal(game.weeksToGoal(db), 14);
  assert.equal(offlinePlan(db).goalId, g.id);
  assert.match(offlineReply(db, "When will I reach my goal?"), /Trip/);
  const snap = snapshot(db);
  assert.equal(snap.savings_goals.length, 2);
  assert.equal(snap.savings_goals.find((g) => g.current).id, g.id);
  assert.equal(childView(db).goals.find((g) => g.current).id, g.id);
  assert.equal(parentView(db).currentGoalId, g.id);
  actions.goalArchive(db, "goal_bike");
  assert.equal(snapshot(db).savings_goals.length, 1);
  actions.goalArchive(db, g.id);
  assert.equal(offlinePlan(db).goalId, null);
  assert.match(offlineReply(db, "Can I buy a $50 book?"), /Pick a new saving goal/);
  assert.doesNotMatch(JSON.stringify(db.audit) + JSON.stringify(snapshot(db)), /Maple/);
});

test("G1.5 Buddy rejects a stale plan for a different goal", async (t) => {
  const db = fresh(), g = create(db, "Trip", 90);
  actions.goalCurrent(db, g.id);
  _setForTest(db);
  const key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "mock-only";
  t.after(() => { if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key; });
  t.mock.method(_internals, "runClaude", async (messages, { executeTool }) => {
    const input = { summary: "Save for the current goal", steps: ["Save"], weekly_save_dollars: 5 };
    assert.ok(executeTool("update_savings_plan", { ...input, goal_id: "goal_bike" }).error);
    assert.equal(db.buddy.plan, null);
    assert.equal(executeTool("update_savings_plan", { ...input, goal_id: g.id }).ok, true);
    return { completed: false, reply: "" };
  });
  await replan("Current goal changed");
  assert.equal(db.buddy.plan.goalId, g.id);
});

// Exercise the real register/auth/dispatch path without opening a socket.
function device(ip) {
  let cookie = "";
  return async (method, path, body) => {
    const url = new URL(path, "http://test");
    const req = { body, ip, headers: { cookie }, query: Object.fromEntries(url.searchParams), get(k) { return this.headers[k.toLowerCase()]; } };
    const res = { statusCode: 200, headers: {}, set(k, v) { if (typeof k === "object") { for (const [key, value] of Object.entries(k)) this.set(key, value); } else this.headers[k.toLowerCase()] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } };
    await dispatch(method, url.pathname, req, res);
    if (res.headers["set-cookie"]) cookie = res.headers["set-cookie"].split(";")[0];
    return { status: res.statusCode, body: res.body };
  };
}

test("G1.2/3 routes enforce parent PIN, paired-child access and sibling ownership", async () => {
  const parent = device("parent");
  const me = await parent("POST", "/api/auth/register", { email: "goals@example.test", password: "password123", parentName: "Jordan", childName: "Ben", childAge: 9, bearName: "Bo" });
  assert.equal(me.status, 200);
  const id = me.body.activeChild.id;
  const link = await parent("POST", `/api/parent/children/${id}/link`, {});
  const kid = device("kid");
  assert.equal((await kid("POST", "/api/auth/link", { code: link.body.code })).status, 200);
  const sibling = await parent("POST", "/api/parent/children", { name: "Other", age: 8, bearName: "Pip" });
  assert.equal((await parent("POST", "/api/parent/pin", { pin: "2468" })).status, 200);
  assert.equal((await parent("POST", "/api/parent/lock", {})).status, 200);
  for (const [method, path, body] of [["POST", "goals", { title: "Game", target: 50, icon: "game" }], ["POST", "goals/goal_bike", { title: "Changed" }], ["POST", "goals/goal_bike/current", {}], ["POST", "goals/goal_bike/archive", {}], ["DELETE", "goals/goal_bike"]]) {
    assert.equal((await parent(method, `/api/parent/${path}`, body)).status, 403);
    assert.equal((await kid(method, `/api/parent/${path}`, body)).status, 403);
  }
  const created = await kid("POST", "/api/child/goals", { title: "Book", target: 60, icon: "book" });
  assert.equal(created.status, 200);
  const goalId = created.body.id;
  assert.equal((await kid("POST", `/api/child/goals/${goalId}`, { title: "Books" })).status, 200);
  assert.equal((await kid("POST", `/api/child/goals/${goalId}/current`, {})).status, 200);
  assert.equal((await kid("POST", `/api/child/goals/${goalId}/current?child=${sibling.body.id}`, {})).status, 404);
  assert.equal((await parent("POST", "/api/parent/unlock", { pin: "2468" })).status, 200);
  assert.equal((await parent("POST", `/api/parent/goals/${goalId}?child=${sibling.body.id}`, { title: "No" })).status, 400);
  assert.equal((await parent("POST", "/api/parent/savings-goal", { title: "Old", target: 60 })).status, 410);
  mutateChild(id, (db) => { db.accounts.savings.balance = 6000; });
  const a = await kid("POST", `/api/child/goals/${goalId}/purchase`, {});
  assert.equal(a.status, 200);
  assert.equal((await parent("POST", `/api/parent/approval/${a.body.id}`, { approve: true })).status, 200);
  assert.equal(readChild(id).savingsGoals.find((g) => g.id === goalId).status, "bought");
  const other = await parent("POST", "/api/parent/goals", { title: "Gift", target: 30, icon: "gift" });
  assert.equal(other.status, 200);
  assert.equal((await parent("POST", `/api/parent/goals/${other.body.id}/current`, {})).status, 200);
  assert.equal((await parent("POST", `/api/parent/goals/${other.body.id}`, { target: 35 })).status, 200);
  assert.equal((await parent("POST", `/api/parent/goals/${other.body.id}/archive`, {})).status, 200);
  assert.equal((await parent("DELETE", `/api/parent/goals/${other.body.id}`)).status, 200);
  invariant(readChild(id));
});
