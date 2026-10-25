// Socket-free H12 regressions: node --test client/h12.test.mjs
// Browser gestures, installation and visual checks remain in CHECKLIST.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import { parentView } from "../server/index.js";

const sources = Object.fromEntries(await Promise.all(["Child.jsx", "Parent.jsx"].map(async (name) => {
  const extra = { "Child.jsx": "Home, MoneySheet", "Parent.jsx": "Overview, Figure, Inbox, WalletLedger, Allowance" }[name];
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
  db.accounts.savings.balance = 400;
  return parentView(db);
}

function amount(tree, value) {
  nodes(tree, (n) => n.type === "input" && n.props.id === "money-amount")[0].props.onChange({ target: { value } });
}
function note(tree, value, maxLength = 60) {
  nodes(tree, (n) => n.type === "input" && n.props.maxLength === maxLength)[0].props.onChange({ target: { value } });
}
const form = (tree) => nodes(tree, (n) => n.type === "form")[0];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("H12.3 Received segment renders Amount and optional Note, validates and credits with a UUID", async () => {
  const h = harness("Child.jsx"), calls = [], state = stateFixture(); let closed = 0;
  const props = { state, close: () => closed++, run: async (...args) => { calls.push(args); return {}; } };
  const render = () => h.render(h.exports.MoneySheet, props);
  byText(render(), "Received").props.onClick();
  let tree = render();
  assert.equal(byText(tree, "Received").props["aria-selected"], true); assert.match(text(tree), /Amount \(\$\).*Note.*Record it/);
  const input = nodes(tree, (n) => n.props.id === "money-amount")[0];
  assert.equal(input.props.max, "500"); assert.equal(input.props.min, "0.01"); assert.equal(input.props.step, "0.01");
  assert.equal(nodes(tree, (n) => n.props.maxLength === 60)[0].props.required, false);
  for (const value of ["", "0", "-2", "501", "nope"]) {
    amount(render(), value); assert.equal(byText(render(), "Record it").props.disabled, true);
    await form(render()).props.onSubmit(submit); assert.equal(calls.length, 0);
  }
  amount(render(), "20"); note(render(), "Birthday");
  await form(render()).props.onSubmit(submit);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "child/money/received");
  assert.equal(calls[0][1].amount, 20); assert.equal(calls[0][1].note, "Birthday"); assert.match(calls[0][1].clientId, uuid);
  assert.equal(calls[0][2], "Saved! Your grown-up will see it too."); assert.equal(closed, 1);
  assert.equal(nodes(tree, (n) => n.props.className?.startsWith("pot ")).length, 2);
});

test("H12.3 Received retries reuse clientId and pending same-tick submits do not duplicate", async () => {
  const h = harness("Child.jsx"), calls = [], state = stateFixture(); let done;
  let first = true;
  const props = { state, start: "received", close: noop, run: async (...args) => {
    calls.push(args); if (first) { first = false; return null; }
    return new Promise((resolve) => { done = resolve; });
  } };
  const render = () => h.render(h.exports.MoneySheet, props);
  amount(render(), "20"); note(render(), "Gift"); await form(render()).props.onSubmit(submit);
  assert.equal(nodes(render(), (n) => n.props.id === "money-amount")[0].props.value, "20");
  const retry = form(render()).props.onSubmit(submit);
  await form(render()).props.onSubmit(submit); assert.equal(calls.length, 2);
  assert.equal(calls[0][1].clientId, calls[1][1].clientId); assert.equal(calls[1][1].note, "Gift");
  done({ recorded: true }); await retry;
});

test("H12.3 duplicate warning follows a successful Received post and Record again uses a fresh UUID", async () => {
  const h = harness("Child.jsx"), calls = [], state = stateFixture(); let closed = 0;
  const props = { state, start: "received", close: () => closed++, run: async (...args) => { calls.push(args); return {}; } };
  const render = () => h.render(h.exports.MoneySheet, props);
  amount(render(), "20"); await form(render()).props.onSubmit(submit);
  const firstId = calls[0][1].clientId;
  h.slots.length = 0; // Re-open the sheet; successful receipt remains in session storage.
  amount(render(), "20"); await form(render()).props.onSubmit(submit);
  assert.equal(calls.length, 1); assert.match(text(render()), /You just recorded \$20.00. Record it again\?/);
  assert.ok(nodes(render(), (n) => n.props.role === "alertdialog").length);
  await byText(render(), "Record again").props.onClick(submit);
  assert.equal(calls.length, 2); assert.match(calls[1][1].clientId, uuid); assert.notEqual(calls[1][1].clientId, firstId); assert.equal(closed, 2);
});

test("H12.3 Not now records nothing and duplicate detection is bounded by kind, amount, child and two minutes", async () => {
  const h = harness("Child.jsx"), calls = [], state = stateFixture(); let closed = 0;
  const props = { state, start: "received", close: () => closed++, run: async (...args) => { calls.push(args); return {}; } };
  const render = () => h.render(h.exports.MoneySheet, props);
  amount(render(), "20"); await form(render()).props.onSubmit(submit);
  await form(render()).props.onSubmit(submit); byText(render(), "Not now").props.onClick();
  assert.equal(calls.length, 1); assert.equal(closed, 2);
  amount(render(), "21"); await form(render()).props.onSubmit(submit); assert.equal(calls.length, 2);
  h.now += 120000; await form(render()).props.onSubmit(submit); assert.equal(calls.length, 3);
  byText(render(), "Spent").props.onClick(); amount(render(), "21"); note(render(), "Shop", 80);
  await form(render()).props.onSubmit(submit); assert.equal(calls.length, 4);
  props.state = { ...state, childId: "another-child" }; byText(render(), "Received").props.onClick(); amount(render(), "21");
  await form(render()).props.onSubmit(submit); assert.equal(calls.length, 5);
});

test("H12 Spent warns on a second same-amount purchase and retries both sources with clientId", async () => {
  for (const appleCash of [true, false]) {
    const h = harness("Child.jsx"), calls = [], state = stateFixture(); let succeeds = false;
    const props = { state, start: "spend", startWallet: appleCash, close: noop, run: async (...args) => { calls.push(args); return succeeds ? {} : null; } };
    const render = () => h.render(h.exports.MoneySheet, props);
    amount(render(), "1"); note(render(), "Shop", 80); await form(render()).props.onSubmit(submit);
    succeeds = true; await form(render()).props.onSubmit(submit);
    assert.equal(calls[0][1].clientId, calls[1][1].clientId); assert.equal(calls[0][0], appleCash ? "child/wallet/spend" : "child/spend");
    note(render(), "Shop", 80); await form(render()).props.onSubmit(submit);
    assert.equal(calls.length, 2); assert.match(text(render()), /You just recorded \$1.00/);
  }
});

test("H12.4 Send money validates optional Note and stable retry ID then clears on success", async () => {
  const h = harness("Parent.jsx"), calls = [], state = stateFixture(); let succeeds = false;
  const props = { state, run: async (...args) => { calls.push(args); return succeeds ? {} : null; } };
  const render = () => h.render(h.exports.Allowance, props);
  const sendForm = () => nodes(render(), (n) => n.type === "form" && n.props["aria-label"] === "Send money")[0];
  await sendForm().props.onSubmit(submit); assert.equal(calls.length, 0);
  const inputs = nodes(sendForm(), (n) => n.type === "input");
  inputs[0].props.onChange({ target: { value: "20" } });
  nodes(sendForm(), (n) => n.props.maxLength === 60)[0].props.onChange({ target: { value: "Gift" } });
  await sendForm().props.onSubmit(submit); succeeds = true; await sendForm().props.onSubmit(submit);
  assert.equal(calls.length, 2); assert.equal(calls[0][0], "parent/money/send"); assert.match(calls[0][1].clientId, uuid);
  assert.equal(calls[0][1].clientId, calls[1][1].clientId); assert.equal(calls[1][1].note, "Gift");
  assert.equal(nodes(sendForm(), (n) => n.type === "input")[0].props.value, "");
  assert.doesNotMatch(text(render()), /Funding account|Add money/);
});

test("H12.6 two Home balances, four Overview figures and no funding Inbox controls", () => {
  const state = stateFixture(), child = harness("Child.jsx"), parent = harness("Parent.jsx");
  const home = child.render(child.exports.Home, { state });
  const strip = nodes(home, (n) => n.props.className === "balances-strip")[0];
  assert.equal(nodes(strip, (n) => n.type === "button").length, 2);
  state.receivedThisMonth = 2000;
  const overview = parent.render(parent.exports.Overview, { state });
  assert.equal(JSON.stringify(nodes(overview, (n) => n.type?.name === "Figure").map((n) => n.props.label)), JSON.stringify(["Savings", "Spending", "Received this month", "Adventure points"]));
  assert.equal(nodes(overview, (n) => n.type?.name === "Figure")[2].props.sub, "Sent by you and recorded by Mia");
  assert.doesNotMatch(text(parent.render(parent.exports.Inbox, { state, pending: [] })), /Add money|Record now|Funding account/);
});
