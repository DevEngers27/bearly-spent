// Socket-free H7 regression checks: node --test client/h7.test.mjs
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
  const extra = { "Child.jsx": "GoalsSheet, Missions, nextUp, Friends, BudgetSheet, TalkBar, useMapleTalk, SpeechBubble, Buddy", "Parent.jsx": "Overview, SavingsGoal, Inbox, Settings, Children" }[name];
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

test("H7.1 put-away goals offer Bring back and Edit; bought goals stay memories", async () => {
  const h = harness("Child.jsx"), state = stateFixture(), calls = [];
  state.goals.push({ id: "rest", title: "Space book", target: 3050, icon: "book", status: "archived" }, { id: "memory", title: "Kite", target: 500, icon: "toy", status: "bought" });
  const render = () => h.render(h.exports.GoalsSheet, { state, run: async (...args) => { calls.push(args); return {}; } });
  render(); h.flush();
  const row = (title) => nodes(render(), (n) => n.type === "li" && text(n).includes(title))[0];
  await byText(row("Space book"), "Bring back").props.onClick();
  assert.equal(calls[0][0], "child/goals/rest/restore");
  byText(row("Space book"), "Edit").props.onClick(); render(); h.flush();
  let tree = render();
  assert.equal(nodes(tree, (n) => n.type === "input")[0].props.value, "Space book");
  assert.equal(input(tree).props.value, 30.5);
  change(nodes(tree, (n) => n.type === "input")[0], "My space book");
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(calls.at(-1)[0], "child/goals/rest");
  assert.equal(calls.at(-1)[1].title, "My space book");
  assert.match(normalized(row("Kite")), /Bought — a memory/);
  assert.equal(nodes(row("Kite"), (n) => n.type === "button").length, 0);
});

test("H7.1 both goal forms pick seven labelled pictures with pressed state and 44px targets", async () => {
  for (const [name, componentName] of [["Child.jsx", "GoalsSheet"], ["Parent.jsx", "SavingsGoal"]]) {
    const h = harness(name), state = stateFixture(), calls = [];
    const render = () => h.render(h.exports[componentName], { state, create: true, run: async (...args) => { calls.push(args); return {}; } });
    const pictures = (tree) => nodes(tree, (n) => n.type === "button" && typeof n.props["aria-pressed"] === "boolean");
    assert.equal(nodes(render(), (n) => n.type === "select").length, 0);
    assert.deepEqual(pictures(render()).map((n) => normalized(n)), ["Bike", "Game", "Book", "Gift", "Trip", "Toy", "Something else"]);
    assert.equal(pictures(render()).filter((n) => n.props["aria-pressed"]).length, 1);
    byText(render(), "Gift").props.onClick();
    assert.equal(byText(render(), "Gift").props["aria-pressed"], true);
    assert.equal(byText(render(), "Bike").props["aria-pressed"], false);
    assert.equal(byText(render(), "Gift").props.type, "button");
    await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
    assert.equal(calls.at(-1)[1].icon, "gift");
    const busy = h.render(h.exports[componentName], { state, create: true, busy: true });
    assert.ok(nodes(busy, (n) => n.type === "fieldset" && n.props.disabled).length);
  }
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  assert.match(css, /goal-picture-row button \{[^}]*min-width: 44px; min-height: 44px/);
});

test("H7.2 completed budget stays checked, opens saved plan, updates freely and never becomes Next up", async () => {
  const state = stateFixture(), calls = [], opened = [];
  state.weekKey = "2026-W43"; state.child.lastBudgetWeek = state.weekKey;
  state.child.lastBudget = { total: 3050, allocations: { save: 900, needs: 1200, fun: 650, give: 300 } };
  const missions = harness("Child.jsx");
  const weekly = byText(missions.render(missions.exports.Missions, { state, open: (...args) => opened.push(args) }), "Weekly budget challenge");
  assert.equal(weekly.props.disabled, false);
  assert.doesNotMatch(normalized(weekly), /\+50/);
  assert.equal(nodes(weekly, (n) => n.type?.name === "Icon" && n.props.name === "check").length, 1);
  weekly.props.onClick(); assert.equal(opened[0][0], "budget");
  assert.equal(missions.exports.nextUp(state, Date.now()).some((m) => m.id === "budget"), false);
  const h = harness("Child.jsx"); let closed = 0;
  const render = () => h.render(h.exports.BudgetSheet, { state, close: () => closed++, run: async (...args) => { calls.push(args); return { pointsAwarded: 0 }; } });
  assert.equal(render().props.title, "This week's plan");
  assert.equal(input(render()).props.value, "30.5");
  assert.match(normalized(render()), /Already earned this week — changing your plan is free/);
  assert.deepEqual(nodes(render(), (n) => n.type === "input" && n.props.type === "range").map((n) => n.props.value), [9, 12, 6.5, 3]);
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(calls[0][1].total, 30.5); assert.equal(calls[0][2]({ pointsAwarded: 0 }), "Plan updated!"); assert.equal(closed, 1);
  state.weekKey = "2026-W44";
  const next = harness("Child.jsx");
  assert.notEqual(next.render(next.exports.BudgetSheet, { state }).props.title, "This week's plan");
  assert.notEqual(input(next.render(next.exports.BudgetSheet, { state })).props.value, "30.5");
});

