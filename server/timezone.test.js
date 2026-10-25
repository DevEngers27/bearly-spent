import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { build } from "esbuild";
import { seed } from "./store.js";
import * as game from "./domain.js";
import * as catalog from "./catalog.js";
import { actions } from "./actions.js";
import { runGuardian, spendPolicy } from "./guardian.js";
import { dayKey, weekKey, serverTimezone } from "./time.js";

const LA = "America/Los_Angeles";
const fresh = (timezone) => {
  const db = seed(Date.now());
  if (timezone) actions.settings(db, { timezone });
  return db;
};
const budget = { save: 500, needs: 800, fun: 500, give: 200 };
// October 24 at 16:30 and 17:30 in Los Angeles straddle UTC midnight.
const afternoon = ["2026-10-24T16:30:00-07:00", "2026-10-24T17:30:00-07:00"].map(Date.parse);

import { childView } from "./index.js";

test("B5 settings accepts IANA zones and UTC and preserves the chosen family zone", () => {
  const db = fresh();
  actions.settings(db, { timezone: LA });
  assert.equal(db.settings.timezone, LA);
  actions.settings(db, { buddyEnabled: false });
  assert.equal(db.settings.timezone, LA);
  actions.settings(db, { timezone: "UTC" });
  assert.equal(db.settings.timezone, "UTC");
  actions.settings(db, { timezone: "US/Pacific" });
  assert.equal(db.settings.timezone, LA, "IANA aliases are canonicalized");
});

test("B5 invalid time zones return GameError 400 before changing any settings", () => {
  const db = fresh(LA);
  for (const timezone of [undefined, null, "", " ", 123, true, [], {}, "Mars/Olympus", "+01:00", "-08:00", "a".repeat(121)]) {
    const before = structuredClone(db);
    assert.throws(() => actions.settings(db, { buddyEnabled: false, timezone }), (e) => e instanceof game.GameError && e.status === 400);
    assert.deepEqual(db, before);
  }
});

test("B5 missing family time zone falls back to the server zone", () => {
  const db = fresh();
  for (const now of afternoon) {
    assert.equal(dayKey(now), dayKey(now, serverTimezone()));
    assert.equal(weekKey(now), weekKey(now, serverTimezone()));
    assert.equal(childView(db, now).dayKey, dayKey(now, serverTimezone()));
    assert.equal(childView(db, now).weekKey, weekKey(now, serverTimezone()));
  }
  game.childSave(db, 100, afternoon[0]);
  assert.equal(db.child.lastSaveDay, dayKey(afternoon[0], serverTimezone()));
});

for (const [timezone, bonuses] of [[LA, 1], ["UTC", 2]]) {
  test(`B5 saves across UTC midnight award ${bonuses} daily bonuses in ${timezone}`, () => {
    const db = fresh(timezone);
    const points = db.child.points;
    for (const now of afternoon) game.childSave(db, 100, now);
    assert.equal(db.child.points - points, bonuses * (catalog.POINTS.save + catalog.POINTS.track));
    assert.equal(db.child.stats.tracked, bonuses);
    assert.equal(db.child.stats.savingsActions, 2);
    assert.equal(db.child.lastSaveDay, dayKey(afternoon[1], timezone));
    assert.equal(db.child.lastTrackedDay, dayKey(afternoon[1], timezone));
  });
}

test("B5 journal and immediate or held spending share the family daily tracking gate", () => {
  for (const limit of [2000, 0]) {
    const db = fresh(LA);
    db.allowance.spendLimit = limit;
    assert.equal(game.journal(db, { direction: "received", amount: 100, note: "Gift" }, afternoon[0]).bonus, true);
    const result = game.childSpend(db, { amount: 100, memo: "Book" }, spendPolicy, afternoon[1]);
    assert.equal(result.held, limit === 0);
    assert.equal(db.child.stats.tracked, 1);
    assert.equal(game.journal(db, { direction: "saved", amount: 100, note: "Jar" }, Date.parse("2026-10-25T00:00:00-07:00")).bonus, true);
    assert.equal(db.child.stats.tracked, 2);
  }
});

test("B5 repeated DST hour earns one daily bonus and local midnight resets it", () => {
  const db = fresh(LA);
  const points = db.child.points;
  for (const time of ["2026-11-01T01:30:00-07:00", "2026-11-01T01:30:00-08:00", "2026-11-01T23:59:59-08:00", "2026-11-02T00:00:00-08:00"]) {
    game.childSave(db, 100, Date.parse(time));
  }
  assert.equal(db.child.points - points, 2 * (catalog.POINTS.save + catalog.POINTS.track));
  assert.equal(db.child.lastSaveDay, "2026-11-02");
});

