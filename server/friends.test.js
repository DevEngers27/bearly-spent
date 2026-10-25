import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { database, _databaseForTest, closeDatabase } from "./db.js";
import { _clearStoreForTest, readChild, mutateChild, mutateChildren, listChildren, subscribe, friendCode, CODE_ALPHABET, DEMO_CHILD_ID } from "./store.js";
import { initializeAccounts } from "./auth.js";
import { dispatch, tick } from "./index.js";
import { _clearLimitsForTest } from "./limits.js";
import { cancelReplan } from "./buddy.js";
import { LESSONS } from "./catalog.js";

const originalDemo = process.env.MQ_DEMO;
const originalDir = process.env.MQ_DATA_DIR;
const form = (name) => ({ email: `${name.replaceAll(" ", "")}@example.test`, password: "parent-password", parentName: name, childName: name, childAge: 9, bearName: "Pip" });
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
});
after(() => {
  cancelReplan();
  closeDatabase();
  if (originalDemo === undefined) delete process.env.MQ_DEMO; else process.env.MQ_DEMO = originalDemo;
  if (originalDir === undefined) delete process.env.MQ_DATA_DIR; else process.env.MQ_DATA_DIR = originalDir;
});

async function request(a, b) {
  const result = await a.browser.call("POST", "/api/child/friend", { code: friendCode(b.id) });
  assert.deepEqual(result.body, { ok: true, message: "Request sent" });
  return readChild(a.id).friends.at(-1).id;
}
const pending = (a, kind) => readChild(a.id).approvals.findLast((r) => r.real && r.kind === kind && r.status === "pending");
async function parentYes(a, kind = "friend_request", approve = true) {
  const approval = pending(a, kind);
  assert.ok(approval, `${kind} approval exists`);
  const result = await a.browser.call("POST", `/api/parent/approval/${approval.id}`, { approve });
  assert.equal(result.status, 200, result.body?.error);
  return result;
}
async function friends(a, b) {
  const id = await request(a, b);
  await parentYes(a);
  assert.equal((await b.browser.call("POST", `/api/child/friend/${id}/respond`, { approve: true })).status, 200);
  await parentYes(b);
  return id;
}
function cards(a, b) {
  for (const [who, defId] of [[a, "chicago"], [b, "seattle"]]) mutateChild(who.id, (d) => {
    d.postcards.push({ id: `card-${who.id}`, defId, source: "trip", collectedAt: Date.now() });
  });
}
async function offer(a, friendId, now = Date.now()) {
  const result = await a.browser.call("POST", "/api/child/trade", { friendId, give: "chicago", get: "seattle" }, { now });
  assert.equal(result.status, 200, result.body?.error);
  return result.body.id;
}

test("G3.1 friend codes are stable, unique, eight characters, separate from pairing, and parent-rotatable", async () => {
  const a = await family("a"), b = await family("b");
  const code = friendCode(a.id);
  assert.equal(code.length, 8);
  assert.ok([...code].every((c) => CODE_ALPHABET.includes(c)));
  assert.equal((await a.browser.call("GET", "/api/state")).body.friendCode, code);
  assert.equal(listChildren(a.familyId)[0].friendCode, code);
  assert.notEqual(friendCode(b.id), code);
  const kid = await pair(a.browser, a.id);
  const route = `/api/parent/children/${a.id}/friend-code`;
  assert.equal((await kid.call("POST", route, {})).status, 403);
  assert.equal((await b.browser.call("POST", route, {})).status, 404);
  const next = await a.browser.call("POST", route, {});
  assert.equal(next.status, 200);
  assert.notEqual(next.body.friendCode, code);
  assert.deepEqual((await b.browser.call("POST", "/api/child/friend", { code })).body, { ok: true, message: "Request sent" });
  assert.equal(readChild(b.id).friends.length, 0);
  await request(b, a);
  assert.equal(readChild(b.id).friends.length, 1);
  assert.equal((await device().call("POST", "/api/auth/link", { code: next.body.friendCode })).status, 400);
  _clearStoreForTest();
  assert.equal(friendCode(a.id), next.body.friendCode);
});

