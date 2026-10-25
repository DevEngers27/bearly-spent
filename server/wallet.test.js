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
import { spendPolicy, runGuardian } from "./guardian.js";
import { childView, parentView, dispatch } from "./index.js";
import { cancelReplan } from "./buddy.js";
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

test("F2 wallet migration adds a zero Apple Cash account once and leaves existing balances untouched", () => {
  const db = seed(Date.now());
  assert.equal(db.accounts.wallet.balance, 0);
  delete db.accounts.wallet;
  const before = structuredClone(db.accounts);
  migrate(db);
  const account = db.accounts.wallet;
  assert.equal(account.label, "Apple Cash");
  assert.equal(account.balance, 0);
  account.balance = -200;
  migrate(db);
  assert.equal(db.accounts.wallet, account);
  for (const key of ["parent", "savings", "spending"]) assert.deepEqual(db.accounts[key], before[key]);
});

test("F2b parent send credits outside money without changing zero funding and notifies the child", () => {
  const db = seed(Date.now());
  db.accounts.parent.balance = 0;
  const before = structuredClone(db.accounts);
  const txn = parentWalletSend(db, { amount: 1000, note: " Lunch money " });
  assert.equal(txn.kind, "wallet_in");
  assert.equal(txn.memo, "Sent via Apple Cash");
  assert.equal(txn.note, "Lunch money");
  assert.equal(txn.from, "outside");
  assert.equal(txn.to, "wallet");
  assert.equal(db.accounts.wallet.balance, 1000);
  assert.deepEqual(db.accounts.parent, before.parent);
  assert.deepEqual(db.accounts.savings, before.savings);
  assert.deepEqual(db.accounts.spending, before.spending);
  assert.ok(db.notifications.some((n) => n.to === "child" && /sent \$10.00 via Apple Cash/.test(n.text)));
  runGuardian(db);
  assert.ok(!txn.flagged, "parent-authorized outside transfer is not a G3 finding");
});

test("F2b ledger conserves funding plus savings plus spending plus wallet plus merchant outflows minus outside inflows", () => {
  const db = seed(Date.now());
  const total = () => Object.values(db.accounts).reduce((sum, account) => sum + account.balance, 0)
    + db.transactions.filter((t) => t.status === "posted" && t.to === "merchant").reduce((sum, t) => sum + t.amount, 0)
    - db.transactions.filter((t) => t.status === "posted" && t.from === "outside").reduce((sum, t) => sum + t.amount, 0);
  const before = total(), funding = db.accounts.parent.balance;
  parentWalletSend(db, { amount: 200 });
  assert.equal(total(), before);
  const purchase = spend(db, { external_id: "conserved" });
  assert.equal(purchase.uncovered, true);
  assert.equal(total(), before);
  parentWalletSend(db, { amount: 500 });
  assert.equal(total(), before);
  assert.equal(spend(db, { external_id: "conserved" }).duplicate, true);
  actions.save(db, { amount: 1 });
  actions.spend(db, { amount: 1, memo: "Book" });
  runGuardian(db);
  assert.equal(total(), before);
  assert.equal(db.accounts.parent.balance, funding);
  assert.equal(db.accounts.wallet.balance, 275);
  assert.equal(purchase.uncovered, true);
});

test("F2 idempotent posting keeps balance, points, notices and audit unchanged on retries", () => {
  const db = seed(Date.now());
  const first = spend(db, { external_id: "__proto__", at: "2026-10-24T12:30:00-07:00" });
  const before = structuredClone(db);
  const retry = spend(db, { external_id: "__proto__", at: "2026-10-24T12:30:00-07:00" });
  assert.equal(first.duplicate, false);
  assert.equal(retry.id, first.id);
  assert.equal(retry.duplicate, true);
  assert.equal(first.ts, Date.parse("2026-10-24T12:30:00-07:00"));
  assert.deepEqual(db, before);
  // Simulate rolling transaction retention and document serialization/reload.
  const restored = JSON.parse(JSON.stringify(db));
  restored.transactions = [];
  const restoredBefore = structuredClone(restored);
  assert.equal(spend(restored, { external_id: "__proto__" }).id, first.id);
  assert.deepEqual(restored, restoredBefore);
});

