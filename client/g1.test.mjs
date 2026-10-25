// Socket-free component/action regressions, following c1.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import { childView } from "../server/index.js";

const sources = Object.fromEntries(await Promise.all(["Child.jsx", "Parent.jsx", "api.js"].map(async (name) => {
  const extra = { "Child.jsx": "Home, GoalsSheet, SheetRouter", "Parent.jsx": "Goals, SavingsGoal, Inbox, Overview" }[name];
  const result = await build({ stdin: { contents: await readFile(new URL(`src/${name}`, import.meta.url), "utf8") + (extra ? `\nexport { ${extra} };` : ""), resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" }, bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" } });
  return [name, result.outputFiles[0].text];
})));

function harness(name) {
  const slots = [], effects = [], storage = new Map();
  let cursor = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => v !== slots[i][j])) { effects.push(fn); slots[i] = deps; } },
    useMemo(fn) { cursor++; return fn(); },
    useCallback(fn) { cursor++; return fn; },
  };
  const env = { fetch: async () => new Response("{}"), window: new EventTarget() }, module = { exports: {} };
  vm.runInNewContext(sources[name], {
    module, exports: module.exports, require: () => hooks, h: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }), Fragment: "fragment",
    window: env.window, document: {}, navigator: {}, location: new URL("https://moneyquest.test/"), Event, URLSearchParams,
    localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    fetch: (...args) => env.fetch(...args), Date, console, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
  });
  return Object.assign(env, { exports: module.exports, render(fn, props) { cursor = 0; return fn(props); }, flush() { while (effects.length) effects.shift()(); } });
}
const nodes = (tree, predicate) => !tree || typeof tree !== "object" ? [] : [...(predicate(tree) ? [tree] : []), ...(tree.props?.children || []).flatMap((c) => nodes(c, predicate))];
const text = (tree) => typeof tree === "string" || typeof tree === "number" ? String(tree) : (tree?.props?.children || []).map(text).join(" ");
const button = (tree, label) => nodes(tree, (n) => n.type === "button" && text(n).trim() === label)[0];
const change = (tree, label, value) => nodes(nodes(tree, (n) => n.type === "label" && text(n).startsWith(label))[0], (n) => ["input", "select"].includes(n.type))[0].props.onChange({ target: { value } });
const submit = { preventDefault() {} };
function fixture() {
  const db = seed(Date.now());
  db.child.name = "Ben"; db.child.bear.name = "Bo";
  db.child.currentGoalId = "second";
  db.savingsGoals.push({ id: "second", title: "Lego set", icon: "toy", target: 6000, createdAt: 1, status: "reached" }, { id: "old", title: "Old book", icon: "book", target: 1000, createdAt: 1, status: "bought" }, { id: "rest", title: "Trip", icon: "trip", target: 10000, createdAt: 1, status: "archived" });
  return { ...childView(db), accounts: db.accounts, approvals: [], family: db.family };
}

test("G1 Home uses the current goal, opens switcher and requests a goal purchase", async () => {
  const h = harness("Child.jsx"), state = fixture(), calls = [], opened = [];
  const props = { state, open: (...args) => opened.push(args), run: async (...args) => calls.push(args) };
  const render = () => h.render(h.exports.Home, props);
  assert.match(text(render()), /Lego set.*You did it! Ask your grown-up to buy it/);
  assert.doesNotMatch(text(render()), /New bicycle/);
  button(render(), "Switch goal").props.onClick();
  assert.equal(opened[0][0], "goals");
  await button(render(), "Ask to buy it").props.onClick();
  assert.equal(calls[0][0], "child/goals/second/purchase");
  state.pendingRequests = [{ id: "purchase", kind: "goal_purchase", goalId: "second" }];
  assert.equal(button(render(), "Waiting for your grown-up").props.disabled, true);
  state.currentGoalId = "second"; state.child.currentGoalId = "second";
  state.goals.forEach((g) => { g.status = "bought"; });
  assert.match(text(render()), /Pick or create your next goal!/);
  button(render(), "My goals").props.onClick();
  assert.equal(opened[1][0], "goals");
  const route = h.render(h.exports.SheetRouter, { sheet: { type: "goals" }, ...props });
  assert.equal(route.type.name, "GoalsSheet");
});

test("G1 Goals sheet lists history, creates/edits/switches/archives and preserves failed drafts", async () => {
  const h = harness("Child.jsx"), state = fixture(), calls = [];
  let success = false;
  const props = { state, run: async (...args) => { calls.push(args); return success ? {} : null; } };
  const render = () => h.render(h.exports.GoalsSheet, props);
  assert.match(text(render()), /Ben.*New bicycle.*Saving.*Lego set.*Reached!.*Current goal.*Old book.*Bought.*Trip.*Put away/);
  assert.equal(button(render(), "Save for this").props.disabled, undefined);
  await button(render(), "Save for this").props.onClick();
  assert.equal(calls.at(-1)[0], "child/goals/goal_bike/current");
  change(render(), "Saving for", "Skates"); change(render(), "Target ($)", "60.25"); button(render(), "Gift").props.onClick();
  let form = () => nodes(render(), (n) => n.type === "form")[0];
  await form().props.onSubmit(submit);
  assert.equal(calls.at(-1)[0], "child/goals");
  assert.equal(JSON.stringify(calls.at(-1)[1]), JSON.stringify({ title: "Skates", target: "60.25", icon: "gift" }));
  assert.equal(nodes(render(), (n) => n.type === "input")[0].props.value, "Skates");
  success = true; await form().props.onSubmit(submit);
  assert.equal(nodes(render(), (n) => n.type === "input")[0].props.value, "");
  button(render(), "Edit").props.onClick(); render(); h.flush();
  change(render(), "Saving for", "Bicycle bell");
  await form().props.onSubmit(submit);
  assert.equal(calls.at(-1)[0], "child/goals/goal_bike");
  assert.equal(calls.at(-1)[1].title, "Bicycle bell");
  await button(render(), "Put away").props.onClick();
  assert.equal(calls.at(-1)[0], "child/goals/goal_bike/archive");
  props.busy = true;
  assert.equal(nodes(render(), (n) => n.type === "fieldset")[0].props.disabled, true);
  assert.equal(button(render(), "Save for this").props.disabled, true);
});

