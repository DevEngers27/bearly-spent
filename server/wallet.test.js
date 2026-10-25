import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seed, migrate, readChild, mutateChild, _clearStoreForTest } from "./store.js";
import { database, _databaseForTest, closeDatabase } from "./db.js";
import { authenticate, tokenHash } from "./auth.js";
import { actions } from "./actions.js";
import { GameError, childWalletSpend, parentWalletSend } from "./domain.js";
import { spendPolicy, runGuardian, hasDueWork } from "./guardian.js";
import { childView, parentView, dispatch } from "./index.js";
import { cancelReplan, snapshot } from "./buddy.js";
import { _clearLimitsForTest } from "./limits.js";

const DAY = 86400000;
const spend = (db, fields, now = Date.now()) => childWalletSpend(db, { amount: 425, merchant: "Corner shop", ...fields }, spendPolicy, now);
const is400 = (err) => err instanceof GameError && err.status === 400;
function browser(ip = "wallet-test") {
  let cookie = "";
  return {
    async call(method, url, body, token, now = Date.now()) {
      const parsed = new URL(url, "https://local");
      const req = { body, ip, query: Object.fromEntries(parsed.searchParams), headers: token ? { authorization: `Bearer ${token}` } : { cookie } };
      const res = {
        statusCode: 200, headers: {},
        set(key, value) { if (typeof key === "object") Object.assign(this.headers, key); else this.headers[key] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; },
      };
      await dispatch(method, parsed.pathname, req, res, now);
      // Like the UI's credential-less Bearer test, don't replace parent cookies.
      if (!token && res.headers["Set-Cookie"]) cookie = res.headers["Set-Cookie"].split(";")[0];
      return { status: res.statusCode, body: res.body, headers: res.headers };
    },
  };
}
async function family(name = "wallet") {
  const parent = browser(name);
  const result = await parent.call("POST", "/api/auth/register", {
    email: `${name}@example.test`, password: "wallet-parent-password", parentName: "Jordan", childName: "Mia", childAge: 9, bearName: "Maple",
  });
  assert.equal(result.status, 200);
  const id = result.body.activeChild.id;
  return { parent, id, route: (suffix) => `/api/child/wallet/${suffix}?child=${id}` };
}
async function tokenFor(f) {
  assert.equal((await f.parent.call("POST", "/api/parent/pin", { pin: "2468" })).status, 200);
  const result = await f.parent.call("POST", f.route("token"), {});
  assert.equal(result.status, 200);
  return result.body.token;
}

beforeEach(() => {
  cancelReplan();
  _clearLimitsForTest();
  _clearStoreForTest();
  _databaseForTest();
});
after(() => { cancelReplan(); closeDatabase(); });

test("H12: seed has two accounts and migration audits positive, zero and negative funding once", () => {
  for (const balance of [825, -225, 0]) {
    const db = seed(Date.now());
    assert.deepEqual(Object.keys(db.accounts), ["savings", "spending"]);
    db.accounts.parent = { balance };
    const before = db.accounts.savings.balance;
    migrate(db);
    assert.equal(db.accounts.parent, undefined);
    assert.equal(db.accounts.savings.balance, before + Math.max(0, balance));
    assert.match(db.audit.at(-1).detail, balance > 0 ? /Moved \$8.25 of funding into Savings \(0.9\)/ : /Dropped funding balance/);
    const migrated = structuredClone(db); migrate(db); assert.deepEqual(db, migrated);
  }
});

test("H12: Apple Cash posts Savings to merchant and never overdraws Savings", () => {
  const db = seed(Date.now()), spending = db.accounts.spending.balance;
  db.accounts.savings.balance = 425;
  const txn = spend(db, { external_id: "one" });
  assert.equal(txn.from, "savings"); assert.equal(txn.to, "merchant"); assert.equal(txn.kind, "wallet_spend");
  assert.equal(txn.covered, 0); assert.equal(db.accounts.savings.balance, 0);
  assert.equal(db.accounts.spending.balance, spending);
  const next = spend(db, { external_id: "two" });
  assert.equal(next.covered, 425); assert.equal(db.accounts.savings.balance, 0);
  runGuardian(db); assert.equal(db.transactions.find((t) => t.id === txn.id).flagged, undefined);
});

