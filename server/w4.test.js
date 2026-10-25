import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { database, _databaseForTest, closeDatabase } from "./db.js";
import { _clearStoreForTest, createChild } from "./store.js";
import * as auth from "./auth.js";
import { dispatch } from "./index.js";
import { _clearLimitsForTest, MINUTE } from "./limits.js";

beforeEach(() => { _clearStoreForTest(); _databaseForTest(); _clearLimitsForTest(); });
after(closeDatabase);

function parent(email, now) {
  const result = auth.register({ email, password: "a-good-password", parentName: "Jordan", childName: "Kai", childAge: 9, bearName: "Bo" }, { now, ip: email });
  const headers = { authorization: `Bearer ${result.token}` };
  const context = auth.resolveContext({ headers }, {}, now);
  return { ...result, headers, context, childId: context.childId };
}

async function get(url, headers, now) {
  const parsed = new URL(url, "http://local");
  const req = Object.assign(new EventEmitter(), { headers, query: Object.fromEntries(parsed.searchParams), ip: "w4", get(name) { return this.headers[name]; } });
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; },
  });
  await dispatch("GET", parsed.pathname, req, res, now);
  return res;
}

test("W4.3: exact-code status distinguishes pending, consumed, expired and replaced codes without mutation", async () => {
  const now = Date.now(), p = parent("parent@example.test", now);
  const link = auth.createLink(p.context, p.childId, now);
  const url = `/api/parent/children/${p.childId}/link?child=${p.childId}&code=${link.code.toLowerCase()}`;
  const original = { ...database().prepare("SELECT * FROM kid_links WHERE code = ?").get(link.code) };
  const pending = await get(url, p.headers, now + 1000);
  assert.equal(pending.statusCode, 200);
  assert.deepEqual(pending.body, { status: "pending" });
  assert.deepEqual({ ...database().prepare("SELECT * FROM kid_links WHERE code = ?").get(link.code) }, original);
  const kid = auth.redeemLink({ code: link.code }, { now: now + 2000, ip: "kid" });
  assert.deepEqual((await get(url, p.headers, now + 3000)).body, { status: "linked" });
  const paired = auth.childDevices(p.context, p.childId, now + 3000)[0];
  auth.unlinkDevice(p.context, p.childId, paired.id);
  assert.deepEqual((await get(url, p.headers, now + 16 * MINUTE)).body, { status: "linked" });
  const expired = auth.createLink(p.context, p.childId, now + 16 * MINUTE);
  assert.deepEqual(auth.linkStatus(p.context, p.childId, expired.code, expired.expiresAt), { status: "expired" });
  const replacement = auth.createLink(p.context, p.childId, now + 17 * MINUTE);
  assert.deepEqual(auth.linkStatus(p.context, p.childId, expired.code, now + 17 * MINUTE), { status: "expired" });
  assert.deepEqual(auth.linkStatus(p.context, p.childId, replacement.code, now + 17 * MINUTE), { status: "pending" });
  assert.ok(kid.token);
});

test("W4.3: kid-code status requires an unlocked parent and scopes both child and code to its family", async () => {
  const now = Date.now(), p = parent("parent@example.test", now), other = parent("other@example.test", now);
  const sibling = createChild(p.context.family.id, { name: "Leo", age: 8, bearName: "Pip" });
  const link = auth.createLink(p.context, p.childId, now);
  const url = `/api/parent/children/${p.childId}/link?child=${p.childId}&code=${link.code}`;
  const kid = auth.redeemLink({ code: link.code }, { now, ip: "kid" });
  assert.equal((await get(url, {}, now)).statusCode, 401);
  assert.equal((await get(url, { authorization: `Bearer ${kid.token}` }, now)).statusCode, 403);
  assert.equal((await get(url, other.headers, now)).statusCode, 404);
  assert.equal((await get(`/api/parent/children/${sibling.id}/link?child=${sibling.id}&code=${link.code}`, p.headers, now)).statusCode, 404);
  assert.equal((await get(url.replace(link.code, "ZZZZZZ"), p.headers, now)).statusCode, 404);
  assert.equal((await get(url.split("&code=")[0], p.headers, now)).statusCode, 400);
  auth.setPin(p.context, { pin: "2468" }, now);
  assert.equal((await get(url, p.headers, now + 15 * MINUTE)).statusCode, 403);
});
