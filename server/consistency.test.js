import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "moneyquest-consistency-"));
const previousDataDir = process.env.MQ_DATA_DIR;
process.env.MQ_DATA_DIR = dataDir;
const { seed, readChild, mutateChild, createChild } = await import("./store.js");
const { database, closeDatabase } = await import("./db.js");
const game = await import("./domain.js");
const catalog = await import("./catalog.js");
const { actions } = await import("./actions.js");
const { runGuardian, injectDuplicatePosting } = await import("./guardian.js");
const { dayKey, weekKey } = await import("./time.js");
const { chat } = await import("./buddy.js");
const DAY = 86400000;
const { childView, parentView, routeActions } = await import("./index.js");

after(() => {
  closeDatabase();
  if (previousDataDir === undefined) delete process.env.MQ_DATA_DIR;
  else process.env.MQ_DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("D2: lesson goals respect remaining unique lessons and cancellation stops progress", () => {
  const db = seed(Date.now());
  db.child.lessonsDone = catalog.LESSONS.slice(0, 3).map((l) => l.id);
  assert.throws(() => game.createParentGoal(db, { title: "Learn", type: "lessons", count: 3, reward: 5 }), {
    name: "Error", message: "Mia has already passed 3 lessons — pick 2 or fewer, or choose tasks", status: 400,
  });
  const goal = game.createParentGoal(db, { title: "Learn two", type: "lessons", count: 2, reward: 5 });
  actions.cancelGoal(db, goal.id);
  const lesson = catalog.LESSONS[3];
  game.completeLesson(db, lesson.id, lesson.questions.map((q) => q.answer));
  assert.equal(goal.status, "cancelled");
  assert.equal(goal.progress, 0);
  assert.ok(goal.cancelledAt);
  assert.match(db.notifications.at(-1).text, /cancelled.*pick a new goal together/);
  assert.equal(db.audit.find((a) => a.action === "goal_cancelled").data.goalId, goal.id);
  assert.throws(() => actions.cancelGoal(db, goal.id), game.GameError);
  assert.ok(routeActions.some((r) => r.method === "POST" && r.path === "/api/parent/goal/:id/cancel" && r.access === "parent"));
  db.child.lessonsDone = catalog.LESSONS.map((l) => l.id);
  assert.throws(() => actions.goal(db, { title: "Learn", type: "lessons", count: 1, reward: 5 }), /has already passed all lessons — choose tasks/);
});

test("D3: both views share trip-place, all-card and catalog-total metrics", () => {
  const db = seed(Date.now());
  db.postcards.push({ id: "trade", defId: "seattle", source: "trade" });
  db.postcards.push({ id: "trip", defId: "san_francisco", source: "trip" });
  for (const view of [childView(db), parentView(db)]) {
    assert.deepEqual(view.metrics.postcards, { places: 2, cards: 4, total: 15 });
    assert.equal(view.postcards.length, 4);
  }
});

test("D4: decisions read all matching reminders and duplicate approval refs appear once", () => {
  const db = seed(Date.now());
  const a = game.requestExtraAllowance(db, { amount: 100, reason: "A book" });
  game.notify(db, "parent", "Duplicate reminder", "approval", a.id);
  assert.equal(db.notifications.filter((n) => n.ref === a.id).length, 1);
  db.notifications.push({ ...db.notifications.at(-1), id: "legacy-duplicate" });
  assert.equal(parentView(db).notifications.filter((n) => n.ref === a.id).length, 1);
  game.decide(db, a.id, false);
  assert.ok(db.notifications.filter((n) => n.ref === a.id).every((n) => n.read));
  const trade = game.proposeTrade(db, "fr_maya", "chicago", "seattle");
  const approval = db.approvals.find((x) => x.tradeId === trade.id);
  game.decide(db, approval.id, true);
  assert.equal(db.notifications.find((n) => n.ref === approval.id).read, true);
});

test("D4: allowance and resolved funding escalations notify parents once", () => {
  const now = Date.now(), db = seed(now);
  db.accounts.parent.balance = 0;
  db.allowance.nextRun = now;
  runGuardian(db, now);
  const topup = db.approvals.find((a) => a.kind === "topup");
  actions.topup(db, { amount: 50 });
  runGuardian(db, now);
  assert.equal(db.notifications.find((n) => n.ref === topup.id).read, true);
  assert.ok(db.notifications.some((n) => n.to === "parent" && n.text === "Allowance paid: $5 to savings, $5 to spending"));
  assert.ok(db.notifications.some((n) => n.ref === `resolved:${topup.id}`));
  const count = db.notifications.length;
  runGuardian(db, now + 1000);
  assert.equal(db.notifications.length, count);
});

test("D4: automatic payout resolves escalation and reads its reminder", () => {
  const now = Date.now(), db = seed(now);
  const a = game.requestExtraAllowance(db, { amount: 500, reason: "Books" });
  game.decide(db, a.id, true);
  db.accounts.parent.balance = 0;
  runGuardian(db, now);
  const escalation = db.approvals.find((x) => x.approvalId === a.id);
  db.accounts.parent.balance = 5000;
  runGuardian(db, now + 1000);
  assert.equal(escalation.status, "resolved");
  assert.equal(db.notifications.find((n) => n.ref === escalation.id).read, true);
  assert.ok(db.notifications.some((n) => n.ref === `resolved:${escalation.id}`));
});

test("D5: allowance and duplicate audit sentences keep raw ids in data", () => {
  const now = Date.parse("2026-10-24T12:00:00Z"), db = seed(now);
  db.settings.timezone = "UTC";
  db.allowance.nextRun = now;
  runGuardian(db, now);
  const allowance = db.audit.find((a) => a.action === "allowance_paid");
  assert.equal(allowance.detail, "Paid allowance for the week of Oct 24");
  assert.equal(allowance.data.period, "allowance:2026-10-24");
  const duplicate = injectDuplicatePosting(db, now);
  runGuardian(db, now);
  const reversed = db.audit.find((a) => a.action === "duplicate_reversed");
  assert.equal(reversed.detail, "Kept the first posting, reversed the duplicate ($5.00)");
  assert.equal(reversed.data.reversed, duplicate.id);
  assert.ok(reversed.data.kept);
  assert.ok(!reversed.detail.includes(duplicate.id));
});

test("D10: seen receipt is durable, idempotent, exposed to both devices and validates arrival", () => {
  const db = seed(Date.now());
  const adventure = { id: "arrived", status: "returned", destId: "chicago", postcardIds: [] };
  db.adventures.push(adventure, { id: "away", status: "away" });
  actions.adventureSeen(db, "arrived");
  const receipt = adventure.revealedAt;
  game.markAdventureSeen(db, "arrived", receipt + 1000);
  assert.equal(adventure.revealedAt, receipt);
  assert.equal(childView(structuredClone(db)).adventures.find((a) => a.id === "arrived").revealedAt, receipt);
  assert.throws(() => actions.adventureSeen(db, "away"), game.GameError);
  assert.throws(() => actions.adventureSeen(db, "missing"), game.GameError);
  assert.throws(() => actions.adventureSeen(db, {}), game.GameError);
  assert.ok(routeActions.some((r) => r.method === "POST" && r.path === "/api/child/adventure/:id/seen" && r.access === "child"));
});

for (const legacy of [false, true]) test(`D11: ${legacy ? "legacy backfill" : "timestamp"} prevents zone-change repayment in both paths, permits next week`, () => {
  const now = Date.parse("2026-10-25T01:00:00Z"), db = seed(now);
  db.settings.timezone = "UTC";
  db.allowance.nextRun = now;
  runGuardian(db, now);
  assert.equal(db.allowance.lastPaidAt, now);
  if (legacy) delete db.allowance.lastPaidAt;
  actions.settings(db, { timezone: "America/Los_Angeles" });
  const before = db.accounts.parent.balance, sameEvening = now + 3600000;
  assert.throws(() => game.requestAllowanceRun(db, sameEvening), game.GameError);
  assert.equal(db.allowance.lastPaidAt, now);
  db.allowance.nextRun = sameEvening;
  runGuardian(db, sameEvening);
  assert.equal(db.accounts.parent.balance, before);
  game.requestAllowanceRun(db, now + 7 * DAY);
  runGuardian(db, now + 7 * DAY);
  assert.equal(db.accounts.parent.balance, before - 1000);
  assert.equal(db.allowance.lastPaidAt, now + 7 * DAY);
});

test("D11: six-hour DST tolerance still keeps the period-key guard", () => {
  const now = Date.now(), db = seed(now);
  db.allowance.nextRun = now;
  runGuardian(db, now);
  assert.throws(() => game.requestAllowanceRun(db, now + 7 * DAY - 7 * 3600000), game.GameError);
  game.requestAllowanceRun(db, now + 7 * DAY - 5 * 3600000);
  assert.equal(db.allowance.nextRun, now + 7 * DAY - 5 * 3600000);
  db.allowance.lastPaidAt = now - 8 * DAY;
  assert.throws(() => game.requestAllowanceRun(db, now), game.GameError);
});

test("Buddy offline plan: affordability replies persist a Home plan without moving money", async () => {
  const oldKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    database().prepare("INSERT INTO families (id, name, created_at) VALUES (?, ?, ?)").run("purchase-family", "Jordan", Date.now());
    const sibling = createChild("purchase-family", { name: "Leo", age: 8, bearName: "Pip" });
    const siblingBefore = structuredClone(readChild(sibling.id));
    for (const price of [5, 40]) {
      const db = seed(Date.now());
      const child = createChild("purchase-family", { name: "Mia", age: 9, bearName: "Maple" });
      mutateChild(child.id, (d) => Object.assign(d, db));
      const before = structuredClone(db.accounts);
      const result = await chat(child.id, `Can I buy a $${price} book?`);
      assert.match(result.reply, /spending money|you'd need/);
      assert.equal(readChild(child.id).buddy.plan.offline, true);
      assert.equal(readChild(child.id).buddy.plan.goalId, db.savingsGoals[0].id);
      assert.ok(readChild(child.id).buddy.plan.steps.length);
      assert.ok(readChild(child.id).audit.some((a) => a.action === "plan_updated"));
      assert.deepEqual(readChild(child.id).accounts, before);
      const saved = JSON.parse(database().prepare("SELECT doc FROM children WHERE id = ?").get(child.id).doc);
      assert.equal(saved.buddy.plan.reason, "you asked about a purchase");
      assert.deepEqual(readChild(sibling.id), siblingBefore);
    }
    const child = createChild("purchase-family", { name: "Mia", age: 9, bearName: "Maple" });
    await chat(child.id, "Can I buy a book?");
    assert.equal(readChild(child.id).buddy.plan, null);
    await chat(child.id, "I'm scared someone wants me to buy a $5 book");
    assert.equal(readChild(child.id).buddy.plan, null);
  } finally {
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
  }
});
