// Per-child SQLite documents. Domain functions still operate on seed()'s shape.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { COSMETICS, SLOTS } from "./catalog.js";
import { database, transaction } from "./db.js";
import { GameError, dueAdventures, normalizeGoals, audit, notify } from "./domain.js";
import { hasDueWork } from "./guardian.js";
import { profileName, integer, object } from "./validate.js";

const documents = new Map();
const identities = new WeakMap();
const listeners = new Map();
let testDocument = null;
export const DEMO_FAMILY_ID = "family_demo";
export const DEMO_CHILD_ID = "child_demo";

export const uid = (prefix = "id") =>
  `${prefix}_${crypto.randomUUID()}`;

export const CODE_ALPHABET = "BCDFGHJKMNPQRTVWXY346789";

const DAY = 24 * 60 * 60 * 1000;

/** The demo family starts with enough points to try several surprise trips and swaps. */
export const DEMO_POINTS = 500;
export function demoSeed(now = Date.now()) {
  const d = seed(now);
  d.child.points = DEMO_POINTS;
  return d;
}

export function seed(now = Date.now()) {
  return {
    version: 1,
    wardrobeVersion: 2,
    createdAt: now,
    family: { parentName: "Jordan" },
    child: {
      currentGoalId: "goal_bike",
      name: "Mia",
      age: 9,
      points: 40,
      bear: { name: "Maple", hat: null, eyes: null, neck: null, outfit: null, bag: null, held: null, friend: "bee_friend", background: "forest" },
      ownedCosmetics: ["held:map", "friend:bee_friend", "background:forest"],
      milestonesUnlocked: [1000], // already past $10 at seed time
      stats: { savingsActions: 0, learningDone: 0, tracked: 0, budgetsDone: 0, adventures: 0 },
      lessonsDone: [],
    },
    // Simulated bank. Balances are in cents to avoid float drift.
    accounts: {
      parent: { id: "acct_parent", label: "Funding account", balance: 25000 },
      savings: { id: "acct_savings", label: "Mia's savings", balance: 2000 },
      spending: { id: "acct_spending", label: "Mia's spending", balance: 1000 },
    },
    savingsGoals: [
      { id: "goal_bike", title: "New bicycle", icon: "bike", status: "active", activeFlag: true, target: 10000, createdAt: now - 10 * DAY },
    ],
    transactions: [
      {
        id: uid("txn"), ts: now - 9 * DAY, from: "parent", to: "savings", amount: 2000,
        kind: "allowance", memo: "Starting savings", idempotencyKey: "seed-1", status: "posted",
      },
      {
        id: uid("txn"), ts: now - 9 * DAY, from: "parent", to: "spending", amount: 1500,
        kind: "allowance", memo: "Starting spending money", idempotencyKey: "seed-2", status: "posted",
      },
      {
        id: uid("txn"), ts: now - 4 * DAY, from: "spending", to: "merchant", amount: 500,
        kind: "spend", memo: "Comic book", idempotencyKey: "seed-3", status: "posted",
      },
    ],
    allowance: {
      amount: 1000, // $10/week
      cadenceDays: 7,
      savePct: 50,
      nextRun: now + 3 * DAY,
      lastPeriod: null,
      spendLimit: 2000, // child purchases above $20 need parent approval
      rewardDestination: "savings",
    },
    missions: [],
    parentGoals: [],
    approvals: [
      { id: uid("apr"), kind: "friend", status: "pending", createdAt: now, friendId: "fr_leo",
        title: "Mia wants to add Leo as a friend", detail: "Invitation code LEO-77. Friends only see bears and postcards — never balances." },
    ],
    notifications: [
      { id: uid("ntf"), ts: now, to: "child", text: "Welcome back, Mia! Maple missed you. Try a money lesson to earn points.", kind: "info", ref: null, read: false },
    ],
    adventures: [],
    postcards: [
      { id: uid("pc"), defId: "chicago", source: "trip", collectedAt: now - 6 * DAY },
      { id: uid("pc"), defId: "chicago", source: "trip", collectedAt: now - 2 * DAY },
    ],
    friends: [
      {
        id: "fr_maya", name: "Maya", status: "approved", code: "MAYA-42",
        bear: { name: "Pip", hat: "explorer_hat", bag: "camera" },
        postcards: ["seattle", "grand_canyon_national_park", "yosemite_national_park", "seattle"],
        coopLearning: 2,
      },
      {
        id: "fr_leo", name: "Leo", status: "pending_parent", code: "LEO-77",
        bear: { name: "Ziggy", hat: "beanie", neck: "red_scarf" },
        postcards: ["great_smoky_mountains_national_park"],
        coopLearning: 0,
      },
    ],
    trades: [],
    walletPending: [],
    tracking: [],
    buddy: {
      plan: null,
      chat: [],
    },
    audit: [],
    settings: { requireTradeApproval: true, buddyEnabled: true, coopChallenge: true },
  };
}

