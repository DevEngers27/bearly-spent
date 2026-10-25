// Socket-free G5 profile regressions: node --test client/profile.test.mjs
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

const sources = Object.fromEntries(await Promise.all(["api.js", "Child.jsx", "Parent.jsx", "Account.jsx", "ChildProfileForm.jsx"].map(async (name) => {
  const extra = { "Child.jsx": "ProfileSheet, SheetRouter, Buddy", "Parent.jsx": "Children, SECTIONS" }[name];
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
  env.history = { state: null, pushes: 0, backs: 0,
    pushState(value) { this.state = value; this.pushes++; },
    back() { this.state = null; this.backs++; },
    replaceState(a, b, url) { env.location.href = url.href; },
  };
  env.navigator = { serviceWorker: Object.assign(new EventTarget(), { controller }) };
  const module = { exports: {} };
  vm.runInNewContext(sources[name], {
    module, exports: module.exports, require: () => hooks,
    h: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }), Fragment: "fragment",
    window, document: env.document, navigator: env.navigator, sessionStorage: storageApi(session), localStorage: storageApi(storage),
    location: env.location, history: env.history,
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

const profileState = () => childView(seed(Date.UTC(2026, 0, 1)));
const input = (tree, label) => nodes(tree, (n) => n.type === "label" && text(n).startsWith(label)).flatMap((n) => nodes(n, (x) => ["input", "select"].includes(x.type)))[0];
const component = (tree, name) => nodes(tree, (n) => n.type?.name === name)[0];

test("G5.1: identity chip and Buddy Me open the profile sheet; router reuses Friends and closet", () => {
  const h = harness("Child.jsx"), state = profileState();
  const props = { state, toast: h.toast };
  let tree = h.render(h.exports.default, props);
  nodes(tree, (n) => n.props?.className === "identity-chip")[0].props.onClick();
  tree = h.render(h.exports.default, props);
  const router = component(tree, "SheetRouter");
  assert.equal(router.props.sheet.type, "profile");
  assert.equal(h.exports.SheetRouter(router.props).type.name, "ProfileSheet");
  const buddy = harness("Child.jsx"), opened = [];
  tree = buddy.render(buddy.exports.Buddy, { state, open: (name) => opened.push(name), startTalk: noop });
  byText(tree, "Me").props.onClick();
  assert.deepEqual(opened, ["profile"]);
  const friends = h.exports.SheetRouter({ sheet: { type: "friends" }, state, close: noop });
  assert.equal(friends.type.name, "Sheet");
  assert.equal(component(friends, "Friends").props.state, state);
  assert.equal(h.exports.SheetRouter({ sheet: { type: "dress" }, state }).type.name, "DressSheet");
});

test("G5.2/6: profile renders live portrait, sections, numbers, badges and conditional Friend code", async () => {
  const h = harness("Child.jsx"), state = profileState(), opened = [];
  state.profile.stats.longestStreak = 7;
  state.profile.stats.tripsTaken = 12;
  state.profile.stats.lessonsFinished = 4;
  state.profile.stats.missionsDone = 3;
  state.profile.badges = [{ at: 5000, label: "Ranger", reward: "Flower crown unlocked" }, { at: 1000, label: "Cub", reward: "First sparkle" }];
  const props = { state, run: async (fn) => typeof fn === "function" ? fn() : {}, close: noop, open: (name) => opened.push(name) };
  let tree = h.render(h.exports.ProfileSheet, props);
  assert.equal(tree.props.title, state.child.name);
  assert.equal(tree.props.fullHeight, true);
  assert.equal(component(tree, "BearFigure").props.bear, state.child.bear);
  for (const label of ["About me", "My numbers", "Badges", "Ask a grown-up to change these", "January 2026", "Ranger", "Cub", "12", "4", "3", "7"]) assert.ok(text(tree).includes(label), label);
  assert.ok(text(tree).indexOf("Ranger") < text(tree).indexOf("Cub"));
  assert.equal(text(tree).includes("Friend code"), false);
  assert.equal(byText(tree, "Grown-ups"), undefined);
  byText(tree, "Add a friend").props.onClick(); byText(tree, "Dress up").props.onClick();
  assert.deepEqual(opened, ["friends", "dress"]);
  const copied = [];
  h.navigator.clipboard = { writeText: async (value) => copied.push(value) };
  state.friendCode = "PECAN-42";
  tree = h.render(h.exports.ProfileSheet, props);
  assert.ok(text(tree).includes("Friend code")); assert.ok(text(tree).includes("PECAN-42"));
  await byText(tree, "Copy").props.onClick(); assert.deepEqual(copied, ["PECAN-42"]);
  state.friendCode = null;
  delete state.profile.stats.longestStreak;
  tree = h.render(h.exports.ProfileSheet, props);
  assert.equal(text(tree).includes("Friend code"), false); assert.equal(text(tree).includes("Longest streak"), false);
  let closed = 0, grown = 0;
  tree = h.render(h.exports.ProfileSheet, { ...props, onGrownUps: () => grown++, close: () => closed++ });
  byText(tree, "Grown-ups").props.onClick(); assert.equal(closed, 1); assert.equal(grown, 1);
});

test("G5.3: inline bear rename submits profile fields, preserves failed drafts and cancels", async () => {
  const h = harness("Child.jsx"), calls = [], state = profileState();
  let succeed = false;
  const props = { state, busy: false, run: async (...args) => { calls.push(args); return succeed ? {} : null; }, close: noop, open: noop };
  let tree = h.render(h.exports.ProfileSheet, props);
  byText(tree, "Rename my bear").props.onClick();
  tree = h.render(h.exports.ProfileSheet, props);
  input(tree, "Bear's name").props.onChange({ target: { value: "Pecan" } });
  tree = h.render(h.exports.ProfileSheet, props);
  assert.equal(input(tree, "Bear's name").props.maxLength, 24);
  await nodes(tree, (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(calls[0][0], "child/profile"); assert.equal(calls[0][1].bearName, "Pecan");
  tree = h.render(h.exports.ProfileSheet, props);
  assert.equal(input(tree, "Bear's name").props.value, "Pecan");
  byText(tree, "Cancel").props.onClick();
  tree = h.render(h.exports.ProfileSheet, props);
  byText(tree, "Rename my bear").props.onClick();
  tree = h.render(h.exports.ProfileSheet, props);
  assert.equal(input(tree, "Bear's name").props.value, state.child.bear.name);
  succeed = true;
  await nodes(tree, (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.ok(byText(h.render(h.exports.ProfileSheet, props), "Rename my bear"));
});

const accountMe = { user: { id: "user", name: "Jordan", email: "jordan@example.test" }, family: { name: "Jordan", displayName: "The Oaks" }, children: [] };
test("G5.4: Account navigation sits between Children and Security and forms save through refreshMe", async () => {
  const p = harness("Parent.jsx"), ids = p.exports.SECTIONS.map(([id]) => id);
  assert.equal(ids.indexOf("account"), ids.indexOf("children") + 1);
  assert.equal(ids.indexOf("security"), ids.indexOf("account") + 1);
  const h = harness("Account.jsx"), calls = [];
  let refreshed = 0;
  h.fetch = async (url, options) => { calls.push([url, JSON.parse(options.body)]); return new Response("{\"ok\":true}"); };
  const props = { me: accountMe, refreshMe: async () => refreshed++, run: async (fn) => fn(), busy: false };
  const render = () => h.render(h.exports.default, props);
  let tree = render();
  assert.match(text(tree), /Current email:\s+jordan@example\.test/);
  assert.equal(input(tree, "Parent name").props.maxLength, 64);
  assert.equal(input(tree, "Family name").props.maxLength, 40);
  input(tree, "Parent name").props.onChange({ target: { value: "Robin" } });
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  input(render(), "Family name").props.onChange({ target: { value: "The Pines" } });
  await nodes(render(), (n) => n.type === "form")[1].props.onSubmit(submit);
  input(render(), "Email").props.onChange({ target: { value: "robin@example.test" } });
  let emailForm = nodes(render(), (n) => n.type === "form")[2];
  input(emailForm, "Current password").props.onChange({ target: { value: "old-password" } });
  await nodes(render(), (n) => n.type === "form")[2].props.onSubmit(submit);
  let passwordForm = nodes(render(), (n) => n.type === "form")[3];
  input(passwordForm, "Current password").props.onChange({ target: { value: "old-password" } });
  passwordForm = nodes(render(), (n) => n.type === "form")[3];
  input(passwordForm, "New password").props.onChange({ target: { value: "new-password" } });
  passwordForm = nodes(render(), (n) => n.type === "form")[3];
  assert.equal(input(passwordForm, "New password").props.minLength, 8);
  await passwordForm.props.onSubmit(submit);
  assert.equal(JSON.stringify(calls), JSON.stringify([
    ["/api/auth/account", { name: "Robin" }], ["/api/parent/family", { displayName: "The Pines" }],
    ["/api/auth/email", { email: "robin@example.test", password: "old-password" }],
    ["/api/auth/password", { currentPassword: "old-password", newPassword: "new-password" }],
  ]));
  assert.equal(refreshed, 4);
  passwordForm = nodes(render(), (n) => n.type === "form")[3];
  assert.equal(input(passwordForm, "Current password").props.value, "");
  assert.equal(input(passwordForm, "New password").props.value, "");
  tree = h.render(h.exports.default, { ...props, busy: true });
  assert.ok(nodes(tree, (n) => n.type === "button").every((n) => n.props.disabled));
});

test("G5.5: Children cards insert isolated editors; sibling Save/Cancel refreshes summaries", async () => {
  const parent = harness("Parent.jsx");
  const summary = { id: "sibling", name: "Sam", age: 9, bearName: "Oak", version: 1 };
  const tree = parent.render(parent.exports.Children, { me: { ...accountMe, children: [summary] }, run: noop, refreshMe: noop });
  assert.equal(component(tree, "ChildProfileForm").props.summary, summary);
  const h = harness("ChildProfileForm.jsx"), calls = [];
  let refreshed = 0;
  h.fetch = async (url, options) => { calls.push([url, JSON.parse(options.body)]); return new Response("{}"); };
  const props = { summary, refreshMe: async () => refreshed++, run: async (fn) => fn() };
  const render = () => h.render(h.exports.default, props);
  byText(render(), "Edit profile").props.onClick();
  input(render(), "Child's name").props.onChange({ target: { value: "Alex" } });
  input(render(), "Age").props.onChange({ target: { value: "12" } });
  input(render(), "Bear's name").props.onChange({ target: { value: "Pecan" } });
  await render().props.onSubmit(submit);
  assert.equal(JSON.stringify(calls), JSON.stringify([["/api/parent/children/sibling/profile", { name: "Alex", age: 12, bearName: "Pecan" }]]));
  assert.equal(refreshed, 1);
  byText(render(), "Edit profile").props.onClick();
  input(render(), "Child's name").props.onChange({ target: { value: "Unsaved" } });
  byText(render(), "Cancel").props.onClick();
  byText(render(), "Edit profile").props.onClick();
  assert.equal(input(render(), "Child's name").props.value, "Sam");
});

test("G5.4: wrong account passwords retain identity; locked account routes emit the PIN gate event", async () => {
  const h = harness("api.js");
  h.storage.set("mq_parent_session", "identity");
  let unauthorized = 0, locked = 0;
  h.window.addEventListener("mq:unauthorized", () => unauthorized++);
  h.window.addEventListener("mq:locked", () => locked++);
  h.fetch = async () => new Response('{"error":"That password did not match"}', { status: 401 });
  for (const route of ["auth/email", "auth/password"]) await assert.rejects(h.exports.api(route, {}), /password/);
  assert.equal(unauthorized, 0); assert.equal(h.storage.get("mq_parent_session"), "identity");
  h.fetch = async () => new Response('{"error":"Please unlock parent mode"}', { status: 403 });
  for (const route of ["auth/account", "auth/email", "auth/password"]) await assert.rejects(h.exports.api(route, {}), /unlock/);
  assert.equal(locked, 3);
});

test("G5.1: full-height Sheet closes on browser Back or Escape, restores focus and removes its history entry", async () => {
  for (const back of [true, false]) {
    const h = harness("Child.jsx");
    let closed = 0, focused = 0;
    h.document.activeElement = { focus: () => focused++ };
    const tree = h.render(h.exports.Sheet, { title: "Ben", fullHeight: true, onClose: () => closed++ });
    assert.ok(nodes(tree, (n) => n.props?.className?.includes("full-height")).length);
    h.slots[0].current = { focus() {}, querySelectorAll: () => [] };
    h.flush();
    assert.equal(h.history.pushes, 1);
    if (back) {
      h.history.state = null;
      h.window.dispatchEvent(new Event("popstate"));
    } else {
      const event = new Event("keydown", { cancelable: true }); event.key = "Escape";
      h.window.dispatchEvent(event);
    }
    assert.equal(closed, 1);
    for (const slot of h.slots) slot?.cleanup?.();
    assert.equal(focused, 1);
    assert.equal(h.history.backs, back ? 0 : 1);
    h.window.dispatchEvent(new Event("popstate"));
    assert.equal(closed, 1);
  }
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.identity-chip\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.sheet\.full-height\s*\{[^}]*height:\s*100dvh/);
});
