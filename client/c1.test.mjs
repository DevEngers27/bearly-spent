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

const sources = Object.fromEntries(await Promise.all(["api.js", "Child.jsx", "Parent.jsx", "App.jsx"].map(async (name) => {
  const extra = { "Child.jsx": "speak, Home, MoneySheet, LessonSheet, Missions, Buddy, MapScreen, MapView, Friends, DressSheet, BudgetSheet, PlaceSheet, TalkBar, useMapleTalk, SpeechBubble, ReturnReveal, Album, countdown, BearFigure, FlipPostcard, PostcardTile", "Parent.jsx": "Overview, Goals, SavingsGoal, Allowance, Activity, Inbox, Guardian, Settings, Children, Security, BuddyLog, Devices, WalletLedger, AppleCashTracking", "App.jsx": "PinGate, Loading, AuthScreen, ChildRoot, ParentRoot, setSelectedChild" }[name];
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

test("C13 / M16: shared action guard blocks same-tick duplicates and unlocks after success or failure", async () => {
  const h = harness("api.js");
  let resolve, calls = 0;
  h.fetch = () => { calls++; return new Promise((r) => { resolve = r; }); };
  const [run] = h.render(() => h.exports.useAction(h.toast));
  const first = run("child/save", { amount: 1 });
  assert.equal(await run("child/save", { amount: 1 }), null);
  assert.equal(h.render(() => h.exports.useAction(h.toast))[1], true);
  assert.equal(calls, 1);
  resolve(new Response("{}"));
  await first;
  assert.equal(h.render(() => h.exports.useAction(h.toast))[1], false);
  h.fetch = async () => { throw new Error("Try again"); };
  assert.equal(await run("child/save", {}), null);
  assert.equal(h.render(() => h.exports.useAction(h.toast))[1], false);
});

test("C6 / B5b: 401 clears cached identity and emits unauthorized before the response body arrives", async () => {
  const h = harness("api.js");
  h.storage.set("mq_last_state", "private snapshot");
  h.storage.set("mq_child_session", "cached identity");
  let events = 0, finish;
  h.window.addEventListener("mq:unauthorized", () => events++);
  h.fetch = async () => ({ status: 401, ok: false, json: () => new Promise((r) => { finish = r; }) });
  const request = h.exports.api("parent/topup", {});
  await new Promise(setImmediate);
  assert.equal(events, 1);
  assert.equal(h.storage.has("mq_last_state"), false);
  assert.equal(h.storage.has("mq_child_session"), false);
  finish({ error: "Sign in again" });
  await assert.rejects(request, { status: 401 });
});

test("C1: child snapshot survives a failed refresh; offline actions send no request", async () => {
  const h = harness("api.js"), state = stateFixture();
  h.fetch = async () => new Response(JSON.stringify(state));
  await h.exports.api("state");
  assert.equal(JSON.parse(h.storage.get("mq_last_state")).child.name, state.child.name);
  h.fetch = async () => { throw new Error("Offline"); };
  await h.render(() => h.exports.useLiveState("child")).refresh();
  const cached = h.render(() => h.exports.useLiveState("child"));
  assert.equal(cached.offline, true);
  assert.equal(cached.state.child.name, state.child.name);
  const offline = harness("api.js");
  let calls = 0;
  offline.fetch = async () => { calls++; };
  await offline.render(() => offline.exports.useAction(offline.toast, true))[0]("child/save", {});
  assert.equal(calls, 0);
  assert.equal(offline.notices[0][0], "You're offline — your postcards are still here!");
  h.fetch = async () => new Response(JSON.stringify(state));
  await cached.refresh();
  assert.equal(h.render(() => h.exports.useLiveState("child")).offline, false);
});

test("C12 / C8: Sheet keeps input focus across renders, traps both Tab directions and restores the opener", () => {
  const h = harness("Child.jsx");
  let focused = 0, closed = 0, prevented = 0;
  const opener = { focus: () => focused++ };
  h.document.activeElement = opener;
  const control = () => ({ tabIndex: 0, focus() { h.document.activeElement = this; }, getClientRects: () => [1] });
  const first = control(), last = control();
  const section = { focus() { focused++; h.document.activeElement = this; }, querySelectorAll: () => [first, last] };
  let tree = h.render(h.exports.Sheet, { title: "Money", onClose: () => { closed = 1; } });
  nodes(tree, (n) => n.type === "section")[0].props.ref.current = section;
  h.flush();
  h.document.activeElement = last;
  tree = h.render(h.exports.Sheet, { title: "Money", onClose: () => { closed = 2; } });
  h.flush();
  assert.equal(focused, 1);
  assert.equal(h.document.activeElement, last);
  const key = (value, shiftKey = false) => {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key: value, shiftKey });
    h.window.dispatchEvent(event);
    if (event.defaultPrevented) prevented++;
  };
  key("Tab"); assert.equal(h.document.activeElement, first);
  key("Tab", true); assert.equal(h.document.activeElement, last);
  assert.equal(prevented, 2);
  key("Escape"); assert.equal(closed, 2);
  h.slots.find((s) => s?.cleanup)?.cleanup();
  assert.equal(focused, 2);
});

test("C9 / C8: saving three times preserves the amount and the label targets the input", async () => {
  const h = harness("Child.jsx");
  const amounts = [];
  const props = { state: stateFixture(), run: async (path, body) => { amounts.push(body.amount); return {}; }, close: noop };
  for (let i = 0; i < 3; i++) {
    const tree = h.render(h.exports.MoneySheet, props);
    await nodes(tree, (n) => n.type === "form")[0].props.onSubmit(submit);
    assert.equal(nodes(tree, (n) => n.type === "input" && n.props.id === "money-amount")[0].props.value, "2");
    assert.equal(nodes(tree, (n) => n.type === "label" && n.props.htmlFor === "money-amount").length, 1);
  }
  assert.deepEqual(amounts, [2, 2, 2]);
});

test("C5: childView budget flag agrees with completeBudget; completed checklist hides its points", async () => {
  const db = seed(Date.now());
  assert.equal(childView(db).budgetDoneThisWeek, false);
  game.completeBudget(db, { save: 500, needs: 800, fun: 500, give: 200 });
  assert.equal(childView(db).budgetDoneThisWeek, true);
  const h = harness("Child.jsx"), state = stateFixture();
  state.weekKey = db.child.lastBudgetWeek;
  state.child.lastBudgetWeek = db.child.lastBudgetWeek;
  const tree = h.render(h.exports.Missions, { state, open: noop });
  const button = byText(tree, "Weekly budget challenge");
  assert.equal(button.props.disabled, false);
  assert.doesNotMatch(text(button), /\+50/);
});

test("Lesson replay copy and failed final submission retry use the original answer count", async () => {
  const h = harness("Child.jsx"), lesson = catalog.LESSONS[0];
  let attempts = 0;
  const props = { lesson, state: stateFixture(), close: noop, run: async (path, body) => {
    assert.equal(body.answers.length, 4);
    return ++attempts === 1 ? null : { correct: body.answers.length, total: body.answers.length, passed: true, firstTime: false };
  } };
  for (let i = 0; i < 5; i++) {
    const tree = h.render(h.exports.LessonSheet, props);
    await nodes(tree, (n) => n.type === "button")[0].props.onClick();
  }
  const result = h.render(h.exports.LessonSheet, props);
  assert.match(text(result), /Nice review! No extra points for repeats\./);
  assert.doesNotMatch(text(result), /\+20/);
});

test("C7 / C16: empty goals render friendly cards and an unknown stored tab opens Home", () => {
  const state = stateFixture(); state.goals = [];
  for (const [file, name] of [["Child.jsx", "Home"], ["Child.jsx", "Buddy"], ["Parent.jsx", "Overview"], ["Parent.jsx", "SavingsGoal"]]) {
    const h = harness(file);
    assert.match(text(h.render(h.exports[name], { state })), /Set a savings goal/);
  }
  const h = harness("Child.jsx"); h.storage.set("mq_tab", "unknown-tab");
  const tree = h.render(h.exports.default, { state, toast: noop });
  assert.equal(nodes(tree, (n) => n.type?.name === "Home").length, 1);
});

test("C4: parent form keys change only with their server-backed editable values", () => {
  const h = harness("Parent.jsx"), state = stateFixture();
  const getSection = (section) => {
    let tree = h.render(h.exports.default, { state, toast: noop });
    byText(tree, section).props.onClick();
    tree = h.render(h.exports.default, { state, toast: noop });
    return nodes(tree, (n) => n.type?.name === (section === "Allowance" ? "Allowance" : "Goals"))[0];
  };
  const goal = getSection("Goals & tasks");
  state.goals[0] = { ...state.goals[0], title: "Skates", target: 6000 };
  assert.equal(getSection("Goals & tasks").props.key, goal.props.key, "reward draft must not remount with savings changes");
  const goals = harness("Parent.jsx");
  const savings = () => nodes(goals.render(goals.exports.Goals, { state }), (n) => n.type?.name === "SavingsGoal")[0];
  const savingsKey = savings().props.key;
  state.goals[0] = { ...state.goals[0], target: 8000 };
  assert.notEqual(savings().props.key, savingsKey, "only the savings form remounts");
  const allowance = getSection("Allowance");
  state.allowance.nextRun++;
  assert.equal(getSection("Allowance").props.key, allowance.props.key);
  state.allowance.amount = 1500;
  assert.notEqual(getSection("Allowance").props.key, allowance.props.key);
});

function meFixture(role = "parent", pinSet = false) {
  return { role, family: { id: "family-one", name: "Jordan", pinSet }, unlockedUntil: 0,
    activeChild: { id: "child-one", name: "Mia", age: 9, bearName: "Maple" },
    children: [{ id: "child-one", name: "Mia", age: 9, bearName: "Maple" }, ...(role === "parent" ? [{ id: "child-two", name: "Leo", age: 8, bearName: "Pip" }] : [])] };
}
async function appHarness(me, options) {
  const h = harness("App.jsx", options);
  h.fetch = async () => new Response(JSON.stringify(me));
  h.render(h.exports.default); h.flush();
  await new Promise(setImmediate);
  h.tree = () => { const tree = h.render(h.exports.default); h.flush(); return tree; };
  return h;
}

test("S6 / B5b: parent kid mode requires PIN on return; a child session has no parent entry", async () => {
  const h = await appHarness(meFixture("parent", true));
  let tree = h.tree();
  assert.equal(nodes(tree, (n) => n.type?.name === "PinGate").length, 1);
  nodes(tree, (n) => n.type?.name === "PinGate")[0].props.onOk({ unlockedUntil: h.now + 900000 });
  tree = h.tree();
  await byText(tree, "Kid mode").props.onClick();
  tree = h.tree();
  nodes(tree, (n) => n.type?.name === "ChildRoot")[0].props.onGrownUps();
  tree = h.tree();
  assert.equal(nodes(tree, (n) => n.type?.name === "PinGate").length, 1);
  nodes(tree, (n) => n.type?.name === "PinGate")[0].props.onOk({ unlockedUntil: h.now + 900000 });
  await byText(h.tree(), "Lock").props.onClick();
  assert.equal(nodes(h.tree(), (n) => n.type?.name === "PinGate").length, 1);
  const kid = await appHarness(meFixture("child"));
  tree = kid.tree();
  assert.equal(nodes(tree, (n) => n.type?.name === "ParentRoot" || n.type?.name === "PinGate").length, 0);
  assert.equal(nodes(tree, (n) => n.type?.name === "ChildRoot")[0].props.onGrownUps, undefined);
  const child = harness("Child.jsx");
  assert.equal(nodes(child.render(child.exports.default, { state: stateFixture(), toast: noop }), (n) => n.props["aria-label"] === "Grown-ups").length, 0);
});

test("Map: auto-scroll is throttled to two seconds and pauses through a drag", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  state.adventures = [{ status: "away", destId: "seattle", startedAt: h.now, returnsAt: h.now + 60000 }];
  const props = { state, open: noop };
  let tree = h.render(h.exports.MapScreen, props), scrolls = 0;
  const frame = nodes(tree, (n) => n.props.className === "map-frame")[0];
  frame.props.ref.current = { scrollWidth: 1000, clientWidth: 400, scrollLeft: 0, getBoundingClientRect: () => ({ left: 0, width: 400 }), querySelector: () => ({ getBoundingClientRect: () => ({ left: 600, width: 40 }) }), scrollTo: () => scrolls++ };
  h.flush();
  const tick = (ms) => { h.now += ms; h.timers[0](); tree = h.render(h.exports.MapScreen, props); h.flush(); };
  tick(250); assert.equal(scrolls, 1);
  tick(1750); assert.equal(scrolls, 2);
  frame.props.onPointerDown(); tick(2500); assert.equal(scrolls, 2);
  frame.props.onPointerUp(); tick(1000); assert.equal(scrolls, 2);
  tick(1000); assert.equal(scrolls, 3);
  // Native touch panning cancels its pointer before the finger lifts.
  frame.props.onTouchStart(); frame.props.onPointerDown(); frame.props.onPointerCancel();
  tick(2500); assert.equal(scrolls, 3);
  frame.props.onTouchEnd({ touches: [] }); tick(2000); assert.equal(scrolls, 4);
});

async function worker() {
  const handlers = new Map(), entries = new Map(), trace = [], named = new Map();
  const origin = "https://moneyquest.test";
  const key = (request) => new URL(typeof request === "string" ? request : request.url, origin).href;
  const w = { trace, handlers, fetch: async () => new Response("asset"), entries };
  const cache = {
    match: async (request) => entries.get(key(request))?.clone(),
    put: async (request, response) => { entries.set(key(request), response.clone()); await response.arrayBuffer(); },
    add: async (request) => { const response = await w.fetch(request); if (!response.ok) throw new Error("Asset unavailable"); await cache.put(request, response); },
    addAll: async (requests) => { for (const request of requests) { const response = await w.fetch(request); assert.equal(response.ok, true); await cache.put(request, response); } },
  };
  named.set("mq-v3", cache); named.set("another-app", cache);
  vm.runInNewContext(await readFile(new URL("public/sw.js", import.meta.url), "utf8"), {
    self: { location: { origin }, addEventListener: (type, fn) => handlers.set(type, fn), skipWaiting: async () => {}, clients: { claim: async () => {} } },
    URL, fetch: (...args) => w.fetch(...args),
    caches: { open: async (name) => { trace.push("open"); named.set(name, cache); return cache; }, match: cache.match, keys: async () => [...named.keys()], delete: async (name) => named.delete(name) },
  });
  w.trigger = async (type, extra = {}) => {
    let promise;
    handlers.get(type)({ ...extra, waitUntil: (p) => { promise = p; }, respondWith: (p) => { promise = p; } });
    return promise;
  };
  w.request = (url, mode = "cors", method = "GET") => w.trigger("fetch", { request: { url: key(url), mode, method } });
  w.named = named;
  return w;
}

test("C3 / C14: first install precaches hashed JS, every stylesheet, manifest and icons", async () => {
  const w = await worker();
  w.fetch = async (request) => new Response(request === "/" ? '<script type="module" src="/assets/index-hash.js"></script><link href="/assets/index-hash.css" rel="stylesheet"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gaegu">' : "asset");
  await w.trigger("install");
  for (const asset of ["/", "/assets/index-hash.js", "/assets/index-hash.css", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png", "https://fonts.googleapis.com/css2?family=Gaegu"]) {
    assert.equal(w.entries.has(new URL(asset, "https://moneyquest.test").href), true, asset);
  }
  await w.trigger("activate");
  assert.equal(w.named.has("mq-v3"), false);
  assert.equal(w.named.has("another-app"), true);
});

test("C2 / C11: navigation clones before async cache work; 5xx never replaces the offline shell", async () => {
  const w = await worker();
  w.fetch = async () => {
    const response = new Response("good shell"), clone = response.clone.bind(response);
    response.clone = () => { w.trace.push("clone"); return clone(); };
    return response;
  };
  assert.equal(await (await w.request("/", "navigate")).text(), "good shell");
  assert.deepEqual(w.trace.slice(0, 2), ["clone", "open"]);
  w.fetch = async () => new Response("server error", { status: 503 });
  assert.equal((await w.request("/", "navigate")).status, 503);
  w.fetch = async () => { throw new Error("Offline"); };
  assert.equal(await (await w.request("/", "navigate")).text(), "good shell");
});

test("C1 / C3: static cache excludes failures and API; snapshot art warms without opening Album", async () => {
  const w = await worker();
  w.fetch = async () => new Response("missing", { status: 404 });
  assert.equal((await w.request("/missing.png")).status, 404);
  assert.equal(w.entries.size, 0);
  assert.equal(await w.request("/api/state"), undefined);
  assert.equal(await w.request("/postcards/chicago.png", "cors", "POST"), undefined);
  w.fetch = async () => new Response("postcard");
  await w.trigger("message", { data: { type: "mq:cache-art", images: ["/postcards/chicago.png", "/bear/w3/poses/bear_front.png", "/api/state", "https://other.test/postcards/test.png"] } });
  assert.equal(w.entries.size, 2);
  w.fetch = async () => { throw new Error("Offline"); };
  assert.equal(await (await w.request("/postcards/chicago.png")).text(), "postcard");
});

test("C13 / M16: all child and parent POST controls receive the shared busy state", () => {
  const state = stateFixture();
  state.missions = [{ id: "task", title: "A task", status: "open", createdBy: "parent", points: 40 }];
  state.chat = [{ id: "reply", role: "assistant", text: "Hello" }];
  state.child.points = 1000;
  const checks = [
    ["Child.jsx", "MoneySheet", {}, ["Save it"]],
    ["Child.jsx", "DressSheet", {}, ["Rename", "None", catalog.COSMETICS.find((c) => c.kind === "hat").label]],
    ["Child.jsx", "Missions", {}, ["A task"]],
    ["Child.jsx", "LessonSheet", { lesson: catalog.LESSONS[0] }, [catalog.LESSONS[0].questions[0].options[0]]],
    ["Child.jsx", "BudgetSheet", {}, ["Finish my budget"]],
    ["Child.jsx", "Home", {}, ["Send Maple on a trip"]],
    ["Child.jsx", "Friends", {}, ["Propose swap", game.GREETINGS[0], "Send"]],
    ["Child.jsx", "TalkBar", { talk: { close: noop, send: noop } }, ["Send", "Can I buy"]],
    ["Parent.jsx", "Inbox", { pending: [{ id: "a", kind: "reward", title: "Reward", amount: 500 }, { id: "b", kind: "topup", title: "Funding" }] }, ["Approve", "Decline", "Mark handled", "Add $50"]],
    ["Parent.jsx", "Goals", {}, ["Create goal", "Assign task"]],
    ["Parent.jsx", "SavingsGoal", {}, ["Update"]],
    ["Parent.jsx", "Allowance", {}, ["Save rules", "Add $50", "Fast-forward"]],
    ["Parent.jsx", "Guardian", {}, ["Post a duplicate"]],
    ["Parent.jsx", "Settings", {}, ["Reset demo"]],
    ["App.jsx", "PinGate", {}, ["Unlock"]],
  ];
  for (const [file, component, extra, buttons] of checks) {
    const h = harness(file);
    const render = () => h.render(h.exports[component], { state, busy: true, demo: true, run: noop, ...extra });
    let tree = render();
    if (component === "PinGate") {
      h.fetch = () => new Promise(() => {});
      nodes(tree, (n) => n.type === "form")[0].props.onSubmit(submit);
      tree = render();
    }
    for (const label of buttons) assert.equal(byText(tree, label)?.props.disabled, true, `${component}: ${label}`);
    if (component === "Settings") for (const toggle of nodes(tree, (n) => n.type === "input")) assert.equal(toggle.props.disabled, true);
  }
});

test("C8: regular and secret map pins activate on Space without scrolling", () => {
  const h = harness("Child.jsx"), state = stateFixture(), selected = [];
  const tree = h.render(h.exports.MapView, { places: state.catalog.places, home: state.catalog.home, owned: new Set(), onSelect: (id) => selected.push(id) });
  const pins = nodes(tree, (n) => n.props.role === "button");
  assert.ok(pins.length);
  let prevented = 0;
  for (const pin of pins) {
    pin.props.onKeyDown({ key: " ", preventDefault: () => prevented++ });
    pin.props.onKeyDown({ key: "Enter", preventDefault: () => prevented++ });
  }
  assert.equal(selected.length, pins.length * 2);
  assert.equal(prevented, pins.length * 2);
});

test("C16: return reveal replaces an open sheet and dismissing never reopens it", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  const props = { state, toast: noop };
  let tree = h.render(h.exports.default, props); h.flush();
  nodes(tree, (n) => n.props["aria-label"]?.includes("Open my money"))[0].props.onClick();
  tree = h.render(h.exports.default, props); h.flush();
  assert.equal(nodes(tree, (n) => n.type?.name === "SheetRouter").length, 1);
  state.adventures = [{ id: "return", status: "returned", returnedAt: h.now, postcardIds: [] }];
  tree = h.render(h.exports.default, props); h.flush();
  assert.equal(nodes(tree, (n) => n.type?.name === "SheetRouter").length, 0);
  nodes(tree, (n) => n.type?.name === "ReturnReveal")[0].props.onSeen();
  tree = h.render(h.exports.default, props); h.flush();
  assert.equal(nodes(tree, (n) => n.type?.name === "SheetRouter").length, 0);
});

test("C6 / C16 / C3: App returns to Welcome on unauthorized; controllerchange offers explicit reload", async () => {
  const h = await appHarness(meFixture(), { controller: {} });
  let tree = h.tree();
  h.window.dispatchEvent(new Event("mq:unauthorized"));
  tree = h.render(h.exports.default); h.flush();
  assert.equal(nodes(tree, (n) => n.type?.name === "AuthScreen")[0].props.screen, "welcome");
  let reloads = 0;
  h.location.reload = () => reloads++;
  // Nobody is typing: a new build reloads by itself (new art may live under new paths).
  h.navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
  tree = h.render(h.exports.default); h.flush();
  assert.equal(byText(tree, "Updated! Tap to reload"), undefined);
  const scheduled = h.timeouts.filter(Boolean); assert.equal(scheduled.length >= 1, true);
  scheduled.at(-1)(); assert.equal(reloads, 1);
  // While the kid is typing, the update waits behind an explicit button.
  h.document.activeElement = { tagName: "INPUT" };
  h.navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
  tree = h.render(h.exports.default); h.flush();
  byText(tree, "Updated! Tap to reload").props.onClick();
  assert.equal(reloads, 2);
  h.document.activeElement = null;
  const loading = h.render(h.exports.Loading, { error: new Error("Failed to fetch") });
  assert.match(text(loading), /Can't reach MoneyQuest right now\. Check your connection and try again\./);
  assert.ok(byText(loading, "Try again"));
});

// Wave 2 account integration: exercise real event handlers without sockets.
test("B5b: cookies and selected child reach actions, state, chat cursors and audio; public login has no child query", async () => {
  const h = harness("api.js"), requests = [];
  h.fetch = async (url, options) => { requests.push({ url, options }); return new Response("{}"); };
  h.exports.setSelectedChild("child two");
  for (const [path, body] of [["state"], ["parent/goal", { title: "Read" }], ["parent/state?before=msg-1"], ["auth/me"], ["auth/login", { email: "a@b.test", password: "password" }]]) await h.exports.api(path, body);
  for (const { url, options } of requests) {
    assert.equal(options.credentials, "same-origin");
    assert.deepEqual(Object.keys(options.headers), ["Content-Type"]);
    assert.equal(new URL(url, h.location).searchParams.get("child"), url.includes("/auth/login") ? null : "child two");
  }
  assert.equal(new URL(requests[2].url, h.location).searchParams.get("before"), "msg-1");
  assert.equal(h.session.size, 0);
});

test("B5b: parent 423 and locked 403 open unlock; child-access 403 does not; 429 preserves the server copy", async () => {
  const h = harness("api.js");
  let locks = 0, message;
  h.window.addEventListener("mq:locked", () => locks++);
  h.window.addEventListener("mq:rate-limit", (event) => { message = event.message; });
  for (const [status, error] of [[423, "Locked"], [403, "Please unlock parent mode"], [403, "A grown-up needs to sign in"], [429, "Let's take a little break. Try again soon!"]]) {
    h.fetch = async () => new Response(JSON.stringify({ error }), { status });
    await assert.rejects(h.exports.api("parent/state"), { status, message: error });
  }
  assert.equal(locks, 2);
  assert.equal(message, "Let's take a little break. Try again soon!");
});

test("B5b: SSE uses selected child, ignores siblings, and rechecks auth on disconnect", async () => {
  const h = harness("api.js"), requests = [];
  h.exports.setSelectedChild("child-one");
  h.fetch = async (url) => { requests.push(url); return new Response(JSON.stringify(stateFixture())); };
  h.render(() => h.exports.useLiveState("child", "child-one")); h.flush();
  await new Promise(setImmediate);
  const stream = h.streams[0];
  assert.equal(stream.url, "/api/stream?child=child-one");
  const initial = requests.length;
  stream.onmessage({ data: JSON.stringify({ childId: "sibling", version: 5 }) });
  assert.equal(requests.length, initial);
  stream.onmessage({ data: JSON.stringify({ childId: "child-one", version: 5 }) });
  await new Promise(setImmediate);
  assert.equal(requests.length, initial + 1);
  stream.onerror();
  await new Promise(setImmediate);
  assert.equal(requests.at(-1), "/api/auth/me?child=child-one");
  h.slots.filter((slot) => slot?.cleanup).forEach((slot) => slot.cleanup());
  assert.equal(stream.closed, true);
});

test("B5b: stale state cannot repopulate the cache after sign-out or a child switch", async () => {
  const h = harness("api.js");
  let finish;
  h.exports.setSelectedChild("child-one");
  h.fetch = () => new Promise((resolve) => { finish = resolve; });
  const request = h.exports.api("state");
  h.exports.clearSessionCache();
  finish(new Response(JSON.stringify({ ...stateFixture(), childId: "child-one" })));
  await request;
  assert.equal(h.storage.has("mq_last_state"), false);
});

function changeField(tree, label, value) {
  const container = nodes(tree, (n) => n.type === "label" && text(n).startsWith(label))[0];
  nodes(container, (n) => n.type === "input" || n.type === "select")[0].props.onChange({ target: { value } });
}

test("B5b: create-family and sign-in submit the contract fields and use the returned role", async () => {
  for (const screen of ["create", "signin"]) {
    const h = harness("App.jsx"), calls = [], sessions = [];
    const props = { screen, navigate: noop, onSession: (me) => sessions.push(me), toast: noop };
    const render = () => h.render(h.exports.AuthScreen, props);
    h.fetch = async (url, options) => { calls.push([url, JSON.parse(options.body)]); return new Response(JSON.stringify(meFixture())); };
    for (const [label, value] of [["Email", "parent@test.com"], ["Password", "a password"], ...(screen === "create" ? [["Your name", "Jordan"], ["Child's name", "Mia"], ["Age", "10"], ["Bear's name", "Maple"]] : [])]) changeField(render(), label, value);
    nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
    await new Promise(setImmediate);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], screen === "create" ? "/api/auth/register" : "/api/auth/login");
    const body = calls[0][1];
    assert.equal(body.email, "parent@test.com");
    assert.equal(body.password, "a password");
    if (screen === "create") {
      assert.equal(body.children[0].age, 10);
      assert.equal(body.parentName, "Jordan");
      assert.equal(body.children[0].name, "Mia");
      assert.equal(body.children[0].bearName, "Maple");
      assert.equal(typeof body.timezone, "string");
      assert.equal("code" in body, false);
    }
    assert.equal(sessions[0].role, "parent");
  }
});

