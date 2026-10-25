import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, seed } from "./store.js";
import { LESSONS, PLACES, bonusDiscoveries, placeStatus } from "./catalog.js";
import * as game from "./domain.js";
import { hasDueWork, runGuardian } from "./guardian.js";

const fresh = () => seed(Date.now());
const tradeApproval = (db, trade) => db.approvals.find((a) => a.tradeId === trade.id);
const passLesson = (db, lesson) => game.completeLesson(db, lesson.id, lesson.questions.map((q) => q.answer));

test("every catalog discovery and prerequisite references an existing place", () => {
  assert.equal(Object.keys(PLACES).length, 15);
  for (const [id, place] of Object.entries(PLACES)) {
    for (const rule of [place.discover, place.unlock]) {
      if (!rule) continue;
      for (const key of ["from", "place"]) {
        if (rule[key]) assert.ok(Object.hasOwn(PLACES, rule[key]), `${id}: ${key} ${rule[key]} exists`);
      }
    }
  }
});

for (const [id, place] of Object.entries(PLACES)) {
  test(`${id} is reachable under its own catalog rule`, () => {
    const db = fresh();
    db.child.points = 2000;
    let now = Date.now();
    const visited = () => game.visitedSet(db);
    const status = () => placeStatus(id, db.child, visited(), visited(), new Date(now));

    if (place.unlock) {
      const rule = place.unlock;
      assert.equal(status().ok, false);
      assert.throws(() => game.startAdventure(db, id, now), game.GameError);
      if (rule.type === "budgets") db.child.stats.budgetsDone = rule.count;
      if (rule.type === "saves") db.child.stats.savingsActions = rule.count;
      if (rule.type === "parks") {
        const parks = Object.entries(PLACES).filter(([, p]) => p.kind === "park" && p.rarity === "common");
        for (const [parkId] of parks.slice(0, rule.count)) {
          db.postcards.push({ id: `prerequisite_${parkId}`, defId: parkId, source: "trip", collectedAt: now });
        }
      }
      if (rule.type === "visited") db.postcards.push({ id: "prerequisite", defId: rule.place, source: "trip", collectedAt: now });
    }

    if (place.season) {
      const offMonth = Array.from({ length: 12 }, (_, i) => i).find((m) => !place.season.months.includes(m));
      now = new Date(2026, offMonth, 15, 12).getTime();
      assert.equal(status().ok, false);
      assert.throws(() => game.startAdventure(db, id, now), game.GameError);
      now = new Date(2026, place.season.months[0], 15, 12).getTime();
    }

    if (place.discover) {
      const rule = place.discover;
      assert.equal(status().hidden, true);
      assert.throws(() => game.startAdventure(db, id, now), /secret/);
      const stat = rule.type === "saves" ? "savingsActions" : "learningDone";
      db.child.stats[stat] = rule.count - 1;
      assert.ok(!bonusDiscoveries(rule.from, db.child, visited()).includes(id));
      db.child.stats[stat] = rule.count;
      assert.ok(bonusDiscoveries(rule.from, db.child, visited()).includes(id));
      const discoveryTrip = game.startAdventure(db, rule.from, now);
      game.finalizeAdventures(db, discoveryTrip.returnsAt);
      assert.ok(visited().has(id));
      assert.ok(!bonusDiscoveries(rule.from, db.child, visited()).includes(id), "discovery is only awarded once");
      now = discoveryTrip.returnsAt;
    }

    assert.equal(status().ok, true);
    const trip = game.startAdventure(db, id, now);
    assert.equal(trip.status, "away");
    assert.deepEqual(game.finalizeAdventures(db, trip.returnsAt), [trip]);
    assert.equal(trip.status, "returned");
    const cards = db.postcards.filter((p) => trip.postcardIds.includes(p.id));
    assert.ok(cards.some((p) => p.defId === id));
    assert.ok(cards.every((p) => p.source === "trip" && p.fromAdventure === trip.id));
    assert.ok(visited().has(id));
  });
}

