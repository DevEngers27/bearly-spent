import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "./store.js";
import { transfer, setNessieAuditHook } from "./bank.js";

// The mirror is fire-and-forget; wait until the audit hook reports the outcome.
function mirrored(db, run) {
  return new Promise((resolve, reject) => {
    setNessieAuditHook((kind, detail) => kind === "nessie_mirrored" ? resolve(detail) : reject(new Error(detail)));
    run();
  });
}

function stubNessie(calls) {
  globalThis.fetch = async (url, init) => {
    const u = new URL(url), body = JSON.parse(init.body);
    calls.push({ path: u.pathname, key: u.searchParams.get("key"), body });
    const id = `id_${calls.length}`;
    return new Response(JSON.stringify({ objectCreated: { _id: id } }), { status: 201 });
  };
}

test("Nessie mirror speaks the current sandbox schema: completed whole-dollar records, deposit on the destination", async () => {
  const realFetch = globalThis.fetch, calls = [];
  process.env.NESSIE_API_KEY = "test-key";
  try {
    stubNessie(calls);
    const db = seed(Date.now());
    await mirrored(db, () => transfer(db, { from: "external", to: "savings", amount: 275, kind: "allowance", memo: "Allowance", idempotencyKey: "n1", ts: Date.UTC(2026, 9, 25) }));
    assert.ok(calls.every((c) => c.key === "test-key"));
    assert.equal(calls[0].path, "/customers");
    assert.equal(calls.filter((c) => c.path.endsWith("/accounts")).length, 2);
    const dep = calls.at(-1);
    assert.match(dep.path, /\/accounts\/id_\d+\/deposits$/);
    assert.deepEqual(dep.body, { medium: "balance", transaction_date: "2026-10-25", status: "completed", amount: 3, description: "Allowance ($2.75 from Your grown-up)" });
    assert.ok(!calls.some((c) => c.path.endsWith("/transfers")), "external credits have no funding-account withdrawal");

    const before = calls.length;
    await mirrored(db, () => transfer(db, { from: "spending", to: "merchant", amount: 125, kind: "spend", memo: "Stickers", idempotencyKey: "n2", ts: Date.UTC(2026, 9, 25) }));
    assert.equal(calls.length, before + 1, "accounts are created once per document");
    assert.match(calls.at(-1).path, /withdrawals$/);
    assert.deepEqual(calls.at(-1).body, { medium: "balance", transaction_date: "2026-10-25", status: "completed", amount: 1, description: "Stickers ($1.25)" });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.NESSIE_API_KEY;
    setNessieAuditHook(() => {});
  }
});

test("Nessie failures never touch the local ledger and surface through the audit hook", async () => {
  const realFetch = globalThis.fetch;
  process.env.NESSIE_API_KEY = "test-key";
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ message: "nope" }), { status: 400 });
    const db = seed(Date.now()), before = db.accounts.savings.balance;
    const outcome = new Promise((resolve) => setNessieAuditHook((kind, detail) => resolve({ kind, detail })));
    transfer(db, { from: "external", to: "savings", amount: 100, kind: "allowance", memo: "x", idempotencyKey: "n3" });
    assert.equal(db.accounts.savings.balance, before + 100);
    const { kind, detail } = await outcome;
    assert.equal(kind, "nessie_error");
    assert.match(detail, /local ledger unaffected.*Nessie 400: nope/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.NESSIE_API_KEY;
    setNessieAuditHook(() => {});
  }
});
