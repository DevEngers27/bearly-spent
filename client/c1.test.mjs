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
import { dayKey, weekKey } from "../server/time.js";

const sources = Object.fromEntries(await Promise.all(["api.js", "Child.jsx", "Parent.jsx", "App.jsx"].map(async (name) => {
  const extra = { "Child.jsx": "Home, Sheet, MoneySheet, LessonSheet, Missions, Buddy, MapScreen, MapView, Friends, DressSheet, BudgetSheet, PlaceSheet, TalkBar, useMapleTalk, SpeechBubble, ReturnReveal, Album, countdown, speak, BearFigure, FlipPostcard, PostcardTile", "Parent.jsx": "Overview, Goals, Allowance, Inbox, Guardian, Settings", "App.jsx": "PinGate, Loading" }[name];
  const result = await build({
    stdin: { contents: await readFile(new URL(`src/${name}`, import.meta.url), "utf8") + (extra ? `\nexport { ${extra} };` : ""), resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
    bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" },
  });
  return [name, result.outputFiles[0].text];
})));

function harness(name) {
  const slots = [], pending = [], timers = [], timeouts = [], notices = [];
  const storage = new Map(), session = new Map();
  const window = new EventTarget();
  window.scrollTo = () => {};
  let cursor = 0;
  const env = { now: Date.now(), fetch: async () => new Response("{}"), slots, pending, notices, storage, session, window, timers, timeouts };
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
  env.document = { activeElement: null, visibilityState: "visible", body: { classList: { add() {}, remove() {} } }, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
  env.location = new URL("https://moneyquest.test/");
  env.navigator = { serviceWorker: new EventTarget() };
  const module = { exports: {} };
  vm.runInNewContext(sources[name], {
    module, exports: module.exports, require: () => hooks,
    h: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }), Fragment: "fragment",
    window, document: env.document, navigator: env.navigator, sessionStorage: storageApi(session), localStorage: storageApi(storage),
    location: env.location, history: { replaceState: (a, b, url) => { env.location.href = url.href; } },
    fetch: (...args) => env.fetch(...args), Event, URL, URLSearchParams, console,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    Date: class extends Date { static now() { return env.now; } },
    setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval() {}, setTimeout: (fn) => { timeouts.push(fn); return timeouts.length; }, clearTimeout: (id) => { timeouts[id - 1] = null; },
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

test("C6: 401 clears the token and emits unauthorized before the response body arrives", async () => {
  const h = harness("api.js");
  h.exports.setParentToken("old-token");
  let events = 0, finish;
  h.window.addEventListener("mq:unauthorized", () => events++);
  h.fetch = async () => ({ status: 401, ok: false, json: () => new Promise((r) => { finish = r; }) });
  const request = h.exports.api("parent/topup", {});
  await new Promise(setImmediate);
  assert.equal(events, 1);
  assert.equal(h.exports.hasParentToken(), false);
  assert.equal(h.session.has("mq_parent"), false);
  finish({ error: "Locked" });
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
  const source = await readFile(new URL("../server/index.js", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("function childView("), source.indexOf("\nfunction parentView("));
  const childView = vm.runInNewContext(`(${fn})`, { Date, game, dayKey, weekKey, ...catalog, placesView: () => ({}), buddyMode: () => "offline", voiceEnabled: () => false, nessieEnabled: () => false });
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

test("S6 / C16: returning to kid or locking clears the token; PIN URL survives reload", () => {
  const h = harness("App.jsx");
  h.session.set("mq_parent", "stored");
  let tree = h.render(h.exports.default); h.flush();
  nodes(tree, (n) => n.type?.name === "ChildRoot")[0].props.onGrownUps();
  tree = h.render(h.exports.default); h.flush();
  assert.equal(h.session.has("mq_parent"), false);
  assert.equal(h.location.searchParams.get("role"), "parent");
  nodes(tree, (n) => n.type?.name === "PinGate")[0].props.onOk();
  tree = h.render(h.exports.default); h.flush();
  h.session.set("mq_parent", "stored");
  byText(tree, "Back to kid view").props.onClick();
  assert.equal(h.session.has("mq_parent"), false);
  tree = h.render(h.exports.default); h.flush();
  nodes(tree, (n) => n.type?.name === "ChildRoot")[0].props.onGrownUps();
  tree = h.render(h.exports.default); h.flush();
  nodes(tree, (n) => n.type?.name === "PinGate")[0].props.onOk();
  tree = h.render(h.exports.default); h.flush();
  h.session.set("mq_parent", "stored");
  byText(tree, "Lock").props.onClick();
  assert.equal(h.session.has("mq_parent"), false);
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
    ["Child.jsx", "Home", {}, ["Send Maple on a trip"]],
    ["Child.jsx", "Friends", {}, ["Propose swap", game.GREETINGS[0], "Send"]],
    ["Child.jsx", "TalkBar", { talk: { close: noop, send: noop } }, ["Send", "Can I buy"]],
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

test("C6 / C16 / C3: App locks on unauthorized; controllerchange offers explicit reload", () => {
  const h = harness("App.jsx");
  let tree = h.render(h.exports.default); h.flush();
  h.window.dispatchEvent(new Event("mq:unauthorized"));
  tree = h.render(h.exports.default); h.flush();
  assert.equal(nodes(tree, (n) => n.type?.name === "PinGate").length, 1);
  let reloads = 0;
  h.location.reload = () => reloads++;
  h.navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
  tree = h.render(h.exports.default); h.flush();
  byText(tree, "Updated! Tap to reload").props.onClick();
  assert.equal(reloads, 1);
  const loading = h.render(h.exports.Loading, { error: new Error("Failed to fetch") });
  assert.equal(text(loading).trim(), "Can't reach MoneyQuest right now. Check your connection and try again.");
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
  assert.equal(nodes(tree, (n) => n.props.className === "trail" || n.props.className === "walker").length, 0);
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
  state.postcards = [{ id: "new-pc", defId: "seattle", source: "trip" }];
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
  assert.deepEqual(JSON.parse(h.storage.get("mq_opened_cards")), ["new-pc"]);
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
    assert.match(talk.bubble, mode === "off" ? /grown-up switched chatting off/ : mode === "away" ? /on a trip! Back in 0:42/ : /can't chat while we're offline/);
    assert.equal(await talk.send("Hello"), false);
    assert.equal(calls, 0);
  }
});

test("F6: one talk request sets thinking then happy, safety replies rest, and mute persists", async () => {
  const h = harness("Child.jsx"), state = stateFixture();
  h.storage.set("mq_muted", "true");
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
  talk.toggleMute(); assert.equal(h.storage.get("mq_muted"), "false");
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

test("F6: talk bar offers exactly three suggestions, conditional hold-to-talk and transcript link", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  const props = { state, talk: { close: noop, send: async () => false }, open: noop };
  let tree = h.render(h.exports.TalkBar, props);
  assert.equal(nodes(tree, (n) => n.props.className === "chip").length, 3);
  assert.ok(byText(tree, "Can I buy a $15 toy?"));
  assert.equal(nodes(tree, (n) => n.props["aria-label"] === "Hold to talk").length, 0);
  let session, stopped = 0;
  h.window.SpeechRecognition = class { constructor() { session = this; } start() {} stop() { stopped++; } };
  tree = h.render(h.exports.TalkBar, props);
  const mic = nodes(tree, (n) => n.props["aria-label"] === "Hold to talk")[0];
  mic.props.onPointerDown({ preventDefault: noop, currentTarget: {} });
  session.onresult({ results: [[{ transcript: "My little saving plan" }]] });
  tree = h.render(h.exports.TalkBar, props);
  assert.equal(nodes(tree, (n) => n.type === "input")[0].props.value, "My little saving plan");
  mic.props.onPointerUp(); assert.equal(stopped, 1);
  assert.ok(byText(tree, "See our chat"));
  const chat = harness("Child.jsx");
  tree = chat.render(chat.exports.Buddy, { state, startTalk: noop });
  assert.match(text(tree), /grown-up can read these chats/);
  assert.match(text(tree), /Keep passwords, phone numbers and addresses private/);
  assert.ok(byText(tree, "Talk to Maple"));
});

test("F6: speech tries Cartesia token then proxy then browser; muted reply sends no voice requests", async () => {
  const h = harness("Child.jsx"), calls = [], spoken = [];
  h.window.speechSynthesis = { cancel: noop, speak: (u) => spoken.push(u.text) };
  h.fetch = async (url) => { calls.push(url); return new Response("unavailable", { status: 503 }); };
  await h.exports.speak("A little saving!", "cartesia");
  assert.deepEqual(calls, ["/api/voice/token", "/api/buddy/speak"]);
  assert.deepEqual(spoken, ["A little saving!"]);
  calls.length = 0; spoken.length = 0;
  h.storage.set("mq_muted", "true");
  const props = { state: stateFixture(), run: async () => ({ reply: "A little saving!" }) };
  let talk = h.render(h.exports.useMapleTalk, props); h.flush();
  await talk.send("Hi");
  assert.equal(calls.length, 0); assert.equal(spoken.length, 0);
});

test("F6: late voice fallback is suppressed after mute or leaving the turn", async () => {
  const h = harness("Child.jsx"), spoken = [];
  h.window.speechSynthesis = { cancel: noop, speak: (u) => spoken.push(u.text) };
  let enabled = true, finish;
  h.fetch = () => new Promise((r) => { finish = r; });
  const speech = h.exports.speak("A late reply", "cartesia", () => enabled);
  enabled = false;
  finish(new Response("unavailable", { status: 503 }));
  await speech;
  assert.equal(spoken.length, 0);
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
  assert.equal(nodes(tree, (n) => n.props["aria-hidden"] === "true" && n.type === "span")[0].props.children[0], "Here is a little plan.");
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
