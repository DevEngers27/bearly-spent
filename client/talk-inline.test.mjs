// Socket-free checks for the talk bar living in the page under the bear scene (0.8.6), C1 harness style.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import * as catalog from "../server/catalog.js";
import * as game from "../server/domain.js";

const sources = Object.fromEntries(await Promise.all(["Parent.jsx", "Child.jsx"].map(async (name) => {
  const extra = name === "Parent.jsx" ? "Overview" : "Home, TalkBar, SpeechBubble";
  const result = await build({
    stdin: { contents: await readFile(new URL(`src/${name}`, import.meta.url), "utf8") + `\nexport { ${extra} };`, resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
    bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" },
  });
  return [name, result.outputFiles[0].text];
})));

function harness(name = "Parent.jsx", { controller = null } = {}) {
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

const settle = () => new Promise(setImmediate);
const childProps = () => ({
  me: { family: { pinSet: true }, children: [
    { id: "one", name: "Kai", age: 9, bearName: "Bo" },
    { id: "two", name: "Leo", age: 8, bearName: "Pip" },
  ] },
  run: async (action) => action(),
});
const component = (tree, name) => nodes(tree, (n) => n.type?.name === name);
const field = (tree, label) => nodes(tree, (n) => n.type === "label" && text(n).startsWith(label)).flatMap((n) => nodes(n, (el) => ["input", "select"].includes(el.type)))[0];


function stateFixture() {
  const db = seed(Date.now());
  return { ...db, goals: db.savingsGoals, balances: { savings: 2000, spending: 1000, parent: 25000 }, chat: [], plan: null,
    catalog: { places: Object.fromEntries(Object.entries(catalog.PLACES).map(([id, p]) => [id, { ...p, open: true, image: `/postcards/${id}.png` }])), home: catalog.HOME, lessons: catalog.LESSONS, points: catalog.POINTS, milestones: catalog.MILESTONES, cosmetics: catalog.COSMETICS, greetings: game.GREETINGS },
    integrations: { voice: "browser", buddy: "offline" }, pendingRequests: [] };
}

const talkStub = (over = {}) => ({ isOpen: true, bubble: "", bubbleId: 1, mood: "happy", open: noop, close: noop, dismiss: noop, send: async () => true, ...over });
const homeChildren = (tree) => (tree.props.children || []).filter(Boolean);
const className = (n) => String(n?.props?.className || "");
const plain = (value) => JSON.parse(JSON.stringify(value)); // vm-realm objects are not reference-equal to ours

test("talk bar renders inside Home right under the scene and the Talk chip steps aside while it is open", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  let tree = h.render(h.exports.Home, { state, talk: talkStub(), open: noop, talkOpen: true });
  const kids = homeChildren(tree);
  const scene = kids.findIndex((n) => /\bscene\b/.test(className(n)));
  const bar = kids.findIndex((n) => n.type === h.exports.TalkBar);
  const tools = kids.findIndex((n) => className(n) === "home-tools");
  assert.ok(scene >= 0 && bar === scene + 1 && tools === bar + 1, `order scene=${scene} bar=${bar} tools=${tools}`);
  const talkChip = (t) => nodes(t, (n) => n.type === "button" && className(n) === "chip" && text(n).includes("Talk to"))[0];
  assert.equal(talkChip(tree), undefined, "the Talk chip steps aside (the note's Talk link may stay)"); assert.ok(byText(tree, "Dress up"));
  tree = h.render(h.exports.Home, { state, talk: talkStub({ isOpen: false }), open: noop, talkOpen: false });
  assert.equal(nodes(tree, (n) => n.type === h.exports.TalkBar).length, 0); assert.ok(talkChip(tree));
  tree = h.render(h.exports.Home, { state, talk: talkStub(), open: noop });
  assert.equal(nodes(tree, (n) => n.type === h.exports.TalkBar).length, 0, "Home never shows the bar unless the app says so (sheet or reveal on top)");
});

test("the talk bar lives only in Home: the app no longer mounts it as a fixed overlay", async () => {
  const src = await readFile(new URL("src/Child.jsx", import.meta.url), "utf8");
  assert.equal(src.match(/<TalkBar\b/g).length, 1);
  assert.match(src, /\{talkOpen && <TalkBar /);
  assert.match(src, /<Home \{\.\.\.ctx\} talkOpen=\{talk\.isOpen && !sheet && !reveal\} \/>/);
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  const rule = css.match(/^\.talk-bar \{[^}]*\}/m)[0];
  assert.doesNotMatch(rule, /position: fixed|bottom:/); assert.match(rule, /position: relative/);
  assert.doesNotMatch(css, /:has\(\.talk-bar\)/);
  assert.match(css, /\.talk-bar input \{[^}]*scroll-margin-block/);
});

test("a phone gets no cursor when the bar opens (no keyboard jump); a mouse gets it without scrolling; the bar scrolls itself into view", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  const focusCalls = [], scrollCalls = [];
  const opener = { focus: () => focusCalls.push("opener") };
  h.document.activeElement = opener;
  const props = { state, talk: talkStub(), open: noop };
  let tree = h.render(h.exports.TalkBar, props);
  const element = { focus: (opts) => { focusCalls.push(opts); h.document.activeElement = element; } };
  nodes(tree, (n) => n.type === "input")[0].props.ref.current = element;
  tree.props.ref.current = { scrollIntoView: (opts) => scrollCalls.push(opts) };
  h.flush();
  assert.equal(h.document.activeElement, opener, "touch: the box is not focused on open");
  assert.deepEqual(focusCalls, []);
  assert.deepEqual(plain(scrollCalls), [{ block: "nearest", behavior: "smooth" }]);
  h.slots.find((s) => s?.cleanup)?.cleanup();
  assert.deepEqual(focusCalls, ["opener"]);

  const mouse = harness("Child.jsx"); mouse.window.matchMedia = (q) => ({ matches: q.includes("pointer: fine") || q.includes("reduced-motion") });
  const calls = [], scrolls = [];
  mouse.document.activeElement = opener;
  tree = mouse.render(mouse.exports.TalkBar, props);
  const box = { focus: (opts) => { calls.push(opts); mouse.document.activeElement = box; } };
  nodes(tree, (n) => n.type === "input")[0].props.ref.current = box;
  tree.props.ref.current = { scrollIntoView: (opts) => scrolls.push(opts) };
  mouse.flush();
  assert.equal(mouse.document.activeElement, box);
  assert.deepEqual(plain(calls), [{ preventScroll: true }]);
  assert.deepEqual(plain(scrolls), [{ block: "nearest", behavior: "auto" }], "reduced motion scrolls without animation");
});