test("H12: short Savings returns 200, adds exactly the shortfall and notifies once across retries", async () => {
  const f = await family(), token = await tokenFor(f);
  mutateChild(f.id, (db) => { db.accounts.savings.balance = 400; });
  const body = { amount: 10, merchant: "shoukun", external_id: "receipt-one" };
  const call = () => f.parent.call("POST", f.route("spend"), body, token);
  const result = await call(); assert.equal(result.status, 200); assert.equal(result.body.covered, 600); assert.equal(result.body.recorded, true);
  const db = readChild(f.id), before = structuredClone(db.transactions), notices = db.notifications.length;
  assert.equal(db.accounts.savings.balance, 0);
  assert.deepEqual(db.transactions.map((t) => [t.kind, t.amount]), [["received", 600], ["wallet_spend", 1000]]);
  assert.equal(db.transactions[0].source, "auto_cover");
  assert.equal(db.transactions[0].note, "Added to cover an Apple Cash purchase");
  assert.equal(db.notifications.filter((n) => n.to === "parent").length, 1);
  assert.equal(db.notifications.find((n) => n.to === "parent").text, "Added $6.00 to Mia's savings to cover an Apple Cash purchase at shoukun");
  assert.equal((await call()).body.duplicate, true); assert.deepEqual(db.transactions, before); assert.equal(db.notifications.length, notices);
});

test("H12: original external payload wins on retries without duplicate money", () => {
  const db = seed();
  const first = spend(db, { amount: 1000, merchant: "Original", external_id: "one" });
  const before = structuredClone(db);
  const retry = spend(db, { amount: 100, merchant: "Changed", external_id: "one" });
  assert.equal(retry.id, first.id); assert.equal(retry.amount, 1000); assert.equal(retry.merchant, "Original");
  assert.deepEqual(db, before);
});

test("H12: receipt keys survive ledger retention without a second cover or notice", () => {
  const db = seed(); db.accounts.savings.balance = 0;
  const first = spend(db, { external_id: "durable" });
  db.transactions = [];
  const before = structuredClone(db);
  assert.equal(spend(db, { external_id: "durable" }).id, first.id);
  assert.deepEqual(db, before);
});

test("H12: G4 limit and unusual notices still fire without holds and G5 is retired", () => {
  const db = seed();
  for (let i = 0; i < 3; i++) spend(db, { amount: 100 });
  const txn = spend(db, { amount: 2500 });
  assert.equal(txn.overLimit, true); assert.equal(txn.unusual, true); assert.equal(txn.status, "posted");
  assert.ok(db.audit.some((a) => a.action === "wallet_limit_notice"));
  assert.ok(db.audit.some((a) => a.action === "unusual_spend"));
  runGuardian(db); assert.ok(!db.audit.some((a) => a.action === "low_funds_warning"));
  assert.equal(snapshot(db).apple_cash_note, "Apple Cash purchases come out of your savings; money you receive goes into savings");
});

test("H1.2: malformed wallet purchases fail with 400 before any mutation", () => {
  const db = seed(Date.now()), before = structuredClone(db);
  const bad = [null, [], { amount: 0 }, { amount: -1 }, { amount: Infinity }, { amount: true }, { amount: 10001 }, { merchant: null }, { merchant: "" }, { merchant: "x".repeat(121) }, { at: null }, { at: [] }, { at: "tomorrow" }, { at: "2026-10-24" }, { at: NaN }, { at: -1 }, { external_id: null }, { external_id: {} }, { external_id: "" }, { external_id: "x".repeat(65) }];
  for (const fields of bad) {
    assert.throws(() => actions.walletSpend(db, fields === null || Array.isArray(fields) ? fields : { amount: 4.25, merchant: "Shop", ...fields }), is400);
    assert.deepEqual(db, before);
  }
  assert.equal(actions.walletSpend(db, { amount: "1.23", merchant: " Shop ", at: 1234567890000 }).amount, 123);
});

