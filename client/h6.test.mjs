// Socket-free H6 regression checks: node --test client/h6.test.mjs
// Browser gestures, installation and visual checks remain in CHECKLIST.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import * as game from "../server/domain.js";
import * as catalog from "../server/catalog.js";

const sources = Object.fromEntries(await Promise.all(["Child.jsx", "Parent.jsx", "App.jsx"].map(async (name) => {
  const extra = { "Child.jsx": "Home, ProfileSheet, Friends, DressSheet, BudgetSheet, TalkBar, useMapleTalk, SpeechBubble, Album", "Parent.jsx": "Children, AppleCashTracking", "App.jsx": "AuthScreen" }[name];
  const result = await build({
    stdin: { contents: await readFile(new URL(`src/${name}`, import.meta.url), "utf8") + (extra ? `\nexport { ${extra} };` : ""), resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
    bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" },
  });
  return [name, result.outputFiles[0].text];
})));

function harness(name, { controller = null, session = new Map() } = {}) {
  const slots = [], pending = [], timers = [], intervalDelays = [], timeouts = [], notices = [], streams = [];
  const storage = new Map();
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
    setInterval: (fn, ms) => { timers.push(fn); intervalDelays.push(ms); return timers.length; }, clearInterval: (id) => { timers[id - 1] = null; }, setTimeout: (fn, ms) => { timeouts.push(fn); return timeouts.length; }, clearTimeout: (id) => { timeouts[id - 1] = null; },
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
const text = (tree) => typeof tree === "string" || typeof tree === "number" ? String(tree) : (tree?.props?.children || []).map(text).join(" ");
const byText = (tree, label) => nodes(tree, (n) => n.type === "button" && text(n).replace(/\s+/g, " ").trim().includes(label))[0];
const noop = () => {};
const submit = { preventDefault() {} };
function stateFixture() {
  const db = seed(Date.now());
  return { ...db, goals: db.savingsGoals, balances: { savings: 2000, spending: 1000 }, chat: [], plan: null,
    catalog: { places: Object.fromEntries(Object.entries(catalog.PLACES).map(([id, p]) => [id, { ...p, open: true, image: `/postcards/${id}.png` }])), home: catalog.HOME, lessons: catalog.LESSONS, points: catalog.POINTS, milestones: catalog.MILESTONES, cosmetics: catalog.COSMETICS, greetings: game.GREETINGS },
    integrations: { voice: "browser", buddy: "offline" }, pendingRequests: [] };
}

const normalized = (tree) => text(tree).replace(/\s+/g, " ").trim();
const component = (tree, name) => nodes(tree, (n) => n.type?.name === name)[0];
const change = (node, value) => node.props.onChange({ target: { value } });
const summary = { id: "kid-one", name: "Mia", age: 9, bearName: "Maple", friendCode: "BCDF3467", friends: [] };
const me = { family: { id: "family-one", pinSet: true }, children: [summary] };
const settle = () => new Promise(setImmediate);

function home(h, state, talk) {
  return h.render(h.exports.Home, { state, talk, open: noop, setTab: noop });
}
const tick = (h, ms = 1000) => { h.now += ms; h.timers.filter(Boolean).forEach((timer) => timer()); };

test("H6.1 countdown span updates in place without remounting or restarting speech", () => {
  const h = harness("Child.jsx"), state = stateFixture(), bubble = harness("Child.jsx");
  state.adventures = [{ id: "trip", status: "away", returnsAt: h.now + 62000 }];
  const talk = { bubble: "trip", bubbleId: 7, tripId: "trip", dismiss: noop };
  let tree = home(h, state, talk); h.flush();
  const first = component(tree, "SpeechBubble");
  let markup = bubble.render(bubble.exports.SpeechBubble, first.props); bubble.flush();
  assert.match(normalized(markup), /Maple is on a trip!.*Back in 1:02/);
  const span = nodes(markup, (n) => n.props.className === "trip-countdown")[0];
  for (let i = 0; i < 3; i++) {
    tick(h); tree = home(h, state, talk); h.flush();
    const next = component(tree, "SpeechBubble");
    assert.equal(next.props.key, first.props.key);
    assert.equal(next.props.text, first.props.text);
    markup = bubble.render(bubble.exports.SpeechBubble, next.props); bubble.flush();
    const updated = nodes(markup, (n) => n.props.className === "trip-countdown")[0];
    assert.equal(updated.type, span.type);
    assert.equal(updated.props.key, span.props.key);
    assert.notEqual(text(updated), text(span));
    assert.equal(bubble.timers.length, 0, "countdown never starts the typewriter");
  }
  const regular = harness("Child.jsx");
  regular.render(regular.exports.SpeechBubble, { text: "Hello Mia", countdownText: "Back in 1:02" }); regular.flush();
  regular.render(regular.exports.SpeechBubble, { text: "Hello Mia", countdownText: "Back in 1:01" }); regular.flush();
  assert.equal(regular.timers.length, 1, "a time update cannot restart an active typewriter");
});

test("H6.1 zero waits at most five seconds, refreshes once and clears on return", () => {
  const h = harness("Child.jsx"), state = stateFixture(), chat = harness("Child.jsx");
  state.adventures = [{ id: "trip", status: "away", returnsAt: h.now + 1000 }];
  const talk = () => chat.render(chat.exports.useMapleTalk, { state });
  talk(); chat.flush(); talk().open();
  let refreshes = 0;
  h.window.addEventListener("mq:changed", () => refreshes++);
  home(h, state, talk()); h.flush();
  tick(h, 1000);
  let tree = home(h, state, talk()); h.flush();
  assert.equal(component(tree, "SpeechBubble").props.countdownText, "Any second now…");
  tick(h, 4999); tree = home(h, state, talk()); h.flush();
  assert.ok(component(tree, "SpeechBubble")); assert.equal(refreshes, 0);
  tick(h, 1); tree = home(h, state, talk()); h.flush();
  assert.equal(component(tree, "SpeechBubble"), undefined); assert.equal(refreshes, 1);
  tick(h); home(h, state, talk()); h.flush(); assert.equal(refreshes, 1);
  state.adventures = [{ ...state.adventures[0], status: "returned" }];
  assert.equal(component(home(h, state, talk()), "SpeechBubble"), undefined, "no stale trip bubble on the first return render");
  chat.flush(); assert.equal(talk().bubble, "");
  assert.equal(nodes(home(h, state, talk()), (n) => n.type?.name === "BearFigure").length, 1);
});

test("H6.1 Home never draws an away bear after open talk departure or a mid-trip reload", () => {
  for (const reload of [false, true]) {
    const h = harness("Child.jsx"), chat = harness("Child.jsx"), state = stateFixture();
    const talk = () => chat.render(chat.exports.useMapleTalk, { state });
    if (!reload) { talk(); chat.flush(); talk().open(); assert.equal(talk().isOpen, true); home(h, state, talk()); h.flush(); }
    state.adventures = [{ id: "trip", status: "away", returnsAt: h.now + 60000 }];
    for (const withBubble of [false, true]) {
      talk(); chat.flush(); if (withBubble) talk().open();
      const tree = home(h, state, talk()); h.flush();
      assert.equal(nodes(tree, (n) => n.type?.name === "BearFigure").length, 0);
      assert.equal(nodes(tree, (n) => n.props.className === "trip-sign").length, 1);
      assert.equal(Boolean(component(tree, "SpeechBubble")), withBubble);
    }
  }
});

test("H6.2 note shows family-time Updated and pending state; current goal changes in the same refresh", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  state.settings.timezone = "Pacific/Honolulu";
  const goal = state.goals.find((g) => g.id === state.child.currentGoalId);
  state.plan = { summary: "A little closer!", steps: ["Old step"], goalId: goal.id, updatedAt: Date.UTC(2026, 9, 25, 6, 5) };
  const note = () => nodes(home(h, state), (n) => n.props.className === "paper-card note-card")[0];
  assert.match(normalized(note()), /A little closer!.*Updated 8:05 PM/);
  assert.doesNotMatch(normalized(note()), /Thinking/);
  state.planPending = true;
  assert.match(normalized(note()), /Thinking of a new tip…/);
  state.goals.push({ id: "new-goal", title: "Skates", target: 5000, status: "active" }); state.child.currentGoalId = "new-goal";
  assert.match(normalized(note()), /Now saving for Skates/);
  assert.doesNotMatch(normalized(note()), /A little closer|Old step/);
  state.plan = { summary: "Save for Skates!", goalId: "new-goal", updatedAt: Date.UTC(2026, 9, 25, 6, 6) }; state.planPending = false;
  assert.match(normalized(note()), /Save for Skates!.*Updated 8:06 PM/);
  assert.doesNotMatch(normalized(note()), /Thinking/);
});

test("H6.3 Apple Cash card contains status, private token controls and help link without instructions", async () => {
  const h = harness("Parent.jsx"), calls = [], copies = [];
  h.navigator.clipboard = { writeText: async (value) => copies.push(value) };
  const props = { childId: "kid-two", pinSet: true, refreshKey: 1 };
  const render = () => h.render(h.exports.AppleCashTracking, props);
  h.fetch = async (url, options) => {
    calls.push([url, options]);
    return new Response(JSON.stringify(options.method === "DELETE" ? {} : { id: "device-two", token: options.method === "POST" ? "private-token" : null, lastPing: h.now, connected: true, expiresAt: h.now + 86400000 }));
  };
  assert.match(normalized(render()), /Not connected/); h.flush(); await settle();
  assert.match(normalized(render()), /Connected.*Last ping/);
  await byText(render(), "Rotate Shortcut token").props.onClick();
  assert.equal(nodes(render(), (n) => n.type === "input")[0].props.value, "private-token");
  await byText(render(), "Copy token").props.onClick(); assert.deepEqual(copies, ["private-token"]);
  const link = nodes(render(), (n) => n.type === "a")[0];
  assert.equal(text(link), "How to connect the iPhone Shortcut"); assert.equal(link.props.href, "/help/apple-cash");
  assert.equal(nodes(render(), (n) => ["ol", "pre", "code"].includes(n.type)).length, 0);
  assert.doesNotMatch(normalized(render()), /Get Contents|JSON|external_id|Authorization|Run Immediately/);
  assert.ok(![...h.storage.values(), ...h.session.values()].some((value) => value.includes("private-token")));
  await byText(render(), "Unlink").props.onClick();
  assert.equal(calls.at(-1)[0], "/api/parent/children/kid-two/devices/device-two?child=kid-two"); assert.equal(calls.at(-1)[1].method, "DELETE");
  assert.match(normalized(render()), /Not connected/); assert.equal(nodes(render(), (n) => n.type === "input").length, 0);
});

test("H6.4 Create family adds, removes and caps child rows and sends ordered numeric ages", async () => {
  const h = harness("App.jsx"), calls = [], sessions = [];
  const render = () => h.render(h.exports.AuthScreen, { screen: "create", onSession: (value) => sessions.push(value) });
  h.fetch = async (url, options) => { calls.push([url, JSON.parse(options.body)]); return new Response(JSON.stringify(me)); };
  const rows = () => nodes(render(), (n) => n.type === "fieldset");
  assert.equal(rows().length, 1);
  for (let i = 0; i < 3; i++) byText(render(), "Add another child").props.onClick();
  assert.equal(rows().length, 4); assert.equal(byText(render(), "Add another child").props.disabled, true);
  byText(render(), "Remove child 2").props.onClick(); assert.equal(rows().length, 3);
  byText(render(), "Add another child").props.onClick(); assert.equal(rows().length, 4);
  for (let i = 0; i < 4; i++) {
    const inputs = nodes(rows()[i], (n) => n.type === "input" || n.type === "select");
    for (const [j, value] of [`Kid ${i}`, String(7 + i), `Bear ${i}`].entries()) change(inputs[j], value);
  }
  for (const [label, value] of [["Your name", "Jordan"], ["Email", "parent@test.test"], ["Password", "good-password"]]) {
    const row = nodes(render(), (n) => n.type === "label" && text(n).startsWith(label))[0]; change(nodes(row, (n) => n.type === "input")[0], value);
  }
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(calls[0][0], "/api/auth/register");
  assert.deepEqual(calls[0][1].children, Array.from({ length: 4 }, (_, i) => ({ name: `Kid ${i}`, age: 7 + i, bearName: `Bear ${i}` })));
  assert.equal(calls[0][1].parentName, "Jordan"); assert.equal(typeof calls[0][1].timezone, "string"); assert.equal(sessions.length, 1);
});

test("H6.4 Children puts the Add a child toggle before cards and retains failed drafts", async () => {
  const h = harness("Parent.jsx"); let succeed = false;
  const render = () => h.render(h.exports.Children, { me, refreshMe: async () => {}, run: async () => succeed ? {} : null });
  let tree = render(); assert.equal(nodes(tree, (n) => n.type === "form").length, 0);
  assert.ok(tree.props.children.indexOf(byText(tree, "Add a child")) < tree.props.children.indexOf(nodes(tree, (n) => n.props.className === "p-card child-card")[0]));
  byText(tree, "Add a child").props.onClick();
  change(nodes(render(), (n) => n.type === "input" && !n.props.readOnly)[0], "Leo");
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(nodes(render(), (n) => n.type === "input" && !n.props.readOnly)[0].props.value, "Leo");
  succeed = true; await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(nodes(render(), (n) => n.type === "form").length, 0);
});

test("H6.5 phone layout contract at 360 and 390px puts kid-code first without internal scrolling", async () => {
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  for (const width of [360, 390]) {
    const h = harness("Parent.jsx"); h.window.innerWidth = width;
    const tree = h.render(h.exports.Children, { me, refreshMe: async () => {} });
    const card = nodes(tree, (n) => n.props.className === "p-card child-card")[0];
    const sections = nodes(card, (n) => n.type === "section");
    assert.equal(sections[1].props["aria-label"], "Sign in on your child's device");
    assert.equal(byText(card, "Get a kid code").props.className, "pbtn primary kid-code-button");
    assert.ok(normalized(card).indexOf("Get a kid code") < normalized(card).indexOf("Friend code — for adding friends, not for signing in"));
    assert.match(css, /\.kid-code-button \{[^}]*display: block;[^}]*width: 100%;[^}]*min-height: 48px/);
    assert.match(css, /\.child-card \{[^}]*height: auto;[^}]*max-height: none;[^}]*overflow: visible/);
  }
});

