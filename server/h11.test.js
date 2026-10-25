import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { _databaseForTest, closeDatabase } from "./db.js";
import { _clearStoreForTest, _setForTest, readChild, seed } from "./store.js";
import { dispatch } from "./index.js";
import { _clearLimitsForTest, HOUR } from "./limits.js";
import { cancelReplan, snapshot, chat, _internals } from "./buddy.js";
import { COSMETICS, LESSONS } from "./catalog.js";
import { guides, lookup_help } from "./kb.js";
import { appHelp, renderMarkdown } from "./help.js";

const env = Object.fromEntries(["MQ_DEMO", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"].map((key) => [key, process.env[key]]));
beforeEach(() => {
  cancelReplan(); _clearLimitsForTest(); _clearStoreForTest(); _databaseForTest();
  for (const key of Object.keys(env)) delete process.env[key];
});
after(() => {
  cancelReplan(); closeDatabase();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function device(ip = "local") {
  let cookie = "";
  return { async call(method, url, body, now = Date.now()) {
    const parsed = new URL(url, "http://local");
    const req = Object.assign(new EventEmitter(), { headers: { cookie }, body, ip, query: Object.fromEntries(parsed.searchParams), get(key) { return this.headers[key.toLowerCase()]; } });
    const res = { headers: {}, statusCode: 200,
      set(key, value) { if (typeof key === "object") { for (const [k, v] of Object.entries(key)) this.set(k, v); } else this.headers[key.toLowerCase()] = value; return this; },
      status(value) { this.statusCode = value; return this; }, type(value) { this.headers["content-type"] = value; return this; },
      json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; },
    };
    await dispatch(method, parsed.pathname, req, res, now);
    if (res.headers["set-cookie"]) cookie = res.headers["set-cookie"].split(";")[0];
    return { status: res.statusCode, body: res.body, headers: res.headers };
  } };
}
async function family(name = "Mia") {
  const parent = device(name);
  const result = await parent.call("POST", "/api/auth/register", { email: `${name}@example.test`, password: "parent-password", parentName: "Private Parent", children: [
    { name: `${name} Jones`, age: 9, bearName: "Pip" }, { name: "Alex Jones", age: 8, bearName: "Sprout" },
  ] });
  assert.equal(result.status, 200);
  return { parent, id: result.body.activeChild.id, second: result.body.children[1].id };
}

test("H11.1 snapshot exposes real wardrobe, postcards, friends, lessons, budget, waiting receipts and current goal", () => {
  const db = seed(Date.now());
  db.child.bear.held = "map";
  db.child.lessonsDone = [LESSONS[0].id];
  db.child.lastBudget = { total: 1000, allocations: { save: 250, needs: 400, fun: 250, give: 100 }, plannedAt: Date.UTC(2026, 9, 24) };
  db.walletPending = [{ amount: 123 }, { amount: 277 }];
  db.friends[0].name = "Maya Smith";
  db.trades = Array.from({ length: 12 }, () => ({ status: "pending" }));
  db.postcards.push({ defId: "seattle", source: "trade", collectedAt: Date.now() });
  db.adventures.push({ status: "away", destId: "UNREVEALED_DESTINATION", returnsAt: Date.now() + 120000 });
  const snap = snapshot(db);
  assert.equal(snap.wardrobe.adventure_points, db.child.points);
  assert.equal(snap.wardrobe.wearing.held, "Adventure map");
  assert.ok(snap.wardrobe.owned.includes("Adventure map"));
  assert.equal(snap.wardrobe.affordable_now.length, 6);
  const costs = snap.wardrobe.affordable_now.map((c) => c.cost);
  assert.deepEqual(costs, costs.slice().sort((a, b) => a - b));
  for (const item of snap.wardrobe.affordable_now) {
    assert.ok(item.cost <= db.child.points);
    assert.ok(!snap.wardrobe.owned.includes(item.label));
    assert.ok(COSMETICS.some((c) => c.label === item.label && c.cost === item.cost));
  }
  const unowned = COSMETICS.filter((c) => c.cost != null && !snap.wardrobe.owned.includes(c.label));
  assert.equal(snap.wardrobe.shop.length, unowned.length);
  assert.ok(snap.wardrobe.shop.length > 6, "the whole shop, not only the six cheapest");
  assert.deepEqual(snap.wardrobe.shop.map((c) => c.cost), snap.wardrobe.shop.map((c) => c.cost).sort((a, b) => a - b));
  assert.deepEqual(snap.wardrobe.shop.find((c) => c.label === "Explorer jacket"), { label: "Explorer jacket", cost: 80, slot: "outfit", affordable: false });
  for (const item of snap.wardrobe.shop) { assert.equal(item.affordable, item.cost <= db.child.points); assert.ok(["hat", "eyes", "neck", "outfit", "bag", "held", "friend", "background"].includes(item.slot), item.slot); }
  assert.deepEqual(snap.wardrobe.next_unlock, { label: "Straw hat", cost: 50, points_short: 10 });
  assert.deepEqual(snap.postcards, { places_visited: 1, cards: 3, latest: { place: "Seattle", when: new Date().toISOString().slice(0, 10) }, bear_away: true, back_in_minutes: 2 });
  assert.deepEqual(snap.friends, { count: 1, names: ["Maya"], pending_requests: 1, pending_swaps: 12 });
  assert.deepEqual(snap.lessons, { finished: 1, total: LESSONS.length, next_titles: LESSONS.slice(1, 4).map((l) => l.title) });
  assert.deepEqual(snap.weekly_budget, { total: "$10.00", save: "$2.50", needs: "$4.00", fun: "$2.50", give: "$1.00", planned_on: "2026-10-24" });
  assert.deepEqual(snap.apple_cash_waiting, { count: 2, total: "$4.00" });
  assert.deepEqual(snap.current_goal, { title: "New bicycle", target: "$100.00", saved: "$20.00", weeks_left: 16 });
  assert.doesNotMatch(JSON.stringify(snap), /UNREVEALED_DESTINATION/);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot(seed()))) < 4000, "normal snapshot stays under 4 KB (the whole shop rides along)");
});

