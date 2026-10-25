// Ledger Guardian — the autonomous finance agent.
//
// It runs on a timer and after every state change, and owns every movement of
// (simulated) money that isn't a child moving their own funds:
//   G1  scheduled allowance payouts, split into save/spend
//   G2  paying parent-approved rewards and requests, exactly once
//   G3  reconciling the ledger against obligations (catches double posts)
//   G4  spending policy for child purchases (hold → parent)
//   G5  funding-risk warnings before money runs short
// Its permissions are deliberately narrow: it can only move money that a
// parent schedule or a parent approval authorised, it can only reverse
// postings that exceed an obligation, and anything outside that is escalated.
// Every decision lands in the audit log with the policy that produced it.
import { transfer, reverse, BankError } from "./bank.js";
import { audit, notify, checkMilestones } from "./domain.js";
import { uid } from "./store.js";

const dollars = (c) => `$${(c / 100).toFixed(2)}`;
const DAY = 86400000;

/** Cheap check so the ticker only writes when there's real work. */
export function hasDueWork(db, now = Date.now()) {
  if (now >= db.allowance.nextRun) return true;
  if (db.approvals.some((a) => payoutReady(db, a))) return true;
  return pendingFindings(db).length > 0;
}

function needsPayout(a) {
  return a.kind === "reward" || a.kind === "spend" || a.kind === "extra";
}

/**
 * Obligations: what the ledger *should* contain. Each obligation authorises
 * exactly one posted transaction with a matching `ref`.
 */
function obligations(db) {
  const list = [];
  for (const a of db.approvals) if (a.status === "approved" && needsPayout(a)) list.push({ ref: a.id, amount: a.amount, label: a.title });
  for (const t of db.transactions) if (t.kind === "allowance" && t.ref?.startsWith("allowance:")) list.push({ ref: t.ref, amount: null, label: "allowance", split: true });
  return list;
}

function payoutReady(db, a) {
  if (a.status !== "approved" || !needsPayout(a) || a.paidTxnId) return false;
  const existing = db.transactions.find((t) => t.status === "posted" && t.idempotencyKey === `approval:${a.id}`);
  if (existing) return existing.amount === a.amount;
  return a.escalatedAt == null || db.accounts[a.kind === "spend" ? "spending" : "parent"].balance >= a.amount;
}

function reconcileFindings(db) {
  const findings = [];
  const byRef = new Map();
  const known = new Map(obligations(db).map((o) => [o.ref, o]));
  for (const t of db.transactions) {
    if (t.status !== "posted") continue;
    const ref = t.ref || (t.idempotencyKey?.startsWith("approval:") ? t.idempotencyKey.slice(9) : null);
    if (!ref) {
      if (t.from === "parent" && !t.idempotencyKey) findings.push({ type: "unauthorised", txn: t });
      continue;
    }
    const obligation = known.get(ref);
    if (obligation && obligation.amount !== null && t.amount !== obligation.amount) {
      findings.push({ type: "amount_mismatch", ref, txn: t, expected: obligation.amount });
      continue;
    }
    // Child-originated moves need no parent authorisation.
    if (!obligation && t.from !== "parent" && ["save", "spend", "journal"].includes(t.kind)) continue;
    const key = `${ref}|${t.to}`;
    if (!byRef.has(key)) byRef.set(key, []);
    byRef.get(key).push(t);
  }
  for (const txns of byRef.values()) {
    const ref = txns[0].ref || txns[0].idempotencyKey.slice(9);
    if (txns.length > 1) findings.push({ type: "duplicate", ref, keep: txns[0], extras: txns.slice(1) });
    else if (!known.has(ref) && !ref.startsWith("allowance:")) findings.push({ type: "unauthorised", ref, txn: txns[0] });
  }
  return findings;
}

