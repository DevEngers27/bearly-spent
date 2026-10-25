import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { seed, mutate, read, _setForTest, subscribe } from "./store.js";
import * as game from "./domain.js";
import { transfer } from "./bank.js";
import { COSMETICS } from "./catalog.js";
import { runGuardian, hasDueWork, pendingFindings, reconcileNow, spendPolicy, injectDuplicatePosting } from "./guardian.js";
import { actions } from "./actions.js";
import { dayKey } from "./time.js";

const DAY = 86400000;
const fresh = () => seed(Date.now());
const indexSource = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");

// Exercise the actual HTTP callbacks and act helper without importing the
// server entrypoint, which starts a listener and a recurring timer.
function routeMutation(path, body = {}) {
  const start = indexSource.indexOf(`app.post("${path}",`);
  assert.ok(start >= 0);
  const end = indexSource.indexOf("\napp.post(", start + 1);
  let handler;
  new Function("app", "route", "act", "cents", "game", "actions", indexSource.slice(start, end))(
    { post: (_path, fn) => { handler = fn; } },
    (fn) => fn, (fn) => fn, (v) => Math.round(Number(v) * 100), game, actions,
  );
  return handler({ body });
}

function actionRunner(db, replans = []) {
  const start = indexSource.indexOf("const PAYOUT =");
  const end = indexSource.indexOf("\nconst route =", start);
  return new Function("mutate", "runGuardian", "reconcileNow", "queueReplan", `${indexSource.slice(start, end)}\nreturn act;`)(
    (fn) => fn(db), runGuardian, reconcileNow, (reason) => replans.push(reason),
  );
}

function approvedReward(db, amount = 500) {
  const goal = game.createParentGoal(db, { title: "Learn something", type: "lessons", count: 1, reward: amount / 100 });
  game.completeLesson(db, "needs_wants", [0, 1, 0, 1]);
  const approval = db.approvals.find((a) => a.goalId === goal.id);
  game.decide(db, approval.id, true);
  return approval;
}

function approvedSpend(db) {
  db.accounts.spending.balance = 3000;
  game.childSpend(db, { amount: 2500, memo: "Lego" }, spendPolicy);
  const approval = db.approvals.find((a) => a.kind === "spend");
  game.decide(db, approval.id, true);
  db.accounts.spending.balance = 1000;
  return approval;
}

test("M3 duplicate allowance is audited without payout notifications or replanning", () => {
  const db = fresh();
  const now = Date.now();
  db.allowance.nextRun = now;
  runGuardian(db, now);
  const balances = structuredClone(db.accounts);
  const notifications = db.notifications.length;
  const paid = db.audit.filter((a) => a.action === "allowance_paid").length;
  db.allowance.nextRun = now;
  const replans = [];
  actionRunner(db, replans)(() => {}, "duplicate_allowance");
  assert.deepEqual(db.accounts, balances);
  assert.equal(db.notifications.length, notifications);
  assert.equal(db.audit.filter((a) => a.action === "allowance_paid").length, paid);
  assert.ok(db.audit.some((a) => /allowance period .* already paid; skipped/.test(a.detail)));
  assert.deepEqual(replans, []);
  assert.equal(db.allowance.nextRun, now + 7 * DAY);
});

test("M3 run-now rejects today's paid period with a GameError", () => {
  const db = fresh();
  routeMutation("/api/parent/allowance/run-now")(db);
  runGuardian(db, Date.now());
  const before = db.allowance.nextRun;
  assert.throws(() => routeMutation("/api/parent/allowance/run-now")(db), (e) => e instanceof game.GameError && e.status === 400 && e.message === "Allowance for today was already paid");
  assert.equal(db.allowance.nextRun, before);
  // The ledger also protects saves whose lastPeriod marker is absent.
  delete db.allowance.lastPeriod;
  assert.throws(() => game.requestAllowanceRun(db), /Allowance for today was already paid/);
});

test("M3 a duplicate period skips even when parent funds are empty", () => {
  const db = fresh();
  const now = Date.now();
  db.allowance.savePct = 100;
  db.allowance.nextRun = now;
  runGuardian(db, now);
  db.accounts.parent.balance = 0;
  db.allowance.nextRun = now;
  runGuardian(db, now);
  assert.equal(db.approvals.filter((a) => a.kind === "topup").length, 0);
  assert.equal(db.audit.filter((a) => a.action === "allowance_skipped").length, 1);
});