test("B6 Sunday 23:30 and Monday 00:30 are different family budget weeks", () => {
  const db = fresh(LA);
  const sunday = Date.parse("2026-10-25T23:30:00-07:00");
  const monday = Date.parse("2026-10-26T00:30:00-07:00");
  assert.equal(weekKey(sunday, LA), "2026-W43");
  assert.equal(weekKey(monday, LA), "2026-W44");
  assert.equal(game.completeBudget(db, budget, sunday).pointsAwarded, catalog.POINTS.budget);
  assert.equal(game.completeBudget(db, budget, sunday + 1000).pointsAwarded, 0);
  assert.equal(childView(db, sunday).budgetDoneThisWeek, true);
  assert.equal(childView(db, monday).budgetDoneThisWeek, false);
  assert.equal(game.completeBudget(db, budget, monday).pointsAwarded, catalog.POINTS.budget);
  assert.equal(childView(db, monday).budgetDoneThisWeek, true);
});

test("B6 Friday and Saturday share one ISO budget week in the family zone", () => {
  const db = fresh(LA);
  assert.equal(game.completeBudget(db, budget, Date.parse("2026-10-23T12:00:00-07:00")).pointsAwarded, 50);
  assert.equal(game.completeBudget(db, budget, Date.parse("2026-10-24T12:00:00-07:00")).pointsAwarded, 0);
});

test("B6 ISO week years and DST follow Monday through Sunday", () => {
  for (const [time, expected] of [
    ["2021-01-01T12:00:00-08:00", "2020-W53"],
    ["2021-01-03T23:59:59-08:00", "2020-W53"],
    ["2021-01-04T00:00:00-08:00", "2021-W01"],
    ["2026-03-08T23:59:59-07:00", "2026-W10"],
    ["2026-03-09T00:00:00-07:00", "2026-W11"],
    ["2026-11-01T23:59:59-08:00", "2026-W44"],
    ["2026-11-02T00:00:00-08:00", "2026-W45"],
  ]) assert.equal(weekKey(Date.parse(time), LA), expected, time);
  assert.equal(dayKey(Date.parse("2026-10-24T12:30:00Z"), "Pacific/Kiritimati"), "2026-10-25");
});

test("B5 allowance at 01:00 UTC October 25 uses October 24 in Los Angeles", () => {
  const db = fresh(LA);
  const now = Date.parse("2026-10-25T01:00:00Z");
  db.allowance.nextRun = now;
  runGuardian(db, now);
  assert.equal(db.allowance.lastPeriod, "allowance:2026-10-24");
  assert.deepEqual(db.transactions.slice(-2).map((t) => t.idempotencyKey), ["allowance:2026-10-24:save", "allowance:2026-10-24:spend"]);
  assert.throws(() => game.requestAllowanceRun(db, now), /already paid/);
  delete db.allowance.lastPeriod;
  assert.throws(() => game.requestAllowanceRun(db, now), /already paid/, "ledger guard uses the same zone");
});

test("B5 allowance catch-up keys use each scheduled family date", () => {
  const db = fresh(LA);
  const now = Date.parse("2026-10-25T01:00:00Z");
  db.allowance.nextRun = now - 7 * 86400000;
  runGuardian(db, now);
  assert.deepEqual(db.transactions.slice(-4).map((t) => t.idempotencyKey), [
    "allowance:2026-10-17:save", "allowance:2026-10-17:spend", "allowance:2026-10-24:save", "allowance:2026-10-24:spend",
  ]);
});

test("B5 childView exposes the same family keys used by daily and weekly gates", () => {
  const db = fresh(LA);
  game.childSave(db, 100, afternoon[0]);
  game.completeBudget(db, budget, afternoon[0]);
  const view = childView(db, afternoon[1]);
  assert.equal(view.dayKey, "2026-10-24");
  assert.equal(view.dayKey, db.child.lastSaveDay);
  assert.equal(view.dayKey, db.child.lastTrackedDay);
  assert.equal(view.weekKey, db.child.lastBudgetWeek);
  assert.equal(view.budgetDoneThisWeek, true);
  assert.equal(childView(db, Date.parse("2026-10-25T00:00:00-07:00")).dayKey, "2026-10-25");
});

test("B5 Acadia display and adventure eligibility use the family month at both seasonal boundaries", () => {
  for (const [time, laOpen, utcOpen] of [
    ["2026-09-01T01:00:00Z", false, true],
    ["2026-12-01T01:00:00Z", true, false],
  ]) {
    for (const [timezone, open] of [[LA, laOpen], ["UTC", utcOpen]]) {
      const db = fresh(timezone);
      db.child.points = 1000;
      const now = Date.parse(time);
      assert.equal(childView(db, now).catalog.places.acadia_national_park.open, open);
      if (open) assert.doesNotThrow(() => game.startAdventure(db, "acadia_national_park", now));
      else assert.throws(() => game.startAdventure(db, "acadia_national_park", now), /Autumn only/);
    }
  }
});

