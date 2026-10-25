// Socket-free H1 regressions: node --test client/h1.test.mjs
// Browser gestures, installation and visual checks remain in CHECKLIST.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
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
    crypto: { randomUUID }, fetch: (...args) => env.fetch(...args), Event, URL, URLSearchParams, console,
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
  db.accounts.parent.balance = 400;
  return parentView(db);
}

test("H1.5: Paid with defaults to Apple Cash, validates the selected source and guards form submit", async () => {
  const h = harness("Child.jsx"), calls = [], state = stateFixture();
  state.balances.savings = 400;
  const props = { state, start: "spend", close: noop, run: async (...args) => { calls.push(args); return {}; } };
  const render = () => h.render(h.exports.MoneySheet, props);
  let tree = render();
  assert.equal(byText(tree, "Apple Cash").props["aria-pressed"], true);
  assert.equal(nodes(tree, (n) => n.type === "input" && n.props.type === "checkbox").length, 0);
  assert.match(text(tree), /You have\s+\$4.00/);
  nodes(tree, (n) => n.props.id === "money-amount")[0].props.onChange({ target: { value: "4.25" } });
  tree = render();
  assert.equal(byText(tree, "Record it").props.disabled, true);
  assert.match(text(tree), /Your savings are short. Record money you received first./);
  await nodes(tree, (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(calls.length, 0);
  byText(tree, "Spending money").props.onClick();
  tree = render();
  assert.equal(byText(tree, "Record it").props.disabled, false);
  assert.match(text(tree), /You have\s+\$10.00/);
  assert.match(text(tree), /Buys over .* need your grown-up's OK first/);
  nodes(tree, (n) => n.type === "input" && n.props.maxLength === 80)[0].props.onChange({ target: { value: "Book" } });
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(calls[0][0], "child/spend");
  assert.equal(calls[0][2]({ held: true }), "That's a big buy. We asked your grown-up first.");
  state.balances.spending = 400;
  assert.equal(byText(render(), "Record it").props.disabled, true);
  state.balances.savings = 425;
  byText(render(), "Apple Cash").props.onClick();
  assert.equal(byText(render(), "Record it").props.disabled, false);
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(calls[1][0], "child/wallet/spend");
  assert.equal(calls[1][1].amount, 4.25);
});

test("H1.5: Home strip shows child savings and spending without parent funding; pill shows today and last spend", () => {
  const state = stateFixture();
  state.walletSpent = { today: 650 };
  state.walletLastTransaction = { memo: "Lunch", amount: 425, ts: Date.now() };
  const h = harness("Child.jsx"), opened = [];
  const tree = h.render(h.exports.Home, { state, open: (...args) => opened.push(args) });
  const strip = nodes(tree, (n) => n.props.className === "balances-strip")[0];
  assert.match(text(strip), /Savings.*\$20.00.*Spending.*\$10.00/);
  const buttons = nodes(strip, (n) => n.type === "button");
  assert.equal(buttons.length, 2);
  buttons.forEach((button) => button.props.onClick());
  assert.equal(JSON.stringify(opened), JSON.stringify([["money", {}], ["money", { start: "spend", wallet: false }]]));
  assert.match(text(nodes(tree, (n) => n.props.className === "wallet-pill")[0]), /Apple Cash.*\$6.50.*today.*Lunch.*\$4.25/);
});

test("H1.4: Overview renders four figures with funding coverage and body-font numbers that can wrap", async () => {
  const h = harness("Parent.jsx"), state = stateFixture();
  state.accounts.parent.balance = 54500;
  const tree = h.render(h.exports.Overview, { state });
  const figures = nodes(tree, (n) => n.type?.name === "Figure");
  assert.equal(figures.length, 4);
  assert.deepEqual(Array.from(figures, (n) => n.props.label), ["Mia's savings", "Spending money", "Funding account", "Adventure points"]);
  assert.equal(figures[2].props.value, "$545.00");
  assert.equal(figures[2].props.sub, "Covers allowance and rewards");
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  const numberRule = css.match(/\.p-figure b \{([^}]+)\}/)[1];
  for (const rule of [/font-family: var\(--body\)/, /font-variant-numeric: tabular-nums/, /min-width: 0/, /overflow-wrap: anywhere/, /line-height: 1.25/]) assert.match(numberRule, rule);
  assert.match(css, /\.parent \.p-figures \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("H1.2/3: Inbox pending card wires Add money, Record now and Dismiss; Apple Cash activity shows pending and flags", async () => {
  const h = harness("Parent.jsx"), state = stateFixture(), calls = [];
  state.walletPending = [{ id: "receipt-one", amount: 1000, merchant: "shoukun", ts: Date.now() }];
  state.notifications = []; state.approvals = [];
  const tree = h.render(h.exports.Inbox, { state, pending: [], run: async (...args) => calls.push(args), onAddMoney: () => calls.push(["focus-funding"]), mobile: true });
  assert.match(text(tree), /Mia.*Apple Cash spent\s+\$10.00\s+at\s+shoukun.*Waiting for savings/);
  assert.equal(nodes(tree, (n) => n.props.className === "empty").length, 1, "only Notifications is empty");
  await byText(tree, "Record now").props.onClick();
  await byText(tree, "Dismiss").props.onClick();
  assert.equal(JSON.stringify(calls.map((call) => call[0])), JSON.stringify(["parent/wallet/pending/receipt-one/record", "parent/wallet/pending/receipt-one/dismiss"]));
  const busy = h.render(h.exports.Inbox, { state, pending: [], busy: true });
  for (const label of ["Record now", "Dismiss"]) assert.equal(byText(busy, label).props.disabled, true);
  state.walletSpent = { week: 425, month: 625 };
  state.walletTransactions = [{ id: "posted", ts: Date.now(), memo: "Lunch", amount: 425, kind: "wallet_spend", status: "posted", overLimit: true, unusual: true }];
  const activity = h.render(h.exports.WalletLedger, { state });
  assert.match(text(activity), /Apple Cash activity.*week:.*\$4.25.*month:.*\$6.25.*shoukun.*waiting for savings.*Lunch.*above purchase limit.*unusual spend/);
  assert.equal(nodes(activity, (n) => n.type === "form").length, 0);
});


test("Received form credits actual received money and preserves the request ID across a failed retry", async () => {
  const h = harness("Child.jsx"), calls = [], state = stateFixture();
  let closed = 0;
  const props = { state, start: "receive", close: () => closed++, run: async (...args) => { calls.push(args); return calls.length === 1 ? null : {}; } };
  const render = () => h.render(h.exports.MoneySheet, props);
  assert.match(text(render()), /Received.*Who sent you the money/);
  assert.match(text(render()), /Do not add allowance or rewards already recorded/);
  const amount = () => nodes(render(), (n) => n.props.id === "money-amount")[0];
  assert.equal(amount().props.step, "0.01");
  amount().props.onChange({ target: { value: "12.34" } });
  nodes(render(), (n) => n.type === "input" && n.props.maxLength === 80)[0].props.onChange({ target: { value: "Dad" } });
  for (let i = 0; i < 2; i++) await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(calls[0][0], "child/wallet/receive");
  assert.equal(calls[0][1].amount, 12.34);
  assert.equal(calls[0][1].note, "Dad");
  assert.ok(calls[0][1].request_id);
  assert.equal(calls[0][1].request_id, calls[1][1].request_id);
  assert.equal(closed, 1);
});
