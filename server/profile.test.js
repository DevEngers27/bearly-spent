import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { database, _databaseForTest, closeDatabase } from "./db.js";
import { _clearStoreForTest, seed, migrate, readChild, mutateChild, subscribe, DEMO_CHILD_ID } from "./store.js";
import { createSession, initializeAccounts, hashPassword } from "./auth.js";
import { childView, parentView, dispatch } from "./index.js";
import { _clearLimitsForTest, MINUTE } from "./limits.js";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mq-profile-"));
const savedEnv = { MQ_DEMO: process.env.MQ_DEMO, MQ_DATA_DIR: process.env.MQ_DATA_DIR };
const form = (email = "parent@example.test") => ({ email, password: "a-good-password", parentName: "Jordan", childName: "Ben", childAge: 9, bearName: "Pip" });
function device(ip = "profile-ip", token) {
  let cookie = token ? `mq_session=${token}` : "";
  return {
    async call(method, url, body, now = Date.now()) {
      const parsed = new URL(url, "http://local");
      const req = Object.assign(new EventEmitter(), { headers: { cookie }, body, query: Object.fromEntries(parsed.searchParams), ip, get(name) { return this.headers[name]; } });
      const res = { headers: {}, statusCode: 200,
        set(key, value) { if (typeof key === "object") Object.entries(key).forEach(([k, v]) => this.set(k, v)); else this.headers[key.toLowerCase()] = value; return this; },
        status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; },
      };
      await dispatch(method, parsed.pathname, req, res, now);
      if (res.headers["set-cookie"]) cookie = res.headers["set-cookie"].split(";")[0];
      return { status: res.statusCode, body: res.body };
    },
  };
}
async function family(email) {
  const parent = device(email);
  const result = await parent.call("POST", "/api/auth/register", form(email));
  assert.equal(result.status, 200);
  return { parent, me: result.body, id: result.body.activeChild.id };
}
async function pair(parent, id) {
  const link = await parent.call("POST", `/api/parent/children/${id}/link`, {});
  const kid = device(`kid-${id}`);
  assert.equal((await kid.call("POST", "/api/auth/link", { code: link.body.code })).status, 200);
  return kid;
}
beforeEach(() => {
  _clearStoreForTest(); _clearLimitsForTest(); _databaseForTest();
  delete process.env.MQ_DEMO;
  process.env.MQ_DATA_DIR = path.join(scratch, "no-legacy");
});
after(() => {
  closeDatabase(); fs.rmSync(scratch, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test("G5.1/2/6: profile views expose current identity, lifetime numbers and newest badges", () => {
  const d = seed(123456789);
  d.child.milestonesUnlocked = [1000, 5000, 2500];
  d.child.lessonsDone = ["one", "two"];
  d.child.stats.longestStreak = 8;
  d.child.friendCode = "BEN-42";
  d.adventures = [{ status: "returned" }, { status: "away" }];
  d.missions = [{ status: "done" }, { status: "pending_review" }];
  const view = childView(d);
  assert.deepEqual(view.profile, parentView(d).profile);
  assert.equal(view.profile.name, d.child.name);
  assert.equal(view.profile.bearName, d.child.bear.name);
  assert.equal(view.profile.age, 9);
  assert.equal(view.profile.friendCode, "BEN-42");
  assert.equal(view.profile.since, 123456789);
  assert.equal(view.profile.stats.points, 40);
  assert.deepEqual(view.profile.stats.postcards, { collected: 1, cards: 2, total: Object.values(view.catalog.places).filter((p) => p.open).length });
  assert.equal(view.profile.stats.tripsTaken, 2);
  assert.equal(view.profile.stats.lessonsFinished, 2);
  assert.equal(view.profile.stats.missionsDone, 1);
  assert.equal(view.profile.stats.longestStreak, 8);
  assert.deepEqual(view.profile.badges.map((b) => b.at), [2500, 5000, 1000]);
  delete d.child.stats.longestStreak;
  assert.equal(Object.hasOwn(childView(d).profile.stats, "longestStreak"), false);
  assert.equal(Object.hasOwn(view.profile, "accounts"), false);
});

test("G5.3: kid rename validates without truncating, audits, notifies and publishes only its own bear", async () => {
  const a = await family(), b = await family("other@example.test");
  const kid = await pair(a.parent, a.id);
  await a.parent.call("POST", "/api/parent/pin", { pin: "1234" });
  await a.parent.call("POST", "/api/parent/lock", {});
  const d = readChild(a.id), version = d.version, original = structuredClone(readChild(b.id));
  for (const bearName of ["", "   ", "🐻✨", "---", "x".repeat(25), null, 12, {}, []]) {
    assert.equal((await kid.call("POST", "/api/child/profile", { bearName })).status, 400);
    assert.equal(d.version, version);
  }
  const events = [];
  const off = subscribe(a.me.family.id, (v, id) => events.push([v, id]));
  const name = "Pecan" + "a".repeat(19);
  assert.equal((await kid.call("POST", "/api/child/profile", { bearName: ` ${name} `, name: "Intruder", age: 12 })).status, 200);
  assert.equal(d.child.bear.name, name);
  assert.equal(d.child.name, "Ben"); assert.equal(d.child.age, 9);
  assert.equal(d.audit.at(-1).detail, `Renamed the bear to ${name}`);
  assert.equal(d.notifications.at(-1).text, `Ben renamed the bear to ${name}`);
  assert.equal(d.notifications.at(-1).to, "parent");
  assert.deepEqual(events, [[version + 1, a.id]]);
  assert.equal((await kid.call("POST", `/api/child/profile?child=${b.id}`, { bearName: "Nope" })).status, 404);
  assert.deepEqual(readChild(b.id), original);
  assert.equal((await kid.call("POST", "/api/child/bear/name", { name: "Pecan" })).status, 200);
  assert.equal(d.child.bear.name, "Pecan");
  off();
});

test("G5.5: parent edits a sibling profile with tenancy, validation, refreshed summaries and derived labels", async () => {
  const a = await family(), b = await family("outside@example.test");
  const sibling = (await a.parent.call("POST", "/api/parent/children", { name: "Sam", age: 7, bearName: "Oak" })).body;
  const path = `/api/parent/children/${sibling.id}/profile`;
  const original = structuredClone(readChild(a.id));
  const update = { name: "Alex", age: 12, bearName: "Chestnut" };
  for (const body of [null, { ...update, name: " " }, { ...update, name: "x".repeat(25) }, { ...update, age: 6 }, { ...update, age: 13 }, { ...update, age: 7.5 }, { ...update, bearName: "🐻" }]) assert.equal((await a.parent.call("POST", path, body)).status, 400);
  assert.equal((await b.parent.call("POST", path, update)).status, 404);
  assert.equal((await a.parent.call("POST", "/api/parent/children/missing/profile", update)).status, 404);
  const edited = await a.parent.call("POST", path, update);
  assert.equal(edited.status, 200); assert.equal(edited.body.name, "Alex");
  const d = readChild(sibling.id);
  assert.equal(d.child.age, 12); assert.equal(d.child.bear.name, "Chestnut");
  assert.match(d.audit.at(-1).detail, /Updated Alex's profile/);
  assert.equal(d.notifications.at(-1).text, "Your grown-up renamed your bear to Chestnut");
  assert.equal(d.accounts.savings.label, "Alex's savings");
  d.accounts.spending.label = "stale stored name";
  assert.equal(parentView(d).accounts.spending.label, "Alex's spending");
  const me = (await a.parent.call("GET", "/api/auth/me")).body;
  assert.equal(me.children.find((c) => c.id === sibling.id).bearName, "Chestnut");
  assert.deepEqual(readChild(a.id), original);
  await a.parent.call("POST", path, { ...update, age: 11 });
  assert.equal(d.notifications.at(-1).text, "Your grown-up updated your profile");
});

test("G5.4: account name and optional display name update me and every child audit atomically", async () => {
  const a = await family(), b = await family("outside@example.test");
  const sibling = (await a.parent.call("POST", "/api/parent/children", { name: "Sam", age: 7, bearName: "Oak" })).body;
  const events = [];
  subscribe(a.me.family.id, (version, id) => events.push(id));
  for (const name of [null, " ", "x".repeat(65)]) assert.equal((await a.parent.call("POST", "/api/auth/account", { name })).status, 400);
  assert.equal((await a.parent.call("POST", "/api/auth/account", { name: " Robin " })).status, 200);
  assert.deepEqual(events, [a.id, sibling.id]);
  assert.equal((await a.parent.call("POST", "/api/parent/family", { displayName: " The Oaks " })).status, 200);
  const me = (await a.parent.call("GET", "/api/auth/me")).body;
  assert.deepEqual({ ...me.user }, { id: a.me.user.id, name: "Robin", email: "parent@example.test" });
  assert.equal(me.family.name, "Robin"); assert.equal(me.family.displayName, "The Oaks");
  assert.equal(database().prepare("SELECT display_name FROM families WHERE id = ?").get(me.family.id).display_name, "The Oaks");
  for (const id of [a.id, sibling.id]) {
    assert.equal(readChild(id).family.parentName, "Robin");
    assert.equal(readChild(id).audit.at(-1).kind, "account");
  }
  assert.equal(readChild(b.id).audit.length, 0);
  assert.equal((await a.parent.call("POST", "/api/parent/family", { displayName: "x".repeat(41) })).status, 400);
  assert.equal((await a.parent.call("POST", "/api/parent/family", { displayName: null })).status, 400);
  assert.equal((await a.parent.call("POST", "/api/parent/family", { displayName: " " })).status, 200);
  assert.equal((await a.parent.call("GET", "/api/auth/me")).body.family.displayName, "");
});

test("G5.4: email change requires current password, rejects duplicates and normalizes like register", async () => {
  const a = await family(); await family("taken@example.test");
  for (const [body, status] of [
    [{ email: "new@example.test", password: "bad" }, 401],
    [{ email: " TAKEN@EXAMPLE.TEST ", password: form().password }, 400],
    [{ email: "not-an-email", password: form().password }, 400],
  ]) assert.equal((await a.parent.call("POST", "/api/auth/email", body)).status, status);
  assert.equal((await a.parent.call("POST", "/api/auth/email", { email: " New@Example.Test ", password: form().password })).status, 200);
  assert.equal((await a.parent.call("GET", "/api/auth/me")).body.user.email, "new@example.test");
  assert.equal((await device("login-new").call("POST", "/api/auth/login", { email: "new@example.test", password: form().password })).status, 200);
  assert.equal((await device("login-old").call("POST", "/api/auth/login", { email: "parent@example.test", password: form().password })).status, 401);
});

test("G5.4: password change keeps current session, revokes only this user's other parent sessions", async () => {
  const a = await family(), b = await family("outside@example.test");
  const other = device("second-parent");
  assert.equal((await other.call("POST", "/api/auth/login", { email: form().email, password: form().password })).status, 200);
  const kid = await pair(a.parent, a.id);
  const userId = "another-parent";
  database().prepare("INSERT INTO users (id, family_id, role, email, pass_hash, name, created_at) VALUES (?, ?, 'parent', ?, ?, ?, ?)").run(userId, a.me.family.id, "co@example.test", hashPassword("another-password"), "Co", Date.now());
  const co = device("co-parent", createSession({ familyId: a.me.family.id, userId }).token);
  const next = "  a new password  ";
  assert.equal((await a.parent.call("POST", "/api/auth/password", { currentPassword: "wrong", newPassword: next })).status, 401);
  for (const newPassword of ["short", "x".repeat(1025)]) assert.equal((await a.parent.call("POST", "/api/auth/password", { currentPassword: form().password, newPassword })).status, 400);
  assert.equal((await a.parent.call("POST", "/api/auth/password", { currentPassword: form().password, newPassword: next })).status, 200);
  assert.equal((await a.parent.call("GET", "/api/auth/me")).status, 200);
  assert.equal((await other.call("GET", "/api/auth/me")).status, 401);
  for (const client of [kid, co, b.parent]) assert.equal((await client.call("GET", "/api/auth/me")).status, 200);
  assert.equal(readChild(a.id).audit.at(-1).detail, "Password changed");
  assert.equal(readChild(a.id).audit.at(-1).kind, "account");
  _clearLimitsForTest();
  assert.equal((await device("login-new").call("POST", "/api/auth/login", { email: form().email, password: next })).status, 200);
  _clearLimitsForTest();
  assert.equal((await device("login-old").call("POST", "/api/auth/login", { email: form().email, password: form().password })).status, 401);
});

test("G5.4/5: all parent profile routes reject paired children and PIN-locked parents", async () => {
  const a = await family(), kid = await pair(a.parent, a.id);
  const routes = [["auth/account", { name: "New" }], ["auth/email", { email: "new@example.test", password: form().password }], ["auth/password", { currentPassword: form().password, newPassword: "new-password" }], ["parent/family", { displayName: "Family" }], [`parent/children/${a.id}/profile`, { name: "New", age: 9, bearName: "Oak" }]];
  assert.equal(Object.hasOwn((await kid.call("GET", "/api/auth/me")).body, "user"), false);
  await a.parent.call("POST", "/api/parent/pin", { pin: "1234" });
  await a.parent.call("POST", "/api/parent/lock", {});
  for (const [route, body] of routes) for (const browser of [kid, a.parent]) assert.equal((await browser.call("POST", `/api/${route}`, body)).status, 403, route);
  assert.equal((await a.parent.call("POST", "/api/parent/unlock", { pin: "1234" })).status, 200);
  assert.equal((await a.parent.call("POST", "/api/auth/account", { name: "New" })).status, 200);
});

test("G5.4: password-checking account routes share login email and IP limits", async () => {
  const a = await family(), now = Date.now();
  for (let i = 0; i < 5; i++) {
    const route = i % 2 ? "password" : "email";
    assert.equal((await a.parent.call("POST", `/api/auth/${route}`, { password: "bad", currentPassword: "bad", email: "new@example.test", newPassword: "new-password" }, now)).status, 401);
  }
  assert.equal((await a.parent.call("POST", "/api/auth/password", { currentPassword: form().password, newPassword: "new-password" }, now)).status, 429);
  assert.equal((await a.parent.call("POST", "/api/auth/email", { password: form().password, email: "new@example.test" }, now + 15 * MINUTE)).status, 200);
});

test("G5.2/4: legacy schema and since timestamps migrate durably without changing existing family data", () => {
  const filename = path.join(scratch, "legacy.sqlite");
  const legacy = new DatabaseSync(filename);
  legacy.exec("CREATE TABLE families (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, parent_pin TEXT, timezone TEXT NOT NULL DEFAULT 'UTC'); INSERT INTO families VALUES ('old', 'Original', 1, NULL, 'UTC')");
  legacy.close();
  const db = _databaseForTest(filename), d = seed();
  delete d.createdAt;
  d.audit = [{ ts: 200 }, { ts: 100 }];
  db.prepare("INSERT INTO children (id,family_id,doc,version,updated_at) VALUES ('old-child','old',?,1,1)").run(JSON.stringify(d));
  assert.equal(readChild("old-child").createdAt, 100);
  _clearStoreForTest();
  _databaseForTest(filename);
  assert.equal(readChild("old-child").createdAt, 100);
  assert.equal(database().prepare("SELECT display_name FROM families WHERE id = 'old'").get().display_name, "");
  assert.equal(database().prepare("SELECT name FROM families WHERE id = 'old'").get().name, "Original");
  const noAudit = seed(); delete noAudit.createdAt;
  const before = Date.now(); migrate(noAudit);
  assert.ok(noAudit.createdAt >= before && noAudit.createdAt <= Date.now());
});

test("G5 rules: demo profile edits reset to seed names", async () => {
  process.env.MQ_DEMO = "1";
  initializeAccounts();
  const demo = device("demo");
  assert.equal((await demo.call("POST", "/api/demo/login", {})).status, 200);
  assert.equal((await demo.call("POST", `/api/parent/children/${DEMO_CHILD_ID}/profile`, { name: "Changed", age: 12, bearName: "Pecan" })).status, 200);
  assert.equal((await demo.call("POST", "/api/parent/reset", {})).status, 200);
  assert.equal(readChild(DEMO_CHILD_ID).child.name, seed().child.name);
  assert.equal(readChild(DEMO_CHILD_ID).child.bear.name, seed().child.bear.name);
});
