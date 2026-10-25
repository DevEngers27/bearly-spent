import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { database, closeDatabase } from "./db.js";

test("SQLite and WAL/SHM files use mode 0600 in MQ_DATA_DIR on creation and reopen", { skip: process.platform === "win32" }, () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mq-db-mode-"));
  const initialDir = process.env.MQ_DATA_DIR;
  const initialMask = process.umask(0o000);
  const filename = path.join(scratch, "moneyquest.sqlite");
  const assertModes = () => {
    for (const suffix of ["", "-wal", "-shm"]) assert.equal(fs.statSync(filename + suffix).mode & 0o777, 0o600, filename + suffix);
  };
  try {
    process.env.MQ_DATA_DIR = scratch;
    database();
    assertModes();
    closeDatabase();
    fs.chmodSync(filename, 0o666);
    database();
    assertModes();
  } finally {
    closeDatabase();
    process.umask(initialMask);
    if (initialDir === undefined) delete process.env.MQ_DATA_DIR; else process.env.MQ_DATA_DIR = initialDir;
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