test("declining a trade unlocks its postcard copies so the same card can be offered again", () => {
  const db = fresh();
  const copies = () => db.postcards.filter((p) => p.defId === "chicago" && !p.lockedForTrade);
  const cardIds = db.postcards.map((p) => p.id);
  assert.equal(copies().length, 2);
  const first = game.proposeTrade(db, "fr_maya", "chicago", "seattle");
  const lockedId = db.postcards.find((p) => p.lockedForTrade === first.id).id;
  assert.equal(copies().length, 1);
  game.decide(db, tradeApproval(db, first).id, false);
  assert.equal(first.status, "declined");
  assert.equal(copies().length, 2);
  assert.ok(db.postcards.every((p) => !p.lockedForTrade));
  assert.deepEqual(db.postcards.map((p) => p.id), cardIds);
  const second = game.proposeTrade(db, "fr_maya", "chicago", "seattle");
  assert.equal(db.postcards.find((p) => p.id === lockedId).lockedForTrade, second.id);
  assert.equal(copies().length, 1);
  assert.equal(tradeApproval(db, second).status, "pending");
});

test("declining a trade clears every lock belonging to that trade only", () => {
  const db = fresh();
  const trade = game.proposeTrade(db, "fr_maya", "chicago", "seattle");
  db.postcards[1].lockedForTrade = trade.id;
  db.postcards.push({ id: "other", defId: "chicago", source: "trip", lockedForTrade: "other_trade" });
  game.decide(db, tradeApproval(db, trade).id, false);
  assert.ok(db.postcards.slice(0, 2).every((p) => !p.lockedForTrade));
  assert.equal(db.postcards[2].lockedForTrade, "other_trade");
});

for (const reason of ["missing friend", "unavailable postcard"]) {
  test(`a failed trade clears every matching lock only (${reason})`, () => {
    const db = fresh();
    const trade = game.proposeTrade(db, "fr_maya", "chicago", "seattle");
    db.postcards[1].lockedForTrade = trade.id;
    db.postcards.push({ id: "other", defId: "chicago", source: "trip", lockedForTrade: "other_trade" });
    if (reason === "missing friend") db.friends = db.friends.filter((f) => f.id !== trade.friendId);
    else db.friends.find((f) => f.id === trade.friendId).postcards = [];
    const cardIds = db.postcards.map((p) => p.id);
    const friends = structuredClone(db.friends);
    game.decide(db, tradeApproval(db, trade).id, true);
    assert.equal(trade.status, "failed");
    assert.ok(db.postcards.slice(0, 2).every((p) => !Object.hasOwn(p, "lockedForTrade")));
    assert.equal(db.postcards[2].lockedForTrade, "other_trade");
    assert.deepEqual(db.postcards.map((p) => p.id), cardIds);
    assert.deepEqual(db.friends, friends);
  });
}

test("a declined friend code can create a new pending approval and keeps the decline notification", () => {
  const db = fresh();
  const first = game.addFriendByCode(db, "SAM-12");
  const approval = db.approvals.find((a) => a.friendId === first.id);
  game.decide(db, approval.id, false);
  assert.equal(first.status, "declined");
  assert.ok(db.notifications.some((n) => n.to === "child" && n.text === "Friend request with Sam wasn't approved."));
  const second = game.addFriendByCode(db, " sam-12 ");
  assert.notEqual(second.id, first.id);
  assert.equal(second.status, "pending_parent");
  assert.equal(db.friends.filter((f) => f.code === "SAM-12").length, 1);
  const next = db.approvals.find((a) => a.friendId === second.id);
  assert.notEqual(next.id, approval.id);
  assert.equal(next.status, "pending");
  assert.equal(approval.status, "declined");
  assert.throws(() => game.addFriendByCode(db, "SAM-12"), game.GameError);
  game.decide(db, next.id, true);
  assert.equal(second.status, "approved");
  assert.throws(() => game.addFriendByCode(db, "SAM-12"), game.GameError);
});