for (const parentFirst of [true, false]) test(`G3.2 both kids and parents consent, recipient parent first=${parentFirst}`, async () => {
  const a = await family("Ava Smith"), b = await family("Ben Jones");
  const friendId = await request(a, b);
  let stateA = (await a.browser.call("GET", "/api/state")).body;
  assert.equal(stateA.friends[0].status, "pending_parent_a");
  assert.equal(stateA.friends[0].name, undefined);
  assert.equal(stateA.friends[0].bear, undefined);
  assert.equal((await b.browser.call("GET", "/api/state")).body.friends.length, 0);
  assert.equal(pending(b, "friend_request"), undefined);
  if (parentFirst) assert.equal((await a.browser.call("POST", "/api/parent/family", { displayName: "The Smiths" })).status, 200);
  await parentYes(a);
  assert.match(pending(b, "friend_request").title, parentFirst ? /Ava \(from The Smiths\) wants to be friends with Ben/ : /Ava \(from Ava Smith's family\) wants to be friends with Ben/);
  const stateB = (await b.browser.call("GET", "/api/state")).body;
  assert.equal(stateB.friends[0].name, "Ava");
  assert.ok(!JSON.stringify(stateB.pendingRequests).includes("Smith"));
  if (parentFirst) await parentYes(b);
  else assert.equal((await b.browser.call("POST", `/api/child/friend/${friendId}/respond`, { approve: true })).status, 200);
  assert.equal(readChild(a.id).friends[0].status, "pending_parent_b");
  if (parentFirst) assert.equal((await b.browser.call("POST", `/api/child/friend/${friendId}/respond`, { approve: true })).status, 200);
  else await parentYes(b);
  for (const who of [a, b]) {
    assert.equal(readChild(who.id).friends[0].status, "approved");
    assert.match(readChild(who.id).notifications.at(-1).text, /now friends/);
    assert.equal(pending(who, "friend_request"), undefined);
  }
  stateA = (await a.browser.call("GET", "/api/state")).body;
  assert.equal(stateA.friends[0].name, "Ben");
});

for (const step of ["parentA", "parentB", "kidB"]) test(`G3.2 decline at ${step} is private, closes both sides, and permits retry`, async () => {
  const a = await family("a"), b = await family("b");
  const friendId = await request(a, b);
  if (step === "parentA") await parentYes(a, "friend_request", false);
  else {
    await parentYes(a);
    if (step === "parentB") await parentYes(b, "friend_request", false);
    else assert.equal((await b.browser.call("POST", `/api/child/friend/${friendId}/respond`, { approve: false })).status, 200);
  }
  for (const who of [a, b]) {
    assert.equal(readChild(who.id).friends[0].status, "declined");
    assert.equal((await who.browser.call("GET", "/api/state")).body.friends.length, 0);
    assert.equal(readChild(who.id).notifications.at(-1).text, "Your friend request didn't go through.");
  }
  await request(a, b);
  assert.equal(readChild(a.id).friends.at(-1).status, "pending_parent_a");
});

test("G3.3 friend views expose first name, current bear and postcard counts, never money or private identity", async () => {
  const a = await family("a"), b = await family("Ben Jones");
  await friends(a, b);
  mutateChild(b.id, (d) => {
    d.child.bear.name = "Pip";
    d.child.bear.privateNote = "secret";
    d.accounts.savings.balance = 123456;
    d.postcards = [{ id: "one", defId: "chicago" }, { id: "two", defId: "chicago" }];
  });
  const f = (await a.browser.call("GET", "/api/state")).body.friends[0];
  assert.equal(f.name, "Ben");
  assert.equal(f.bear.name, "Pip");
  assert.deepEqual(f.postcards, ["chicago", "chicago"]);
  assert.deepEqual(Object.keys(f).sort(), ["bear", "greetings", "id", "name", "postcards", "real", "status"]);
  assert.ok(!JSON.stringify(f).includes("123456"));
  assert.ok(!JSON.stringify(f).includes("Jones"));
  assert.equal(f.bear.privateNote, undefined);
  assert.deepEqual((await a.browser.call("GET", "/api/parent/state")).body.friends, [f]);
  assert.equal((await a.browser.call("GET", "/api/auth/me")).body.children[0].friends[0].name, "Ben");
});

for (const requirements of [[true, true], [true, false], [false, true], [false, false]]) {
  for (const reverse of [false, true]) test(`G3.4 atomic swap with approvals ${requirements}, reverse=${reverse}`, async () => {
    const a = await family("a"), b = await family("b");
    const friendId = await friends(a, b);
    cards(a, b);
    [a, b].forEach((who, i) => mutateChild(who.id, (d) => { d.settings.requireTradeApproval = requirements[i]; }));
    const beforeMoney = [a, b].map((who) => structuredClone(readChild(who.id).accounts));
    const tradeId = await offer(a, friendId);
    for (const who of [a, b]) assert.equal(readChild(who.id).postcards[0].lockedForTrade, tradeId);
    assert.equal(pending(a, "trade"), undefined, "parents are asked after recipient accepts");
    const kidB = await pair(b.browser, b.id);
    const events = [];
    const off = [a, b].map((who) => subscribe(who.familyId, (version, childId) => {
      events.push(childId);
      const disk = JSON.parse(database().prepare("SELECT doc FROM children WHERE id = ?").get(childId).doc);
      assert.equal(disk.version, version);
    }));
    assert.equal((await kidB.call("POST", `/api/child/trade/${tradeId}/respond`, { approve: true })).status, 200);
    const parents = [a, b].filter((_, i) => requirements[i]);
    if (reverse) parents.reverse();
    for (const who of parents) await parentYes(who, "trade");
    [a, b].forEach((who, i) => {
      const d = readChild(who.id);
      assert.equal(d.trades[0].status, "done");
      assert.equal(d.postcards[0].defId, ["seattle", "chicago"][i]);
      assert.equal(d.postcards[0].source, "trade");
      assert.equal(d.postcards[0].lockedForTrade, undefined);
      assert.deepEqual(d.accounts, beforeMoney[i]);
      assert.ok(d.audit.some((r) => r.action === "trade_done"));
      assert.ok(events.includes(who.id));
      assert.deepEqual(JSON.parse(database().prepare("SELECT doc FROM children WHERE id = ?").get(who.id).doc), d);
    });
    off.forEach((fn) => fn());
    const view = (await a.browser.call("GET", "/api/state")).body.trades[0];
    assert.equal(view.peerId, undefined);
    assert.equal(view.cardId, undefined);
  });
}

test("G3.4 mutateChildren rolls back both held documents, versions, SQLite writes and events on throw or async", async () => {
  const a = await family("a"), b = await family("b");
  const docs = [readChild(a.id), readChild(b.id)], before = structuredClone(docs);
  let events = 0;
  const off = [a, b].map((who) => subscribe(who.familyId, () => { events++; }));
  assert.throws(() => mutateChildren([a.id, b.id], ([one, two]) => {
    one.child.points = 999;
    two.child.points = 999;
    throw new Error("abort both");
  }), /abort both/);
  assert.throws(() => mutateChildren([a.id, b.id], async ([one]) => { one.child.points = 888; }), /synchronous/);
  docs.forEach((d, i) => {
    assert.deepEqual(d, before[i]);
    assert.deepEqual(JSON.parse(database().prepare("SELECT doc FROM children WHERE id = ?").get([a.id, b.id][i]).doc), before[i]);
  });
  assert.equal(events, 0);
  off.forEach((fn) => fn());
});

test("G3.4 final trade failure rolls back both parents' decisions and both inventories", async () => {
  const a = await family("a"), b = await family("b");
  const friendId = await friends(a, b);
  cards(a, b);
  const tradeId = await offer(a, friendId);
  await b.browser.call("POST", `/api/child/trade/${tradeId}/respond`, { approve: true });
  await parentYes(a, "trade");
  mutateChild(b.id, (d) => { d.postcards[0].id = "broken-reference"; });
  const before = [a, b].map((who) => structuredClone(readChild(who.id)));
  const failed = await b.browser.call("POST", `/api/parent/approval/${pending(b, "trade").id}`, { approve: true });
  assert.equal(failed.status, 400);
  [a, b].forEach((who, i) => assert.deepEqual(readChild(who.id), before[i]));
});

for (const step of ["kid", "parent", "expiry", "readExpiry", "unfriend"]) test(`G3.4 locks release on ${step}`, async () => {
  const a = await family("a"), b = await family("b");
  const friendId = await friends(a, b);
  cards(a, b);
  const now = Date.now();
  const tradeId = await offer(a, friendId, now);
  assert.equal((await a.browser.call("POST", "/api/child/trade", { friendId, give: "chicago", get: "seattle" })).status, 400);
  if (step === "kid") await b.browser.call("POST", `/api/child/trade/${tradeId}/respond`, { approve: false });
  if (step === "parent") {
    await b.browser.call("POST", `/api/child/trade/${tradeId}/respond`, { approve: true });
    await parentYes(b, "trade", false);
  }
  if (step === "expiry") tick(now + 7 * 86400000);
  if (step === "readExpiry") await b.browser.call("GET", "/api/state", undefined, { now: now + 7 * 86400000 });
  if (step === "unfriend") await b.browser.call("POST", `/api/parent/friend/${friendId}/remove`, {});
  for (const who of [a, b]) {
    assert.equal(readChild(who.id).postcards[0].lockedForTrade, undefined);
    assert.notEqual(readChild(who.id).trades[0].status, "pending");
    assert.equal(pending(who, "trade"), undefined);
  }
});

test("G3.4 secret cards cannot enter either side of a swap", async () => {
  const a = await family("a"), b = await family("b");
  const friendId = await friends(a, b);
  cards(a, b);
  for (const who of [a, b]) mutateChild(who.id, (d) => d.postcards.push({ id: `secret-${who.id}`, defId: "hawaii_volcanoes_national_park" }));
  for (const [give, get] of [["hawaii_volcanoes_national_park", "seattle"], ["chicago", "hawaii_volcanoes_national_park"]]) {
    assert.equal((await a.browser.call("POST", "/api/child/trade", { friendId, give, get })).status, 400);
  }
  assert.ok(readChild(a.id).postcards.every((c) => !c.lockedForTrade));
});

test("G3.5 greetings deliver only presets, share a 20/day window, recover, and stop after unfriend", async () => {
  const a = await family("a"), b = await family("b");
  const friendId = await friends(a, b);
  const now = Date.now();
  for (let i = 0; i < 20; i++) {
    const sender = i % 2 ? a : b;
    const result = await sender.browser.call("POST", "/api/child/greet", { friendId, index: 0, text: "injected message" }, { now });
    assert.equal(result.status, 200);
  }
  assert.equal(readChild(b.id).notifications.at(-1).text, "a: Great job saving!");
  assert.equal((await a.browser.call("POST", "/api/child/greet", { friendId, index: 0 }, { now })).status, 429);
  assert.equal((await b.browser.call("POST", "/api/child/greet", { friendId, index: 0 }, { now: now + 86400000 })).status, 200);
  for (const index of [-1, 5, 0.5, null]) assert.equal((await a.browser.call("POST", "/api/child/greet", { friendId, index })).status, 400);
  assert.equal((await b.browser.call("POST", `/api/parent/friend/${friendId}/remove`, {})).status, 200);
  assert.equal((await a.browser.call("POST", "/api/child/greet", { friendId, index: 0 })).status, 404);
  assert.equal((await a.browser.call("POST", "/api/child/trade", { friendId, give: "chicago", get: "seattle" })).status, 404);
});

test("G3.6 social changes wake both family SSE streams after durable commit", async () => {
  const a = await family("a"), b = await family("b"), outsider = await family("c");
  const streams = await Promise.all([a, b, outsider].map((who) => who.browser.call("GET", "/api/stream")));
  const before = streams.map((s) => s.res.chunks.length);
  await request(a, b);
  assert.equal(streams[0].res.chunks.length, before[0] + 1);
  assert.equal(streams[1].res.chunks.length, before[1] + 1);
  assert.equal(streams[2].res.chunks.length, before[2]);
  streams.forEach((s) => s.req.emit("close"));
});

test("G3.8 foreign social IDs return 404, kid sessions cannot perform any parent step", async () => {
  const a = await family("a"), b = await family("b"), c = await family("c");
  const friendId = await request(a, b);
  const approvalId = pending(a, "friend_request").id;
  const kidA = await pair(a.browser, a.id);
  assert.equal((await kidA.call("POST", `/api/parent/approval/${approvalId}`, { approve: true })).status, 403);
  assert.equal((await b.browser.call("POST", `/api/parent/approval/${approvalId}`, { approve: true })).status, 404);
  await parentYes(a);
  assert.equal((await kidA.call("POST", `/api/child/friend/${friendId}/respond`, { approve: true })).status, 404);
  await b.browser.call("POST", `/api/child/friend/${friendId}/respond`, { approve: true });
  await parentYes(b);
  cards(a, b);
  const tradeId = await offer(a, friendId);
  for (const [path, body] of [
    [`/api/child/friend/${friendId}/respond`, { approve: true }],
    [`/api/child/trade/${tradeId}/respond`, { approve: true }],
    [`/api/parent/friend/${friendId}/remove`, {}],
    ["/api/child/greet", { friendId, index: 0 }],
    ["/api/child/trade", { friendId, give: "chicago", get: "seattle" }],
  ]) assert.equal((await c.browser.call("POST", path, body)).status, 404, path);
  await b.browser.call("POST", `/api/child/trade/${tradeId}/respond`, { approve: true });
  assert.equal((await kidA.call("POST", `/api/parent/approval/${pending(a, "trade").id}`, { approve: true })).status, 403);
  assert.equal((await kidA.call("POST", `/api/parent/friend/${friendId}/remove`, {})).status, 403);
});

test("G3.7/9 practice friends and simulated coop stay demo-only", async () => {
  process.env.MQ_DEMO = "1";
  process.env.MQ_DATA_DIR = "/private/tmp/g3-no-legacy-input";
  initializeAccounts();
  const demo = device("demo");
  assert.equal((await demo.call("POST", "/api/demo/login")).status, 200);
  assert.equal(readChild(DEMO_CHILD_ID).friends[0].name, "Maya");
  assert.equal(readChild(DEMO_CHILD_ID).friends[1].name, "Leo");
  assert.equal((await demo.call("POST", "/api/child/friend", { code: "SAM-12" })).body.status, "pending_parent");
  assert.equal((await demo.call("POST", "/api/child/friend", { code: "ZOE-88" })).body.name, "Zoe");
  const a = await family("a");
  assert.equal((await a.browser.call("GET", "/api/state")).body.demo, false);
  assert.equal((await a.browser.call("POST", "/api/parent/settings", { coopChallenge: true })).status, 400);
  assert.equal(readChild(a.id).settings.coopChallenge, false);
  assert.equal((await demo.call("POST", "/api/parent/settings", { coopChallenge: true })).status, 200);
  const lesson = LESSONS[0];
  const answers = { lessonId: lesson.id, answers: lesson.questions.map((q) => q.answer) };
  for (const browser of [a.browser, demo]) assert.equal((await browser.call("POST", "/api/child/lesson", answers)).status, 200);
  assert.equal(readChild(a.id).child.coopLearning, undefined);
  assert.equal(readChild(DEMO_CHILD_ID).child.coopLearning, 1);
});

test("G3.4 turning parent approval on while a swap waits cannot bypass that parent", async () => {
  const a = await family("a"), b = await family("b");
  const friendId = await friends(a, b);
  cards(a, b);
  for (const who of [a, b]) mutateChild(who.id, (d) => { d.settings.requireTradeApproval = false; });
  const tradeId = await offer(a, friendId);
  await a.browser.call("POST", "/api/parent/settings", { requireTradeApproval: true });
  await b.browser.call("POST", `/api/child/trade/${tradeId}/respond`, { approve: true });
  assert.equal(readChild(a.id).trades[0].status, "pending");
  assert.ok(pending(a, "trade"));
  assert.equal(pending(b, "trade"), undefined);
  await parentYes(a, "trade");
  assert.equal(readChild(b.id).trades[0].status, "done");
});

test("G3.2 opposite-direction duplicates and retries never expose names or create extra requests", async () => {
  const a = await family("a"), b = await family("b");
  await request(a, b);
  for (const [who, code] of [[a, friendCode(b.id)], [b, friendCode(a.id)], [a, friendCode(a.id)], [a, "UNKNOWN1"]]) {
    assert.deepEqual((await who.browser.call("POST", "/api/child/friend", { code })).body, { ok: true, message: "Request sent" });
  }
  assert.equal(readChild(a.id).friends.length, 1);
  assert.equal(readChild(b.id).friends.length, 1);
});

test("G3.7 old practice friends remain hidden for real families", async () => {
  const a = await family("a");
  mutateChild(a.id, (d) => {
    d.friends.push({ id: "practice", name: "Maya", status: "approved", bear: {}, postcards: [] });
    d.approvals.push({ id: "old-practice", kind: "friend", status: "pending", title: "Maya" });
    d.settings.coopChallenge = true;
  });
  for (const path of ["/api/state", "/api/parent/state"]) {
    const state = (await a.browser.call("GET", path)).body;
    assert.equal(state.friends.length, 0);
    assert.equal(state.settings.coopChallenge, false);
    assert.ok(!JSON.stringify(state.pendingRequests).includes("Maya"));
    assert.ok(!JSON.stringify(state.approvals || []).includes("Maya"));
  }
});

test("G3.4 a second-row SQLite failure rolls back the first row and publishes neither family", async () => {
  const a = await family("a"), b = await family("b");
  const before = [a, b].map((who) => structuredClone(readChild(who.id)));
  let events = 0;
  const off = [a, b].map((who) => subscribe(who.familyId, () => { events++; }));
  // IDs are generated locally, not user input. Fail after the first row's UPDATE.
  database().exec(`CREATE TRIGGER fail_second BEFORE UPDATE ON children WHEN OLD.id = '${b.id}' BEGIN SELECT RAISE(ABORT, 'second row failed'); END`);
  assert.throws(() => mutateChildren([a.id, b.id], (docs) => docs.forEach((d) => { d.child.points = 999; })), /second row failed/);
  [a, b].forEach((who, i) => {
    assert.deepEqual(readChild(who.id), before[i]);
    assert.deepEqual(JSON.parse(database().prepare("SELECT doc FROM children WHERE id = ?").get(who.id).doc), before[i]);
  });
  assert.equal(events, 0);
  off.forEach((fn) => fn());
});
