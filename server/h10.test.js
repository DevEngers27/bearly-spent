import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { seed, childIdFor, createChild, mutateChild, readChild, _clearStoreForTest } from "./store.js";
import { database, _databaseForTest, closeDatabase } from "./db.js";
import { LESSONS, POINTS } from "./catalog.js";
import { actions } from "./actions.js";
import { childView, parentView } from "./index.js";
import { snapshot, cancelReplan } from "./buddy.js";
import * as game from "./domain.js";
import { LESSON_QUESTION_COUNT, pickLessonIndexes } from "../shared/lessonPick.js";

beforeEach(() => { cancelReplan(); _clearStoreForTest(); _databaseForTest(); });
after(() => { cancelReplan(); _clearStoreForTest(); closeDatabase(); });
const selected = (db, lesson) => pickLessonIndexes(childIdFor(db), lesson.id, db.child.lessonAttempts?.[lesson.id] || 0).map((i) => lesson.questions[i]);
const answersFor = (db, lesson, correct = 4) => selected(db, lesson).map((q, i) => i < correct ? q.answer : (q.answer + 1) % q.options.length);
const originals = ["needs_wants", "saving_math", "compare_prices", "earning", "budgeting", "sales", "wait", "unit_price", "giving", "ads", "big_goal", "tax_tips", "borrowing", "money_safe", "fair_swaps"];

test("H10.1 thirty lessons retain the original ids and have six unique, valid questions and real icons", async () => {
  assert.equal(LESSONS.length, 30);
  assert.equal(new Set(LESSONS.map((l) => l.id)).size, 30);
  assert.equal(new Set(LESSONS.map((l) => l.title)).size, 30);
  assert.deepEqual(LESSONS.slice(0, 15).map((l) => l.id), originals);
  const source = await readFile(new URL("../client/src/Icons.jsx", import.meta.url), "utf8");
  const icons = new Set([...source.matchAll(/^  (\w+):/gm)].map((m) => m[1]).concat(["honey", "basket"]));
  for (const lesson of LESSONS) {
    assert.ok(icons.has(lesson.icon), lesson.id);
    assert.ok(lesson.title.trim());
    assert.equal(lesson.questions.length, 6, lesson.id);
    assert.equal(new Set(lesson.questions.map((q) => q.q)).size, 6, lesson.id);
    for (const { q, options, answer } of lesson.questions) {
      assert.ok(q.trim());
      assert.ok(options.length >= 2);
      assert.ok(options.every((o) => typeof o === "string" && o.trim()));
      assert.equal(new Set(options).size, options.length);
      assert.ok(Number.isInteger(answer) && answer >= 0 && answer < options.length);
    }
  }
});

test("H10.2 seeded picks are stable, child/lesson specific, and rotate all fifteen four-question subsets", () => {
  assert.equal(LESSON_QUESTION_COUNT, 4);
  assert.deepEqual(pickLessonIndexes("child-a", "needs_wants", 0), [2, 0, 1, 4]);
  assert.notDeepEqual(pickLessonIndexes("child-a", "needs_wants", 0), pickLessonIndexes("child-b", "needs_wants", 0));
  assert.notDeepEqual(pickLessonIndexes("child-a", "needs_wants", 0), pickLessonIndexes("child-a", "saving_math", 0));
  for (const lesson of LESSONS) {
    for (const childId of ["child-a", "child-b", "child-c"]) {
      const subsets = new Set();
      let previous;
      for (let attempt = 0; attempt < 45; attempt++) {
        const indexes = pickLessonIndexes(childId, lesson.id, attempt);
        assert.deepEqual(indexes, pickLessonIndexes(childId, lesson.id, attempt));
        assert.equal(indexes.length, 4);
        assert.equal(new Set(indexes).size, 4);
        assert.ok(indexes.every((i) => Number.isInteger(i) && i >= 0 && i < 6));
        const key = [...indexes].sort().join(",");
        assert.notEqual(key, previous);
        if (attempt < 15) subsets.add(key);
        previous = key;
      }
      assert.equal(subsets.size, 15);
    }
  }
});

test("H10.2 wrong lengths and invalid choices are refused without consuming an attempt", () => {
  const db = seed(Date.now()), lesson = LESSONS[0];
  const invalid = [null, {}, [], [0, 0, 0], [0, 0, 0, 0, 0], lesson.questions.map((q) => q.answer), [0, 0, 0, -1], [0, 0, 0, 9], [0, 0, 0, 0.5], [0, 0, 0, "0"], [0, 0, 0, null], Array(4)];
  const before = structuredClone(db);
  for (const answers of invalid) {
    for (const grade of [() => game.completeLesson(db, lesson.id, answers), () => actions.lesson(db, { lessonId: lesson.id, answers })]) {
      assert.throws(grade, (e) => e instanceof game.GameError && e.status === 400);
      assert.deepEqual(db, before);
    }
  }
  assert.throws(() => game.completeLesson(db, "missing", [0, 0, 0, 0]), game.GameError);
});

