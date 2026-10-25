import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "../server/store.js";
import { COSMETICS } from "../server/catalog.js";

const manifest = JSON.parse(await readFile(new URL("public/bear/items/manifest.json", import.meta.url), "utf8"));
const sources = Object.fromEntries(await Promise.all(["Bear.jsx", "Child.jsx", "Icons.jsx", "api.js"].map(async (name) => {
  const extra = { "Bear.jsx": "POSES, POSE_ITEMS, placeItem, Layer", "Child.jsx": "DressSheet, moodFor" }[name];
  const result = await build({
    stdin: { contents: await readFile(new URL(`src/${name}`, import.meta.url), "utf8") + (extra ? `\nexport { ${extra} };` : ""), resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
    bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "true" },
  });
  return [name, result.outputFiles[0].text];
})));
function harness(name) {
  let cursor = 0;
  const slots = [], messages = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect() {}, useMemo(fn) { return fn(); },
  };
  const module = { exports: {} };
  const env = { messages, fetch: async () => new Response("{}") };
  vm.runInNewContext(sources[name], {
    module, exports: module.exports, require: () => hooks,
    h: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }), Fragment: "fragment",
    window: new EventTarget(), localStorage: { setItem() {}, getItem() { return null; } },
    navigator: { serviceWorker: { ready: Promise.resolve({ active: { postMessage(message) { messages.push(message); } } }) } },
    fetch: (...args) => env.fetch(...args), Event, console, URL, Date,
  });
  return Object.assign(env, { exports: module.exports, render(fn, props) { cursor = 0; return fn(props); } });
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...(tree.props?.children || []).flatMap((child) => nodes(child, predicate))];
}
function expand(tree) {
  if (!tree || typeof tree !== "object") return tree;
  if (typeof tree.type === "function") return expand(tree.type(tree.props));
  return { ...tree, props: { ...tree.props, children: tree.props.children.map(expand) } };
}
const text = (tree) => typeof tree === "string" || typeof tree === "number" ? String(tree) : (tree?.props?.children || []).map(text).join(" ");
const normalized = (tree) => text(tree).replace(/\s+/g, " ").trim();
const button = (tree, label) => nodes(tree, (n) => n.type === "button" && normalized(n) === label)[0];
const base = (tree) => nodes(tree, (n) => n.props.className === "bear-base")[0];
const layers = (tree) => nodes(tree, (n) => n.type === "img" && n.props.className?.startsWith("bear-item"));
const fixture = () => { const state = seed(Date.now()); state.catalog = { cosmetics: COSMETICS.map((c) => ({ ...c, unlocked: state.child.ownedCosmetics.includes(c.id) })) }; return state; };

test("H8.1 every item renders on the shared canvas at its slot z without rotation or flip", async () => {
  const h = harness("Bear.jsx"), { ITEMS, BearFigure, POSES, Layer } = h.exports;
  assert.equal(POSES.front.w, 428); assert.equal(POSES.front.h, 414);
  assert.deepEqual(Object.keys(ITEMS).sort(), Object.keys(manifest.items).sort());
  const z = { outfit: 1, bag: 2, neck: 3, eyes: 4, hat: 5, held: 0, friend: 7 };
  for (const [id, item] of Object.entries(ITEMS)) {
    const asset = manifest.items[id];
    assert.equal(item.slot, asset.slot);
    assert.equal(!!item.fullBody, asset.fullBody);
    assert.equal(item.z, z[asset.slot]);
    const image = Layer({ id, item });
    assert.deepEqual(JSON.parse(JSON.stringify(image.props.style)), { left: "50%", top: "50%", width: "100%", zIndex: z[asset.slot], transform: "translate(-50%, -50%) rotate(0deg) scaleX(1)" });
    assert.equal(!!item.float, asset.slot === "friend");
    const tree = expand(BearFigure({ bear: { name: "Pecan", [asset.slot]: id } }));
    assert.equal(tree.props.style.aspectRatio, "428 / 414");
    assert.match(tree.props["aria-label"], /^Pecan the bear/);
    assert.equal(nodes(tree, (n) => n.type === "img" && n.props.src === `/bear/items/${id}.png`).length, 1);
    const bytes = await readFile(new URL(`public/bear/items/${id}.png`, import.meta.url));
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20), bytes[25]], [428, 414, 6]);
    const thumb = await readFile(new URL(`public/bear/thumbs/${id}.png`, import.meta.url));
    assert.deepEqual([thumb.readUInt32BE(16), thumb.readUInt32BE(20)], [160, 160]);
  }
  const bytes = await readFile(new URL("public/bear/poses/bear_front.png", import.meta.url));
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [428, 414]);
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.bear-item \{[^}]*height: 100%/);
  assert.match(css, /\.bear-base \{[^}]*z-index: 0/);
});