test("B5b: kid code accepts typing, big keys and delete, then opens only the child session", async () => {
  const h = harness("App.jsx"), sessions = [], requests = [];
  const props = { screen: "link", navigate: noop, onSession: (me) => sessions.push(me), toast: noop };
  const render = () => h.render(h.exports.AuthScreen, props);
  h.fetch = async (url, options) => { requests.push([url, JSON.parse(options.body)]); return new Response(JSON.stringify(meFixture("child"))); };
  changeField(render(), "Kid code", " bc34 ");
  byText(render(), "Delete").props.onClick();
  byText(render(), "6").props.onClick();
  byText(render(), "7").props.onClick();
  byText(render(), "8").props.onClick();
  assert.equal(nodes(render(), (n) => n.type === "input")[0].props.value, "BC3678");
  nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  await new Promise(setImmediate);
  assert.deepEqual(requests, [["/api/auth/link", { code: "BC3678" }]]);
  assert.equal(sessions[0].role, "child");
});

test("B5b: demo button appears only with availability and calls demo/login", async () => {
  const h = harness("App.jsx"), requests = [];
  const props = { screen: "welcome", navigate: noop, onSession: noop, toast: noop };
  assert.equal(byText(h.render(h.exports.AuthScreen, props), "Try the demo family"), undefined);
  h.fetch = async (url) => { requests.push(url); return new Response(JSON.stringify(meFixture())); };
  const tree = h.render(h.exports.AuthScreen, { ...props, demo: true });
  byText(tree, "Try the demo family").props.onClick();
  await new Promise(setImmediate);
  assert.deepEqual(requests, ["/api/demo/login"]);
});

test("B5b: a parent without a PIN returns directly with a Security nudge; switching children remounts its view", async () => {
  const h = await appHarness(meFixture());
  let tree = h.tree();
  const old = nodes(tree, (n) => n.type?.name === "ParentRoot")[0];
  nodes(tree, (n) => n.type === "select")[0].props.onChange({ target: { value: "child-two" } });
  tree = h.tree();
  const next = nodes(tree, (n) => n.type?.name === "ParentRoot")[0];
  assert.notEqual(old.props.key, next.props.key);
  assert.equal(next.props.childId, "child-two");
  assert.equal(h.storage.get("mq_selected_child"), "child-two");
  byText(tree, "Kid mode").props.onClick();
  nodes(h.tree(), (n) => n.type?.name === "ChildRoot")[0].props.onGrownUps();
  tree = h.tree();
  assert.equal(nodes(tree, (n) => n.type?.name === "PinGate").length, 0);
  assert.ok(byText(tree, "Kid mode"));
  assert.match(text(tree), /Set a PIN in Security/);
});

test("B5b: lock events open a PIN sheet for parents and 429 becomes a toast", async () => {
  const h = await appHarness(meFixture());
  h.tree();
  h.window.dispatchEvent(new Event("mq:locked"));
  assert.equal(nodes(h.tree(), (n) => n.type?.name === "PinGate").length, 1);
  const event = new Event("mq:rate-limit"); event.message = "Please wait a little";
  h.window.dispatchEvent(event);
  assert.match(text(h.tree()), /Please wait a little/);
});

test("B5b: PIN sheet sends parent/unlock and preserves the returned deadline", async () => {
  const h = harness("App.jsx"), calls = [], results = [];
  const props = { onOk: (result) => results.push(result), onCancel: noop };
  const render = () => h.render(h.exports.PinGate, props);
  h.fetch = async (url, options) => { calls.push([url, JSON.parse(options.body)]); return new Response(JSON.stringify({ ok: true, unlockedUntil: 1234 })); };
  changeField(render(), "Parent PIN", "5678");
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.deepEqual(calls, [["/api/parent/unlock", { pin: "5678" }]]);
  assert.equal(results[0].unlockedUntil, 1234);
  assert.doesNotMatch(text(render()), /1234|demo PIN/i);
});

