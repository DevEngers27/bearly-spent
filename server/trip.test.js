import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { seed } from "./store.js";
import * as game from "./domain.js";
import * as catalog from "./catalog.js";
import { actions } from "./actions.js";
import { dayKey, weekKey } from "./time.js";

const now = new Date(2026, 6, 15, 12).getTime();
const fresh = () => { const db = seed(Date.now()); db.child.points = 300; db.postcards = []; return db; };
const collect = (db, id, source = "trip") => db.postcards.push({ id: `pc-${id}`, defId: id, source });
const openIds = (db) => {
  const visited = game.visitedSet(db);
  return Object.keys(catalog.PLACES).filter((id) => catalog.placeStatus(id, db.child, visited, visited, new Date(now)).ok);
};
// Extract the actual views without importing the listening server or touching data/.
const index = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const viewSource = index.slice(index.indexOf("function placesView("), index.indexOf("// ------------------------------------------------------------------ routes: shared"));
const { childView, parentView } = vm.runInNewContext(`${viewSource}\n({ childView, parentView })`, {
  Date, game, dayKey, weekKey, ...catalog, buddyMode: () => "offline", voiceEnabled: () => false, nessieEnabled: () => false,
});

test("F3: every weighted ticket draws only open places, never hidden, locked or out-of-season places", () => {
  let total;
  game.startTrip(fresh(), now, (max) => { total = max; return 0; });
  const drawn = new Set();
  for (let ticket = 0; ticket < total; ticket++) {
    const db = fresh();
    const adv = game.startTrip(db, now, () => ticket);
    assert.ok(openIds(db).includes(adv.destId));
    assert.equal(catalog.PLACES[adv.destId].rarity, "common");
    drawn.add(adv.destId);
  }
  assert.equal(drawn.size, 8);
});

test("F3: trip prefers uncollected places; traded cards do not count as collected by trip", () => {
  const db = fresh();
  for (const id of Object.keys(catalog.PLACES)) if (id !== "seattle" && catalog.PLACES[id].rarity !== "secret") collect(db, id);
  collect(db, "seattle", "trade");
  assert.equal(game.startTrip(db, now, () => 0).destId, "seattle");
});

test("F3: all collected falls back to open places and duplicates are tradeable", () => {
  const db = fresh();
  for (const id of Object.keys(catalog.PLACES)) if (catalog.PLACES[id].rarity !== "secret") collect(db, id);
  const adv = game.startTrip(db, now, () => 0);
  assert.ok(game.visitedSet(db).has(adv.destId));
  game.finalizeAdventures(db, adv.returnsAt);
  const duplicates = db.postcards.filter((p) => p.defId === adv.destId);
  assert.equal(duplicates.length, 2);
  assert.ok(duplicates.every((p) => !p.lockedForTrade));
});

test("F3: injected RNG gives common places three tickets and unlocked rare places one", () => {
  const make = () => { const db = fresh(); db.child.stats.budgetsDone = 1; db.child.stats.savingsActions = 5; return db; };
  let total;
  game.startTrip(make(), now, (max) => { total = max; return 0; });
  const counts = {};
  for (let ticket = 0; ticket < total; ticket++) {
    const adv = game.startTrip(make(), now, (max) => { assert.equal(max, total); return ticket; });
    counts[adv.destId] = (counts[adv.destId] || 0) + 1;
  }
  for (const [id, count] of Object.entries(counts)) assert.equal(count, catalog.PLACES[id].rarity === "common" ? 3 : 1);
  assert.equal(counts.yellowstone_national_park, 1);
  assert.equal(counts.grand_teton_national_park, 1);
});

test("F3: flat trip cost is deducted once, with the original adventure shape and warm audit", () => {
  const db = fresh(), savings = db.accounts.savings.balance;
  const adv = game.startTrip(db, now, () => 0);
  assert.equal(db.child.points, 300 - catalog.TRIP.cost);
  assert.equal(adv.returnsAt - adv.startedAt, game.ADVENTURE_MS);
  assert.equal(adv.status, "away");
  assert.deepEqual(adv.postcardIds, []);
  assert.equal(db.accounts.savings.balance, savings);
  assert.equal(db.audit.at(-1).detail, "Sent Maple on a surprise trip (30 pts)");
  game.finalizeAdventures(db, adv.returnsAt);
  game.finalizeAdventures(db, adv.returnsAt);
  assert.equal(db.child.points, 270);
  assert.equal(db.child.stats.adventures, 1);
  assert.equal(db.postcards.length, 1);
});

test("F3: away, short points and invalid RNG refuse without spending or adding adventures", () => {
  const db = fresh();
  game.startTrip(db, now, () => 0);
  assert.throws(() => game.startTrip(db, now), game.GameError);
  assert.equal(db.child.points, 270);
  assert.equal(db.adventures.length, 1);
  const short = fresh(); short.child.points = 18;
  assert.throws(() => game.startTrip(short, now), /Earn 12 more points/);
  assert.equal(short.child.points, 18); assert.equal(short.adventures.length, 0);
  const invalid = fresh();
  assert.throws(() => game.startTrip(invalid, now, () => -1), game.GameError);
  assert.equal(invalid.child.points, 300); assert.equal(invalid.adventures.length, 0);
});

test("F3: childView masks an away destination, parent retains it, then postcard appears on return", () => {
  const db = fresh(), adv = game.startTrip(db, now, () => 0);
  const child = childView(db);
  assert.equal(Object.hasOwn(child.adventures[0], "destId"), false);
  assert.equal(child.postcards.length, 0);
  assert.equal(parentView(db).adventures[0].destId, adv.destId);
  assert.equal(adv.destId, "san_francisco"); // masking did not mutate the store
  assert.deepEqual(child.catalog.trip, catalog.TRIP);
  game.finalizeAdventures(db, adv.returnsAt);
  const returned = childView(db);
  assert.equal(returned.adventures[0].destId, "san_francisco");
  assert.equal(returned.postcards[0].defId, "san_francisco");
});

test("F3: random San Francisco trip still brings the Hawaii bonus after three saves", () => {
  const db = fresh();
  db.child.stats.savingsActions = 3;
  const adv = game.startTrip(db, now, () => 0);
  game.finalizeAdventures(db, adv.returnsAt);
  assert.deepEqual(db.postcards.map((p) => p.defId), ["san_francisco", "hawaii_volcanoes_national_park"]);
  assert.equal(adv.postcardIds.length, 2);
  assert.ok(db.postcards.every((p) => p.source === "trip" && p.fromAdventure === adv.id));
});

test("F3: validated trip action rejects malformed bodies and old destination-based clients still work", () => {
  assert.throws(() => actions.trip(fresh(), null), game.GameError);
  const db = fresh();
  assert.equal(actions.trip(db, {}).status, "away");
  const legacy = fresh();
  assert.equal(actions.adventure(legacy, { destId: "san_francisco" }).destId, "san_francisco");
  assert.equal(legacy.child.points, 300 - catalog.PLACES.san_francisco.cost);
});


test("F36.5: postcard articles", () => {
  for (const [destId, article] of [["acadia_national_park", "an"], ["arches_national_park", "an"], ["seattle", "a"], ["yosemite_national_park", "a"]]) {
    const db = fresh();
    db.adventures.push({ id: "grammar", destId, status: "away", returnsAt: now, postcardIds: [] });
    game.finalizeAdventures(db, now);
    assert.equal(db.notifications.at(-1).text, `Maple is home with ${article} ${catalog.PLACES[destId].name} postcard!`);
  }
});
