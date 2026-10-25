import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { _databaseForTest, closeDatabase } from "./db.js";
import { _clearStoreForTest, seed, readChild, mutateChild, DEMO_CHILD_ID } from "./store.js";
import { initializeAccounts } from "./auth.js";
import { actions } from "./actions.js";
import { GameError } from "./domain.js";
import { runGuardian } from "./guardian.js";
import { dispatch, childView, parentView } from "./index.js";
import { _clearLimitsForTest } from "./limits.js";
import { cancelReplan } from "./buddy.js";

const env = Object.fromEntries(["MQ_DEMO", "MQ_DATA_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"].map((key) => [key, process.env[key]]));
const form = { email: "funding@example.test", password: "parent-password", parentName: "Jordan", childName: "Mia", childAge: 9, bearName: "Maple" };
function device(ip = "parent") {
  let cookie = "";
  return {
    async call(method, url, body) {
      const parsed = new URL(url, "http://local");
      const req = {
        headers: { cookie }, body, ip, query: Object.fromEntries(parsed.searchParams),
        get(name) { return this.headers[name.toLowerCase()]; },
      };
      const res = {
        headers: {}, statusCode: 200,
        set(key, value) { if (typeof key === "object") Object.assign(this.headers, key); else this.headers[key] = value; return this; },
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; return this; },
      };
      await dispatch(method, parsed.pathname, req, res);
      if (res.headers["Set-Cookie"]) cookie = res.headers["Set-Cookie"].split(";")[0];
      return { status: res.statusCode, body: res.body };
    },
  };
}
async function family() {
  const parent = device();
  const result = await parent.call("POST", "/api/auth/register", form);
  assert.equal(result.status, 200);
  return { parent, id: result.body.activeChild.id };
}