test("B5b: child-only offline reload requires a matching cached child; 401 never falls back", async () => {
  for (const [role, status, matching, expected] of [["child", null, true, true], ["parent", null, true, false], ["child", null, false, false], ["child", 401, true, false]]) {
    const h = harness("App.jsx"), me = meFixture(role);
    h.storage.set("mq_child_session", JSON.stringify(me));
    h.storage.set("mq_last_state", JSON.stringify({ ...stateFixture(), childId: matching ? "child-one" : "another-child" }));
    h.fetch = async () => { if (status) return new Response('{"error":"Sign in"}', { status }); throw new Error("Offline"); };
    h.render(h.exports.default); h.flush();
    await new Promise(setImmediate);
    const tree = h.render(h.exports.default); h.flush();
    assert.equal(nodes(tree, (n) => n.type?.name === "ChildRoot").length > 0, expected);
    if (status === 401) assert.equal(h.storage.has("mq_last_state"), false);
  }
});

test("B5b: sign-out posts cookie logout and returns to Welcome with no cached identity", async () => {
  const h = await appHarness(meFixture()), calls = [];
  h.storage.set("mq_last_state", JSON.stringify(stateFixture()));
  h.fetch = async (url, options) => { calls.push([url, options]); return new Response("{}"); };
  await nodes(h.tree(), (n) => n.type?.name === "ParentRoot")[0].props.onSignOut();
  const tree = h.tree();
  assert.equal(new URL(calls[0][0], h.location).pathname, "/api/auth/logout");
  assert.equal(calls[0][1].credentials, "same-origin");
  assert.equal(nodes(tree, (n) => n.type?.name === "AuthScreen")[0].props.screen, "welcome");
  assert.equal(h.storage.has("mq_child_session"), false);
  assert.equal(h.storage.has("mq_last_state"), false);
});

test("B5b: Children pairs the path child consistently, counts down expiry, and adds a zero-start saver", async () => {
  const h = harness("Parent.jsx"), requests = [];
  let refreshed = 0;
  const props = { me: meFixture(), refreshMe: async () => { refreshed++; }, run: async (action, body) => typeof action === "function" ? action() : h.exports.api?.(action, body) };
  h.fetch = async (url, options) => {
    requests.push([url, JSON.parse(options.body)]);
    return new Response(JSON.stringify(url.includes("/link") ? { code: "BC3467", expiresAt: h.now + 900000 } : { id: "new-child" }));
  };
  const render = () => h.render(h.exports.Children, props);
  let tree = render(); h.flush();
  await nodes(tree, (n) => n.type === "button" && text(n).includes("Get a kid code"))[1].props.onClick();
  tree = render();
  assert.equal(requests[0][0], "/api/parent/children/child-two/link?child=child-two");
  assert.match(text(tree), /Expires in\s+15\s*:\s*00/);
  assert.equal(nodes(tree, (n) => n.type === "input" && n.props.readOnly)[0].props.value, "BC3467");
  h.now += 900001; h.timers[0]();
  assert.match(text(render()), /This code expired/);
  byText(render(), "Add a child").props.onClick();
  for (const [label, value] of [["Child's name", "Leo"], ["Age", "8"], ["Bear's name", "Pip"]]) changeField(render(), label, value);
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.deepEqual(requests[1], ["/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" }]);
  assert.equal(refreshed, 1);
});

test("B5b: Security sets or changes PIN and offers global sign-out", async () => {
  for (const pinSet of [false, true]) {
    const h = harness("Parent.jsx"), requests = [];
    let refreshed = 0;
    const props = { me: meFixture("parent", pinSet), refreshMe: async () => { refreshed++; }, run: async (action) => action(), onSignOut: noop };
    const render = () => h.render(h.exports.Security, props);
    h.fetch = async (url, options) => { requests.push([url, JSON.parse(options.body)]); return new Response('{"ok":true,"unlockedUntil":1234}'); };
    changeField(render(), "New PIN", "5678");
    await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
    assert.deepEqual(requests, [["/api/parent/pin", { pin: "5678" }]]);
    assert.equal(refreshed, 1);
    assert.notEqual(byText(render(), "Sign out everywhere").props.disabled, true);
    assert.equal(byText(render(), "Confirm sign out everywhere"), undefined);
  }
});

test("B5b: Buddy chats load exclusive older pages without duplicate live messages", async () => {
  const h = harness("Parent.jsx"), requests = [], state = stateFixture();
  state.chat = [{ id: "new", role: "user", text: "New question" }];
  state.chatNextBefore = "new";
  const props = { state, run: async (action) => action() };
  h.fetch = async (url) => { requests.push(url); return new Response(JSON.stringify({ chat: [{ id: "old", role: "assistant", text: "Earlier answer" }, state.chat[0]], chatNextBefore: null })); };
  const render = () => h.render(h.exports.BuddyLog, props);
  await byText(render(), "Load older").props.onClick();
  assert.equal(requests[0], "/api/parent/state?before=new");
  assert.equal(byText(render(), "Load older"), undefined);
  assert.equal(nodes(render(), (n) => n.type === "li").length, 2);
  assert.match(text(render()), /Earlier answer.*New question/);
});

test("B5b: reload preserves Kid mode or local lock even while the server unlock window is valid", async () => {
  for (const mode of ["kid", "locked"]) {
    const h = harness("App.jsx"), me = meFixture("parent", true);
    me.unlockedUntil = h.now + 900000;
    h.storage.set("mq_parent_mode", mode);
    h.storage.set("mq_selected_child", "child-two");
    h.fetch = async () => new Response(JSON.stringify(me));
    h.render(h.exports.default); h.flush();
    await new Promise(setImmediate);
    const tree = h.render(h.exports.default); h.flush();
    assert.equal(nodes(tree, (n) => n.type?.name === "ParentRoot").length, 0);
    assert.equal(nodes(tree, (n) => n.type?.name === "ChildRoot")[0].props.childId, "child-two");
    assert.equal(nodes(tree, (n) => n.type?.name === "PinGate").length, mode === "locked" ? 1 : 0);
  }
});

test("B5b: client cookie requests work against the real account dispatcher through register, PIN, pairing and logout", async (t) => {
  const { dispatch } = await import("../server/index.js");
  const { _databaseForTest, closeDatabase } = await import("../server/db.js");
  const { _clearStoreForTest } = await import("../server/store.js");
  const { _clearLimitsForTest } = await import("../server/limits.js");
  _clearStoreForTest();
  _clearLimitsForTest();
  _databaseForTest();
  t.after(() => { _clearStoreForTest(); _clearLimitsForTest(); closeDatabase(); });
  function browser(ip) {
    const h = harness("api.js");
    let cookie = "";
    h.fetch = async (path, options) => {
      assert.equal(options.credentials, "same-origin");
      const url = new URL(path, h.location);
      const req = { body: options.body === undefined ? undefined : JSON.parse(options.body), headers: { cookie }, ip, query: Object.fromEntries(url.searchParams) };
      const res = {
        headers: {}, statusCode: 200,
        set(key, value) { if (typeof key === "object") Object.assign(this.headers, key); else this.headers[key] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
      };
      await dispatch(options.method, url.pathname, req, res);
      if (res.headers["Set-Cookie"]) cookie = res.headers["Set-Cookie"].split(";")[0];
      return new Response(JSON.stringify(res.body), { status: res.statusCode });
    };
    return h.exports;
  }
  const parent = browser("parent-client"), kid = browser("kid-client");
  const me = await parent.api("auth/register", { email: "wave2@example.test", password: "a-good-password", parentName: "Jordan", childName: "Mia", childAge: 9, bearName: "Maple", timezone: "America/Los_Angeles" });
  assert.equal(me.role, "parent");
  assert.equal("token" in me, false);
  const second = await parent.api("parent/children", { name: "Leo", age: 8, bearName: "Pip" });
  parent.setSelectedChild(second.id);
  const state = await parent.api("parent/state");
  assert.equal(state.childId, second.id);
  assert.equal(state.balances.savings, 0);
  await parent.api("parent/pin", { pin: "5678" });
  const link = await parent.api(`parent/children/${second.id}/link`, {});
  const linked = await kid.api("auth/link", { code: link.code });
  assert.equal(linked.role, "child");
  assert.equal(linked.activeChild.id, second.id);
  kid.setSelectedChild(second.id);
  assert.equal((await kid.api("state")).child.name, "Leo");
  await assert.rejects(kid.api("parent/state"), { status: 403, message: "A grown-up needs to sign in" });
  await parent.api("auth/logout", {});
  parent.clearSessionCache();
  const signedIn = await parent.api("auth/login", { email: "wave2@example.test", password: "a-good-password" });
  assert.equal(signedIn.family.pinSet, true);
  parent.setSelectedChild(second.id);
  await assert.rejects(parent.api("parent/state"), { status: 403, message: "Please unlock parent mode" });
  await parent.api("parent/unlock", { pin: "5678" });
  assert.equal((await parent.api("parent/state")).childId, second.id);
  const otherParent = browser("other-parent-client");
  await otherParent.api("auth/login", { email: "wave2@example.test", password: "a-good-password" });
  await assert.rejects(otherParent.api("auth/logout-all", {}), { status: 403, message: "Please unlock parent mode" });
  await otherParent.api("parent/unlock", { pin: "5678" });
  await otherParent.api("auth/logout-all", {});
  await assert.rejects(otherParent.api("auth/me"), { status: 401 });
  await assert.rejects(parent.api("auth/me"), { status: 401 });
  await assert.rejects(kid.api("state"), { status: 401 });
  await assert.rejects(kid.api("auth/me"), { status: 401 });
});

test("B5b: Welcome uses unauthenticated demo discovery; malformed success remains retryable", async () => {
  for (const status of [200, 401]) {
    const h = harness("App.jsx");
    h.fetch = async () => new Response(JSON.stringify({ demo: true, ...(status === 401 ? { error: "Sign in" } : {}) }), { status });
    h.render(h.exports.default); h.flush();
    await new Promise(setImmediate);
    const tree = h.render(h.exports.default); h.flush();
    const welcome = nodes(tree, (n) => n.type?.name === "AuthScreen")[0];
    if (status === 401) {
      assert.equal(welcome.props.screen, "welcome");
      assert.equal(welcome.props.demo, true);
      assert.equal(welcome.props.error, null);
    } else {
      assert.equal(welcome, undefined);
      assert.ok(nodes(tree, (n) => n.type?.name === "Loading")[0].props.error);
    }
  }
});

test("B5b follow-up R1/R4: wrong password, wrong PIN and rate limits stay inline without losing input or identity", async () => {
  for (const form of ["signin", "pin"]) {
    for (const status of [401, 429]) {
      const h = harness("App.jsx");
      h.storage.set("mq_last_state", "keep snapshot");
      h.storage.set("mq_child_session", "keep identity");
      let unauthorized = 0, limited = 0, accepted = 0;
      h.window.addEventListener("mq:unauthorized", () => unauthorized++);
      h.window.addEventListener("mq:rate-limit", () => limited++);
      const message = status === 429 ? "Let's take a little break. Try again soon!" : form === "pin" ? "That PIN didn't match" : "Email or password didn't match";
      const component = form === "pin" ? h.exports.PinGate : h.exports.AuthScreen;
      const props = { screen: "signin", navigate: () => assert.fail("must stay on form"), onSession: () => accepted++, onOk: () => accepted++, onCancel: noop };
      const render = () => h.render(component, props);
      changeField(render(), form === "pin" ? "Parent PIN" : "Email", form === "pin" ? "5678" : "parent@example.test");
      h.fetch = async () => new Response(JSON.stringify({ error: message }), { status });
      await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
      await new Promise(setImmediate);
      const tree = render();
      assert.equal(nodes(tree, (n) => n.props.role === "alert").map(text).join(""), message);
      assert.equal(nodes(tree, (n) => n.type === "input")[0].props.value, form === "pin" ? "5678" : "parent@example.test");
      assert.equal(h.storage.get("mq_last_state"), "keep snapshot");
      assert.equal(h.storage.get("mq_child_session"), "keep identity");
      assert.equal(unauthorized, 0);
      assert.equal(limited, status === 429 && form !== "pin" ? 1 : 0);
      assert.equal(accepted, 0);
    }
  }
  const h = harness("api.js");
  h.fetch = async () => new Response('{"error":"Try again"}', { status: 401 });
  let unauthorized = 0;
  h.window.addEventListener("mq:unauthorized", () => unauthorized++);
  await assert.rejects(h.exports.api("parent/unlock?child=one", {}), { status: 401 });
  await assert.rejects(h.exports.api("auth/login?next=home", {}), { status: 401 });
  assert.equal(unauthorized, 0);
  await assert.rejects(h.exports.api("state"), { status: 401 });
  assert.equal(unauthorized, 1);
});

test("B5b follow-up R2: only child-scoped 404 requests for the current identity trigger selection recovery", async () => {
  const h = harness("api.js");
  let resets = 0;
  h.window.addEventListener("mq:child-reset", () => resets++);
  h.fetch = async () => new Response('{"error":"Child not found"}', { status: 404 });
  await assert.rejects(h.exports.api("auth/me"), { status: 404 });
  assert.equal(resets, 0);
  h.exports.setSelectedChild("stale-child");
  for (const path of ["state", "parent/state?before=message", "child/save"]) {
    await assert.rejects(h.exports.api(path), { status: 404 });
  }
  assert.equal(resets, 3);
  await assert.rejects(h.exports.api("parent/children/other/link?child=other", {}), { status: 404 });
  assert.equal(resets, 4);
  let finish;
  h.fetch = () => new Promise((resolve) => { finish = resolve; });
  const stale = h.exports.api("state");
  h.exports.setSelectedChild("new-selection");
  finish(new Response('{"error":"Child not found"}', { status: 404 }));
  await assert.rejects(stale, { status: 404 });
  assert.equal(resets, 4);
});

test("B5b follow-up R2: scoped 404 refreshes the children list and recovers the first child in parent and Kid mode", async () => {
  for (const kidMode of [false, true]) {
    const h = await appHarness(meFixture());
    let tree = h.tree();
    nodes(tree, (n) => n.type === "select")[0].props.onChange({ target: { value: "child-two" } });
    tree = h.tree();
    if (kidMode) { byText(tree, "Kid mode").props.onClick(); tree = h.tree(); }
    const rootName = kidMode ? "ChildRoot" : "ParentRoot";
    const before = nodes(tree, (n) => n.type?.name === rootName)[0];
    const requests = [], current = meFixture();
    // Simulate deletion of both cached children, leaving a new first child.
    current.children = [{ ...current.children[0], id: "server-first" }];
    current.activeChild = current.children[0];
    h.fetch = async (url) => {
      requests.push(url);
      if (url === "/api/auth/me") return new Response(JSON.stringify(current));
      return new Response('{"error":"Child not found"}', { status: 404 });
    };
    const root = harness("App.jsx");
    root.exports.setSelectedChild("child-two");
    root.fetch = async () => new Response('{"error":"Child not found"}', { status: 404 });
    const props = { ...before.props, toast: noop, onConnection: noop };
    root.render(root.exports[rootName], props); root.flush();
    await new Promise(setImmediate);
    // API reset events are on the shared browser window in the real app.
    root.window.addEventListener("mq:child-reset", () => h.window.dispatchEvent(new Event("mq:child-reset")));
    const failed = root.render(root.exports[rootName], props);
    await failed.props.onRetry();
    await new Promise(setImmediate);
    tree = h.tree();
    const recovered = nodes(tree, (n) => n.type?.name === rootName)[0];
    assert.equal(recovered.props.childId, "server-first");
    assert.notEqual(recovered.props.key, before.props.key);
    assert.equal(h.storage.get("mq_selected_child"), "server-first");
    assert.deepEqual(requests, ["/api/auth/me"]);
    assert.equal(nodes(tree, (n) => n.type?.name === "PinGate").length, 0);
    const remounted = harness("App.jsx");
    remounted.exports.setSelectedChild(recovered.props.childId);
    remounted.fetch = async (url) => {
      assert.equal(new URL(url, h.location).searchParams.get("child"), "server-first");
      return new Response(JSON.stringify({ ...stateFixture(), childId: "server-first" }));
    };
    remounted.render(remounted.exports[rootName], { ...recovered.props, onConnection: noop }); remounted.flush();
    await new Promise(setImmediate);
    assert.equal(nodes(remounted.render(remounted.exports[rootName], { ...recovered.props, onConnection: noop }), (n) => ["Child", "Parent"].includes(n.type?.name)).length, 1);
  }
});

test("B5b follow-up R2: recovery cannot overwrite a newer manual child selection or sign-out", async () => {
  for (const signOut of [false, true]) {
    const h = await appHarness(meFixture());
    let finish;
    h.fetch = () => new Promise((resolve) => { finish = resolve; });
    h.tree();
    h.window.dispatchEvent(new Event("mq:child-reset"));
    if (signOut) h.window.dispatchEvent(new Event("mq:unauthorized"));
    else nodes(h.tree(), (n) => n.type === "select")[0].props.onChange({ target: { value: "child-two" } });
    finish(new Response(JSON.stringify(meFixture())));
    await new Promise(setImmediate);
    const tree = h.tree();
    if (signOut) assert.equal(nodes(tree, (n) => n.type?.name === "AuthScreen")[0].props.screen, "welcome");
    else assert.equal(nodes(tree, (n) => n.type?.name === "ParentRoot")[0].props.childId, "child-two");
  }
});

test("B5b follow-up R3: initial state failures offer retry and only parent Kid mode offers grown-up recovery", async () => {
  for (const role of ["child", "parent", "kid-mode-parent"]) {
    const h = harness("App.jsx"), requests = [];
    let back = 0, fail = true;
    h.fetch = async (url) => {
      requests.push(url);
      if (fail) return new Response('{"error":"Oops"}', { status: 500 });
      return new Response(JSON.stringify(stateFixture()));
    };
    const component = role === "parent" ? h.exports.ParentRoot : h.exports.ChildRoot;
    const props = { childId: "child-one", toast: noop, onConnection: noop, ...(role === "kid-mode-parent" ? { onGrownUps: () => back++ } : {}) };
    h.render(component, props); h.flush();
    await new Promise(setImmediate);
    const failed = h.render(component, props);
    const display = harness("App.jsx");
    const screen = display.render(display.exports.Loading, failed.props);
    assert.ok(byText(screen, "Try again"));
    assert.equal(Boolean(byText(screen, "Back to grown-ups")), role === "kid-mode-parent");
    if (role === "kid-mode-parent") { byText(screen, "Back to grown-ups").props.onClick(); assert.equal(back, 1); }
    fail = false;
    await byText(screen, "Try again").props.onClick();
    assert.equal(nodes(h.render(component, props), (n) => ["Child", "Parent"].includes(n.type?.name)).length, 1);
    assert.equal(requests.length, 2);
  }
});

test("B5b follow-up N1: kid code typing and paste use exactly the server alphabet", () => {
  const h = harness("App.jsx"), props = { screen: "link", navigate: noop, onSession: noop };
  const render = () => h.render(h.exports.AuthScreen, props);
  changeField(render(), "Kid code", "aAeEiIoOuUlLsSzZ0125! b-c d.3 4 6 7 8 9");
  assert.equal(nodes(render(), (n) => n.type === "input")[0].props.value, "BCD346");
  for (const character of "BCDFGHJKMNPQRTVWXY346789") {
    changeField(render(), "Kid code", character.toLowerCase());
    assert.equal(nodes(render(), (n) => n.type === "input")[0].props.value, character);
  }
});

test("B5b follow-up logout-all: Security confirms, cancels and respects busy state before invoking logout", async () => {
  const h = harness("Parent.jsx");
  let calls = 0;
  const props = { me: meFixture(), run: async (fn) => fn(), onSignOutAll: async () => { calls++; }, busy: false };
  const render = (extra = {}) => h.render(h.exports.Security, { ...props, ...extra });
  assert.equal(byText(render(), "Confirm sign out everywhere"), undefined);
  byText(render(), "Sign out everywhere").props.onClick();
  assert.equal(calls, 0);
  assert.match(text(render()), /including kid devices; you will need new kid codes/);
  assert.equal(byText(render({ busy: true }), "Confirm sign out everywhere").props.disabled, true);
  byText(render(), "Cancel").props.onClick();
  assert.equal(byText(render(), "Confirm sign out everywhere"), undefined);
  byText(render(), "Sign out everywhere").props.onClick();
  await byText(render(), "Confirm sign out everywhere").props.onClick();
  assert.equal(calls, 1);
});

test("B5b follow-up logout-all: cookie POST returns to Welcome only on success, locked errors open PIN", async () => {
  for (const status of [200, 403, 423, 500]) {
    const h = await appHarness(meFixture()), calls = [];
    h.fetch = async (url, options) => {
      calls.push([url, options]);
      return new Response(JSON.stringify(status === 200 ? { ok: true } : { error: status === 500 ? "Oops" : "Please unlock parent mode" }), { status });
    };
    const root = nodes(h.tree(), (n) => n.type?.name === "ParentRoot")[0];
    if (status === 200) await root.props.onSignOutAll();
    else await assert.rejects(root.props.onSignOutAll(), { status });
    const [url, options] = calls[0];
    assert.equal(new URL(url, h.location).pathname, "/api/auth/logout-all");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.body, "{}");
    const tree = h.tree();
    assert.equal(nodes(tree, (n) => n.type?.name === "AuthScreen").length, status === 200 ? 1 : 0);
    assert.equal(nodes(tree, (n) => n.type?.name === "PinGate").length, [403, 423].includes(status) ? 1 : 0);
    if (status === 200) assert.equal(h.storage.has("mq_selected_child"), false);
  }
});

