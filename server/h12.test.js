import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { seed, migrate, readChild, mutateChild, _clearStoreForTest } from "./store.js";
import { _databaseForTest, closeDatabase } from "./db.js";
import { actions } from "./actions.js";
import { GameError, childSpend, childWalletSpend } from "./domain.js";
import { spendPolicy, runGuardian, hasDueWork } from "./guardian.js";
import { dispatch, parentView, childView } from "./index.js";
import { snapshot, cancelReplan } from "./buddy.js";
import { _clearLimitsForTest, HOUR } from "./limits.js";

beforeEach(() => { cancelReplan(); _clearLimitsForTest(); _clearStoreForTest(); _databaseForTest(); });
after(() => { cancelReplan(); closeDatabase(); });
function device(ip = "h12") {
  let cookie = "";
  return { async call(url, body, now = Date.now(), method = "POST") {
    const parsed = new URL(url, "https://local");
    const req = { headers: { cookie }, body, ip, query: Object.fromEntries(parsed.searchParams) };
    const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(v) { this.statusCode = v; return this; }, json(v) { this.body = v; return this; } };
    await dispatch(method, parsed.pathname, req, res, now);
    if (res.headers["Set-Cookie"]) cookie = res.headers["Set-Cookie"].split(";")[0];
    return { status: res.statusCode, body: res.body, headers: res.headers };
  } };
}
async function family() {
  const parent = device();
  const result = await parent.call("/api/auth/register", { email: "h12@example.test", password: "h12-parent-password", parentName: "Jordan", childName: "Mia", childAge: 9, bearName: "Maple" });
  assert.equal(result.status, 200);
  const id = result.body.activeChild.id, kid = device("kid");
  const link = await parent.call(`/api/parent/children/${id}/link`, {});
  await kid.call("/api/auth/link", { code: link.body.code });
  return { parent, kid, id };
}

test("H12.2 Savings spend returns covered zero and debits Savings only", () => {
  const db = seed(), before = structuredClone(db.accounts);
  const out = childWalletSpend(db, { amount: 425, merchant: "Books", external_id: "receipt" }, spendPolicy);
  assert.equal(out.from, "savings"); assert.equal(out.to, "merchant"); assert.equal(out.covered, 0); assert.equal(out.recorded, true);
  assert.equal(db.accounts.savings.balance, before.savings.balance - 425); assert.equal(db.accounts.spending.balance, before.spending.balance);
});

test("H12.2 auto-cover precedes purchase, combines G4 notices and retries without side effects", async () => {
  const { kid, id } = await family();
  mutateChild(id, (db) => { db.allowance.spendLimit = 100; });
  const body = { amount: 20, merchant: "Books", external_id: "cover" };
  const out = await kid.call("/api/child/wallet/spend", body);
  assert.equal(out.status, 200); assert.equal(out.body.covered, 2000); assert.equal(out.body.overLimit, true);
  const db = readChild(id), before = structuredClone(db);
  assert.deepEqual(db.transactions.map((t) => [t.kind, t.from, t.to, t.amount]), [["received", "external", "savings", 2000], ["wallet_spend", "savings", "merchant", 2000]]);
  assert.equal(db.accounts.savings.balance, 0);
  const notices = db.notifications.filter((n) => n.to === "parent");
  assert.equal(notices.length, 1); assert.match(notices[0].text, /Added \$20.00.*Books.*above.*purchase limit/);
  assert.equal((await kid.call("/api/child/wallet/spend", body)).status, 200);
  assert.deepEqual(db.transactions, before.transactions); assert.deepEqual(db.notifications, before.notifications); assert.equal(db.child.points, before.child.points);
});

test("H12.3 kid Received credits Savings, preserves note and notifies parent once", async () => {
  const { kid, id } = await family(), clientId = randomUUID(), body = { amount: 20, note: "  Birthday  ", clientId };
  const result = await kid.call("/api/child/money/received", body);
  assert.equal(result.status, 200); assert.equal(result.body.source, "kid_form"); assert.equal(result.body.idempotencyKey, clientId);
  const db = readChild(id); assert.equal(db.accounts.savings.balance, 2000); assert.equal(db.transactions[0].note, "Birthday");
  assert.equal(db.notifications.filter((n) => n.to === "parent" && n.text === "Mia recorded $20.00 received from you · Birthday").length, 1);
  const before = structuredClone(db);
  assert.equal((await kid.call("/api/child/money/received", body)).body.duplicate, true);
  assert.deepEqual(db.transactions, before.transactions); assert.deepEqual(db.notifications, before.notifications); assert.equal(db.child.points, before.child.points);
});