test("H12: views expose only Savings and Spending and keep purchase totals and history", async () => {
  const now = Date.now(), db = seed(now), txn = spend(db, { amount: 900 }, now);
  const child = childView(db, now), parent = parentView(db, undefined, now);
  assert.deepEqual(Object.keys(child.balances), ["savings", "spending"]);
  assert.deepEqual(Object.keys(parent.accounts), ["savings", "spending"]);
  assert.equal(child.walletSpent.today, 900); assert.equal(child.walletLastTransaction.id, txn.id);
  assert.equal(parent.walletTransactions[0].id, txn.id);
  assert.equal(child.walletReceipts, undefined); assert.equal(parent.walletPending, undefined);
  const f = await family(), before = structuredClone(readChild(f.id));
  assert.equal((await f.parent.call("POST", "/api/parent/wallet/send", { amount: 10 })).status, 410);
  assert.deepEqual(readChild(f.id), before);
});

test("F2 token generation requires a configured unlocked parent PIN and GET never issues a token", async () => {
  const f = await family();
  assert.equal((await f.parent.call("GET", f.route("token"))).status, 403);
  assert.equal((await f.parent.call("POST", f.route("token"), {})).status, 403);
  await f.parent.call("POST", "/api/parent/pin", { pin: "2468" });
  const before = database().prepare("SELECT COUNT(*) AS n FROM sessions").get().n;
  assert.deepEqual((await f.parent.call("GET", f.route("token"))).body, { token: null, id: null, expiresAt: null, lastPing: null, connected: false });
  assert.equal(database().prepare("SELECT COUNT(*) AS n FROM sessions").get().n, before);
  await f.parent.call("POST", "/api/parent/lock", {});
  for (const method of ["GET", "POST"]) assert.equal((await f.parent.call(method, f.route("token"), method === "POST" ? {} : undefined)).status, 403);
  assert.equal((await browser().call("GET", f.route("token"))).status, 401);
});

test("F2 token rotation invalidates the old child session and preserves paired browsers and sibling shortcuts", async () => {
  const f = await family();
  const first = await tokenFor(f);
  assert.match(first, /^[\w-]{43}$/);
  const row = database().prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash(first));
  assert.equal(row.role, "child");
  assert.equal(row.child_id, f.id);
  assert.equal(row.device_kind, "shortcut");
  assert.equal(row.expires_at - row.created_at, 180 * DAY);
  assert.ok(!JSON.stringify(row).includes(first));
  const pair = await f.parent.call("POST", `/api/parent/children/${f.id}/link`, {});
  const kid = browser("kid");
  await kid.call("POST", "/api/auth/link", { code: pair.body.code });
  const sibling = (await f.parent.call("POST", "/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" })).body.id;
  const siblingToken = (await f.parent.call("POST", `/api/child/wallet/token?child=${sibling}`, {})).body.token;
  const second = await f.parent.call("POST", f.route("token"), {});
  assert.notEqual(second.body.token, first);
  assert.equal((await f.parent.call("POST", f.route("ping"), {}, first)).status, 401);
  assert.equal((await f.parent.call("POST", f.route("ping"), {}, second.body.token)).status, 200);
  assert.equal((await kid.call("GET", "/api/state")).status, 200);
  assert.equal((await kid.call("POST", `/api/child/wallet/ping?child=${sibling}`, {}, siblingToken)).status, 200);
  const status = await f.parent.call("GET", f.route("token"));
  assert.equal(status.body.token, null);
  assert.equal(status.body.id, second.body.id);
});

