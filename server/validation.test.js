import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seed } from "./store.js";
import { LESSONS } from "./catalog.js";
import { pickLessonIndexes } from "../shared/lessonPick.js";
import * as game from "./domain.js";
import { spendPolicy } from "./guardian.js";
import { chat } from "./buddy.js";
import { actions } from "./actions.js";
import { money, integer, str, bool, id } from "./validate.js";

const fresh = () => seed(Date.now());
const is400 = (error) => error instanceof game.GameError && error.status === 400;
function rejectsUnchanged(db, fn, check = is400) {
  const before = structuredClone(db);
  assert.throws(fn, check);
  assert.deepEqual(db, before, "validation must finish before changing state");
}

test("topup oops returns 400 and leaves the balance unchanged", () => {
  const db = fresh();
  rejectsUnchanged(db, () => actions.topup(db, { amount: "oops" }));
});

test("topup -300 returns 400 without moving money", () => {
  const db = fresh();
  rejectsUnchanged(db, () => actions.topup(db, { amount: -300 }));
});

test("topup 0 returns 400 instead of depositing $50", () => {
  const db = fresh();
  rejectsUnchanged(db, () => actions.topup(db, { amount: 0 }));
});

test("topup requires a finite amount within its deposit limit", () => {
  const db = fresh();
  for (const amount of [undefined, null, "", " ", NaN, Infinity, -Infinity, "1e309", 1000.01, [], {}, true]) {
    rejectsUnchanged(db, () => actions.topup(db, { amount }));
  }
  rejectsUnchanged(db, () => actions.topup(db, {}));
});

test("topup converts dollars to cents and clears only parent-funded escalations", () => {
  const db = fresh();
  db.approvals.push({ id: "a", kind: "topup", status: "pending" });
  db.approvals.push({ id: "r", kind: "reward", status: "approved", amount: 500, escalatedAt: 1 });
  db.approvals.push({ id: "s", kind: "spend", status: "approved", amount: 500, memo: "Game", escalatedAt: 1 });
  const before = db.accounts.parent.balance;
  actions.topup(db, { amount: " 50 " });
  assert.equal(db.accounts.parent.balance, before + 5000);
  const byId = (id) => db.approvals.find((a) => a.id === id);
  assert.equal(byId("a").status, "approved");
  assert.equal(Object.hasOwn(byId("r"), "escalatedAt"), false, "parent-funded reward escalation is cleared");
  assert.equal(byId("s").escalatedAt, 1, "child-funded spend escalation is left for the guardian to retry");
  actions.topup(db, { amount: 0.01 });
  actions.topup(db, { amount: 1000 });
  assert.equal(db.accounts.parent.balance, before + 105001);
});

test("allowance savePct oops returns 400 and leaves all settings unchanged", () => {
  const db = fresh();
  rejectsUnchanged(db, () => actions.allowance(db, { amount: 25, savePct: "oops" }));
});

test("allowance spendLimit x returns 400 before applying earlier fields", () => {
  const db = fresh();
  rejectsUnchanged(db, () => actions.allowance(db, { amount: 25, savePct: 20, spendLimit: "x" }));
});

test("allowance rejects invalid ranges, fractional percentages and destinations", () => {
  const db = fresh();
  for (const body of [
    { amount: -1 }, { amount: 100.01 }, { amount: null }, { savePct: -1 }, { savePct: 101 },
    { savePct: 12.5 }, { savePct: Infinity }, { savePct: true }, { spendLimit: -1 },
    { spendLimit: 10000.01 }, { rewardDestination: "merchant" }, { rewardDestination: null },
  ]) rejectsUnchanged(db, () => actions.allowance(db, body));
});