test("H12.3 Received validation returns GameError 400 without mutation", () => {
  const db = seed(), base = { amount: 20, clientId: randomUUID() };
  for (const body of [null, [], {}, { ...base, amount: 0 }, { ...base, amount: 500.01 }, { ...base, note: "x".repeat(61) }, { ...base, note: null }, { ...base, clientId: [] }]) {
    const before = structuredClone(db);
    assert.throws(() => actions.received(db, body), (e) => e instanceof GameError && e.status === 400);
    assert.deepEqual(db, before);
  }
});

test("H12.4 Send money credits Savings and notifies kid once with stable clientId", async () => {
  const { parent, id } = await family(), body = { amount: 20, clientId: randomUUID() };
  const out = await parent.call("/api/parent/money/send", body); assert.equal(out.status, 200); assert.equal(out.body.source, "parent");
  assert.equal(readChild(id).accounts.savings.balance, 2000);
  assert.equal(readChild(id).notifications.filter((n) => n.text === "Your grown-up sent you $20.00!").length, 1);
  const before = structuredClone(readChild(id));
  assert.equal((await parent.call("/api/parent/money/send", body)).body.id, out.body.id);
  assert.deepEqual(readChild(id).transactions, before.transactions); assert.deepEqual(readChild(id).notifications, before.notifications);
});

test("H12 retries of both manual spend sources and held spends preserve one receipt", () => {
  for (const appleCash of [true, false]) {
    const db = seed(), clientId = randomUUID(), fn = appleCash ? childWalletSpend : childSpend;
    const input = { amount: 100, merchant: "Books", memo: "Books", clientId };
    fn(db, input, spendPolicy); const before = structuredClone(db);
    assert.equal(fn(db, input, spendPolicy).duplicate, true); assert.deepEqual(db, before);
    assert.equal(db.transactions.at(-1).idempotencyKey, clientId);
  }
  const db = seed(), clientId = randomUUID(), input = { amount: 2500, memo: "Bike", clientId };
  db.accounts.spending.balance = 3000;
  assert.equal(actions.spend(db, { ...input, amount: 25 }).held, true);
  const a = db.approvals.find((a) => a.kind === "spend"); a.status = "approved"; runGuardian(db);
  assert.equal(db.transactions.at(-1).idempotencyKey, clientId);
  const count = db.approvals.length; assert.equal(childSpend(db, input, spendPolicy).held, true); assert.equal(db.approvals.length, count);
});

test("H12 durable manual receipts survive rolling transaction retention", () => {
  for (const source of ["received", "sendMoney", "spend"]) {
    const db = seed(), clientId = randomUUID(), body = { amount: 1, clientId, memo: "Book" };
    actions[source](db, body); db.transactions = [];
    const before = structuredClone(db); assert.equal(actions[source](db, body).duplicate, true); assert.deepEqual(db, before);
  }
});

test("H12.1 migration posts multiple waiting receipts with one notice each and preserves history", () => {
  const db = seed(), old = { id: "old", kind: "wallet_spend", from: "parent", to: "merchant", amount: 100, memo: "Original label", status: "posted", ts: Date.now() - 1000 };
  db.transactions.push(old); db.accounts.parent = { balance: 400 }; db.accounts.savings.balance = 0;
  db.walletPending = [300, 500].map((amount, i) => ({ id: `pending-${i}`, amount, merchant: "Shop", ts: Date.now(), idempotencyKey: `wallet:old-${i}`, status: "waiting" }));
  const originalNotices = db.notifications.filter((n) => n.to === "parent").length;
  migrate(db);
  assert.equal(db.accounts.savings.balance, 0); assert.equal(db.accounts.parent, undefined); assert.equal(db.walletPending, undefined); assert.equal(db.moneyVersion, 9);
  assert.equal(db.transactions.filter((t) => t.source === "auto_cover")[0].amount, 400);
  assert.equal(db.notifications.filter((n) => n.to === "parent").length, originalNotices + 2);
  assert.deepEqual(db.transactions.find((t) => t.id === "old"), old);
  const before = structuredClone(db); migrate(db); assert.deepEqual(db, before);
});

test("H12.1/6 fresh views and snapshot expose no parent account or Apple Cash pot", () => {
  const db = seed();
  for (const view of [childView(db), parentView(db)]) {
    assert.doesNotMatch(JSON.stringify(view.balances), /parent|wallet/);
    if (view.accounts) assert.doesNotMatch(JSON.stringify(view.accounts), /parent|wallet/);
    assert.equal(view.walletPending, undefined);
  }
  const snap = snapshot(db); assert.equal(snap.apple_cash_money, undefined); assert.equal(snap.apple_cash_waiting, undefined);
  assert.equal(snap.apple_cash_note, "Apple Cash purchases come out of your savings; money you receive goes into savings");
});