test("F2 Shortcut Bearer authentication scopes spends, pings and token access to the correct roles and family", async () => {
  const f = await family(), other = await family("other");
  const token = await tokenFor(f);
  await f.parent.call("POST", "/api/parent/money/send", { amount: 10, clientId: "11111111-1111-4111-8111-111111111111" });
  const before = structuredClone(readChild(f.id));
  assert.equal((await f.parent.call("POST", f.route("ping"), {}, token)).body.childId, f.id);
  assert.deepEqual(readChild(f.id).transactions, before.transactions);
  assert.equal((await f.parent.call("GET", f.route("token"), undefined, token)).status, 403);
  assert.equal((await f.parent.call("POST", f.route("token"), {}, token)).status, 403);
  assert.equal((await f.parent.call("POST", "/api/parent/wallet/send", { amount: 10 }, token)).status, 403);
  assert.equal((await f.parent.call("POST", `/api/child/wallet/ping?child=${other.id}`, {}, token)).status, 404);
  assert.equal((await f.parent.call("POST", `/api/child/wallet/spend?child=${other.id}`, { amount: 1, merchant: "Shop" }, token)).status, 404);
  assert.equal((await f.parent.call("GET", other.route("token"))).status, 404);
  assert.equal((await f.parent.call("POST", other.route("token"), {})).status, 404);
  assert.equal((await f.parent.call("POST", f.route("ping"), null, token)).status, 400);
  assert.equal((await f.parent.call("POST", f.route("spend"), { amount: 3.25, merchant: "Books", external_id: "abc" }, token)).status, 200);
  assert.equal((await f.parent.call("POST", f.route("spend"), { amount: 3.25, merchant: "Books", external_id: "abc" }, token)).body.duplicate, true);
  assert.equal(readChild(f.id).accounts.savings.balance, 675);
  assert.equal(readChild(other.id).accounts.savings.balance, 0);
  // Parent cookies remain parent sessions after credential-less ping/spend tests.
  assert.equal((await f.parent.call("GET", "/api/auth/me")).body.role, "parent");
  const parentState = await f.parent.call("GET", "/api/parent/state");
  assert.ok(parentState.body.walletLastPing);
  assert.equal(parentState.body.walletTransactions.length, 1);
});

test("H1.7: selected-child Savings and external IDs stay isolated", async () => {
  const f = await family();
  const sibling = (await f.parent.call("POST", "/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" })).body.id;
  for (const id of [f.id, sibling]) {
    assert.equal((await f.parent.call("POST", `/api/parent/money/send?child=${id}`, { amount: 10, clientId: "11111111-1111-4111-8111-111111111111" })).status, 200);
    assert.equal((await f.parent.call("POST", `/api/child/wallet/spend?child=${id}`, { amount: 1, merchant: "Shop", external_id: "same" })).body.duplicate, false);
    assert.equal(readChild(id).accounts.savings.balance, 900);
  }
  assert.equal((await f.parent.call("POST", "/api/parent/topup", { amount: 10 })).status, 410);
});

test("F2b wallet ping and spend enforce independent 60/hour session limits without mutating rejected requests", async () => {
  const f = await family();
  const token = await tokenFor(f), now = Date.now();
  await f.parent.call("POST", "/api/parent/money/send", { amount: 10, clientId: "11111111-1111-4111-8111-111111111111" });
  const ping = () => f.parent.call("POST", f.route("ping"), {}, token, now);
  for (let i = 0; i < 60; i++) assert.equal((await ping()).status, 200);
  const afterPings = structuredClone(readChild(f.id));
  const limitedPing = await f.parent.call("POST", f.route("ping"), {}, token, now + 1000);
  assert.equal(limitedPing.status, 429);
  assert.equal(limitedPing.headers["Retry-After"], "3599");
  assert.equal(limitedPing.body.retryAfterSeconds, 3599);
  assert.match(limitedPing.body.error, /little break.*Try again soon/);
  assert.deepEqual(readChild(f.id), afterPings);
  for (let i = 0; i < 60; i++) {
    assert.equal((await f.parent.call("POST", f.route("spend"), { amount: 0.01, merchant: "Shop", external_id: `purchase-${i}` }, token, now)).status, 200);
  }
  const afterSpends = structuredClone(readChild(f.id));
  const body = { amount: 0.01, merchant: "Shop", external_id: "retry-later" };
  const limitedSpend = await f.parent.call("POST", f.route("spend"), body, token, now + 1000);
  assert.equal(limitedSpend.status, 429);
  assert.equal(limitedSpend.headers["Retry-After"], "3599");
  assert.equal(limitedSpend.body.retryAfterSeconds, 3599);
  assert.match(limitedSpend.body.error, /little break.*Try again soon/);
  assert.deepEqual(readChild(f.id), afterSpends);
  assert.equal((await f.parent.call("POST", f.route("spend"), { ...body, external_id: "purchase-0" }, token, now + 1000)).status, 429, "duplicates also count as requests");
  const recoveredAt = now + 60 * 60 * 1000;
  assert.equal((await f.parent.call("POST", f.route("ping"), {}, token, recoveredAt - 1)).status, 429);
  assert.equal((await f.parent.call("POST", f.route("spend"), body, token, recoveredAt - 1)).status, 429);
  assert.equal((await f.parent.call("POST", f.route("ping"), {}, token, recoveredAt)).status, 200);
  const recovered = await f.parent.call("POST", f.route("spend"), body, token, recoveredAt);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.duplicate, false);
  const retry = await f.parent.call("POST", f.route("spend"), body, token, recoveredAt);
  assert.equal(retry.body.id, recovered.body.id);
  assert.equal(retry.body.duplicate, true);
  assert.equal(readChild(f.id).accounts.savings.balance, 939);
});

