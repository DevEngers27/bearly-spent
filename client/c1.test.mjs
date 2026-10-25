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
  const extra = { "Child.jsx": "Home, MoneySheet, LessonSheet, Missions, Buddy, MapScreen, MapView, Friends, DressSheet, BudgetSheet, PlaceSheet", "Parent.jsx": "Overview, Goals, Allowance, Inbox, Guardian, Settings, Children, Security, BuddyLog", "App.jsx": "PinGate, Loading, AuthScreen, ChildRoot" }[name];
  const result = await build({
    stdin: { contents: await readFile(new URL(`src/${name}`, import.meta.url), "utf8") + (extra ? `\nexport { ${extra} };` : ""), resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
    bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" },
  });
  return [name, result.outputFiles[0].text];
})));

function harness(name) {
  const slots = [], pending = [], timers = [], notices = [], streams = [];
  const storage = new Map(), session = new Map();
  const window = new EventTarget();
  let cursor = 0;
  const env = { now: Date.now(), fetch: async () => new Response("{}"), slots, pending, notices, storage, session, window, timers, streams };
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
  const storageApi = (map) => ({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) });
  env.document = { activeElement: null, visibilityState: "visible", body: { classList: { add() {}, remove() {} } }, addEventListener() {}, removeEventListener() {} };
  env.location = new URL("https://moneyquest.test/");
  env.navigator = { serviceWorker: new EventTarget() };
  const module = { exports: {} };
  vm.runInNewContext(sources[name], {
    module, exports: module.exports, require: () => hooks,
    h: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }), Fragment: "fragment",
    window, document: env.document, navigator: env.navigator, sessionStorage: storageApi(session), localStorage: storageApi(storage),
    location: env.location, history: { replaceState: (a, b, url) => { env.location.href = url.href; } },
    fetch: (...args) => env.fetch(...args), Event, URL, URLSearchParams, console,
    EventSource: class { constructor(url) { this.url = url; streams.push(this); } close() { this.closed = true; } },
    Date: class extends Date { static now() { return env.now; } },
    setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval() {}, setTimeout() {},
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
  assert.equal(offline.notices[0][0], "You're offline — Maple's postcards are still here!");
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
  assert.equal(button.props.disabled, true);
  assert.doesNotMatch(text(button), /\+50/);
});

test("Lesson replay copy and failed final submission retry use the original answer count", async () => {
  const h = harness("Child.jsx"), lesson = catalog.LESSONS[0];
  let attempts = 0;
  const props = { lesson, close: noop, run: async (path, body) => {
    assert.equal(body.answers.length, lesson.questions.length);
    return ++attempts === 1 ? null : { correct: body.answers.length, total: body.answers.length, passed: true, firstTime: false };
  } };
  for (let i = 0; i < lesson.questions.length + 1; i++) {
    const tree = h.render(h.exports.LessonSheet, props);
    await nodes(tree, (n) => n.type === "button")[0].props.onClick();
  }
  const result = h.render(h.exports.LessonSheet, props);
  assert.match(text(result), /Nice review! No extra points for repeats\./);
  assert.doesNotMatch(text(result), /\+20/);
});

