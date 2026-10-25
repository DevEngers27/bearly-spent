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

const sources = Object.fromEntries(await Promise.all(["api.js", "Child.jsx", "Parent.jsx", "App.jsx"].map(async (name) => {
  const extra = { "Child.jsx": "Home, Sheet, MoneySheet, LessonSheet, Missions, Buddy, MapScreen, MapView, Friends, DressSheet, BudgetSheet, PlaceSheet", "Parent.jsx": "Overview, Goals, Allowance, Inbox, Guardian, Settings", "App.jsx": "PinGate, Loading" }[name];
  const result = await build({
    stdin: { contents: await readFile(new URL(`src/${name}`, import.meta.url), "utf8") + (extra ? `\nexport { ${extra} };` : ""), resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
    bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" },
  });
  return [name, result.outputFiles[0].text];
})));

function harness(name) {
  const slots = [], pending = [], timers = [], notices = [];
  const storage = new Map(), session = new Map();
  const window = new EventTarget();
  let cursor = 0;
  const env = { now: Date.now(), fetch: async () => new Response("{}"), slots, pending, notices, storage, session, window, timers };
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
  const childView = vm.runInNewContext(`(${fn})`, { Date, game, ...catalog, placesView: () => ({}), buddyMode: () => "offline", voiceEnabled: () => false, nessieEnabled: () => false });
  const db = seed(Date.now());
  assert.equal(childView(db).budgetDoneThisWeek, false);
  game.completeBudget(db, { save: 500, needs: 800, fun: 500, give: 200 });
  assert.equal(childView(db).budgetDoneThisWeek, true);
  const h = harness("Child.jsx"), state = stateFixture();
  state.budgetDoneThisWeek = true;
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
