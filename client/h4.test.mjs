// Socket-free H4 regression checks: node --test client/h4.test.mjs
// Browser gestures, installation and visual checks remain in CHECKLIST.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import * as game from "../server/domain.js";
import * as catalog from "../server/catalog.js";

const sources = Object.fromEntries(await Promise.all(["Child.jsx", "Parent.jsx"].map(async (name) => {
  const extra = { "Child.jsx": "Home, ProfileSheet, Friends, DressSheet, BudgetSheet, TalkBar, useMapleTalk, SpeechBubble, Album", "Parent.jsx": "Overview, SavingsGoal, Inbox, Settings, Children" }[name];
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

const change = (node, value) => node.props.onChange({ target: { value } });
const component = (tree, name) => nodes(tree, (n) => n.type?.name === name)[0];
const input = (tree) => nodes(tree, (n) => n.type === "input" && n.props.type === "number")[0];
const normalized = (tree) => text(tree).replace(/\s+/g, " ").trim();
const summary = { id: "kid-one", name: "Mia", age: 9, bearName: "Maple", friendCode: "BCDF3467", friends: [{ id: "fr-one", name: "Ben", status: "approved" }] };
const me = { family: { id: "family-one", pinSet: false }, children: [summary] };

test("H4.1 budget defaults to allowance, rescales edited total in cents, validates and sends total", async () => {
  const h = harness("Child.jsx"), state = stateFixture(), calls = [];
  state.allowance.amount = 1250;
  const render = () => h.render(h.exports.BudgetSheet, { state, close: noop, run: async (...args) => { calls.push(args); return {}; } });
  assert.equal(input(render()).props.value, "12.5");
  assert.equal(input(render()).props.inputMode, "decimal");
  change(input(render()), "30.01");
  let tree = render();
  const sliders = nodes(tree, (n) => n.type === "input" && n.props.type === "range");
  assert.ok(sliders.every((n) => n.props.max === 30.01));
  assert.equal(sliders.reduce((sum, n) => sum + Math.round(n.props.value * 100), 0), 3001);
  await nodes(tree, (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(calls[0][1].total, 30.01);
  assert.equal(Object.values(calls[0][1].allocations).reduce((sum, v) => sum + Math.round(v * 100), 0), 3001);
  for (const bad of ["", "0", "0.99", "201", "NaN", "1.001"]) {
    change(input(render()), bad);
    assert.equal(byText(render(), "Finish my budget").props.disabled, true, bad);
    await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  }
  assert.equal(calls.length, 1);
  change(input(render()), "20");
  change(nodes(render(), (n) => n.type === "input" && n.props.type === "range")[0], "0");
  assert.equal(byText(render(), "Finish my budget").props.disabled, true);
  for (const amount of [undefined, 0]) {
    const fallback = harness("Child.jsx");
    assert.equal(input(fallback.render(fallback.exports.BudgetSheet, { state: { allowance: { amount } } })).props.value, "20");
  }
});

test("H4.1 parent Overview shows last budget total and allocations", () => {
  const h = harness("Parent.jsx"), state = stateFixture();
  state.child.lastBudget = { total: 2000, allocations: { save: 500, needs: 800, fun: 500, give: 200 } };
  assert.match(normalized(h.render(h.exports.Overview, { state })), /Weekly budgets planned.*\$20\s*: save 5 · needs 8 · fun 5 · give 2/);
});

test("H4.2 bubble close button, outside scene, Escape and talk-bar close dismiss until next reply", async () => {
  const state = stateFixture(), h = harness("Child.jsx");
  const props = { state, run: async () => ({ reply: "Hello Mia!" }) };
  const talk = () => h.render(h.exports.useMapleTalk, props);
  talk(); h.flush(); talk().toggleMute(); talk().open();
  await talk().send("Hello");
  assert.equal(talk().bubble, "Hello Mia!");
  const messageId = talk().bubbleId;
  const bubble = harness("Child.jsx");
  byText(bubble.render(bubble.exports.SpeechBubble, { text: talk().bubble, onClose: talk().dismiss }), "").props.onClick();
  assert.equal(talk().bubble, "");
  assert.equal(talk().isOpen, true);
  await talk().send("Hello again");
  assert.ok(talk().bubbleId > messageId, "a new reply has its own message id even with identical text");
  const home = harness("Child.jsx");
  const render = () => home.render(home.exports.Home, { state, talk: talk(), open: noop });
  render(); home.flush();
  const outside = new Event("pointerdown");
  home.window.dispatchEvent(outside);
  assert.equal(talk().bubble, "");
  await talk().send("More");
  const escape = new Event("keydown"); Object.assign(escape, { key: "Escape" }); home.window.dispatchEvent(escape);
  assert.equal(talk().bubble, "");
  await talk().send("One more");
  const bar = harness("Child.jsx");
  nodes(bar.render(bar.exports.TalkBar, { state, talk: talk(), open: noop }), (n) => n.props["aria-label"] === "Close talk bar")[0].props.onClick();
  assert.equal(talk().bubble, ""); assert.equal(talk().isOpen, false);
  h.now += 1000;
  assert.equal(talk().bubble, "");
  await talk().send("Next reply"); assert.equal(talk().bubble, "Hello Mia!");
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.bubble-close\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px/);
});

test("H4.3 trip bubble stays static across ticks and Home never draws an away bear with talk open", () => {
  const state = stateFixture(), h = harness("Child.jsx");
  state.adventures = [{ id: "trip-one", status: "away", returnsAt: h.now + 60000 }];
  let talk = h.render(h.exports.useMapleTalk, { state }); h.flush(); talk.open();
  talk = h.render(h.exports.useMapleTalk, { state });
  assert.equal(talk.bubble, "Maple is on a trip — back soon!");
  const home = harness("Child.jsx"), bubble = harness("Child.jsx");
  const render = () => home.render(home.exports.Home, { state, talk: { ...talk, isOpen: true, mood: "resting" }, open: noop });
  let tree = render(); home.flush();
  const first = component(tree, "SpeechBubble");
  bubble.render(bubble.exports.SpeechBubble, first.props); bubble.flush();
  assert.equal(bubble.timers.length, 0, "trip text is never typewritten");
  for (let i = 0; i < 3; i++) {
    home.now += 1000; home.timers[0](); tree = render(); home.flush();
    assert.equal(nodes(tree, (n) => n.type?.name === "BearFigure").length, 0);
    assert.equal(component(tree, "SpeechBubble").props.text, first.props.text);
    assert.equal(component(tree, "SpeechBubble").props.key, first.props.key);
  }
  const animated = harness("Child.jsx");
  animated.render(animated.exports.SpeechBubble, { text: "Hello", thinking: false }); animated.flush();
  animated.render(animated.exports.SpeechBubble, { text: "Hello", thinking: true }); animated.flush();
  assert.equal(animated.timers.length, 1, "unchanged content does not restart when mood changes");
});

test("H4.4 locked clothes require Buy; cancel, insufficient points and failed purchase preserve points", async () => {
  const h = harness("Child.jsx"), state = stateFixture(), calls = [];
  state.child.points = 500;
  state.catalog.cosmetics = [{ id: "flower", kind: "hat", value: "flower", label: "Flower crown", cost: 40, unlocked: false }];
  let success = false;
  const render = () => h.render(h.exports.DressSheet, { state, run: async (...args) => { calls.push(args); return success ? {} : null; }, close: noop });
  byText(render(), "Flower crown").props.onClick();
  assert.equal(calls.length, 0);
  assert.match(normalized(render()), /Spend 40 points on the Flower crown\s*\? You have 500/);
  byText(render(), "Not now").props.onClick(); assert.equal(byText(render(), "Buy"), undefined);
  byText(render(), "Flower crown").props.onClick();
  state.child.points = 10; assert.equal(byText(render(), "Earn 30 more points").props.disabled, true);
  state.child.points = 500;
  await byText(render(), "Buy").props.onClick(); assert.ok(byText(render(), "Buy"));
  success = true; await byText(render(), "Buy").props.onClick(); assert.equal(byText(render(), "Buy"), undefined);
  assert.equal(calls.length, 2); assert.equal(calls[0][0], "child/cosmetic/buy");
});

test("H4.5 Delete goal and both Unfriend paths and Replace code use cancellable inline confirmation", async () => {
  const state = stateFixture(); state.child.currentGoalId = "another";
  const goal = { id: "old", title: "Skates", target: 5000, status: "archived" };
  for (const [name, props, trigger, confirm] of [
    ["SavingsGoal", { state, goal }, "Delete", "Confirm delete"],
    ["Children", { state, me, refreshMe: async () => {} }, "Replace friend code", "Confirm replace code"],
    ["Children", { state, me, refreshMe: async () => {} }, "Unfriend", "Confirm unfriend"],
    ["Settings", { state: { ...state, friends: [{ id: "fr-one", real: true, status: "approved", name: "Ben" }] } }, "Unfriend", "Confirm unfriend"],
  ]) {
    const h = harness("Parent.jsx"), calls = [];
    h.fetch = async (url) => { calls.push(url); return new Response("{}"); };
    const run = async (work) => typeof work === "function" ? work() : (calls.push(work), {});
    const render = () => h.render(h.exports[name], { ...props, run });
    byText(render(), trigger).props.onClick(); assert.equal(calls.length, 0, trigger);
    byText(render(), "Cancel").props.onClick(); assert.equal(byText(render(), confirm), undefined);
    byText(render(), trigger).props.onClick();
    await byText(render(), confirm).props.onClick(); assert.equal(calls.length, 1, trigger);
    assert.equal(byText(render(), confirm), undefined);
  }
});

test("H4.6 anonymous request receipt persists for a session regardless of code validity", async () => {
  for (const valid of [true, false]) {
    const h = harness("Child.jsx"), state = stateFixture(); state.childId = "kid-one"; state.friends = [];
    const render = () => h.render(h.exports.Friends, { state, run: async () => { if (valid) state.friends.push({ id: "fr", real: true, status: "pending_parent_a" }); return { ok: true, message: "Request sent" }; } });
    change(nodes(render(), (n) => n.type === "input")[0], valid ? "BCDF3467" : "ZZZZZZZZ");
    await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
    const receipt = normalized(nodes(render(), (n) => n.props.role === "status")[0]);
    assert.equal(receipt, "Request sent. Both friends and their grown-ups need to say yes.");
    const returned = harness("Child.jsx", { session: h.session });
    assert.match(normalized(returned.render(returned.exports.Friends, { state })), /Request sent\./);
  }
});

test("H4.6 declined real friend approval says didn't go through", () => {
  const h = harness("Parent.jsx"), state = stateFixture();
  state.approvals = [{ id: "declined", real: true, kind: "friend_request", title: "Friend request", status: "declined" }];
  assert.match(normalized(h.render(h.exports.Inbox, { state, pending: [] })), /didn't go through/);
});

test("H4.7 linked receipt survives Children remount and a new code replaces it", async () => {
  const h = harness("Parent.jsx"); let status = "linked", generated = 0;
  const fetch = async (url, options) => new Response(JSON.stringify(options?.method === "POST" ? { code: `CODE${++generated}`, expiresAt: h.now + 900000 } : { status }));
  h.fetch = fetch;
  const props = { me, refreshMe: async () => {}, run: async (work) => work() };
  const render = () => { const tree = h.render(h.exports.Children, props); h.flush(); return tree; };
  await byText(render(), "Generate kid code").props.onClick(); render();
  await new Promise(setImmediate); render();
  assert.match(text(render()), /Linked ✓/);
  const remount = harness("Parent.jsx", { session: h.session }); remount.fetch = fetch;
  const again = () => remount.render(remount.exports.Children, props);
  assert.match(text(again()), /Linked ✓/);
  status = "pending";
  await byText(again(), "Generate kid code").props.onClick();
  assert.doesNotMatch(text(again()), /Linked ✓/); assert.match(text(again()), /Expires in/);
  const other = harness("Parent.jsx", { session: h.session });
  assert.doesNotMatch(text(other.render(other.exports.Children, { ...props, me: { ...me, family: { id: "other" } } })), /Linked ✓/);
});

test("H4.8 traded stamp suppresses empty hint and profile, Album and friend card share metrics", () => {
  const state = stateFixture();
  state.postcards = [{ id: "trade", defId: "seattle", source: "trade" }];
  state.metrics = { postcards: { places: 0, cards: 1, total: 15 } };
  state.profile = { stats: { postcards: { collected: 1, total: 9 } } };
  const h = harness("Child.jsx");
  const album = h.render(h.exports.Album, { state });
  assert.equal(nodes(album, (n) => n.type?.name === "Stamp").length, 1);
  assert.doesNotMatch(text(album), /Stamps from your trips/);
  assert.match(normalized(album), /0 of 15 places · 1 card/);
  const profile = harness("Child.jsx");
  assert.match(normalized(profile.render(profile.exports.ProfileSheet, { state })), /0 \/ 15 · 1 card/);
  state.friends = [{ id: "ben", name: "Ben", status: "approved", bear: { name: "Pip" }, postcards: ["seattle"], metrics: state.metrics }];
  const friends = harness("Child.jsx");
  assert.match(normalized(friends.render(friends.exports.Friends, { state })), /0 of 15 places · 1 card/);
  state.postcards = [];
  assert.match(text(h.render(h.exports.Album, { state })), /Stamps from your trips/);
});

test("H4.9 suggestions follow the current goal; friend card shows latest received hello", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  state.goals = [{ id: "bike", title: "Bicycle", target: 5000, status: "archived" }, { id: "book", title: "Space book", target: 1000, status: "active" }];
  state.currentGoalId = "book";
  const talk = { muted: true, close: noop, toggleMute: noop };
  const render = () => h.render(h.exports.TalkBar, { state, talk });
  assert.match(text(render()), /When can I reach my Space book goal/); assert.doesNotMatch(text(render()), /bike/i);
  state.goals[1].status = "archived";
  assert.doesNotMatch(text(render()), /When can I reach/);
  state.friends = [{ id: "ben", name: "Ben", status: "approved", bear: { name: "Pip" }, postcards: [], greetings: [{ from: "Ben", text: "Old hello" }, { from: "Ben", text: "Great job saving!" }, { from: "me", text: "My reply" }] }];
  const friends = harness("Child.jsx");
  const tree = friends.render(friends.exports.Friends, { state });
  assert.match(normalized(tree), /Latest hello Great job saving!/); assert.doesNotMatch(text(tree), /Old hello|My reply/);
});
