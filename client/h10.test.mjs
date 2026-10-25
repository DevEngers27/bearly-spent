// Socket-free quiz interaction checks; browser/visual QA stays in CHECKLIST.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import { LESSONS } from "../server/catalog.js";
import { actions } from "../server/actions.js";
import { childView } from "../server/index.js";
import { pickLessonIndexes } from "../shared/lessonPick.js";

const compiled = await build({
  stdin: { contents: await readFile(new URL("src/Child.jsx", import.meta.url), "utf8") + "\nexport { LessonSheet, Missions };", resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
  bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" },
});
function harness() {
  const slots = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect() { cursor++; },
    useMemo(fn) { cursor++; return fn(); },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputFiles[0].text, {
    module, exports: module.exports, require: () => hooks,
    h: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }), Fragment: "fragment",
  });
  return { render(name, props) { cursor = 0; return module.exports[name](props); } };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...(tree.props?.children || []).flatMap((c) => nodes(c, predicate))];
}
const text = (tree) => typeof tree === "string" || typeof tree === "number" ? String(tree) : (tree?.props?.children || []).map(text).join(" ");
const normalized = (tree) => text(tree).replace(/\s+/g, " ").trim();
const questionText = (tree) => text(nodes(tree, (n) => n.props.className === "quiz-q hand")[0]);
const options = (tree) => nodes(nodes(tree, (n) => n.props.className === "quiz-opts")[0], (n) => n.type === "button");
const button = (tree, label) => nodes(tree, (n) => n.type === "button" && text(n) === label)[0];
const noop = () => {};

test("H10.2 every sheet shows exactly the server's four-question subset and four-step progress", async () => {
  for (const lesson of LESSONS) {
    const h = harness(), db = seed(Date.now());
    const state = childView(db), indexes = pickLessonIndexes(state.childId, lesson.id, state.lessonAttempts[lesson.id]);
    const requests = [];
    const render = () => h.render("LessonSheet", { lesson: state.catalog.lessons.find((l) => l.id === lesson.id), state, close: noop, run: async (path, body) => {
      requests.push([path, body]);
      return actions.lesson(db, body);
    } });
    for (let i = 0; i < 4; i++) {
      const tree = render(), q = lesson.questions[indexes[i]];
      assert.equal(questionText(tree), q.q);
      assert.match(normalized(tree), new RegExp(`Question ${i + 1} of 4`));
      const progress = nodes(tree, (n) => n.props.className === "quiz-progress")[0].props.children;
      assert.equal(progress.length, 4);
      assert.equal(progress.filter((n) => n.props.className === "on").length, i);
      assert.equal(progress[i].props.className, "now");
      assert.deepEqual(options(tree).map(text), q.options);
      await options(tree)[q.answer].props.onClick();
    }
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], "child/lesson");
    assert.equal(requests[0][1].attempt, 0);
    assert.deepEqual(Array.from(requests[0][1].answers), indexes.map((i) => lesson.questions[i].answer));
    assert.match(normalized(render()), /4 of 4 right! Lesson complete. \+20 adventure points!/);
    assert.equal(db.child.lessonAttempts[lesson.id], 1);
  }
});

test("H10.2 failed attempts show warm copy and rotate even before the state refresh arrives", async () => {
  const h = harness(), db = seed(Date.now()), lesson = LESSONS[0];
  let state = childView(db);
  const attempts = [];
  const render = () => h.render("LessonSheet", { lesson, state, close: noop, run: async (path, body) => { attempts.push(body.attempt); return actions.lesson(db, body); } });
  const first = pickLessonIndexes(undefined, lesson.id, 0);
  for (const [i, idx] of first.entries()) {
    const q = lesson.questions[idx];
    await options(render())[i < 2 ? q.answer : 1 - q.answer].props.onClick();
  }
  assert.match(normalized(render()), /2 of 4 right! Nearly! Try again — the questions will be a little different\./);
  assert.equal(state.lessonAttempts[lesson.id], 0, "state refresh still pending");
  button(render(), "Try again").props.onClick();
  const second = pickLessonIndexes(undefined, lesson.id, 1);
  assert.notDeepEqual([...first].sort(), [...second].sort());
  for (const idx of second) {
    const q = lesson.questions[idx];
    assert.equal(questionText(render()), q.q);
    await options(render())[q.answer].props.onClick();
  }
  assert.match(normalized(render()), /Lesson complete. \+20/);
  state = childView(db);
  assert.equal(state.lessonAttempts[lesson.id], 2);
  assert.deepEqual(attempts, [0, 1]);
});