test("M19 run-now preserves overdue allowance periods", () => {
  const db = fresh();
  const now = Date.now();
  const overdue = now - 2 * 7 * DAY;
  db.allowance.nextRun = overdue;
  routeMutation("/api/parent/allowance/run-now")(db);
  assert.equal(db.allowance.nextRun, overdue);
  const before = db.accounts.parent.balance;
  runGuardian(db, now);
  assert.equal(before - db.accounts.parent.balance, 3 * db.allowance.amount);
  assert.equal(db.allowance.nextRun, overdue + 3 * 7 * DAY);
});

test("M25 catch-up pays at most four periods per pass and summarizes each back-pay", () => {
  const db = fresh();
  const now = Date.now();
  const first = now - 9 * 7 * DAY;
  db.allowance.nextRun = first;
  const before = db.accounts.parent.balance;
  runGuardian(db, now);
  assert.equal(before - db.accounts.parent.balance, 4000);
  assert.equal(db.allowance.nextRun, first + 4 * 7 * DAY);
  assert.equal(hasDueWork(db, now), true);
  const summaries = () => db.notifications.filter((n) => n.to === "parent" && n.text.startsWith("Back-paid"));
  assert.equal(summaries().length, 1);
  assert.equal(summaries()[0].text, `Back-paid 4 weeks of allowance (${dayKey(first, db.settings.timezone)} → ${dayKey(first + 3 * 7 * DAY, db.settings.timezone)})`);
  runGuardian(db, now + 2000);
  assert.equal(before - db.accounts.parent.balance, 8000);
  runGuardian(db, now + 4000);
  assert.equal(before - db.accounts.parent.balance, 10000);
  assert.equal(summaries().length, 3);
  assert.equal(hasDueWork(db, now + 4000), false);
});

test("M4 child funds escalation retries automatically when spending money recovers", () => {
  const db = fresh();
  const now = Date.now();
  const a = approvedSpend(db);
  runGuardian(db, now);
  const escalation = db.approvals.find((x) => x.kind === "child_funds");
  assert.equal(escalation.title, "Mia's spending money is short by $15.00 for 'Lego'");
  assert.match(escalation.detail, /save less or earn more.*decline/);
  assert.equal(escalation.approvalId, a.id);
  assert.equal(a.escalatedAt, now);
  assert.equal(hasDueWork(db, now), false);
  runGuardian(db, now + 2000);
  assert.equal(db.approvals.filter((x) => x.kind === "child_funds").length, 1);
  db.accounts.spending.balance = 2500;
  assert.equal(hasDueWork(db, now + DAY), true);
  runGuardian(db, now + DAY);
  assert.equal(db.accounts.spending.balance, 0);
  assert.ok(a.paidTxnId);
  assert.equal(a.escalatedAt, undefined);
  assert.equal(escalation.status, "resolved");
  assert.equal(hasDueWork(db, now + DAY), false);
});

test("M4 parent-funded reward and extra escalations retry without a topup-route reset", () => {
  for (const kind of ["reward", "extra"]) {
    const db = fresh();
    const now = Date.now();
    const a = kind === "reward" ? approvedReward(db) : game.requestExtraAllowance(db, { amount: 500, reason: "Book" });
    if (kind === "extra") game.decide(db, a.id, true);
    db.accounts.parent.balance = 100;
    runGuardian(db, now);
    const escalation = db.approvals.find((x) => x.kind === "topup");
    assert.equal(escalation.approvalId, a.id);
    assert.equal(hasDueWork(db, now), false);
    db.accounts.parent.balance = 2000;
    assert.equal(hasDueWork(db, now + 2000), true);
    runGuardian(db, now + 2000);
    assert.ok(a.paidTxnId);
    assert.equal(a.escalatedAt, undefined);
    assert.equal(escalation.status, "resolved");
  }
});