export function pendingFindings(db) {
  return reconcileFindings(db).flatMap((f) => {
    const pending = (t) => !t.flagged && !t.acknowledged;
    if (f.type !== "duplicate") return pending(f.txn) ? [f] : [];
    const extras = f.extras.filter(pending);
    return extras.length ? [{ ...f, extras }] : [];
  });
}

/** G3 only: repair the ledger before a child action can award milestones. */
export function reconcileNow(db, now = Date.now(), trigger = "reconcile") {
  const actions = [];
  const log = (action, detail, data = {}) => {
    audit(db, "guardian", action, detail, { ...data, policy: "G3", trigger });
    actions.push(detail);
  };
  for (const f of pendingFindings(db)) {
    if (f.type === "duplicate") {
      for (const extra of f.extras) {
        try {
          reverse(db, extra.id, `Duplicate of ${f.keep.id} for obligation ${f.ref}`);
          notify(db, "parent", `Guardian caught a duplicate ${dollars(extra.amount)} posting and reversed it. Your balance is correct.`, "guardian");
          log("duplicate_reversed", `G3: Found ${f.extras.length + 1} postings for one obligation (${f.ref}). Kept ${f.keep.id}, reversed ${extra.id} (${dollars(extra.amount)}). Ledger now matches approvals.`, { ref: f.ref, kept: f.keep.id, reversed: extra.id });
        } catch (e) {
          if (!(e instanceof BankError)) throw e;
          extra.flagged = true;
          escalate(db, "review", `Duplicate posting ${extra.id} (${dollars(extra.amount)}) couldn't be auto-reversed: ${e.message}.`, "Review the transaction history.", { txnId: extra.id }, now);
          log("duplicate_escalated", `G3: Duplicate ${extra.id} could not be reversed safely (${e.message}); escalated to parent.`, { txnId: extra.id });
        }
      }
    } else {
      f.txn.flagged = true;
      const mismatch = f.type === "amount_mismatch";
      escalate(db, "review", mismatch ? `A ${dollars(f.txn.amount)} posting doesn't match its ${dollars(f.expected)} approval.` : `A ${dollars(f.txn.amount)} posting has no matching approval.`, "Confirm it's expected or ask the bank to reverse it.", { txnId: f.txn.id }, now);
      log(mismatch ? "amount_mismatch" : "unauthorised_flagged", mismatch ? `G3: Posting ${f.txn.id} amount ${dollars(f.txn.amount)} differs from obligation ${f.ref} (${dollars(f.expected)}). Flagged for parent review.` : `G3: Posting ${f.txn.id} (${dollars(f.txn.amount)}) has no matching obligation. Flagged for parent review — guardian will not move money it can't justify.`, { txnId: f.txn.id, ref: f.ref });
    }
  }
  return actions;
}

/**
 * Run every policy once. Returns a list of human-readable actions taken (the
 * same text is written to the audit log).
 */
