import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import http from "node:http";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { database, _databaseForTest, closeDatabase } from "./db.js";
import { _clearStoreForTest, readChild, mutateChild, listChildren, childrenWithDueWork, subscribe, DEMO_CHILD_ID } from "./store.js";
import { initializeAccounts } from "./auth.js";
import { dispatch, createApp, tick, routeActions } from "./index.js";
import { takeLimit, _clearLimitsForTest, MINUTE, HOUR } from "./limits.js";
import { cancelReplan, replan, queueReplan, _internals } from "./buddy.js";
import { audit, notify } from "./domain.js";

const env = Object.fromEntries(["MQ_DATA_DIR", "MQ_DEMO", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"].map((k) => [k, process.env[k]]));
const form = (name) => ({ email: `${name}@example.test`, password: "parent-password", parentName: name, childName: name, childAge: 9, bearName: "Pip" });
function device(ip = "127.0.0.1") {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    async call(method, url, body, { now = Date.now(), write = true, headers = {} } = {}) {
      const parsed = new URL(url, "http://local");
      const req = Object.assign(new EventEmitter(), {
        headers: { cookie, ...headers }, body, ip, query: Object.fromEntries(parsed.searchParams),
        get(key) { return this.headers[key.toLowerCase()]; },
      });
      const res = Object.assign(new EventEmitter(), {
        headers: {}, statusCode: 200, chunks: [], ended: false,
        set(key, value) { if (typeof key === "object") { for (const [k, v] of Object.entries(key)) this.set(k, v); } else this.headers[key.toLowerCase()] = value; return this; },
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; return this; },
        flushHeaders() {},
        write(chunk) { this.chunks.push(chunk); return write; },
        end() { this.ended = true; this.emit("close"); },
      });
      await dispatch(method, parsed.pathname, req, res, now);
      if (res.headers["set-cookie"]) cookie = res.headers["set-cookie"].split(";")[0];
      return { status: res.statusCode, body: res.body, headers: res.headers, req, res };
    },
  };
}
async function family(name) {
  const browser = device(name);
  const result = await browser.call("POST", "/api/auth/register", form(name));
  assert.equal(result.status, 200);
  return { browser, id: result.body.activeChild.id, familyId: result.body.family.id };
}
async function pair(parent, id) {
  const link = await parent.call("POST", `/api/parent/children/${id}/link`, {});
  const child = device("child");
  assert.equal((await child.call("POST", "/api/auth/link", { code: link.body.code })).status, 200);
  return child;
}

beforeEach(() => {
  cancelReplan();
  _clearLimitsForTest();
  _clearStoreForTest();
  _databaseForTest();
  delete process.env.MQ_DEMO;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});