test("B5b follow-up demo: Welcome fetches unauthenticated availability on each entry and honors true and false", async () => {
  const h = await appHarness({ ...meFixture(), demo: true });
  let demo = true;
  const requests = [];
  h.fetch = async (url) => {
    requests.push(url);
    return new Response(JSON.stringify({ error: "Sign in again", demo }), { status: 401 });
  };
  h.window.dispatchEvent(new Event("mq:unauthorized"));
  h.tree();
  await new Promise(setImmediate);
  let tree = h.tree();
  let welcome = nodes(tree, (n) => n.type?.name === "AuthScreen")[0];
  assert.equal(welcome.props.demo, true);
  welcome.props.navigate("signin"); h.tree();
  demo = false;
  nodes(h.tree(), (n) => n.type?.name === "AuthScreen")[0].props.navigate("welcome"); h.tree();
  await new Promise(setImmediate);
  tree = h.tree();
  welcome = nodes(tree, (n) => n.type?.name === "AuthScreen")[0];
  assert.equal(welcome.props.demo, false);
  assert.deepEqual(requests, ["/api/auth/me", "/api/auth/me"]);
});

test("B5b follow-up demo: a delayed Welcome discovery 401 cannot eject the sign-in form", async () => {
  const h = await appHarness(meFixture());
  let finish;
  h.fetch = () => new Promise((resolve) => { finish = resolve; });
  h.window.dispatchEvent(new Event("mq:unauthorized"));
  const welcome = nodes(h.tree(), (n) => n.type?.name === "AuthScreen")[0];
  welcome.props.navigate("signin"); h.tree();
  finish(new Response('{"error":"Sign in","demo":true}', { status: 401 }));
  await new Promise(setImmediate);
  assert.equal(nodes(h.tree(), (n) => n.type?.name === "AuthScreen")[0].props.screen, "signin");
});

test("F3: Home offers one flat-price trip and an anonymous countdown sign", async () => {
  const h = harness("Child.jsx"), state = stateFixture(), calls = [];
  state.child.points = 18;
  const props = { state, run: async (...args) => calls.push(args), talk: { open: noop }, open: noop };
  let tree = h.render(h.exports.Home, props);
  assert.equal(byText(tree, "Earn 12 more points").props.disabled, true);
  state.child.points = 30;
  tree = h.render(h.exports.Home, props);
  await byText(tree, "Send Maple on a trip").props.onClick();
  assert.equal(calls[0][0], "child/trip");
  assert.deepEqual(Object.keys(calls[0][1]), []);
  state.adventures = [{ id: "away", status: "away", returnsAt: h.now + 42000 }];
  tree = h.render(h.exports.Home, props);
  assert.match(text(tree), /On a trip.*Back in 0:42/s);
  assert.doesNotMatch(text(tree), /Gone to|San Francisco/);
  assert.equal(byText(tree, "On a trip").props.disabled, undefined); // tappable sign
  assert.equal(h.exports.countdown(h.now, h.now), "Any second now…");
});

test("F3: map handles masked adventures and place sheets are read-only with story and visit count", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  state.adventures = [{ status: "away", returnsAt: h.now + 42000 }];
  let tree = h.render(h.exports.MapScreen, { state, open: noop });
  assert.match(text(tree), /Maple\s*'s travels/);
  assert.doesNotMatch(text(tree), /walking to|heading home from|send Maple/);
  const map = harness("Child.jsx");
  tree = map.render(map.exports.MapView, { places: state.catalog.places, home: state.catalog.home, owned: new Set(), away: state.adventures[0], onSelect: noop });
  assert.equal(nodes(tree, (n) => n.props.className?.split(" ").includes("walker")).length, 1);
  assert.equal(nodes(tree, (n) => n.props["aria-label"] === "Mystery route").length, 1);
  assert.equal(nodes(tree, (n) => n.props.className?.includes("latest-trail")).length, 0);
  const place = harness("Child.jsx");
  state.postcards = [{ defId: "seattle", source: "trip" }, { defId: "seattle", source: "trip" }];
  tree = place.render(place.exports.PlaceSheet, { state, id: "seattle", close: noop, openCard: noop });
  assert.match(text(tree), /Visited\s+2\s+times/);
  assert.match(text(tree), /hydrangeas/);
  assert.doesNotMatch(text(tree), /Earn|Send|points/);
});

test("F3: reveal includes an envelope, ordered bonus card and one Add to album action", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  const ids = ["san_francisco", "hawaii_volcanoes_national_park"];
  state.postcards = ids.map((defId, i) => ({ id: `pc${i}`, defId, source: "trip" }));
  const tree = h.render(h.exports.ReturnReveal, { state, latest: { postcardIds: ["pc0", "pc1"] }, onSeen: noop, onDone: noop });
  assert.equal(tree.props.fullscreen, true);
  assert.equal(nodes(tree, (n) => n.props.className === "return-envelope").length, 1);
  assert.match(text(tree), /…and a surprise!/);
  assert.equal(nodes(tree, (n) => n.type === "button").length, 1);
  assert.equal(text(byText(tree, "Add to album")), "Add to album");
  const cards = nodes(tree, (n) => n.type?.name === "FlipPostcard");
  assert.deepEqual(cards.map((c) => c.props.revealDelay), [0, 2400]);
});

test("F3: seen adventures persist across several returns; New badges clear only when opened", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  const props = { state, toast: noop };
  h.render(h.exports.default, props); h.flush();
  state.postcards = [...state.postcards, { id: "new-pc", defId: "seattle", source: "trip" }];
  state.adventures = [{ id: "one", status: "returned", postcardIds: ["new-pc"] }];
  let tree = h.render(h.exports.default, props); h.flush();
  nodes(tree, (n) => n.type?.name === "ReturnReveal")[0].props.onSeen();
  state.adventures.unshift({ id: "two", status: "returned", postcardIds: [] });
  tree = h.render(h.exports.default, props); h.flush();
  nodes(tree, (n) => n.type?.name === "ReturnReveal")[0].props.onSeen();
  tree = h.render(h.exports.default, props); h.flush();
  assert.equal(nodes(tree, (n) => n.type?.name === "ReturnReveal").length, 0);
  assert.deepEqual(JSON.parse(h.storage.get("mq_seen_adv")), ["one", "two"]);
  byText(tree, "Album").props.onClick();
  tree = h.render(h.exports.default, props);
  let album = nodes(tree, (n) => n.type?.name === "Album")[0];
  assert.equal(album.props.newCards.length, 1);
  album.props.openCard("seattle");
  tree = h.render(h.exports.default, props);
  album = nodes(tree, (n) => n.type?.name === "Album")[0];
  assert.equal(album.props.newCards.length, 0);
  assert.deepEqual(JSON.parse(h.storage.get("mq_opened_cards:Mia")), ["new-pc"]);
});

test("F6: talk guards Buddy-off, away and offline with warm bubbles and no request", async () => {
  for (const mode of ["off", "away", "offline"]) {
    const h = harness("Child.jsx"), state = stateFixture();
    let calls = 0;
    if (mode === "off") state.settings.buddyEnabled = false;
    if (mode === "away") state.adventures = [{ id: "away", status: "away", returnsAt: h.now + 42000 }];
    const props = { state, offline: mode === "offline", run: () => { calls++; } };
    let talk = h.render(h.exports.useMapleTalk, props); h.flush();
    talk.open(); talk = h.render(h.exports.useMapleTalk, props);
    assert.equal(talk.isOpen, false);
    assert.match(talk.bubble, mode === "off" ? /grown-up switched chatting off/ : mode === "away" ? /is on a trip!/ : /can't chat while we're offline/);
    assert.equal(await talk.send("Hello"), false);
    assert.equal(calls, 0);
  }
});

test("F6: one talk request sets thinking then happy, safety replies rest, with text replies", async () => {
  const h = harness("Child.jsx"), state = stateFixture();
  let finish, calls = 0;
  const props = { state, run: () => { calls++; return new Promise((r) => { finish = r; }); } };
  let talk = h.render(h.exports.useMapleTalk, props); h.flush();
  talk.open(); const first = talk.send("Hi");
  assert.equal(await talk.send("Again"), false);
  talk = h.render(h.exports.useMapleTalk, props);
  assert.equal(talk.mood, "thinking"); assert.equal(talk.bubble, "…");
  finish({ reply: "A little saving adds up!" }); await first;
  talk = h.render(h.exports.useMapleTalk, props);
  assert.equal(talk.mood, "happy"); assert.equal(calls, 1);
  const safety = talk.send("Hi"); finish({ reply: "Hmm, let's talk about your savings." }); await safety;
  talk = h.render(h.exports.useMapleTalk, props);
  assert.equal(talk.mood, "resting");
});

test("F6: going away during a reply closes the bar and ignores the stale reply", async () => {
  const h = harness("Child.jsx"), state = stateFixture();
  let finish;
  const props = { state, run: () => new Promise((r) => { finish = r; }) };
  let talk = h.render(h.exports.useMapleTalk, props); h.flush();
  talk.open(); const request = talk.send("Hi");
  state.adventures = [{ id: "away", status: "away", returnsAt: h.now + 60000 }];
  h.render(h.exports.useMapleTalk, props); h.flush();
  finish({ reply: "A late reply" }); await request;
  talk = h.render(h.exports.useMapleTalk, props);
  assert.equal(talk.isOpen, false); assert.equal(talk.bubble, "");
});

