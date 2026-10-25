import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { seed, readChild, mutateChild, _clearStoreForTest } from "./store.js";
import { database, _databaseForTest, closeDatabase } from "./db.js";
import * as game from "./domain.js";
import { LESSONS, MISSION_POOL, POINTS, TRIP } from "./catalog.js";
import { childView, parentView, dispatch } from "./index.js";
import { actions } from "./actions.js";
import { snapshot, cancelReplan } from "./buddy.js";
import { spendPolicy } from "./guardian.js";
import { _clearLimitsForTest, HOUR } from "./limits.js";

const now = Date.parse("2026-10-24T12:00:00-07:00");
const fresh = () => { const db = seed(now); db.settings.timezone = "America/Los_Angeles"; return db; };
function assign(db, keys, at = now) {
  game.ensureDailyMissions(db, at);
  db.child.dailyMissions.active = keys.map((key) => ({ key, assignedAt: at }));
}
beforeEach(() => { cancelReplan(); _clearStoreForTest(); _clearLimitsForTest(); _databaseForTest(); });
after(() => { cancelReplan(); _clearStoreForTest(); closeDatabase(); });

test("H2 roll: seed stays deterministic; first access assigns three with track/save first", () => {
  const db = fresh();
  assert.equal(Object.hasOwn(db.child, "dailyMissions"), false);
  const view = childView(db, now);
  assert.equal(view.missionsToday.active.length, 3);
  assert.ok(["track", "save"].includes(view.missionsToday.active[0].key));
  assert.equal(view.missionsToday.cap, 6);
  assert.deepEqual(view.missionsToday, childView(db, now + 1000).missionsToday);
  assert.deepEqual(parentView(db, undefined, now).missionsToday, view.missionsToday);
  for (const m of MISSION_POOL) assert.ok(m.pts >= 10 && m.pts <= 30 && m.hint);
  db.child.bear.name = "Pip";
  assign(db, ["dress", "trip"]);
  assert.ok(game.missionsToday(db, now).active.filter((m) => ["dress", "trip"].includes(m.key)).every((m) => m.title.includes("Pip")));
});

test("H2 completion: event and seen replace immediately and audit/notify exactly once", () => {
  const db = fresh();
  assign(db, ["journal", "map", "goal"]);
  const points = db.child.points;
  // Mark track already paid so this isolates the diary reward.
  db.child.lastTrackedDay = "2026-10-24";
  game.journal(db, { direction: "received", amount: 100, note: "Chores" }, now);
  assert.equal(db.child.points, points + 10);
  assert.equal(db.child.dailyMissions.active.length, 3);
  assert.ok(!db.child.dailyMissions.active.some((m) => m.key === "journal"));
  game.missionSeen(db, "map", now);
  assert.equal(db.child.points, points + 20);
  assert.equal(db.child.dailyMissions.active.length, 3);
  assert.equal(game.missionEvent(db, "map", now), false);
  assert.throws(() => game.missionSeen(db, "map", now), game.GameError);
  assert.equal(db.audit.filter((a) => a.action === "daily_mission_done").length, 2);
  assert.ok(db.audit.some((a) => a.detail === "Mission done: Write in your cash diary"));
  assert.equal(db.notifications.filter((n) => n.text === "Mission done! +10 points").length, 2);
});

test("H2 rewards: track/save and first-time lessons pay once, reviews pay nothing", () => {
  const db = fresh();
  assign(db, ["track", "save", "lesson"]);
  const points = db.child.points;
  game.childSave(db, 100, now);
  assert.equal(db.child.points - points, POINTS.save + POINTS.track);
  game.childSave(db, 100, now + 1000);
  assert.equal(db.child.points - points, POINTS.save + POINTS.track);
  const lesson = LESSONS[0], answers = lesson.questions.map((q) => q.answer);
  game.completeLesson(db, lesson.id, answers, now);
  assert.equal(db.child.points - points, POINTS.save + POINTS.track + POINTS.lesson);
  game.completeLesson(db, lesson.id, answers, now);
  assert.equal(db.child.points - points, POINTS.save + POINTS.track + POINTS.lesson);
  assert.deepEqual(db.child.dailyMissions.done.map((m) => m.key), ["save", "track", "lesson"]);
});

test("H2 track: journal, held/immediate spending and wallet recording share the daily gate", () => {
  for (const mode of ["journal", "held", "spend", "wallet"]) {
    const db = fresh(); assign(db, ["track"]);
    if (mode === "journal") game.journal(db, { direction: "spent", amount: 100, note: "Snack" }, now);
    else if (mode === "wallet") game.childWalletSpend(db, { amount: 100, merchant: "Snack", external_id: "once" }, spendPolicy, now);
    else { db.allowance.spendLimit = mode === "held" ? 0 : 2000; game.childSpend(db, { amount: 100, memo: "Snack" }, spendPolicy, now); }
    assert.equal(db.child.dailyMissions.done.filter((m) => m.key === "track").length, 1, mode);
    assert.equal(db.child.stats.tracked, 1, mode);
  }
});