test("H6.5 Welcome kid-code button describes how to ask a grown-up", () => {
  const h = harness("App.jsx");
  const tree = h.render(h.exports.AuthScreen, { screen: "welcome" });
  const button = byText(tree, "I have a kid code");
  const hint = nodes(tree, (n) => n.props.id === button.props["aria-describedby"])[0];
  assert.equal(normalized(hint), "Ask your grown-up for a 6-letter kid code (Parent → Kids)");
});

test("H6.3 late credential reads cannot undo a rotated token or its Unlink target", async () => {
  const h = harness("Parent.jsx"); let finishRead;
  const calls = [];
  h.fetch = async (url, options) => {
    calls.push([url, options.method]);
    if (options.method === "GET") return new Promise((resolve) => { finishRead = resolve; });
    return new Response(JSON.stringify({ id: "new-device", token: "new-token", lastPing: null, connected: false }));
  };
  const render = () => h.render(h.exports.AppleCashTracking, { childId: "kid-one", pinSet: true });
  render(); h.flush();
  await byText(render(), "Generate Shortcut token").props.onClick();
  finishRead(new Response(JSON.stringify({ id: "old-device", token: null, lastPing: h.now, connected: true })));
  await settle();
  assert.equal(nodes(render(), (n) => n.type === "input")[0].props.value, "new-token");
  assert.match(normalized(render()), /Not connected/);
  await byText(render(), "Unlink").props.onClick();
  assert.equal(calls.at(-1)[0], "/api/parent/children/kid-one/devices/new-device?child=kid-one");
});
