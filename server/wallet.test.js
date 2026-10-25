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

test("H1.1: seed has three accounts; wallet migration moves positive funds, drops debt and audits once", () => {
  for (const balance of [825, -225, 0]) {
    const db = seed(Date.now()), before = structuredClone(db.accounts);
    assert.deepEqual(Object.keys(db.accounts), ["parent", "savings", "spending"]);
    db.accounts.wallet = { label: "Apple Cash", balance };
    db.transactions.push({ kind: "wallet_in", memo: "Sent via Apple Cash" });
    migrate(db);
    assert.equal(db.accounts.wallet, undefined);
    assert.equal(db.accounts.parent.label, "Funding account");
    assert.equal(db.accounts.parent.balance, before.parent.balance + Math.max(0, balance));
    assert.deepEqual(db.accounts.savings, before.savings);
    assert.deepEqual(db.accounts.spending, before.spending);
    assert.equal(db.transactions.at(-1).memo, "Sent via Apple Cash (before 0.7)");
    if (balance > 0) assert.equal(db.audit.at(-1).detail, "Moved $8.25 of tracked Apple Cash into the funding account");
    if (balance < 0) assert.match(db.audit.at(-1).detail, /Dropped negative.*-\$2.25/);
    const migrated = structuredClone(db);
    migrate(db);
    assert.deepEqual(db, migrated);
  }
});

test("H1.2: Apple Cash posts parent to merchant, conserves money and never overdraws funding", () => {
  const db = seed(Date.now());
  const total = () => Object.values(db.accounts).reduce((sum, a) => sum + a.balance, 0)
    + db.transactions.filter((t) => t.status === "posted" && t.to === "merchant").reduce((sum, t) => sum + t.amount, 0);
  const before = total(), spending = db.accounts.spending.balance;
  db.accounts.parent.balance = 425;
  const fundedTotal = total();
  const txn = spend(db, { external_id: "one" });
  assert.equal(txn.from, "parent");
  assert.equal(txn.to, "merchant");
  assert.equal(txn.kind, "wallet_spend");
  assert.equal(db.accounts.parent.balance, 0);
  assert.equal(db.accounts.spending.balance, spending);
  assert.equal(total(), fundedTotal);
  assert.equal(spend(db, { external_id: "two" }).reason, "funding_short");
  assert.equal(db.accounts.parent.balance, 0);
  assert.equal(db.transactions.filter((t) => t.kind === "wallet_spend").length, 1);
  runGuardian(db);
  assert.equal(db.transactions.find((t) => t.id === txn.id).flagged, undefined);
  assert.ok(before > fundedTotal);
});

test("H1.2: short funding returns 409, saves one pending receipt and notifies once; add then record exactly once", async () => {
  const f = await family(), token = await tokenFor(f);
  await f.parent.call("POST", "/api/parent/funding/add", { amount: 4 });
  const body = { amount: 10, merchant: "shoukun", external_id: "receipt-one" };
  const call = () => f.parent.call("POST", f.route("spend"), body, token);
  for (let i = 0; i < 2; i++) {
    const result = await call();
    assert.equal(result.status, 409);
    assert.deepEqual(result.body, { error: "Your grown-up's funding is short for that. Ask them to add money!", reason: "funding_short", shortBy: 600 });
  }
  const db = readChild(f.id), pending = db.walletPending[0];
  assert.equal(db.walletPending.length, 1);
  assert.equal(db.transactions.filter((t) => t.kind === "wallet_spend").length, 0);
  assert.equal(db.notifications.filter((n) => n.ref === pending.id).length, 1);
  assert.equal(db.notifications.find((n) => n.ref === pending.id).text, "Mia's Apple Cash spent $10.00 at shoukun but funding only has $4.00 — add money, then record it.");
  const route = `/api/parent/wallet/pending/${pending.id}/record`;
  assert.equal((await f.parent.call("POST", route, {})).status, 409);
  await f.parent.call("POST", "/api/parent/funding/add", { amount: 6 });
  const result = await f.parent.call("POST", route, {});
  assert.equal(result.status, 200);
  assert.equal(result.body.duplicate, false);
  assert.equal((await f.parent.call("POST", route, {})).body.duplicate, true);
  assert.equal((await call()).body.id, result.body.id);
  assert.equal(db.accounts.parent.balance, 0);
  assert.equal(db.walletPending.length, 0);
  assert.equal(db.transactions.filter((t) => t.kind === "wallet_spend").length, 1);
});