test("H2 hooks: diary compares structured prices, equip changes a look, greeting and trip finish", () => {
  const db = fresh(); assign(db, ["compare", "dress", "greet"]);
  game.journal(db, { direction: "spent", amount: 0, note: "$2 vs $3" }, now);
  assert.equal(db.child.dailyMissions.done.some((m) => m.key === "compare"), false);
  actions.journal(db, { direction: "spent", amount: 0, note: "Two apples", prices: [2, 3] }, now);
  assert.deepEqual(db.tracking.at(-1).prices, [200, 300]);
  game.equip(db, "hat", db.child.bear.hat, now);
  assert.equal(db.child.dailyMissions.done.some((m) => m.key === "dress"), false);
  game.equip(db, "friend", null, now);
  game.sendGreeting(db, db.friends.find((f) => f.status === "approved").id, 0, now);
  assert.ok(["compare", "dress", "greet"].every((key) => db.child.dailyMissions.done.some((m) => m.key === key)));
  assign(db, ["trip"]);
  db.child.points = TRIP.cost;
  game.startTrip(db, now, () => 0);
  assert.equal(db.child.points, 15);
  assert.ok(db.child.dailyMissions.done.some((m) => m.key === "trip"));
  for (const prices of [null, [], [1], [1, -2], [1, 2, 3], ["x", 2]]) {
    const before = structuredClone(db);
    assert.throws(() => actions.journal(db, { direction: "spent", amount: 0, note: "Compare", prices }, now), game.GameError);
    assert.deepEqual(db, before);
  }
});

test("H2 cap: six completions clear the list and no more mission points until tomorrow", () => {
  const db = fresh();
  const keys = ["map", "story", "goal", "journal", "compare", "dress"];
  for (const key of keys) { assign(db, [key]); game.missionEvent(db, key, now); }
  assert.equal(db.child.dailyMissions.done.length, 6);
  assert.deepEqual(game.missionsToday(db, now).active, []);
  const points = db.child.points;
  assert.equal(game.missionEvent(db, "greet", now), false);
  assert.equal(db.child.points, points);
  const next = game.missionsToday(db, now + 86400000);
  assert.equal(next.doneCount, 0);
  assert.equal(next.active.length, 3);
});

test("H2 family day: UTC midnight and repeated DST hour do not reroll; local midnight does", () => {
  for (const times of [
    ["2026-10-24T16:30:00-07:00", "2026-10-24T17:30:00-07:00", "2026-10-25T00:00:00-07:00"],
    ["2026-11-01T01:30:00-07:00", "2026-11-01T01:30:00-08:00", "2026-11-02T00:00:00-08:00"],
  ]) {
    const db = fresh(), [a, b, c] = times.map(Date.parse);
    assign(db, ["goal"], a); game.missionSeen(db, "goal", a);
    assert.equal(childView(db, b).missionsToday.doneCount, 1);
    assert.equal(childView(db, c).missionsToday.doneCount, 0);
    assert.equal(db.child.dailyMissions.active[0].assignedAt, c);
  }
});

test("H2 eligibility: no friends, no points and all lessons passed never offer blocked missions", () => {
  const db = fresh(); db.friends = []; db.child.points = 0; db.child.lessonsDone = LESSONS.map((l) => l.id);
  for (let i = 0; i < 6; i++) {
    const view = game.missionsToday(db, now);
    assert.ok(view.active.every((m) => !["greet", "trip", "lesson"].includes(m.key)));
    // Keep points at zero so completing other missions cannot make trips eligible.
    game.missionEvent(db, view.active[0].key, now); db.child.points = 0;
  }
  const db2 = fresh(); assign(db2, ["greet", "trip", "lesson"]);
  db2.friends = []; db2.child.points = 0; db2.child.lessonsDone = LESSONS.map((l) => l.id);
  assert.ok(game.missionsToday(db2, now).active.every((m) => !["greet", "trip", "lesson"].includes(m.key)));
});

function device(ip) {
  let cookie = "";
  return async (method, path, body, at = now) => {
    const url = new URL(path, "http://test");
    const req = { body, ip, headers: { cookie }, query: Object.fromEntries(url.searchParams), get(k) { return this.headers[k.toLowerCase()]; } };
    const res = { statusCode: 200, headers: {}, set(k, v) { if (typeof k === "object") Object.assign(this.headers, Object.fromEntries(Object.entries(k).map(([key, value]) => [key.toLowerCase(), value]))); else this.headers[k.toLowerCase()] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } };
    await dispatch(method, url.pathname, req, res, at);
    if (res.headers["set-cookie"]) cookie = res.headers["set-cookie"].split(";")[0];
    return { status: res.statusCode, body: res.body };
  };
}
const form = (email) => ({ email, password: "password123", parentName: "Jordan", childName: "Mia", childAge: 9, bearName: "Pip", timezone: "America/Los_Angeles" });

