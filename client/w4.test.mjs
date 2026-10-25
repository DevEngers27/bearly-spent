// Socket-free W4 UI regressions, using the C1 JSX + hook harness style.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import { parentView } from "../server/index.js";

const sources = Object.fromEntries(await Promise.all(["Parent.jsx", "Child.jsx"].map(async (name) => {
  const extra = name === "Parent.jsx" ? "Children, Devices, AppleCashTracking, Goals, Settings, Allowance, WalletLedger" : "SpeechBubble";
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

test("W4.1: unlinking a Shortcut immediately remounts only its child's tracking card", async () => {
  const children = harness(), props = childProps();
  const render = () => children.render(children.exports.Children, props);
  const initial = render();
  const devices = harness();
  const deviceProps = component(initial, "Devices")[0].props;
  let active = true;
  const shortcut = { id: "shortcut-one", kind: "shortcut", name: "Apple Cash Shortcut", created_at: Date.now(), last_seen: Date.now() };
  const browser = { ...shortcut, id: "browser-one", kind: "browser", name: "Safari on iPhone" };
  devices.fetch = async (url, options) => {
    if (options.method === "DELETE") {
      assert.equal(url, "/api/parent/children/one/devices/shortcut-one?child=one");
      active = false;
      return new Response('{"ok":true}');
    }
    return new Response(JSON.stringify([shortcut, browser]));
  };
  const renderDevices = () => devices.render(devices.exports.Devices, deviceProps);
  renderDevices(); devices.flush(); await settle();
  const tracking = harness();
  tracking.fetch = async () => new Response(JSON.stringify(active ? { id: shortcut.id, expiresAt: Date.now() + 100000 } : { id: null, expiresAt: null }));
  const renderTracking = () => tracking.render(tracking.exports.AppleCashTracking, component(initial, "AppleCashTracking")[0].props);
  renderTracking(); tracking.flush(); await settle();
  assert.ok(byText(renderTracking(), "Rotate Shortcut token"));
  await byText(renderDevices(), "Unlink").props.onClick();
  const after = render();
  const beforeCards = component(initial, "AppleCashTracking"), afterCards = component(after, "AppleCashTracking");
  assert.notEqual(afterCards[0].props.key, beforeCards[0].props.key);
  assert.equal(afterCards[1].props.key, beforeCards[1].props.key);
  assert.doesNotMatch(text(renderDevices()), /Apple Cash Shortcut/);
  const remounted = harness();
  remounted.fetch = tracking.fetch;
  const fresh = () => remounted.render(remounted.exports.AppleCashTracking, afterCards[0].props);
  assert.ok(byText(fresh(), "Generate Shortcut token"));
  remounted.flush(); await settle();
  assert.ok(byText(fresh(), "Generate Shortcut token"));
  assert.doesNotMatch(text(fresh()), /Token expires|Shortcut token.*Copy token|Connected!/);
  component(after, "Devices")[0].props.onUnlink(browser);
  assert.equal(component(render(), "AppleCashTracking")[0].props.key, afterCards[0].props.key);
});

test("W4.2: a 12-line bubble scrolls above the fully grown bear at 390x844", async () => {
  const h = harness("Child.jsx");
  h.window.matchMedia = () => ({ matches: true });
  const reply = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}: try a small saving step.`).join("\n");
  const render = () => h.render(h.exports.SpeechBubble, { text: reply });
  render(); h.flush();
  assert.equal(nodes(render(), (n) => n.props.className === "bear-bubble-text")[0].props.children[0], reply);
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  const rule = (selector) => css.split(`${selector} {`)[1].split("}")[0];
  const px = (body, name) => Number(body.match(new RegExp(`(?:^|;)\\s*${name}: ([\\d.]+)px`))[1]);
  const bubble = rule(".bear-bubble"), inner = rule(".bear-bubble-text");
  const height = px(inner, "max-height");
  assert.ok(height < 12 * 14 * 1.45, "long text must scroll rather than increase the outer height");
  assert.match(inner, /overflow-y: auto/);
  // Include padding, border and the tail. Test the largest bear and highest
  // celebration hop, reserving space before even the top of its head.
  const bubbleBottom = px(bubble, "top") + height + 2 * 15 + 2 * 2 + 12;
  const sceneHeight = px(rule(".scene:has(.bear-bubble)"), "min-height");
  const sceneWidth = 390 - 2 * 16 - 2 * 2.5;
  const bearTop = sceneHeight - 2 * 2.5 - sceneWidth * 0.04 - 196 * 379 / 362 * 1.08 - 14 * 1.08;
  assert.ok(bubbleBottom < bearTop, `bubble bottom ${bubbleBottom} must clear bear top ${bearTop}`);
});

test("W4.3: a consumed kid code and countdown disappear, leaving Linked ✓ for only that child", async () => {
  const h = harness(), props = childProps();
  let linked = false;
  h.fetch = async (url, options) => new Response(JSON.stringify(options.method === "POST" ? { code: url.includes("/one/") ? "BC3467" : "XY3467", expiresAt: h.now + 900000 } : { status: linked && url.includes("/one/") ? "linked" : "pending" }));
  const render = () => h.render(h.exports.Children, props);
  render(); h.flush();
  await byText(render(), "Generate kid code").props.onClick();
  render(); h.flush(); await settle();
  await nodes(render(), (n) => n.type === "button" && text(n) === "Generate kid code")[1].props.onClick();
  render(); h.flush(); await settle();
  assert.equal(nodes(render(), (n) => n.props.className === "kid-code").length, 2);
  linked = true;
  h.timers.at(-1)(); await settle();
  const tree = render(); h.flush();
  const cards = nodes(tree, (n) => n.type === "section");
  assert.match(text(cards[0]), /Linked ✓/);
  assert.doesNotMatch(text(cards[0]), /Expires in|Copy code/);
  assert.equal(nodes(cards[0], (n) => n.props.className === "kid-code").length, 0);
  assert.equal(nodes(cards[1], (n) => n.props.className === "kid-code")[0].props.value, "XY3467");
  assert.match(text(cards[1]), /Expires in/);
});

test("W4.3: failed status reads preserve a code; stale replies cannot consume its replacement", async () => {
  const h = harness(), props = childProps();
  let code = "BC3467", finish;
  h.fetch = async (url, options) => {
    if (options.method === "POST") return new Response(JSON.stringify({ code, expiresAt: h.now + 900000 }));
    throw new Error("Offline");
  };
  const render = () => h.render(h.exports.Children, props);
  render(); h.flush();
  await byText(render(), "Generate kid code").props.onClick();
  render(); h.flush(); await settle();
  assert.match(text(render()), /Expires in/);
  assert.doesNotMatch(text(render()), /Linked ✓/);
  h.fetch = (url, options) => options.method === "POST" ? Promise.resolve(new Response(JSON.stringify({ code, expiresAt: h.now + 900000 }))) : new Promise((resolve) => { finish = resolve; });
  h.timers.at(-1)(); await settle();
  const old = finish;
  code = "XY3467";
  await byText(render(), "Generate kid code").props.onClick();
  render(); h.flush();
  const newest = finish;
  old(new Response('{"status":"linked"}')); await settle();
  assert.doesNotMatch(text(render()), /Linked ✓/);
  newest(new Response('{"status":"pending"}')); await settle();
  assert.equal(nodes(render(), (n) => n.props.className === "kid-code")[0].props.value, code);
});

test("W4.4: Buddy switch label follows server state through off and on", async () => {
  const h = harness(), state = parentView(seed(Date.now())), calls = [];
  const props = { state, run: async (path, body) => calls.push([path, body]) };
  const render = () => h.render(h.exports.Settings, props);
  for (const enabled of [true, false, true]) {
    state.settings.buddyEnabled = enabled;
    const tree = render(), label = nodes(tree, (n) => n.type === "label" && text(n).includes("Money Buddy"))[0];
    assert.equal(text(label).replace(/\s+/g, " ").trim(), `Money Buddy is ${enabled ? "on" : "off"}`);
    const input = nodes(label, (n) => n.type === "input")[0];
    assert.equal(input.props.checked, enabled);
    await input.props.onChange();
    assert.equal(calls.at(-1)[0], "parent/settings");
    assert.equal(calls.at(-1)[1].buddyEnabled, !enabled);
  }
});

test("W4.5: disabled lesson goals explain the remaining limit under the count field", () => {
  const h = harness(), state = parentView(seed(Date.now()));
  state.child.lessonsDone = state.catalog.lessons.slice(0, -2).map((lesson) => lesson.id);
  const render = () => h.render(h.exports.Goals, { state });
  field(render(), "How many").props.onChange({ target: { value: "3" } });
  let tree = render();
  assert.equal(byText(tree, "Create goal").props.disabled, true);
  const input = field(tree, "How many");
  const error = nodes(tree, (n) => n.props.id === input.props["aria-describedby"])[0];
  assert.equal(text(error), "Only 2 lessons remaining. Choose 2 or fewer.");
  const label = nodes(tree, (n) => n.type === "label" && text(n).startsWith("How many"))[0];
  assert.ok(label.props.children.indexOf(error) > label.props.children.indexOf(input));
  input.props.onChange({ target: { value: "2" } });
  assert.equal(byText(render(), "Create goal").props.disabled, false);
  state.child.lessonsDone.push(state.catalog.lessons.at(-2).id);
  tree = render();
  assert.match(text(tree), /Only 1 lesson remaining. Choose 1 or fewer./);
  state.child.lessonsDone.push(state.catalog.lessons.at(-1).id);
  tree = render();
  assert.match(text(tree), /All money lessons are complete. Choose tasks or times saved instead./);
  assert.equal(byText(tree, "Create goal").props.disabled, true);
  field(tree, "Counts").props.onChange({ target: { value: "tasks" } });
  assert.equal(byText(render(), "Create goal").props.disabled, false);
  assert.doesNotMatch(text(render()), /Only .* remaining. Choose|All money lessons are complete/);
});

test("W4.6: Apple Cash uses a decimal keyboard and Add money notes have the API's 120-character cap", () => {
  const h = harness(), state = parentView(seed(Date.now()));
  const wallet = h.render(h.exports.WalletLedger, { state });
  assert.equal(field(wallet, "Amount sent ($)").props.inputMode, "decimal");
  const allowance = harness();
  const tree = allowance.render(allowance.exports.Allowance, { state });
  assert.equal(field(tree, "Note (optional)").props.maxLength, 120);
  assert.equal(field(tree, "Note (optional)").type, "input");
});