// Refresh each child document once; retired cosmetics never change points or money.
export function migrate(d) {
  if (d.child) normalizeGoals(d);
  if (!Number.isFinite(d.createdAt)) {
    const times = (d.audit || []).map((entry) => entry.ts).filter(Number.isFinite);
    d.createdAt = times.length ? Math.min(...times) : Date.now();
  }
  if (d.accounts?.parent) {
    d.accounts.parent.label = "Funding account";
    if (d.accounts.wallet) {
      const balance = d.accounts.wallet.balance;
      if (balance > 0) {
        d.accounts.parent.balance += balance;
        audit(d, "system", "wallet_migrated", `Moved $${(balance / 100).toFixed(2)} of tracked Apple Cash into the funding account`, { amount: balance });
      } else if (balance < 0) {
        audit(d, "system", "wallet_migrated", `Dropped negative tracked Apple Cash balance of -$${(-balance / 100).toFixed(2)}; funding unchanged`, { amount: balance });
      }
      delete d.accounts.wallet;
    }
  }
  d.walletPending ||= [];
  for (const t of d.transactions || []) if (t.kind === "wallet_in") t.memo = "Sent via Apple Cash (before 0.7)";
  for (const p of d.postcards || []) {
    if (p.source === undefined) p.source = p.from ? "trade" : "trip";
  }
  if (d.child && d.wardrobeVersion !== 2) {
    const known = new Set(COSMETICS.map((c) => c.id));
    const owned = new Set((d.child.ownedCosmetics || []).filter((id) => known.has(id)));
    for (const id of ["held:map", "friend:bee_friend", "background:forest"]) owned.add(id);
    for (const c of COSMETICS) {
      if (c.milestone && d.child.milestonesUnlocked?.some((at) => at >= c.milestone)) owned.add(c.id);
    }
    d.child.ownedCosmetics = [...owned];
    const bear = d.child.bear;
    delete bear.color;
    delete bear.accessory;
    for (const slot of SLOTS) {
      if (!known.has(`${slot}:${bear[slot]}`) || !owned.has(`${slot}:${bear[slot]}`)) bear[slot] = slot === "background" ? "forest" : null;
    }
    // Practice friends have no inventory; real friends are read from their own documents.
    const hats = { ranger_hat: "explorer_hat", knit_beanie: "beanie", flower_sunhat: "straw_hat" };
    for (const friend of d.friends || []) {
      if (friend.real || !friend.bear) continue;
      const b = friend.bear;
      b.hat = hats[b.hat] || b.hat;
      if (b.neck === "camera") { b.bag = "camera"; b.neck = null; }
      for (const slot of SLOTS) if (!known.has(`${slot}:${b[slot]}`)) b[slot] = slot === "background" ? "forest" : null;
      delete b.color;
      delete b.accessory;
    }
    d.wardrobeVersion = 2;
    audit(d, "system", "wardrobe_refreshed", "Wardrobe refreshed: new outfits, old ones retired");
  }
  return d;
}

