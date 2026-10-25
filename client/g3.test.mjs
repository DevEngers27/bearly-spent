// Socket-free G3 rendering and interaction checks; browser QA is in CHECKLIST.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import * as game from "../server/domain.js";
import * as catalog from "../server/catalog.js";

const sources = Object.fromEntries(await Promise.all(["api.js", "Child.jsx", "Parent.jsx"].map(async (name) => {
  const extra = { "Child.jsx": "Friends", "Parent.jsx": "Settings, Children, Inbox" }[name];
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


function realState() {
  return { ...stateFixture(), childId: "child-one", demo: false, friendCode: "BCDF3467", friends: [], trades: [], approvals: [], settings: { requireTradeApproval: true, coopChallenge: true, buddyEnabled: true, timezone: "UTC" } };
}
const realFriend = { id: "friend-one", real: true, name: "Ben", status: "approved", bear: { name: "Pip" }, postcards: ["seattle", "seattle", "hawaii_volcanoes_national_park"], greetings: [] };

test("G3 Friends real empty state has code form, no practice hints or coop, and uppercases input", async () => {
  const h = harness("Child.jsx"), state = realState(), calls = [];
  const render = () => h.render(h.exports.Friends, { state, run: async (...args) => { calls.push(args); return {}; }, busy: false });
  assert.match(text(render()), /Add a friend with their code/);
  assert.doesNotMatch(text(render()), /SAM-12|Maya|Team challenge/);
  const input = nodes(render(), (n) => n.type === "input")[0];
  assert.equal(input.props.maxLength, 8);
  input.props.onChange({ target: { value: "bcdf3467" } });
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(["child/friend", { code: "BCDF3467" }, "Sent! Your grown-ups are checking."]));
  assert.equal(nodes(render(), (n) => n.type === "input")[0].props.value, "");
});

test("G3 outgoing request stays anonymous; incoming request allows accept or decline and waits for both grown-ups", async () => {
  for (const approve of [true, false]) {
    const h = harness("Child.jsx"), state = realState(), calls = [];
    state.friends = [
      { id: "out", real: true, status: "pending_parent_a", incoming: false, childAccepted: true },
      { id: "in", real: true, status: "pending_parent_b", incoming: true, childAccepted: false, name: "Ava" },
    ];
    const props = { state, run: async (...args) => { calls.push(args); return {}; }, busy: false };
    const render = () => h.render(h.exports.Friends, props);
    assert.match(text(render()).replace(/\s+/g, " "), /Ava wants to be friends.*Both friends and their grown-ups need to say yes/);
    assert.doesNotMatch(text(render()), /undefined|'s bear/);
    await byText(render(), approve ? "Accept friend" : "Decline friend").props.onClick();
    assert.equal(calls[0][0], "child/friend/in/respond");
    assert.equal(calls[0][1].approve, approve);
    props.busy = true;
    assert.ok(nodes(render(), (n) => n.type === "button").every((n) => n.props.disabled));
    state.friends[1].childAccepted = true;
    assert.equal(byText(render(), "Accept friend"), undefined);
  }
});

test("G3 incoming swaps use recipient give/get orientation and send explicit kid decisions", async () => {
  for (const approve of [true, false]) {
    const h = harness("Child.jsx"), state = realState(), calls = [];
    state.friends = [realFriend];
    state.trades = [{ id: "trade-one", friendId: realFriend.id, real: true, status: "pending", initiator: false, childAccepted: false, give: "chicago", get: "seattle" }];
    const render = () => h.render(h.exports.Friends, { state, run: async (...args) => { calls.push(args); return {}; } });
    assert.match(text(render()).replace(/\s+/g, " "), /You give Chicago and get Seattle/);
    await byText(render(), approve ? "Accept swap" : "Decline swap").props.onClick();
    assert.equal(calls[0][0], "child/trade/trade-one/respond");
    assert.equal(calls[0][1].approve, approve);
    state.trades[0].childAccepted = true;
    assert.equal(byText(render(), "Accept swap"), undefined);
    assert.match(text(render()), /Swap waiting/);
  }
});

test("G3 real swap proposals never claim instant completion and exclude secret/locked copies", async () => {
  const h = harness("Child.jsx"), state = realState(), calls = [];
  state.settings.requireTradeApproval = false;
  state.friends = [realFriend];
  state.postcards = [{ id: "one", defId: "chicago" }, { id: "locked", defId: "new_york_city", lockedForTrade: "other" }, { id: "secret", defId: "hawaii_volcanoes_national_park" }];
  const render = () => h.render(h.exports.Friends, { state, run: async (...args) => { calls.push(args); return {}; } });
  const selects = nodes(render(), (n) => n.type === "select");
  assert.equal(selects.length, 2);
  assert.deepEqual(nodes(selects[0], (n) => n.type === "option").map((n) => n.props.value), ["", "chicago"]);
  assert.deepEqual(nodes(selects[1], (n) => n.type === "option").map((n) => n.props.value), ["", "seattle"]);
  selects[0].props.onChange({ target: { value: "chicago" } });
  selects[1].props.onChange({ target: { value: "seattle" } });
  await nodes(render(), (n) => n.type === "form" && n.props.className === "trade-form")[0].props.onSubmit(submit);
  assert.equal(calls[0][0], "child/trade");
  assert.equal(JSON.stringify(calls[0][1]), JSON.stringify({ friendId: "friend-one", give: "chicago", get: "seattle" }));
  assert.match(calls[0][2], /Your friend can choose next/);
  assert.doesNotMatch(text(render()), /Team challenge/);
  await byText(render(), "Great job saving!").props.onClick();
  assert.equal(JSON.stringify(calls[1][1]), JSON.stringify({ friendId: "friend-one", index: 0 }));
});

test("G3 failed friend submission preserves code; demo still has practice hints and coop", async () => {
  const h = harness("Child.jsx"), state = realState();
  const render = () => h.render(h.exports.Friends, { state, run: async () => null });
  nodes(render(), (n) => n.type === "input")[0].props.onChange({ target: { value: "BCDF3467" } });
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(nodes(render(), (n) => n.type === "input")[0].props.value, "BCDF3467");
  state.demo = true;
  state.friends = [realFriend];
  assert.match(text(render()), /Team challenge/);
  assert.equal(nodes(render(), (n) => n.type === "input")[0].props.placeholder, "e.g. SAM-12");
});

test("G3 parent privacy lists friendships, offers unfriend, and hides real-family coop", async () => {
  const h = harness("Parent.jsx"), state = realState(), calls = [];
  state.friends = [realFriend, { id: "pending", real: true, status: "pending_parent_a" }];
  const render = () => h.render(h.exports.Settings, { state, demo: false, run: async (...args) => { calls.push(args); return {}; } });
  assert.match(text(render()), /Ben.*Friend request/);
  assert.doesNotMatch(text(render()), /Team challenges/);
  await byText(render(), "Unfriend").props.onClick();
  await byText(render(), "Confirm unfriend").props.onClick();
  assert.equal(calls[0][0], "parent/friend/friend-one/remove");
});

test("G3 Children distinguishes stable friend codes from pairing and scopes code rotation and unfriend to the child", async () => {
  const h = harness("Parent.jsx"), calls = [];
  let refreshed = 0;
  h.fetch = async (url, options) => { calls.push([url, options]); return new Response("{}"); };
  const summary = { id: "child-two", name: "Ben", age: 9, bearName: "Pip", friendCode: "BCDF3467", friends: [{ id: "friend-one", name: "Ava", status: "approved" }] };
  const run = async (work) => typeof work === "function" ? work() : {};
  const render = () => h.render(h.exports.Children, { state: realState(), me: { children: [summary], family: { pinSet: false } }, refreshMe: async () => { refreshed++; }, run });
  assert.match(text(render()), /Friend code.*cannot pair a device.*Ava/);
  const code = nodes(render(), (n) => n.type === "input" && n.props.value === "BCDF3467")[0];
  assert.equal(code.props.readOnly, true);
  await byText(render(), "Replace friend code").props.onClick();
  await byText(render(), "Confirm replace code").props.onClick();
  assert.equal(calls[0][0], "/api/parent/children/child-two/friend-code?child=child-two");
  await byText(render(), "Unfriend").props.onClick();
  await byText(render(), "Confirm unfriend").props.onClick();
  assert.equal(calls[1][0], "/api/parent/friend/friend-one/remove?child=child-two");
  assert.equal(refreshed, 2);
});

test("G3 new social endpoints keep selected-child API scoping", () => {
  const h = harness("api.js");
  h.exports.setSelectedChild("child-one");
  assert.equal(h.exports.apiUrl("child/friend/fr/respond"), "/api/child/friend/fr/respond?child=child-one");
  assert.equal(h.exports.apiUrl("parent/friend/fr/remove?child=child-two"), "/api/parent/friend/fr/remove?child=child-two");
});
