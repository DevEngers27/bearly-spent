// Socket-free component regression tests, matching c1.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import { childView } from "../server/index.js";

const source = await readFile(new URL("src/Child.jsx", import.meta.url), "utf8");
const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
const compiled = await build({
  stdin: { contents: source + "\nexport { Missions, Home, MoneySheet, nextUp, openDailyMission, SeenMissionButton, PostcardSheet };", resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
  bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" },
});
function harness() {
  const slots = [], pending = [], timers = new Map();
  let cursor = 0, timerId = 0;
  const changed = (a, b) => !a || !b || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputFiles[0].text, {
    module, exports: module.exports, require: () => hooks,
    h: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }), Fragment: "fragment",
    window: { matchMedia: () => ({ matches: false }) }, console, Date,
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id),
    setInterval: () => 1, clearInterval() {},
  });
  return { exports: module.exports, render(fn, props) { cursor = 0; return fn(props); }, flush() { while (pending.length) pending.shift()(); }, finishTimers() { for (const fn of timers.values()) fn(); timers.clear(); }, timers };
}
function nodes(tree, pred) {
  if (!tree || typeof tree !== "object") return [];
  return [...(pred(tree) ? [tree] : []), ...(tree.props?.children || []).flatMap((c) => nodes(c, pred))];
}
const text = (tree) => typeof tree === "string" || typeof tree === "number" ? String(tree) : (tree?.props?.children || []).map(text).join(" ");
const button = (tree, label) => nodes(tree, (n) => n.type === "button" && text(n).includes(label))[0];
const noop = () => {};
function stateFixture() {
  const db = seed(Date.now()), state = childView(db);
  state.missionsToday = { active: [
    { key: "journal", title: "Write in your cash diary", pts: 10, hint: "Tell your diary.", kind: "event", assignedAt: 1 },
    { key: "map", title: "Visit the map", pts: 10, hint: "Find a place.", kind: "seen", assignedAt: 1 },
  ], done: [], doneCount: 0, cap: 6 };
  return state;
}

test("H2 client Today: active missions, hints and replacements with brief done/New states", () => {
  const h = harness(), state = stateFixture(), opened = [];
  const props = { state, open: (...args) => opened.push(args), goMap: noop, setTab: noop, run: noop };
  const render = () => h.render(h.exports.Missions, props);
  let tree = render(); h.flush();
  assert.match(text(tree), /Write in your cash diary/);
  assert.match(text(tree), /Tell your diary/);
  button(tree, "Write in your cash diary").props.onClick();
  assert.equal(opened[0][0], "money"); assert.equal(opened[0][1].start, "log");
  state.missionsToday = { ...state.missionsToday, active: [state.missionsToday.active[1], { key: "dress", title: "Try a new look on Maple", pts: 10 }], done: [{ key: "journal" }], doneCount: 1 };
  render(); h.flush(); tree = render();
  assert.ok(nodes(tree, (n) => n.props.className === "done mission-exit").length);
  assert.equal(button(tree, "Write in your cash diary").props.disabled, true);
  assert.match(text(button(tree, "Try a new look")), /New!/);
  // A new polling payload with unchanged keys must not cancel the exit timer.
  state.missionsToday = structuredClone(state.missionsToday);
  render(); h.flush(); assert.equal(h.timers.size, 1);
  h.finishTimers(); tree = render();
  assert.equal(button(tree, "Write in your cash diary"), undefined);
  assert.doesNotMatch(text(button(tree, "Try a new look")), /New!/);
});

test("H2 client cap, weekly budget and lesson Review label preserve their separate rules", () => {
  const h = harness(), state = stateFixture();
  state.missionsToday = { active: [], done: [], doneCount: 6, cap: 6 };
  state.child.lessonsDone = [state.catalog.lessons[0].id];
  state.child.lastBudgetWeek = state.weekKey;
  const tree = h.render(h.exports.Missions, { state, open: noop });
  assert.match(text(tree), /All done for today — amazing!/);
  assert.equal(button(tree, "Weekly budget challenge").props.disabled, false);
  assert.doesNotMatch(text(button(tree, "Weekly budget challenge")), /\+50/);
  const lesson = button(tree, state.catalog.lessons[0].title);
  assert.match(text(lesson), /Review · no points/);
  assert.doesNotMatch(text(lesson), /\+20/);
});

