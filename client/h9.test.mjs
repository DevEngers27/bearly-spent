import { pickLessonIndexes } from "../shared/lessonPick.js";
// Socket-free C1 regression checks: node --test client/c1.test.mjs
// Browser gestures, installation and visual checks remain in CHECKLIST.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import * as game from "../server/domain.js";
import * as catalog from "../server/catalog.js";
import { childView } from "../server/index.js";

const sources = Object.fromEntries(await Promise.all(["api.js", "Child.jsx", "Parent.jsx", "App.jsx", "Markdown.jsx"].map(async (name) => {
  const extra = { "Child.jsx": "ProfileSheet, Home, MoneySheet, LessonSheet, Missions, Buddy, MapScreen, MapView, Friends, DressSheet, BudgetSheet, PlaceSheet, TalkBar, useMapleTalk, SpeechBubble, ReturnReveal, Album, countdown, BearFigure, FlipPostcard, PostcardTile", "Parent.jsx": "Overview, Goals, SavingsGoal, Allowance, Activity, Inbox, Guardian, Settings, Children, Security, BuddyLog, Devices, WalletLedger, AppleCashTracking", "App.jsx": "PinGate, Loading, AuthScreen, ChildRoot, ParentRoot, setSelectedChild" }[name];
  const result = await build({
    stdin: { contents: await readFile(new URL(`src/${name}`, import.meta.url), "utf8") + (extra ? `\nexport { ${extra} };` : ""), resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
    bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" },
  });
  return [name, result.outputFiles[0].text];
})));

function harness(name, { controller = null } = {}) {
  const slots = [], pending = [], timers = [], intervalDelays = [], timeouts = [], notices = [], streams = [];
  const storage = new Map(), session = new Map();
  const window = new EventTarget();
  window.scrollTo = () => {};
  let cursor = 0;
  const env = { now: Date.now(), fetch: async () => new Response("{}"), slots, pending, notices, storage, session, window, timers, intervalDelays, timeouts, streams };
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    },
  };
  const storageApi = (map) => ({ get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) });
  env.document = { activeElement: null, visibilityState: "visible", body: { classList: { add() {}, remove() {} } }, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
  env.location = new URL("https://moneyquest.test/");
  env.navigator = { serviceWorker: Object.assign(new EventTarget(), { controller }) };
  const module = { exports: {} };
  vm.runInNewContext(sources[name], {
    module, exports: module.exports, require: () => hooks,
    h: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }), Fragment: "fragment",
    window, document: env.document, navigator: env.navigator, sessionStorage: storageApi(session), localStorage: storageApi(storage),
    location: env.location, history: { replaceState: (a, b, url) => { env.location.href = url.href; } },
    fetch: (...args) => env.fetch(...args), Event, URL, URLSearchParams, console,
    EventSource: class { constructor(url) { this.url = url; streams.push(this); } close() { this.closed = true; } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    Date: class extends Date { static now() { return env.now; } },
    setInterval: (fn, ms) => { timers.push(fn); intervalDelays.push(ms); return timers.length; }, clearInterval() {}, setTimeout: (fn) => { timeouts.push(fn); return timeouts.length; }, clearTimeout: (id) => { timeouts[id - 1] = null; },
  });
  env.exports = module.exports;
  env.render = (fn, props) => { cursor = 0; return fn(props); };
  env.flush = () => { while (pending.length) pending.shift()(); };
  env.toast = (...args) => notices.push(args);
  return env;
}

function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...(tree.props?.children || []).flatMap((c) => nodes(c, predicate))];
}
const text = (tree) => tree?.type?.name === "Markdown" ? text(tree.type(tree.props)) : typeof tree === "string" || typeof tree === "number" ? String(tree) : (tree?.props?.children || []).map(text).join(" ");
const byText = (tree, label) => nodes(tree, (n) => n.type === "button" && text(n).replace(/\s+/g, " ").trim().includes(label))[0];
const noop = () => {};
const submit = { preventDefault() {} };
function stateFixture() {
  const db = seed(Date.now());
  return { ...db, goals: db.savingsGoals, balances: { savings: 2000, spending: 1000, parent: 25000 }, chat: [], plan: null,
    catalog: { places: Object.fromEntries(Object.entries(catalog.PLACES).map(([id, p]) => [id, { ...p, open: true, image: `/postcards/${id}.png` }])), home: catalog.HOME, lessons: catalog.LESSONS, points: catalog.POINTS, milestones: catalog.MILESTONES, cosmetics: catalog.COSMETICS, greetings: game.GREETINGS },
    integrations: { voice: "browser", buddy: "offline" }, pendingRequests: [] };
}