beforeEach(() => {
  cancelReplan();
  _clearLimitsForTest();
  _clearStoreForTest();
  _databaseForTest();
  for (const key of Object.keys(env)) delete process.env[key];
  process.env.MQ_DATA_DIR = "/private/tmp/mq-w2c-no-legacy";
});
after(() => {
  cancelReplan();
  closeDatabase();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("W2c.1: real-family funding route records cents, a private note and ledger-only audit without a rate limit", async () => {
  const { parent, id } = await family();
  const childNotifications = structuredClone(readChild(id).notifications.filter((n) => n.to === "child"));
  const result = await parent.call("POST", "/api/parent/funding/add", { amount: "25.50", note: "  Birthday envelope  " });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  const db = readChild(id);
  assert.equal(db.accounts.parent.balance, 2550);
  assert.deepEqual(db.transactions.map((t) => [t.from, t.to, t.amount, t.kind, t.memo, t.status]), [["external", "parent", 2550, "funding_in", "Birthday envelope", "posted"]]);
  assert.ok(db.audit.some((a) => a.actor === "parent" && a.detail === "Recorded $25.50 added to Mia's funding — real money stays with you"));
  assert.deepEqual(db.notifications.filter((n) => n.to === "child"), childNotifications);
  assert.equal(childView(db).transactions.length, 0);
  assert.equal(parentView(db).transactions[0].memo, "Birthday envelope");
  for (let i = 0; i < 35; i++) assert.equal((await parent.call("POST", "/api/parent/funding/add", { amount: 1 })).status, 200);
  assert.equal(readChild(id).accounts.parent.balance, 6050);
  assert.equal(readChild(id).transactions.at(-1).memo, "Added by Jordan");
});

test("W2c.1: funding requires a parent and current PIN unlock and isolates the selected child", async () => {
  const { parent, id } = await family();
  const sibling = (await parent.call("POST", "/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" })).body;
  const link = await parent.call("POST", `/api/parent/children/${id}/link`, {});
  const child = device("child");
  assert.equal((await child.call("POST", "/api/auth/link", { code: link.body.code })).status, 200);
  const before = structuredClone(readChild(id));
  assert.equal((await device("anonymous").call("POST", "/api/parent/funding/add", { amount: 50 })).status, 401);
  assert.equal((await child.call("POST", "/api/parent/funding/add", { amount: 50 })).status, 403);
  assert.deepEqual(readChild(id), before);
  assert.equal((await parent.call("POST", "/api/parent/pin", { pin: "5678" })).status, 200);
  assert.equal((await parent.call("POST", "/api/parent/lock", {})).status, 200);
  assert.equal((await parent.call("POST", "/api/parent/funding/add", { amount: 50 })).status, 403);
  assert.equal(readChild(id).accounts.parent.balance, 0);
  assert.equal((await parent.call("POST", "/api/parent/unlock", { pin: "5678" })).status, 200);
  assert.equal((await parent.call("POST", `/api/parent/funding/add?child=${sibling.id}`, { amount: 50 })).status, 200);
  assert.equal(readChild(id).accounts.parent.balance, 0);
  assert.equal(readChild(sibling.id).accounts.parent.balance, 5000);
  const outsider = device("outsider");
  assert.equal((await outsider.call("POST", "/api/auth/register", { ...form, email: "outsider@example.test" })).status, 200);
  assert.equal((await outsider.call("POST", `/api/parent/funding/add?child=${id}`, { amount: 50 })).status, 404);
  assert.equal(readChild(id).accounts.parent.balance, 0);
});

test("W2c.1: funding validates amounts and notes before mutation and accepts both dollar boundaries", async () => {
  const invalid = [
    {}, null, [], { amount: 0 }, { amount: -1 }, { amount: 0.999 }, { amount: 1000.001 },
    ...[null, true, [], {}, "", "oops", "1e309", Infinity, NaN].map((amount) => ({ amount })),
    ...[null, 42, [], {}, "x".repeat(121)].map((note) => ({ amount: 50, note })),
  ];
  const db = seed(Date.now());
  for (const body of invalid) {
    const before = structuredClone(db);
    assert.throws(() => actions.fundingAdd(db, body), (e) => e instanceof GameError && e.status === 400);
    assert.deepEqual(db, before);
  }
  actions.fundingAdd(db, { amount: 1 });
  actions.fundingAdd(db, { amount: "1000", note: "  " });
  actions.fundingAdd(db, { amount: "1.236", note: "x".repeat(120) });
  assert.deepEqual(db.transactions.slice(-3).map((t) => t.amount), [100, 100000, 124]);
  assert.equal(db.transactions.at(-2).memo, `Added by ${db.family.parentName}`);
  const { parent, id } = await family();
  for (const body of invalid) assert.equal((await parent.call("POST", "/api/parent/funding/add", body)).status, 400);
  assert.equal(readChild(id).accounts.parent.balance, 0);
  assert.equal(readChild(id).transactions.length, 0);
});

test("W2c.1/3: Add money clears only parent-funded escalations and Guardian pays blocked allowance and rewards once", () => {
  const now = Date.now(), db = seed(now);
  db.accounts.parent.balance = 0;
  db.accounts.spending.balance = 0;
  db.allowance.nextRun = now;
  for (const kind of ["reward", "extra", "spend"]) db.approvals.push({ id: kind, kind, status: "approved", amount: kind === "spend" ? 50000 : 500, title: kind, memo: "Book", reason: "Helping", createdAt: now });
  runGuardian(db, now);
  const escalations = db.approvals.filter((a) => a.kind === "topup");
  assert.equal(escalations.length, 3);
  assert.ok(escalations.every((a) => /Add money/.test(a.detail)));
  const spend = db.approvals.find((a) => a.id === "spend"), spendEscalatedAt = spend.escalatedAt;
  const childReminder = db.approvals.find((a) => a.kind === "child_funds");
  const childNotifications = structuredClone(db.notifications.filter((n) => n.to === "child"));
  actions.fundingAdd(db, { amount: 50 });
  assert.ok(escalations.every((a) => a.status === "approved"));
  assert.ok(db.notifications.filter((n) => escalations.some((a) => a.id === n.ref)).every((n) => n.read));
  assert.equal(db.approvals.find((a) => a.id === "reward").escalatedAt, undefined);
  assert.equal(db.approvals.find((a) => a.id === "extra").escalatedAt, undefined);
  assert.equal(spend.escalatedAt, spendEscalatedAt);
  assert.equal(childReminder.status, "pending");
  assert.deepEqual(db.notifications.filter((n) => n.to === "child"), childNotifications);
  runGuardian(db, now);
  assert.equal(db.accounts.parent.balance, 3000);
  for (const kind of ["reward", "extra"]) assert.ok(db.approvals.find((a) => a.id === kind).paidTxnId);
  assert.equal(spend.paidTxnId, undefined);
  const txns = structuredClone(db.transactions);
  runGuardian(db, now);
  assert.deepEqual(db.transactions, txns);
  assert.equal(db.transactions.find((t) => t.kind === "funding_in").flagged, undefined);
});

test("W2c.1/5: real-family funding action runs Guardian immediately while demo topup stays demo-only", async () => {
  const { parent, id } = await family();
  const now = Date.now();
  mutateChild(id, (db) => { db.allowance.amount = 1000; db.allowance.nextRun = now; runGuardian(db, now); });
  assert.equal((await parent.call("POST", "/api/parent/funding/add", { amount: 20 })).status, 200);
  assert.equal(readChild(id).accounts.parent.balance, 1000);
  assert.equal(readChild(id).transactions.filter((t) => t.kind === "allowance").reduce((sum, t) => sum + t.amount, 0), 1000);
  for (const demo of ["0", "1"]) {
    process.env.MQ_DEMO = demo;
    assert.equal((await parent.call("POST", "/api/parent/topup", { amount: 50 })).status, 404);
  }
  initializeAccounts();
  const demo = device("demo");
  assert.equal((await demo.call("POST", "/api/demo/login", {})).status, 200);
  const before = readChild(DEMO_CHILD_ID).accounts.parent.balance;
  assert.equal((await demo.call("POST", "/api/parent/topup", { amount: 50 })).status, 200);
  assert.equal(readChild(DEMO_CHILD_ID).accounts.parent.balance, before + 5000);
  assert.equal((await demo.call("POST", "/api/parent/funding/add", { amount: 1 })).status, 200);
  assert.equal(readChild(DEMO_CHILD_ID).transactions.at(-1).kind, "funding_in");
});

test("Apple Cash uses savings while Add money continues funding allowance", async () => {
  const { parent, id } = await family();
  const now = Date.now();
  mutateChild(id, (db) => { db.allowance.amount = 1000; db.allowance.nextRun = now; });
  const receipt = { amount: 10, merchant: "Bookshop", external_id: "separate-pots" };
  assert.equal((await parent.call("POST", "/api/child/wallet/spend", receipt)).status, 409);
  await parent.call("POST", "/api/parent/funding/add", { amount: 15 });
  assert.equal(readChild(id).accounts.parent.balance, 500);
  assert.equal(readChild(id).accounts.savings.balance, 500);
  assert.equal(readChild(id).walletPending.length, 1);
  await parent.call("POST", "/api/child/wallet/receive", { amount: 5, note: "From Dad", request_id: "transfer-1" });
  assert.equal(readChild(id).accounts.savings.balance, 0);
  assert.equal(readChild(id).accounts.parent.balance, 500);
  assert.equal(readChild(id).walletPending.length, 0);
  assert.equal((await parent.call("POST", "/api/child/wallet/spend", receipt)).body.duplicate, true);
});