test("H2 client Home next-up uses the first server mission and opens Missions", () => {
  const h = harness(), state = stateFixture(), tabs = [];
  const tree = h.render(h.exports.Home, { state, setTab: (tab) => tabs.push(tab), open: noop });
  assert.match(text(tree), /Write in your cash diary/);
  button(tree, "Let's go").props.onClick(); assert.deepEqual(tabs, ["missions"]);
  assert.equal(h.exports.nextUp(state)[0].id, "journal");
  state.missionsToday.active = [];
  assert.equal(h.exports.nextUp(state).length, 0);
});

test("H2 client mission navigation opens the matching activity and a readable story", () => {
  const h = harness(), state = stateFixture(), opened = [];
  let maps = 0;
  const ctx = { state, open: (...args) => opened.push(args), goMap: () => maps++, setTab: noop };
  for (const key of ["compare", "save", "lesson", "dress", "goal", "greet", "story", "map"]) h.exports.openDailyMission({ key }, ctx);
  assert.equal(opened[0][1].compare, true);
  assert.equal(opened[1][1].start, "save");
  assert.deepEqual(opened.map(([type]) => type), ["money", "money", "lesson", "dress", "goals", "friends", "postcard"]);
  assert.equal(maps, 1);
  const postcard = h.render(h.exports.PostcardSheet, { ...ctx, ...opened.at(-1)[1] });
  assert.equal(nodes(postcard, (n) => n.type?.name === "FlipPostcard")[0].props.startFlipped, true);
});

test("H2 client seen buttons send only their active key and respect busy/offline", async () => {
  const h = harness(), state = stateFixture(), calls = [];
  const props = { state, missionKey: "map", children: "Found a place!", run: async (...args) => calls.push(args) };
  await h.render(h.exports.SeenMissionButton, props).props.onClick();
  assert.equal(calls[0][0], "child/missions/seen"); assert.equal(calls[0][1].key, "map");
  assert.equal(h.render(h.exports.SeenMissionButton, { ...props, busy: true }).props.disabled, true);
  assert.equal(h.render(h.exports.SeenMissionButton, { ...props, missionKey: "story" }), null);
});

test("H2 client diary submits two prices; comparison requires both inputs", async () => {
  const h = harness(), state = stateFixture(), calls = [];
  const props = { state, start: "log", compare: true, close: noop, run: async (...args) => { calls.push(args); return {}; } };
  const render = () => h.render(h.exports.MoneySheet, props);
  const prices = (tree) => nodes(tree, (n) => n.type === "input" && n.props.max === "10000");
  assert.equal(prices(render()).length, 2);
  assert.ok(prices(render()).every((p) => p.props.required));
  prices(render())[0].props.onChange({ target: { value: "2" } });
  prices(render())[1].props.onChange({ target: { value: "3.50" } });
  const tree = render();
  await nodes(tree, (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.equal(calls[0][0], "child/journal");
  assert.deepEqual(Array.from(calls[0][1].prices), [2, 3.5]);
});

test("H2 client reduced-motion turns off mission enter and exit animation", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.mission-exit, \.mission-enter \{ animation: none;/);
});


test("H2 client eligibility changes clear an interrupted completion transition", () => {
  const h = harness(), state = stateFixture();
  const render = () => h.render(h.exports.Missions, { state, open: noop });
  render(); h.flush();
  state.missionsToday = { ...state.missionsToday, active: [state.missionsToday.active[1]], done: [{ key: "journal" }], doneCount: 1 };
  render(); h.flush();
  assert.ok(button(render(), "Write in your cash diary"));
  state.missionsToday = { ...state.missionsToday, active: [] };
  render(); h.flush();
  assert.equal(button(render(), "Write in your cash diary"), undefined);
  assert.equal(h.timers.size, 0);
});