after(() => {
  cancelReplan();
  _clearLimitsForTest();
  closeDatabase();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("two families cannot read, mutate or pair each other's children, returning 404 without changing either document", async () => {
  const a = await family("a"), b = await family("b");
  const beforeA = structuredClone(readChild(a.id)), beforeB = structuredClone(readChild(b.id));
  for (const [method, path, body] of [
    ["GET", "/api/state"], ["GET", "/api/parent/state"],
    ["POST", "/api/child/bear/name", { name: "Stolen" }],
    ["POST", "/api/parent/mission", { title: "Stolen" }],
    ["POST", "/api/parent/topup", { amount: 50 }],
  ]) assert.equal((await a.browser.call(method, `${path}?child=${b.id}`, body)).status, 404);
  assert.equal((await a.browser.call("POST", `/api/parent/children/${b.id}/link`, {})).status, 404);
  assert.equal((await a.browser.call("GET", "/api/state?child=child_missing")).status, 404);
  assert.deepEqual(readChild(a.id), beforeA);
  assert.deepEqual(readChild(b.id), beforeB);
});

test("child sessions are bound to one child and every parent route rejects them", async () => {
  const a = await family("a");
  const other = await a.browser.call("POST", "/api/parent/children", { name: "Sibling", age: 7, bearName: "Bear" });
  assert.equal(other.status, 200);
  const child = await pair(a.browser, a.id);
  for (const entry of routeActions.filter((r) => r.access === "parent" || r.access === "lockedParent")) {
    const url = entry.path.replace(":id", a.id);
    assert.equal((await child.call(entry.method, url, { pin: "2468" })).status, 403, url);
  }
  assert.equal((await child.call("GET", `/api/state?child=${other.body.id}`)).status, 404);
  assert.equal((await child.call("POST", `/api/child/bear/name?child=${other.body.id}`, { name: "No" })).status, 404);
  assert.equal((await child.call("GET", "/api/auth/me")).body.children.length, 1);
  assert.equal((await child.call("POST", "/api/child/bear/name", { name: "Sunny" })).status, 200);
  assert.equal(readChild(a.id).child.bear.name, "Sunny");
  assert.equal(readChild(other.body.id).child.bear.name, "Bear");
});

test("all game, Buddy, voice, stream and parent routes require a session", async () => {
  const anonymous = device();
  for (const entry of routeActions.filter((r) => r.access !== "public")) {
    const url = entry.path.replace(":id", "test");
    assert.equal((await anonymous.call(entry.method, url, {})).status, 401, url);
  }
});

test("parent child selection keeps funding accounts, settings and mutations separate", async () => {
  const a = await family("a");
  const other = await a.browser.call("POST", "/api/parent/children", { name: "Sibling", age: 12, bearName: "Bear" });
  const id = other.body.id;
  assert.equal(listChildren(a.familyId).length, 2);
  assert.notEqual(readChild(id).accounts.parent.id, readChild(a.id).accounts.parent.id);
  process.env.MQ_DEMO = "1";
  assert.equal((await a.browser.call("POST", `/api/parent/topup?child=${id}`, { amount: 50 })).status, 200);
  assert.equal(readChild(id).accounts.parent.balance, 5000);
  assert.equal(readChild(a.id).accounts.parent.balance, 0);
  assert.equal((await a.browser.call("GET", `/api/auth/me?child=${id}`)).body.activeChild.id, id);
  await a.browser.call("POST", `/api/parent/settings?child=${id}`, { buddyEnabled: false });
  assert.equal(readChild(a.id).settings.buddyEnabled, true);
  for (const path of ["/api/buddy/chat", "/api/buddy/speak", "/api/voice/token"]) {
    assert.equal((await a.browser.call("POST", `${path}?child=${id}`, { text: "Hello" })).status, 400);
  }
  assert.ok(readChild(id).audit.some((a) => a.action === "demo_topup" && /Demo control/.test(a.detail)));
});

test("SSE sends family versions only, restricts paired children and unsubscribes on close", async () => {
  const a = await family("a"), b = await family("b");
  const child = await pair(a.browser, a.id);
  const sibling = await a.browser.call("POST", "/api/parent/children", { name: "Sibling", age: 8, bearName: "Bear" });
  const streamA = await a.browser.call("GET", "/api/stream");
  const streamB = await b.browser.call("GET", "/api/stream");
  const streamChild = await child.call("GET", "/api/stream");
  mutateChild(a.id, (d) => { d.child.points++; });
  assert.equal(streamA.res.chunks.length, 2);
  assert.equal(streamB.res.chunks.length, 1);
  assert.equal(streamChild.res.chunks.length, 2);
  assert.deepEqual(JSON.parse(streamA.res.chunks.at(-1).slice(6)), { childId: a.id, version: 2 });
  mutateChild(sibling.body.id, (d) => { d.child.points++; });
  assert.equal(streamA.res.chunks.length, 3);
  assert.equal(streamChild.res.chunks.length, 2);
  streamA.req.emit("close");
  mutateChild(a.id, (d) => { d.child.points++; });
  assert.equal(streamA.res.chunks.length, 3);
  assert.equal(streamA.res.ended, true);
  streamB.req.emit("close");
  streamChild.req.emit("close");
});

test("SSE caps each family at four, closes the oldest and disconnects slow consumers and logged-out sessions", async () => {
  const a = await family("a"), b = await family("b");
  const other = await b.browser.call("GET", "/api/stream");
  const streams = [];
  for (let i = 0; i < 5; i++) streams.push(await a.browser.call("GET", "/api/stream"));
  assert.equal(streams[0].res.ended, true);
  assert.equal(streams[1].res.ended, false);
  assert.equal(other.res.ended, false);
  const slow = await b.browser.call("GET", "/api/stream", undefined, { write: false });
  assert.equal(slow.res.ended, true);
  await a.browser.call("POST", "/api/auth/logout");
  mutateChild(a.id, (d) => { d.child.points++; });
  for (const entry of streams) assert.equal(entry.res.ended, true);
  const before = slow.res.chunks.length;
  mutateChild(b.id, (d) => { d.child.points++; });
  assert.equal(slow.res.chunks.length, before);
  other.req.emit("close");
});

test("tick selects only due children and processes allowance and adventure work in both families", async () => {
  const a = await family("a"), b = await family("b"), idle = await family("idle");
  const now = Date.now();
  for (const account of [a, b]) mutateChild(account.id, (d) => {
    d.accounts.parent.balance = 5000;
    d.allowance.amount = 1000;
    d.allowance.nextRun = now;
    d.adventures.push({ id: "trip", destId: "chicago", status: "away", returnsAt: now - 1, postcardIds: [] });
  });
  const idleVersion = readChild(idle.id).version;
  assert.deepEqual(new Set(childrenWithDueWork(now)), new Set([a.id, b.id]));
  assert.deepEqual(new Set(tick(now)), new Set([a.id, b.id]));
  for (const { id } of [a, b]) {
    assert.equal(readChild(id).accounts.parent.balance, 4000);
    assert.equal(readChild(id).accounts.savings.balance, 500);
    assert.equal(readChild(id).accounts.spending.balance, 500);
    assert.equal(readChild(id).adventures[0].status, "returned");
    assert.equal(readChild(id).postcards.length, 1);
  }
  assert.equal(readChild(idle.id).version, idleVersion);
  assert.deepEqual(tick(now), []);
});

test("failed SQLite mutations restore held document references, disk, version and family notifications", async () => {
  const a = await family("a");
  const held = readChild(a.id), before = structuredClone(held);
  let events = 0;
  const off = subscribe(a.familyId, () => { events++; });
  assert.throws(() => mutateChild(a.id, (d) => { d.accounts.parent.balance = 9000; delete d.child; throw new Error("abort"); }), /abort/);
  assert.deepEqual(held, before);
  assert.deepEqual(JSON.parse(database().prepare("SELECT doc FROM children WHERE id = ?").get(a.id).doc), before);
  assert.equal(events, 0);
  assert.throws(() => mutateChild(a.id, async () => {}), /synchronous/);
  assert.deepEqual(held, before);
  mutateChild(a.id, (d) => { d.child.points++; });
  assert.equal(events, 1);
  assert.equal(held.version, before.version + 1);
  off();
});

test("retention caps tracking, audit, transactions, chat and 200 notifications per recipient", async () => {
  const a = await family("a");
  mutateChild(a.id, (d) => {
    d.tracking = Array.from({ length: 510 }, (_, i) => ({ id: `track-${i}` }));
    d.transactions = Array.from({ length: 5010 }, (_, i) => ({ id: `txn-${i}` }));
    d.buddy.chat = Array.from({ length: 210 }, (_, i) => ({ id: `msg-${i}`, role: "user", text: String(i), ts: i }));
    for (let i = 0; i < 2010; i++) audit(d, "system", "test", String(i));
    for (let i = 0; i < 210; i++) {
      notify(d, "child", String(i));
      notify(d, "parent", String(i));
    }
  });
  const d = readChild(a.id);
  assert.equal(d.tracking.length, 500);
  assert.equal(d.tracking[0].id, "track-10");
  assert.equal(d.transactions.length, 5000);
  assert.equal(d.audit.length, 2000);
  assert.equal(d.buddy.chat.length, 200);
  assert.equal(d.notifications.length, 400);
  assert.equal(d.notifications.filter((n) => n.to === "child").length, 200);
  assert.equal(d.notifications.filter((n) => n.to === "parent").length, 200);
  assert.equal((await a.browser.call("GET", "/api/state")).body.chat.length, 30);
  const parent = await a.browser.call("GET", "/api/parent/state");
  assert.equal(parent.body.chat.length, 200);
  assert.equal((await a.browser.call("GET", "/api/parent/state?before=msg-100")).body.chat.length, 90);
  assert.equal((await a.browser.call("GET", "/api/parent/state?before=missing")).status, 400);
});

test("Buddy rate limit returns 429 after 30 messages, is per child and recovers after an hour", async () => {
  const a = await family("a"), b = await family("b");
  const now = Date.now();
  for (let i = 0; i < 30; i++) assert.equal((await a.browser.call("POST", "/api/buddy/chat", { text: "Hello" }, { now })).status, 200);
  const result = await a.browser.call("POST", "/api/buddy/chat", { text: "Hello" }, { now });
  assert.equal(result.status, 429);
  assert.match(result.body.error, /break/);
  assert.equal((await b.browser.call("POST", "/api/buddy/chat", { text: "Hello" }, { now })).status, 200);
  assert.equal((await a.browser.call("POST", "/api/buddy/chat", { text: "Hello" }, { now: now + HOUR })).status, 200);
});

test("Buddy allows one in-flight chat per child and releases it after completion", async (t) => {
  const a = await family("a"), b = await family("b");
  process.env.ANTHROPIC_API_KEY = "test-key";
  let finish;
  t.mock.method(_internals, "runClaude", async (messages, { childId }) => childId === a.id
    ? new Promise((resolve) => { finish = resolve; }) : { reply: "Hello B", toolsUsed: [] });
  t.mock.method(_internals, "runGuard", async () => "OK");
  const first = a.browser.call("POST", "/api/buddy/chat", { text: "Hello" });
  assert.equal((await a.browser.call("POST", "/api/buddy/chat", { text: "Again" })).status, 429);
  assert.equal((await b.browser.call("POST", "/api/buddy/chat", { text: "Hello" })).status, 200);
  finish({ reply: "Hello A", toolsUsed: [] });
  assert.equal((await first).status, 200);
  assert.equal(readChild(a.id).buddy.chat.at(-1).text, "Hello A");
  assert.equal(readChild(b.id).buddy.chat.at(-1).text, "Hello B");
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await a.browser.call("POST", "/api/buddy/chat", { text: "Hello" })).status, 200);
});