test("C7 / C16: empty goals render friendly cards and an unknown stored tab opens Home", () => {
  const state = stateFixture(); state.goals = [];
  for (const [file, name] of [["Child.jsx", "Home"], ["Child.jsx", "Buddy"], ["Parent.jsx", "Overview"], ["Parent.jsx", "Goals"]]) {
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
  assert.notEqual(getSection("Goals & tasks").props.key, goal.props.key);
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
async function appHarness(me) {
  const h = harness("App.jsx");
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
  byText(tree, "Kid mode").props.onClick();
  tree = h.tree();
  nodes(tree, (n) => n.type?.name === "ChildRoot")[0].props.onGrownUps();
  tree = h.tree();
  assert.equal(nodes(tree, (n) => n.type?.name === "PinGate").length, 1);
  nodes(tree, (n) => n.type?.name === "PinGate")[0].props.onOk({ unlockedUntil: h.now + 900000 });
  byText(h.tree(), "Lock").props.onClick();
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
  await w.trigger("message", { data: { type: "mq:cache-art", images: ["/postcards/chicago.png", "/bear/poses/bear_front.png", "/api/state", "https://other.test/postcards/test.png"] } });
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
    ["Child.jsx", "PlaceSheet", { id: "seattle" }, ["Send Maple"]],
    ["Child.jsx", "Friends", {}, ["Propose swap", game.GREETINGS[0], "Send"]],
    ["Child.jsx", "Buddy", {}, ["Send", "Can I buy"]],
    ["Parent.jsx", "Inbox", { pending: [{ id: "a", kind: "reward", title: "Reward", amount: 500 }, { id: "b", kind: "topup", title: "Funding" }] }, ["Approve", "Decline", "Mark handled", "Add $50"]],
    ["Parent.jsx", "Goals", {}, ["Create goal", "Assign task", "Update"]],
    ["Parent.jsx", "Allowance", {}, ["Save rules", "Add $50", "Fast-forward"]],
    ["Parent.jsx", "Guardian", {}, ["Post a duplicate"]],
    ["Parent.jsx", "Settings", {}, ["Reset demo"]],
    ["App.jsx", "PinGate", {}, ["Unlock"]],
  ];
  for (const [file, component, extra, buttons] of checks) {
    const h = harness(file);
    const render = () => h.render(h.exports[component], { state, busy: true, run: noop, ...extra });
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
  const h = await appHarness(meFixture());
  let tree = h.tree();
  h.window.dispatchEvent(new Event("mq:unauthorized"));
  tree = h.render(h.exports.default); h.flush();
  assert.equal(nodes(tree, (n) => n.type?.name === "AuthScreen")[0].props.screen, "welcome");
  let reloads = 0;
  h.location.reload = () => reloads++;
  h.navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
  tree = h.render(h.exports.default); h.flush();
  byText(tree, "Updated! Tap to reload").props.onClick();
  assert.equal(reloads, 1);
  const loading = h.render(h.exports.Loading, { error: new Error("Failed to fetch") });
  assert.equal(text(loading).trim(), "Can't reach MoneyQuest right now. Check your connection and try again.");
});

// Wave 2 account integration: exercise real event handlers without sockets.
test("B5b: cookies and selected child reach actions, state, chat cursors and audio; public login has no child query", async () => {
  const h = harness("api.js"), requests = [];
  h.fetch = async (url, options) => { requests.push({ url, options }); return new Response("{}"); };
  h.exports.setSelectedChild("child two");
  for (const [path, body] of [["state"], ["parent/goal", { title: "Read" }], ["parent/state?before=msg-1"], ["voice/token", {}], ["buddy/speak", { text: "Hi" }], ["auth/me"], ["auth/login", { email: "a@b.test", password: "password" }]]) await h.exports.api(path, body);
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
      assert.equal(body.childAge, 10);
      assert.equal(body.parentName, "Jordan");
      assert.equal(body.childName, "Mia");
      assert.equal(body.bearName, "Maple");
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
  const h = await appHarness(meFixture("child")), calls = [];
  h.storage.set("mq_last_state", JSON.stringify(stateFixture()));
  h.fetch = async (url, options) => { calls.push([url, options]); return new Response("{}"); };
  await nodes(h.tree(), (n) => n.type?.name === "ChildRoot")[0].props.onSignOut();
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
  await nodes(tree, (n) => n.type === "button" && text(n).includes("Generate kid code"))[1].props.onClick();
  tree = render();
  assert.equal(requests[0][0], "/api/parent/children/child-two/link?child=child-two");
  assert.match(text(tree), /Expires in\s+15\s*:\s*00/);
  assert.equal(nodes(tree, (n) => n.type === "input" && n.props.readOnly)[0].props.value, "BC3467");
  h.now += 900001; h.timers[0]();
  assert.match(text(render()), /This code expired/);
  for (const [label, value] of [["Child's name", "Leo"], ["Age", "8"], ["Bear's name", "Pip"]]) changeField(render(), label, value);
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.deepEqual(requests[1], ["/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" }]);
  assert.equal(refreshed, 1);
});

test("B5b: Security sets or changes PIN and makes unavailable global sign-out explicit", async () => {
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
    assert.equal(byText(render(), "Sign out everywhere").props.disabled, true);
    assert.match(text(render()), /isn't available yet/);
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
  await kid.api("auth/logout", {});
  await assert.rejects(kid.api("auth/me"), { status: 401 });
  assert.equal((await parent.api("auth/me")).role, "parent");
});

test("B5b: Welcome handles demo discovery on both public success and unauthenticated error responses", async () => {
  for (const status of [200, 401]) {
    const h = harness("App.jsx");
    h.fetch = async () => new Response(JSON.stringify({ demo: true, ...(status === 401 ? { error: "Sign in" } : {}) }), { status });
    h.render(h.exports.default); h.flush();
    await new Promise(setImmediate);
    const tree = h.render(h.exports.default); h.flush();
    const welcome = nodes(tree, (n) => n.type?.name === "AuthScreen")[0];
    assert.equal(welcome.props.screen, "welcome");
    assert.equal(welcome.props.demo, true);
    assert.equal(welcome.props.error, null);
  }
});