test("seed includes exactly one actionable pending friend approval for Leo", () => {
  const db = fresh();
  const approvals = db.approvals.filter((a) => a.status === "pending" && a.friendId === "fr_leo");
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].kind, "friend");
  game.decide(db, approvals[0].id, true);
  assert.equal(db.friends.find((f) => f.id === "fr_leo").status, "approved");
});

test("Leo's seeded code can also be retried after a decline", () => {
  const db = fresh();
  game.decide(db, db.approvals.find((a) => a.friendId === "fr_leo").id, false);
  const friend = game.addFriendByCode(db, "LEO-77");
  assert.equal(friend.name, "Leo");
  assert.equal(friend.status, "pending_parent");
  assert.equal(db.friends.filter((f) => f.code === "LEO-77").length, 1);
  assert.equal(db.approvals.find((a) => a.friendId === friend.id).status, "pending");
});

test("traded Seattle stays in the album and tradeable but only a Seattle trip unlocks Olympic", () => {
  const db = fresh();
  assert.ok(db.postcards.every((p) => p.source === "trip"));
  assert.deepEqual([...game.visitedSet(db)], ["chicago"]);
  const trade = game.proposeTrade(db, "fr_maya", "chicago", "seattle");
  game.decide(db, tradeApproval(db, trade).id, true);
  const received = db.postcards.find((p) => p.defId === "seattle");
  assert.equal(received.source, "trade");
  assert.equal(trade.status, "done");
  assert.equal(db.postcards.length, 2);
  assert.ok(!game.visitedSet(db).has("seattle"));
  db.child.points = 1000;
  assert.throws(() => game.startAdventure(db, "olympic_national_park"), /Visit Seattle/);
  const onward = game.proposeTrade(db, "fr_maya", "seattle", "grand_canyon_national_park");
  assert.equal(received.lockedForTrade, onward.id);
  game.decide(db, tradeApproval(db, onward).id, true);
  assert.equal(onward.status, "done");
  assert.ok(!db.postcards.includes(received));
  assert.ok(db.friends[0].postcards.includes("seattle"));
  const trip = game.startAdventure(db, "seattle");
  game.finalizeAdventures(db, trip.returnsAt);
  assert.ok(game.visitedSet(db).has("seattle"));
  assert.doesNotThrow(() => game.startAdventure(db, "olympic_national_park", trip.returnsAt));
});

test("a legacy adventure postcard without source or from counts as visited", () => {
  const db = fresh();
  db.postcards = [{ id: "legacy_trip", defId: "seattle", fromAdventure: "old_adventure" }];
  assert.deepEqual([...game.visitedSet(db)], ["seattle"]);
  db.child.points = 1000;
  assert.doesNotThrow(() => game.startAdventure(db, "olympic_national_park"));
});

test("a legacy traded postcard without source and from Maya does not count as visited", () => {
  const db = fresh();
  db.postcards = [{ id: "legacy_trade", defId: "seattle", from: "Maya" }];
  assert.equal(game.visitedSet(db).size, 0);
  db.child.points = 1000;
  assert.throws(() => game.startAdventure(db, "olympic_national_park"), /Visit Seattle/);
});

test("migrate stamps legacy postcard sources and preserves explicit sources", () => {
  const db = fresh();
  db.postcards = [
    { id: "legacy_trip", defId: "seattle", fromAdventure: "old_adventure" },
    { id: "legacy_trade", defId: "chicago", from: "Maya" },
    { id: "explicit_trip", defId: "new_york_city", source: "trip", from: "Maya" },
    { id: "explicit_trade", defId: "san_francisco", source: "trade" },
  ];
  assert.equal(migrate(db), db);
  assert.deepEqual(db.postcards.map((p) => p.source), ["trip", "trade", "trip", "trade"]);
  assert.deepEqual([...game.visitedSet(db)], ["seattle", "new_york_city"]);
  const migrated = structuredClone(db);
  migrate(db);
  assert.deepEqual(db, migrated);
});

