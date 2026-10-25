import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seed } from "./store.js";
import { requestGoalPurchase } from "./domain.js";
import { dispatch } from "./index.js";
import { _internals, askParentHelp } from "./buddy.js";
import { guides, helpAnswer, HELP_TOOL, lookup_help } from "./kb.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("H13.1 install metadata names Bearly Spent and keeps the tagline", () => {
  const manifest = JSON.parse(read("../client/public/manifest.webmanifest"));
  assert.equal(manifest.name, "Bearly Spent");
  assert.equal(manifest.short_name, "Bearly Spent");
  assert.equal(manifest.description, "Save money. Grow your bear. Explore the world.");
  const html = read("../client/index.html");
  assert.match(html, /<title>Bearly Spent<\/title>/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Bearly Spent"/);
  assert.match(html, /<meta name="description" content="Save money\. Grow your bear\. Explore the world\."/);
  assert.doesNotMatch(html, /MoneyQuest/);
});

test("H13.1 both guides name Bearly Spent throughout", () => {
  for (const audience of ["kid", "parent"]) {
    assert.ok(guides[audience].startsWith(`# Bearly Spent for ${audience === "kid" ? "kids" : "parents"}`));
    assert.doesNotMatch(guides[audience], /MoneyQuest/);
  }
  assert.match(guides.parent, /\*\*Ask about Bearly Spent\*\*/);
});

test("H13.1 Buddy system and safety guard prompts name Bearly Spent", async (t) => {
  const prompt = _internals.systemPrompt(seed(Date.now()));
  assert.match(prompt, /friendly AI sidekick inside Bearly Spent\./);
  assert.match(prompt, /How Bearly Spent works/);
  assert.doesNotMatch(prompt, /MoneyQuest/);
  t.mock.method(_internals, "callGuard", async (params) => {
    assert.match(params.system, /using the Bearly Spent app/);
    assert.doesNotMatch(params.system, /MoneyQuest/);
    return { content: [{ type: "text", text: "OK" }] };
  });
  assert.equal(await _internals.runGuard("Open Goals."), "OK");
});

test("H13.1 parent help prompt names Bearly Spent", async (t) => {
  const key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  t.after(() => {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = key;
  });
  let calls = 0;
  t.mock.method(_internals, "callClaude", async (params) => {
    calls++;
    assert.match(params.system, /using Bearly Spent in a plain adult tone/);
    assert.match(params.system, /not stored by Bearly Spent/);
    assert.doesNotMatch(params.system, /MoneyQuest/);
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Open Children." }] };
  });
  assert.deepEqual(await askParentHelp("Where are kid codes?", {}, "Maple"), { answer: "Open Children.", mode: "claude" });
  assert.equal(calls, 1);
});

test("H13.1 GET help pages use Bearly Spent titles and return links", async () => {
  for (const [path, title] of [["/help", "Help"], ["/help/apple-cash", "Apple Cash tracking"]]) {
    const req = { headers: {}, get: () => "family.example.test", protocol: "https" };
    const res = { headers: {}, statusCode: 200,
      set(key, value) { if (typeof key === "object") Object.assign(this.headers, key); else this.headers[key] = value; return this; },
      status(value) { this.statusCode = value; return this; }, type(value) { this.contentType = value; return this; },
      send(value) { this.body = value; return this; }, json(value) { this.body = value; return this; },
    };
    await dispatch("GET", path, req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.contentType, "html");
    assert.ok(res.body.includes(`<title>${title} · Bearly Spent</title>`));
    assert.match(res.body, /Back to Bearly Spent<\/a>/);
    assert.doesNotMatch(res.body, /MoneyQuest/);
    if (path === "/help/apple-cash") assert.match(res.body, /https:\/\/family\.example\.test\/api\/child\/wallet\/spend/);
  }
});

test("H13.1 help fallback and tool description use Bearly Spent", () => {
  const answer = helpAnswer("xylophone nebula", "parent", "Maple");
  assert.match(answer, /Bearly Spent guide/);
  assert.match(HELP_TOOL.description, /Bearly Spent guide sections/);
  assert.doesNotMatch(answer + HELP_TOOL.description, /MoneyQuest/);
});

test("H13.1 help search ignores the product name when matching features", () => {
  for (const audience of ["kid", "parent"]) {
    assert.deepEqual(lookup_help("Bearly Spent", audience), []);
    assert.deepEqual(lookup_help("Bearly Spent kid code", audience), lookup_help("kid code", audience));
  }
  assert.ok(lookup_help("Spent", "kid").some(({ title }) => title === "Saving and spending"));
});

test("H13.1 goal purchase approval names Bearly Spent", () => {
  const db = seed(Date.now()), goal = db.savingsGoals[0];
  db.accounts.savings.balance = goal.target;
  const approval = requestGoalPurchase(db, goal.id);
  assert.equal(approval.detail, "Approve after buying it. Bearly Spent records the purchase; it does not buy or send real money.");
});