test("H11.1 snapshot redacts data and excludes codes, tokens, family labels, parents and pending peer names", () => {
  const db = seed();
  Object.assign(db.family, { parentName: "PRIVATE_PARENT", displayName: "PRIVATE_FAMILY", email: "parent@example.test", token: "PRIVATE_TOKEN" });
  Object.assign(db.child, { friendCode: "PRIVATE_CODE" });
  Object.assign(db.friends[0], { code: "FRIEND_CODE", familyLabel: "PEER_FAMILY", email: "peer@example.test" });
  db.friends[1].name = "PENDING_PEER";
  db.walletPending = [{ amount: 100, merchant: "PRIVATE_MERCHANT", external_id: "RECEIPT_ID" }];
  db.savingsGoals[0].title = "Bike email@example.test";
  db.transactions.at(-1).memo = "Phone 415-555-1234";
  const json = JSON.stringify(snapshot(db));
  assert.doesNotMatch(json, /PRIVATE_|FRIEND_CODE|PEER_FAMILY|PENDING_PEER|RECEIPT_ID|@example|415-555/);
  assert.match(json, /\[email removed\]/); assert.match(json, /\[phone number removed\]/);
  db.savingsGoals = []; db.postcards = []; db.friends = []; db.walletPending = [];
  db.child.ownedCosmetics = COSMETICS.map((c) => c.id);
  db.child.lessonsDone = LESSONS.map((l) => l.id);
  const empty = snapshot(db);
  assert.equal(empty.current_goal, null); assert.equal(empty.weekly_budget, null);
  assert.equal(empty.postcards.latest, null); assert.equal(empty.wardrobe.next_unlock, null);
  assert.deepEqual(empty.wardrobe.affordable_now, []); assert.deepEqual(empty.lessons.next_titles, []);
});