test("M4 approved unpaid obligations can be declined and resolve related escalations", () => {
  for (const kind of ["reward", "extra", "spend"]) {
    const db = fresh();
    const now = Date.now();
    const a = kind === "reward" ? approvedReward(db) : kind === "spend" ? approvedSpend(db) : game.requestExtraAllowance(db, { amount: 500, reason: "Book" });
    if (kind === "extra") game.decide(db, a.id, true);
    if (kind !== "spend") db.accounts.parent.balance = 0;
    runGuardian(db, now);
    const related = db.approvals.find((x) => x.approvalId === a.id);
    assert.ok(related);
    const accounts = structuredClone(db.accounts);
    game.decide(db, a.id, false);
    assert.equal(a.status, "declined");
    assert.equal(related.status, "resolved");
    assert.ok(db.audit.some((x) => x.action === "declined" && x.data.approvalId === a.id));
    runGuardian(db, now + 2000);
    assert.deepEqual(db.accounts, accounts);
    assert.equal(hasDueWork(db, now + 2000), false);
  }
});

test("M4 paid approvals still cannot be declined", () => {
  const db = fresh();
  const a = approvedReward(db);
  runGuardian(db, Date.now());
  assert.throws(() => game.decide(db, a.id, false), game.GameError);
  assert.equal(a.status, "approved");
});

test("M4 parent topup only clears parent-funded payout escalation markers", () => {
  const db = fresh();
  const spend = approvedSpend(db);
  const reward = approvedReward(db);
  const extra = game.requestExtraAllowance(db, { amount: 500, reason: "Book" });
  game.decide(db, extra.id, true);
  db.accounts.parent.balance = 0;
  runGuardian(db, Date.now());
  const spendingEscalation = spend.escalatedAt;
  routeMutation("/api/parent/topup", { amount: 50 })(db);
  assert.equal(spend.escalatedAt, spendingEscalation);
  assert.equal(reward.escalatedAt, undefined);
  assert.equal(extra.escalatedAt, undefined);
  runGuardian(db, Date.now());
  assert.ok(reward.paidTxnId && extra.paidTxnId);
  assert.equal(spend.paidTxnId, undefined);
  assert.equal(db.approvals.filter((a) => a.kind === "child_funds").length, 1);
});

test("M5 zero reward goals finish once without an approval or cash transfer", () => {
  const db = fresh();
  const goal = game.createParentGoal(db, { title: "Try a lesson", type: "lessons", count: 1, reward: 0 });
  const accounts = structuredClone(db.accounts);
  const transactions = db.transactions.length;
  game.completeLesson(db, "needs_wants", [0, 1, 0, 1]);
  assert.equal(goal.status, "done");
  assert.ok(goal.completedAt);
  assert.ok(db.notifications.some((n) => n.to === "child" && n.text === "You finished Try a lesson!"));
  assert.ok(db.notifications.some((n) => n.to === "parent" && n.text === "Mia finished Try a lesson (no cash reward)"));
  game.completeLesson(db, "saving_math", [1, 0, 1]);
  runGuardian(db, Date.now());
  assert.equal(db.approvals.filter((a) => a.kind === "reward").length, 0);
  assert.equal(db.transactions.length, transactions);
  assert.deepEqual(db.accounts, accounts);
  assert.equal(db.notifications.filter((n) => n.text === "You finished Try a lesson!").length, 1);
});

test("M10 unreversible duplicate is escalated once and stops due work", () => {
  const db = fresh();
  const now = Date.now();
  approvedReward(db);
  runGuardian(db, now);
  const duplicate = injectDuplicatePosting(db, now);
  db.accounts.savings.balance = 0;
  runGuardian(db, now + 2000);
  const review = db.approvals.filter((a) => a.kind === "review");
  assert.equal(review.length, 1);
  assert.equal(review[0].txnId, duplicate.id);
  assert.equal(duplicate.flagged, true);
  assert.deepEqual(pendingFindings(db), []);
  assert.equal(hasDueWork(db, now + 2000), false);
  for (let i = 1; i <= 3; i++) runGuardian(db, now + 2000 + i * 2000);
  assert.equal(db.approvals.filter((a) => a.kind === "review").length, 1);
});