test("H12.5 allowance split credits directly on schedule and hasDueWork settles", () => {
  const now = Date.now(), db = seed(now), before = structuredClone(db.accounts);
  db.allowance.nextRun = now; db.allowance.savePct = 37;
  assert.equal(hasDueWork(db, now), true); runGuardian(db, now);
  assert.equal(db.accounts.savings.balance, before.savings.balance + 370); assert.equal(db.accounts.spending.balance, before.spending.balance + 630);
  assert.equal(hasDueWork(db, now), false); assert.ok(!db.audit.some((a) => ["allowance_blocked", "low_funds_warning"].includes(a.action)));
});

test("H12.6 Received this month uses family calendar and posted received credits only", () => {
  const now = Date.parse("2026-11-01T07:30:00Z"), db = seed(now); db.settings.timezone = "America/Los_Angeles";
  db.transactions = [];
  actions.sendMoney(db, { amount: 20, clientId: randomUUID() }, now);
  actions.received(db, { amount: 10, clientId: randomUUID() }, now - 2 * HOUR);
  actions.received(db, { amount: 30, clientId: randomUUID() }, now + HOUR);
  const reversed = actions.received(db, { amount: 40, clientId: randomUUID() }, now); db.transactions.find((t) => t.id === reversed.id).status = "reversed";
  assert.equal(parentView(db, undefined, now).receivedThisMonth, 2000);
});

test("H12.7 new money routes rate-limit per child/session before rejected mutations", async () => {
  const { parent, kid, id } = await family(), now = Date.now(), clientId = randomUUID();
  const body = { amount: 1, clientId };
  for (let i = 0; i < 60; i++) assert.equal((await kid.call("/api/child/money/received", body, now)).status, 200);
  const before = structuredClone(readChild(id));
  const result = await kid.call("/api/child/money/received", body, now + 1000);
  assert.equal(result.status, 429); assert.equal(result.headers["Retry-After"], "3599"); assert.deepEqual(readChild(id), before);
  assert.equal((await parent.call("/api/parent/money/send", { ...body, clientId: randomUUID() }, now)).status, 200);
  assert.equal((await kid.call("/api/child/money/received", body, now + HOUR)).status, 200);
});

test("H12.1 migration also posts durable waiting receipts evicted from the old queue", () => {
  const db = seed(); db.accounts.savings.balance = 0;
  db.walletPending = [];
  db.walletReceipts = { "wallet:evicted": { id: "evicted", ts: Date.now(), amount: 100, merchant: "Shop", status: "waiting", idempotencyKey: "wallet:evicted", external_id: "evicted" } };
  migrate(db);
  assert.equal(db.transactions.at(-1).kind, "wallet_spend"); assert.equal(db.transactions.at(-1).amount, 100);
  assert.equal(db.accounts.savings.balance, 0); assert.equal(db.walletReceipts["wallet:evicted"].status, "posted");
  const before = structuredClone(db);
  assert.equal(childWalletSpend(db, { amount: 200, merchant: "Changed", external_id: "evicted" }, spendPolicy).amount, 100);
  assert.deepEqual(db, before);
});

test("H12.1 funded legacy receipt combines G4 with its one migration notice", () => {
  const db = seed(), now = Date.now(); db.notifications = []; db.accounts.savings.balance = 10000; db.allowance.spendLimit = 100;
  db.walletPending = [{ id: "funded", ts: now, amount: 2500, merchant: "Books", status: "waiting", idempotencyKey: "wallet:funded" }];
  const points = db.child.points; migrate(db);
  const notices = db.notifications.filter((n) => n.to === "parent");
  assert.equal(notices.length, 1); assert.match(notices[0].text, /Recorded Mia's Apple Cash purchase.*from Savings.*above.*purchase limit/);
  assert.equal(db.child.points, points, "migration is not a child tracking action");
});

test("H12.1 legacy funding deposits remain legitimate history after funding is removed", () => {
  const db = seed(), now = Date.now(); db.accounts.parent = { balance: 500 };
  const deposit = { id: "deposit", ts: now, from: "external", to: "parent", kind: "funding_in", amount: 500, memo: "Original deposit", status: "posted", idempotencyKey: null };
  db.transactions.push(deposit); migrate(db); runGuardian(db, now);
  assert.equal(deposit.flagged, undefined); assert.equal(db.approvals.filter((a) => a.kind === "review").length, 0);
  assert.equal(deposit.memo, "Original deposit"); assert.equal(db.accounts.savings.balance, 2500);
});

test("H12.7 child Received is scoped to its own child and validates at the HTTP boundary", async () => {
  const { parent, kid, id } = await family();
  const sibling = (await parent.call("/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" })).body.id;
  const body = { amount: 20, clientId: randomUUID() }, before = structuredClone(readChild(id));
  assert.equal((await kid.call(`/api/child/money/received?child=${sibling}`, body)).status, 404);
  assert.equal((await kid.call("/api/child/money/received", { ...body, amount: 501 })).status, 400);
  assert.deepEqual(readChild(id), before); assert.equal(readChild(sibling).accounts.savings.balance, 0);
});
