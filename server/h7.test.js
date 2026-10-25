import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { _databaseForTest, closeDatabase } from "./db.js";
import { _clearStoreForTest, readChild, mutateChild, friendCode, seed } from "./store.js";
import { dispatch } from "./index.js";
import { _clearLimitsForTest } from "./limits.js";
import { cancelReplan, chat, _internals } from "./buddy.js";
import { actions } from "./actions.js";
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

async function pair(parent, id) {
  const link = await parent.call("POST", `/api/parent/children/${id}/link`, {});
  const kid = device("kid");
  assert.equal((await kid.call("POST", "/api/auth/link", { code: link.body.code })).status, 200);
  return kid;
}

test("H7.1 restore kid and parent routes enforce tenancy, PIN and bought history", async () => {
  const a = await family("Mia"), b = await family("Ben"), kid = await pair(a.browser, a.id);
  const sibling = await a.browser.call("POST", "/api/parent/children", { name: "Sam", age: 8, bearName: "Pip" });
  const created = await kid.call("POST", "/api/child/goals", { title: "Space book", target: 45, icon: "book" });
  const id = created.body.id;
  assert.equal((await kid.call("POST", `/api/child/goals/${id}/archive`, {})).status, 200);
  assert.equal((await kid.call("POST", `/api/child/goals/${id}/restore?child=${sibling.body.id}`, {})).status, 404);
  assert.equal((await b.browser.call("POST", `/api/parent/goals/${id}/restore?child=${a.id}`, {})).status, 404);
  assert.equal((await a.browser.call("POST", `/api/parent/goals/${id}/restore?child=${sibling.body.id}`, {})).status, 400);
  assert.equal((await kid.call("POST", `/api/parent/goals/${id}/restore`, {})).status, 403);
  assert.equal((await kid.call("POST", `/api/child/goals/${id}/restore`, {})).body.status, "active");
  assert.equal(readChild(a.id).child.currentGoalId, "goal_bike");
  assert.ok(readChild(a.id).audit.some((r) => r.actor === "child" && r.detail === "Brought back goal: Space book"));
  await kid.call("POST", `/api/child/goals/${id}/archive`, {});
  await a.browser.call("POST", "/api/parent/pin", { pin: "2468" });
  await a.browser.call("POST", "/api/parent/lock", {});
  assert.equal((await a.browser.call("POST", `/api/parent/goals/${id}/restore`, {})).status, 403);
  await a.browser.call("POST", "/api/parent/unlock", { pin: "2468" });
  assert.equal((await a.browser.call("POST", `/api/parent/goals/${id}/restore`, {})).status, 200);
  assert.ok(readChild(a.id).audit.some((r) => r.actor === "parent" && r.action === "savings_goal_restored"));
  mutateChild(a.id, (d) => { d.savingsGoals.find((g) => g.id === id).status = "bought"; });
  for (const [device, role] of [[kid, "child"], [a.browser, "parent"]]) {
    assert.equal((await device.call("POST", `/api/${role}/goals/${id}/restore`, {})).status, 400);
    assert.equal((await device.call("POST", `/api/${role}/goals/${id}`, { title: "Change memory" })).status, 400);
  }
});

test("H7.1 restoring or editing an archived goal keeps live current or selects it when none", () => {
  for (const edit of [false, true]) for (const hasLive of [false, true]) {
    const d = seed(Date.now());
    const g = actions.goalSave(d, { title: "Stars", target: 80, icon: "book" });
    actions.goalArchive(d, g.id);
    if (!hasLive) actions.goalArchive(d, "goal_bike");
    d.buddy.plan = { summary: "Old plan" };
    if (edit) actions.goalSave(d, { title: "Star book", target: 90, icon: "gift" }, g.id);
    else actions.goalRestore(d, g.id);
    assert.equal(g.status, "active");
    assert.equal(d.child.currentGoalId, hasLive ? "goal_bike" : g.id);
    assert.equal(d.savingsGoals.filter((g) => g.activeFlag).length, 1);
    assert.equal(d.buddy.plan, null);
    assert.ok(d.audit.some((a) => a.action === "savings_goal_restored"));
  }
  const d = seed(Date.now()); actions.goalArchive(d, "goal_bike");
  const before = structuredClone(d);
  assert.throws(() => actions.goalSave(d, { target: 0 }, "goal_bike"), { status: 400 });
  assert.deepEqual(d, before);
});

test("H7.2 budget replan updates saved cents and keeps points and money", async () => {
  const a = await family("Mia"), kid = await pair(a.browser, a.id);
  const plan = { total: 20, allocations: { save: 5, needs: 8, fun: 5, give: 2 } };
  const before = structuredClone(readChild(a.id).accounts);
  const first = await kid.call("POST", "/api/child/budget", plan);
  assert.equal(first.body.pointsAwarded, 50);
  const points = readChild(a.id).child.points;
  const repeat = await kid.call("POST", "/api/child/budget", { total: 30, allocations: { save: 9, needs: 12, fun: 6, give: 3 } });
  assert.equal(repeat.body.pointsAwarded, 0);
  const d = readChild(a.id);
  assert.equal(d.child.points, points);
  assert.deepEqual(d.accounts, before);
  assert.deepEqual(d.child.lastBudget.allocations, { save: 900, needs: 1200, fun: 600, give: 300 });
  const state = (await kid.call("GET", "/api/state")).body;
  assert.equal(state.budgetDoneThisWeek, true);
  assert.equal(state.child.lastBudget.total, 3000);
});