const component = (tree, name) => nodes(tree, (n) => n.type?.name === name)[0];
const normalized = (tree) => text(tree).replace(/\s+/g, " ").trim();
function meFixture(role = "parent") {
  const child = { id: "child-one", name: "Mia", age: 9, bearName: "Maple" };
  return { role, family: { id: "family-one", pinSet: false }, activeChild: child, children: [child], unlockedUntil: 0 };
}
async function appHarness(me) {
  const h = harness("App.jsx");
  h.fetch = async () => new Response(JSON.stringify(me));
  h.render(h.exports.default); h.flush(); await new Promise(setImmediate);
  h.tree = () => { const tree = h.render(h.exports.default); h.flush(); return tree; };
  h.tree();
  return h;
}
test("H9.1 Me sheet confirms, cancels and retries kid sign-out; parent kid mode has no logout", async () => {
  const h = harness("Child.jsx"), state = stateFixture();
  let calls = 0, succeed = false;
  const onSignOut = async () => { calls++; if (!succeed) throw new Error("Try again"); return {}; };
  const run = async (fn) => { try { return await fn(); } catch { return null; } };
  const render = (extra = {}) => h.render(h.exports.ProfileSheet, { state, run, onSignOut, ...extra });
  byText(render(), "Sign out").props.onClick();
  assert.equal(calls, 0);
  assert.match(normalized(render()), /You'll need a new kid code from your grown-up to come back/);
  assert.equal(byText(render({ busy: true }), "Confirm sign out").props.disabled, true);
  byText(render(), "Stay here").props.onClick();
  assert.equal(byText(render(), "Confirm sign out"), undefined);
  byText(render(), "Sign out").props.onClick();
  await byText(render(), "Confirm sign out").props.onClick();
  assert.ok(byText(render(), "Confirm sign out"));
  succeed = true; await byText(render(), "Confirm sign out").props.onClick();
  assert.equal(calls, 2);
  assert.equal(byText(render({ onSignOut: undefined, onGrownUps: noop }), "Sign out"), undefined);
});

test("H9.1 kid logout posts with cookies, clears per-child keys and shows Welcome hint only on success", async () => {
  for (const success of [false, true]) {
    const h = await appHarness(meFixture("child"));
    for (const key of ["mq_tab", "mq_seen_adv", "mq_muted", "mq_album_baseline:one", "mq_opened_cards:one", "mq_last_state"]) h.storage.set(key, "cached");
    h.storage.set("unrelated", "keep");
    const calls = [];
    h.fetch = async (url, options) => { calls.push([url, options]); return new Response(success ? "{}" : '{"error":"Try again"}', { status: success ? 200 : 500 }); };
    const root = component(h.tree(), "ChildRoot");
    if (!success) {
      await assert.rejects(root.props.onSignOut(), { status: 500 });
      assert.equal(h.storage.get("mq_tab"), "cached");
      assert.ok(component(h.tree(), "ChildRoot"));
      continue;
    }
    await root.props.onSignOut();
    assert.equal(new URL(calls[0][0], h.location).pathname, "/api/auth/logout");
    assert.equal(calls[0][1].method, "POST");
    assert.equal(calls[0][1].credentials, "same-origin");
    assert.deepEqual([...h.storage.keys()], ["unrelated"]);
    const auth = component(h.tree(), "AuthScreen");
    assert.equal(auth.props.screen, "welcome");
    const screen = harness("App.jsx");
    assert.match(normalized(screen.render(screen.exports.AuthScreen, auth.props)), /You signed out. Ask your grown-up for a new kid code/);
  }
  const parent = await appHarness(meFixture());
  byText(parent.tree(), "Kid mode").props.onClick();
  assert.equal(component(parent.tree(), "ChildRoot").props.onSignOut, undefined);
  assert.equal(typeof component(parent.tree(), "ChildRoot").props.onGrownUps, "function");
});

test("H9.2 five unpassed lessons roll after sheet closes, show New and collapse finished reviews", () => {
  const h = harness("Child.jsx"), db = seed(Date.now());
  let state = childView(db), sheet = false;
  const opened = [];
  const render = () => h.render(h.exports.Missions, { state, lessonSheetOpen: sheet, open: (...args) => opened.push(args) });
  let tree = render(); h.flush();
  assert.match(normalized(tree), /Next lessons/);
  const lessons = (tree) => nodes(tree, (n) => n.type === "button" && n.props.className?.startsWith("lesson "));
  assert.equal(lessons(tree).length, 5);
  assert.deepEqual(lessons(tree).map((n) => nodes(n, (c) => c.type === "strong").map(text)[0]), catalog.LESSONS.slice(0, 5).map((l) => l.title));
  byText(tree, catalog.LESSONS[0].title).props.onClick();
  assert.equal(opened[0][1].lesson.id, catalog.LESSONS[0].id);
  sheet = true; render(); h.flush();
  game.completeLesson(db, catalog.LESSONS[0].id, pickLessonIndexes(undefined, catalog.LESSONS[0].id, 0).map((i) => catalog.LESSONS[0].questions[i].answer));
  state = childView(db); render(); h.flush();
  assert.equal(nodes(render(), (n) => n.props.className?.includes("mission-enter")).length, 0, "wait for result sheet to close");
  sheet = false; render(); h.flush(); tree = render();
  assert.equal(nodes(tree, (n) => n.props.className?.includes("mission-exit")).length, 1);
  assert.equal(nodes(tree, (n) => n.props.className?.includes("mission-enter")).length, 1);
  assert.match(text(byText(tree, catalog.LESSONS[5].title)), /New!/);
  // Opening another lesson cancels the first timer; closing without a pass must not leave an exit card stuck.
  sheet = true; render(); h.flush();
  sheet = false; render(); h.flush();
  assert.equal(nodes(render(), (n) => n.props.className?.includes("mission-exit")).length, 0);
  h.timeouts.filter(Boolean).forEach((fn) => fn()); tree = render();
  const finished = nodes(tree, (n) => n.type === "details")[0];
  assert.equal(finished.props.open, undefined);
  assert.match(text(finished), /Finished · review, no points/);
  assert.match(text(byText(finished, catalog.LESSONS[0].title)), /Review · no points/);
  assert.doesNotMatch(text(byText(finished, catalog.LESSONS[0].title)), /\+20/);
  assert.equal(nodes(nodes(tree, (n) => n.props.className === "lesson-grid")[0], (n) => n.type === "button").length, 5);
  for (const lesson of catalog.LESSONS) game.completeLesson(db, lesson.id, pickLessonIndexes(undefined, lesson.id, db.child.lessonAttempts?.[lesson.id] || 0).map((i) => lesson.questions[i].answer));
  state = childView(db); tree = render(); h.flush();
  assert.match(normalized(tree), /You finished every lesson — more are on the way!/);
});

test("H9.2 parent lesson totals follow the catalog and quiz reviews say no points", async () => {
  const h = harness("Parent.jsx"), state = stateFixture();
  state.child.lessonsDone = catalog.LESSONS.slice(0, 6).map((l) => l.id);
  assert.match(normalized(h.render(h.exports.Overview, { state })), /6\s*\/\s*30 unique/);
  const quiz = harness("Child.jsx");
  const lesson = catalog.LESSONS[5];
  const render = () => quiz.render(quiz.exports.LessonSheet, { state, lesson, run: async () => ({ passed: true, correct: 4, total: 4, firstTime: false }) });
  for (const i of pickLessonIndexes(state.childId, lesson.id, 0)) await byText(render(), lesson.questions[i].options[lesson.questions[i].answer]).props.onClick();
  assert.match(normalized(render()), /Nice review! No extra points for repeats/);
});

test("H9.3 incoming anonymous and named friend cards retain consent and waiting states", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  state.demo = false;
  state.friends = [{ id: "fr", real: true, incoming: true, status: "pending_parent_a", childAccepted: false }];
  const calls = [];
  const render = () => h.render(h.exports.Friends, { state, run: (...args) => calls.push(args) });
  assert.match(normalized(render()), /Friend request · grown-ups checking/);
  assert.doesNotMatch(normalized(render()), /undefined|null wants/);
  byText(render(), "Accept friend").props.onClick();
  assert.equal(calls[0][0], "child/friend/fr/respond");
  state.friends[0].childAccepted = true;
  assert.match(normalized(render()), /You said yes · grown-ups checking/);
  assert.equal(byText(render(), "Accept friend"), undefined);
  Object.assign(state.friends[0], { name: "Ben", familyLabel: "The Joneses", status: "pending_parent_b" });
  assert.match(normalized(render()), /Ben \(from The Joneses\) wants to be friends/);
});

