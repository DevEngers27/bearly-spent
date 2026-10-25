import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { _databaseForTest, closeDatabase } from "./db.js";
import { _clearStoreForTest, readChild, mutateChild, friendCode, seed } from "./store.js";
import { dispatch } from "./index.js";
import { _clearLimitsForTest } from "./limits.js";
import { cancelReplan } from "./buddy.js";
import * as game from "./domain.js";

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
test("H4.1 budget validates chosen total, scaled minimums and cents without mutation on failure", () => {
  const db = seed(Date.now());
  const valid = { save: 500, needs: 800, fun: 500, give: 200 };
  for (const [total, allocations] of [
    [0, valid], [99, valid], [20001, valid], [NaN, valid], [Infinity, valid], ["2000", valid], [2000.1, valid],
    [3000, valid], [2000, null], [2000, {}], [2000, { ...valid, save: NaN }],
    [2000, { ...valid, save: -1 }], [2000, { ...valid, save: 500.1 }], [2000, { ...valid, other: 0 }],
    [2000, { save: 399, needs: 800, fun: 601, give: 200 }], [2000, { save: 500, needs: 499, fun: 801, give: 200 }],
  ]) {
    const before = structuredClone(db);
    assert.throws(() => game.completeBudget(db, allocations, undefined, total), (err) => err instanceof game.GameError && err.status === 400);
    assert.deepEqual(db, before);
  }
  const now = Date.now();
  assert.equal(game.completeBudget(db, { save: 25, needs: 40, fun: 25, give: 10 }, now, 100).pointsAwarded, 50);
  assert.equal(db.child.lastBudget.total, 100);
  assert.equal(game.completeBudget(db, { save: 5000, needs: 8000, fun: 5000, give: 2000 }, now, 20000).pointsAwarded, 0);
  assert.deepEqual(db.child.lastBudget, { total: 20000, allocations: { save: 5000, needs: 8000, fun: 5000, give: 2000 }, plannedAt: now });
});

test("H4.1 budget route stores total in SQLite and exposes last plan to parent", async () => {
  const a = await family("Ava");
  const allocations = { save: 3, needs: 5, fun: 3, give: 1.5 };
  const result = await a.browser.call("POST", "/api/child/budget", { allocations, total: 12.5 });
  assert.equal(result.status, 200);
  assert.equal(result.body.pointsAwarded, 50);
  const saved = structuredClone(readChild(a.id).child.lastBudget);
  assert.deepEqual(saved.allocations, { save: 300, needs: 500, fun: 300, give: 150 });
  assert.equal(saved.total, 1250);
  _clearStoreForTest();
  assert.deepEqual(readChild(a.id).child.lastBudget, saved);
  const parent = await a.browser.call("GET", "/api/parent/state");
  assert.deepEqual(parent.body.child.lastBudget, saved);
  for (const total of [0, 0.99, 200.01, "oops", null, [], {}]) {
    assert.equal((await a.browser.call("POST", "/api/child/budget", { allocations, total })).status, 400);
    assert.deepEqual(readChild(a.id).child.lastBudget, saved);
  }
  assert.equal((await a.browser.call("POST", "/api/child/budget", { allocations, total: 20 })).status, 400);
});

for (const step of ["parentB", "kidB"]) test(`H4.6 ${step} decline notifies requester parent, closes recipient notice and decided row`, async () => {
  const a = await family("Ava"), b = await family("Ben");
  const friendId = await request(a, b);
  await parentYes(a);
  const original = readChild(a.id).approvals.find((r) => r.socialId === friendId);
  assert.equal(original.status, "approved");
  if (step === "parentB") await parentYes(b, "friend_request", false);
  else assert.equal((await b.browser.call("POST", `/api/child/friend/${friendId}/respond`, { approve: false })).status, 200);
  const parent = (await a.browser.call("GET", "/api/parent/state")).body;
  assert.equal(parent.notifications.filter((n) => n.text === "Ben's family said not right now").length, 1);
  assert.equal(parent.approvals.find((r) => r.socialId === friendId).status, "declined");
  assert.equal(readChild(a.id).approvals.find((r) => r.socialId === friendId).status, "approved", "record preserves the parent's own decision");
  assert.equal((await b.browser.call("GET", "/api/state")).body.notifications[0].text, "Request closed");
  assert.equal((await a.browser.call("GET", "/api/state")).body.notifications[0].text, "Your friend request didn't go through.");
});

test("H4.8 profile and public friend metrics match trip places, total places and physical cards", async () => {
  const a = await family("Ava"), b = await family("Ben");
  await friends(a, b);
  mutateChild(b.id, (d) => { d.postcards = [{ id: "trade", defId: "seattle", source: "trade" }]; });
  const own = (await b.browser.call("GET", "/api/state")).body;
  const peer = (await a.browser.call("GET", "/api/state")).body.friends[0];
  assert.deepEqual(own.metrics.postcards, { places: 0, cards: 1, total: 15 });
  assert.deepEqual(own.profile.stats.postcards, { collected: 0, cards: 1, total: 15 });
  assert.deepEqual(peer.metrics, own.metrics);
  assert.equal(peer.balances, undefined);
});