// Compile the real components into memory, using a tiny hook/element harness.
// No browser, server, files under dist/, or real HTTP requests are needed.
const clientSources = Object.fromEntries(await Promise.all([
  ["Parent", "Settings"], ["Child", "Missions, nextUp"],
].map(async ([name, exports]) => {
  const url = new URL(`../client/src/${name}.jsx`, import.meta.url);
  const result = await build({
    stdin: { contents: `${readFileSync(url, "utf8")}\nexport { ${exports} };`, resolveDir: new URL("../client/src/", import.meta.url).pathname, loader: "jsx" },
    bundle: true, write: false, format: "cjs", external: ["react"], jsxFactory: "h", jsxFragment: "Fragment", define: { "import.meta.env.PROD": "false" },
  });
  return [name, result.outputFiles[0].text];
})));

function clientHarness(name) {
  const slots = [], effects = [], requests = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn) { effects.push(fn); },
  };
  const module = { exports: {} };
  vm.runInNewContext(clientSources[name], {
    module, exports: module.exports, require: () => hooks,
    h: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }), Fragment: "fragment",
    window: new EventTarget(), Event,
    // Deliberately differs from the server's supplied day and week.
    Date: class extends Date { static now() { return Date.parse("2030-01-01T12:00:00Z"); } },
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  return {
    exports: module.exports, requests,
    render(fn, props) { cursor = 0; return fn(props); },
    async flush() { while (effects.length) effects.shift()(); await new Promise((resolve) => setImmediate(resolve)); },
  };
}

function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...(tree.props?.children || []).flatMap((child) => nodes(child, predicate))];
}

test("B5 first parent visit saves the browser zone once and respects an existing family zone", async () => {
  const db = fresh();
  const state = { ...childView(db, afternoon[0]), family: db.family, approvals: db.approvals };
  const h = clientHarness("Parent");
  h.render(h.exports.default, { state, toast() {} });
  await h.flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "/api/parent/settings");
  assert.equal(h.requests[0].body.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  h.render(h.exports.default, { state, toast() {} });
  await h.flush();
  assert.equal(h.requests.length, 1, "rerenders do not repeat initialization");

  const existing = clientHarness("Parent");
  state.settings.timezone = "Asia/Tokyo";
  existing.render(existing.exports.default, { state, toast() {} });
  await existing.flush();
  assert.equal(existing.requests.length, 0, "another device's zone cannot replace the family zone");
});

test("B5 parent time zone picker defaults to the browser and sends the selected zone", () => {
  const db = fresh();
  const h = clientHarness("Parent");
  const requests = [];
  const render = () => h.exports.Settings({ state: { settings: db.settings, child: db.child, friends: [] }, busy: false, run: (path, body) => requests.push({ path, body }) });
  const picker = () => nodes(render(), (node) => node.type === "select")[0];
  assert.equal(picker().props.value, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const values = picker().props.children.map((node) => node.props.value);
  assert.ok(values.includes("UTC") && values.includes(LA));
  picker().props.onChange({ target: { value: LA } });
  assert.equal(requests[0].path, "parent/settings");
  assert.equal(requests[0].body.timezone, LA);
  actions.settings(db, requests[0].body);
  assert.equal(picker().props.value, LA);
});

test("B5/B6 child Today and This week progress use server keys despite a different device clock", () => {
  const db = fresh(LA);
  db.child.points = 0;
  game.childSave(db, 100, afternoon[0]);
  game.completeBudget(db, budget, afternoon[0]);
  const state = childView(db, afternoon[1]);
  const h = clientHarness("Child");
  const render = () => h.exports.Missions({ state, run() {}, open() {}, busy: false });
  const lists = () => nodes(render(), (node) => node.type === "ul" && node.props.className === "checklist");
  assert.ok(nodes(render(), (node) => node.type === "h2" && node.props.children.includes("Today")).length);
  assert.ok(nodes(render(), (node) => node.type === "h2" && node.props.children.includes("This week")).length);
  assert.equal(lists()[0].props.children.length, 2);
  assert.equal(lists()[1].props.children.length, 1);
  assert.equal(nodes(render(), (node) => node.type === "li" && node.props.className === "done").length, 3);
  assert.equal(h.exports.nextUp(state, afternoon[1]).some((item) => item.id === "save"), false);
  state.dayKey = "2026-10-25";
  state.weekKey = "2026-W44";
  assert.equal(nodes(render(), (node) => node.type === "li" && node.props.className === "done").length, 0);
  assert.equal(h.exports.nextUp(state, afternoon[1]).some((item) => item.id === "save"), true);
});