test("H10.2 every lesson grades its seeded subset, passes at three of four, and awards points once", () => {
  const db = seed(Date.now());
  const balances = structuredClone(db.accounts), before = db.child.points;
  const goal = game.createParentGoal(db, { title: "Keep learning", type: "lessons", count: 30, reward: 0 });
  for (const lesson of LESSONS) {
    assert.deepEqual(actions.lesson(db, { lessonId: lesson.id, answers: answersFor(db, lesson, 2) }), { passed: false, correct: 2, total: 4 });
    assert.equal(db.child.lessonAttempts[lesson.id], 1);
    assert.equal(db.audit.at(-1).detail, `Tried "${lesson.title}" (2/4)`);
    assert.deepEqual(actions.lesson(db, { lessonId: lesson.id, answers: answersFor(db, lesson, 3) }), { passed: true, correct: 3, total: 4, firstTime: true });
    assert.equal(db.child.lessonAttempts[lesson.id], 2);
    const points = db.child.points, progress = goal.progress, coop = db.child.coopLearning;
    assert.deepEqual(actions.lesson(db, { lessonId: lesson.id, answers: answersFor(db, lesson) }), { passed: true, correct: 4, total: 4, firstTime: false });
    assert.equal(db.child.lessonAttempts[lesson.id], 3);
    assert.equal(db.child.points, points);
    assert.equal(goal.progress, progress);
    assert.equal(db.child.coopLearning, coop);
  }
  assert.equal(db.child.points, before + 30 * POINTS.lesson);
  assert.equal(db.child.stats.learningDone, 30);
  assert.equal(db.child.lessonsDone.length, 30);
  assert.equal(goal.progress, 30);
  assert.deepEqual(db.accounts, balances);
});

test("H10.2 stale attempt numbers never grade a different subset or consume another try", () => {
  const db = seed(Date.now()), lesson = LESSONS[0];
  const stale = { lessonId: lesson.id, attempt: 0, answers: answersFor(db, lesson) };
  actions.lesson(db, { ...stale, answers: answersFor(db, lesson, 2) });
  const before = structuredClone(db);
  assert.throws(() => actions.lesson(db, stale), (e) => e instanceof game.GameError && e.status === 400 && /Close it and try again/.test(e.message));
  assert.deepEqual(db, before);
  for (const attempt of ["oops", -1, 0.5, null]) {
    assert.throws(() => actions.lesson(db, { ...stale, attempt }), game.GameError);
    assert.deepEqual(db, before);
  }
  assert.equal(actions.lesson(db, { lessonId: lesson.id, attempt: 1, answers: answersFor(db, lesson) }).passed, true);
  assert.equal(db.child.lessonAttempts[lesson.id], 2);
});

test("H10.2 failed, first-pass and review counters persist per child and survive cache reloads", () => {
  database().prepare("INSERT INTO families (id, name, created_at) VALUES (?, ?, ?)").run("h10-family", "Jordan", Date.now());
  const a = createChild("h10-family", { name: "Ava", age: 9, bearName: "Pip" });
  const b = createChild("h10-family", { name: "Ben", age: 8, bearName: "Coco" });
  const lesson = LESSONS[3];
  for (const correct of [0, 3, 4]) mutateChild(a.id, (db) => actions.lesson(db, { lessonId: lesson.id, answers: answersFor(db, lesson, correct) }));
  _clearStoreForTest();
  const db = readChild(a.id);
  assert.equal(db.child.lessonAttempts[lesson.id], 3);
  assert.equal(childView(db).lessonAttempts[lesson.id], 3);
  assert.equal(childView(readChild(b.id)).lessonAttempts[lesson.id], 0);
  assert.deepEqual(selected(db, lesson), pickLessonIndexes(a.id, lesson.id, 3).map((i) => lesson.questions[i]));
  assert.equal(db.child.points, POINTS.lesson);
});

test("H10.3 both views expose all six questions privately, a rolling five, and thirty-lesson totals", () => {
  const db = seed(Date.now());
  assert.ok(!db.child.lessonAttempts, "legacy documents need no migration");
  assert.deepEqual(childView(db).lessonAttempts, Object.fromEntries(LESSONS.map((l) => [l.id, 0])));
  actions.lesson(db, { lessonId: LESSONS[0].id, answers: answersFor(db, LESSONS[0]) });
  for (const view of [childView(db), parentView(db)]) {
    assert.equal(view.catalog.lessons.length, 30);
    assert.equal(view.lessons.total, 30);
    assert.deepEqual(view.lessons.next.map((l) => l.id), LESSONS.slice(1, 6).map((l) => l.id));
    assert.equal(view.lessons.finished.length, 1);
    assert.equal(view.lessonAttempts[LESSONS[0].id], 1);
    for (const lesson of [...view.catalog.lessons, ...view.lessons.next, ...view.lessons.finished]) {
      assert.equal(lesson.questions.length, 6);
      for (const q of lesson.questions) assert.deepEqual(Object.keys(q).sort(), ["options", "q"]);
    }
  }
  assert.deepEqual(snapshot(db).lessons, { finished: 1, total: 30, next_titles: LESSONS.slice(1, 4).map((l) => l.title) });
});

test("H10.2 first-pass mission hook still awards only twenty and failed/review tries never complete it", () => {
  const db = seed(Date.now()), now = Date.now(), lesson = LESSONS[0];
  game.ensureDailyMissions(db, now);
  db.child.dailyMissions.active = [{ key: "lesson", assignedAt: now }];
  const before = db.child.points;
  game.completeLesson(db, lesson.id, answersFor(db, lesson, 2), now);
  assert.equal(db.child.dailyMissions.done.length, 0);
  game.completeLesson(db, lesson.id, answersFor(db, lesson, 3), now);
  assert.equal(db.child.points, before + POINTS.lesson);
  assert.equal(db.child.dailyMissions.done.filter((m) => m.key === "lesson").length, 1);
  game.completeLesson(db, lesson.id, answersFor(db, lesson), now);
  assert.equal(db.child.points, before + POINTS.lesson);
  assert.equal(db.child.dailyMissions.done.filter((m) => m.key === "lesson").length, 1);
});