test("F2 uncovered purchases post and flag the parent's shortfall; later sends reconcile the wallet", () => {
  const db = seed(Date.now());
  parentWalletSend(db, { amount: 200 });
  const txn = spend(db, {});
  assert.equal(txn.uncovered, true);
  assert.equal(txn.status, "posted");
  assert.equal(db.accounts.wallet.balance, -225);
  assert.ok(db.notifications.some((n) => n.to === "parent" && n.text === "Mia's Apple Cash shows $2.25 more spent than was sent — did you send money outside MoneyQuest?"));
  parentWalletSend(db, { amount: 500 });
  assert.equal(db.accounts.wallet.balance, 275);
  assert.equal(spend(db, { amount: 200 }).uncovered, false);
  assert.equal(txn.uncovered, true, "historical uncovered flag stays on the original record");
});

test("F2 limit notice and G4 anomaly apply to already-paid wallet spends without approval holds", () => {
  const db = seed(Date.now());
  db.transactions = [];
  db.allowance.spendLimit = 500;
  for (let i = 0; i < 3; i++) spend(db, { amount: 100 });
  const before = db.approvals.length;
  const txn = spend(db, { amount: 2000 });
  assert.equal(txn.status, "posted");
  assert.equal(db.accounts.wallet.balance, -2300);
  assert.equal(db.approvals.length, before);
  assert.ok(db.audit.some((a) => a.data.policy === "G4.limit" && a.action === "wallet_limit_notice"));
  assert.ok(db.audit.some((a) => a.data.policy === "G4.anomaly"));
  assert.ok(db.notifications.some((n) => /above the \$5.00 purchase limit/.test(n.text)));
  db.accounts.spending.balance = 3000;
  assert.equal(actions.spend(db, { amount: 20, memo: "Regular purchase" }).held, true, "ordinary purchases still require approval");
});

test("F2 wallet actions reject malformed money, dates, IDs and notes without partial mutations", () => {
  const db = seed(Date.now());
  const before = structuredClone(db);
  const badSpends = [null, [], { amount: 0 }, { amount: -1 }, { amount: Infinity }, { amount: true }, { amount: 10001 }, { merchant: null }, { merchant: "" }, { merchant: "x".repeat(121) }, { at: null }, { at: [] }, { at: "tomorrow" }, { at: "2026-10-24" }, { at: NaN }, { at: -1 }, { external_id: null }, { external_id: {} }, { external_id: "" }, { external_id: "x".repeat(65) }];
  for (const fields of badSpends) {
    const body = fields === null || Array.isArray(fields) ? fields : { amount: 4.25, merchant: "Shop", ...fields };
    assert.throws(() => actions.walletSpend(db, body), is400);
    assert.deepEqual(db, before);
  }
  for (const body of [null, [], { amount: 0 }, { amount: true }, { amount: "NaN" }, { amount: 10001 }, { amount: 1, note: null }, { amount: 1, note: "x".repeat(121) }]) {
    assert.throws(() => actions.walletSend(db, body), is400);
    assert.deepEqual(db, before);
  }
  assert.equal(actions.walletSpend(db, { amount: "1.23", merchant: " Shop ", at: 1234567890000 }).amount, 123);
});