test("M18 approving an unauthorised posting acknowledges it without recurring reviews", () => {
  const db = fresh();
  const now = Date.now();
  const { txn } = transfer(db, { from: "parent", to: "spending", amount: 100, kind: "extra", memo: "Unknown" });
  txn.ref = "unknown-approval";
  assert.equal(hasDueWork(db, now), true);
  runGuardian(db, now);
  const review = db.approvals.find((a) => a.kind === "review");
  assert.equal(review.txnId, txn.id);
  game.decide(db, review.id, true);
  assert.equal(txn.acknowledged, true);
  assert.equal(hasDueWork(db, now), false);
  for (let i = 1; i <= 3; i++) runGuardian(db, now + i * 2000);
  assert.equal(db.approvals.filter((a) => a.kind === "review").length, 1);
  assert.equal(hasDueWork(db, now + 6000), false);
});

test("M18 declining review retains its flag and stops recurring work", () => {
  const db = fresh();
  const now = Date.now();
  const { txn } = transfer(db, { from: "parent", to: "spending", amount: 100, kind: "extra", memo: "Unknown" });
  runGuardian(db, now);
  const review = db.approvals.find((a) => a.kind === "review");
  game.decide(db, review.id, false);
  assert.equal(review.status, "declined");
  assert.equal(txn.flagged, true);
  assert.equal(txn.acknowledged, undefined);
  assert.equal(hasDueWork(db, now), false);
  runGuardian(db, now + 2000);
  assert.equal(db.approvals.filter((a) => a.kind === "review").length, 1);
});

test("M9 amount mismatch is reviewed once and cannot mark a reward paid", () => {
  for (const amount of [100, 700]) {
    const db = fresh();
    const now = Date.now();
    const a = approvedReward(db);
    const { txn } = transfer(db, { from: "parent", to: "savings", amount, kind: "reward", memo: "Wrong amount", idempotencyKey: `approval:${a.id}` });
    txn.ref = a.id;
    runGuardian(db, now);
    assert.equal(a.paidTxnId, undefined);
    assert.equal(db.parentGoals[0].status, "approved");
    assert.equal(txn.flagged, true);
    assert.equal(txn.status, "posted");
    assert.equal(db.audit.filter((x) => x.action === "amount_mismatch").length, 1);
    const review = db.approvals.find((x) => x.kind === "review");
    assert.equal(review.txnId, txn.id);
    game.decide(db, review.id, true);
    for (let i = 1; i <= 3; i++) runGuardian(db, now + i * 2000);
    assert.equal(db.approvals.filter((x) => x.kind === "review").length, 1);
    assert.equal(hasDueWork(db, now + 6000), false);
  }
});

test("M9 approval idempotency postings without ref still have their amounts checked", () => {
  const db = fresh();
  const a = approvedReward(db);
  const { txn } = transfer(db, { from: "parent", to: "savings", amount: 100, kind: "reward", memo: "Wrong amount", idempotencyKey: `approval:${a.id}` });
  runGuardian(db, Date.now());
  assert.equal(a.paidTxnId, undefined);
  assert.equal(txn.flagged, true);
  assert.equal(db.audit.filter((x) => x.action === "amount_mismatch").length, 1);
});

test("M9 unexplained parent postings are reviewed while child moves are left alone", () => {
  const db = fresh();
  const now = Date.now();
  const { txn } = transfer(db, { from: "parent", to: "spending", amount: 100, kind: "extra", memo: "Unknown" });
  game.childSave(db, 100, now);
  game.childSpend(db, { amount: 100, memo: "Snack" }, spendPolicy, now);
  game.journal(db, { direction: "received", amount: 100, note: "Gift" }, now);
  // Even legacy child-originated postings carrying a ref need no approval.
  const { txn: journal } = transfer(db, { from: "spending", to: "savings", amount: 100, kind: "journal", memo: "Saved gift" });
  journal.ref = "child-journal";
  runGuardian(db, now);
  runGuardian(db, now + 2000);
  assert.equal(txn.flagged, true);
  assert.equal(db.approvals.filter((a) => a.kind === "review").length, 1);
  assert.ok(db.transactions.filter((t) => ["save", "spend", "journal"].includes(t.kind)).every((t) => !t.flagged));
  assert.equal(hasDueWork(db, now + 2000), false);
});