function retain(d) {
  for (const [key, cap] of [["tracking", 500], ["audit", 2000], ["transactions", 5000], ["walletPending", 20]]) {
    if (d[key].length > cap) d[key].splice(0, d[key].length - cap);
  }
  if (d.buddy.chat.length > 200) d.buddy.chat.splice(0, d.buddy.chat.length - 200);
  const counts = new Map();
  d.notifications = d.notifications.slice().reverse().filter((n) => {
    const count = (counts.get(n.to) || 0) + 1;
    counts.set(n.to, count);
    return count <= 200;
  }).reverse();
}

function remember(id, d) {
  documents.set(id, d);
  identities.set(d, id);
  return d;
}

export function childIdFor(d) {
  return identities.get(d);
}

export function childRecord(childId) {
  return database().prepare("SELECT id, family_id, version, updated_at FROM children WHERE id = ?").get(childId) || null;
}

export function readChild(childId) {
  // Compatibility for domain/Buddy unit tests only; production requires an ID.
  if (childId === undefined && testDocument) return testDocument;
  if (typeof childId !== "string") throw new GameError("Child not found", 404);
  if (documents.has(childId)) return documents.get(childId);
  const row = database().prepare("SELECT doc FROM children WHERE id = ?").get(childId);
  if (!row) throw new GameError("Child not found", 404);
  const stored = JSON.parse(row.doc);
  const needsMigration = stored.wardrobeVersion !== 2 || !Number.isFinite(stored.createdAt) || !!stored.accounts?.wallet || stored.accounts?.parent?.label !== "Funding account" || !stored.walletPending;
  const d = migrate(stored);
  // Persist wardrobe/account migrations and timestamps once, including across restarts.
  if (needsMigration) database().prepare("UPDATE children SET doc = ? WHERE id = ?").run(JSON.stringify(d), childId);
  return remember(childId, d);
}

export function listChildren(familyId) {
  return database().prepare("SELECT id, doc, version FROM children WHERE family_id = ? ORDER BY rowid").all(familyId).map((row) => {
    const d = JSON.parse(row.doc);
    const friends = d.friends.filter((f) => f.real && !["declined", "removed"].includes(f.status) && !(!f.initiator && f.status === "pending_parent_a"))
      .map((f) => ({ id: f.id, status: f.status, name: f.status === "approved" ? readChild(f.peerId).child.name.trim().split(/\s+/)[0] : "Friend request" }));
    return { id: row.id, name: d.child.name, age: d.child.age, bearName: d.child.bear.name, version: row.version, friendCode: friendCode(row.id), friends };
  });
}