test("allowance accepts boundaries and valid partial updates", () => {
  const db = fresh();
  actions.allowance(db, { amount: 0, savePct: 0, spendLimit: 0, rewardDestination: "spending" });
  assert.equal(db.allowance.amount, 0);
  assert.equal(db.allowance.savePct, 0);
  assert.equal(db.allowance.spendLimit, 0);
  actions.allowance(db, { amount: "100", savePct: "100", spendLimit: "10000", rewardDestination: "savings" });
  assert.equal(db.allowance.amount, 10000);
  assert.equal(db.allowance.savePct, 100);
  assert.equal(db.allowance.spendLimit, 1000000);
  actions.allowance(db, { savePct: 50 });
  assert.equal(db.allowance.amount, 10000);
  assert.equal(db.allowance.rewardDestination, "savings");
});

test("deprecated savings-goal action returns 410 without changing state", () => {
  const db = fresh();
  const before = structuredClone(db);
  assert.throws(() => actions.savingsGoal(db, { title: "Bicycle", target: 100 }), { status: 410 });
  assert.deepEqual(db, before);
});

test("journal -100 returns 400 without awarding points or recording an entry", () => {
  const db = fresh();
  rejectsUnchanged(db, () => actions.journal(db, { direction: "saved", amount: -100, note: "Saved" }));
  rejectsUnchanged(db, () => game.journal(db, { direction: "saved", amount: -100, note: "Saved" }));
});

test("journal validates direction, amount and note and accepts zero", () => {
  const db = fresh();
  const valid = { direction: "received", amount: 0, note: " No money today " };
  for (const body of [
    { ...valid, direction: "other" }, { ...valid, direction: [] }, { ...valid, amount: "oops" },
    { ...valid, amount: -0.001 }, { ...valid, amount: 10000.01 }, { ...valid, note: 123 },
    { ...valid, note: "" }, { ...valid, note: "a".repeat(121) },
  ]) rejectsUnchanged(db, () => actions.journal(db, body));
  actions.journal(db, valid);
  actions.journal(db, { ...valid, amount: "10000" });
  assert.deepEqual(db.tracking.map((entry) => entry.amount), [0, 1000000]);
  assert.equal(db.tracking[0].note, "No money today");
});

test("spend memo 123 returns GameError 400 rather than TypeError 500", () => {
  const db = fresh();
  rejectsUnchanged(db, () => actions.spend(db, { amount: 1, memo: 123 }));
  rejectsUnchanged(db, () => game.childSpend(db, { amount: 100, memo: 123 }, spendPolicy));
});

test("child money actions reject invalid money and text before reaching the ledger", () => {
  const db = fresh();
  for (const amount of [NaN, Infinity, "1e309", {}, [], null, true, "", -1, 10000.01]) {
    rejectsUnchanged(db, () => actions.save(db, { amount }));
    rejectsUnchanged(db, () => actions.spend(db, { amount, memo: "Book" }));
    rejectsUnchanged(db, () => actions.extra(db, { amount, reason: "Book" }));
  }
  for (const text of [123, {}, [], null, "", "a".repeat(121)]) {
    rejectsUnchanged(db, () => actions.spend(db, { amount: 1, memo: text }));
    rejectsUnchanged(db, () => actions.extra(db, { amount: 1, reason: text }));
  }
  rejectsUnchanged(db, () => actions.save(db, { amount: 0.99 }));
  rejectsUnchanged(db, () => actions.spend(db, { amount: 0 }));
  rejectsUnchanged(db, () => actions.extra(db, { amount: 50.01, reason: "Book" }));
});

test("valid child money actions preserve cent amounts and trimmed copy", () => {
  const db = fresh();
  actions.save(db, { amount: "1" });
  assert.equal(db.accounts.savings.balance, 2100);
  actions.spend(db, { amount: "1.25", memo: " Book " });
  assert.equal(db.accounts.spending.balance, 775);
  assert.equal(db.transactions.at(-1).memo, "Book");
  const extra = actions.extra(db, { amount: "50", reason: " A book " });
  assert.equal(extra.amount, 5000);
  assert.equal(extra.reason, "A book");
});

test("goal title object returns GameError 400 without creating a goal", () => {
  const db = fresh();
  const body = { title: {}, type: "lessons", count: 1, reward: 5 };
  rejectsUnchanged(db, () => actions.goal(db, body));
  rejectsUnchanged(db, () => game.createParentGoal(db, body));
});