test("H8.1 full-body props replace the base once and clothes return when put down", () => {
  const { BearFigure } = harness("Bear.jsx").exports;
  const bear = { name: "Bo", hat: "beanie", eyes: "sunglasses", neck: "red_scarf", outfit: "overalls", bag: "camera", friend: "bee_friend" };
  for (const held of ["map", "magnifying_glass", "leaf", "mug"]) {
    const worn = { ...bear, held }, before = JSON.stringify(worn);
    const tree = expand(BearFigure({ bear: worn }));
    assert.equal(base(tree).props.src, `/bear/items/${held}.png`);
    assert.deepEqual(layers(tree).map((n) => n.props.src).sort(), ["beanie", "sunglasses", "bee_friend"].map((id) => `/bear/items/${id}.png`).sort());
    assert.equal(JSON.stringify(worn), before);
  }
  const tree = expand(BearFigure({ bear: { ...bear, held: null } }));
  assert.equal(base(tree).props.src, "/bear/poses/bear_front.png");
  assert.equal(layers(tree).length, 6);
});

test("H8.1 non-front and thinking poses hide every item including full-body props and mood additions", () => {
  const { BearFigure, ITEMS, POSE_ITEMS } = harness("Bear.jsx").exports;
  assert.equal(Object.keys(POSE_ITEMS).length, 0);
  for (const pose of ["side", "back", "threeQuarter"]) {
    for (const [id, item] of Object.entries(ITEMS)) {
      const tree = expand(BearFigure({ bear: { name: "Bo", [item.slot]: id }, pose, mood: "happy" }));
      assert.equal(layers(tree).length, 0);
      assert.match(base(tree).props.src, /^\/bear\/poses\//);
    }
  }
  const tree = expand(BearFigure({ bear: { name: "Bo", held: "map", hat: "beanie" }, mood: "thinking" }));
  assert.equal(layers(tree).length, 0);
  assert.equal(base(tree).props.src, "/bear/poses/bear_three_quarter.png");
});

test("H8.1 moods add map, sleep cap and mug only to empty slots without changing state", () => {
  const { BearFigure } = harness("Bear.jsx").exports;
  for (const [mood, slot, id] of [["happy", "held", "map"], ["resting", "hat", "sleep_cap"], ["eating", "held", "mug"]]) {
    const bear = { name: "Bo" };
    const tree = expand(BearFigure({ bear, mood }));
    assert.ok(nodes(tree, (n) => n.props.src === `/bear/items/${id}.png`).length);
    assert.deepEqual(bear, { name: "Bo" });
    const chosen = slot === "hat" ? "straw_hat" : "leaf";
    const occupied = expand(BearFigure({ bear: { ...bear, [slot]: chosen }, mood }));
    assert.ok(nodes(occupied, (n) => n.props.src === `/bear/items/${chosen}.png`).length);
    assert.equal(nodes(occupied, (n) => n.props.src === `/bear/items/${id}.png`).length, 0);
  }
  const { moodFor } = harness("Child.jsx").exports;
  const now = new Date(2026, 9, 25, 12).getTime();
  const state = { notifications: [], transactions: [], plan: null };
  assert.equal(moodFor({ ...state, plan: { updatedAt: now } }, now), "happy");
  assert.equal(moodFor({ ...state, transactions: [{ to: "merchant", status: "posted", ts: now }] }, now), "eating");
  assert.equal(moodFor(state, new Date(2026, 9, 25, 22).getTime()), "resting");
});

test("H8.4 closet has eight tabs, every thumbnail, a live preview and named two-paw hints", () => {
  const h = harness("Child.jsx"), state = fixture(), calls = [];
  state.child.bear.name = "Pecan";
  const render = () => h.render(h.exports.DressSheet, { state, run: (...args) => calls.push(args) });
  const tabs = nodes(render(), (n) => n.props.role === "tab");
  assert.deepEqual(tabs.map(normalized), ["Hats", "Glasses", "Neckwear", "Outfits", "Bags", "Things to hold", "Little friends", "Home scene"]);
  const preview = nodes(render(), (n) => n.type?.name === "BearFigure")[0];
  assert.equal(preview.props.bear, state.child.bear);
  for (const [i, slot] of ["hat", "eyes", "neck", "outfit", "bag", "held", "friend", "background"].entries()) {
    tabs[i].props.onClick();
    const images = nodes(render(), (n) => n.type === "img" && n.props.className === "swatch-art");
    assert.deepEqual(images.map((n) => n.props.src), COSMETICS.filter((c) => c.kind === slot && slot !== "background").map((c) => `/bear/thumbs/${c.value}.png`));
  }
  for (const held of ["map", "magnifying_glass", "leaf", "mug"]) {
    state.child.bear.held = held;
    assert.match(normalized(render()), /Pecan holds this with both paws — outfits come back when you put it down/);
  }
  state.child.bear.held = null;
  assert.doesNotMatch(normalized(render()), /both paws/);
});

test("H8.4 bag buy confirmation preserves cancel, shortage, failure retry and owned equip", async () => {
  const h = harness("Child.jsx"), state = fixture(), calls = [];
  let succeeds = false;
  const render = (busy = false) => h.render(h.exports.DressSheet, { state, busy, run: async (...args) => { calls.push(args); return succeeds ? {} : null; } });
  button(render(), "Bags").props.onClick();
  const camera = () => nodes(render(), (n) => n.type === "button" && normalized(n).startsWith("Camera"))[0];
  camera().props.onClick();
  assert.equal(calls.length, 0);
  assert.match(normalized(render()), /Spend 60 points on the Camera \? You have 40/);
  assert.equal(button(render(), "Earn 20 more points").props.disabled, true);
  button(render(), "Not now").props.onClick();
  assert.doesNotMatch(normalized(render()), /Spend 60 points/);
  state.child.points = 100;
  camera().props.onClick();
  assert.equal(button(render(true), "Buy").props.disabled, true);
  await button(render(), "Buy").props.onClick();
  assert.match(normalized(render()), /Spend 60 points/);
  succeeds = true;
  await button(render(), "Buy").props.onClick();
  assert.equal(calls.at(-1)[0], "child/cosmetic/buy");
  assert.equal(calls.at(-1)[1].id, "bag:camera");
  assert.doesNotMatch(normalized(render()), /Spend 60 points/);
  state.catalog.cosmetics.find((c) => c.id === "bag:camera").unlocked = true;
  await camera().props.onClick();
  assert.equal(calls.at(-1)[0], "child/cosmetic/equip");
  assert.equal(calls.at(-1)[1].kind, "bag");
});

test("H8.5 remaining illustrated icons exist and production warming includes layers and thumbnails with a fresh cache", async () => {
  const h = harness("Icons.jsx");
  for (const name of h.exports.ICON_NAMES) {
    const tree = h.exports.Icon({ name });
    for (const img of nodes(tree, (n) => n.type === "img")) await access(new URL(`public${img.props.src}`, import.meta.url));
  }
  const api = harness("api.js"), state = fixture();
  state.catalog.places = {};
  api.fetch = async () => new Response(JSON.stringify(state));
  await api.exports.api("state");
  assert.equal(api.messages.length, 1);
  const images = api.messages[0].images;
  assert.ok(!images.includes("/bear/items/mushroom.png"));
  for (const id of Object.keys(manifest.items)) {
    assert.ok(images.includes(`/bear/items/${id}.png`));
    assert.ok(images.includes(`/bear/thumbs/${id}.png`));
  }
  for (const src of images) await access(new URL(`public${src}`, import.meta.url));
  assert.match(await readFile(new URL("public/sw.js", import.meta.url), "utf8"), /const VERSION = "mq-v6"/);
});