test("Buddy replans and cancellation are keyed per child, including tools and guard audits", async (t) => {
  const a = await family("a"), b = await family("b");
  process.env.ANTHROPIC_API_KEY = "test-key";
  const pending = new Map();
  t.mock.method(_internals, "runClaude", (messages, options) => new Promise((resolve) => { pending.set(options.childId, { ...options, resolve }); }));
  t.mock.method(_internals, "runGuard", async () => "BLOCK");
  const first = replan(a.id, "A money"), second = replan(b.id, "B money");
  queueReplan(a.id, "new A money");
  cancelReplan(a.id);
  const plan = (childId) => pending.get(childId).executeTool("update_savings_plan", { summary: childId, weekly_save_dollars: 2, steps: ["Save"] });
  assert.ok(plan(a.id).error);
  assert.equal(plan(b.id).ok, true);
  for (const { resolve } of pending.values()) resolve({ reply: "blocked note", completed: true });
  await Promise.all([first, second]);
  assert.equal(readChild(a.id).buddy.plan, null);
  assert.equal(readChild(a.id).buddy.chat.length, 0);
  assert.equal(readChild(b.id).buddy.plan.summary, b.id);
  assert.ok(readChild(b.id).audit.some((a) => a.action === "buddy_guard_blocked"));
  assert.ok(!readChild(a.id).audit.some((a) => a.action === "buddy_guard_blocked"));
});