test("H2 seen route: paired child, family isolation, validation, durable roll and 30/hour limit", async () => {
  const parent = device("parent"), outsider = device("outsider"), kid = device("kid");
  const me = await parent("POST", "/api/auth/register", form("mission@example.test"));
  const id = me.body.activeChild.id;
  await outsider("POST", "/api/auth/register", form("outside@example.test"));
  const link = await parent("POST", `/api/parent/children/${id}/link`, {});
  assert.equal((await kid("POST", "/api/auth/link", { code: link.body.code })).status, 200);
  await kid("GET", "/api/state");
  const stored = JSON.parse(database().prepare("SELECT doc FROM children WHERE id = ?").get(id).doc);
  assert.equal(stored.child.dailyMissions.active.length, 3);
  _clearStoreForTest();
  assert.deepEqual(readChild(id).child.dailyMissions, stored.child.dailyMissions, "read-time roll survives cache reload from SQLite");
  const version = readChild(id).version;
  await kid("GET", "/api/state");
  assert.equal(readChild(id).version, version, "unchanged reads do not publish");
  mutateChild(id, (db) => assign(db, ["goal"]));
  const before = structuredClone(readChild(id));
  assert.equal((await outsider("POST", `/api/child/missions/seen?child=${id}`, { key: "goal" })).status, 404);
  assert.deepEqual(readChild(id), before);
  for (const key of ["track", "map", "unknown", null]) assert.equal((await kid("POST", "/api/child/missions/seen", { key })).status, 400);
  assert.equal((await kid("POST", "/api/child/missions/seen", { key: "goal" })).status, 200);
  const points = readChild(id).child.points;
  for (let i = 5; i < 30; i++) assert.equal((await kid("POST", "/api/child/missions/seen", { key: "goal" })).status, 400);
  assert.equal((await kid("POST", "/api/child/missions/seen", { key: "goal" })).status, 429);
  assert.equal(readChild(id).child.points, points);
  assert.equal((await kid("POST", "/api/child/missions/seen", { key: "goal" }, now + HOUR)).status, 400);
  // Buddy carries the same list without including timestamp-shaped numbers in JSON tool content.
  const current = game.missionsToday(readChild(id));
  assert.deepEqual(snapshot(readChild(id)).missions_today.active.map((m) => m.key), current.active.map((m) => m.key));
});


test("H2 real greeting: sender mission awards 15 once inside the cross-family transaction", async () => {
  const a = device("greet-a"), b = device("greet-b");
  const aId = (await a("POST", "/api/auth/register", form("greet-a@example.test"))).body.activeChild.id;
  const bId = (await b("POST", "/api/auth/register", form("greet-b@example.test"))).body.activeChild.id;
  mutateChild(aId, (d) => { d.friends = [{ id: "friend_pair", real: true, status: "approved", peerId: bId, initiator: true }]; assign(d, ["greet"]); });
  mutateChild(bId, (d) => { d.friends = [{ id: "friend_pair", real: true, status: "approved", peerId: aId, initiator: false }]; });
  assert.equal((await a("POST", "/api/child/greet", { friendId: "friend_pair", index: 0 })).status, 200);
  assert.equal(readChild(aId).child.points, 15);
  assert.equal(readChild(bId).child.points, 0);
  assert.ok(readChild(aId).notifications.some((n) => n.text === "Mission done! +15 points"));
  assert.ok(readChild(bId).friends[0].greetings[0].text);
  await a("POST", "/api/child/greet", { friendId: "friend_pair", index: 1 });
  assert.equal(readChild(aId).child.points, 15);
  const stored = JSON.parse(database().prepare("SELECT doc FROM children WHERE id = ?").get(aId).doc);
  assert.equal(stored.child.dailyMissions.done.filter((m) => m.key === "greet").length, 1);
});

test("H2 isolation: a broken mission state never blocks a save or a spend", () => {
  const db = seed(Date.now());
  db.child.dailyMissions = { dayKey: "nope", active: null, done: "x" };
  const savings = db.accounts.savings.balance;
  game.childSave(db, 200);
  assert.equal(db.accounts.savings.balance, savings + 200);
  assert.ok(Array.isArray(db.child.dailyMissions.active));
  db.child.dailyMissions.active.push({ key: "save", assignedAt: 1 });
  db.child.bear = null; // missionTitle would throw; the save must still land
  const before = db.accounts.savings.balance;
  db.child.lastSaveDay = null;
  assert.doesNotThrow(() => game.childSave(db, 100));
  assert.equal(db.accounts.savings.balance, before + 100);
});

test("H2 eligibility: the save mission is not offered when spending money is empty, and daily missions count in the profile", () => {
  const db = seed(Date.now());
  db.accounts.spending.balance = 0;
  const daily = game.ensureDailyMissions(db, Date.now());
  assert.ok(!daily.active.some((m) => m.key === "save"));
  db.accounts.spending.balance = 500;
  db.child.dailyMissions = undefined;
  const again = game.ensureDailyMissions(db, Date.now());
  assert.ok(again.active.some((m) => m.key === "save"));
  game.childSave(db, 100); // completes "save" and, through the tracking bonus, "track" when both are active
  const finished = db.child.dailyMissions.done.length;
  assert.ok(finished >= 1);
  assert.equal(db.child.stats.dailyMissionsDone, finished);
  assert.equal(childView(db).profile.stats.missionsDone, finished);
});