test("F6/H11: talk bar offers three suggestions, a how-to chip, text input and transcript link", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  const props = { state, talk: { close: noop, send: async () => false }, open: noop };
  let tree = h.render(h.exports.TalkBar, props);
  assert.equal(nodes(tree, (n) => n.props.className === "chip").length, 4);
  assert.ok(byText(tree, "How do I…?"));
  assert.ok(byText(tree, "Can I buy a toy for $8?"));
  assert.equal(nodes(tree, (n) => n.props["aria-label"] === "Hold to talk").length, 0);
  assert.ok(byText(tree, "See our chat"));
  const chat = harness("Child.jsx");
  tree = chat.render(chat.exports.Buddy, { state, startTalk: noop });
  assert.match(text(tree), /grown-up can read these chats/);
  assert.match(text(tree), /Keep passwords, phone numbers and addresses private/);
  assert.ok(byText(tree, "Talk to Maple"));
});



test("F3 / F6: reduced motion shows postcard picture and full polite bubble immediately", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  h.window.matchMedia = () => ({ matches: true });
  let tree = h.render(h.exports.FlipPostcard, { place: state.catalog.places.seattle, bearName: "Maple", to: "You", revealDelay: 2400 }); h.flush();
  tree = h.render(h.exports.FlipPostcard, { place: state.catalog.places.seattle, bearName: "Maple", to: "You", revealDelay: 2400 });
  assert.doesNotMatch(tree.props.className, /flipped/);
  const bubble = harness("Child.jsx"); bubble.window.matchMedia = () => ({ matches: true });
  tree = bubble.render(bubble.exports.SpeechBubble, { text: "Here is a little plan." }); bubble.flush();
  tree = bubble.render(bubble.exports.SpeechBubble, { text: "Here is a little plan." });
  assert.equal(tree.props["aria-live"], "polite");
  assert.equal(nodes(tree, (n) => n.props.className === "bear-bubble-text")[0].props.children[0].props.text, "Here is a little plan.");
  const bear = harness("Child.jsx");
  tree = bear.render(bear.exports.BearFigure, { bear: state.child.bear, mood: "thinking" });
  assert.match(tree.props.className, /pose-threeQuarter mood-thinking/);
  assert.equal(nodes(tree, (n) => n.props.className === "thought-dots").length, 1);
});

test("F3: a legacy seen adventure does not replay older postcards", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  h.storage.set("mq_seen_adv", "latest");
  state.adventures = [{ id: "latest", status: "returned", returnedAt: h.now }, { id: "older", status: "returned", returnedAt: h.now - 60000 }];
  const tree = h.render(h.exports.default, { state, toast: noop });
  assert.equal(nodes(tree, (n) => n.type?.name === "ReturnReveal").length, 0);
});

test("F3: Add to album flies toward nav and finishes once after animation", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  let seen = 0, done = 0;
  const props = { state, latest: { postcardIds: [] }, onSeen: () => seen++, onDone: () => done++ };
  let tree = h.render(h.exports.ReturnReveal, props); h.flush();
  const values = {};
  h.document.querySelector = () => ({ getBoundingClientRect: () => ({ left: 300, top: 700, width: 50, height: 50 }) });
  nodes(tree, (n) => n.props.className === "return-parcel ")[0].props.ref.current = {
    getBoundingClientRect: () => ({ left: 50, top: 200, width: 300, height: 300 }),
    style: { setProperty: (name, value) => { values[name] = value; } },
  };
  const add = byText(tree, "Add to album").props.onClick;
  add(); add();
  tree = h.render(h.exports.ReturnReveal, props); h.flush();
  assert.equal(byText(tree, "Add to album").props.disabled, true);
  assert.equal(values["--album-x"], "125px"); assert.equal(values["--album-y"], "375px");
  assert.equal(seen, 0);
  h.timeouts.filter(Boolean).forEach((fn) => fn());
  assert.equal(seen, 1); assert.equal(done, 1);
});

test("F6: talk input keeps focus through polls, Escape restores opener and failed send keeps draft", async () => {
  const h = harness("Child.jsx"), state = stateFixture();
  h.window.matchMedia = (query) => ({ matches: query.includes("pointer: fine") });
  let focused = 0, closed = 0;
  const opener = { focus: () => focused++ };
  h.document.activeElement = opener;
  const props = { state, talk: { close: () => closed++, send: async () => false }, open: noop };
  let tree = h.render(h.exports.TalkBar, props);
  const input = nodes(tree, (n) => n.type === "input")[0];
  const element = { focus: () => { h.document.activeElement = element; } };
  input.props.ref.current = element; h.flush();
  assert.equal(h.document.activeElement, element);
  input.props.onChange({ target: { value: "Can we save a little?" } });
  tree = h.render(h.exports.TalkBar, props); h.flush();
  assert.equal(h.document.activeElement, element);
  await nodes(tree, (n) => n.type === "form")[0].props.onSubmit(submit);
  tree = h.render(h.exports.TalkBar, props);
  assert.equal(nodes(tree, (n) => n.type === "input")[0].props.value, "Can we save a little?");
  const escape = new Event("keydown"); Object.assign(escape, { key: "Escape" }); h.window.dispatchEvent(escape);
  assert.equal(closed, 1);
  h.slots.find((s) => s?.cleanup)?.cleanup(); assert.equal(focused, 1);
});


test("F36.1: bubble containment", async () => {
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  const scene = css.match(/\.scene:has\(\.bear-bubble\)\s*\{([^}]+)\}/)[1];
  const bubble = css.match(/\.bear-bubble\s*\{([^}]+)\}/)[1];
  assert.match(scene, /aspect-ratio:\s*auto/);
  assert.match(scene, /min-width:\s*0/);
  assert.match(bubble, /max-width:\s*calc\(100% - 24px\)/);
  assert.match(bubble, /overflow-wrap:\s*anywhere/);
  assert.match(bubble, /word-break:\s*break-word/);
  for (const away of [false, true]) {
    const h = harness("Child.jsx"), state = stateFixture();
    const reply = away ? "Maple is on a trip! Back in 0:42" : "A long reply ".repeat(150) + "x".repeat(500);
    if (away) state.adventures = [{ status: "away", returnsAt: h.now + 42000 }];
    const home = h.render(h.exports.Home, { state, talk: { bubble: reply, open: noop } });
    const scene = nodes(home, (n) => n.type === "section" && n.props.className.startsWith("scene "))[0];
    const component = nodes(scene, (n) => n.type?.name === "SpeechBubble")[0];
    const rendered = harness("Child.jsx");
    const markup = rendered.render(rendered.exports.SpeechBubble, component.props);
    assert.match(text(markup), away ? /Maple is on a trip!.*Back in 0:42/ : /A long reply/);
    assert.equal(markup.props.style?.width, undefined);
  }
});

test("F36.2: child album baseline and badges", () => {
  const h = harness("Child.jsx"), state = stateFixture(), props = { state, toast: noop };
  let tree = h.render(h.exports.default, props); h.flush();
  byText(tree, "Album").props.onClick();
  const album = () => nodes(h.render(h.exports.default, props), (n) => n.type?.name === "Album")[0];
  assert.equal(album().props.newCards.length, 0);
  assert.equal(state.postcards.filter((p) => p.defId === "chicago").length, 2);
  state.postcards.push({ id: "later", defId: "seattle", source: "trip", collectedAt: h.now + 1000 });
  assert.equal(album().props.newCards[0].id, "later");
  const reload = harness("Child.jsx");
  h.storage.forEach((v, k) => reload.storage.set(k, v));
  tree = reload.render(reload.exports.default, props);
  let reloadedAlbum = nodes(tree, (n) => n.type?.name === "Album")[0];
  assert.equal(reloadedAlbum.props.newCards[0].id, "later");
  reloadedAlbum.props.openCard("seattle");
  tree = reload.render(reload.exports.default, props);
  assert.equal(nodes(tree, (n) => n.type?.name === "Album")[0].props.newCards.length, 0);
  const other = harness("Child.jsx");
  reload.storage.forEach((v, k) => other.storage.set(k, v));
  state.child = { ...state.child, name: "Leo" };
  tree = other.render(other.exports.default, props);
  assert.equal(nodes(tree, (n) => n.type?.name === "Album")[0].props.newCards.length, 0);
  assert.ok(other.storage.has("mq_album_baseline:Leo"));
});

test("F36.3: spoiler-free reveal and reduced motion", () => {
  for (const revealDelay of [0, 2400]) {
    const h = harness("Child.jsx"), state = stateFixture();
    const props = { place: state.catalog.places.seattle, bearName: "Maple", to: "Mia", collectedAt: h.now, revealDelay };
    const assertUnrevealed = (tree) => {
      assert.equal(text(tree).includes(props.place.name), false);
      assert.equal(text(tree).includes(props.place.story), false);
      assert.doesNotMatch(text(tree), /Seattle|hydrangeas|Washington/);
      assert.equal(nodes(tree, (n) => n.type === "h2" || ["story", "pc-story", "pc-place", "postmark"].includes(n.props.className)).length, 0);
      assert.equal(nodes(tree, (n) => n.type === "img")[0].props.alt, "");
      for (const face of ["front", "back"]) {
        assert.equal(nodes(tree, (n) => n.props.className === `flip-face ${face}`)[0].props["aria-hidden"], true);
      }
    };
    let tree = h.render(h.exports.FlipPostcard, props); h.flush();
    assertUnrevealed(tree);
    nodes(tree, (n) => n.props.role === "button")[0].props.onClick();
    tree = h.render(h.exports.FlipPostcard, props);
    assert.match(tree.props.className, /flipped/);
    h.timeouts[0](); // start the flip, still no readable spoiler
    tree = h.render(h.exports.FlipPostcard, props);
    assertUnrevealed(tree);
    h.timeouts[1](); // finish the flip
    tree = h.render(h.exports.FlipPostcard, props);
    assert.match(text(tree), /Seattle/);
    assert.match(text(tree), /hydrangeas/);
    assert.equal(nodes(tree, (n) => n.props.className === "postmark").length, 1);
    assert.equal(nodes(tree, (n) => n.type === "img")[0].props.alt, "Maple at Seattle");
    const reduced = harness("Child.jsx"); reduced.window.matchMedia = () => ({ matches: true });
    tree = reduced.render(reduced.exports.FlipPostcard, props);
    assert.doesNotMatch(tree.props.className, /flipped/);
    assert.match(text(tree), /Seattle/);
    assert.match(text(tree), /hydrangeas/);
    assert.equal(nodes(tree, (n) => n.type === "img")[0].props.alt, "Maple at Seattle");
  }
  const h = harness("Child.jsx"), state = stateFixture();
  state.postcards = [{ id: "return-card", defId: "seattle" }];
  const tree = h.render(h.exports.ReturnReveal, { state, latest: { postcardIds: ["return-card"] }, onSeen: noop, onDone: noop });
  assert.equal(tree.props.title, `${state.child.bear.name} is home!`);
  assert.doesNotMatch(tree.props.title + text(tree), /Seattle|hydrangeas|Washington/);
});

test("F36.4: paper envelope body and flap", async () => {
  const h = harness("Child.jsx"), state = stateFixture();
  const tree = h.render(h.exports.ReturnReveal, { state, latest: { postcardIds: [] }, onSeen: noop, onDone: noop });
  assert.equal(nodes(tree, (n) => n.type === "rect" && n.props.className === "envelope-body" && n.props.fill === "#FFF0CF").length, 1);
  assert.equal(nodes(tree, (n) => n.type === "path" && n.props.className === "envelope-flap").length, 1);
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.return-envelope\s*\{[^}]*margin: 10px auto -22px;[^}]*drop-shadow/);
});

test("F36.5: collector and Maple copy", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  const tile = h.render(h.exports.PostcardTile, { id: "seattle", place: state.catalog.places.seattle, count: 0 });
  assert.match(text(tile), /Collector's value/);
  assert.doesNotMatch(text(tile), /Album value|pts/);
  const chat = harness("Child.jsx");
  const tree = chat.render(chat.exports.Buddy, { state, startTalk: noop });
  assert.match(text(tree), /Maple\s+explains and plans/);
  assert.doesNotMatch(text(tree), /Money Buddy/);
  const bear = harness("Child.jsx");
  assert.match(bear.render(bear.exports.BearFigure, { bear: state.child.bear, mood: "happy" }).props["aria-label"], /feeling happy/);
});

test("F36.6: intrinsic stamp width", async () => {
  const h = harness("Child.jsx"), state = stateFixture();
  state.postcards.push({ defId: "seattle", source: "trip" });
  const tree = h.render(h.exports.PlaceSheet, { state, id: "seattle", close: noop });
  assert.equal(nodes(tree, (n) => n.type?.name === "Stamp").length, 1);
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.stamp\s*\{[^}]*width:\s*fit-content;[^}]*justify-self:\s*start/);
});


test("F36.8: visible map clues", () => {
  for (const open of [true, false]) {
    const h = harness("Child.jsx"), state = stateFixture();
    state.catalog.places.seattle = { ...state.catalog.places.seattle, open, clue: "Follow the rainy trail.", lockReason: "Save money 3 times" };
    const tree = h.render(h.exports.PlaceSheet, { state, id: "seattle", close: noop });
    assert.equal(nodes(tree, (n) => n.type === "p" && text(n) === "Follow the rainy trail.").length, 1);
    if (!open) assert.match(text(tree), /Save money 3 times/);
    assert.doesNotMatch(text(tree), /Send|Earn/);
  }
});

test("D1: first install never shows update, existing controller offers reload and dismiss", () => {
  const first = harness("App.jsx");
  let tree = first.render(first.exports.default); first.flush();
  first.navigator.serviceWorker.controller = {};
  for (let i = 0; i < 2; i++) {
    first.navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    tree = first.render(first.exports.default); first.flush();
    assert.equal(byText(tree, "Updated!"), undefined);
  }
  const upgrade = harness("App.jsx", { controller: {} });
  upgrade.render(upgrade.exports.default); upgrade.flush();
  upgrade.navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
  tree = upgrade.render(upgrade.exports.default);
  assert.ok(byText(tree, "Updated! Tap to reload"));
  nodes(tree, (n) => n.props["aria-label"] === "Dismiss update")[0].props.onClick();
  assert.equal(byText(upgrade.render(upgrade.exports.default), "Updated!"), undefined);
});

test("D2: impossible lesson goals ask a grown-up and zero remaining never suggests a lesson", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  state.child.lessonsDone = catalog.LESSONS.map((l) => l.id);
  state.parentGoals = [{ id: "old", title: "Old impossible goal", status: "active", type: "lessons", count: 5, progress: 3, reward: 500 }];
  const tree = h.render(h.exports.Home, { state });
  assert.match(text(tree), /Ask your grown-up about this goal/);
  assert.doesNotMatch(text(tree), /more money lessons|Try the .* lesson/);
  const parent = harness("Parent.jsx");
  state.child.lessonsDone = catalog.LESSONS.slice(0, 3).map((l) => l.id);
  let goals = parent.render(parent.exports.Goals, { state });
  assert.match(text(goals), /27\s+lessons remaining/);
  const count = nodes(goals, (n) => n.type === "input" && n.props.type === "number")[0];
  assert.equal(count.props.max, catalog.LESSONS.length - 3);
  let request;
  goals = parent.render(parent.exports.Goals, { state, run: (...args) => { request = args; } });
  byText(goals, "Cancel").props.onClick();
  assert.equal(request[0], "parent/goal/old/cancel");
  state.parentGoals[0].status = "cancelled";
  goals = parent.render(parent.exports.Goals, { state });
  assert.equal(nodes(goals, (n) => n.type === "tr" && n.props.className === "struck").length, 1);
  assert.equal(byText(goals, "Cancel"), undefined);
});