export function runGuardian(db, now = Date.now(), trigger = "tick") {
  const actions = [];
  const log = (action, detail, data = {}) => {
    audit(db, "guardian", action, detail, { ...data, trigger });
    actions.push(detail);
  };

  // G1 — scheduled allowance
  let safety = 0;
  const backPaid = [];
  while (now >= db.allowance.nextRun && safety++ < 4) {
    const period = `allowance:${new Date(db.allowance.nextRun).toISOString().slice(0, 10)}`;
    const { amount, savePct } = db.allowance;
    const save = Math.round((amount * savePct) / 100);
    const spend = amount - save;
    const legs = [
      { to: "savings", amount: save, key: `${period}:save`, memo: `Weekly allowance (${savePct}% saved)` },
      { to: "spending", amount: spend, key: `${period}:spend`, memo: "Weekly allowance (spending)" },
    ].filter((leg) => leg.amount > 0);
    const unpaid = legs.filter((leg) => !db.transactions.some((t) => t.status === "posted" && t.idempotencyKey === leg.key));
    const required = unpaid.reduce((sum, leg) => sum + leg.amount, 0);
    if (db.accounts.parent.balance < required) {
      if (db.allowance.escalatedPeriod !== period) {
        db.allowance.escalatedPeriod = period;
        escalate(db, "topup", `Allowance of ${dollars(amount)} is due but the funding account only has ${dollars(db.accounts.parent.balance)}.`,
          "Top up the funding account; the allowance will pay automatically on the next check.");
        log("allowance_blocked", `G1: Allowance ${period} blocked — insufficient parent funds. Escalated to parent instead of overdrawing.`, { policy: "G1" });
      }
      break;
    }
    const payouts = legs.map((leg) => {
      const result = transfer(db, { from: "parent", to: leg.to, amount: leg.amount, kind: "allowance", memo: leg.memo, idempotencyKey: leg.key, ts: now });
      tagRef(db, leg.key, period);
      return result;
    });
    db.allowance.lastPeriod = period;
    db.allowance.nextRun += db.allowance.cadenceDays * DAY;
    if (payouts.length && payouts.every((p) => p.duplicate)) {
      // Audit only: the server treats payout actions as a reason to replan.
      audit(db, "guardian", "allowance_skipped", `allowance period ${period} already paid; skipped`, { policy: "G1", trigger });
      continue;
    }
    backPaid.push(period.slice(10));
    notify(db, "child", `Allowance arrived! ${dollars(save)} to savings, ${dollars(spend)} to spend.`, "money");
    log("allowance_paid", `G1: Paid allowance ${period}: ${dollars(save)} → savings, ${dollars(spend)} → spending (split per parent rule ${savePct}%).`, { policy: "G1" });
  }

  if (backPaid.length > 1) notify(db, "parent", `Back-paid ${backPaid.length} weeks of allowance (${backPaid[0]} → ${backPaid.at(-1)})`, "guardian");

  // G2 — pay approved obligations exactly once
  for (const a of db.approvals) {
    if (!payoutReady(db, a)) continue;
    const wasEscalated = a.escalatedAt != null;
    delete a.escalatedAt;
    const plan =
      a.kind === "reward" ? { from: "parent", to: db.allowance.rewardDestination, memo: `Reward: ${a.title.replace(/^.*completed /, "")}` } :
      a.kind === "extra" ? { from: "parent", to: "spending", memo: `Extra allowance: ${a.reason}` } :
      { from: "spending", to: "merchant", memo: a.memo };
    try {
      const { txn, duplicate } = transfer(db, { ...plan, amount: a.amount, kind: a.kind === "spend" ? "spend" : a.kind, idempotencyKey: `approval:${a.id}`, ts: now });
      txn.ref = a.id;
      a.paidTxnId = txn.id;
      for (const related of db.approvals) if (related.approvalId === a.id && ["topup", "child_funds"].includes(related.kind)) related.status = "resolved";
      if (a.kind === "reward") {
        const g = db.parentGoals.find((x) => x.id === a.goalId);
        if (g) g.status = "paid";
      }
      if (!duplicate) log("obligation_paid", `G2: Executed parent-approved ${a.kind} — ${dollars(a.amount)} ${plan.from} → ${plan.to} (idempotency key approval:${a.id}).`, { policy: "G2", approvalId: a.id, txnId: txn.id });
    } catch (e) {
      if (!(e instanceof BankError)) throw e;
      a.escalatedAt = now;
      if (!wasEscalated) {
        if (a.kind === "spend") {
          escalate(db, "child_funds", `${db.child.name}'s spending money is short by ${dollars(a.amount - db.accounts.spending.balance)} for '${a.memo}'`, "Your child needs to save less or earn more, or you can decline the purchase.", { approvalId: a.id }, now);
        } else {
          escalate(db, "topup", `Couldn't complete "${a.title}": ${e.message}.`, "Add funds or decline the request.", { approvalId: a.id }, now);
        }
      }
      log("obligation_blocked", `G2: Could not execute ${a.kind} (${e.code}). Escalated to parent; no partial transfer made.`, { policy: "G2", approvalId: a.id });
    }
  }

  actions.push(...reconcileNow(db, now, trigger));

  // G5 — warn once per funding-shortfall episode, including approved unpaid items.
  const upcoming = db.allowance.amount + db.approvals.filter((a) => ["pending", "approved"].includes(a.status) && !a.paidTxnId && (a.kind === "reward" || a.kind === "extra")).reduce((s, a) => s + a.amount, 0);
  const shortfall = upcoming - db.accounts.parent.balance;
  if (shortfall <= 0) {
    delete db.allowance.lowFundsWarnedAt;
    delete db.allowance.lowFundsWarnedFor;
  } else if (db.allowance.lowFundsWarnedAt == null) {
    db.allowance.lowFundsWarnedAt = now;
    db.allowance.lowFundsWarnedFor = shortfall;
    notify(db, "parent", `Heads up: funding account (${dollars(db.accounts.parent.balance)}) is below upcoming commitments (${dollars(upcoming)}).`, "guardian");
    log("low_funds_warning", `G5: Funding ${dollars(db.accounts.parent.balance)} < upcoming ${dollars(upcoming)}. Warned parent early.`, { policy: "G5" });
  }

  if (actions.length) checkMilestones(db);
  return actions;
}