test("goal validates type, whole count, title length and finite reward", () => {
  const db = fresh();
  const valid = { title: " Learn ", type: "lessons", count: "1", reward: "5" };
  for (const body of [
    { ...valid, title: "a".repeat(121) }, { ...valid, title: "" }, { ...valid, type: "constructor" },
    { ...valid, count: 1.5 }, { ...valid, count: 0 }, { ...valid, count: 51 },
    { ...valid, reward: Infinity }, { ...valid, reward: -1 }, { ...valid, reward: 100.01 },
  ]) rejectsUnchanged(db, () => actions.goal(db, body));
  const goal = actions.goal(db, valid);
  assert.equal(goal.title, "Learn");
  assert.equal(goal.count, 1);
  assert.equal(goal.reward, 500, "reward dollars are converted exactly once");
  assert.equal(actions.goal(db, { ...valid, reward: 0 }).reward, 0);
  assert.equal(actions.goal(db, { ...valid, reward: 100 }).reward, 10000);
});

test("mission rejects malformed titles and non-integer or out-of-range points", () => {
  const db = fresh();
  for (const body of [
    { title: {} }, { title: "" }, { title: "a".repeat(121) }, { title: "Read", points: "oops" },
    { title: "Read", points: 1.5 }, { title: "Read", points: 0 }, { title: "Read", points: 101 },
    { title: "Read", points: Infinity }, { title: "Read", points: null },
  ]) {
    rejectsUnchanged(db, () => actions.mission(db, body));
    rejectsUnchanged(db, () => game.createParentMission(db, body));
  }
  assert.equal(actions.mission(db, { title: " Read " }).points, 40);
  assert.equal(actions.mission(db, { title: "Read", points: "5" }).points, 5);
  assert.equal(actions.mission(db, { title: "Read", points: 100 }).points, 100);
});

test("approve string false returns 400 without approving a payment", () => {
  const db = fresh();
  const request = actions.extra(db, { amount: 1, reason: "Book" });
  rejectsUnchanged(db, () => actions.approval(db, { approve: "false" }, request.id));
});

test("approval validates optional note and handles actual false and true", () => {
  const db = fresh();
  const request = actions.extra(db, { amount: 1, reason: "Book" });
  for (const note of [123, {}, null, "a".repeat(121)]) {
    rejectsUnchanged(db, () => actions.approval(db, { approve: true, note }, request.id));
  }
  actions.approval(db, { approve: false, note: " Maybe later " }, request.id);
  assert.equal(request.status, "declined");
  assert.equal(request.note, "Maybe later");
  const another = actions.extra(db, { amount: 1, reason: "Book" });
  actions.approval(db, { approve: true }, another.id);
  assert.equal(another.status, "approved");
  assert.equal(another.note, "");
});

test("settings buddyEnabled string false returns 400 without changing settings", () => {
  const db = fresh();
  rejectsUnchanged(db, () => actions.settings(db, { requireTradeApproval: false, buddyEnabled: "false" }));
});

test("settings accepts only boolean known keys and ignores unknown keys", () => {
  const db = fresh();
  for (const key of ["requireTradeApproval", "buddyEnabled", "coopChallenge"]) {
    for (const value of ["false", 0, null, [], {}]) rejectsUnchanged(db, () => actions.settings(db, { [key]: value }));
  }
  actions.settings(db, { requireTradeApproval: false, buddyEnabled: false, coopChallenge: false, unknown: {} });
  assert.deepEqual(db.settings, { requireTradeApproval: false, buddyEnabled: false, coopChallenge: false });
  actions.settings(db, { buddyEnabled: true });
  assert.equal(db.settings.buddyEnabled, true);
});

test("adventure prototype destinations return 400 and leave points unchanged", () => {
  const db = fresh();
  for (const destId of ["__proto__", "constructor", "toString"]) {
    rejectsUnchanged(db, () => actions.adventure(db, { destId }), (error) => is400(error) && error.message === "Unknown destination");
    rejectsUnchanged(db, () => game.startAdventure(db, destId), (error) => is400(error) && error.message === "Unknown destination");
  }
});