test("D3: Album, Map and Overview use the same trip-place and card metrics", () => {
  const state = stateFixture();
  state.postcards.push({ id: "trip", defId: "seattle", source: "trip" }, { id: "trade", defId: "san_francisco", source: "trade" });
  state.metrics = { postcards: { places: 2, cards: 4, total: 15 } };
  for (const [file, name, expected] of [["Child.jsx", "Album", /2 of 15 places · 4 cards/], ["Child.jsx", "MapScreen", /2 of 15 places/], ["Parent.jsx", "Overview", /2 of 15 places \(\s*4 cards\s*\)/]]) {
    const h = harness(file);
    assert.match(text(h.render(h.exports[name], { state })).replace(/\s+/g, " "), expected);
  }
  const old = harness("api.js");
  delete state.metrics;
  assert.deepEqual(JSON.parse(JSON.stringify(old.exports.postcardMetrics(state))), { places: 2, cards: 4, total: 15 });
});

test("W2b: postcard metrics pluralise cards and catalog places in Album, Map and Overview", () => {
  const api = harness("api.js");
  for (const word of ["card", "place"]) {
    for (const n of [0, 1, 2]) assert.equal(api.exports.plural(n, word), n === 1 ? word : `${word}s`);
  }
  for (const [places, cards, total] of [[0, 0, 15], [1, 1, 15], [1, 1, 1], [2, 4, 15]]) {
    const state = stateFixture();
    state.metrics = { postcards: { places, cards, total } };
    const placeWord = total === 1 ? "place" : "places", cardWord = cards === 1 ? "card" : "cards";
    for (const [file, name, expected] of [
      ["Child.jsx", "Album", `${places} of ${total} ${placeWord} · ${cards} ${cardWord}`],
      ["Child.jsx", "MapScreen", `${places} of ${total} ${placeWord}`],
      ["Parent.jsx", "Overview", `${places} of ${total} ${placeWord} (${cards} ${cardWord})`],
    ]) {
      const h = harness(file);
      const rendered = text(h.render(h.exports[name], { state })).replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")");
      assert.ok(rendered.includes(expected), `${name}: ${expected}`);
    }
  }
});

test("D4 / D12: handled notifications hide, and both inbox lists get warm empty states", () => {
  const h = harness("Parent.jsx"), state = stateFixture();
  state.notifications = [{ id: "handled", read: true, text: "Old approval reminder", ts: Date.now() }];
  const tree = h.render(h.exports.Inbox, { state, pending: [] });
  assert.doesNotMatch(text(tree), /Old approval reminder/);
  assert.equal(nodes(tree, (n) => n.type === "p" && text(n) === "Nothing waiting — nice!").length, 2);
});

