import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COSMETICS, SLOTS, MILESTONES } from "./catalog.js";
import { seed, demoSeed, migrate, readChild, _clearStoreForTest } from "./store.js";
import { _databaseForTest, closeDatabase } from "./db.js";
import * as game from "./domain.js";

const publicBear = new URL("../client/public/bear/w2/", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("items/manifest.json", publicBear), "utf8"));
const defaults = ["held:map", "friend:bee_friend", "background:forest"];
const known = new Set(COSMETICS.map((c) => c.id));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mq-h8-"));
after(() => { _clearStoreForTest(); closeDatabase(); fs.rmSync(scratch, { recursive: true, force: true }); });

function validBear(bear) {
  for (const [slot, value] of Object.entries(bear)) {
    if (slot !== "name" && value !== null) assert.ok(known.has(`${slot}:${value}`), `${slot}:${value}`);
  }
}
function legacy() {
  const d = seed(Date.now());
  delete d.wardrobeVersion;
  delete d.child.bear.bag;
  d.child.bear = { ...d.child.bear, hat: "ranger_hat", eyes: "sunglasses", neck: "camera", outfit: "green_hoodie", held: "adventure_map", friend: "unknown", background: "missing", color: "brown", accessory: "leaf" };
  d.child.ownedCosmetics = ["hat:ranger_hat", "neck:camera", "outfit:green_hoodie", "held:adventure_map", "eyes:round_glasses", "neck:red_scarf", "background:meadow", "friend:unknown", "color:brown", "bg:meadow"];
  d.friends[0].bear = { name: "Pip", hat: "ranger_hat", neck: "camera" };
  return d;
}

test("H8.2/5 catalog matches the manifest, item files, thumbnails, prices and milestone copy", () => {
  assert.deepEqual(SLOTS, ["hat", "eyes", "neck", "outfit", "bag", "held", "friend", "background"]);
  const items = COSMETICS.filter((c) => c.kind !== "background");
  assert.equal(items.length, 26);
  assert.equal(COSMETICS.length, 29);
  assert.equal(known.size, 29);
  assert.deepEqual(items.map((c) => c.value).sort(), Object.keys(manifest.items).sort());
  for (const folder of ["items/", "thumbs/"]) {
    assert.deepEqual(fs.readdirSync(new URL(folder, publicBear)).filter((file) => file.endsWith(".png")).sort(), items.map((c) => `${c.value}.png`).sort());
  }
  const prices = {
    explorer_hat: 60, straw_hat: 50, beanie: 30, baseball_cap: 40, sleep_cap: 20, flower_crown: null,
    round_glasses: 30, sunglasses: 40, red_scarf: 50, checkered_scarf: 50, bandana: 30, bow_tie: null,
    striped_shirt: 40, overalls: 50, cardigan: 60, sweater: 60, raincoat: 60, explorer_jacket: 80,
    camera: 60, small_purse: 40, map: 0, magnifying_glass: 30, leaf: 40, mug: 20, bee_friend: 0, butterfly_friend: 50,
  };
  for (const c of items) {
    assert.equal(c.kind, manifest.items[c.value].slot);
    assert.equal(c.label, manifest.items[c.value].label);
    assert.equal(c.cost, prices[c.value]);
  }
  assert.deepEqual(COSMETICS.filter((c) => c.milestone).map((c) => [c.id, c.milestone]), [["hat:flower_crown", 5000], ["neck:bow_tie", 2500], ["background:stars", 10000]]);
  assert.deepEqual(MILESTONES.slice(1, 4).map((m) => m.reward), ["Bow tie unlocked", "Flower crown unlocked", "Starry camp unlocked"]);
  assert.deepEqual(COSMETICS.filter((c) => c.kind === "background").map((c) => [c.id, c.cost]), [["background:forest", 0], ["background:meadow", 50], ["background:stars", null]]);
});

test("H8.3 seed and every practice friend use the new wardrobe", () => {
  for (const d of [seed(Date.now()), demoSeed(Date.now())]) {
    assert.deepEqual(d.child.ownedCosmetics, defaults);
    assert.deepEqual(d.child.bear, { name: "Maple", hat: null, eyes: null, neck: null, outfit: null, bag: null, held: null, friend: "bee_friend", background: "forest" });
    for (const code of ["SAM-12", "ZOE-88"]) game.addFriendByCode(d, code);
    for (const f of d.friends) validBear(f.bear);
    const before = structuredClone(d);
    migrate(d);
    assert.deepEqual(d, before, "fresh documents do not refresh again");
  }
});