test("adventure and cosmetics reject corrupt points instead of granting free items", () => {
  for (const points of [NaN, Infinity, -Infinity, 100.5, "100"]) {
    const db = fresh();
    db.child.points = points;
    rejectsUnchanged(db, () => actions.adventure(db, { destId: "san_francisco" }));
    rejectsUnchanged(db, () => actions.buyCosmetic(db, { id: "hat:beanie" }));
  }
});

test("point awards reject non-finite and fractional totals", () => {
  for (const points of [NaN, Infinity, 1.5]) {
    const db = fresh();
    db.child.points = points;
    assert.throws(() => game.checkMilestones({ ...db, accounts: { ...db.accounts, savings: { balance: 3000 } } }), is400);
    assert.equal(db.child.points, points);
  }
});

test("catalog identifiers, kinds, codes and greeting indexes are validated", () => {
  const db = fresh();
  for (const value of [null, [], {}, 123, "", "x/y", "a".repeat(65)]) {
    rejectsUnchanged(db, () => actions.adventure(db, { destId: value }));
    rejectsUnchanged(db, () => actions.buyCosmetic(db, { id: value }));
    rejectsUnchanged(db, () => actions.equip(db, { kind: value, value: null }));
    rejectsUnchanged(db, () => actions.friend(db, { code: value }));
    rejectsUnchanged(db, () => actions.missionDone(db, value));
    rejectsUnchanged(db, () => actions.trade(db, { friendId: value, give: "chicago", get: "seattle" }));
    rejectsUnchanged(db, () => actions.greet(db, { friendId: value, index: 0 }));
  }
  for (const value of [[], {}, 123, "constructor", "toString", "__proto__"]) {
    rejectsUnchanged(db, () => actions.buyCosmetic(db, { id: value }));
    rejectsUnchanged(db, () => actions.equip(db, { kind: "hat", value }));
    rejectsUnchanged(db, () => actions.trade(db, { friendId: "fr_maya", give: value, get: "seattle" }));
    rejectsUnchanged(db, () => actions.trade(db, { friendId: "fr_maya", give: "chicago", get: value }));
  }
  for (const index of [-1, game.GREETINGS.length, 1.5, NaN, {}, [], "oops"]) {
    rejectsUnchanged(db, () => actions.greet(db, { friendId: "fr_maya", index }));
  }
  actions.greet(db, { friendId: "fr_maya", index: 0 });
  actions.greet(db, { friendId: "fr_maya", index: game.GREETINGS.length - 1 });
  assert.equal(db.friends[0].greetings.length, 2);
});

test("valid adventures, cosmetics, friends, trades and mission IDs still work", () => {
  const db = fresh();
  db.child.points = 200;
  actions.adventure(db, { destId: "san_francisco" });
  assert.equal(db.child.points, 120);
  actions.buyCosmetic(db, { id: "hat:beanie" });
  assert.equal(db.child.points, 90);
  actions.equip(db, { kind: "hat", value: null });
  assert.equal(db.child.bear.hat, null);
  actions.equip(db, { kind: "hat", value: "beanie" });
  assert.equal(db.child.bear.hat, "beanie");
  assert.equal(actions.friend(db, { code: " sam-12 " }).name, "Sam");
  assert.equal(actions.trade(db, { friendId: "fr_maya", give: "chicago", get: "seattle" }).status, "pending");
  const mission = actions.mission(db, { title: "Read" });
  actions.missionDone(db, mission.id);
  assert.equal(mission.status, "pending_review");
});

test("bear name requires a string of at most 24 characters", () => {
  const db = fresh();
  for (const name of [123, {}, [], null, "", "a".repeat(25)]) rejectsUnchanged(db, () => actions.renameBear(db, { name }));
  actions.renameBear(db, { name: " Clover " });
  assert.equal(db.child.bear.name, "Clover");
});