test("sending a chip on a phone leaves the keyboard closed; sending while typing keeps the cursor", async () => {
  const h = harness("Child.jsx"), state = stateFixture();
  const focusCalls = [], sent = [];
  const props = { state, talk: talkStub({ send: async (t) => { sent.push(t); return true; } }), open: noop };
  let tree = h.render(h.exports.TalkBar, props);
  const box = { focus: (opts) => { focusCalls.push(opts); h.document.activeElement = box; } };
  nodes(tree, (n) => n.type === "input")[0].props.ref.current = box; h.flush();
  await byText(tree, "What should I do with my allowance?").props.onClick();
  assert.deepEqual(sent, ["What should I do with my allowance?"]); assert.deepEqual(focusCalls, []);
  h.document.activeElement = box;
  tree = h.render(h.exports.TalkBar, props);
  nodes(tree, (n) => n.type === "input")[0].props.onChange({ target: { value: "Hi Maple" } });
  tree = h.render(h.exports.TalkBar, props);
  nodes(tree, (n) => n.type === "form")[0].props.onSubmit(submit); await settle();
  assert.equal(sent.at(-1), "Hi Maple"); assert.deepEqual(plain(focusCalls), [{ preventScroll: true }]);
  assert.equal(nodes(h.render(h.exports.TalkBar, props), (n) => n.type === "input")[0].props.value, "");
  byText(tree, "How do I…?").props.onClick();
  assert.deepEqual(plain(focusCalls.at(-1)), { preventScroll: true }, "the how-to chip is an explicit wish to type");
});

test("tapping inside the talk bar keeps the bubble; tapping elsewhere outside the scene still dismisses it", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  let dismissed = 0;
  h.render(h.exports.Home, { state, talk: talkStub({ dismiss: () => dismissed++ }), open: noop, talkOpen: true }); h.flush();
  const click = (inside) => { const e = new Event("click"); Object.defineProperty(e, "target", { value: { closest: (sel) => inside.includes(sel) ? {} : null } }); h.window.dispatchEvent(e); };
  click([".talk-bar"]); assert.equal(dismissed, 0);
  click([".scene"]); assert.equal(dismissed, 0);
  click([]); assert.equal(dismissed, 1);
});

test("the Tap to talk pill is a real button that opens the talk bar, and hides while the bar is open or the bear is away", () => {
  const h = harness("Child.jsx"), state = stateFixture();
  let opened = 0;
  const talk = talkStub({ isOpen: false, open: () => opened++ });
  let tree = h.render(h.exports.Home, { state, talk, open: noop, talkOpen: false });
  const pill = byText(tree, "Tap to talk");
  assert.ok(pill, "pill rendered as a button"); assert.equal(pill.props.type, "button"); assert.equal(pill.props.className, "tap-hint");
  pill.props.onClick(); assert.equal(opened, 1);
  tree = h.render(h.exports.Home, { state, talk: talkStub(), open: noop, talkOpen: true });
  assert.equal(byText(tree, "Tap to talk"), undefined, "no pill while the bar is open");
  state.adventures.push({ id: "adv_test", status: "away", destId: "seattle", returnsAt: Date.now() + 60000, startedAt: Date.now() });
  tree = h.render(h.exports.Home, { state, talk, open: noop, talkOpen: false });
  assert.equal(byText(tree, "Tap to talk"), undefined, "no pill while the bear is away");
});