test("F2b wallet quotas isolate paired sessions, sibling shortcuts and parent sessions sharing an IP", async () => {
  const f = await family();
  const token = await tokenFor(f), now = Date.now();
  await f.parent.call("POST", "/api/parent/money/send", { amount: 10, clientId: "11111111-1111-4111-8111-111111111111" });
  const link = await f.parent.call("POST", `/api/parent/children/${f.id}/link`, {});
  const kid = browser("wallet");
  assert.equal((await kid.call("POST", "/api/auth/link", { code: link.body.code })).status, 200);
  const sibling = (await f.parent.call("POST", "/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" })).body.id;
  const siblingToken = (await f.parent.call("POST", `/api/child/wallet/token?child=${sibling}`, {})).body.token;
  await f.parent.call("POST", `/api/parent/money/send?child=${sibling}`, { amount: 10, clientId: "11111111-1111-4111-8111-111111111111" });
  for (const action of ["ping", "spend"]) {
    const body = action === "ping" ? {} : { amount: 0.01, merchant: "Shop", external_id: "same" };
    for (let i = 0; i < 60; i++) assert.equal((await f.parent.call("POST", f.route(action), body, token, now)).status, 200);
    assert.equal((await f.parent.call("POST", f.route(action), body, token, now)).status, 429);
    assert.equal((await kid.call("POST", f.route(action), body, undefined, now)).status, 200, "paired browser has its own quota");
    assert.equal((await f.parent.call("POST", `/api/child/wallet/${action}?child=${sibling}`, body, siblingToken, now)).status, 200, "sibling Shortcut has its own quota");
    assert.equal((await f.parent.call("POST", f.route(action), body, undefined, now)).status, 200, "parent manual tracking has its own quota");
  }
});

test("F2 Shortcut sessions appear in Devices and unlink or family-wide logout immediately revokes them", async () => {
  const f = await family();
  let token = await tokenFor(f);
  const result = await f.parent.call("GET", `/api/parent/children/${f.id}/devices`);
  const shortcut = result.body.find((d) => d.kind === "shortcut");
  assert.equal(shortcut.name, "Apple Cash Shortcut");
  assert.notEqual(shortcut.id, tokenHash(token));
  assert.ok(!JSON.stringify(result.body).includes(token));
  assert.equal((await f.parent.call("DELETE", `/api/parent/children/${f.id}/devices/${shortcut.id}`)).status, 200);
  assert.equal((await f.parent.call("POST", f.route("ping"), {}, token)).status, 401);
  assert.equal((await f.parent.call("GET", f.route("token"))).body.id, null);
  token = (await f.parent.call("POST", f.route("token"), {})).body.token;
  await f.parent.call("POST", "/api/auth/logout-all", {});
  assert.equal((await f.parent.call("POST", f.route("ping"), {}, token)).status, 401);
});

test("F2 Shortcut sessions keep the fixed child lifetime instead of sliding on use", async () => {
  const f = await family();
  const token = await tokenFor(f);
  const row = database().prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash(token));
  const req = { headers: { authorization: `Bearer ${token}` } };
  assert.equal(authenticate(req, row.expires_at - 1).expires_at, row.expires_at);
  assert.throws(() => authenticate(req, row.expires_at), (err) => err instanceof GameError && err.status === 401);
});