test("H8.3 migration retires unknown IDs without refunds, grants defaults and earned milestones only once", () => {
  const d = legacy();
  d.child.points = 137;
  d.child.milestonesUnlocked = [1000, 2500, 5000, 10000];
  d.accounts.savings.balance = 0; // earned rewards survive later spending
  const money = structuredClone(d.accounts), transactions = structuredClone(d.transactions);
  migrate(d);
  assert.equal(d.wardrobeVersion, 2);
  assert.equal(d.child.points, 137);
  assert.deepEqual(d.accounts, money);
  assert.deepEqual(d.transactions, transactions);
  assert.deepEqual(new Set(d.child.ownedCosmetics), new Set([...defaults, "eyes:round_glasses", "neck:red_scarf", "background:meadow", "neck:bow_tie", "hat:flower_crown", "background:stars"]));
  assert.deepEqual(d.child.bear, { name: "Maple", hat: null, eyes: null, neck: null, outfit: null, bag: null, held: null, friend: null, background: "forest" });
  assert.equal(d.friends[0].bear.hat, "explorer_hat");
  assert.equal(d.friends[0].bear.bag, "camera");
  for (const f of d.friends) validBear(f.bear);
  assert.equal(d.audit.filter((a) => a.detail === "Wardrobe refreshed: new outfits, old ones retired").length, 1);
  d.child.bear.friend = null; // intentional None survives subsequent migration
  const refreshed = structuredClone(d);
  migrate(d);
  assert.deepEqual(d, refreshed);
});

test("H8.3 migration preserves known owned worn values and does not grant unreached milestones", () => {
  const d = legacy();
  d.child.bear.neck = "red_scarf";
  d.child.bear.eyes = "round_glasses";
  d.child.milestonesUnlocked = [1000, 2500];
  migrate(d);
  assert.equal(d.child.bear.neck, "red_scarf");
  assert.equal(d.child.bear.eyes, "round_glasses");
  assert.ok(d.child.ownedCosmetics.includes("neck:bow_tie"));
  assert.ok(!d.child.ownedCosmetics.includes("hat:flower_crown"));
  assert.ok(!d.child.ownedCosmetics.includes("background:stars"));
});

test("H8.3 refresh persists on SQLite read across restart without repeated audit or version changes", () => {
  const filename = path.join(scratch, "wardrobe.sqlite");
  const db = _databaseForTest(filename), d = legacy();
  db.prepare("INSERT INTO families (id,name,created_at) VALUES ('family','Parent',1)").run();
  db.prepare("INSERT INTO children (id,family_id,doc,version,updated_at) VALUES ('kid','family',?,7,1)").run(JSON.stringify(d));
  const migrated = structuredClone(readChild("kid"));
  assert.equal(migrated.wardrobeVersion, 2);
  assert.equal(db.prepare("SELECT version FROM children WHERE id = 'kid'").get().version, 7);
  _clearStoreForTest(); closeDatabase(); _databaseForTest(filename);
  assert.deepEqual(readChild("kid"), migrated);
  assert.deepEqual(JSON.parse(_databaseForTest(filename).prepare("SELECT doc FROM children WHERE id = 'kid'").get().doc), migrated);
  _clearStoreForTest(); closeDatabase();
});

test("H8.4 bag purchases equip and cost points; all new owned IDs equip and unknown or retired IDs reject unchanged", () => {
  const d = seed(Date.now());
  d.child.points = 200;
  game.buyCosmetic(d, "bag:camera");
  assert.equal(d.child.points, 140);
  assert.equal(d.child.bear.bag, "camera");
  game.equip(d, "bag", null);
  assert.equal(d.child.bear.bag, null);
  game.equip(d, "bag", "camera");
  assert.equal(d.child.bear.bag, "camera");
  for (const c of COSMETICS) {
    if (!d.child.ownedCosmetics.includes(c.id)) d.child.ownedCosmetics.push(c.id);
    game.equip(d, c.kind, c.value);
    assert.equal(d.child.bear[c.kind], c.value);
  }
  for (const id of ["hat:knit_beanie", "neck:camera", "held:adventure_map", "bag:unknown", "__proto__", null, {}]) {
    const before = structuredClone(d);
    assert.throws(() => game.buyCosmetic(d, id), game.GameError);
    assert.deepEqual(d, before);
  }
  for (const [kind, value] of [["bag", "unknown"], ["neck", "camera"], ["held", "adventure_map"], ["unknown", null], ["bag", {}]]) {
    const before = structuredClone(d);
    assert.throws(() => game.equip(d, kind, value), game.GameError);
    assert.deepEqual(d, before);
  }
});
