import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { seed, _setForTest } from "./store.js";
import * as game from "./domain.js";
import { actions } from "./actions.js";
import { LESSONS } from "./catalog.js";
import { spendPolicy } from "./guardian.js";
import { offlineReply, chat, _internals } from "./buddy.js";

afterEach(() => { _setForTest(null); });

test("W3.1: offline helper, trip notifications and audit use the child's bear name", () => {
  const now = Date.now(), db = seed(now);
  db.child.bear.name = "Bo";
  assert.match(offlineReply(db, "Hi"), /I'm Bo/);
  assert.match(offlineReply(db, "Tell me about a trip"), /send Bo on a trip/);
  // Seeded Maple copy belongs to the demo; inspect only newly generated entries.
  db.notifications = [];
  db.audit = [];
  db.child.points = 500;
  game.startAdventure(db, "san_francisco", now);
  game.finalizeAdventures(db, now + game.ADVENTURE_MS);
  db.accounts.parent.balance = 0;
  game.childWalletSpend(db, { amount: 100, merchant: "Bookshop" }, spendPolicy, now);
  assert.ok(db.notifications.some((n) => /Bo is home/.test(n.text)));
  assert.ok(db.notifications.some((n) => n.text.startsWith(`${db.child.name}'s Apple Cash`)), "the overspend notice names the child, not the bear");
  assert.ok(db.audit.some((a) => /Sent Bo/.test(a.detail)));
  assert.doesNotMatch(JSON.stringify({ notifications: db.notifications, audit: db.audit }), /Maple/);
});

test("W3.1: blocked or unavailable Buddy guard uses Bo in the safe fallback", async (t) => {
  const db = seed(Date.now());
  db.child.bear.name = "Bo";
  _setForTest(db);
  const previousKey = process.env.ANTHROPIC_API_KEY;
  t.after(() => { if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey; });
  process.env.ANTHROPIC_API_KEY = "test-key";
  t.mock.method(_internals, "runClaude", async () => ({ reply: "Unchecked reply", toolsUsed: [] }));
  let unavailable = false;
  t.mock.method(_internals, "runGuard", async () => { if (unavailable) throw new Error("Unavailable"); return "BLOCK"; });
  for (const fail of [false, true]) {
    unavailable = fail;
    const result = await chat("Hi");
    assert.match(result.reply, /Bo's next trip/);
    assert.doesNotMatch(result.reply, /Maple/);
    assert.equal(db.buddy.chat.at(-1).text, result.reply);
  }
});

test("W3.4: lesson goal errors distinguish zero, some and all lessons passed", () => {
  for (const passed of [0, 3, LESSONS.length]) {
    const db = seed(Date.now());
    db.child.lessonsDone = LESSONS.slice(0, passed).map((l) => l.id);
    const expected = passed === 0 ? /Pick up to 30 lessons/ : passed === LESSONS.length ? /has already passed all lessons — choose tasks/ : /has already passed 3 lessons — pick 27 or fewer/;
    const before = structuredClone(db);
    assert.throws(() => game.createParentGoal(db, { title: "Learn", type: "lessons", count: LESSONS.length + 1 - passed, reward: 5 }), (e) => e instanceof game.GameError && e.status === 400 && expected.test(e.message));
    assert.deepEqual(db, before);
    game.createParentGoal(db, { title: "Help", type: passed === LESSONS.length ? "tasks" : "lessons", count: Math.max(1, LESSONS.length - passed), reward: 5 });
  }
});

test("W3.4: settings and allowance audit entries are readable sentences with currency", () => {
  const db = seed(Date.now());
  actions.settings(db, { timezone: "America/Los_Angeles" });
  assert.equal(db.audit.at(-1).detail, "Time zone set to America/Los_Angeles");
  actions.settings(db, { buddyEnabled: false, requireTradeApproval: true, coopChallenge: false });
  assert.equal(db.audit.at(-1).detail, "Trade approval turned on. Buddy turned off. Team challenge turned off");
  actions.settings(db, {});
  assert.equal(db.audit.at(-1).detail, "Settings unchanged");
  actions.allowance(db, { amount: 10 });
  assert.match(db.audit.at(-1).detail, /^Allowance \$10\.00\/wk/);
  assert.doesNotMatch(db.audit.map((a) => a.detail).join("\n"), /Updated settings:|\{"/);
});