test("F2 views expose the wallet balance and last transaction independently of the recent general ledger", () => {
  const db = seed(Date.now());
  const txn = parentWalletSend(db, { amount: 900 });
  for (let i = 0; i < 70; i++) db.transactions.push({ id: `other-${i}`, kind: "spend", status: "posted", from: "spending", to: "merchant", amount: 1 });
  const child = childView(db), parent = parentView(db);
  assert.equal(child.balances.wallet, 900);
  assert.equal(child.walletLastTransaction.id, txn.id);
  assert.ok(!child.transactions.some((t) => t.id === txn.id));
  assert.equal(parent.walletTransactions[0].id, txn.id);
  assert.equal(parent.accounts.wallet.label, "Apple Cash");
  assert.equal(child.walletReceipts, undefined);
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
  assert.equal(readChild(f.id).accounts.wallet.balance, -325);
  assert.equal(readChild(other.id).accounts.wallet.balance, 0);
  // Parent cookies remain parent sessions after credential-less ping/spend tests.
  assert.equal((await f.parent.call("GET", "/api/auth/me")).body.role, "parent");
  const parentState = await f.parent.call("GET", "/api/parent/state");
  assert.ok(parentState.body.walletLastPing);
  assert.equal(parentState.body.walletTransactions.length, 1);
});

test("F2 parent sends use selected-child scope without demo gating; same external IDs are independent per child", async () => {
  const f = await family();
  const sibling = (await f.parent.call("POST", "/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" })).body.id;
  assert.equal(readChild(sibling).accounts.wallet.label, "Apple Cash");
  assert.equal((await f.parent.call("POST", `/api/parent/wallet/send?child=${sibling}`, { amount: 10, note: "Lunch" })).status, 200);
  assert.equal(readChild(sibling).accounts.wallet.balance, 1000);
  assert.equal(readChild(sibling).accounts.parent.balance, 0);
  assert.equal(readChild(f.id).accounts.wallet.balance, 0);
  for (const id of [f.id, sibling]) assert.equal((await f.parent.call("POST", `/api/child/wallet/spend?child=${id}`, { amount: 1, merchant: "Shop", external_id: "same" })).body.duplicate, false);
  assert.equal(readChild(f.id).accounts.wallet.balance, -100);
  assert.equal(readChild(sibling).accounts.wallet.balance, 900);
  assert.equal((await f.parent.call("POST", "/api/parent/topup", { amount: 10 })).status, 404, "tracking doesn't grant real families demo funding controls");
});

test("F2b wallet ping and spend enforce independent 60/hour session limits without mutating rejected requests", async () => {
  const f = await family();
  const token = await tokenFor(f), now = Date.now();
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
  assert.equal(readChild(f.id).accounts.wallet.balance, -61);
});

test("F2b wallet quotas isolate paired sessions, sibling shortcuts and parent sessions sharing an IP", async () => {
  const f = await family();
  const token = await tokenFor(f), now = Date.now();
  const link = await f.parent.call("POST", `/api/parent/children/${f.id}/link`, {});
  const kid = browser("wallet");
  assert.equal((await kid.call("POST", "/api/auth/link", { code: link.body.code })).status, 200);
  const sibling = (await f.parent.call("POST", "/api/parent/children", { name: "Leo", age: 8, bearName: "Pip" })).body.id;
  const siblingToken = (await f.parent.call("POST", `/api/child/wallet/token?child=${sibling}`, {})).body.token;
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
    mutateChild(f.id, (db) => spend(db, { external_id: "persistent" }));
    const balance = readChild(f.id).accounts.wallet.balance;
    // A legacy session table has no device-kind column. Simulate that schema.
    database().exec("ALTER TABLE sessions DROP COLUMN device_kind");
    closeDatabase();
    _clearStoreForTest();
    _databaseForTest(filename);
    assert.equal(database().prepare("SELECT device_kind FROM sessions WHERE token_hash = ?").get(tokenHash(token)).device_kind, "browser");
    assert.equal((await f.parent.call("POST", f.route("ping"), {}, token)).status, 200);
    const replay = mutateChild(f.id, (db) => spend(db, { external_id: "persistent" }));
    assert.equal(replay.duplicate, true);
    assert.equal(readChild(f.id).accounts.wallet.balance, balance);
  } finally {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