test("voice, speech, login and registration fixed windows use the specified scopes and limits", async () => {
  const a = await family("a"), b = await family("b");
  const now = Date.now();
  for (const [path, max, duration] of [["/api/buddy/speak", 60, HOUR], ["/api/voice/token", 20, 10 * MINUTE]]) {
    for (let i = 0; i < max; i++) assert.equal((await a.browser.call("POST", path, { text: "Hi" }, { now })).status, 404);
    assert.equal((await a.browser.call("POST", path, { text: "Hi" }, { now })).status, 429);
    assert.equal((await b.browser.call("POST", path, { text: "Hi" }, { now })).status, 404);
    assert.equal((await a.browser.call("POST", path, { text: "Hi" }, { now: now + duration })).status, 404);
  }
  for (let i = 0; i < 5; i++) assert.equal((await device(`ip-${i}`).call("POST", "/api/auth/login", { email: "a@example.test", password: "bad" }, { now })).status, 401);
  assert.equal((await device("new-ip").call("POST", "/api/auth/login", { email: " A@example.test ", password: "bad" }, { now })).status, 429);
  for (let i = 0; i < 10; i++) takeLimit("loginIp", "blocked-ip", now);
  assert.equal((await device("blocked-ip").call("POST", "/api/auth/login", { email: "b@example.test", password: "bad" }, { now })).status, 429);
  assert.equal((await device("blocked-ip").call("POST", "/api/auth/login", { email: "b@example.test", password: "bad" }, { now: now + 15 * MINUTE })).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await device("register-ip").call("POST", "/api/auth/register", null, { now })).status, 400);
  assert.equal((await device("register-ip").call("POST", "/api/auth/register", null, { now })).status, 429);
  assert.equal((await device("register-ip").call("POST", "/api/auth/register", null, { now: now + HOUR })).status, 400);
});

