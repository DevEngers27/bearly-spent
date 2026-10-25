import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { database, _databaseForTest, closeDatabase } from "./db.js";
import { _clearStoreForTest, seed, readChild, importLegacy, DEMO_CHILD_ID } from "./store.js";
import { hashPassword, verifyPassword, tokenHash, initializeAccounts } from "./auth.js";
import { dispatch } from "./index.js";
import { _clearLimitsForTest, MINUTE } from "./limits.js";
import { cancelReplan } from "./buddy.js";

const DAY = 86400000;
const initialEnv = { MQ_DEMO: process.env.MQ_DEMO, MQ_DATA_DIR: process.env.MQ_DATA_DIR, NODE_ENV: process.env.NODE_ENV };
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mq-auth-"));
const form = (email = "parent@example.test") => ({ email, password: "a-good-password", parentName: "Jordan", childName: "Kai", childAge: 9, bearName: "Pip", timezone: "America/Los_Angeles" });

function device(ip = "127.0.0.1") {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    async call(method, url, body, { now = Date.now(), headers = {}, secure = false } = {}) {
      const parsed = new URL(url, "http://local");
      const req = Object.assign(new EventEmitter(), {
        headers: { cookie, ...headers }, body, query: Object.fromEntries(parsed.searchParams), ip, secure,
        get(name) { return this.headers[name.toLowerCase()]; },
      });
      const res = Object.assign(new EventEmitter(), {
        headers: {}, statusCode: 200,
        set(key, value) { if (typeof key === "object") { for (const [k, v] of Object.entries(key)) this.set(k, v); } else this.headers[key.toLowerCase()] = value; return this; },
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; return this; },
      });
      await dispatch(method, parsed.pathname, req, res, now);
      if (res.headers["set-cookie"]) cookie = res.headers["set-cookie"].split(";")[0];
      return { status: res.statusCode, body: res.body, headers: res.headers };
    },
  };
}