test("H10.2 reopened sheets use the child's attempt counter and pin it during background refreshes", () => {
  const lesson = LESSONS[2];
  for (const childId of ["child-a", "child-b"]) {
    for (const attempt of [0, 1, 8, 20]) {
      const h = harness(), state = { ...childView(seed(Date.now())), childId, lessonAttempts: { [lesson.id]: attempt } };
      const render = () => h.render("LessonSheet", { lesson, state, close: noop });
      const expected = lesson.questions[pickLessonIndexes(childId, lesson.id, attempt)[0]].q;
      assert.equal(questionText(render()), expected);
      state.lessonAttempts[lesson.id] = attempt + 1;
      assert.equal(questionText(render()), expected, "open question stays pinned");
      assert.equal(questionText(harness().render("LessonSheet", { lesson, state, close: noop })), lesson.questions[pickLessonIndexes(childId, lesson.id, attempt + 1)[0]].q);
    }
  }
});

test("H10.2 a failed final request retries four answers on the same subset", async () => {
  const h = harness(), db = seed(Date.now()), state = childView(db), lesson = LESSONS[5];
  let requests = 0;
  const payloads = [];
  const render = () => h.render("LessonSheet", { lesson, state, close: noop, run: async (path, body) => {
    payloads.push(Array.from(body.answers));
    return ++requests === 1 ? null : actions.lesson(db, body);
  } });
  const indexes = pickLessonIndexes(undefined, lesson.id, 0);
  for (const idx of indexes) await options(render())[lesson.questions[idx].answer].props.onClick();
  assert.match(normalized(render()), /Question 4 of 4/);
  assert.equal(db.child.lessonAttempts, undefined);
  assert.equal(questionText(render()), lesson.questions[indexes[3]].q);
  await options(render())[lesson.questions[indexes[3]].answer].props.onClick();
  assert.deepEqual(payloads[0], payloads[1]);
  assert.equal(payloads[1].length, 4);
  assert.equal(db.child.lessonAttempts[lesson.id], 1);
  assert.match(normalized(render()), /4 of 4 right!/);
});

test("H10.3 rolling lesson cards say four questions and reviews have no points", () => {
  const h = harness(), db = seed(Date.now());
  const lesson = LESSONS[0];
  actions.lesson(db, { lessonId: lesson.id, answers: pickLessonIndexes(undefined, lesson.id, 0).map((i) => lesson.questions[i].answer) });
  const state = childView(db), tree = h.render("Missions", { state });
  const cards = nodes(tree, (n) => n.type === "button" && n.props.className?.startsWith("lesson "));
  assert.equal(cards.length, 6);
  assert.equal(cards.filter((n) => /4 questions · \+20/.test(normalized(n))).length, 5);
  assert.equal(cards.filter((n) => /Review · no points/.test(normalized(n))).length, 1);
  assert.doesNotMatch(normalized(tree), /6 questions/);
});

test("H10.2 passed reviews use four questions, give no points, and failed reviews show retry copy", async () => {
  const db = seed(Date.now()), lesson = LESSONS[0];
  actions.lesson(db, { lessonId: lesson.id, answers: pickLessonIndexes(undefined, lesson.id, 0).map((i) => lesson.questions[i].answer) });
  const before = db.child.points;
  for (const pass of [false, true]) {
    const h = harness(), state = childView(db), indexes = pickLessonIndexes(undefined, lesson.id, state.lessonAttempts[lesson.id]);
    const render = () => h.render("LessonSheet", { lesson, state, run: async (path, body) => actions.lesson(db, body) });
    for (const idx of indexes) await options(render())[pass ? lesson.questions[idx].answer : 1 - lesson.questions[idx].answer].props.onClick();
    assert.match(normalized(render()), pass ? /Nice review! No extra points for repeats\./ : /Nearly! Try again — the questions will be a little different\./);
    assert.doesNotMatch(normalized(render()), /\+20/);
    assert.equal(db.child.points, before);
  }
});