test("M11 approved unpaid rewards and extras count toward funding warnings", () => {
  const db = fresh();
  const now = Date.now();
  const reward = approvedReward(db, 2000);
  const extra = game.requestExtraAllowance(db, { amount: 2000, reason: "Books" });
  game.decide(db, extra.id, true);
  db.accounts.parent.balance = 1500;
  runGuardian(db, now);
  assert.equal(reward.paidTxnId, undefined);
  assert.equal(extra.paidTxnId, undefined);
  assert.ok(db.notifications.some((n) => n.text.includes("upcoming commitments ($50.00)")));
  assert.equal(db.allowance.lowFundsWarnedAt, now);
  assert.equal(db.allowance.lowFundsWarnedFor, 3500);
  runGuardian(db, now + DAY);
  assert.equal(db.audit.filter((a) => a.action === "low_funds_warning").length, 1);
});

test("M11 funding warnings reset after topup and warn for another same-day shortfall", () => {
  const db = fresh();
  const now = Date.now();
  const pending = game.requestExtraAllowance(db, { amount: 1000, reason: "Books" });
  db.accounts.parent.balance = 1500;
  runGuardian(db, now);
  runGuardian(db, now + 2000);
  assert.equal(db.audit.filter((a) => a.action === "low_funds_warning").length, 1);
  routeMutation("/api/parent/topup", { amount: 5 })(db);
  runGuardian(db, now + 4000);
  assert.equal(db.allowance.lowFundsWarnedAt, undefined);
  assert.equal(db.allowance.lowFundsWarnedFor, undefined);
  game.decide(db, pending.id, true);
  game.requestExtraAllowance(db, { amount: 500, reason: "Pencils" });
  runGuardian(db, now + 6000);
  assert.equal(db.audit.filter((a) => a.action === "low_funds_warning").length, 2);
  assert.equal(db.allowance.lowFundsWarnedAt, now + 6000);
  assert.equal(db.allowance.lowFundsWarnedFor, 500);
});

test("M11 a changing shortfall stays one episode until funding recovers", () => {
  const db = fresh();
  const now = Date.now();
  db.accounts.parent.balance = 500;
  runGuardian(db, now);
  game.requestExtraAllowance(db, { amount: 500, reason: "Books" });
  runGuardian(db, now + 2000);
  db.accounts.parent.balance = 400;
  runGuardian(db, now + DAY);
  assert.equal(db.audit.filter((a) => a.action === "low_funds_warning").length, 1);
});

test("M23 act reverses duplicates before a child save can unlock phantom milestones", () => {
  const db = fresh();
  const now = Date.now();
  approvedReward(db, 300);
  runGuardian(db, now);
  assert.equal(db.accounts.savings.balance, 2300);
  const duplicate = injectDuplicatePosting(db, now);
  assert.equal(db.accounts.savings.balance, 2600);
  const points = db.child.points;
  const replans = [];
  actionRunner(db, replans)((d) => game.childSave(d, 100, now), "child_save");
  assert.equal(duplicate.status, "reversed");
  assert.equal(db.accounts.savings.balance, 2400);
  assert.ok(!db.child.milestonesUnlocked.includes(2500));
  assert.equal(game.cosmeticUnlocked(db, COSMETICS.find((c) => c.id === "neck:red_bow_tie")), false);
  assert.ok(db.child.points - points < 100, "no milestone points awarded");
  assert.ok(replans.some((reason) => /reversed/i.test(reason)));
});

test("M24 throwing mutations restore the database without version or subscriber changes", () => {
  const db = fresh();
  _setForTest(db);
  const before = structuredClone(db);
  let notifications = 0;
  const unsubscribe = subscribe(() => { notifications += 1; });
  const failure = new Error("stop halfway");
  try {
    assert.throws(() => mutate((d) => {
      d.accounts.parent.balance = 0;
      d.approvals.push({ id: "partial" });
      d.version += 100;
      d.temporary = true;
      delete d.child;
      throw failure;
    }), (e) => e === failure);
    assert.deepEqual(read(), before);
    assert.deepEqual(db, before, "held root reference is also restored");
    assert.equal(read().version, before.version);
    assert.equal(notifications, 0);
  } finally {
    unsubscribe();
    _setForTest(null);
  }
});