test("three traded parks do not satisfy the visited-parks unlock", () => {
  const db = fresh();
  db.settings.requireTradeApproval = false;
  db.postcards.push({ id: "extra_chicago", defId: "chicago", source: "trip", collectedAt: Date.now() });
  const friend = db.friends[0];
  const parks = ["yosemite_national_park", "grand_canyon_national_park", "great_smoky_mountains_national_park"];
  for (const park of parks) {
    friend.postcards.push(park);
    game.proposeTrade(db, friend.id, "chicago", park);
  }
  assert.equal(db.postcards.filter((p) => PLACES[p.defId].kind === "park").length, 3);
  assert.ok(db.postcards.every((p) => p.source === "trade"));
  assert.equal(game.visitedSet(db).size, 0);
  assert.equal(placeStatus("glacier_national_park", db.child, game.visitedSet(db), game.visitedSet(db)).ok, false);
});

test("five lesson replays award only 20 total points and one goal and coop step", () => {
  const db = fresh();
  const goal = game.createParentGoal(db, { title: "Five lessons", type: "lessons", count: 5, reward: 5 });
  const before = db.child.points;
  assert.deepEqual(passLesson(db, LESSONS[0]), { passed: true, correct: 4, total: 4, firstTime: true });
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(passLesson(db, LESSONS[0]), { passed: true, correct: 4, total: 4, firstTime: false });
  }
  assert.equal(db.child.points, before + 20);
  assert.equal(db.child.stats.learningDone, 1);
  assert.deepEqual(db.child.lessonsDone, [LESSONS[0].id]);
  assert.equal(db.child.coopLearning, 1);
  assert.equal(goal.progress, 1);
  assert.equal(goal.status, "active");
  assert.ok(!db.approvals.some((a) => a.goalId === goal.id));
  const laterGoal = game.createParentGoal(db, { title: "One new lesson", type: "lessons", count: 1, reward: 1 });
  passLesson(db, LESSONS[0]);
  assert.equal(laterGoal.progress, 0);
  for (const lesson of LESSONS.slice(1)) passLesson(db, lesson);
  assert.equal(db.child.points, before + 100);
  assert.equal(db.child.stats.learningDone, 5);
  assert.equal(db.child.coopLearning, 5);
  assert.equal(goal.status, "awaiting_approval");
  assert.equal(db.approvals.filter((a) => a.goalId === goal.id).length, 1);
});

test("a failed lesson attempt does not consume its first-pass reward", () => {
  const db = fresh();
  const before = db.child.points;
  assert.equal(game.completeLesson(db, LESSONS[0].id, [1, 0, 1, 0]).passed, false);
  assert.equal(db.child.stats.learningDone, 0);
  assert.equal(db.child.points, before);
  assert.equal(passLesson(db, LESSONS[0]).firstTime, true);
  assert.equal(db.child.points, before + 20);
});

test("handling a guardian topup approval moves no money and clears the pending request", () => {
  const db = fresh();
  db.accounts.parent.balance = 0;
  db.allowance.nextRun = Date.now() - 1;
  runGuardian(db);
  const approval = db.approvals.find((a) => a.kind === "topup");
  assert.equal(approval.fromGuardian, true);
  const accounts = structuredClone(db.accounts);
  const transactions = structuredClone(db.transactions);
  const notifications = db.notifications.length;
  assert.equal(game.decide(db, approval.id, true), approval);
  assert.equal(approval.status, "approved");
  assert.equal(approval.handled, true);
  assert.ok(approval.decidedAt);
  assert.equal(db.notifications.length, notifications + 1);
  assert.equal(db.notifications.find((n) => n.ref === approval.id).read, true);
  assert.match(db.notifications.at(-1).text, /Funding request handled/);
  assert.equal(db.audit.at(-1).action, "handled");
  assert.match(db.audit.at(-1).detail, /^Handled:/);
  runGuardian(db);
  assert.deepEqual(db.accounts, accounts);
  assert.deepEqual(db.transactions, transactions);
  assert.ok(!db.approvals.some((a) => a.kind === "topup" && a.status === "pending"));
  db.allowance.nextRun = Date.now() + 86400000;
  assert.equal(hasDueWork(db), false);
  assert.throws(() => game.decide(db, approval.id, true), game.GameError);
});
