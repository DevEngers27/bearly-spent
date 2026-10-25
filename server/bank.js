// Simulated bank ledger with idempotent transfers, plus an optional mirror to
// Capital One's Nessie sandbox when NESSIE_API_KEY is set. No real money moves.
import { uid } from "./store.js";

const NESSIE_BASE = process.env.NESSIE_BASE_URL || "https://api.nessieisreal.com";

export class BankError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Post a transfer inside `db`. `to: "merchant"` represents spending outside the
 * family. Idempotency: a key that has already posted returns the existing
 * transaction instead of moving money twice.
 */
export function transfer(db, { from, to, amount, kind, memo, idempotencyKey, ts = Date.now() }) {
  if (!Number.isInteger(amount) || amount <= 0) throw new BankError("bad_amount", "Amount must be a positive number of cents");
  if (idempotencyKey) {
    const existing = db.transactions.find((t) => t.idempotencyKey === idempotencyKey && t.status === "posted");
    if (existing) return { txn: existing, duplicate: true };
  }
  const src = db.accounts[from];
  if (!src) throw new BankError("bad_account", `Unknown account ${from}`);
  if (src.balance < amount) throw new BankError("insufficient_funds", `${src.label} has insufficient funds`);
  const dst = to === "merchant" ? null : db.accounts[to];
  if (to !== "merchant" && !dst) throw new BankError("bad_account", `Unknown account ${to}`);

  src.balance -= amount;
  if (dst) dst.balance += amount;
  const txn = { id: uid("txn"), ts, from, to, amount, kind, memo, idempotencyKey: idempotencyKey || null, status: "posted" };
  db.transactions.push(txn);
  nessieMirror(db, txn);
  return { txn, duplicate: false };
}

/** Reverse a posted transaction (used by the guardian to undo duplicates). */
export function reverse(db, txnId, reason) {
  const t = db.transactions.find((x) => x.id === txnId);
  if (!t || t.status !== "posted") throw new BankError("bad_txn", "Transaction not reversible");
  if (t.to !== "merchant") {
    const dst = db.accounts[t.to];
    if (dst.balance < t.amount) throw new BankError("insufficient_funds", "Not enough left to reverse");
    dst.balance -= t.amount;
  }
  db.accounts[t.from].balance += t.amount;
  t.status = "reversed";
  t.reversedReason = reason;
  return t;
}

// ---------------------------------------------------------------- Nessie mirror
// Best effort and asynchronous: the local ledger stays the source of truth for
// the demo, and Nessie failures are surfaced in the audit log, never thrown.
const nessieAccounts = new WeakMap();
let auditHook = () => {};
export function setNessieAuditHook(fn) {
  auditHook = fn;
}
export function nessieEnabled() {
  if (!process.env.NESSIE_API_KEY) return false;
  if (new URL(NESSIE_BASE).protocol !== "https:" && process.env.NESSIE_ALLOW_HTTP !== "1") {
    throw new Error("Nessie requires HTTPS (or NESSIE_ALLOW_HTTP=1 for local development)");
  }
  return true;
}

async function nessie(pathname, body) {
  const url = `${NESSIE_BASE}${pathname}${pathname.includes("?") ? "&" : "?"}key=${process.env.NESSIE_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Nessie ${res.status}: ${json.message || res.statusText}`);
  return json.objectCreated || json;
}

async function ensureNessieAccounts(db) {
  if (nessieAccounts.has(db)) return nessieAccounts.get(db);
  const pending = createNessieAccounts(db);
  nessieAccounts.set(db, pending);
  try { return await pending; } catch (e) { nessieAccounts.delete(db); throw e; }
}

async function createNessieAccounts(db) {
  if (db.nessie?.accounts) return db.nessie.accounts;
  const address = { street_number: "1", street_name: "Lyon St", city: "San Francisco", state: "CA", zip: "94123" };
  const parent = await nessie("/customers", { first_name: db.family.parentName, last_name: "Family", address });
  const child = await nessie("/customers", { first_name: db.child.name, last_name: "Family", address });
  const mk = (cust, nickname, type, balance) =>
    nessie(`/customers/${cust._id}/accounts`, { type, nickname, rewards: 0, balance: Math.round(balance / 100) });
  const accts = {
    parent: (await mk(parent, "Parent funding", "Checking", db.accounts.parent.balance))._id,
    savings: (await mk(child, "Kid savings", "Savings", db.accounts.savings.balance))._id,
    spending: (await mk(child, "Kid spending", "Checking", db.accounts.spending.balance))._id,
  };
  db.nessie = { accounts: accts };
  return accts;
}

function nessieMirror(db, txn) {
  if (!nessieEnabled()) return;
  (async () => {
    const accts = await ensureNessieAccounts(db);
    const date = new Date(txn.ts).toISOString().slice(0, 10);
    const amount = txn.amount / 100;
    if (txn.to === "merchant") {
      await nessie(`/accounts/${accts[txn.from]}/withdrawals`, { medium: "balance", transaction_date: date, amount, description: txn.memo });
    } else {
      await nessie(`/accounts/${accts[txn.from]}/transfers`, {
        medium: "balance", payee_id: accts[txn.to], amount, transaction_date: date, description: txn.memo,
      });
    }
    auditHook("nessie_mirrored", `Mirrored ${txn.kind} of $${amount.toFixed(2)} to Nessie sandbox`, { txnId: txn.id }, db);
  })().catch((e) => auditHook("nessie_error", `Nessie mirror failed (local ledger unaffected): ${e.message}`, { txnId: txn.id }, db));
}