// Real Express parser/middleware, using stream-backed HTTP objects, never sockets.
function appRequest(body, contentType = "application/json") {
  return new Promise((resolve, reject) => {
    const socket = new PassThrough();
    const req = new http.IncomingMessage(socket);
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error("In-process request timed out")); }, 2000);
    req.complete = true;
    req.httpVersion = "1.1";
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    req.method = "POST";
    req.url = "/api/auth/register";
    req.headers = { "content-type": contentType, "content-length": String(Buffer.byteLength(body)) };
    const res = new http.ServerResponse(req);
    let raw = "";
    socket.on("data", (data) => { raw += data; });
    res.assignSocket(socket);
    res.on("finish", () => { clearTimeout(timeout); res.detachSocket(socket); socket.destroy(); resolve({ status: res.statusCode, headers: res.getHeaders(), raw }); });
    res.on("error", reject);
    createApp().handle(req, res);
    req.push(body);
    req.push(null);
  });
}

test("Express enforces the 32 KB JSON body cap and API headers on parser and route errors", async () => {
  for (const [body, status] of [[JSON.stringify({ text: "x".repeat(32768) }), 413], ["{broken", 400], ["{}", 400]]) {
    const result = await appRequest(body);
    assert.equal(result.status, status);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.equal(result.headers["x-content-type-options"], "nosniff");
    assert.equal(result.headers["referrer-policy"], "no-referrer");
    assert.equal(result.headers["permissions-policy"], "camera=(), microphone=(self)");
    assert.match(result.headers["content-security-policy"], /default-src 'self'/);
  }
  const unknown = await device().call("GET", "/api/unknown");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers["cache-control"], "no-store");
});

test("Nessie defaults to HTTPS, rejects insecure mirrors and only permits the explicit development override", () => {
  const script = 'import { nessieEnabled } from "./server/bank.js"; nessieEnabled();';
  const run = (base, allow) => spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NESSIE_API_KEY: "test-key", NESSIE_BASE_URL: base, NESSIE_ALLOW_HTTP: allow },
  });
  assert.equal(run("https://api.nessieisreal.com", "0").status, 0);
  assert.equal(run("http://localhost:9999", "0").status, 1);
  assert.equal(run("http://localhost:9999", "1").status, 0);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8", env: { ...process.env, NESSIE_API_KEY: "test-key", NESSIE_BASE_URL: "", NESSIE_ALLOW_HTTP: "0" },
  });
  assert.equal(result.status, 0);
});

