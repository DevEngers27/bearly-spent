// One SQLite connection per process; opening is lazy so domain-only tests do not
// create files. All writes that span rows use transaction().
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let connection;
const here = path.dirname(fileURLToPath(import.meta.url));

function restrictFiles(filename) {
  if (filename === ":memory:" || process.platform === "win32") return;
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.chmodSync(filename + suffix, 0o600); } catch (e) {
      if (!["ENOENT", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"].includes(e.code)) throw e;
    }
  }
}

function open(filename) {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  restrictFiles(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS families (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL,
      parent_pin TEXT, timezone TEXT NOT NULL DEFAULT 'UTC'
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES families(id),
      role TEXT NOT NULL CHECK(role IN ('parent')), email TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS children (
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES families(id),
      doc TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS children_family ON children(family_id);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
      family_id TEXT NOT NULL REFERENCES families(id), role TEXT NOT NULL CHECK(role IN ('parent','child')),
      child_id TEXT REFERENCES children(id), created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, ua TEXT,
      unlocked_until INTEGER NOT NULL DEFAULT 0, pin_locked_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS kid_links (
      code TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES families(id),
      child_id TEXT NOT NULL REFERENCES children(id), expires_at INTEGER NOT NULL, used_at INTEGER
    );
  `);
  restrictFiles(filename);
  return db;
}

export function database() {
  return connection ||= open(path.join(process.env.MQ_DATA_DIR || path.join(here, "..", "data"), "moneyquest.sqlite"));
}

export function transaction(fn) {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    if (result && typeof result.then === "function") throw new Error("SQLite transactions must be synchronous");
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function _databaseForTest(filename = ":memory:") {
  connection?.close();
  connection = open(filename);
  return connection;
}

export function closeDatabase() {
  connection?.close();
  connection = undefined;
}
