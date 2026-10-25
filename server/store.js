// JSON-file persistence + demo seed. Every mutation goes through `mutate`, which
// saves to disk and notifies subscribers (the SSE stream) so parent and child
// screens stay in sync.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.MQ_DATA_DIR || path.join(here, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

let db = null;
const listeners = new Set();

export const uid = (prefix = "id") =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const DAY = 24 * 60 * 60 * 1000;

export function seed(now = Date.now()) {
  return {
    version: 1,
    family: { parentName: "Jordan", parentPin: "1234" },
    child: {
      name: "Mia",
      age: 9,
      points: 40,
      bear: { name: "Maple", hat: null, eyes: null, neck: null, outfit: null, held: null, friend: "bee_friend", background: "forest" },
      ownedCosmetics: ["held:adventure_map", "friend:bee_friend", "background:forest"],
      milestonesUnlocked: [1000], // already past $10 at seed time
      stats: { savingsActions: 0, learningDone: 0, tracked: 0, budgetsDone: 0, adventures: 0 },
      lessonsDone: [],
    },
    // Simulated bank. Balances are in cents to avoid float drift.
    accounts: {
      parent: { id: "acct_parent", label: "Parent funding account", balance: 25000 },
      savings: { id: "acct_savings", label: "Mia's savings", balance: 2000 },
      spending: { id: "acct_spending", label: "Mia's spending", balance: 1000 },
    },
    savingsGoals: [
      { id: "goal_bike", title: "New bicycle", icon: "bike", target: 10000, createdAt: now - 10 * DAY },
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
        bear: { name: "Pip", hat: "ranger_hat", neck: "camera" },
        postcards: ["seattle", "grand_canyon_national_park", "yosemite_national_park", "seattle"],
        coopLearning: 2,
      },
      {
        id: "fr_leo", name: "Leo", status: "pending_parent", code: "LEO-77",
        bear: { name: "Ziggy", hat: "knit_beanie", neck: "red_scarf" },
        postcards: ["great_smoky_mountains_national_park"],
        coopLearning: 0,
      },
    ],
    trades: [],
    tracking: [],
    buddy: {
      plan: null,
      chat: [],
    },
    audit: [],
    settings: { requireTradeApproval: true, buddyEnabled: true, coopChallenge: true },
  };
}

// Older saves used the first bear's slots (backpack color, hat, accessory).
// Map them onto the illustrated wardrobe so existing progress keeps working.
export function migrate(d) {
  const HATS = { beanie: "knit_beanie", ranger: "ranger_hat", flowers: "flower_crown" };
  const fix = (b) => {
    if (!b || !("color" in b || "accessory" in b)) return;
    b.hat = HATS[b.hat] || (b.hat && b.hat.includes("_") ? b.hat : null);
    if (b.accessory === "scarf") b.neck = "red_scarf";
    if (b.accessory === "leaf") b.neck = "red_bow_tie";
    if (b.background && !["forest", "meadow", "stars"].includes(b.background)) b.background = "forest";
    delete b.color;
    delete b.accessory;
  };
  fix(d.child?.bear);
  for (const p of d.postcards || []) {
    if (p.source === undefined) p.source = p.from ? "trade" : "trip";
  }
  if (d.child && !d.child.bear.friend && !d.child.ownedCosmetics?.includes("friend:bee_friend")) d.child.bear.friend = "bee_friend";
  d.friends?.forEach((f) => fix(f.bear));
  if (d.child?.ownedCosmetics?.some((id) => id.startsWith("color:") || id.startsWith("bg:") || id.startsWith("acc:"))) {
    const ids = new Set(["held:adventure_map", "friend:bee_friend", "background:forest"]);
    for (const id of d.child.ownedCosmetics) {
      const map = { "hat:beanie": "hat:knit_beanie", "hat:ranger": "hat:ranger_hat", "acc:scarf": "neck:red_scarf", "bg:meadow": "background:meadow" };
      if (map[id]) ids.add(map[id]);
    }
    d.child.ownedCosmetics = [...ids];
  }
  return d;
}

function ensureLoaded() {
  if (db) return;
  try {
    db = migrate(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
  } catch {
    db = seed();
    persist();
  }
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function read() {
  ensureLoaded();
  return db;
}

/** Run `fn(db)` and persist. Returns whatever fn returns. */
export function mutate(fn) {
  ensureLoaded();
  const snapshot = structuredClone(db);
  let result;
  try {
    result = fn(db);
  } catch (e) {
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, snapshot);
    throw e;
  }
  db.version += 1;
  persist();
  for (const l of listeners) l(db.version);
  return result;
}

export function reset() {
  db = seed();
  persist();
  for (const l of listeners) l(db.version);
}

/** For tests: start from a fresh in-memory seed without touching disk listeners. */
export function _setForTest(next) {
  db = next;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
