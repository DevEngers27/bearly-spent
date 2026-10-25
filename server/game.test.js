// Core rule tests: run with `npm test`. Uses the in-memory seed, never touches disk.
import { childIdFor as lessonChildId } from "./store.js";
import { LESSONS as lessonCatalog } from "./catalog.js";
import { pickLessonIndexes } from "../shared/lessonPick.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "./store.js";
import * as game from "./domain.js";
import { runGuardian, spendPolicy, injectDuplicatePosting } from "./guardian.js";
import { redact } from "./buddy.js";

const lessonAnswers = (db, lesson) => pickLessonIndexes(lessonChildId(db), lesson.id, db.child.lessonAttempts?.[lesson.id] || 0).map((i) => lesson.questions[i].answer);
const fresh = () => seed(Date.now());
const passAllLessons = (db) => {
  game.completeLesson(db, "needs_wants", lessonAnswers(db, lessonCatalog.find((l) => l.id === "needs_wants")));
  game.completeLesson(db, "saving_math", lessonAnswers(db, lessonCatalog.find((l) => l.id === "saving_math")));
  game.completeLesson(db, "compare_prices", lessonAnswers(db, lessonCatalog.find((l) => l.id === "compare_prices")));
  game.completeLesson(db, "earning", lessonAnswers(db, lessonCatalog.find((l) => l.id === "earning")));
  game.completeLesson(db, "budgeting", lessonAnswers(db, lessonCatalog.find((l) => l.id === "budgeting")));
};

test("parent goal → approval → guardian pays exactly once", () => {
  const db = fresh();
  game.createParentGoal(db, { title: "Five lessons", type: "lessons", count: 5, reward: 5 });
  passAllLessons(db);
  const a = db.approvals.find((x) => x.kind === "reward");
  assert.equal(a.status, "pending");
  const before = db.accounts.savings.balance;
  runGuardian(db);
  assert.equal(db.accounts.savings.balance, before, "nothing paid before approval");
  game.decide(db, a.id, true);
  runGuardian(db);
  runGuardian(db);
  assert.equal(db.accounts.savings.balance, before + 500);
  assert.equal(db.parentGoals[0].status, "paid");
});

test("declined reward moves no money", () => {
  const db = fresh();
  game.createParentGoal(db, { title: "Five lessons", type: "lessons", count: 5, reward: 5 });
  passAllLessons(db);
  const a = db.approvals.find((x) => x.kind === "reward");
  const total = db.accounts.parent.balance + db.accounts.savings.balance;
  game.decide(db, a.id, false);
  runGuardian(db);
  assert.equal(db.accounts.parent.balance + db.accounts.savings.balance, total);
});

test("guardian reverses a duplicate bank posting", () => {
  const db = fresh();
  game.createParentGoal(db, { title: "x", type: "lessons", count: 1, reward: 5 });
  game.completeLesson(db, "needs_wants", lessonAnswers(db, lessonCatalog.find((l) => l.id === "needs_wants")));
  game.decide(db, db.approvals.at(-1).id, true);
  runGuardian(db);
  const savings = db.accounts.savings.balance;
  injectDuplicatePosting(db);
  assert.equal(db.accounts.savings.balance, savings + 500);
  const actions = runGuardian(db);
  assert.ok(actions.some((x) => x.includes("reversed")));
  assert.equal(db.accounts.savings.balance, savings);
});

test("purchases over the limit are held for a parent", () => {
  const db = fresh();
  db.accounts.spending.balance = 5000;
  const r = game.childSpend(db, { amount: 2500, memo: "Lego" }, spendPolicy);
  assert.equal(r.held, true);
  assert.equal(db.accounts.spending.balance, 5000);
  const a = db.approvals.find((x) => x.kind === "spend");
  game.decide(db, a.id, true);
  runGuardian(db);
  assert.equal(db.accounts.spending.balance, 2500);
});

test("allowance never overdraws; escalates instead", () => {
  const db = fresh();
  db.accounts.parent.balance = 100;
  db.allowance.nextRun = Date.now() - 1;
  runGuardian(db);
  assert.equal(db.accounts.parent.balance, 100);
  assert.ok(db.approvals.some((a) => a.kind === "topup"));
  db.accounts.parent.balance = 5000;
  runGuardian(db);
  assert.equal(db.accounts.parent.balance, 4000);
  assert.ok(db.allowance.nextRun > Date.now());
});

test("San Francisco after 3 saves discovers secret Hawaiʻi; points not money", () => {
  const db = fresh();
  for (let i = 0; i < 3; i++) game.childSave(db, 100);
  db.child.points = 200;
  const savings = db.accounts.savings.balance;
  const adv = game.startAdventure(db, "san_francisco");
  game.finalizeAdventures(db, adv.returnsAt);
  const defs = db.postcards.map((p) => p.defId);
  assert.ok(defs.includes("san_francisco") && defs.includes("hawaii_volcanoes_national_park"));
  assert.equal(db.accounts.savings.balance, savings);
});

test("milestones are permanent after spending", () => {
  const db = fresh();
  db.accounts.savings.balance = 2600;
  game.checkMilestones(db);
  assert.ok(db.child.milestonesUnlocked.includes(2500));
  db.accounts.savings.balance = 100;
  game.checkMilestones(db);
  assert.ok(db.child.milestonesUnlocked.includes(2500));
});

test("friends never see money", () => {
  const db = fresh();
  const v = JSON.stringify(game.friendView(db.friends[0]));
  assert.ok(!/balance|allowance|transaction/i.test(v));
});

test("secret postcards can't be traded", () => {
  const db = fresh();
  db.postcards.push({ id: "p1", defId: "hawaii_volcanoes_national_park" });
  assert.throws(() => game.proposeTrade(db, "fr_maya", "hawaii_volcanoes_national_park", "seattle"), /Secret/);
});

test("personal info is redacted before reaching the AI", () => {
  const r = redact("call me at 415-555-1234 or mia@example.com, my password is hunter2");
  assert.ok(!r.text.includes("555-1234") && !r.text.includes("example.com") && !r.text.includes("hunter2"));
  assert.deepEqual(r.found.sort(), ["email", "password", "phone number"]);
});

test("rare places stay locked until the habit is done; secrets can't be visited early", () => {
  const db = fresh();
  db.child.points = 1000;
  assert.throws(() => game.startAdventure(db, "yellowstone_national_park"), /budget/);
  assert.throws(() => game.startAdventure(db, "hawaii_volcanoes_national_park"), /secret/);
  game.completeBudget(db, { save: 500, needs: 800, fun: 500, give: 200 });
  assert.doesNotThrow(() => game.startAdventure(db, "yellowstone_national_park"));
});