test("H7.3 requester notification and real statuses follow both family approvals", async () => {
  const a = await family("Mia"), b = await family("Ben");
  const valid = await a.browser.call("POST", "/api/child/friend", { code: friendCode(b.id) });
  const invalid = await a.browser.call("POST", "/api/child/friend", { code: "ZZZZZZZZ" });
  assert.deepEqual(valid.body, invalid.body);
  const own = readChild(a.id), recipient = readChild(b.id);
  const approval = own.approvals.find((r) => r.kind === "friend_request");
  assert.equal(approval.detail, "Both grown-ups and the other child need to say yes. Your child’s name stays private until you approve.");
  const notice = own.notifications.find((n) => n.ref === approval.id);
  assert.equal(notice.text, "Mia wants to add a friend — check the request in your Inbox");
  assert.equal(notice.to, "parent");
  assert.equal(recipient.approvals.length, 1);
  assert.doesNotMatch(JSON.stringify((await b.browser.call("GET", "/api/parent/state")).body), /Mia/);
  const waiting = (await a.browser.call("GET", "/api/state")).body.friends[0];
  assert.equal(waiting.status, "pending_parent_a"); assert.equal(waiting.name, undefined);
  const anonymous = (await b.browser.call("GET", "/api/state")).body.friends[0];
  assert.equal(anonymous.name, undefined); assert.equal(anonymous.familyLabel, undefined);
  await a.browser.call("POST", `/api/parent/approval/${approval.id}`, { approve: true });
  assert.equal((await a.browser.call("GET", "/api/state")).body.friends[0].status, "pending_parent_b");
  const incoming = readChild(b.id).friends[0];
  await b.browser.call("POST", `/api/child/friend/${incoming.id}/respond`, { approve: true });
  assert.equal(readChild(a.id).friends[0].status, "pending_parent_b");
  const otherApproval = readChild(b.id).approvals.find((r) => r.kind === "friend_request");
  assert.equal((await b.browser.call("POST", `/api/parent/approval/${otherApproval.id}`, { approve: true })).status, 200);
  assert.equal((await a.browser.call("GET", "/api/state")).body.friends[0].status, "approved");
  assert.equal(readChild(a.id).notifications.find((n) => n.id === notice.id).read, true);
});

function claude(t) {
  const env = Object.fromEntries(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"].map((key) => [key, process.env[key]]));
  process.env.ANTHROPIC_API_KEY = "test-only"; delete process.env.ANTHROPIC_AUTH_TOKEN;
  t.after(() => { for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(_internals, "runGuard", async () => "OK");
}

test("H7.4 Claude retries once after 800 ms and saves only the successful response", async (t) => {
  const a = await family("Mia"); claude(t);
  let calls = 0; const waits = [];
  t.mock.method(_internals, "wait", async (ms) => { waits.push(ms); });
  t.mock.method(_internals, "runClaude", async (messages) => {
    assert.equal(messages.at(-1).content, "What should I do with my allowance?");
    if (++calls === 1) throw new Error("temporary");
    return { reply: "Try saving $3 from your allowance.", toolsUsed: ["get_snapshot"] };
  });
  const result = await chat(a.id, "What should I do with my allowance?");
  assert.equal(calls, 2); assert.deepEqual(waits, [800]);
  assert.equal(result.fallback, undefined);
  assert.equal(result.reply, "Try saving $3 from your allowance.");
  assert.deepEqual(readChild(a.id).buddy.chat.map((m) => m.role), ["user", "assistant"]);
  assert.match(_internals.systemPrompt(readChild(a.id)), /Answer the kid's actual question in your own words using their numbers; do not repeat a fixed template/);
});

test("H7.4 two Claude failures fall back with retry metadata; no-key mode stays offline", async (t) => {
  const a = await family("Mia"); claude(t);
  let calls = 0, waits = 0;
  t.mock.method(_internals, "wait", async (ms) => { assert.equal(ms, 800); waits++; });
  t.mock.method(_internals, "runClaude", async () => { calls++; throw new Error("offline"); });
  const result = await chat(a.id, "Can I buy a $4 toy?");
  assert.equal(calls, 2); assert.equal(waits, 1); assert.equal(result.fallback, true);
  assert.doesNotMatch(result.reply, /having trouble connecting|quick answer/);
  assert.equal(readChild(a.id).buddy.chat.at(-1).fallback, true);
  assert.ok(readChild(a.id).buddy.plan);
  delete process.env.ANTHROPIC_API_KEY;
  const offline = await chat(a.id, "What should I do with my allowance?");
  assert.equal(offline.fallback, undefined); assert.equal(calls, 2); assert.equal(waits, 1);
});

test("H7.4 disabling Buddy during retry wait prevents another call or stale reply", async (t) => {
  const a = await family("Mia"); claude(t);
  let calls = 0;
  t.mock.method(_internals, "runClaude", async () => { calls++; throw new Error("temporary"); });
  t.mock.method(_internals, "wait", async () => { mutateChild(a.id, (d) => { d.settings.buddyEnabled = false; }); });
  const result = await chat(a.id, "When can I reach my goal?");
  assert.equal(calls, 1); assert.match(result.reply, /taking a break/);
  assert.equal(readChild(a.id).buddy.chat.length, 1);
});
