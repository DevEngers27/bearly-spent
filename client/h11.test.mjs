// Socket-free H11 interaction checks: node --test client/h11.test.mjs
// Browser gestures, installation and visual checks remain in CHECKLIST.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import * as game from "../server/domain.js";
import * as catalog from "../server/catalog.js";

const sources = Object.fromEntries(await Promise.all(["Child.jsx", "Parent.jsx", "App.jsx"].map(async (name) => {
  const extra = { "Child.jsx": "TalkBar", "Parent.jsx": "ParentHelp", "App.jsx": "AuthScreen" }[name];
  const result = await build({
    stdin: { contents: await readFile(new URL(`src/${name}`, import.meta.url), "utf8") + (extra ? `\nexport { ${extra} };` : "") + (name === "Parent.jsx" ? '\nexport { setSelectedChild } from "./api.js";' : ""), resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
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
    location: env.location, history: { state: {}, pushState(value) { this.state = value; }, back() {}, replaceState: (a, b, url) => { env.location.href = url.href; } },
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
const text = (tree) => tree?.type?.name === "Markdown" ? text(tree.type(tree.props)) : typeof tree === "string" || typeof tree === "number" ? String(tree) : (tree?.props?.children || []).map(text).join(" ");
const byText = (tree, label) => nodes(tree, (n) => n.type === "button" && text(n).replace(/\s+/g, " ").trim().includes(label))[0];
const noop = () => {};
const submit = { preventDefault() {} };
function stateFixture() {
  const db = seed(Date.now());
  return { ...db, goals: db.savingsGoals, balances: { savings: 2000, spending: 1000, parent: 25000 }, chat: [], plan: null,
    catalog: { places: Object.fromEntries(Object.entries(catalog.PLACES).map(([id, p]) => [id, { ...p, open: true, image: `/postcards/${id}.png` }])), home: catalog.HOME, lessons: catalog.LESSONS, points: catalog.POINTS, milestones: catalog.MILESTONES, cosmetics: catalog.COSMETICS, greetings: game.GREETINGS },
    integrations: { voice: "browser", buddy: "offline" }, pendingRequests: [] };
}


const component = (tree, name) => nodes(tree, (n) => n.type?.name === name)[0];
const normalized = (tree) => text(tree).replace(/\s+/g, " ").trim();
function meFixture(role = "parent") {
  const child = { id: "child-one", name: "Mia", age: 9, bearName: "Maple" };
  return { role, family: { id: "family-one", pinSet: false }, activeChild: child, children: [child], unlockedUntil: 0 };
}
test("H13.1 welcome screen introduces Bearly Spent", () => {
  const h = harness("App.jsx");
  const tree = h.render(h.exports.AuthScreen, { onSession: noop, toast: noop, demo: false, screen: "welcome", navigate: noop });
  assert.equal(normalized(nodes(tree, (n) => n.type === "h1")[0]), "Welcome to Bearly Spent");
  assert.doesNotMatch(normalized(tree), /MoneyQuest/);
});

test("H11.7 More and desktop navigation open Ask about Bearly Spent and link the Help page", () => {
  for (const mobile of [false, true]) {
    const h = harness("Parent.jsx"), state = stateFixture();
    h.window.matchMedia = () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} });
    const props = { state, me: meFixture(), refreshMe: noop, toast: noop };
    const render = () => h.render(h.exports.default, props);
    if (mobile) byText(render(), "More").props.onClick();
    const entry = byText(render(), "Ask about Bearly Spent");
    assert.ok(entry); entry.props.onClick();
    assert.ok(component(render(), "ParentHelp"));
    if (mobile) assert.ok(byText(render(), "Back to More"));
    const links = nodes(render(), (n) => n.type === "a" && n.props.href === "/help");
    // More owns the link on phones; the desktop sidebar always has it.
    if (!mobile) assert.ok(links.length);
    if (mobile) { byText(render(), "Back to More").props.onClick(); assert.ok(nodes(render(), (n) => n.type === "a" && n.props.href === "/help").length); }
  }
});

test("H11.7 Ask panel posts the selected child's question and renders Markdown without retaining history", async () => {
  const h = harness("Parent.jsx"), calls = [];
  const answer = "1. Open **Children**.\n2. Choose **Get a kid code**.\n\nKeep `codes` private. <script>bad</script>";
  h.exports.setSelectedChild("selected-child");
  h.fetch = async (url, options) => { calls.push([url, options]); return new Response(JSON.stringify({ answer, mode: "offline" })); };
  const render = () => h.render(h.exports.ParentHelp, { offline: false });
  let tree = render(); h.flush();
  assert.equal(normalized(nodes(tree, (n) => n.type === "h1")[0]), "Ask about Bearly Spent");
  const input = nodes(tree, (n) => n.type === "textarea")[0];
  assert.equal(input.props.maxLength, 500);
  assert.equal(byText(tree, "Ask").props.disabled, true);
  input.props.onChange({ target: { value: "  Where do I put the kid code?  " } });
  tree = render();
  const request = nodes(tree, (n) => n.type === "form")[0].props.onSubmit(submit);
  assert.equal(byText(render(), "Finding help…").props.disabled, true);
  await request;
  assert.equal(calls.length, 1); assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].credentials, "same-origin");
  assert.equal(new URL(calls[0][0], h.location).pathname, "/api/parent/help/ask");
  assert.equal(new URL(calls[0][0], h.location).searchParams.get("child"), "selected-child");
  assert.deepEqual(JSON.parse(calls[0][1].body), { question: "Where do I put the kid code?" });
  const markdown = component(render(), "Markdown");
  assert.equal(markdown.props.text, answer);
  const rendered = markdown.type(markdown.props);
  assert.equal(nodes(rendered, (n) => n.type === "ol").length, 1);
  assert.equal(nodes(rendered, (n) => n.type === "strong").length, 2);
  assert.equal(nodes(rendered, (n) => n.type === "script" || n.props.dangerouslySetInnerHTML).length, 0);
  assert.equal(h.storage.size, 0); assert.equal(h.session.size, 0);
});

test("H11.7 Ask panel handles errors, retries, duplicate submits, offline and late unmounted answers", async () => {
  const h = harness("Parent.jsx");
  let calls = 0, finish;
  h.fetch = async () => { calls++; if (calls === 1) return new Response('{"error":"Try again soon"}', { status: 429 }); return new Promise((resolve) => { finish = resolve; }); };
  const render = (offline = false) => h.render(h.exports.ParentHelp, { offline });
  let tree = render(); h.flush();
  nodes(tree, (n) => n.type === "textarea")[0].props.onChange({ target: { value: "Apple Cash" } });
  const submitForm = () => nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  await submitForm();
  assert.match(text(nodes(render(), (n) => n.props.role === "alert")[0]), /Try again soon/);
  const retry = submitForm(); await submitForm();
  assert.equal(calls, 2, "inflight guard prevents a duplicate");
  for (const slot of h.slots) if (typeof slot?.cleanup === "function") slot.cleanup();
  finish(new Response('{"answer":"Late reply"}')); await retry;
  assert.equal(component(render(), "Markdown"), undefined, "unmounted request cannot set an answer");
  const offline = harness("Parent.jsx");
  const offlineTree = offline.render(offline.exports.ParentHelp, { offline: true });
  assert.equal(nodes(offlineTree, (n) => n.type === "textarea")[0].props.disabled, true);
  assert.equal(byText(offlineTree, "Ask").props.disabled, true);
});

test("H11.8 Welcome has a Help footer that does not need a session", () => {
  const h = harness("App.jsx");
  const tree = h.render(h.exports.AuthScreen, { screen: "welcome", navigate: noop });
  const footer = nodes(tree, (n) => n.type === "footer")[0];
  assert.ok(footer);
  assert.equal(nodes(footer, (n) => n.type === "a" && text(n) === "Help")[0].props.href, "/help");
});

test("H11.9 How do I chip starts an editable help question in the kid talk bar", async () => {
  const h = harness("Child.jsx"), state = stateFixture(), calls = [];
  const render = () => h.render(h.exports.TalkBar, { state, talk: { close: noop, send: async (question) => { calls.push(question); return true; } }, open: noop });
  byText(render(), "How do I…?").props.onClick();
  let input = nodes(render(), (n) => n.type === "input")[0];
  assert.equal(input.props.value, "How do I ");
  input.props.onChange({ target: { value: "How do I add a friend?" } });
  await nodes(render(), (n) => n.type === "form")[0].props.onSubmit(submit);
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["How do I add a friend?"]);
});
