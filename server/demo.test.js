import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { _databaseForTest, closeDatabase } from "./db.js";
import { _clearStoreForTest, createChild, readChild, resetChild, seed, demoSeed, DEMO_POINTS, DEMO_CHILD_ID, DEMO_FAMILY_ID } from "./store.js";
import { initializeAccounts } from "./auth.js";

const originalDemo = process.env.MQ_DEMO;
beforeEach(() => { _clearStoreForTest(); _databaseForTest(); process.env.MQ_DEMO = "1"; });
after(() => { closeDatabase(); if (originalDemo === undefined) delete process.env.MQ_DEMO; else process.env.MQ_DEMO = originalDemo; });

test("the demo child starts and resets with plenty of points; new real children still start at zero", () => {
  assert.equal(seed().child.points, 40, "the plain seed keeps its shape for domain tests");
  assert.equal(demoSeed().child.points, DEMO_POINTS);
  initializeAccounts();
  assert.equal(readChild(DEMO_CHILD_ID).child.points, DEMO_POINTS);
  const spent = readChild(DEMO_CHILD_ID);
  spent.child.points = 5;
  resetChild(DEMO_CHILD_ID);
  assert.equal(readChild(DEMO_CHILD_ID).child.points, DEMO_POINTS);
  const real = createChild(DEMO_FAMILY_ID, { name: "Kai", age: 9, bearName: "Bo" });
  assert.equal(readChild(real.id).child.points, 0);
});
