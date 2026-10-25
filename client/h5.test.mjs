// Socket-free H5 checks. Device/visual checks remain in CHECKLIST.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { seed } from "../server/store.js";
import * as catalog from "../server/catalog.js";

const sources = Object.fromEntries(await Promise.all(["Child.jsx", "MapView.jsx"].map(async (name) => {
  const extra = name === "Child.jsx" ? "\nexport { MapScreen };" : "";
  const result = await build({
    stdin: { contents: await readFile(new URL(`src/${name}`, import.meta.url), "utf8") + extra, resolveDir: new URL("src/", import.meta.url).pathname, loader: "jsx" },
    bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" },
  });
  return [name, result.outputFiles[0].text];
})));
const mapModule = { exports: {} };
vm.runInNewContext(sources["MapView.jsx"], { module: mapModule, exports: mapModule.exports, h: React.createElement, Fragment: React.Fragment });
const { default: MapView, mysteryRoute, trailD, placeXY } = mapModule.exports;
const homeXY = [40 + (catalog.HOME.lon + 125) * 15.2, 30 + (49.5 - catalog.HOME.lat) * 19];
const route = mysteryRoute(homeXY);
const noop = () => {};
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} ≈ ${b}`);
const nearXY = (a, b) => { near(a[0], b[0]); near(a[1], b[1]); };
function fixture() {
  const db = seed(100000);
  return { ...db, balances: { savings: 2000, spending: 1000 }, goals: db.savingsGoals, chat: [], integrations: {},
    catalog: { places: Object.fromEntries(Object.entries(catalog.PLACES).map(([id, p]) => [id, { ...p, open: true, image: `/postcards/${id}.png` }])), home: catalog.HOME } };
}
function mapProps(extra = {}) {
  const state = fixture();
  return { places: state.catalog.places, home: catalog.HOME, owned: new Set(Object.keys(catalog.PLACES)), bear: { name: "Fern" }, onSelect: noop, ...extra };
}
const markup = (props) => renderToStaticMarkup(React.createElement(MapView, props));
const walkerXY = (html) => {
  const match = html.match(/class="walker [^"]*" transform="translate\(([^ ]+) ([^)]+)\)"/);
  return match ? [Number(match[1]), Number(match[2]) - 6] : null;
};
const away = { id: "trip-1", status: "away", startedAt: 1000, returnsAt: 101000 };
const returned = (id = "trip-1", destId = "seattle", ts = 101000) => ({ id, destId, status: "returned", startedAt: ts - 100000, returnsAt: ts, returnedAt: ts });

function harness({ storage = new Map(), reducedMotion = false, hidden = false } = {}) {
  let cursor = 0, dirty = false, nextTimer = 0;
  const slots = [], effects = [], timers = new Map();
  const window = new EventTarget(), document = new EventTarget(), media = new EventTarget();
  window.scrollTo = noop; window.matchMedia = () => media;
  media.matches = reducedMotion;
  document.visibilityState = hidden ? "hidden" : "visible";
  document.querySelector = () => null;
  const env = { now: 51000, storage, timers, window, document, media, delays: [] };
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (value) => { const next = typeof value === "function" ? value(slots[i]) : value; if (!Object.is(slots[i], next)) dirty = true; slots[i] = next; }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  hooks.useCallback = (fn, deps) => hooks.useMemo(() => fn, deps);
  const module = { exports: {} };
  vm.runInNewContext(sources["Child.jsx"], {
    module, exports: module.exports, require: () => hooks,
    h: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }), Fragment: "fragment",
    window, document, localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    Date: class extends Date { static now() { return env.now; } },
    setInterval: (fn, ms) => { env.delays.push(ms); timers.set(++nextTimer, fn); return nextTimer; }, clearInterval: (id) => timers.delete(id),
    setTimeout: noop, clearTimeout: noop, fetch: async () => new Response("{}"), console,
  });
  env.exports = module.exports;
  env.render = (fn, props) => {
    for (let i = 0; i < 10; i++) {
      dirty = false; cursor = 0;
      const tree = fn(props);
      while (effects.length) effects.shift()();
      if (!dirty) return tree;
    }
    throw new Error("Render did not settle");
  };
  env.advance = (ms) => { env.now += ms; for (const fn of [...timers.values()]) fn(); };
  env.hide = (value) => { document.visibilityState = value ? "hidden" : "visible"; document.dispatchEvent(new Event("visibilitychange")); };
  env.unmount = () => { for (const slot of slots) slot?.cleanup?.(); };
  return env;
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...(tree.props?.children || []).flatMap((c) => nodes(c, predicate))];
}
const component = (tree, name) => nodes(tree, (n) => n.type?.name === name)[0];
const text = (tree) => typeof tree === "string" || typeof tree === "number" ? String(tree) : (tree?.props?.children || []).map(text).join(" ");
function screen(h, state, extra = {}) {
  return () => h.render(h.exports.MapScreen, { state, open: noop, ...extra });
}
const map = (render) => component(render(), "MapView").props;

test("H5.1 mystery loop closes smoothly and stays 40px from every destination pin", () => {
  nearXY(route.at(0).xy, homeXY); nearXY(route.at(1).xy, homeXY);
  assert.match(route.d, / Z$/);
  for (const [id, place] of Object.entries(catalog.PLACES)) {
    const pin = placeXY(id, place);
    let minimum = Infinity;
    for (let i = 0; i <= 10000; i++) {
      const point = route.at(i / 10000).xy;
      minimum = Math.min(minimum, Math.hypot(point[0] - pin[0], point[1] - pin[1]));
      assert.ok(point[0] >= 30 && point[0] <= 930 && point[1] >= 90 && point[1] <= 594);
    }
    assert.ok(minimum >= 40, `${id}: ${minimum}px clearance`);
  }
  for (let i = 1; i < 5; i++) {
    assert.ok(Math.hypot(...route.at(i / 5 - 0.000001).xy.map((v, axis) => v - route.at(i / 5).xy[axis])) < 0.01);
  }
});

test("H5.1/3 away walker follows real time, survives reload and never reads or renders a destination", () => {
  const guarded = { ...away, get destId() { throw new Error("Away destination read"); } };
  for (const progress of [0, 0.1, 0.25, 0.5, 0.8, 1]) {
    const props = mapProps({ away: guarded, now: 1000 + progress * 100000 });
    const html = markup(props);
    nearXY(walkerXY(html), route.at(progress).xy);
    assert.equal(markup(props), html, "reload at the same real time is deterministic");
    assert.match(html, /mystery-cloud/); assert.match(html, /Mystery route/);
    assert.match(html, /Fern is out exploring/);
    if (progress > 0) assert.match(html, /walker-sparkles.*<path/);
    // Pins stay fully labelled while away; only the destination must be indistinguishable.
    for (const [id, place] of Object.entries(catalog.PLACES)) if (!place.hidden) assert.ok(html.includes(place.name), place.name);
    assert.doesNotMatch(html, /Mystery place/);
    assert.doesNotMatch(html, /latest-trail|target|New postcard!/);
    if (route.at(progress).facingRight) assert.match(html, /scale\(-1 1\)/);
    else assert.doesNotMatch(html, /scale\(-1 1\)/);
  }
  const html = markup(mapProps({ away, now: 51000 }));
  for (const destId of Object.keys(catalog.PLACES)) assert.equal(markup(mapProps({ away: { ...away, destId }, now: 51000 })), html);
  nearXY(walkerXY(markup(mapProps({ away, now: -1000 }))), homeXY);
  nearXY(walkerXY(markup(mapProps({ away, now: 200000 }))), homeXY);
  assert.doesNotMatch(markup(mapProps()), /class="walker |class="trail /);
});

test("H5.2 local and server reveal receipts gate the real trail; Home passes the same seen receipt", () => {
  const state = fixture(), h = harness();
  state.adventures = [returned()];
  assert.equal(map(screen(h, state)).latest, undefined);
  const older = returned("older", "chicago", 1000); older.revealedAt = 2000;
  state.adventures.push(older);
  assert.equal(map(screen(h, state)).latest, undefined, "an older seen trip cannot replace the latest unseen trip");
  state.adventures.pop();
  const seen = ["trip-1"];
  const local = harness(), localMap = map(screen(local, state, { seen }));
  assert.equal(localMap.latest.id, "trip-1"); assert.equal(localMap.returnProgress, 0);
  const remote = harness(); state.adventures[0].revealedAt = 102000;
  assert.equal(map(screen(remote, state)).returnProgress, 0);
  delete state.adventures[0].revealedAt;
  const child = harness(); child.storage.set("mq_tab", "map");
  const render = () => child.render(child.exports.default, { state, toast: noop });
  const before = render();
  assert.equal(component(before, "MapScreen").props.seen.length, 0);
  component(before, "ReturnReveal").props.onSeen();
  assert.ok(component(render(), "MapScreen").props.seen.includes("trip-1"));
  assert.equal(component(render(), "ReturnReveal"), undefined);
});

test("H5.2 real trail walks home for 2.5s, pulses the revealed pin, then keeps only the faint latest trail", () => {
  const h = harness(), state = fixture(); state.adventures = [returned()];
  state.postcards.push({ id: "new-card", defId: "seattle", source: "trip" });
  const render = screen(h, state, { seen: ["trip-1"] });
  let props = map(render), html = markup(props);
  assert.match(html, /class="trail latest-trail"/);
  nearXY(walkerXY(html), placeXY("seattle", catalog.PLACES.seattle));
  assert.match(html, /homeward/); assert.doesNotMatch(html, /mystery-cloud|New postcard!/);
  const trail = trailD(homeXY, placeXY("seattle", catalog.PLACES.seattle));
  h.advance(1250); props = map(render);
  near(props.returnProgress, 0.5); nearXY(walkerXY(markup(props)), trail.at(0.5).xy);
  // Seattle is west of Home, so the homeward walker must face east.
  assert.match(markup(props), /scale\(-1 1\)/);
  h.advance(1250); html = markup(map(render));
  nearXY(walkerXY(html), homeXY); assert.match(html, /latest-trail faint/); assert.match(html, /New postcard!/); assert.match(html, /pin visited[^\"]*target/);
  h.advance(250); assert.equal(walkerXY(markup(map(render))), null);
  h.advance(2500); assert.doesNotMatch(markup(map(render)), /New postcard!|target/);
  h.unmount(); assert.equal(h.timers.size, 0);
  const reopened = harness({ storage: h.storage });
  html = markup(map(screen(reopened, state, { seen: ["trip-1"] })));
  assert.match(html, /latest-trail faint/); assert.equal(walkerXY(html), null);
  const newer = returned("trip-2", "chicago", 201000); newer.revealedAt = 202000;
  state.adventures = [state.adventures[0], newer]; // deliberately oldest first
  props = map(screen(reopened, state, { seen: ["trip-1"] }));
  assert.equal(props.latest.id, "trip-2"); assert.equal(props.returnProgress, 0);
  assert.equal((markup(props).match(/class="trail /g) || []).length, 1);
  const otherKid = { ...state, child: { ...state.child, id: "sibling" } };
  assert.equal(map(screen(harness({ storage: h.storage }), otherKid)).returnProgress, 0);
});

test("H5.2 leaving during playback consumes it; new trips defer the last trail until home", () => {
  const h = harness(), state = fixture(); state.adventures = [returned()];
  const render = screen(h, state, { seen: ["trip-1"] });
  assert.equal(map(render).returnProgress, 0); h.advance(500); map(render); h.unmount();
  assert.equal(map(screen(harness({ storage: h.storage }), state, { seen: ["trip-1"] })).returnProgress, null);
  const next = returned("trip-2", "chicago", 201000); next.revealedAt = 202000;
  state.adventures = [next, { ...away, id: "trip-3" }];
  const active = harness(), activeRender = screen(active, state);
  assert.match(markup(map(activeRender)), /mystery-trail/);
  assert.doesNotMatch(markup(map(activeRender)), /latest-trail|New postcard!/);
  assert.equal(active.storage.size, 0, "away does not consume a homeward playback");
  state.adventures.pop(); assert.equal(map(activeRender).returnProgress, 0);
});

test("H5.1/5 reduced motion uses fixed waypoints, disables tween/bounce/march and auto-scroll easing", async () => {
  const props = mapProps({ away, reducedMotion: true });
  nearXY(walkerXY(markup({ ...props, now: 51000 })), walkerXY(markup({ ...props, now: 52000 })));
  nearXY(walkerXY(markup({ ...props, now: 51000 })), route.at(0.5).xy);
  assert.match(markup(props), /stepped/);
  const a = markup(mapProps({ latest: returned(), returnProgress: 0.26, reducedMotion: true }));
  const b = markup(mapProps({ latest: returned(), returnProgress: 0.49, reducedMotion: true }));
  nearXY(walkerXY(a), walkerXY(b));
  const h = harness({ reducedMotion: true }), state = fixture(); state.adventures = [away];
  const render = screen(h, state); let tree = render(), behavior;
  const frame = nodes(tree, (n) => n.props.className === "map-frame")[0];
  frame.props.ref.current = { scrollWidth: 1000, clientWidth: 400, scrollLeft: 0, getBoundingClientRect: () => ({ left: 0, width: 400 }), querySelector: () => ({ getBoundingClientRect: () => ({ left: 600, width: 40 }) }), scrollTo: (opts) => { behavior = opts.behavior; } };
  h.advance(250); tree = render(); assert.equal(behavior, "auto");
  assert.equal(component(tree, "MapView").props.reducedMotion, true);
  h.media.matches = false; h.media.dispatchEvent(new Event("change"));
  assert.equal(map(render).reducedMotion, false);
  const css = await readFile(new URL("src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.walker\.stepped\s*\{\s*transition: none/);
  assert.match(css, /prefers-reduced-motion: reduce[^}]*\{[^}]*animation: none !important; transition: none !important/s);
});

test("H5.5 a single 250ms clock pauses hidden, resumes real away progress and preserves homeward time", () => {
  const h = harness(), state = fixture(); state.adventures = [returned()];
  const render = screen(h, state, { seen: ["trip-1"] }); map(render);
  assert.equal(h.timers.size, 1); assert.equal(h.delays[0], 250);
  h.advance(1000); near(map(render).returnProgress, 0.4);
  h.hide(true); assert.equal(h.timers.size, 0);
  assert.ok(nodes(render(), (n) => n.props.className?.includes("map-paused")).length);
  h.advance(10000); near(map(render).returnProgress, 0.4);
  h.hide(false); near(map(render).returnProgress, 0.4); assert.equal(h.timers.size, 1);
  h.advance(1500); assert.equal(map(render).returnProgress, 1);
  const paused = harness({ hidden: true }), awayState = fixture(); awayState.adventures = [away];
  const awayRender = screen(paused, awayState); nearXY(walkerXY(markup(map(awayRender))), route.at(0.5).xy);
  assert.equal(paused.timers.size, 0); paused.advance(20000); paused.hide(false);
  nearXY(walkerXY(markup(map(awayRender))), route.at(0.7).xy);
  paused.unmount(); assert.equal(paused.timers.size, 0);
  const pending = harness({ hidden: true });
  assert.equal(map(screen(pending, state, { seen: ["trip-1"] })).returnProgress, null);
  assert.equal(pending.storage.size, 0);
  pending.hide(false); assert.equal(map(screen(pending, state, { seen: ["trip-1"] })).returnProgress, 0);
});

test("H5.4 legend uses the current bear name and otherwise keeps the map read-only", () => {
  const state = fixture(), h = harness(); state.child.bear.name = "Fern"; state.adventures = [away];
  assert.match(text(screen(h, state)()).replace(/\s+/g, " "), /Fern is out exploring/);
  state.adventures = [returned()]; state.adventures[0].revealedAt = 102000;
  assert.match(text(screen(h, state)()), /Latest trip/);
  state.adventures = [];
  const props = map(screen(h, state)); assert.doesNotMatch(markup(props), /class="walker |class="trail /);
  assert.doesNotMatch(text(screen(h, state)()), /Latest trip|is out exploring/);
});