test("F2 existing session databases migrate device kind and wallet receipts persist through SQLite reopen", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mq-wallet-"));
  const filename = path.join(dir, "wallet.sqlite");
  try {
    _databaseForTest(filename);
    const f = await family();
    const token = await tokenFor(f);
    await f.parent.call("POST", "/api/parent/money/send", { amount: 10, clientId: "11111111-1111-4111-8111-111111111111" });
    mutateChild(f.id, (db) => spend(db, { external_id: "persistent" }));
    const balance = readChild(f.id).accounts.savings.balance;
    // A legacy session table has no device-kind column. Simulate that schema.
    database().exec("ALTER TABLE sessions DROP COLUMN device_kind");
    closeDatabase();
    _clearStoreForTest();
    _databaseForTest(filename);
    assert.equal(database().prepare("SELECT device_kind FROM sessions WHERE token_hash = ?").get(tokenHash(token)).device_kind, "browser");
    assert.equal((await f.parent.call("POST", f.route("ping"), {}, token)).status, 200);
    const replay = mutateChild(f.id, (db) => spend(db, { external_id: "persistent" }));
    assert.equal(replay.duplicate, true);
    assert.equal(readChild(f.id).accounts.savings.balance, balance);
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("H12: pending routes retain parent authentication and are gone for authorized parents", async () => {
  const f = await family(), other = await family("other"), token = await tokenFor(f);
  for (const action of ["record", "dismiss"]) {
    const path = `/api/parent/wallet/pending/old-receipt/${action}`;
    assert.equal((await browser("anon").call("POST", path, {})).status, 401);
    assert.equal((await f.parent.call("POST", path, {}, token)).status, 403);
    assert.equal((await other.parent.call("POST", `${path}?child=${f.id}`, {})).status, 404);
    assert.equal((await f.parent.call("POST", path, {})).status, 410);
    await f.parent.call("POST", "/api/parent/lock", {});
    assert.equal((await f.parent.call("POST", path, {})).status, 403);
    await f.parent.call("POST", "/api/parent/unlock", { pin: "2468" });
  }
});

test("H12: SQLite persists funding/pending migration once and receipt retries survive reopen", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mq-h12-")), filename = path.join(dir, "state.sqlite");
  try {
    _databaseForTest(filename);
    const f = await family(), legacy = structuredClone(readChild(f.id));
    legacy.moneyVersion = 7; legacy.accounts.parent = { balance: 400 };
    legacy.walletPending = [{ id: "pending", amount: 1000, merchant: "Books", ts: Date.now(), idempotencyKey: "wallet:restart", external_id: "restart", status: "waiting" }];
    legacy.walletReceipts = { "wallet:restart": legacy.walletPending[0] };
    database().prepare("UPDATE children SET doc = ? WHERE id = ?").run(JSON.stringify(legacy), f.id);
    _clearStoreForTest();
    assert.equal(readChild(f.id).accounts.savings.balance, 0);
    const persisted = JSON.parse(database().prepare("SELECT doc FROM children WHERE id = ?").get(f.id).doc);
    assert.equal(persisted.accounts.parent, undefined); assert.equal(persisted.walletPending, undefined);
    assert.equal(persisted.audit.filter((a) => a.action === "money_migrated").length, 1);
    closeDatabase(); _clearStoreForTest(); _databaseForTest(filename);
    const db = readChild(f.id), before = structuredClone(db.transactions);
    assert.equal(db.audit.filter((a) => a.action === "money_migrated").length, 1);
    const replay = spend(db, { amount: 1000, merchant: "Books", external_id: "restart" });
    assert.equal(replay.duplicate, true); assert.equal(replay.covered, 600);
    assert.deepEqual(db.transactions, before);
  } finally { cancelReplan(); closeDatabase(); _clearStoreForTest(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("H12: Apple Cash totals use family dates and purchase time without G5 warnings", () => {
  const now = Date.parse("2026-11-02T08:30:00Z"), db = seed(now);
  db.settings.timezone = "America/Los_Angeles"; db.transactions = [];
  spend(db, { amount: 100, at: "2026-11-01T23:30:00-08:00" }, now);
  const latest = spend(db, { amount: 200, at: "2026-11-02T00:10:00-08:00" }, now);
  spend(db, { amount: 300, at: "2026-10-31T12:00:00-07:00" }, now);
  assert.deepEqual(childView(db, now).walletSpent, { today: 200, week: 200, month: 300 });
  assert.equal(childView(db, now).walletLastTransaction.id, latest.id);
  assert.deepEqual(parentView(db, undefined, now).walletSpent, { today: 200, week: 200, month: 300 });
  runGuardian(db, now); assert.equal(db.allowance.lowFundsWarnedAt, undefined);
});