test("lesson validates IDs and an array of integer answers before scoring", () => {
  const db = fresh();
  for (const lessonId of [[], {}, "x/y", "constructor", "__proto__", "toString"]) {
    rejectsUnchanged(db, () => actions.lesson(db, { lessonId, answers: [0, 1, 0, 1] }));
  }
  for (const answers of [undefined, {}, "0101", [0, "1", 0, 1], [0, 1.5, 0, 1], [0, NaN, 0, 1]]) {
    rejectsUnchanged(db, () => actions.lesson(db, { lessonId: "needs_wants", answers }));
  }
  assert.equal(actions.lesson(db, { lessonId: "needs_wants", answers: pickLessonIndexes(undefined, "needs_wants", 0).map((i) => LESSONS[0].questions[i].answer) }).passed, true);
});

test("budget validates every allocation before awarding points", () => {
  const db = fresh();
  for (const allocations of [null, [], "budget", {}, { save: 5, needs: 8, fun: 5 },
    { save: 5, needs: 8, fun: 5, give: "oops" }, { save: 5, needs: 8, fun: 7, give: -1 },
    { save: 5, needs: 8, fun: 5, give: 2, extra: Infinity }]) {
    rejectsUnchanged(db, () => actions.budget(db, { allocations }));
  }
  assert.equal(actions.budget(db, { allocations: { save: "5", needs: "8", fun: "5", give: "2" } }).pointsAwarded, 50);
});

test("empty chat returns GameError 400 with Say something first", async () => {
  const db = fresh();
  for (const text of ["", "   "]) {
    rejectsUnchanged(db, () => actions.chat(db, { text }), (error) => is400(error) && error.message === "Say something first!");
    await assert.rejects(chat(text), (error) => is400(error) && error.message === "Say something first!");
  }
});

test("chat rejects non-strings and long messages before calling Buddy", () => {
  const db = fresh();
  for (const text of [123, {}, [], null, "a".repeat(501)]) {
    rejectsUnchanged(db, () => actions.chat(db, { text }, () => assert.fail("invalid message reached Buddy")));
  }
  assert.equal(actions.chat(db, { text: " Hello " }, (text) => text), "Hello");
  assert.equal(actions.chat(db, { text: "a".repeat(500) }, (text) => text).length, 500);
  db.settings.buddyEnabled = false;
  rejectsUnchanged(db, () => actions.chat(db, { text: "Hello" }, () => assert.fail("disabled Buddy was called")));
});


test("legacy default-PIN login action is removed", () => {
  assert.equal(actions.login, undefined);
  assert.equal(seed(Date.now()).family.parentPin, undefined);
});

test("malformed request bodies produce GameError rather than TypeError", () => {
  const db = fresh();
  const names = Object.keys(actions).filter((name) => name !== "missionDone");
  for (const name of names) {
    for (const body of [undefined, null, [], "text", 123, true]) {
      rejectsUnchanged(db, () => actions[name](db, body));
    }
  }
});

test("validators enforce finite money, strict strings, booleans and identifiers", () => {
  for (const value of [undefined, null, false, [], {}, "", " ", "NaN", "Infinity", "1e309", NaN, Infinity, -Infinity, -0.001, 10000.01]) {
    assert.throws(() => money(value), is400);
  }
  assert.equal(money("1.25"), 125);
  assert.equal(money("1e2"), 10000);
  assert.equal(money(0), 0);
  assert.equal(money(10000), 1000000);
  assert.equal(integer("100", { max: 100 }), 100);
  assert.equal(str(" abc "), "abc");
  assert.equal(str(" ", { required: false }), "");
  assert.equal(str("a".repeat(120)).length, 120);
  assert.equal(id("a".repeat(64)).length, 64);
  assert.equal(bool(false), false);
  assert.equal(bool(true), true);
  for (const value of ["false", 0, 1, null, [], {}]) assert.throws(() => bool(value), is400);
});

test("test script runs only test files and declares the env-file Node minimum", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.test, "node --test server/*.test.js");
  assert.equal(pkg.engines.node, ">=22.9");
});