test("H1.2: pending original payload wins on retry; dismissal is audited and retries do not debit", async () => {
  const f = await family();
  await f.parent.call("POST", f.route("spend"), { amount: 10, merchant: "Books", external_id: "dismiss" });
  const pending = readChild(f.id).walletPending[0];
  assert.equal((await f.parent.call("POST", `/api/parent/wallet/pending/${pending.id}/dismiss`, {})).status, 200);
  await f.parent.call("POST", "/api/parent/funding/add", { amount: 20 });
  assert.equal((await f.parent.call("POST", f.route("spend"), { amount: 1, merchant: "Changed", external_id: "dismiss" })).body.status, "dismissed");
  assert.equal(readChild(f.id).accounts.parent.balance, 2000);
  assert.equal(readChild(f.id).walletPending.length, 0);
  assert.ok(readChild(f.id).audit.some((a) => a.action === "wallet_pending_dismissed"));
  mutateChild(f.id, (db) => { db.accounts.parent.balance = 0; });
  await f.parent.call("POST", f.route("spend"), { amount: 10, merchant: "Original", external_id: "retry" });
  await f.parent.call("POST", "/api/parent/funding/add", { amount: 20 });
  const replay = await f.parent.call("POST", f.route("spend"), { amount: 1, merchant: "Changed", external_id: "retry" });
  assert.equal(replay.body.amount, 1000);
  assert.equal(replay.body.merchant, "Original");
});

test("H1.2: pending queue caps at 20 and evicted external IDs still do not notify twice", () => {
  const db = seed(Date.now()); db.accounts.parent.balance = 0;
  for (let i = 0; i < 25; i++) spend(db, { external_id: `pending-${i}` });
  assert.equal(db.walletPending.length, 20);
  const before = structuredClone(db);
  spend(db, { external_id: "pending-0" });
  assert.deepEqual(db, before);
});

test("H1.2: durable idempotency survives ledger retention without points, audit or balance changes", () => {
  const db = seed(Date.now());
  const first = spend(db, { external_id: "__proto__", at: "2026-10-24T12:30:00-07:00" });
  const before = structuredClone(db);
  assert.equal(spend(db, { external_id: "__proto__" }).duplicate, true);
  assert.deepEqual(db, before);
  const restored = JSON.parse(JSON.stringify(db)); restored.transactions = [];
  const saved = structuredClone(restored);
  assert.equal(spend(restored, { external_id: "__proto__" }).id, first.id);
  assert.deepEqual(restored, saved);
});