test("H9.4 / 0.8.8 speech-to-text stays out; read-aloud controls are back", async () => {
  const h = harness("Child.jsx"), state = stateFixture();
  state.chat = [{ id: "m1", role: "assistant", text: "Hello!" }, { id: "m2", role: "user", text: "Hi" }];
  h.window.SpeechRecognition = class { constructor() { throw new Error("removed"); } };
  const bar = h.render(h.exports.TalkBar, { state, talk: { close: noop, send: noop, muted: false, toggleMute: noop }, open: noop });
  assert.equal(nodes(bar, (n) => n.props["aria-label"] === "Hold to talk").length, 0);
  assert.equal(nodes(bar, (n) => n.props["aria-label"] === "Sound on").length, 1);
  const chat = h.render(h.exports.Buddy, { state, open: noop, run: noop, startTalk: noop });
  assert.equal(nodes(chat, (n) => n.props["aria-label"] === "Read aloud").length, 1, "one Read aloud per bear reply, none for the kid's line");
  const source = await readFile(new URL("src/Child.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /SpeechRecognition|Hold to talk/);
  assert.match(source, /voice\/token/); assert.match(source, /buddy\/speak/);
});

function markdown(value) {
  const h = harness("Markdown.jsx");
  return h.render(h.exports.default, { text: value });
}

test("H9.5 Markdown renders paragraphs, breaks, bold, italic, lists and inline code", () => {
  const tree = markdown("A **bold** word and *soft* word with `a < b`.\nNext line.\n\n- Save $2\n- Keep $1\n\n1. Plan\n2. Check\n\nLast paragraph.");
  for (const [tag, count] of [["p", 2], ["br", 1], ["strong", 1], ["em", 1], ["code", 1], ["ul", 1], ["ol", 1], ["li", 4]]) assert.equal(nodes(tree, (n) => n.type === tag).length, count, tag);
  assert.equal(text(nodes(tree, (n) => n.type === "code")[0]), "a < b");
  assert.equal(nodes(markdown("4. Four\n5. Five"), (n) => n.type === "ol")[0].props.start, 4);
});

test("H9.5 HTML and links stay escaped text; nested and unfinished markers remain readable", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const compiled = await build({ entryPoints: [new URL("src/Markdown.jsx", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "cjs", external: ["react"], jsx: "automatic" });
  const module = { exports: {} };
  const { createRequire } = await import("node:module");
  vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url) });
  const raw = '<img src=x onerror="alert(1)"><script>alert(1)</script> https://example.test [hi](javascript:alert(1))';
  const html = renderToStaticMarkup(createElement(module.exports.default, { text: raw }));
  assert.match(html, /&lt;img/); assert.match(html, /&lt;script/);
  assert.doesNotMatch(html, /<img|<script|<a\b|href=|dangerouslySetInnerHTML/);
  for (const value of ["**unclosed", "*unclosed", "`unclosed", "***nested***", "**bold *inside* end**", "`**literal**`", "", null]) {
    assert.doesNotThrow(() => markdown(value));
    assert.ok(nodes(markdown(value), (n) => n.props.dangerouslySetInnerHTML).length === 0);
  }
});

test("H9.5 all three chat surfaces use Markdown and long typewritten replies scroll", async () => {
  const state = stateFixture(), reply = ("**Save** $2.\n- Check your plan\n\n" + "longword".repeat(50)).repeat(12);
  state.chat = [{ id: "a", role: "assistant", text: reply }];
  const child = harness("Child.jsx"), parent = harness("Parent.jsx"), bubble = harness("Child.jsx");
  assert.equal(component(child.render(child.exports.Buddy, { state }), "Markdown").props.text, reply);
  assert.equal(component(parent.render(parent.exports.BuddyLog, { state }), "Markdown").props.text, reply);
  const render = () => bubble.render(bubble.exports.SpeechBubble, { text: reply });
  render(); bubble.flush();
  assert.equal(component(render(), "Markdown").props.text, "\u00a0");
  bubble.timers[0]();
  assert.equal(component(render(), "Markdown").props.text, reply.slice(0, 4));
  assert.ok(nodes(markdown(reply), (n) => n.type === "strong").length >= 12);
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.markdown\s*\{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.bear-bubble-text\s*\{[^}]*max-height: 96px;[^}]*overflow-y: auto/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.mission-exit, \.mission-enter \{ animation: none/);
});