test("G1 Goals sheet keeps drafts across polls and syncs changed server fields", () => {
  const h = harness("Child.jsx"), state = fixture();
  const render = () => h.render(h.exports.GoalsSheet, { state });
  render(); h.flush(); button(render(), "Edit").props.onClick(); render(); h.flush();
  change(render(), "Saving for", "My draft");
  state.version++; render(); h.flush();
  assert.equal(nodes(render(), (n) => n.type === "input")[0].props.value, "My draft");
  state.goals[0] = { ...state.goals[0], title: "Server title" };
  render(); h.flush();
  assert.equal(nodes(render(), (n) => n.type === "input")[0].props.value, "Server title");
});

test("G1 parent controls use selected goal IDs and protect bought/current/pending goals", async () => {
  const state = fixture(), calls = [];
  const h = harness("Parent.jsx");
  const props = { state, goal: state.goals[0], run: async (...args) => { calls.push(args); return {}; } };
  const render = () => h.render(h.exports.SavingsGoal, props);
  await button(render(), "Make current").props.onClick();
  assert.equal(calls.at(-1)[0], "parent/goals/goal_bike/current");
  change(render(), "Saving for", "Skates");
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(calls.at(-1)[0], "parent/goals/goal_bike");
  assert.equal(calls.at(-1)[1].title, "Skates");
  await button(render(), "Archive").props.onClick();
  assert.equal(calls.at(-1)[0], "parent/goals/goal_bike/archive");
  await button(render(), "Delete").props.onClick();
  await button(render(), "Confirm delete").props.onClick();
  assert.equal(calls.at(-1)[0], "parent/goals/goal_bike");
  assert.equal(calls.at(-1)[3].method, "DELETE");
  props.goal = state.goals[1]; assert.equal(button(render(), "Delete").props.disabled, true);
  props.goal = state.goals[2]; assert.equal(button(render(), "Delete").props.disabled, true);
  props.goal = state.goals[0];
  state.approvals = [{ kind: "goal_purchase", goalId: "goal_bike", status: "pending" }];
  assert.equal(button(render(), "Update").props.disabled, true);
  assert.equal(button(render(), "Archive").props.disabled, true);
  const goals = h.render(h.exports.Goals, { state });
  assert.equal(nodes(goals, (n) => n.type?.name === "SavingsGoal").length, 5);
  const overview = h.render(h.exports.Overview, { state });
  assert.match(nodes(overview, (n) => n.type?.name === "Figure")[0].props.sub, /Lego set/);
  const create = harness("Parent.jsx");
  const tree = () => create.render(create.exports.SavingsGoal, { state, create: true, run: props.run });
  change(tree(), "Saving for", "Gift");
  await nodes(tree(), (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(calls.at(-1)[0], "parent/goals");
});

test("G1 Inbox labels the goal purchase and exposes approve/decline, including unpaid requests", async () => {
  const h = harness("Parent.jsx"), state = fixture(), calls = [];
  const approval = { id: "buy", kind: "goal_purchase", status: "pending", title: "Ben reached Lego set ($60.00)", amount: 6000, detail: "Buy it and take $60.00 out of savings?" };
  const props = { state, pending: [approval], run: async (...args) => calls.push(args) };
  const render = () => h.render(h.exports.Inbox, props);
  assert.match(text(render()), /Goal purchase.*Ben reached Lego set.*out of savings/);
  await button(render(), "Approve").props.onClick();
  assert.equal(calls.at(-1)[0], "parent/approval/buy"); assert.equal(calls.at(-1)[1].approve, true);
  await button(render(), "Decline").props.onClick(); assert.equal(calls.at(-1)[1].approve, false);
  approval.status = "approved";
  assert.equal(button(render(), "Approve").props.disabled, true);
  assert.equal(button(render(), "Decline").props.disabled, undefined);
  props.busy = true; assert.equal(button(render(), "Decline").props.disabled, true);
});

test("G1 API sends DELETE with selected child and guards same-tick goal purchase requests", async () => {
  const h = harness("api.js"), requests = [];
  h.exports.setSelectedChild("ben");
  h.fetch = async (url, options) => { requests.push([url, options]); return new Response("{}"); };
  let changes = 0;
  h.window.addEventListener("mq:changed", () => changes++);
  let run = h.render(() => h.exports.useAction(() => {}))[0];
  await run("parent/goals/old", undefined, "Deleted", { method: "DELETE" });
  assert.equal(requests[0][0], "/api/parent/goals/old?child=ben");
  assert.equal(requests[0][1].method, "DELETE");
  assert.equal(changes, 1);
  let resolve;
  h.fetch = (url) => { requests.push(url); return new Promise((r) => { resolve = r; }); };
  const first = run("child/goals/second/purchase", {});
  assert.equal(await run("child/goals/second/purchase", {}), null);
  assert.equal(requests.length, 2);
  resolve(new Response("{}")); await first;
});