export function createChild(familyId, input) {
  const body = object(input);
  const name = profileName(body.name);
  const age = integer(body.age, { min: 7, max: 12 });
  const bearName = profileName(body.bearName);
  if (!database().prepare("SELECT id FROM families WHERE id = ?").get(familyId)) throw new GameError("Family not found", 404);
  const d = seed();
  d.family = { parentName: database().prepare("SELECT name FROM families WHERE id = ?").get(familyId).name };
  d.child.name = name;
  d.child.age = age;
  d.child.bear.name = bearName;
  d.child.points = 0;
  d.child.milestonesUnlocked = [];
  for (const [key, account] of Object.entries(d.accounts)) {
    account.id = uid("acct");
    account.balance = 0;
    if (key !== "parent") account.label = `${name}'s ${key}`;
  }
  for (const key of ["transactions", "postcards", "adventures", "friends", "approvals", "notifications"]) d[key] = [];
  d.allowance.amount = 0;
  d.settings.timezone = database().prepare("SELECT timezone FROM families WHERE id = ?").get(familyId).timezone;
  d.settings.coopChallenge = familyId === DEMO_FAMILY_ID;
  for (const goal of d.savingsGoals) goal.createdAt = Date.now();
  const id = uid("child");
  database().prepare("INSERT INTO children (id, family_id, doc, version, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, familyId, JSON.stringify(d), d.version, Date.now());
  return { id, name, age, bearName, version: d.version, friendCode: friendCode(id) };
}

function publish(familyId, version, childId) {
  for (const fn of listeners.get(familyId) || []) {
    try { fn(version, childId); } catch (e) { console.error("[subscriber]", e.message); }
  }
}

export function mutateChild(childId, fn) {
  if (childId === undefined && testDocument) {
    const snapshot = structuredClone(testDocument);
    try {
      const result = fn(testDocument);
      retain(testDocument);
      testDocument.version += 1;
      publish(undefined, testDocument.version);
      return result;
    } catch (e) {
      for (const key of Object.keys(testDocument)) delete testDocument[key];
      Object.assign(testDocument, snapshot);
      throw e;
    }
  }
  return mutateChildren([childId], ([d]) => fn(d));
}

// One SQLite transaction and no notifications until every document is durable.
export function mutateChildren(childIds, fn) {
  const ids = [...new Set(childIds)];
  if (!ids.length) throw new GameError("Child not found", 404);
  const docs = ids.map(readChild);
  const snapshots = docs.map((d) => structuredClone(d));
  let rows;
  let result;
  try {
    result = transaction((db) => {
      rows = ids.map((id) => db.prepare("SELECT family_id, version FROM children WHERE id = ?").get(id));
      const out = fn(docs);
      if (out && typeof out.then === "function") throw new Error("Child mutations must be synchronous");
      docs.forEach((d, i) => {
        retain(d);
        d.version = rows[i].version + 1;
        const written = db.prepare("UPDATE children SET doc = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?")
          .run(JSON.stringify(d), d.version, Date.now(), ids[i], rows[i].version);
        if (written.changes !== 1) throw new GameError("Please try that again", 409);
      });
      return out;
    });
  } catch (e) {
    docs.forEach((d, i) => {
      for (const key of Object.keys(d)) delete d[key];
      Object.assign(d, snapshots[i]);
    });
    throw e;
  }
  docs.forEach((d, i) => publish(rows[i].family_id, d.version, ids[i]));
  return result;
}

export function friendCode(childId, regenerate = false) {
  if (!childRecord(childId)) throw new GameError("Child not found", 404);
  const db = database();
  const current = db.prepare("SELECT code FROM friend_codes WHERE child_id = ?").get(childId)?.code;
  if (current && !regenerate) return current;
  for (let i = 0; i < 20; i++) {
    const code = Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
    if (code === current || db.prepare("SELECT code FROM friend_codes WHERE code = ?").get(code)) continue;
    db.prepare("INSERT INTO friend_codes (code, child_id) VALUES (?, ?) ON CONFLICT(child_id) DO UPDATE SET code = excluded.code").run(code, childId);
    return code;
  }
  throw new GameError("Try making a new code in a moment", 429);
}

/** How a family introduces itself to another family: its display name, else "<parent>'s family". */
export function familyLabel(childId) {
  const row = database().prepare("SELECT f.display_name AS displayName, f.name AS name FROM families f JOIN children c ON c.family_id = f.id WHERE c.id = ?").get(childId);
  return row?.displayName?.trim() || `${(row?.name || "their grown-up").trim().split(/\s+/)[0]}'s family`;
}

export function childForFriendCode(code) {
  return database().prepare("SELECT child_id FROM friend_codes WHERE code = ?").get(code)?.child_id;
}

export function updateChildProfile(familyId, childId, input) {
  const row = childRecord(childId);
  if (!row || row.family_id !== familyId) throw new GameError("Child not found", 404);
  const body = object(input);
  const name = profileName(body.name), age = integer(body.age, { min: 7, max: 12 }), bearName = profileName(body.bearName);
  mutateChild(childId, (d) => {
    const renamed = d.child.bear.name !== bearName;
    Object.assign(d.child, { name, age });
    d.child.bear.name = bearName;
    for (const key of ["savings", "spending"]) d.accounts[key].label = `${name}'s ${key}`;
    audit(d, "parent", "profile_updated", `Updated ${name}'s profile${renamed ? `; renamed the bear to ${bearName}` : ""}`);
    notify(d, "child", renamed ? `Your grown-up renamed your bear to ${bearName}` : "Your grown-up updated your profile");
  });
  return listChildren(familyId).find((child) => child.id === childId);
}

// Account writes and their per-child audit events commit together. Publish only
// after commit so streams cannot observe an account update without its audit.
export function mutateFamilyChildren(familyId, changeAccount, changeChild) {
  const rows = database().prepare("SELECT id, version FROM children WHERE family_id = ?").all(familyId);
  const docs = rows.map((row) => ({ ...row, doc: structuredClone(readChild(row.id)) }));
  transaction((db) => {
    changeAccount(db);
    for (const row of docs) {
      changeChild(row.doc);
      retain(row.doc);
      row.doc.version = row.version + 1;
      db.prepare("UPDATE children SET doc = ?, version = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(row.doc), row.doc.version, Date.now(), row.id);
    }
  });
  for (const row of docs) {
    const current = readChild(row.id);
    Object.assign(current, row.doc);
    publish(familyId, row.doc.version, row.id);
  }
}

export function childrenWithDueWork(now = Date.now()) {
  return database().prepare("SELECT id FROM children").all().filter(({ id }) => {
    const d = readChild(id);
    return dueAdventures(d, now).length > 0 || hasDueWork(d, now) || d.trades.some((t) => t.real && t.status === "pending" && now >= t.expiresAt);
  }).map(({ id }) => id);
}

export function subscribe(familyId, fn) {
  if (typeof familyId === "function") [familyId, fn] = [undefined, familyId];
  if (!listeners.has(familyId)) listeners.set(familyId, new Set());
  listeners.get(familyId).add(fn);
  return () => unsubscribe(familyId, fn);
}

export function unsubscribe(familyId, fn) {
  const group = listeners.get(familyId);
  group?.delete(fn);
  if (group?.size === 0) listeners.delete(familyId);
}

export function resetChild(childId) {
  const row = childRecord(childId);
  if (!row || row.family_id !== DEMO_FAMILY_ID || process.env.MQ_DEMO !== "1") throw new GameError("Demo control unavailable", 404);
  // Replace the root identity too, invalidating any in-flight Buddy work.
  const previous = documents.get(childId);
  remember(childId, demoSeed());
  try {
    mutateChild(childId, (d) => { delete d.family.parentPin; });
  } catch (e) {
    if (previous) remember(childId, previous);
    else documents.delete(childId);
    throw e;
  }
}

export function importLegacy(filename) {
  if (!fs.existsSync(filename)) return false;
  if (database().prepare("SELECT id FROM families WHERE id = ?").get(DEMO_FAMILY_ID)) return false;
  // Parse and validate before writing anything. A corrupt file stays untouched.
  const d = migrate(JSON.parse(fs.readFileSync(filename, "utf8")));
  if (!d.child?.bear || !d.accounts?.parent || !Array.isArray(d.transactions) || !d.buddy || !d.settings) throw new Error("Invalid legacy game document");
  delete d.family.parentPin;
  retain(d);
  const now = Date.now();
  transaction((db) => {
    db.prepare("INSERT INTO families (id, name, created_at) VALUES (?, ?, ?)").run(DEMO_FAMILY_ID, d.family.parentName || "Demo", now);
    db.prepare("INSERT INTO children (id, family_id, doc, version, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(DEMO_CHILD_ID, DEMO_FAMILY_ID, JSON.stringify(d), d.version, now);
  });
  fs.renameSync(filename, filename + ".imported");
  return true;
}

// The pre-accounts tests use these adapters, which never touch persistent data.
export const read = () => readChild(undefined);
export const mutate = (fn) => mutateChild(undefined, fn);
export function reset() { testDocument = seed(); }
export function _setForTest(next) { testDocument = next; }
export function _clearStoreForTest() {
  documents.clear();
  listeners.clear();
  testDocument = null;
}