test("H11.4–6 guides load numbered sections, track every quoted UI label, and restrict audience search", () => {
  const client = new URL("../client/src/", import.meta.url);
  const source = readdirSync(client).filter((name) => name.endsWith(".jsx")).map((name) => readFileSync(new URL(name, client), "utf8")).join("\n");
  for (const audience of ["kid", "parent"]) {
    assert.ok(guides[audience].startsWith("# MoneyQuest"));
    for (const section of guides[audience].split(/^## /m).slice(1)) {
      assert.match(section, /\n1\. /); assert.match(section, /\nTip: /);
    }
    for (const match of guides[audience].matchAll(/“([^”]+)”|\*\*([^*]+)\*\*/g)) assert.ok(source.includes(match[1] || match[2]), `${audience} UI label: ${match[1] || match[2]}`);
  }
  for (const [question, audience, title] of [
    ["how do I add a friend", "kid", "Friends and swaps"],
    ["where do I put the kid code", "parent", "Kid codes and devices"],
    ["how does Apple Cash work", "parent", "Apple Cash and the Shortcut"],
    ["where are my clothes", "kid", "Dress up"],
    ["how do I go on an adventure", "kid", "Trips and the Album"],
    ["how do I rename my bear", "kid", "Me page"],
    ["how do I talk to Buddy", "kid", "Talking to Juniper"],
    ["how do I sign out", "parent", "Signing out"],
  ]) {
    const found = lookup_help(question, audience, "Juniper");
    assert.equal(found[0].title, title); assert.ok(found.length <= 2);
    assert.ok(found.every((section) => section.audience === audience));
    assert.doesNotMatch(JSON.stringify(found), /<bear>/);
  }
  for (const q of ["Security PIN", "Shortcut token", "parent settings", "kid code"]) assert.ok(lookup_help(q, "kid").every((s) => s.audience === "kid"));
  assert.deepEqual(lookup_help("xylophone nebula", "kid"), []);
  assert.deepEqual(lookup_help("friend", "unknown"), []);
  assert.deepEqual(lookup_help("friend", "__proto__"), []);
  assert.deepEqual(lookup_help("How do I set a PIN?", "kid"), []);
});

test("H11.2–3,6 stubbed Claude receives new snapshot fields and kid-only help with the bear name", async (t) => {
  _setForTest(seed()); readChild().child.bear.name = "Juniper";
  process.env.ANTHROPIC_API_KEY = "test-key";
  let calls = 0;
  t.mock.method(_internals, "callClaude", async (params) => {
    assert.match(params.system, /lookup_help/); assert.match(params.system, /wardrobe.*postcards.*lessons.next_titles.*weekly_budget/);
    const tool = params.tools.find((tool) => tool.name === "lookup_help");
    assert.ok(tool); assert.equal(tool.input_schema.properties.audience, undefined);
    if (calls++ === 0) return { stop_reason: "tool_use", content: [
      { type: "tool_use", id: "snap", name: "get_snapshot", input: {} },
      { type: "tool_use", id: "help", name: "lookup_help", input: { question: "how do I take a trip", audience: "parent" } },
    ] };
    const results = params.messages.at(-1).content.map((block) => JSON.parse(block.content));
    for (const key of ["wardrobe", "postcards", "friends", "lessons", "weekly_budget", "apple_cash_waiting", "current_goal"]) assert.ok(key in results[0]);
    assert.ok(results[1].every((section) => section.audience === "kid"));
    assert.match(JSON.stringify(results[1]), /Juniper/);
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Open Home." }] };
  });
  assert.equal((await _internals.runClaude([{ role: "user", content: "How do I take a trip?" }])).reply, "Open Home.");
  assert.equal(calls, 2);
});

test("H11.6,9 offline kid how-to answers use guide steps and custom bear, with no-match fallback", async () => {
  _setForTest(seed()); readChild().child.bear.name = "Juniper";
  const result = await chat("How do I send my bear on a trip?");
  assert.match(result.reply, /Juniper/); assert.match(result.reply, /\*\*Add to album\*\*/);
  assert.doesNotMatch(result.reply, /<bear>/);
  assert.match((await chat("Where is the xylophone nebula?")).reply, /couldn't find.*guide.*grown-up/);
  assert.match((await chat("How do I keep my password secret?")).reply, /grown-up you trust/);
  assert.match((await chat("How can I buy a $40 book?")).reply, /you'd need \$30.00 more/);
});

test("H11.7 parent help route requires parent unlock, validates input and isolates selected children", async () => {
  const a = await family();
  assert.equal((await device().call("POST", "/api/parent/help/ask", { question: "kid code" })).status, 401);
  const link = await a.parent.call("POST", `/api/parent/children/${a.id}/link`, {});
  const kid = device("kid"); await kid.call("POST", "/api/auth/link", { code: link.body.code });
  assert.equal((await kid.call("POST", "/api/parent/help/ask", { question: "kid code" })).status, 403);
  const b = await family("Ben");
  assert.equal((await a.parent.call("POST", `/api/parent/help/ask?child=${b.id}`, { question: "kid code" })).status, 404);
  for (const body of [null, [], {}, { question: 42 }, { question: " " }, { question: "x".repeat(501) }]) assert.equal((await a.parent.call("POST", "/api/parent/help/ask", body)).status, 400);
  await a.parent.call("POST", "/api/parent/pin", { pin: "1234" });
  await a.parent.call("POST", "/api/parent/lock", {});
  assert.equal((await a.parent.call("POST", "/api/parent/help/ask", { question: "kid code" })).status, 403);
  await a.parent.call("POST", "/api/parent/unlock", { pin: "1234" });
  const before = JSON.stringify(readChild(a.id));
  const help = await a.parent.call("POST", "/api/parent/help/ask", { question: "where do I put the kid code" });
  assert.equal(help.status, 200); assert.equal(help.body.mode, "offline");
  assert.match(help.body.answer, /Get a kid code/); assert.match(help.body.answer, /I have a kid code/);
  assert.equal(JSON.stringify(readChild(a.id)), before, "help pair is not saved and game data is unchanged");
});

test("H11.7 parent help quota shares 20/hour across children and sessions, then expires", async () => {
  const a = await family(), now = Date.now();
  const other = device("second-device");
  await other.call("POST", "/api/auth/login", { email: "Mia@example.test", password: "parent-password" });
  for (let i = 0; i < 20; i++) assert.equal((await (i % 2 ? other : a.parent).call("POST", `/api/parent/help/ask?child=${i % 2 ? a.second : a.id}`, { question: "Apple Cash" }, now)).status, 200);
  const limited = await other.call("POST", "/api/parent/help/ask", { question: "Apple Cash" }, now);
  assert.equal(limited.status, 429); assert.equal(limited.headers["retry-after"], "3600");
  const b = await family("Ben");
  assert.equal((await b.parent.call("POST", "/api/parent/help/ask", { question: "Apple Cash" }, now)).status, 200);
  assert.equal((await a.parent.call("POST", "/api/parent/help/ask", { question: "Apple Cash" }, now + HOUR)).status, 200);
});

test("H11.7 Claude parent help receives only family facts and parent-only tool results; nothing is stored", async (t) => {
  const a = await family();
  await a.parent.call("POST", "/api/parent/pin", { pin: "2468" });
  const credential = await a.parent.call("POST", "/api/child/wallet/token", {});
  // Ping using a bearer credential without sending the token to the model.
  const tokenReq = { headers: { authorization: `Bearer ${credential.body.token}` }, body: {}, ip: "shortcut", get(key) { return this.headers[key]; } };
  const tokenRes = { set() { return this; }, json(body) { this.body = body; }, status(code) { this.code = code; return this; } };
  await dispatch("POST", "/api/child/wallet/ping", tokenReq, tokenRes);
  assert.equal(tokenRes.code, undefined);
  const before = JSON.stringify(readChild(a.id));
  process.env.ANTHROPIC_API_KEY = "test-key";
  let calls = 0;
  t.mock.method(_internals, "callClaude", async (params) => {
    const payload = JSON.stringify(params);
    assert.doesNotMatch(payload, /Private Parent|Jones|@example|parent-password|2468/);
    assert.ok(!payload.includes(credential.body.token));
    assert.match(params.system, /"children":\["Mia","Alex"\]/);
    assert.match(params.system, /"selected_child":"Mia"/); assert.match(params.system, /"pin_set":true/); assert.match(params.system, /"shortcut_connected":true/);
    assert.equal(params.tools.length, 1);
    if (calls++ === 0) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "help", name: "lookup_help", input: { question: "Apple Cash", audience: "kid" } }] };
    const results = JSON.parse(params.messages.at(-1).content[0].content);
    assert.ok(results.every((section) => section.audience === "parent"));
    assert.match(JSON.stringify(results), /Generate Shortcut token/);
    return { stop_reason: "end_turn", content: [{ type: "text", text: "1. Open **Children**.\n2. Check **Apple Cash tracking**." }] };
  });
  t.mock.method(_internals, "runGuard", () => { throw new Error("adult help must not run the child guard"); });
  const result = await a.parent.call("POST", "/api/parent/help/ask", { question: "Apple Cash, my email is private@example.test" });
  assert.equal(result.status, 200); assert.equal(result.body.mode, "claude"); assert.equal(calls, 2);
  assert.equal(JSON.stringify(readChild(a.id)), before);
});