beforeEach(() => {
  cancelReplan();
  _clearLimitsForTest();
  _clearStoreForTest();
  _databaseForTest();
  delete process.env.MQ_DEMO;
  delete process.env.NODE_ENV;
  process.env.MQ_DATA_DIR = path.join(scratch, "no-legacy");
});
after(() => {
  cancelReplan();
  closeDatabase();
  fs.rmSync(scratch, { recursive: true, force: true });
  for (const [key, value] of Object.entries(initialEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("register normalizes email, hashes credentials, sets a private cookie and creates a fresh zero-balance child", async () => {
  const browser = device();
  const result = await browser.call("POST", "/api/auth/register", form(" Parent@Example.Test "));
  assert.equal(result.status, 200);
  assert.equal(result.body.role, "parent");
  assert.equal(result.body.family.timezone, "America/Los_Angeles");
  assert.equal(result.body.family.pinSet, false);
  assert.equal(result.body.children.length, 1);
  assert.equal(result.body.activeChild.name, "Kai");
  assert.match(result.headers["set-cookie"], /^mq_session=[\w-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/);
  const user = database().prepare("SELECT * FROM users").get();
  assert.equal(user.email, "parent@example.test");
  assert.match(user.pass_hash, /^scrypt\$32768\$8\$1\$/);
  const session = database().prepare("SELECT * FROM sessions").get();
  assert.equal(session.token_hash, tokenHash(browser.cookie.slice(11)));
  assert.ok(!JSON.stringify(session).includes(browser.cookie.slice(11)));
  const d = readChild(result.body.activeChild.id);
  assert.deepEqual(Object.values(d.accounts).map((a) => a.balance), [0, 0, 0]);
  for (const key of ["postcards", "adventures", "transactions", "friends", "approvals"]) assert.deepEqual(d[key], []);
  assert.equal(d.child.points, 0);
  assert.equal(d.child.bear.name, "Pip");
  assert.equal(d.family.parentPin, undefined);
  assert.ok(d.savingsGoals[0].createdAt >= Date.now() - 1000);
  assert.equal((await browser.call("GET", "/api/auth/me")).body.activeChild.id, result.body.activeChild.id);
});

test("scrypt format uses a random 16-byte salt and 64-byte key and verifies safely", () => {
  const hash = hashPassword("same password");
  const parts = hash.split("$");
  assert.deepEqual(parts.slice(0, 4), ["scrypt", "32768", "8", "1"]);
  assert.equal(Buffer.from(parts[4], "base64").length, 16);
  assert.equal(Buffer.from(parts[5], "base64").length, 64);
  assert.notEqual(hash, hashPassword("same password"));
  assert.equal(verifyPassword("same password", hash), true);
  for (const bad of ["wrong", "", null, [], 1234]) assert.equal(verifyPassword(bad, hash), false);
  for (const bad of [null, "scrypt$100$8$1$a$b", hash + "$extra", hash.slice(0, -20)]) assert.equal(verifyPassword("same password", bad), false);
});

test("registration rejects bad forms and rolls back family/user/child rows together", async () => {
  const invalid = [null, [], { password: "short" }, { email: "oops" }, { childAge: 6 }, { childAge: 13 }, { childName: [] }, { bearName: "x".repeat(25) }, { timezone: "Moon/Base" }];
  for (const [i, update] of invalid.entries()) {
    const browser = device(`register-${i}`);
    const body = update === null || Array.isArray(update) ? update : { ...form(), ...update };
    const result = await browser.call("POST", "/api/auth/register", body);
    assert.equal(result.status, 400, JSON.stringify(update));
    for (const table of ["families", "users", "children", "sessions"]) assert.equal(database().prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  }
  const browser = device("valid");
  assert.equal((await browser.call("POST", "/api/auth/register", form())).status, 200);
  assert.equal((await browser.call("POST", "/api/auth/register", form())).status, 400);
  assert.equal(database().prepare("SELECT count(*) AS n FROM families").get().n, 1);
});

test("login rejects wrong passwords, accepts normalized email, and logout invalidates cookie and bearer auth", async () => {
  const browser = device();
  await browser.call("POST", "/api/auth/register", form());
  const token = browser.cookie.slice(11);
  assert.equal((await device().call("POST", "/api/auth/login", { email: "parent@example.test", password: "wrong" })).status, 401);
  assert.equal((await device("unknown").call("POST", "/api/auth/login", { email: "nobody@example.test", password: "wrong" })).status, 401);
  const shortcut = device();
  assert.equal((await shortcut.call("GET", "/api/auth/me", undefined, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await browser.call("POST", "/api/auth/logout")).status, 200);
  assert.match(browser.cookie, /^mq_session=$/);
  assert.equal((await shortcut.call("GET", "/api/auth/me", undefined, { headers: { authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await device().call("POST", "/api/auth/login", { email: " PARENT@EXAMPLE.TEST ", password: "a-good-password" })).status, 200);
  assert.equal((await device().call("GET", "/api/parent/state", undefined, { headers: { "x-parent-token": "anything" } })).status, 401);
  assert.equal((await device().call("POST", "/api/parent/login", { pin: "1234" })).status, 404);
});

test("W2.5: logout-all revokes all family parent and kid sessions while preserving other families", async () => {
  const parent = device();
  const account = await parent.call("POST", "/api/auth/register", form());
  const cookieDevice = device("cookie-device"), bearerDevice = device("bearer-device");
  const credentials = { email: form().email, password: form().password };
  for (const browser of [cookieDevice, bearerDevice]) {
    assert.equal((await browser.call("POST", "/api/auth/login", credentials)).status, 200);
  }
  const revokedCookies = [parent.cookie, cookieDevice.cookie, bearerDevice.cookie];
  const link = await parent.call("POST", `/api/parent/children/${account.body.activeChild.id}/link`, {});
  const child = device("child");
  assert.equal((await child.call("POST", "/api/auth/link", { code: link.body.code })).status, 200);
  const other = device("other-family"), otherDevice = device("other-family-device");
  assert.equal((await other.call("POST", "/api/auth/register", form("other@example.test"))).status, 200);
  assert.equal((await otherDevice.call("POST", "/api/auth/login", { ...credentials, email: "other@example.test" })).status, 200);
  const result = await parent.call("POST", "/api/auth/logout-all");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.headers["set-cookie"], "mq_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  assert.equal(parent.cookie, "mq_session=");
  for (const cookie of revokedCookies) {
    for (const headers of [{ cookie }, { authorization: `Bearer ${cookie.slice(11)}` }]) {
      assert.equal((await device().call("GET", "/api/auth/me", undefined, { headers })).status, 401);
    }
  }
  assert.equal((await other.call("GET", "/api/auth/me")).status, 200);
  assert.equal((await device().call("GET", "/api/auth/me", undefined, { headers: { authorization: `Bearer ${otherDevice.cookie.slice(11)}` } })).status, 200);
  assert.equal((await child.call("GET", "/api/auth/me")).status, 401);
  assert.equal(database().prepare("SELECT count(*) AS n FROM sessions WHERE user_id = ?").get(database().prepare("SELECT id FROM users WHERE email = ?").get(form().email).id).n, 0);
});

test("logout-all requires parent auth and PIN unlock and clears a Secure cookie when called with bearer auth", async () => {
  const now = Date.now();
  const parent = device();
  const account = await parent.call("POST", "/api/auth/register", form(), { now });
  const link = await parent.call("POST", `/api/parent/children/${account.body.activeChild.id}/link`, {}, { now });
  const child = device("child");
  assert.equal((await child.call("POST", "/api/auth/link", { code: link.body.code }, { now })).status, 200);
  assert.equal((await device("guest").call("POST", "/api/auth/logout-all", {}, { now })).status, 401);
  assert.equal((await child.call("POST", "/api/auth/logout-all", {}, { now })).status, 403);
  assert.equal((await parent.call("POST", "/api/parent/pin", { pin: "2468" }, { now })).status, 200);
  const token = parent.cookie.slice(11);
  const headers = { authorization: `Bearer ${token}` };
  const lockedAt = now + 15 * MINUTE;
  assert.equal((await device().call("POST", "/api/auth/logout-all", {}, { now: lockedAt, headers })).status, 403);
  assert.equal((await parent.call("GET", "/api/auth/me", undefined, { now: lockedAt })).status, 200);
  assert.equal((await parent.call("POST", "/api/parent/unlock", { pin: "2468" }, { now: lockedAt })).status, 200);
  const result = await device().call("POST", "/api/auth/logout-all", {}, { now: lockedAt, headers, secure: true });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.headers["set-cookie"], "mq_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure");
  assert.equal((await parent.call("GET", "/api/auth/me", undefined, { now: lockedAt })).status, 401);
  assert.equal((await device().call("GET", "/api/auth/me", undefined, { now: lockedAt, headers })).status, 401);
  assert.equal((await child.call("GET", "/api/auth/me", undefined, { now: lockedAt })).status, 401);
});

test("W2.9: real families never advertise demo controls even with demo enabled", async () => {
  const parent = device();
  const account = await parent.call("POST", "/api/auth/register", form());
  const link = await parent.call("POST", `/api/parent/children/${account.body.activeChild.id}/link`, {});
  const child = device("child");
  assert.equal((await child.call("POST", "/api/auth/link", { code: link.body.code })).status, 200);
  assert.equal((await parent.call("POST", "/api/parent/pin", { pin: "2468" })).status, 200);
  const locked = device("locked-parent");
  assert.equal((await locked.call("POST", "/api/auth/login", { email: form().email, password: form().password })).status, 200);
  for (const mode of [undefined, "0", "true", "1"]) {
    if (mode === undefined) delete process.env.MQ_DEMO; else process.env.MQ_DEMO = mode;
    for (const browser of [parent, locked, child]) {
      const result = await browser.call("GET", "/api/auth/me");
      assert.equal(result.status, 200);
      assert.equal(result.body.demo, false);
    }
  }
});

test("unauthenticated auth/me returns only error and demo for missing, invalid and expired sessions", async () => {
  const now = Date.now();
  const parent = device();
  assert.equal((await parent.call("POST", "/api/auth/register", form(), { now })).status, 200);
  const expiredCookie = parent.cookie;
  for (const mode of [undefined, "0", "true", "1"]) {
    if (mode === undefined) delete process.env.MQ_DEMO; else process.env.MQ_DEMO = mode;
    for (const headers of [{}, { cookie: "mq_session=bad" }, { authorization: `Bearer ${"a".repeat(43)}` }, { cookie: expiredCookie }]) {
      const result = await device().call("GET", "/api/auth/me", undefined, { headers, now: now + 30 * DAY });
      assert.equal(result.status, 401);
      assert.equal(typeof result.body.error, "string");
      assert.deepEqual(result.body, { error: result.body.error, demo: mode === "1" });
      assert.equal(result.headers["cache-control"], "no-store");
      assert.equal(result.headers["set-cookie"], undefined);
    }
  }
});

test("parent sessions slide for 30 days, stop at 90 days and delete expired rows", async () => {
  const now = Date.now();
  const browser = device();
  await browser.call("POST", "/api/auth/register", form(), { now });
  const hash = tokenHash(browser.cookie.slice(11));
  for (const days of [25, 50, 75, 89]) {
    const result = await browser.call("GET", "/api/auth/me", undefined, { now: now + days * DAY });
    assert.equal(result.status, 200);
    const session = database().prepare("SELECT * FROM sessions WHERE token_hash = ?").get(hash);
    assert.equal(session.expires_at, now + Math.min(days + 30, 90) * DAY);
    assert.equal(session.last_seen, now + days * DAY);
  }
  assert.equal((await browser.call("GET", "/api/auth/me", undefined, { now: now + 90 * DAY })).status, 401);
  assert.equal(database().prepare("SELECT * FROM sessions WHERE token_hash = ?").get(hash), undefined);
  const idle = device();
  await idle.call("POST", "/api/auth/login", { email: form().email, password: form().password }, { now });
  assert.equal((await idle.call("GET", "/api/auth/me", undefined, { now: now + 30 * DAY })).status, 401);
});

test("session cookies use Secure for HTTPS or production and logout clears with matching attributes", async () => {
  const browser = device();
  let result = await browser.call("POST", "/api/auth/register", form(), { secure: true });
  assert.match(result.headers["set-cookie"], /; Secure$/);
  process.env.NODE_ENV = "production";
  result = await browser.call("POST", "/api/auth/logout");
  assert.match(result.headers["set-cookie"], /Max-Age=0; Secure$/);
  result = await browser.call("POST", "/api/auth/login", { email: form().email, password: form().password });
  assert.match(result.headers["set-cookie"], /; Secure$/);
});

test("child link codes are single-use, expire at 15 minutes and create fixed 180-day child sessions", async () => {
  const now = Date.now();
  const parent = device();
  const account = await parent.call("POST", "/api/auth/register", form(), { now });
  const id = account.body.activeChild.id;
  const link = await parent.call("POST", `/api/parent/children/${id}/link`, {}, { now });
  assert.match(link.body.code, /^[BCDFGHJKMNPQRTVWXY346789]{6}$/);
  assert.equal(link.body.expiresAt, now + 15 * MINUTE);
  const child = device("child");
  const linked = await child.call("POST", "/api/auth/link", { code: link.body.code.toLowerCase() }, { now });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.role, "child");
  assert.equal(linked.body.activeChild.id, id);
  assert.equal(linked.body.children.length, 1);
  assert.equal((await device().call("POST", "/api/auth/link", { code: link.body.code }, { now })).status, 400);
  const expiry = now + 180 * DAY;
  assert.equal((await child.call("GET", "/api/state", undefined, { now: now + 100 * DAY })).status, 200);
  assert.equal(database().prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").get(tokenHash(child.cookie.slice(11))).expires_at, expiry);
  assert.equal((await child.call("GET", "/api/state", undefined, { now: expiry })).status, 401);
  const expired = await parent.call("POST", `/api/parent/children/${id}/link`, {}, { now });
  assert.equal((await device().call("POST", "/api/auth/link", { code: expired.body.code }, { now: now + 15 * MINUTE })).status, 400);
});

test("link generation allows five attempts per child across parent sessions and resets after 15 minutes", async () => {
  const now = Date.now();
  const parent = device();
  const account = await parent.call("POST", "/api/auth/register", form(), { now });
  const id = account.body.activeChild.id;
  const otherParent = device("other-parent");
  assert.equal((await otherParent.call("POST", "/api/auth/login", { email: form().email, password: form().password }, { now })).status, 200);
  const url = `/api/parent/children/${id}/link`;
  for (let i = 0; i < 5; i++) {
    const link = await (i % 2 ? otherParent : parent).call("POST", url, {}, { now });
    assert.equal(link.status, 200);
    if (i === 0) assert.equal((await device("child").call("POST", "/api/auth/link", { code: link.body.code }, { now })).status, 200);
  }
  const before = database().prepare("SELECT * FROM kid_links ORDER BY code").all();
  for (const time of [now, now + 15 * MINUTE - 1]) {
    const limited = await parent.call("POST", url, {}, { now: time });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, "Let's take a little break. Try again soon!");
    assert.deepEqual(database().prepare("SELECT * FROM kid_links ORDER BY code").all(), before);
  }
  const sibling = await parent.call("POST", "/api/parent/children", { name: "Sibling", age: 7, bearName: "Bear" }, { now });
  assert.equal(sibling.status, 200);
  assert.equal((await parent.call("POST", `/api/parent/children/${sibling.body.id}/link`, {}, { now })).status, 200);
  assert.equal((await otherParent.call("POST", url, {}, { now: now + 15 * MINUTE })).status, 200);
});

test("W2.6/10: new link generation retains known-code tombstones and other children codes", async () => {
  const now = Date.now();
  const parent = device();
  const account = await parent.call("POST", "/api/auth/register", form(), { now });
  const other = await device("other-family").call("POST", "/api/auth/register", form("other@example.test"), { now });
  assert.equal(account.status, 200);
  assert.equal(other.status, 200);
  const insert = database().prepare("INSERT INTO kid_links (code, family_id, child_id, expires_at, used_at) VALUES (?, ?, ?, ?, ?)");
  insert.run("expired-before", account.body.family.id, account.body.activeChild.id, now - 1, null);
  insert.run("expired-boundary", other.body.family.id, other.body.activeChild.id, now, null);
  insert.run("used", other.body.family.id, other.body.activeChild.id, now + MINUTE, now - 1);
  insert.run("active", other.body.family.id, other.body.activeChild.id, now + MINUTE, null);
  const link = await parent.call("POST", `/api/parent/children/${account.body.activeChild.id}/link`, {}, { now });
  assert.equal(link.status, 200);
  assert.deepEqual(database().prepare("SELECT code FROM kid_links").all().map((r) => r.code).sort(), ["expired-before", "expired-boundary", "used", "active", link.body.code].sort());
});

test("PIN set and unlock require parent credentials; hashes, expiry and per-session lockout survive database state", async () => {
  const now = Date.now();
  const browser = device();
  await browser.call("POST", "/api/auth/register", form(), { now });
  for (const pin of [1234, ["1234"], "123", "123456789", "abcd"]) assert.equal((await browser.call("POST", "/api/parent/pin", { pin }, { now })).status, 400);
  const set = await browser.call("POST", "/api/parent/pin", { pin: "2468" }, { now });
  assert.equal(set.status, 200);
  const family = database().prepare("SELECT * FROM families").get();
  assert.match(family.parent_pin, /^scrypt\$32768\$8\$1\$/);
  assert.ok(verifyPassword("2468", family.parent_pin));
  assert.equal((await browser.call("GET", "/api/parent/state", undefined, { now: now + 15 * MINUTE })).status, 403);
  assert.equal((await browser.call("GET", "/api/auth/me", undefined, { now: now + 15 * MINUTE })).status, 200);
  const other = device("other");
  await other.call("POST", "/api/auth/login", { email: form().email, password: form().password }, { now });
  assert.equal((await other.call("GET", "/api/parent/state", undefined, { now })).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await other.call("POST", "/api/parent/unlock", { pin: "0000" }, { now: now + i * MINUTE })).status, i === 4 ? 429 : 401);
  _clearLimitsForTest(); // persisted lockout still applies after process-local windows are lost
  assert.equal((await other.call("POST", "/api/parent/unlock", { pin: "2468" }, { now: now + 15 * MINUTE })).status, 429);
  assert.equal((await other.call("POST", "/api/parent/unlock", { pin: "2468" }, { now: now + 19 * MINUTE })).status, 200);
  assert.equal((await other.call("GET", "/api/parent/state", undefined, { now: now + 20 * MINUTE })).status, 200);
  assert.equal((await other.call("POST", "/api/parent/pin", { pin: "8642" }, { now: now + 20 * MINUTE })).status, 200);
});

test("credentials and sessions persist across a SQLite reopen", async () => {
  const filename = path.join(scratch, "persist.sqlite");
  _databaseForTest(filename);
  const browser = device();
  const result = await browser.call("POST", "/api/auth/register", form());
  _clearStoreForTest();
  _databaseForTest(filename);
  assert.equal((await browser.call("GET", "/api/state")).status, 200);
  assert.equal((await browser.call("GET", "/api/auth/me")).body.activeChild.id, result.body.activeChild.id);
  assert.equal((await device().call("POST", "/api/auth/login", { email: form().email, password: form().password })).status, 200);
});

test("demo mode is opt-in, initializes once and logs in without a default PIN", async () => {
  const browser = device();
  assert.equal((await browser.call("POST", "/api/demo/login")).status, 404);
  assert.equal((await browser.call("GET", "/api/demo/anything")).status, 404);
  process.env.MQ_DEMO = "1";
  initializeAccounts();
  initializeAccounts();
  const result = await browser.call("POST", "/api/demo/login");
  assert.equal(result.status, 200);
  assert.equal(result.body.family.pinSet, false);
  assert.equal(result.body.demo, true);
  assert.equal(result.body.activeChild.name, "Mia");
  assert.equal(readChild(DEMO_CHILD_ID).postcards.filter((p) => p.defId === "chicago").length, 2);
  assert.equal(database().prepare("SELECT count(*) AS n FROM users").get().n, 1);
  assert.equal((await device().call("POST", "/api/auth/login", { email: "demo@moneyquest.test", password: "demo-pass-1234" })).status, 200);
  delete process.env.MQ_DEMO;
  assert.equal((await browser.call("POST", "/api/parent/reset")).status, 404);
});

test("legacy import preserves progress, removes plaintext PIN and renames only after a successful import", () => {
  const filename = path.join(scratch, "legacy.json");
  const legacy = seed(Date.now());
  legacy.family.parentPin = "1234";
  legacy.child.points = 4321;
  fs.writeFileSync(filename, JSON.stringify(legacy));
  assert.equal(importLegacy(filename), true);
  assert.equal(fs.existsSync(filename), false);
  assert.equal(fs.existsSync(filename + ".imported"), true);
  assert.equal(readChild(DEMO_CHILD_ID).child.points, 4321);
  assert.equal(readChild(DEMO_CHILD_ID).family.parentPin, undefined);
  process.env.MQ_DEMO = "1";
  initializeAccounts();
  assert.equal(readChild(DEMO_CHILD_ID).child.points, 4321);
});

test("corrupt legacy files are left untouched and never silently replaced with demo data", () => {
  const filename = path.join(scratch, "broken.json");
  fs.writeFileSync(filename, "{broken");
  assert.throws(() => importLegacy(filename), SyntaxError);
  assert.equal(fs.readFileSync(filename, "utf8"), "{broken");
  assert.equal(fs.existsSync(filename + ".imported"), false);
  assert.equal(database().prepare("SELECT count(*) AS n FROM families").get().n, 0);
});


test("W2.4: only failed PINs count, success resets, fifth failure locks for a full 15 minutes", async () => {
  const now = Date.now(), parent = device();
  await parent.call("POST", "/api/auth/register", form(), { now });
  await parent.call("POST", "/api/parent/pin", { pin: "2468" }, { now });
  for (let i = 0; i < 7; i++) assert.equal((await parent.call("POST", "/api/parent/unlock", { pin: "2468" }, { now })).status, 200);
  for (let i = 0; i < 3; i++) {
    const wrong = await parent.call("POST", "/api/parent/unlock", { pin: "0000" }, { now });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.attemptsLeft, 4 - i);
  }
  assert.equal((await parent.call("POST", "/api/parent/unlock", { pin: "2468" }, { now })).status, 200);
  for (let i = 0; i < 5; i++) {
    const wrong = await parent.call("POST", "/api/parent/unlock", { pin: "0000" }, { now: now + MINUTE });
    assert.equal(wrong.status, i === 4 ? 429 : 401);
    assert.equal(wrong.body.attemptsLeft, 4 - i);
    if (i === 4) { assert.equal(wrong.body.retryAfterSeconds, 900); assert.equal(wrong.headers["retry-after"], "900"); }
  }
  const locked = await parent.call("POST", "/api/parent/unlock", { pin: "2468" }, { now: now + 2 * MINUTE });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.retryAfterSeconds, 840);
  for (let i = 0; i < 5; i++) {
    const wrong = await parent.call("POST", "/api/parent/unlock", { pin: "0000" }, { now: now + 16 * MINUTE });
    assert.equal(wrong.status, i === 4 ? 429 : 401);
    assert.equal(wrong.body.attemptsLeft, 4 - i);
  }
  assert.equal((await parent.call("POST", "/api/parent/unlock", { pin: "2468" }, { now: now + 31 * MINUTE })).status, 200);
});

test("W2.6/10: replacement kid codes cancel unused predecessors and distinguish unknown, used and expired", async () => {
  const parent = device(), now = Date.now();
  const account = await parent.call("POST", "/api/auth/register", form(), { now });
  const url = `/api/parent/children/${account.body.activeChild.id}/link`;
  const first = (await parent.call("POST", url, {}, { now })).body;
  const second = (await parent.call("POST", url, {}, { now: now + 1 })).body;
  for (const [code, time, reason] of [["BBBBBB", now, "unknown"], [first.code, now + 1, "used_or_expired"], [second.code, now + 15 * MINUTE + 1, "used_or_expired"]]) {
    const result = await device(code).call("POST", "/api/auth/link", { code }, { now: time });
    assert.equal(result.status, 400);
    assert.equal(result.body.reason, reason);
  }
  assert.equal((await device("kid").call("POST", "/api/auth/link", { code: second.code }, { now: now + 2 })).status, 200);
  assert.equal((await device("used").call("POST", "/api/auth/link", { code: second.code }, { now: now + 3 })).body.reason, "used_or_expired");
});

test("W2.6/7: device listing and unlink enforce child, family, role and server PIN lock", async () => {
  const parent = device(), kid = device("kid"), other = device("other"), now = Date.now();
  const account = (await parent.call("POST", "/api/auth/register", form(), { now })).body;
  const outsider = (await other.call("POST", "/api/auth/register", form("other@test.com"), { now })).body;
  const id = account.activeChild.id, url = `/api/parent/children/${id}/devices`;
  const sibling = (await parent.call("POST", "/api/parent/children", { name: "Sibling", age: 8, bearName: "Pip" }, { now })).body;
  const link = (await parent.call("POST", `/api/parent/children/${id}/link`, {}, { now })).body;
  await kid.call("POST", "/api/auth/link", { code: link.code }, { now, headers: { "user-agent": "Mozilla/5.0 (iPhone) Version/18 Safari/605" } });
  await kid.call("GET", "/api/state", undefined, { now: now + 1000 });
  const devices = (await parent.call("GET", url, undefined, { now: now + 1000 })).body;
  assert.equal(devices.length, 1);
  assert.equal(devices[0].created_at, now);
  assert.equal(devices[0].last_seen, now + 1000);
  assert.equal(devices[0].name, "Safari on iPhone");
  assert.notEqual(devices[0].id, tokenHash(kid.cookie.slice(11)));
  const target = `${url}/${devices[0].id}`;
  assert.equal((await kid.call("DELETE", target)).status, 403);
  assert.equal((await other.call("GET", url)).status, 404);
  assert.equal((await other.call("DELETE", target)).status, 404);
  assert.equal((await parent.call("DELETE", `/api/parent/children/${sibling.id}/devices/${devices[0].id}`)).status, 404);
  assert.equal((await parent.call("DELETE", `/api/parent/children/${outsider.activeChild.id}/devices/${devices[0].id}`)).status, 404);
  await parent.call("POST", "/api/parent/pin", { pin: "2468" });
  assert.equal((await parent.call("POST", "/api/parent/lock", {})).status, 200);
  assert.equal((await parent.call("GET", "/api/auth/me")).body.unlockedUntil, 0);
  assert.equal((await parent.call("GET", "/api/parent/state")).status, 403);
  assert.equal((await parent.call("GET", url)).status, 403);
  assert.equal((await parent.call("DELETE", target)).status, 403);
  assert.equal((await kid.call("POST", "/api/parent/lock", {})).status, 403);
  await parent.call("POST", "/api/parent/unlock", { pin: "2468" });
  assert.equal((await parent.call("DELETE", target)).status, 200);
  assert.equal((await kid.call("GET", "/api/auth/me")).status, 401);
  assert.deepEqual((await parent.call("GET", url)).body, []);
  assert.equal((await other.call("GET", "/api/auth/me")).status, 200);
});

test("W2.8: password resets a forgotten PIN while locked, clears lockouts, and is login-rate-limited", async () => {
  const parent = device(), now = Date.now();
  const account = (await parent.call("POST", "/api/auth/register", form(), { now })).body;
  const link = (await parent.call("POST", `/api/parent/children/${account.activeChild.id}/link`, {}, { now })).body;
  const kid = device("kid");
  await kid.call("POST", "/api/auth/link", { code: link.code }, { now });
  await parent.call("POST", "/api/parent/pin", { pin: "2468" }, { now });
  await parent.call("POST", "/api/parent/lock", {}, { now });
  const url = "/api/parent/pin/reset";
  assert.equal((await kid.call("POST", url, { password: form().password }, { now })).status, 403);
  for (const password of [null, [], 1234]) assert.equal((await parent.call("POST", url, { password }, { now })).status, 400);
  assert.equal((await parent.call("POST", url, { password: "wrong" }, { now })).status, 401);
  assert.equal((await parent.call("GET", "/api/auth/me", undefined, { now })).body.family.pinSet, true);
  const reset = await parent.call("POST", url, { password: form().password }, { now });
  assert.equal(reset.status, 200);
  assert.equal((await parent.call("GET", "/api/auth/me", undefined, { now })).body.family.pinSet, false);
  assert.equal((await parent.call("GET", "/api/parent/state", undefined, { now })).status, 200);
  assert.equal((await parent.call("POST", url, { password: form().password }, { now })).status, 429);
  assert.equal((await parent.call("POST", url, { password: form().password }, { now: now + 15 * MINUTE })).status, 200);
});


test("W2.9: demo-only mutations reject real families even on a demo-enabled server", async () => {
  const parent = device();
  const account = (await parent.call("POST", "/api/auth/register", form())).body;
  process.env.MQ_DEMO = "1";
  for (const path of ["topup", "inject-fault", "allowance/run-now", "reset"]) {
    assert.equal((await parent.call("POST", `/api/parent/${path}`, { amount: 50 })).status, 404);
  }
  assert.equal(readChild(account.activeChild.id).accounts.parent.balance, 0);
});