test("H1.2/6: G4 limit and unusual notices still fire without holds; G5 budgets seven-day Apple Cash pace", () => {
  const now = Date.now(), db = seed(now);
  db.transactions = []; db.allowance.spendLimit = 500;
  for (let i = 0; i < 3; i++) spend(db, { amount: 100 }, now);
  const approvals = db.approvals.length;
  const txn = spend(db, { amount: 2000 }, now);
  assert.equal(txn.status, "posted");
  assert.equal(txn.overLimit, true); assert.equal(txn.unusual, true);
  assert.equal(db.approvals.length, approvals);
  assert.ok(db.audit.some((a) => a.data.policy === "G4.limit"));
  assert.ok(db.audit.some((a) => a.data.policy === "G4.anomaly"));
  assert.ok(db.notifications.some((n) => /above the \$5.00 purchase limit/.test(n.text)));
  db.accounts.parent.balance = 3000;
  assert.equal(hasDueWork(db, now), false);
  runGuardian(db, now);
  assert.ok(db.audit.some((a) => a.data.policy === "G5"));
  assert.equal(db.allowance.lowFundsWarnedFor, 300);
  runGuardian(db, now + 7 * DAY);
  assert.equal(db.allowance.lowFundsWarnedFor, undefined);
  assert.equal(snapshot(db).apple_cash_note, "Apple Cash money comes from your grown-up's funding");
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

test("H1.1/3/5: views carry funding and timezone totals without a wallet account; send is retired", async () => {
  const now = Date.now(), db = seed(now);
  const txn = spend(db, { amount: 900 }, now);
  for (let i = 0; i < 70; i++) db.transactions.push({ id: `other-${i}`, kind: "spend", status: "posted", from: "spending", to: "merchant", amount: 1 });
  const child = childView(db, now), parent = parentView(db);
  assert.equal(child.balances.parent, 24100); assert.equal(child.balances.wallet, undefined);
  assert.equal(child.walletSpent.today, 900);
  assert.equal(child.walletLastTransaction.id, txn.id);
  assert.ok(!child.transactions.some((t) => t.id === txn.id));
  assert.equal(parent.walletTransactions[0].id, txn.id);
  assert.deepEqual(Object.keys(parent.accounts), ["parent", "savings", "spending"]);
  assert.equal(child.walletReceipts, undefined);
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
  assert.deepEqual((await f.parent.call("GET", f.route("token"))).body, { token: null, id: null, expiresAt: null });
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
  await f.parent.call("POST", "/api/parent/funding/add", { amount: 10 });
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
  assert.equal(readChild(f.id).accounts.parent.balance, 675);
  assert.equal(readChild(other.id).accounts.parent.balance, 0);
  // Parent cookies remain parent sessions after credential-less ping/spend tests.
  assert.equal((await f.parent.call("GET", "/api/auth/me")).body.role, "parent");
  const parentState = await f.parent.call("GET", "/api/parent/state");
  assert.ok(parentState.body.walletLastPing);
  assert.equal(parentState.body.walletTransactions.length, 1);
});

test("H1.7: selected-child funding and external IDs stay isolated", async () => {
  const f = await family();
  const sibling = (await f.parent.call("POST", "/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" })).body.id;
  for (const id of [f.id, sibling]) {
    assert.equal((await f.parent.call("POST", `/api/parent/funding/add?child=${id}`, { amount: 10 })).status, 200);
    assert.equal((await f.parent.call("POST", `/api/child/wallet/spend?child=${id}`, { amount: 1, merchant: "Shop", external_id: "same" })).body.duplicate, false);
    assert.equal(readChild(id).accounts.parent.balance, 900);
  }
  assert.equal((await f.parent.call("POST", "/api/parent/topup", { amount: 10 })).status, 404);
});

test("F2b wallet ping and spend enforce independent 60/hour session limits without mutating rejected requests", async () => {
  const f = await family();
  const token = await tokenFor(f), now = Date.now();
  await f.parent.call("POST", "/api/parent/funding/add", { amount: 10 });
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
  assert.equal(readChild(f.id).accounts.parent.balance, 939);
});

test("F2b wallet quotas isolate paired sessions, sibling shortcuts and parent sessions sharing an IP", async () => {
  const f = await family();
  const token = await tokenFor(f), now = Date.now();
  await f.parent.call("POST", "/api/parent/funding/add", { amount: 10 });
  const link = await f.parent.call("POST", `/api/parent/children/${f.id}/link`, {});
  const kid = browser("wallet");
  assert.equal((await kid.call("POST", "/api/auth/link", { code: link.body.code })).status, 200);
  const sibling = (await f.parent.call("POST", "/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" })).body.id;
  const siblingToken = (await f.parent.call("POST", `/api/child/wallet/token?child=${sibling}`, {})).body.token;
  await f.parent.call("POST", `/api/parent/funding/add?child=${sibling}`, { amount: 10 });
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
    await f.parent.call("POST", "/api/parent/funding/add", { amount: 10 });
    mutateChild(f.id, (db) => spend(db, { external_id: "persistent" }));
    const balance = readChild(f.id).accounts.parent.balance;
    // A legacy session table has no device-kind column. Simulate that schema.
    database().exec("ALTER TABLE sessions DROP COLUMN device_kind");
    closeDatabase();
    _clearStoreForTest();
    _databaseForTest(filename);
    assert.equal(database().prepare("SELECT device_kind FROM sessions WHERE token_hash = ?").get(tokenHash(token)).device_kind, "browser");
    assert.equal((await f.parent.call("POST", f.route("ping"), {}, token)).status, 200);
    const replay = mutateChild(f.id, (db) => spend(db, { external_id: "persistent" }));
    assert.equal(replay.duplicate, true);
    assert.equal(readChild(f.id).accounts.parent.balance, balance);
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("H1.2/7: pending routes require unlocked parent, enforce child/family isolation and preserve receipts on rejection", async () => {
  const f = await family(), other = await family("other");
  const token = await tokenFor(f);
  await f.parent.call("POST", f.route("spend"), { amount: 10, merchant: "Books", external_id: "scoped" }, token);
  const sibling = (await f.parent.call("POST", "/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" })).body.id;
  const pendingId = readChild(f.id).walletPending[0].id;
  for (const action of ["record", "dismiss"]) {
    const path = `/api/parent/wallet/pending/${pendingId}/${action}`;
    assert.equal((await browser("anonymous").call("POST", path, {})).status, 401);
    assert.equal((await f.parent.call("POST", path, {}, token)).status, 403);
    assert.equal((await other.parent.call("POST", `${path}?child=${f.id}`, {})).status, 404);
    assert.equal((await f.parent.call("POST", `${path}?child=${sibling}`, {})).status, 404);
    await f.parent.call("POST", "/api/parent/lock", {});
    assert.equal((await f.parent.call("POST", path, {})).status, 403);
    await f.parent.call("POST", "/api/parent/unlock", { pin: "2468" });
  }
  assert.equal(readChild(f.id).walletPending.length, 1);
  assert.equal(readChild(f.id).accounts.parent.balance, 0);
});

test("H1.1/2: SQLite read persists legacy migration once and pending receipts survive reopen with idempotency", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mq-h1-")), filename = path.join(dir, "state.sqlite");
  try {
    _databaseForTest(filename);
    const f = await family();
    const legacy = structuredClone(readChild(f.id));
    legacy.accounts.wallet = { id: "old-wallet", label: "Apple Cash", balance: 400 };
    delete legacy.walletPending;
    database().prepare("UPDATE children SET doc = ? WHERE id = ?").run(JSON.stringify(legacy), f.id);
    _clearStoreForTest();
    assert.equal(readChild(f.id).accounts.parent.balance, 400);
    const persisted = JSON.parse(database().prepare("SELECT doc FROM children WHERE id = ?").get(f.id).doc);
    assert.equal(persisted.accounts.wallet, undefined);
    assert.equal(persisted.audit.filter((a) => a.action === "wallet_migrated").length, 1);
    const body = { amount: 10, merchant: "Books", external_id: "restart" };
    assert.equal((await f.parent.call("POST", f.route("spend"), body)).status, 409);
    const pendingId = readChild(f.id).walletPending[0].id;
    closeDatabase(); _clearStoreForTest(); _databaseForTest(filename);
    assert.equal(readChild(f.id).accounts.parent.balance, 400);
    assert.equal(readChild(f.id).audit.filter((a) => a.action === "wallet_migrated").length, 1);
    assert.equal(readChild(f.id).walletPending[0].id, pendingId);
    assert.equal((await f.parent.call("POST", f.route("spend"), body)).status, 409);
    assert.equal(readChild(f.id).notifications.filter((n) => n.ref === pendingId).length, 1);
    await f.parent.call("POST", "/api/parent/funding/add", { amount: 6 });
    const posted = await f.parent.call("POST", f.route("spend"), body);
    assert.equal(posted.status, 200);
    assert.equal((await f.parent.call("POST", `/api/parent/wallet/pending/${pendingId}/record`, {})).body.id, posted.body.id);
    assert.equal(readChild(f.id).accounts.parent.balance, 0);
  } finally {
    cancelReplan(); closeDatabase(); _clearStoreForTest(); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("H1.5/6: Apple Cash totals use family dates and purchase time, and G5 ignores old/future/reversed spending", () => {
  const now = Date.parse("2026-11-02T08:30:00Z"), db = seed(now);
  db.settings.timezone = "America/Los_Angeles";
  db.transactions = [];
  spend(db, { amount: 100, at: "2026-11-01T23:30:00-08:00" }, now);
  const latest = spend(db, { amount: 200, at: "2026-11-02T00:10:00-08:00" }, now);
  spend(db, { amount: 300, at: "2026-10-31T12:00:00-07:00" }, now);
  assert.deepEqual(childView(db, now).walletSpent, { today: 200, week: 200, month: 300 });
  assert.equal(childView(db, now).walletLastTransaction.id, latest.id, "a late arrival is not the latest purchase");
  assert.deepEqual(parentView(db, undefined, now).walletSpent, { today: 200, week: 200, month: 300 });
  for (const [ts, status] of [[now - 7 * DAY, "posted"], [now + DAY, "posted"], [now, "reversed"]]) db.transactions.push({ kind: "wallet_spend", ts, status, amount: 10000 });
  db.accounts.parent.balance = 1600;
  runGuardian(db, now);
  assert.equal(db.allowance.lowFundsWarnedAt, undefined, "funding covers allowance plus only the valid seven-day pace");
  db.accounts.parent.balance = 1599;
  runGuardian(db, now);
  assert.equal(db.allowance.lowFundsWarnedFor, 1);
});
