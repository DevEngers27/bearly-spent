// Socket-free G2 regressions; real-device checks are listed in CHECKLIST.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import { parentView } from "../server/index.js";

const result = await build({
  stdin: { contents: await readFile(new URL("src/Parent.jsx", import.meta.url), "utf8") + "\nexport { SECTIONS, Goals, Allowance, Activity, Inbox, Guardian, BuddyLog, Settings, WalletLedger, useParentNavigation };", resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
  bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" },
});
const appResult = await build({
  entryPoints: [new URL("src/App.jsx", import.meta.url).pathname],
  bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" },
});

function harness({ mobile = true, media = true, storage = new Map(), app = false, response = {} } = {}) {
  const slots = [], pending = [], pops = [], frames = [null];
  let cursor = 0, index = 0;
  const window = new EventTarget();
  window.scrollTo = () => {};
  const query = Object.assign(new EventTarget(), { matches: mobile, media: "(max-width: 820px)" });
  if (media) window.matchMedia = (value) => { assert.equal(value, query.media); return query; };
  const history = {
    get state() { return frames[index]; },
    pushes: 0, backs: 0,
    pushState(value) { frames.splice(++index, frames.length, value); this.pushes++; },
    replaceState(value) { frames[index] = value; },
    back() { this.backs++; pops.push(() => { if (index) index--; window.dispatchEvent(new Event("popstate")); }); },
    forward() { if (index < frames.length - 1) index++; window.dispatchEvent(new Event("popstate")); },
  };
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
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
  const module = { exports: {} };
  vm.runInNewContext((app ? appResult : result).outputFiles[0].text, {
    module, exports: module.exports, require: () => hooks,
    h: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }), Fragment: "fragment",
    window, history, localStorage: { get length() { return storage.size; }, key: (i) => [...storage.keys()][i], getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    location: new URL("https://moneyquest.test/?role=parent"), navigator: {}, fetch: async () => new Response(JSON.stringify(response)), Event, URL, URLSearchParams, console,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
  });
  return {
    exports: module.exports, history, storage,
    render(fn, props) { cursor = 0; const tree = fn(props); while (pending.length) pending.shift()(); return tree; },
    resize(matches) { query.matches = matches; query.dispatchEvent(new Event("change")); },
    flushHistory() { while (pops.length) pops.shift()(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const nodes = (tree, predicate) => !tree || typeof tree !== "object" ? [] : [...(predicate(tree) ? [tree] : []), ...(tree.props?.children || []).flatMap((child) => nodes(child, predicate))];
const text = (tree) => typeof tree === "string" || typeof tree === "number" ? String(tree) : (tree?.props?.children || []).map(text).join(" ").replace(/\s+/g, " ").trim();
const button = (tree, label) => nodes(tree, (n) => n.type === "button" && text(n) === label)[0];
const nav = (tree, label) => nodes(tree, (n) => n.type === "nav" && n.props["aria-label"] === label)[0];
const component = (tree, name) => nodes(tree, (n) => n.type?.name === name)[0];
const noop = () => {};
function fixture() {
  const state = parentView(seed(Date.now()));
  state.approvals = [
    { id: "one", kind: "reward", title: "Reward", status: "pending", amount: 500 },
    { id: "two", kind: "goal_purchase", title: "Skates", status: "approved", amount: 3000 },
    { id: "three", kind: "goal_purchase", title: "Paid", status: "approved", paidTxnId: "paid" },
    { id: "four", kind: "task", title: "Done", status: "declined" },
  ];
  const child = { id: state.child.id, name: state.child.name, age: 9, bearName: state.child.bear.name };
  return { state, me: { role: "parent", unlockedUntil: Date.now() + 900000, family: { name: "Jordan", pinSet: true }, activeChild: child, children: [child, { ...child, id: "sibling", name: "Leo" }], user: {} }, toast: noop, refreshMe: async () => {} };
}
function parent(options) {
  const h = harness(options), props = fixture();
  return { ...h, props, tree: () => h.render(h.exports.default, props) };
}

test("G2.1: mobile renders exactly five illustrated tabs, the actionable Inbox badge and aria-current", () => {
  const h = parent(), tree = h.tree(), tabs = nav(tree, "Parent tabs");
  assert.deepEqual(nodes(tabs, (n) => n.type === "button").map((n) => n.props["aria-label"]), ["Inbox, 2 pending", "Home", "Money", "Kids", "More"]);
  assert.equal(nodes(tabs, (n) => n.props.className === "badge")[0].props.children[0], 2);
  assert.equal(nodes(tabs, (n) => n.type?.name === "Icon").length, 5);
  assert.equal(nodes(tabs, (n) => n.props["aria-current"] === "page").length, 1);
  assert.equal(nav(tree, "Parent sections"), undefined);
  const inbox = harness(), inboxProps = component(tree, "Inbox").props;
  assert.equal(nodes(inbox.render(inbox.exports.Inbox, inboxProps), (n) => n.props.className === "badge")[0].props.children[0], 2);
  h.props.state.approvals = [];
  assert.equal(nodes(h.tree(), (n) => n.props.className === "badge").length, 0);
});

test("G2.1: Add money's selectSection(allowance) maps Inbox and Home to Money › Allowance", () => {
  const h = parent();
  component(h.tree(), "Inbox").props.onAddMoney();
  let tree = h.tree();
  assert.equal(button(nav(tree, "Parent tabs"), "Money").props["aria-current"], "page");
  assert.equal(button(nav(tree, "Money sections"), "Allowance").props["aria-current"], "page");
  assert.equal(component(tree, "Allowance").props.fundingFocus, 1);
  button(nav(tree, "Parent tabs"), "Home").props.onClick();
  component(h.tree(), "Overview").props.onAddMoney();
  tree = h.tree();
  assert.equal(component(tree, "Allowance").props.fundingFocus, 2);
  assert.equal(button(nav(tree, "Money sections"), "Allowance").props["aria-current"], "page");
});

test("G2.1: Money remembers its segment in store, retains opened form keys, and rejects stale storage", () => {
  const h = parent();
  button(nav(h.tree(), "Parent tabs"), "Money").props.onClick();
  const allowance = component(h.tree(), "Allowance");
  button(nav(h.tree(), "Money sections"), "Goals & tasks").props.onClick();
  const goals = component(h.tree(), "Goals");
  button(nav(h.tree(), "Parent tabs"), "Home").props.onClick();
  assert.equal(component(h.tree(), "Goals").props.key, goals.props.key);
  assert.equal(component(h.tree(), "Allowance").props.key, allowance.props.key);
  button(nav(h.tree(), "Parent tabs"), "Money").props.onClick();
  assert.equal(button(nav(h.tree(), "Money sections"), "Goals & tasks").props["aria-current"], "page");
  const reloaded = parent({ storage: h.storage });
  button(nav(reloaded.tree(), "Parent tabs"), "Money").props.onClick();
  assert.equal(button(nav(reloaded.tree(), "Money sections"), "Goals & tasks").props["aria-current"], "page");
  const stale = parent({ storage: new Map([["mq_parent_money", "missing"]]) });
  button(nav(stale.tree(), "Parent tabs"), "Money").props.onClick();
  assert.equal(button(nav(stale.tree(), "Money sections"), "Allowance").props["aria-current"], "page");
});

test("G2.1: all existing section IDs map to the right mobile tab and Kids has both segments", () => {
  const h = harness();
  const route = () => h.render(h.exports.useParentNavigation);
  for (const [id, expected] of [["inbox", "inbox"], ["overview", "overview"], ["allowance", "money"], ["goals", "money"], ["activity", "money"], ["children", "kids"], ["settings", "kids"], ["guardian", "more"], ["buddy", "more"], ["account", "more"], ["security", "more"]]) {
    route().selectSection(id);
    assert.equal(route().tab, expected, id);
    assert.equal(route().sec, id);
    h.flushHistory();
  }
  const p = parent();
  button(nav(p.tree(), "Parent tabs"), "Kids").props.onClick();
  assert.ok(component(p.tree(), "Children"));
  button(nav(p.tree(), "Kids sections"), "Friends & privacy").props.onClick();
  assert.ok(component(p.tree(), "Settings"));
  button(nav(p.tree(), "Parent tabs"), "Home").props.onClick();
  button(nav(p.tree(), "Parent tabs"), "Kids").props.onClick();
  assert.equal(button(nav(p.tree(), "Kids sections"), "Friends & privacy").props["aria-current"], "page");
});

test("G2.1: More lists Guardian, Buddy, Account, Security and integration status; browser Back closes pushes", () => {
  const h = parent();
  button(nav(h.tree(), "Parent tabs"), "More").props.onClick();
  assert.deepEqual(nodes(nav(h.tree(), "More sections"), (n) => n.type === "button").map(text), ["Guardian log ›", "Buddy chats ›", "Ask about Bearly Spent ›", "Account ›", "Security ›"]);
  assert.match(text(h.tree()), /Integrations & status/);
  assert.ok(component(h.tree(), "Integrations"));
  for (const [label, name] of [["Guardian log", "Guardian"], ["Buddy chats", "BuddyLog"], ["Account", "Account"], ["Security", "Security"]]) {
    button(h.tree(), `${label} ›`).props.onClick();
    assert.ok(component(h.tree(), name));
    assert.ok(button(h.tree(), "‹ Back to More"));
    assert.equal(nav(h.tree(), "More sections"), undefined);
    h.history.back(); h.flushHistory();
    assert.ok(nav(h.tree(), "More sections"));
  }
  assert.equal(h.history.pushes, 4);
});

test("G2.1: on-screen Back, browser Forward, tab exits and unmount consume only owned history entries", () => {
  const h = parent();
  button(nav(h.tree(), "Parent tabs"), "More").props.onClick();
  button(h.tree(), "Account ›").props.onClick();
  h.tree();
  button(h.tree(), "‹ Back to More").props.onClick(); h.flushHistory();
  assert.ok(nav(h.tree(), "More sections"));
  h.history.forward();
  assert.ok(component(h.tree(), "Account"));
  button(nav(h.tree(), "Parent tabs"), "Home").props.onClick(); h.tree(); h.flushHistory();
  assert.ok(component(h.tree(), "Overview"));
  assert.equal(h.history.state, null);
  button(nav(h.tree(), "Parent tabs"), "More").props.onClick();
  button(h.tree(), "Security ›").props.onClick(); h.tree();
  h.unmount(); h.flushHistory();
  assert.equal(h.history.state, null);
});

test("G2.1: rapid Back/tab taps consume one detail entry and reopening More waits for the pending pop", () => {
  const h = parent();
  button(nav(h.tree(), "Parent tabs"), "More").props.onClick();
  button(h.tree(), "Account ›").props.onClick();
  const back = button(h.tree(), "‹ Back to More");
  back.props.onClick(); back.props.onClick();
  button(nav(h.tree(), "Parent tabs"), "Home").props.onClick();
  assert.equal(h.history.backs, 1);
  h.tree(); h.flushHistory();
  assert.ok(component(h.tree(), "Overview"));
  button(nav(h.tree(), "Parent tabs"), "More").props.onClick();
  button(h.tree(), "Account ›").props.onClick();
  button(h.tree(), "‹ Back to More").props.onClick();
  button(h.tree(), "Security ›").props.onClick();
  h.tree(); h.flushHistory();
  assert.ok(component(h.tree(), "Security"));
  assert.equal(h.history.state.mqParent.section, "security");
  h.history.back(); h.flushHistory();
  assert.ok(nav(h.tree(), "More sections"));
});

test("G2.1/5: desktop and missing matchMedia keep every SECTIONS sidebar entry; live resizing maps current detail", () => {
  for (const options of [{ mobile: false }, { media: false }]) {
    const h = parent(options), tree = h.tree();
    assert.deepEqual(nodes(nav(tree, "Parent sections"), (n) => n.type === "button").map((n) => n.props.key), Array.from(h.exports.SECTIONS, ([id]) => id));
    assert.equal(nav(tree, "Parent tabs"), undefined);
  }
  const h = parent({ mobile: false });
  button(h.tree(), "Guardian log").props.onClick(); h.tree();
  h.resize(true); h.tree();
  assert.ok(button(h.tree(), "‹ Back to More"));
  assert.equal(h.history.pushes, 1);
  h.resize(false); h.tree(); h.flushHistory();
  assert.ok(nav(h.tree(), "Parent sections"));
  assert.ok(component(h.tree(), "Guardian"));
  assert.equal(h.history.state, null);
  h.resize(true); h.tree();
  h.history.back(); h.flushHistory(); h.tree();
  h.resize(false);
  assert.ok(component(h.tree(), "Inbox"), "the mobile-only More list has a desktop destination");
});

test("G2.2: the family header follows the selected child and keeps Lock separate from the switcher", async () => {
  for (const siblings of [true, false]) {
    const me = fixture().me;
    if (!siblings) me.children = [me.activeChild];
    const h = harness({ app: true, response: me });
    h.render(h.exports.default);
    await new Promise(setImmediate);
    let tree = h.render(h.exports.default);
    assert.match(text(nodes(tree, (n) => n.props.className === "brand")[0]), /Bearly Spent/);
    assert.equal(text(nodes(tree, (n) => n.props.className === "parent-account-label")[0]).replace(" '", "'"), `${me.activeChild.name}'s account`);
    const selector = nodes(tree, (n) => n.type === "select" && n.props["aria-label"] === "Child")[0];
    assert.equal(selector.props.value, me.activeChild.id);
    assert.ok(button(nodes(tree, (n) => n.props.className === "appbar-actions")[0], "Lock"));
    if (siblings) {
      selector.props.onChange({ target: { value: "sibling" } });
      tree = h.render(h.exports.default);
      assert.equal(text(nodes(tree, (n) => n.props.className === "parent-account-label")[0]).replace(" '", "'"), "Leo's account");
    } else assert.equal(nodes(tree, (n) => n.type === "label" && n.props.className === "child-switcher only-child").length, 1);
  }
});

test("G2.3: phone records expose labels and values, including every transaction and wallet column", () => {
  const props = fixture(), state = props.state;
  state.transactions = [{ id: "one", ts: Date.now(), memo: "A".repeat(200), from: "savings", to: "spending", amount: 100, status: "posted" }];
  state.walletTransactions = [{ ...state.transactions[0], kind: "wallet_spend" }];
  for (const [name, expected] of [["Activity", ["When", "What", "From → to", "Amount", "Status"]], ["WalletLedger", ["When", "What", "Amount", "Status"]]]) {
    const h = harness(), tree = h.render(h.exports[name], props);
    assert.deepEqual(nodes(tree, (n) => n.type === "td").map((n) => n.props["data-label"]), expected);
    assert.ok(nodes(tree, (n) => n.props.className === "p-cell-value").every((n) => text(n).length));
  }
});

test("G2.3: all mobile numeric fields specify decimal or numeric keyboards", () => {
  for (const name of ["Goals", "Allowance"]) {
    const h = harness(), tree = h.render(h.exports[name], { ...fixture(), mobile: true });
    const fields = nodes(tree, (n) => n.type === "input" && n.props.type === "number");
    assert.ok(fields.length);
    assert.ok(fields.every((n) => ["decimal", "numeric"].includes(n.props.inputMode)), name);
  }
});

test("G2.2/3/4/6: phone CSS reserves safe areas, stacks records/forms and actions, and respects reduced motion", async () => {
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  const mobile = css.slice(css.indexOf("/* Parent phone shell"));
  assert.match(mobile, /@media \(max-width: 820px\)/);
  assert.match(mobile, /\.p-tabs \{[^}]*position: fixed;[^}]*env\(safe-area-inset-bottom\)/);
  assert.match(mobile, /\.parent \.p-main \{[^}]*padding:[^;]*env\(safe-area-inset-bottom\)/);
  assert.match(mobile, /\.parent \.p-two, \.parent \.pform-row[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(mobile, /\.parent \.approval-actions \.pbtn \{ width: 100%/);
  assert.match(mobile, /\.parent \.ptable td\[data-label\]::before \{ content: attr\(data-label\)/);
  assert.match(mobile, /\.parent button, \.parent a \{ min-width: 44px; min-height: 44px/);
  assert.match(mobile, /\.parent \.pform input, \.parent \.pform select \{[^}]*font-size: 16px/);
  assert.match(mobile, /\.role-parent \.appbar-actions \{ grid-column: 2; grid-row: 2/);
  assert.match(css, /:focus-visible \{ outline: 3px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important; transition: none !important/);
});
