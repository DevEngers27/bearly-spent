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

const receiptId = "11111111-1111-4111-8111-111111111111";

test("H12: Send money records cents, note, history and child notice once", async () => {
  const { parent, id } = await family();
  const body = { amount: "25.50", note: "  Birthday envelope  ", clientId: receiptId };
  const result = await parent.call("POST", "/api/parent/money/send", body);
  assert.equal(result.status, 200); assert.equal(result.body.source, "parent");
  const db = readChild(id); assert.equal(db.accounts.savings.balance, 2550);
  assert.equal(db.transactions[0].note, "Birthday envelope");
  assert.equal(childView(db).transactions[0].memo, "Received from your grown-up");
  assert.equal(parentView(db).receivedThisMonth, 2550);
  assert.equal(db.notifications.filter((n) => n.to === "child" && n.text === "Your grown-up sent you $25.50!").length, 1);
  const txns = structuredClone(db.transactions), notices = db.notifications.length;
  assert.equal((await parent.call("POST", "/api/parent/money/send", body)).body.duplicate, true);
  assert.deepEqual(db.transactions, txns); assert.equal(db.notifications.length, notices);
});

test("H12: Send money requires parent PIN unlock and isolates selected children and families", async () => {
  const { parent, id } = await family(), body = { amount: 50, clientId: receiptId };
  const sibling = (await parent.call("POST", "/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" })).body;
  const link = await parent.call("POST", `/api/parent/children/${id}/link`, {}), kid = device("kid");
  await kid.call("POST", "/api/auth/link", { code: link.body.code });
  assert.equal((await device("anonymous").call("POST", "/api/parent/money/send", body)).status, 401);
  assert.equal((await kid.call("POST", "/api/parent/money/send", body)).status, 403);
  await parent.call("POST", "/api/parent/pin", { pin: "5678" }); await parent.call("POST", "/api/parent/lock", {});
  assert.equal((await parent.call("POST", "/api/parent/money/send", body)).status, 403);
  await parent.call("POST", "/api/parent/unlock", { pin: "5678" });
  assert.equal((await parent.call("POST", `/api/parent/money/send?child=${sibling.id}`, body)).status, 200);
  assert.equal(readChild(id).accounts.savings.balance, 0); assert.equal(readChild(sibling.id).accounts.savings.balance, 5000);
  const outsider = device("outsider"); await outsider.call("POST", "/api/auth/register", { ...form, email: "outsider@example.test" });
  assert.equal((await outsider.call("POST", `/api/parent/money/send?child=${id}`, body)).status, 404);
});

test("H12: received/send validate amount, optional 60-character note and clientId before mutation", () => {
  const invalid = [null, [], {}, { amount: 0 }, { amount: -1 }, { amount: 500.001 }, { amount: Infinity }, { amount: null }, { amount: true }, { amount: [] }, { amount: {} }, { amount: "" }, { note: null }, { note: 42 }, { note: "x".repeat(61) }, { clientId: undefined }, { clientId: "oops" }];
  for (const action of [actions.received, actions.sendMoney]) for (const fields of invalid) {
    const db = seed(), before = structuredClone(db);
    assert.throws(() => action(db, fields === null || Array.isArray(fields) || !Object.keys(fields).length ? fields : { amount: 20, clientId: receiptId, ...fields }), (e) => e instanceof GameError && e.status === 400);
    assert.deepEqual(db, before);
  }
  for (const amount of [0.01, 500]) {
    const db = seed(); assert.equal(actions.sendMoney(db, { amount, clientId: receiptId, note: "x".repeat(60) }).amount, amount * 100);
  }
});

test("H12: allowance and approved rewards pay once without funding while child shortages still wait", () => {
  const now = Date.now(), db = seed(now); db.accounts.spending.balance = 0; db.allowance.nextRun = now;
  for (const kind of ["reward", "extra", "spend"]) db.approvals.push({ id: kind, kind, status: "approved", amount: kind === "spend" ? 50000 : 500, title: kind, memo: "Book", reason: "Helping" });
  runGuardian(db, now);
  for (const kind of ["reward", "extra"]) assert.ok(db.approvals.find((a) => a.id === kind).paidTxnId);
  assert.equal(db.approvals.find((a) => a.id === "spend").paidTxnId, undefined);
  assert.ok(db.approvals.some((a) => a.kind === "child_funds")); assert.ok(!db.approvals.some((a) => a.kind === "topup"));
  assert.ok(!db.audit.some((a) => ["allowance_blocked", "low_funds_warning"].includes(a.action)));
  const txns = structuredClone(db.transactions); runGuardian(db, now); assert.deepEqual(db.transactions, txns);
});

test("H12: legacy funding routes return 410 for real and demo families without money changes", async () => {
  const { parent, id } = await family();
  for (const path of ["funding/add", "topup", "wallet/send", "wallet/pending/old/record", "wallet/pending/old/dismiss"]) {
    const before = structuredClone(readChild(id));
    assert.equal((await parent.call("POST", `/api/parent/${path}`, { amount: 20 })).status, 410);
    assert.deepEqual(readChild(id), before);
  }
  process.env.MQ_DEMO = "1"; initializeAccounts(); const demo = device("demo"); await demo.call("POST", "/api/demo/login", {});
  assert.equal((await demo.call("POST", "/api/parent/topup", { amount: 50 })).status, 410);
});

test("H12: automatic Apple Cash cover and scheduled allowance are independent credits", async () => {
  const { parent, id } = await family(), now = Date.now();
  mutateChild(id, (db) => { db.allowance.amount = 1000; db.allowance.nextRun = now; });
  const receipt = { amount: 10, merchant: "Bookshop", external_id: "own-money" };
  const result = await parent.call("POST", "/api/child/wallet/spend", receipt);
  assert.equal(result.status, 200); assert.equal(result.body.covered, 1000);
  assert.equal(readChild(id).accounts.savings.balance, 500); assert.equal(readChild(id).accounts.spending.balance, 500);
  const txns = structuredClone(readChild(id).transactions);
  assert.equal((await parent.call("POST", "/api/child/wallet/spend", receipt)).body.duplicate, true);
  assert.deepEqual(readChild(id).transactions, txns);
});