test("H7.3 valid and invalid code receipts look alike; outgoing status advances to friends", async () => {
  const receipts = [];
  for (const valid of [true, false]) {
    const h = harness("Child.jsx"), state = stateFixture(), calls = [];
    state.demo = false; state.childId = "mia"; state.friends = []; state.trades = [];
    const render = () => h.render(h.exports.Friends, { state, run: async (...args) => {
      calls.push(args);
      if (valid) state.friends.push({ id: "outgoing", real: true, incoming: false, status: "pending_parent_a" });
      return { ok: true, message: "Request sent" };
    } });
    change(nodes(render(), (n) => n.type === "input")[0], valid ? "BCDF3467" : "ZZZZZZZZ");
    await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
    receipts.push(normalized(render()));
    assert.equal(calls[0][2], "Sent! Your grown-ups are checking.");
    assert.match(receipts.at(-1), /Waiting for your grown-up to say yes/);
    const reopened = harness("Child.jsx", { session: h.session });
    assert.match(normalized(reopened.render(reopened.exports.Friends, { state })), /Waiting for your grown-up to say yes/);
    if (valid) {
      state.friends[0].status = "pending_parent_b";
      assert.match(normalized(render()), /Sent to your friend's family/);
      assert.doesNotMatch(normalized(render()), /Waiting for your grown-up/);
      Object.assign(state.friends[0], { status: "approved", name: "Ben", bear: { name: "Pip" }, postcards: [] });
      render(); h.flush();
      assert.match(normalized(render()), /Ben\s*'s bear/);
      assert.doesNotMatch(normalized(render()), /Waiting for your grown-up|Sent to your friend's family|Request sent/);
    }
  }
  assert.equal(receipts[0], receipts[1]);
});

test("H7.3 requester Inbox explains approval while recipient detail stays unchanged", () => {
  for (const incoming of [false, true]) {
    const h = harness("Parent.jsx"), state = stateFixture();
    state.friends = [{ id: "request", real: true, incoming, status: "pending_parent_b" }];
    const pending = [{ id: "approval", kind: "friend_request", socialId: "request", title: "Friend request", detail: "Friends only see bears and postcards — never money." }];
    const tree = h.render(h.exports.Inbox, { state, pending });
    if (incoming) { assert.match(normalized(tree), /Friends only see bears and postcards/); assert.doesNotMatch(normalized(tree), /Approving sends/); }
    else assert.match(normalized(tree), /Approving sends the request to the other family; they also have to agree/);
  }
});

test("H7.4 suggestions use live goal target and spending and send ordinary chat questions", async () => {
  const h = harness("Child.jsx"), state = stateFixture(), sent = [];
  state.goals = [{ id: "book", title: "Space book", target: 4250, status: "active" }]; state.currentGoalId = "book";
  state.balances.spending = 2300;
  const render = () => h.render(h.exports.TalkBar, { state, talk: { close: noop, send: async (text) => { sent.push(text); return true; } } });
  let tree = render();
  await byText(tree, "When can I save $42.50 for Space book?").props.onClick();
  await byText(tree, "Can I buy a toy for $18?").props.onClick();
  await byText(tree, "What should I do with my allowance?").props.onClick();
  assert.deepEqual(sent, ["When can I save $42.50 for Space book?", "Can I buy a toy for $18?", "What should I do with my allowance?"]);
  state.goals[0].title = "Skates"; state.goals[0].target = 6000; state.balances.spending = 500;
  tree = render(); assert.match(normalized(tree), /save \$60 for Skates/); assert.match(normalized(tree), /buy a toy for \$4\?/); assert.doesNotMatch(normalized(tree), /Space book/);
});

test("H7.4 fallback Ask-again button resends the original question in bubble and transcript", async () => {
  const h = harness("Child.jsx"), state = stateFixture(), calls = [];
  state.child.bear.name = "Bo"; state.integrations.voice = "browser";
  const render = () => h.render(h.exports.useMapleTalk, { state, run: async (...args) => { calls.push(args); return { reply: "You have $10 to spend.", fallback: calls.length === 1 }; } });
  render(); h.flush(); await render().send("Can I buy a toy for $8?");
  assert.equal(render().retryQuestion, "Can I buy a toy for $8?");
  const bubble = harness("Child.jsx");
  const tree = bubble.render(bubble.exports.SpeechBubble, { text: render().bubble, bearName: state.child.bear.name, retry: () => render().send(render().retryQuestion) });
  await byText(tree, "Ask Bo again").props.onClick();
  assert.equal(calls.length, 2); assert.equal(calls[1][0], "buddy/chat"); assert.equal(calls[1][1].text, calls[0][1].text);
  assert.equal(render().retryQuestion, null);
  state.chat = [{ id: "u", role: "user", text: "Can I buy a toy for $8?" }, { id: "a", role: "assistant", text: "You have $10 to spend.", fallback: true }];
  const transcript = harness("Child.jsx"), retries = [];
  const props = { state, run: async (...args) => retries.push(args) };
  await byText(transcript.render(transcript.exports.Buddy, props), "Ask Bo again").props.onClick();
  assert.equal(retries[0][0], "buddy/chat"); assert.equal(retries[0][1].text, state.chat[0].text);
  assert.equal(byText(transcript.render(transcript.exports.Buddy, { ...props, offline: true }), "Ask Bo again").props.disabled, true);
});