test("D6: date, time, money and postcard postmarks consistently use en-US", async () => {
  const h = harness("api.js"), ts = Date.parse("2026-10-24T12:34:00Z");
  assert.equal(h.exports.money(123456), "$1,234.56");
  assert.equal(h.exports.moneyShort(123400), "$1,234");
  assert.equal(h.exports.formatDate(ts), new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(ts)));
  assert.equal(h.exports.formatTime(ts), new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(ts)));
  const child = harness("Child.jsx"), state = stateFixture();
  const card = child.render(child.exports.FlipPostcard, { place: state.catalog.places.chicago, bearName: "Maple", to: "Mia", collectedAt: ts });
  const postmark = nodes(card, (n) => n.props.className === "postmark")[0];
  assert.equal(postmark.props["aria-label"], `Collected ${h.exports.formatDate(ts)}`);
  for (const name of ["Child.jsx", "Parent.jsx", "Postcard.jsx"]) {
    const source = await readFile(new URL(`src/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /toLocale(?:Date|Time)?String\(/, name);
  }
});

test("D7: reversed ledgers carry visible and accessible status copy", () => {
  const state = stateFixture();
  state.transactions = [{ id: "dup", status: "reversed", amount: 500, memo: "Allowance", ts: Date.now(), from: "parent", to: "savings" }];
  const kid = harness("Child.jsx");
  const ledger = kid.render(kid.exports.MoneySheet, { state });
  const reversed = nodes(ledger, (n) => n.type === "li" && n.props.className === "reversed")[0];
  assert.match(reversed.props["aria-label"], /Allowance, \$5.00, reversed/);
  assert.match(text(reversed), /reversed/);
  const parent = harness("Parent.jsx");
  assert.match(text(parent.render(parent.exports.Activity, { state })), /duplicate reversed by Guardian/);
});

test("D8: upcoming milestone names the item and Dress-up explains saving to unlock", () => {
  const state = stateFixture();
  state.child.milestonesUnlocked.push(2500);
  const home = harness("Child.jsx");
  const tree = home.render(home.exports.Home, { state });
  assert.match(text(tree).replace(/\s+/g, " "), /Next: Flower crown at \$50/);
  assert.doesNotMatch(text(tree), /Flower crown unlocked/);
  const dress = harness("Child.jsx");
  assert.match(text(dress.render(dress.exports.DressSheet, { state })), /Save \$50 to unlock/);
});

test("D9: savings changes preserve reward drafts; unrelated security changes preserve allowance drafts", () => {
  const state = stateFixture(), goals = harness("Parent.jsx");
  let tree = goals.render(goals.exports.Goals, { state });
  const savingsKey = nodes(tree, (n) => n.type?.name === "SavingsGoal")[0].props.key;
  nodes(tree, (n) => n.type === "input")[0].props.onChange({ target: { value: "A draft worth keeping" } });
  state.goals[0] = { ...state.goals[0], target: 7000 };
  tree = goals.render(goals.exports.Goals, { state });
  assert.equal(nodes(tree, (n) => n.type === "input")[0].props.value, "A draft worth keeping");
  assert.notEqual(nodes(tree, (n) => n.type?.name === "SavingsGoal")[0].props.key, savingsKey);
  const allowance = harness("Parent.jsx");
  tree = allowance.render(allowance.exports.Allowance, { state });
  nodes(tree, (n) => n.type === "input")[0].props.onChange({ target: { value: "17" } });
  state.settings.buddyEnabled = false;
  state.settings.timezone = "America/Los_Angeles";
  tree = allowance.render(allowance.exports.Allowance, { state });
  assert.equal(nodes(tree, (n) => n.type === "input")[0].props.value, "17");
});

test("D10: server reveal receipts suppress replay on a fresh device; offline acknowledgements sync", async () => {
  const state = stateFixture();
  state.adventures = [{ id: "seen", status: "returned", revealedAt: Date.now(), postcardIds: [] }];
  const fresh = harness("Child.jsx");
  assert.equal(nodes(fresh.render(fresh.exports.default, { state, toast: noop }), (n) => n.type?.name === "ReturnReveal").length, 0);
  const offline = harness("Child.jsx"), calls = [];
  delete state.adventures[0].revealedAt;
  offline.fetch = async (url) => { calls.push(url); return new Response("{}"); };
  const render = (isOffline) => offline.render(offline.exports.default, { state, toast: noop, offline: isOffline });
  let tree = render(true); offline.flush();
  nodes(tree, (n) => n.type?.name === "ReturnReveal")[0].props.onSeen();
  tree = render(true); offline.flush();
  assert.equal(calls.length, 0);
  assert.equal(nodes(tree, (n) => n.type?.name === "ReturnReveal").length, 0);
  render(false); offline.flush();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, ["/api/child/adventure/seen/seen"]);
  assert.ok(offline.storage.get("mq_seen_adv").includes("seen"));
});

test("D12: feedback replaces earlier saves, Map has points once, Lock follows kid-view button", async () => {
  const app = await appHarness(meFixture("child"));
  let tree = app.tree();
  let root = nodes(tree, (n) => n.type?.name === "ChildRoot")[0];
  root.props.toast("Saved $1"); root.props.toast("Saved $2"); root.props.toast("Saved $3");
  tree = app.render(app.exports.default);
  const toasts = nodes(tree, (n) => n.props.className === "toast ok");
  assert.equal(toasts.length, 1);
  assert.match(text(toasts[0]), /Saved \$3/);
  app.timeouts[0]();
  assert.match(text(app.render(app.exports.default)), /Saved \$3/);
  const kid = harness("Child.jsx"), state = stateFixture();
  kid.storage.set("mq_tab", "map");
  tree = kid.render(kid.exports.default, { state, toast: noop });
  assert.equal(nodes(tree, (n) => n.props.title?.startsWith("Adventure points")).length, 1);
  assert.doesNotMatch(text(kid.render(kid.exports.MapScreen, { state })), /40\s+pts/);
  const parent = await appHarness(meFixture("parent", true));
  // Enter parent mode through the authenticated PIN sheet.
  tree = parent.tree();
  const gate = nodes(tree, (n) => n.type?.name === "PinGate")[0];
  gate.props.onOk({ unlockedUntil: parent.now + 900000 });
  tree = parent.render(parent.exports.default);
  const actions = nodes(tree, (n) => n.props.className === "appbar-actions")[0];
  assert.deepEqual(nodes(actions, (n) => n.type === "button").map(text), ["Kid mode", "Lock"]);
  assert.equal(actions.props.children.at(-1).props.children[0], "Lock");
  assert.equal(nodes(actions, (n) => n.type?.name === "SignOut").length, 1);
});

test("D1 / D12: narrow layout keeps badge in flow, feedback below header and tables contained", async () => {
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.surprise-badge \{ position: relative;/);
  assert.match(css, /\.toasts \{ position: fixed; bottom:/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.toasts \{ top: calc\(112px/);
  assert.match(css, /\.role-parent \.appbar \{ height: calc\(144px/);
  assert.match(css, /\.role-parent \.toasts \{ top: calc\(152px/);
  assert.match(css, /\.ptable \{ table-layout: fixed; overflow-wrap: anywhere;/);
  const h = harness("Child.jsx"), state = stateFixture();
  const tree = h.render(h.exports.FlipPostcard, { place: state.catalog.places.chicago, surprise: true });
  assert.equal(tree.props.children[0].props.className, "surprise-badge");
  assert.equal(nodes(tree.props.children[1], (n) => n.props.className === "surprise-badge").length, 0);
});

test("D9: visiting Security keeps previously opened goal and allowance forms mounted", () => {
  const h = harness("Parent.jsx"), state = stateFixture();
  const render = () => h.render(h.exports.default, { state, toast: noop });
  let tree = render();
  byText(tree, "Goals & tasks").props.onClick();
  tree = render();
  assert.equal(nodes(tree, (n) => n.type?.name === "Goals").length, 1);
  byText(tree, "Allowance").props.onClick();
  tree = render();
  const allowance = nodes(tree, (n) => n.type?.name === "Allowance")[0];
  byText(tree, "Friends & privacy").props.onClick();
  state.settings.buddyEnabled = false;
  tree = render();
  assert.equal(nodes(tree, (n) => n.type?.name === "Allowance")[0].props.key, allowance.props.key);
  assert.equal(nodes(tree, (n) => n.type?.name === "Goals").length, 1);
  assert.equal(nodes(tree, (n) => n.type === "div" && n.props.hidden === true).length, 2);
});


test("W2.1: optional cross-origin font failure never rejects service-worker install", async () => {
  const w = await worker();
  w.fetch = async (request) => {
    if (request === "/") return new Response('<script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="https://fonts.googleapis.com/blocked"><link rel="stylesheet" href="https://fonts.googleapis.com/ok">');
    if (String(request).includes("blocked")) throw new Error("CSP or network failure");
    return new Response("asset");
  };
  await assert.doesNotReject(w.trigger("install"));
  for (const asset of ["/", "/assets/app.js", "/assets/app.css", "https://fonts.googleapis.com/ok"]) assert.ok(w.entries.has(new URL(asset, "https://moneyquest.test").href));
});

test("W2.2: paired kids have a sheet sign-out callback and no floating pill", async () => {
  const h = await appHarness(meFixture("child"));
  const tree = h.tree();
  assert.equal(nodes(tree, (n) => n.type?.name === "SignOut").length, 0);
  assert.equal(typeof nodes(tree, (n) => n.type?.name === "ChildRoot")[0].props.onSignOut, "function");
  const root = harness("App.jsx");
  root.fetch = async () => new Response(JSON.stringify(stateFixture()));
  root.render(root.exports.ChildRoot, { childId: "child-one", toast: noop }); root.flush();
  await new Promise(setImmediate);
  const loaded = root.render(root.exports.ChildRoot, { childId: "child-one", toast: noop });
  assert.equal(nodes(loaded, (n) => n.props.className === "kid-signout" || n.type?.name === "SignOut").length, 0);
});

test("W2.3/12: unreachable cold start stays on Loading, retries at 10s and recovers either role", async () => {
  for (const role of ["parent", "child"]) {
    const h = harness("App.jsx"), calls = [];
    h.fetch = async (url) => { calls.push(url); throw new TypeError("Failed to fetch"); };
    h.render(h.exports.default); h.flush(); await new Promise(setImmediate);
    const render = () => { const tree = h.render(h.exports.default); h.flush(); return tree; };
    let tree = render();
    assert.equal(nodes(tree, (n) => n.type?.name === "AuthScreen").length, 0);
    const loading = nodes(tree, (n) => n.type?.name === "Loading")[0];
    assert.ok(loading.props.error);
    const controls = harness("App.jsx").render(h.exports.Loading, loading.props);
    assert.ok(byText(controls, "Try again"));
    await loading.props.onRetry();
    assert.equal(calls.length, 2);
    h.fetch = async (url) => { calls.push(url); return new Response(JSON.stringify(meFixture(role))); };
    assert.equal(h.intervalDelays[0], 10000);
    await h.timers[0]();
    tree = render();
    assert.equal(nodes(tree, (n) => n.type?.name === (role === "parent" ? "ParentRoot" : "ChildRoot")).length, 1);
    assert.equal(calls.length, 3);
    await h.timers[0](); assert.equal(calls.length, 3, "stop auth retries on recovery");
  }
});

test("W2.3: cached parent has a Back to grown-ups control on cold-load error", async () => {
  const h = harness("App.jsx");
  h.storage.set("mq_parent_session", JSON.stringify(meFixture("parent", true)));
  h.fetch = async () => { throw new Error("Offline"); };
  h.render(h.exports.default); h.flush(); await new Promise(setImmediate);
  const tree = h.render(h.exports.default); h.flush();
  const loading = nodes(tree, (n) => n.type?.name === "Loading")[0];
  assert.equal(typeof loading.props.onGrownUps, "function");
  assert.ok(byText(h.exports.Loading(loading.props), "Back to grown-ups"));
  loading.props.onGrownUps();
  assert.equal(nodes(h.render(h.exports.default), (n) => n.type?.name === "PinGate").length, 1);
});

test("W2.12: initial 401 reuses its demo flag with just one auth/me request", async () => {
  const h = harness("App.jsx");
  let calls = 0;
  h.fetch = async () => { calls++; return new Response('{"error":"Sign in","demo":true}', { status: 401 }); };
  h.render(h.exports.default); h.flush(); await new Promise(setImmediate);
  let tree = h.render(h.exports.default); h.flush(); await new Promise(setImmediate);
  tree = h.render(h.exports.default); h.flush();
  const welcome = nodes(tree, (n) => n.type?.name === "AuthScreen")[0];
  assert.equal(welcome.props.demo, true);
  assert.equal(welcome.props.screen, "welcome");
  assert.equal(calls, 1);
  await h.timers[0](); assert.equal(calls, 1);
});

test("W2.4/8: PIN sheet shows attempts, lock deadline in en-US, and password reset without losing the session", async () => {
  const h = harness("App.jsx");
  let resets = 0, unauthorized = 0;
  const props = { onReset: async () => resets++, onOk: noop, onCancel: noop };
  const render = () => h.render(h.exports.PinGate, props);
  h.window.addEventListener("mq:unauthorized", () => unauthorized++);
  changeField(render(), "Parent PIN", "0000");
  h.fetch = async () => new Response('{"error":"Wrong","attemptsLeft":2}', { status: 401 });
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.match(text(render()), /2\s+tries\s+left/);
  h.fetch = async () => new Response('{"error":"Wait","attemptsLeft":0,"retryAfterSeconds":900}', { status: 429 });
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.ok(text(render()).replace(/\s+/g, " ").includes(`Locked for 15 minutes — try again at ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(h.now + 900000)}`));
  assert.equal(byText(render(), "Unlock").props.disabled, true);
  byText(render(), "Forgot PIN?").props.onClick();
  changeField(render(), "Password", "wrong password");
  h.fetch = async () => new Response('{"error":"That password did not match"}', { status: 401 });
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.match(text(render()), /That password did not match/);
  assert.equal(unauthorized, 0);
  h.fetch = async (url, options) => {
    assert.equal(url, "/api/parent/pin/reset");
    assert.deepEqual(JSON.parse(options.body), { password: "right password" });
    return new Response('{"ok":true,"unlockedUntil":0}');
  };
  changeField(render(), "Password", "right password");
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(resets, 1);
});

test("W2.6: Devices lists pairing metadata and unlinks only the selected device using DELETE", async () => {
  const h = harness("Parent.jsx"), calls = [];
  const props = { childId: "child-two" };
  h.fetch = async (url, options) => {
    calls.push([url, options.method]);
    return new Response(JSON.stringify(options.method === "DELETE" ? { ok: true } : [{ id: "opaque-id", name: "Safari on iPhone", created_at: h.now, last_seen: h.now }]));
  };
  const render = () => h.render(h.exports.Devices, props);
  render(); h.flush(); await new Promise(setImmediate);
  assert.match(text(render()), /Safari on iPhone.*Paired.*Last seen/);
  await byText(render(), "Unlink").props.onClick();
  assert.deepEqual(calls, [["/api/parent/children/child-two/devices?child=child-two", "GET"], ["/api/parent/children/child-two/devices/opaque-id?child=child-two", "DELETE"]]);
  assert.match(text(render()), /No paired devices yet/);
});

test("W2.7: Lock, Kid mode and PIN cancel await server lock; failed locks keep parent mode", async () => {
  for (const action of ["Lock", "Kid mode", "cancel"]) {
    const me = meFixture("parent", true); me.unlockedUntil = Date.now() + 900000;
    const h = await appHarness(me), requests = [];
    h.fetch = async (url) => { requests.push(url); return new Response('{"ok":true,"unlockedUntil":0}'); };
    let tree = h.tree();
    if (action === "cancel") {
      await byText(tree, "Lock").props.onClick();
      tree = h.tree(); requests.length = 0;
      await nodes(tree, (n) => n.type?.name === "PinGate")[0].props.onCancel();
    } else await byText(tree, action).props.onClick();
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0], h.location).pathname, "/api/parent/lock");
    assert.equal(nodes(h.tree(), (n) => n.type?.name === "ParentRoot").length, 0);
    assert.equal(JSON.parse(h.storage.get("mq_parent_session")).unlockedUntil, 0);
  }
  const me = meFixture("parent", true); me.unlockedUntil = Date.now() + 900000;
  const h = await appHarness(me);
  h.fetch = async () => { throw new Error("Offline"); };
  await byText(h.tree(), "Lock").props.onClick();
  assert.equal(nodes(h.tree(), (n) => n.type?.name === "ParentRoot").length, 1);
});

test("W2.9: demo controls render only when me.demo is strictly true", () => {
  const state = stateFixture();
  for (const value of [undefined, false, "true", true]) {
    const h = harness("Parent.jsx");
    let tree = h.render(h.exports.default, { state, me: { ...meFixture(), demo: value }, toast: noop });
    const ctx = nodes(tree, (n) => n.type?.name === "Inbox")[0].props;
    assert.equal(ctx.demo, value === true);
    for (const [name, labels] of [["Inbox", ["Add $50"]], ["Allowance", ["Fast-forward", "Add $50"]], ["Guardian", ["Post a duplicate"]], ["Settings", ["Reset demo"]]]) {
      const component = harness("Parent.jsx");
      tree = component.render(component.exports[name], { state, demo: ctx.demo, pending: [{ id: "a", title: "Funding", kind: "topup" }] });
      for (const label of labels) assert.equal(Boolean(byText(tree, label)), value === true, `${name} ${label}`);
    }
  }
});

test("W2c.2: every family has the funding form, with validated fields, ledger copy and demo-only shortcuts", async () => {
  for (const demo of [false, true]) {
    const h = harness("Parent.jsx"), state = stateFixture(), requests = [];
    let succeeds = false;
    const props = { state, demo, busy: false, run: async (path, body) => { requests.push([path, { ...body }]); return succeeds ? { ok: true } : null; } };
    const render = () => h.render(h.exports.Allowance, props);
    let tree = render();
    assert.ok(text(tree).includes("This is a record of money you have set aside; MoneyQuest never moves real money."));
    assert.equal(Boolean(byText(tree, "Add $50")), demo);
    assert.equal(Boolean(byText(tree, "Fast-forward")), demo);
    const form = () => nodes(render(), (n) => n.type === "form" && n.props["aria-label"] === "Add money")[0];
    const inputs = nodes(form(), (n) => n.type === "input");
    assert.equal(inputs[0].props.required, true);
    assert.equal(inputs[0].props.min, "1");
    assert.equal(inputs[0].props.max, "1000");
    assert.equal(inputs[0].props.step, "0.01");
    assert.equal(inputs[1].props.maxLength, 120);
    changeField(tree, "Amount ($)", "25.50");
    changeField(render(), "Note (optional)", "Birthday envelope");
    await form().props.onSubmit(submit);
    assert.equal(nodes(form(), (n) => n.type === "input")[0].props.value, "25.50", "failed submission preserves draft");
    succeeds = true;
    await form().props.onSubmit(submit);
    assert.deepEqual(requests, [["parent/funding/add", { amount: "25.50", note: "Birthday envelope" }], ["parent/funding/add", { amount: "25.50", note: "Birthday envelope" }]]);
    assert.ok(nodes(form(), (n) => n.type === "input").every((n) => n.props.value === ""), "successful submission clears draft");
    props.busy = true;
    assert.ok(nodes(form(), (n) => n.type === "input" || n.type === "button").every((n) => n.props.disabled));
    if (demo) {
      props.busy = false;
      await byText(render(), "Add $50").props.onClick();
      assert.deepEqual(requests.at(-1), ["parent/topup", { amount: 50 }]);
    }
  }
});

test("W2c.3: zero-funding Overview and escalation buttons open Allowance and focus Add money", () => {
  const state = stateFixture();
  const overview = harness("Parent.jsx");
  for (const [balance, amount, visible] of [[0, 1000, true], [100, 1000, false], [0, 0, false]]) {
    state.accounts.parent.balance = balance;
    state.allowance.amount = amount;
    const tree = overview.render(overview.exports.Overview, { state });
    assert.equal(Boolean(byText(tree, "Add money")), visible);
    if (visible) assert.ok(text(tree).includes("Add money to the funding record so Maple's allowance can be paid"));
  }
  state.accounts.parent.balance = 0;
  state.allowance.amount = 1000;
  const h = harness("Parent.jsx");
  const props = { state, me: meFixture(), toast: noop };
  const render = () => h.render(h.exports.default, props);
  byText(render(), "Overview").props.onClick();
  const overviewProps = nodes(render(), (n) => n.type?.name === "Overview")[0].props;
  byText(overview.render(overview.exports.Overview, overviewProps), "Add money").props.onClick();
  const allowanceProps = () => nodes(render(), (n) => n.type?.name === "Allowance")[0].props;
  assert.equal(allowanceProps().fundingFocus, 1);
  assert.equal(byText(render(), "Allowance").props["aria-current"], "page");
  const allowance = harness("Parent.jsx");
  const form = allowance.render(allowance.exports.Allowance, allowanceProps());
  let focused = 0;
  nodes(form, (n) => n.type === "input" && n.props.ref)[0].props.ref.current = { focus: () => focused++ };
  allowance.flush();
  assert.equal(focused, 1);
  const inbox = harness("Parent.jsx");
  const tree = inbox.render(inbox.exports.Inbox, { ...overviewProps, pending: [{ id: "funding", kind: "topup", title: "Funding needed" }] });
  byText(tree, "Add money").props.onClick();
  assert.equal(allowanceProps().fundingFocus, 2);
  allowance.render(allowance.exports.Allowance, allowanceProps());
  allowance.flush();
  assert.equal(focused, 2);
});

test("W2c.2: funding form uses the selected-child API, refreshes on success and guards duplicate submissions", async () => {
  const h = harness("api.js"), state = stateFixture(), requests = [];
  h.exports.setSelectedChild("child-funding");
  let resolve, changed = 0;
  h.window.addEventListener("mq:changed", () => changed++);
  h.fetch = (url, options) => { requests.push([url, JSON.parse(options.body)]); return new Promise((done) => { resolve = done; }); };
  const formHarness = harness("Parent.jsx");
  const render = () => {
    const [run, busy] = h.render(() => h.exports.useAction(h.toast));
    return formHarness.render(formHarness.exports.Allowance, { state, run, busy });
  };
  changeField(render(), "Amount ($)", "10");
  const form = () => nodes(render(), (n) => n.type === "form" && n.props["aria-label"] === "Add money")[0];
  const first = form().props.onSubmit(submit);
  await form().props.onSubmit(submit);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0][0], h.location).pathname, "/api/parent/funding/add");
  assert.equal(new URL(requests[0][0], h.location).searchParams.get("child"), "child-funding");
  assert.deepEqual(requests[0][1], { amount: "10", note: "" });
  assert.equal(byText(form(), "Add money").props.disabled, true);
  resolve(new Response('{"ok":true}'));
  await first;
  assert.equal(changed, 1);
  assert.equal(byText(form(), "Add money").props.disabled, false);
});

test("W2.10: kid code errors map reason into distinct warm copy", async () => {
  for (const [reason, message] of [["unknown", "That code doesn't match — check the letters and try again"], ["used_or_expired", "That code was already used or expired. Ask for a new one."]]) {
    const h = harness("App.jsx");
    const render = () => h.render(h.exports.AuthScreen, { screen: "link", onSession: noop });
    changeField(render(), "Kid code", "BC3467");
    h.fetch = async () => new Response(JSON.stringify({ error: "Generic server error", reason }), { status: 400 });
    await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
    assert.ok(text(render()).includes(message));
  }
});

test("W2.11: phone parent grid, forms and tables shrink within the 390px page", async () => {
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 820px\)\s*\{\s*\.parent \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.pform-row \{[^}]*minmax\(min\(150px, 100%\), 1fr\)/);
  assert.match(css, /\.ptable \{ table-layout: fixed; overflow-wrap: anywhere;/);
  assert.match(css, /\.pform label, \.approval-body \{ min-width: 0;/);
});


test("W2.7: explicit lock avoids a protected-state refresh and late locked errors do not reopen Kid mode", async () => {
  const apiClient = harness("api.js");
  let changed = 0;
  apiClient.window.addEventListener("mq:changed", () => changed++);
  await apiClient.exports.api("parent/lock", {});
  assert.equal(changed, 0);
  await apiClient.exports.api("parent/pin", { pin: "1234" });
  assert.equal(changed, 1);
  const me = meFixture("parent", true); me.unlockedUntil = Date.now() + 900000;
  const h = await appHarness(me);
  await byText(h.tree(), "Kid mode").props.onClick();
  h.tree();
  h.window.dispatchEvent(new Event("mq:locked"));
  assert.equal(nodes(h.tree(), (n) => n.type?.name === "PinGate").length, 0);
});

test("H1: child Home shows today's Apple Cash total and last transaction, and Recent tags wallet entries", () => {
  const state = stateFixture();
  state.walletSpent = { today: 425 };
  state.walletLastTransaction = { id: "wallet", memo: "Corner shop", amount: 425, ts: Date.now(), kind: "wallet_spend", status: "posted", to: "merchant" };
  state.transactions.unshift(state.walletLastTransaction);
  const h = harness("Child.jsx");
  let opened;
  const tree = h.render(h.exports.Home, { state, open: (...args) => { opened = args; } });
  const pill = nodes(tree, (n) => n.props.className === "wallet-pill")[0];
  assert.match(text(pill), /Apple Cash.*\$4.25.*today.*Corner shop.*\$4.25/);
  pill.props.onClick();
  assert.equal(JSON.stringify(opened), JSON.stringify(["money", { start: "spend", wallet: true }]));
  const sheet = harness("Child.jsx");
  assert.equal(nodes(sheet.render(sheet.exports.MoneySheet, { state }), (n) => n.props.className === "wallet-tag").length, 1);
});

test("F2: Paid with Apple Cash routes manual spending to the wallet and keeps ordinary spending intact", async () => {
  for (const appleCash of [false, true]) {
    const h = harness("Child.jsx"), calls = [];
    const props = { state: stateFixture(), start: "spend", close: noop, run: async (...args) => { calls.push(args); return {}; } };
    const render = () => h.render(h.exports.MoneySheet, props);
    nodes(render(), (n) => n.type === "input" && n.props.id === "money-amount")[0].props.onChange({ target: { value: "4.25" } });
    changeField(render(), "What did you buy?", "Corner shop");
    byText(render(), appleCash ? "Apple Cash" : "Spending money").props.onClick();
    assert.equal(nodes(render(), (n) => n.type === "input" && n.props.id === "money-amount")[0].props.step, appleCash ? "0.01" : "0.25");
    await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
    assert.equal(calls[0][0], appleCash ? "child/wallet/spend" : "child/spend");
    assert.equal(JSON.stringify(calls[0][1]), JSON.stringify(appleCash ? { amount: 4.25, merchant: "Corner shop" } : { amount: 4.25, memo: "Corner shop" }));
    if (appleCash) assert.match(text(render()), /only if your Shortcut hasn't recorded it/);
  }
});

test("H1: parent Apple Cash activity shows funding and historical purchase flags without a send form", () => {
  const h = harness("Parent.jsx"), state = stateFixture();
  state.accounts.parent.balance = 54500;
  state.walletSpent = { week: 425, month: 425 };
  state.walletTransactions = [{ id: "wallet", ts: Date.now(), kind: "wallet_spend", amount: 425, memo: "Corner shop", uncovered: true }];
  const tree = h.render(h.exports.WalletLedger, { state });
  assert.match(text(tree), /Apple Cash activity.*funding account:.*\$545.00.*week:.*\$4.25.*uncovered/);
  assert.equal(nodes(tree, (n) => n.type === "form").length, 0);
  const activity = harness("Parent.jsx");
  state.transactions = state.walletTransactions.map((t) => ({ ...t, from: "parent", to: "merchant", status: "posted" }));
  assert.match(text(activity.render(activity.exports.Activity, { state })), /Apple Cash.*Funding.*Store.*uncovered/);
});

test("F2: Shortcut card gates token creation on a PIN, scopes rotation and unlink without storing tokens", async () => {
  const h = harness("Parent.jsx"), calls = [], copies = [];
  let unauthorized = 0;
  h.window.addEventListener("mq:unauthorized", () => unauthorized++);
  h.navigator.clipboard = { writeText: async (token) => copies.push(token) };
  const props = { childId: "child-two", pinSet: true };
  const render = () => h.render(h.exports.AppleCashTracking, props);
  const token = "a".repeat(43);
  h.fetch = async (url, options) => {
    calls.push([url, options]);
    if (url.includes("/ping")) return new Response('{"ok":true,"childId":"child-two"}');
    return new Response(JSON.stringify({ token: options.method === "POST" ? token : null, id: options.method === "POST" ? "device" : null, expiresAt: options.method === "POST" ? h.now + 180 * 86400000 : null }));
  };
  render(); h.flush(); await new Promise(setImmediate);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/child/wallet/token?child=child-two");
  assert.equal(calls[0][1].method, "GET");
  await byText(render(), "Generate Shortcut token").props.onClick();
  assert.equal(calls[1][1].method, "POST");
  assert.equal(nodes(render(), (n) => n.type === "input" && n.props.readOnly)[0].props.value, token);
  assert.ok(byText(render(), "Rotate Shortcut token"));
  await byText(render(), "Copy token").props.onClick();
  assert.deepEqual(copies, [token]);
  assert.equal(nodes(render(), (n) => n.type === "a")[0].props.href, "/help/apple-cash");
  assert.equal(nodes(render(), (n) => n.type === "ol" || n.type === "pre").length, 0);
  assert.ok(![...h.storage.values(), ...h.session.values()].some((value) => value.includes(token)));
  await byText(render(), "Unlink").props.onClick();
  assert.equal(calls[2][0], "/api/parent/children/child-two/devices/device?child=child-two");
  assert.equal(calls[2][1].method, "DELETE");
  assert.equal(unauthorized, 0);
  assert.equal(nodes(render(), (n) => n.type === "input").length, 0);
  const noPin = harness("Parent.jsx");
  const noPinTree = noPin.render(noPin.exports.AppleCashTracking, { childId: "child-two", pinSet: false });
  assert.match(text(noPinTree), /Set a parent PIN in Security/);
  assert.equal(nodes(noPinTree, (n) => n.type === "button").length, 0);
});

test("F2: token endpoints trigger the parent PIN gate and do not store credentials in cached state", async () => {
  const h = harness("api.js");
  let locked = 0;
  h.window.addEventListener("mq:locked", () => locked++);
  h.fetch = async () => new Response('{"error":"Please unlock parent mode"}', { status: 403 });
  await assert.rejects(h.exports.api("child/wallet/token?child=child-two"), { status: 403 });
  assert.equal(locked, 1);
  h.exports.setSelectedChild("child-one");
  h.fetch = async (url, options) => {
    assert.equal(url, "/api/parent/wallet/send?child=child-one");
    assert.equal(options.credentials, "same-origin");
    return new Response('{"ok":true}');
  };
  await h.exports.api("parent/wallet/send", { amount: 10 });
  assert.equal(h.storage.size, 0);
});

test("W3.1: offline action and ChildRoot notices use Bo's name", async () => {
  const action = harness("api.js");
  action.fetch = () => assert.fail("offline actions must not fetch");
  await action.render(() => action.exports.useAction(action.toast, true, "Bo"))[0]("child/save", {});
  assert.equal(action.notices[0][0], "You're offline — Bo's postcards are still here!");
  const h = harness("App.jsx"), state = stateFixture();
  state.child.bear.name = "Bo";
  h.storage.set("mq_last_state", JSON.stringify(state));
  h.fetch = async () => { throw new Error("Offline"); };
  const render = () => h.render(h.exports.ChildRoot, { toast: h.toast });
  render(); h.flush(); await new Promise(setImmediate);
  render(); h.flush();
  assert.equal(h.notices[0][0], "You're offline — Bo's postcards are still here!");
});

test("W3.2: a 12-line reply stays in a bordered bubble with a separate inner scroll box", async () => {
  const h = harness("Child.jsx");
  h.window.matchMedia = () => ({ matches: true });
  const reply = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}: a small saving step.`).join("\n");
  const render = () => h.render(h.exports.SpeechBubble, { text: reply });
  render(); h.flush();
  const tree = render();
  const content = nodes(tree, (n) => n.props.className === "bear-bubble-text")[0];
  assert.equal(content.props.children[0].props.text, reply);
  assert.ok(tree.props.children.includes(content), "text is inside the border-owning element");
  assert.equal(nodes(tree, (n) => n.type === "svg").length, 0, "no scaled outline ending above the last line");
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  const outer = css.match(/\.bear-bubble\s*\{([^}]+)\}/)[1];
  const inner = css.match(/\.bear-bubble-text\s*\{([^}]+)\}/)[1];
  assert.match(outer, /border: 2px solid/);
  assert.match(outer, /border-radius:/);
  assert.match(outer, /padding: 15px 58px 15px 18px/);
  assert.doesNotMatch(outer, /(?:^|;)\s*(?:max-)?height:|overflow-y:/, "border grows with the content box");
  assert.match(inner, /max-height: 96px/);
  assert.match(inner, /overflow-y: auto/);
  assert.match(inner, /white-space: pre-wrap/);
  assert.match(css, /\.bear-bubble::after\s*\{[^}]*bottom: -11px/);
});