test("H11.7 provider failure and empty/no-match answers fall back to local parent guide", async (t) => {
  const a = await family(); process.env.ANTHROPIC_API_KEY = "test-key";
  t.mock.method(_internals, "callClaude", async () => { throw new Error("offline"); });
  const result = await a.parent.call("POST", "/api/parent/help/ask", { question: "Apple Cash" });
  assert.equal(result.body.mode, "offline"); assert.match(result.body.answer, /\/help\/apple-cash/);
  const empty = await a.parent.call("POST", "/api/parent/help/ask", { question: "xylophone nebula" });
  assert.match(empty.body.answer, /couldn't find/);
});

test("H11.8 public help renders parent then kid guides with escaped content and no request interpolation", async () => {
  const result = await device().call("GET", "/help?bear=%3Cscript%3E&token=PRIVATE_TOKEN");
  assert.equal(result.status, 200); assert.equal(result.headers["content-type"], "html");
  assert.ok(result.body.indexOf("MoneyQuest for parents") < result.body.indexOf("MoneyQuest for kids"));
  assert.match(result.body, /<ol><li>/); assert.match(result.body, /<strong>Get a kid code<\/strong>/);
  assert.match(result.body, /href="\/help\/apple-cash"/);
  assert.doesNotMatch(result.body, /PRIVATE_TOKEN|<script>|<bear>/);
  assert.equal(result.body, appHelp());
  const escaped = renderMarkdown('## <script>alert(1)</script>\n1. **<img onerror="bad">**\nTip: <bear> & friends');
  assert.match(escaped, /&lt;script&gt;/); assert.match(escaped, /&lt;img/); assert.match(escaped, /&lt;bear&gt; &amp;/);
  assert.doesNotMatch(escaped, /<script|<img/);
});

test("H11.6b the kid guide travels inside the bear's system prompt with the bear's name", () => {
  const db = seed(Date.now()); db.child.bear.name = "Pecan";
  const prompt = _internals.systemPrompt(db);
  assert.match(prompt, /How MoneyQuest works/);
  assert.match(prompt, /## Goals/); assert.match(prompt, /Switch goal/);
  assert.ok(prompt.includes("Tap Pecan at home to talk") || prompt.includes("Pecan"));
  assert.ok(!prompt.includes("<bear>") && !prompt.includes("# MoneyQuest for kids"));
});