test("Nessie mirror account caches and asynchronous audit hooks retain each child's document context", () => {
  const script = `
    import assert from "node:assert/strict";
    import { seed } from "./server/store.js";
    import { transfer, setNessieAuditHook } from "./server/bank.js";
    const docs = [seed(), seed()];
    const requests = [], origins = [];
    let sequence = 0, complete;
    const done = new Promise((resolve) => { complete = resolve; });
    globalThis.fetch = async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ objectCreated: { _id: "nessie-" + (++sequence) } }) };
    };
    setNessieAuditHook((action, detail, data, doc) => {
      assert.equal(action, "nessie_mirrored");
      origins.push(doc);
      if (origins.length === 3) complete();
    });
    for (const i of [0, 0, 1]) transfer(docs[i], { from: "spending", to: "merchant", amount: 100, kind: "spend", memo: "book" });
    await done;
    assert.equal(requests.filter((r) => r.url.includes("/customers?" )).length, 4);
    assert.equal(requests.filter((r) => /customers\\/[^/]+\\/accounts\\?/.test(r.url)).length, 6);
    const withdrawals = requests.filter((r) => r.url.includes("/withdrawals"));
    assert.equal(withdrawals.length, 3);
    assert.equal(withdrawals[0].url, withdrawals[1].url);
    assert.notEqual(withdrawals[0].url, withdrawals[2].url);
    assert.equal(origins.filter((d) => d === docs[0]).length, 2);
    assert.equal(origins.filter((d) => d === docs[1]).length, 1);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    timeout: 5000, encoding: "utf8", env: { ...process.env, NESSIE_API_KEY: "test", NESSIE_BASE_URL: "https://api.nessieisreal.com" },
  });
  assert.equal(result.status, 0, result.stderr);
});

test("demo controls audit the selected child and reset preserves other families and invalidates the old document", async () => {
  const a = await family("a");
  mutateChild(a.id, (d) => { d.child.points = 777; });
  process.env.MQ_DEMO = "1";
  process.env.MQ_DATA_DIR = "/private/tmp/mq-b5a-no-legacy-input";
  initializeAccounts();
  const demo = device("demo");
  assert.equal((await demo.call("POST", "/api/demo/login")).status, 200);
  const now = Date.now();
  assert.equal((await demo.call("POST", "/api/parent/allowance/run-now", {}, { now })).status, 200);
  assert.ok(readChild(DEMO_CHILD_ID).audit.some((a) => a.action === "demo_allowance_run"));
  assert.ok(readChild(DEMO_CHILD_ID).transactions.some((t) => t.ref?.startsWith("allowance:")));
  assert.equal((await demo.call("POST", "/api/parent/inject-fault")).status, 200);
  assert.ok(readChild(DEMO_CHILD_ID).audit.some((a) => a.action === "demo_fault"));
  assert.equal((await a.browser.call("POST", "/api/parent/reset")).status, 404);
  const held = readChild(DEMO_CHILD_ID), version = held.version;
  assert.equal((await demo.call("POST", "/api/parent/reset")).status, 200);
  assert.notEqual(readChild(DEMO_CHILD_ID), held);
  assert.ok(readChild(DEMO_CHILD_ID).version > version);
  assert.equal(readChild(DEMO_CHILD_ID).postcards.length, 2);
  assert.ok(readChild(DEMO_CHILD_ID).audit.some((a) => a.action === "demo_reset"));
  assert.equal(readChild(a.id).child.points, 777);
});

test("fresh children can add practice DIRECTORY friends without exposing money", async () => {
  const a = await family("a");
  const result = await a.browser.call("POST", "/api/child/friend", { code: "SAM-12" });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "pending_parent");
  assert.ok(result.body.postcards.length > 0);
  for (const key of ["accounts", "balance", "balances", "transactions"]) assert.equal(Object.hasOwn(result.body, key), false);
  assert.equal(readChild(a.id).friends.length, 1);
});

test("API handoff lists every exported route and reset script targets the demo SQLite child", () => {
  const api = fs.readFileSync(new URL("./API.md", import.meta.url), "utf8");
  for (const { method, path } of routeActions) assert.ok(api.includes(`${method} ${path}`), `${method} ${path}`);
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.reset, /resetChild\(DEMO_CHILD_ID\)/);
  assert.ok(!pkg.scripts.reset.includes("rm "));
});

test("merged trips, reveal receipts and goal cancellation obey account roles and selected-child isolation", async () => {
  const a = await family("trip-parent"), outsider = await family("outsider");
  const sibling = (await a.browser.call("POST", "/api/parent/children", { name: "Sibling", age: 8, bearName: "Maple" })).body;
  const child = await pair(a.browser, sibling.id);
  const original = structuredClone(readChild(a.id));
  mutateChild(sibling.id, (d) => { d.child.points = 60; });
  const trip = await child.call("POST", "/api/child/trip", {});
  assert.equal(trip.status, 200);
  assert.equal(trip.body.status, "away");
  assert.equal(Object.hasOwn(trip.body, "destId"), false);
  assert.equal(readChild(sibling.id).child.points, 30);
  const away = (await child.call("GET", "/api/state")).body;
  assert.equal(Object.hasOwn(away.adventures[0], "destId"), false);
  assert.equal(away.catalog.trip.cost, 30);
  assert.equal((await a.browser.call("GET", `/api/parent/state?child=${sibling.id}`)).body.adventures[0].destId, readChild(sibling.id).adventures[0].destId);
  assert.equal((await outsider.browser.call("POST", `/api/child/trip?child=${sibling.id}`, {})).status, 404);
  assert.equal((await child.call("POST", `/api/child/trip?child=${a.id}`, {})).status, 404);
  mutateChild(sibling.id, (d) => { d.adventures[0].returnsAt = Date.now() - 1; });
  tick();
  const receiptPath = `/api/child/adventure/${trip.body.id}/seen`;
  assert.equal((await a.browser.call("POST", `${receiptPath}?child=${a.id}`, {})).status, 400);
  assert.equal((await outsider.browser.call("POST", `${receiptPath}?child=${sibling.id}`, {})).status, 404);
  assert.equal((await child.call("POST", receiptPath, {})).status, 200);
  const receipt = readChild(sibling.id).adventures[0].revealedAt;
  assert.ok(receipt);
  assert.equal((await child.call("POST", receiptPath, {})).status, 200);
  assert.equal(readChild(sibling.id).adventures[0].revealedAt, receipt);
  const goal = await a.browser.call("POST", `/api/parent/goal?child=${sibling.id}`, { title: "Help out", type: "tasks", count: 1, reward: 0 });
  assert.equal(goal.status, 200);
  const cancelPath = `/api/parent/goal/${goal.body.id}/cancel`;
  assert.equal((await child.call("POST", cancelPath, {})).status, 403);
  assert.equal((await a.browser.call("POST", `${cancelPath}?child=${a.id}`, {})).status, 400);
  assert.equal((await outsider.browser.call("POST", `${cancelPath}?child=${sibling.id}`, {})).status, 404);
  assert.equal((await a.browser.call("POST", `${cancelPath}?child=${sibling.id}`, {})).status, 200);
  assert.equal(readChild(sibling.id).parentGoals[0].status, "cancelled");
  assert.deepEqual(readChild(a.id), original);
  // Legacy adventure callers retain the same response privacy as surprise trips.
  mutateChild(sibling.id, (d) => { d.child.points = 90; });
  const legacy = await child.call("POST", "/api/child/adventure", { destId: "chicago" });
  assert.equal(legacy.status, 200);
  assert.equal(Object.hasOwn(legacy.body, "destId"), false);
});