test("W3.3: PIN lockout stays inline without a rate-limit toast", async () => {
  const h = harness("App.jsx");
  let limited = 0;
  h.window.addEventListener("mq:rate-limit", () => limited++);
  h.fetch = async () => new Response(JSON.stringify({ error: "Let's take a little break", attemptsLeft: 0, retryAfterSeconds: 900 }), { status: 429 });
  const render = () => h.render(h.exports.PinGate, { onCancel: noop });
  changeField(render(), "Parent PIN", "0000");
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(limited, 0);
  assert.match(text(render()), /Locked for 15 minutes/);
  assert.equal(byText(render(), "Unlock").props.disabled, true);
});

test("W3.4: Show all activity renders old and new settings and allowance entries as sentences", () => {
  const h = harness("Parent.jsx"), state = stateFixture();
  state.audit = [
    { id: "old", ts: h.now, actor: "parent", action: "settings", detail: 'Updated settings: {"timezone":"America/Los_Angeles","buddyEnabled":false}' },
    { id: "new", ts: h.now, actor: "parent", action: "settings", detail: "Team challenge turned off" },
    { id: "money", ts: h.now, actor: "parent", action: "allowance_updated", detail: "Allowance 10.00/wk, 50% saved" },
  ];
  const render = () => h.render(h.exports.Guardian, { state, run: noop });
  const checkbox = nodes(render(), (n) => n.type === "input" && n.props.type === "checkbox")[0];
  checkbox.props.onChange({ target: { checked: true } });
  const copy = text(render());
  assert.match(copy, /Time zone set to America\/Los_Angeles. Buddy turned off/);
  assert.match(copy, /Team challenge turned off/);
  assert.match(copy, /Allowance \$10.00\/wk/);
  assert.doesNotMatch(copy, /Updated settings:|\{"/);
});

const childPreferenceKeys = ["mq_tab", "mq_seen_adv", "mq_muted", "mq_album_baseline:one", "mq_album_baseline:two", "mq_opened_cards:one", "mq_opened_cards:two"];
const fillChildPreferences = (h) => {
  for (const key of childPreferenceKeys) h.storage.set(key, key === "mq_tab" ? "album" : "[]");
  h.storage.set("unrelated-setting", "keep");
};
const assertChildPreferencesCleared = (h) => {
  for (const key of childPreferenceKeys) assert.equal(h.storage.has(key), false, key);
  assert.equal(h.storage.get("unrelated-setting"), "keep");
  const child = harness("Child.jsx");
  for (const [key, value] of h.storage) child.storage.set(key, value);
  const tree = child.render(child.exports.default, { state: stateFixture(), toast: noop });
  assert.equal(nodes(tree, (n) => n.type?.name === "Home").length, 1, "re-linked child starts on Home");
};

test("W3.5: revoked kid sessions and Sign out everywhere clear navigation and all child caches", async () => {
  const kid = harness("api.js");
  fillChildPreferences(kid);
  kid.storage.set("mq_child_session", "identity");
  kid.fetch = async () => new Response('{"error":"Unlinked"}', { status: 401 });
  await assert.rejects(kid.exports.api("state"), { status: 401 });
  assertChildPreferencesCleared(kid);
  assert.equal(kid.storage.has("mq_child_session"), false);
  for (const success of [false, true]) {
    const h = await appHarness(meFixture());
    fillChildPreferences(h);
    h.fetch = async () => new Response(success ? "{}" : '{"error":"Try again"}', { status: success ? 200 : 500 });
    const root = nodes(h.tree(), (n) => n.type?.name === "ParentRoot")[0];
    if (success) { await root.props.onSignOutAll(); assertChildPreferencesCleared(h); }
    else {
      await assert.rejects(root.props.onSignOutAll(), { status: 500 });
      for (const key of childPreferenceKeys) assert.equal(h.storage.has(key), true, key);
    }
  }
});

test("W3.5: a matching session reload preserves child navigation; a new identity clears it", async () => {
  for (const sameChild of [true, false]) {
    const h = harness("App.jsx"), me = meFixture("child");
    const state = { ...stateFixture(), childId: sameChild ? me.activeChild.id : "old-child" };
    h.storage.set("mq_child_session", JSON.stringify({ ...me, activeChild: { ...me.activeChild, id: state.childId } }));
    h.storage.set("mq_last_state", JSON.stringify(state));
    fillChildPreferences(h);
    h.fetch = async () => new Response(JSON.stringify(me));
    h.render(h.exports.default); h.flush(); await new Promise(setImmediate);
    if (sameChild) for (const key of childPreferenceKeys) assert.equal(h.storage.has(key), true, key);
    else assertChildPreferencesCleared(h);
  }
});

test("W3.6: money inputs offer decimal keyboards while lesson counts stay numeric", () => {
  const state = stateFixture();
  for (const [file, component, props, expected] of [
    ["Child.jsx", "MoneySheet", { start: "save" }, 1],
    ["Child.jsx", "MoneySheet", { start: "spend" }, 1],
    ["Parent.jsx", "Goals", {}, 1],
    ["Parent.jsx", "SavingsGoal", {}, 1],
    ["Parent.jsx", "Allowance", {}, 3],
    ["Parent.jsx", "WalletLedger", {}, 0],
  ]) {
    const h = harness(file), tree = h.render(h.exports[component], { state, run: noop, ...props });
    const decimal = nodes(tree, (n) => n.type === "input" && n.props.inputMode === "decimal");
    assert.equal(decimal.length, expected, component);
    assert.ok(decimal.every((n) => n.props.type === "number"));
    if (component === "Goals") assert.equal(nodes(tree, (n) => n.type === "input" && n.props.value === catalog.LESSONS.length && n.props.max === catalog.LESSONS.length)[0].props.inputMode, undefined);
  }
});

test("0.8.8: speech tries Cartesia token then proxy then browser; a muted reply sends no voice requests", async () => {
  const h = harness("Child.jsx"), calls = [], spoken = [];
  h.window.speechSynthesis = { cancel: noop, speak: (u) => spoken.push(u.text) };
  h.fetch = async (url) => { calls.push(url); return new Response("unavailable", { status: 503 }); };
  await h.exports.speak("A little *saving*!", "cartesia");
  assert.deepEqual(calls, ["/api/voice/token", "/api/buddy/speak"]);
  assert.deepEqual(spoken, ["A little saving!"]);
  calls.length = 0; spoken.length = 0;
  await h.exports.speak("Plain browser voice", "browser");
  assert.deepEqual(calls, []); assert.deepEqual(spoken, ["Plain browser voice"]);
  spoken.length = 0;
  h.storage.set("mq_muted", "true");
  const props = { state: stateFixture(), run: async () => ({ reply: "A little saving!" }) };
  const talk = h.render(h.exports.useMapleTalk, props); h.flush();
  assert.equal(talk.muted, true);
  await talk.send("Hi");
  assert.equal(calls.length, 0); assert.equal(spoken.length, 0);
});

test("0.8.8: a late voice fallback is suppressed after mute or leaving the turn; mute persists and stops sound", async () => {
  const h = harness("Child.jsx"), spoken = [], cancelled = [];
  h.window.speechSynthesis = { cancel: () => cancelled.push(1), speak: (u) => spoken.push(u.text) };
  let enabled = true, finish;
  h.fetch = () => new Promise((r) => { finish = r; });
  const speech = h.exports.speak("A late reply", "cartesia", () => enabled);
  enabled = false;
  finish(new Response("unavailable", { status: 503 }));
  await speech;
  assert.equal(spoken.length, 0);
  const props = { state: stateFixture(), run: async () => ({ reply: "Hello!" }) };
  let talk = h.render(h.exports.useMapleTalk, props); h.flush();
  assert.equal(talk.muted, false);
  talk.toggleMute(); assert.equal(h.storage.get("mq_muted"), "true"); assert.ok(cancelled.length >= 1, "muting stops any sound");
  talk = h.render(h.exports.useMapleTalk, props); assert.equal(talk.muted, true);
  talk.toggleMute(); assert.equal(h.storage.get("mq_muted"), "false");
});

test("0.8.8: legible sound toggle in the talk bar", () => {
  for (const muted of [false, true]) {
    const h = harness("Child.jsx"), state = stateFixture();
    let toggles = 0;
    const tree = h.render(h.exports.TalkBar, { state, talk: { muted, toggleMute: () => toggles++, close: noop, send: noop }, open: noop });
    const button = nodes(tree, (n) => n.type === "button" && n.props["aria-label"] === (muted ? "Sound off" : "Sound on"))[0];
    assert.equal(button.props["aria-pressed"], muted);
    assert.equal(button.props.title, muted ? "Sound off" : "Sound on");
    assert.equal(nodes(button, (n) => n.type?.name === "Icon")[0].props.name, muted ? "speakerOff" : "speaker");
    button.props.onClick(); assert.equal(toggles, 1);
  }
});

test("0.8.8: closing the talk bar, dismissing the bubble or leaving Home drops the reply in flight and stops sound", async (t) => {
  const h = harness("Child.jsx"), spoken = [], cancelled = [];
  h.window.speechSynthesis = { cancel: () => cancelled.push(1), speak: (u) => spoken.push(u.text) };
  let finish;
  const props = { state: stateFixture(), run: () => new Promise((r) => { finish = r; }), tab: "home" };
  let talk = h.render(h.exports.useMapleTalk, props); h.flush();
  talk.open(); talk = h.render(h.exports.useMapleTalk, props);
  const pending = talk.send("Hi"); talk = h.render(h.exports.useMapleTalk, props);
  assert.equal(talk.bubble, "…");
  talk.close(); finish({ reply: "Too late!" }); assert.equal(await pending, false);
  talk = h.render(h.exports.useMapleTalk, props);
  assert.equal(talk.bubble, ""); assert.equal(talk.isOpen, false); assert.equal(spoken.length, 0);
  talk.open(); talk = h.render(h.exports.useMapleTalk, props);
  const second = talk.send("Again"); talk = h.render(h.exports.useMapleTalk, props);
  talk.dismiss(); finish({ reply: "Too late again!" }); assert.equal(await second, false);
  talk = h.render(h.exports.useMapleTalk, props); assert.equal(talk.bubble, "");
  talk.open(); talk = h.render(h.exports.useMapleTalk, props);
  const third = talk.send("Once more"); talk = h.render(h.exports.useMapleTalk, props);
  talk = h.render(h.exports.useMapleTalk, { ...props, tab: "map" }); h.flush();
  finish({ reply: "From another tab" }); assert.equal(await third, false);
  talk = h.render(h.exports.useMapleTalk, { ...props, tab: "map" });
  assert.equal(talk.isOpen, false); assert.equal(talk.bubble, ""); assert.equal(spoken.length, 0);
  assert.ok(cancelled.length >= 3, "each close/dismiss/leave stops sound");
  talk = h.render(h.exports.useMapleTalk, props); h.flush();
  talk.open(); talk = h.render(h.exports.useMapleTalk, props);
  const fourth = talk.send("Back home"); finish({ reply: "Hello again!" }); assert.equal(await fourth, true);
  talk = h.render(h.exports.useMapleTalk, props); assert.equal(talk.bubble, "Hello again!");
});