function tagRef(db, key, ref) {
  const t = db.transactions.find((x) => x.idempotencyKey === key);
  if (t) t.ref = ref;
}

function escalate(db, kind, title, detail, data = {}, now = Date.now()) {
  const a = { id: uid("apr"), kind, status: "pending", createdAt: now, title, detail, fromGuardian: true, ...data };
  db.approvals.push(a);
  notify(db, "parent", `Guardian needs you: ${title}`, "guardian", a.id);
  return a;
}

// G4 — spending policy, consulted synchronously when the child logs a purchase.
export function spendPolicy(db, amount, memo) {
  if (amount > db.allowance.spendLimit) {
    return { hold: true, policy: "G4.limit", reason: `G4: ${dollars(amount)} is above the ${dollars(db.allowance.spendLimit)} per-purchase limit the parent set — held for approval.` };
  }
  const recent = db.transactions.filter((t) => t.kind === "spend" && t.status === "posted").slice(-5);
  if (recent.length >= 3) {
    const avg = recent.reduce((s, t) => s + t.amount, 0) / recent.length;
    if (amount > 3 * avg && amount >= 500) {
      notify(db, "parent", `FYI: ${db.child.name} spent ${dollars(amount)} on "${memo}", bigger than usual (avg ${dollars(Math.round(avg))}).`, "guardian");
      audit(db, "guardian", "unusual_spend", `G4: ${dollars(amount)} is >3× the recent average (${dollars(Math.round(avg))}). Allowed (under limit) but parent informed.`, { policy: "G4.anomaly" });
    }
  }
  return { hold: false };
}

/**
 * Demo fault injection: simulate the bank double-posting the most recent
 * reward/allowance (e.g. a webhook replayed by a flaky integration). This
 * bypasses our idempotency key on purpose — it's the bank's mistake, not ours —
 * so G3 has to catch it by reconciling against obligations.
 */
export function injectDuplicatePosting(db, now = Date.now()) {
  const target = [...db.transactions].reverse().find((t) => t.status === "posted" && t.ref && t.from === "parent");
  if (!target) return null;
  const dup = { ...target, id: uid("txn"), ts: now, idempotencyKey: `bank-replay:${uid("r")}`, memo: `${target.memo}`, injected: true };
  db.accounts[target.from].balance -= target.amount;
  db.accounts[target.to].balance += target.amount;
  db.transactions.push(dup);
  audit(db, "system", "fault_injected", `Simulated bank fault: duplicate posting of ${dollars(target.amount)} (${target.ref}).`, { txnId: dup.id });
  return dup;
}
