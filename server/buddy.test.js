import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Keep store mutations away from the real data directory. Each test starts
// with the same in-memory seed as the domain tests.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "moneyquest-buddy-"));
const env = Object.fromEntries(["MQ_DATA_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "BUDDY_GUARD_MODEL"].map((key) => [key, process.env[key]]));
process.env.MQ_DATA_DIR = dataDir;
process.env.ANTHROPIC_API_KEY = "test-key";
delete process.env.ANTHROPIC_AUTH_TOKEN;
const { seed, read, reset, _setForTest } = await import("./store.js");
const { childSpend, onMoneyChanged } = await import("./domain.js");
const {
  PII, redact, snapshot, parsePrice, isSafetyConcern, offlinePlan, offlineReply,
  chat, replan, queueReplan, cancelReplan, _internals,
} = await import("./buddy.js");

const runGuard = _internals.runGuard;

beforeEach((t) => {
  cancelReplan();
  _setForTest(seed(Date.now()));
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.BUDDY_GUARD_MODEL;
  t.mock.method(_internals, "runGuard", async () => "OK");
});

after(() => {
  cancelReplan();
  onMoneyChanged(() => {});
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const allowedKidWords = [
  "pink", "pins", "pint", "pinecone", "spin", "shopping", "piñata", "pinball",
  "spinach", "pineapple", "the pass is", "is 5 dollars", "my pin badge",
];
const ordinaryKidSentences = [
  "Can I buy a pink bike for $40?",
  "I saved my coins in a jar.",
  "These pins cost two dollars at the school fair.",
  "A pint of milk goes with my lunch.",
  "I found a pinecone while walking my dog.",
  "Can I spin the prize wheel in the game?",
  "We are shopping for a new board game.",
  "The piñata has candy for our class party.",
  "I saved a dollar to play pinball.",
  "My rabbit likes spinach for a snack.",
  "I packed pineapple in my school lunch.",
  "In our game, the pass is a ticket to the next level.",
  "The toy I want is 5 dollars.",
  "I put my pin badge on my backpack.",
  "My puppy learned to sit today.",
  "Can I save half of my allowance each week?",
  "I earned three coins by finishing a mission.",
  "Our class is reading a book about animals.",
  "My kitten sleeps beside my piggy bank.",
  "Should I buy a toy or save for a bike?",
  "I traded game cards with my friend at recess.",
  "Our hamster runs on its wheel after dinner.",
  "I need a pencil for math class.",
  "I want to learn how a budget works.",
  "We played a counting game at school.",
  "My goldfish swims around its little castle.",
  "Can I spend $2 on stickers and save the rest?",
  "I helped tidy the classroom after art.",
  "I won a star in my favorite puzzle game.",
  "My savings goal is a soft toy bear.",
];
const redactionFixtures = [
  ["phone number", "(415) 555-1234"],
  ["phone number", "415.555.1234"],
  ["phone number", "+1 415 555 1234"],
  ["phone number", "+14155551234"],
  ["phone number", "1-415-555-1234"],
  ["phone number", "1 415 555 1234"],
  ["phone number", "1.415.555.1234"],
  ["phone number", "415-555-1234"],
  ["phone number", "4155551234"],
  ["email", "mia@example.com"],
  ["SSN", "123-45-6789"],
  ["address", "123 Main St"],
  ["address", "123 Martin Luther King Blvd"],
  ["address", "123 North Martin Luther King Boulevard"],
  ["card number", "4111 1111 1111 1111"],
  ["password", "password is hunter2"],
  ["password", "password is: 1234"],
  ["password", "password is = 1234"],
  ["password", "pin is:1234"],
  ["password", "pin: 1234"],
  ["password", "passcode = 9876"],
  ["password", "PIN IS 1234"],
];

test("redaction covers every exported PII rule and all supported formats", () => {
  assert.deepEqual(new Set(PII.map((rule) => rule.label)), new Set(redactionFixtures.map(([label]) => label)));
  for (const [label, input] of redactionFixtures) {
    assert.deepEqual(redact(input), { text: `[${label} removed]`, found: [label] }, input);
    // Global regex state must not affect the next call.
    assert.deepEqual(redact(input), { text: `[${label} removed]`, found: [label] }, input);
  }
  assert.equal(redact("my passcode = 9876").text, "my [password removed]");
});

test("password redaction leaves allowed kid words and unassigned keywords alone", () => {
  for (const word of allowedKidWords) {
    const text = `Can I buy a ${word} bike for $40?`;
    assert.deepEqual(redact(text), { text, found: [] });
  }
  for (const text of [
    "pin island", "password ideas", "my pin 1234", "my school is Oak Elementary",
    "password is", "password is ", "password is:", "password is = ",
  ]) {
    assert.deepEqual(redact(text), { text, found: [] });
  }
  assert.match(offlineReply(read(), redact("Can I buy a pink bike for $40?").text), /you'd need \$30.00 more/);
});

test("all PII rules leave 30 ordinary kid sentences unchanged with zero redactions", () => {
  assert.equal(ordinaryKidSentences.length, 30);
  for (const word of allowedKidWords) {
    assert.ok(ordinaryKidSentences.some((text) => text.includes(word)), word);
  }
  for (const text of ordinaryKidSentences) {
    for (const { re, label } of PII) {
      re.lastIndex = 0;
      assert.equal(re.test(text), false, `${label}: ${text}`);
      re.lastIndex = 0;
    }
    assert.deepEqual(redact(text), { text, found: [] }, text);
  }
});

test("parsePrice returns cents for comma prices, decimals and dollar words", () => {
  for (const [text, expected] of [
    ["$1,000", 100000], ["$1,000.50", 100050], ["1000 dollars", 100000],
    ["5 dollar", 500], ["5 buck", 500], ["5 bucks", 500], ["$12.50", 1250],
    ["Can I buy a $1,000 bike?", 100000], ["It costs $12.50.", 1250],
    ["1,000.50 dollars", 100050], ["$0.01", 1], ["$0", 0],
    ["I have 12 points", null], ["No price here", null], ["$1,00", null],
    ["$9007199254740992", null],
  ]) assert.equal(parsePrice(text), expected, text);
  assert.match(offlineReply(read(), "Can I buy a $1,000 bike?"), /you'd need \$990.00 more/);
  assert.match(offlineReply(read(), "Can I buy a book for 5 dollar?"), /still have \$5.00 left/);
  assert.match(offlineReply(read(), "Can I buy a book for 5 buck?"), /still have \$5.00 left/);
});

test("isSafetyConcern uses phrases while ordinary money and game questions still work", () => {
  for (const text of [
    "I'm scared", "Im scared", "I am scared", "a bully", "I was bullied", "bullying",
    "He hurt me", "She hurts me", "Someone asked for money", "Someone wants my coins",
    "Someone is asking me", "a stranger", "I feel unsafe", "my password", "my secret",
    "keep it secret", "keep this a secret",
  ]) {
    assert.equal(isSafetyConcern(text), true, text);
    assert.match(offlineReply(read(), text), /talk to a grown-up you trust right away/);
  }
  for (const text of [
    "Would buying a $15 game hurt my savings?", "How do I find the secret places?",
    "Can I buy a pink bike?", "The price is scary", "I hurt my savings", "secret places",
  ]) {
    assert.equal(isSafetyConcern(text), false, text);
    assert.doesNotMatch(offlineReply(read(), text), /talk to a grown-up you trust right away/);
  }
  assert.match(offlineReply(read(), "Would buying a $15 game hurt my savings?"), /you'd need \$5.00 more/);
  assert.match(offlineReply(read(), "How do I find the secret places?"), /missions and lessons.*send Maple on a trip from Home! Secret places.*saving habits/);
});

test("offline plans and all goal and purchase replies explain missing weekly savings", () => {
  for (const allowance of [{ savePct: 0 }, { amount: 0 }]) {
    const db = seed(Date.now());
    Object.assign(db.allowance, allowance);
    const plan = offlinePlan(db, "test");
    assert.match(plan.summary, /nothing goes to savings each week/);
    assert.doesNotMatch(JSON.stringify(plan), /null weeks|saving \$0.00 from/);
    for (const text of ["When will I reach my goal?", "Can I buy a $40 game?", "Make me a plan"]) {
      const reply = offlineReply(db, text);
      assert.match(reply, /ask your grown-up to set a saving amount/);
      assert.doesNotMatch(reply, /null|undefined/);
    }
    // Already meeting a goal still takes zero weeks; buying can change that.
    db.accounts.savings.balance = db.savingsGoals[0].target;
    assert.match(offlineReply(db, "When will I reach my goal?"), /already saved enough/);
    assert.match(offlinePlan(db, "test").summary, /You reached/);
    assert.match(offlineReply(db, "Can I buy a $40 game?"), /nothing goes to savings each week/);
  }
  assert.match(offlinePlan(read(), "test").summary, /about 16 weeks/);
  assert.match(offlineReply(read(), "When will I reach my goal?"), /about 16 more weeks/);
});

test("purchase memos are redacted in snapshot JSON and automatic replan prompts", async (t) => {
  let reason;
  onMoneyChanged((text) => { reason = text; });
  t.after(() => onMoneyChanged(() => {}));
  const memo = "Book from mia@example.com";
  childSpend(read(), { amount: 100, memo }, () => ({ hold: false }));
  assert.equal(read().transactions.at(-1).memo, memo);
  const json = JSON.stringify(snapshot(read()));
  assert.ok(json.includes("[email removed]"));
  assert.ok(!json.includes("mia@example.com"));
  t.mock.method(_internals, "runClaude", async (messages) => {
    assert.match(messages[0].content, /Book from \[email removed\]/);
    assert.doesNotMatch(JSON.stringify(messages), /mia@example.com/);
    return { reply: "No change needed.", toolsUsed: [] };
  });
  await replan(reason);
});

test("model boundary redacts system data, tool inputs echoed back and tool results", async (t) => {
  read().child.bear.name = "bear@example.com";
  read().savingsGoals[0].title = "Bike from goal@example.com";
  read().transactions.at(-1).memo = "Book from memo@example.com";
  let calls = 0;
  t.mock.method(_internals, "callClaude", async (params) => {
    assert.doesNotMatch(JSON.stringify(params), /[\w.+-]+@example\.com/);
    assert.match(params.system, /\[email removed\]/);
    if (calls++ === 0) return {
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "snapshot", name: "get_snapshot", input: {} },
        { type: "tool_use", id: "simulation", name: "simulate_purchase", input: { price_dollars: 40, pay_from: "spending", memo: "input@example.com" } },
      ],
    };
    const echoed = params.messages[1].content[1].input;
    assert.equal(echoed.memo, "[email removed]");
    const results = params.messages[2].content.map((block) => JSON.parse(block.content));
    assert.match(results[0].recent_transactions.at(-1).what, /\[email removed\]/);
    assert.match(results[1].goal_impact[0].goal, /\[email removed\]/);
    return { stop_reason: "end_turn", content: [{ type: "text", text: "Let's save a little." }] };
  });
  await replan("new purchase");
  assert.equal(calls, 2);
});

test("chat stores redacted user text and redacts older history before Claude", async (t) => {
  read().buddy.chat.push(
    { role: "user", text: "Old user old@example.com" },
    { role: "assistant", text: "Old note note@example.com" },
  );
  t.mock.method(_internals, "runClaude", async (messages) => {
    assert.doesNotMatch(JSON.stringify(messages), /[\w.+-]+@example\.com/);
    assert.match(JSON.stringify(messages), /\[email removed\]/);
    return { reply: "Let's check your savings.", toolsUsed: [] };
  });
  await chat("My email is new@example.com");
  assert.equal(read().buddy.chat.at(-2).text, "My email is [email removed]");
  assert.deepEqual(read().buddy.chat.at(-2).redacted, ["email"]);
});

const planInput = (summary) => ({ summary, weekly_save_dollars: 5, steps: ["Save a little"] });
const controlledModel = (t) => {
  const pending = [];
  t.mock.method(_internals, "runClaude", (messages, { executeTool }) => new Promise((resolve, reject) => {
    pending.push({ messages, executeTool, resolve, reject });
  }));
  return pending;
};
const finishPlan = (call, summary) => {
  const result = call.executeTool("update_savings_plan", planInput(summary));
  call.resolve({ reply: summary, toolsUsed: ["update_savings_plan"], completed: true });
  return result;
};

test("replan ordering prevents older tool writes and notes overwriting a newer plan", async (t) => {
  const pending = controlledModel(t);
  const older = replan("balance was $20");
  const newer = replan("balance is $25");
  assert.equal(finishPlan(pending[1], "New $25 plan").ok, true);
  await newer;
  assert.match(finishPlan(pending[0], "Old $20 plan").error, /no longer needed/);
  await older;
  assert.equal(read().buddy.plan.summary, "New $25 plan");
  assert.equal(read().buddy.plan.reason, "balance is $25");
  assert.deepEqual(read().buddy.chat.map((m) => m.text), ["New $25 plan"]);
  assert.equal(read().audit.filter((a) => a.action === "plan_updated").length, 1);
});

test("a queued money event invalidates an older plan before the debounce fires", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = controlledModel(t);
  const older = replan("old event");
  queueReplan("new event");
  assert.ok(finishPlan(pending[0], "Old plan").error);
  await older;
  assert.equal(read().buddy.plan, null);
  assert.equal(read().buddy.chat.length, 0);
  cancelReplan();
});

test("reset cancels the timer, clears queued reasons and blocks in-flight writes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = controlledModel(t);
  const older = replan("old in-flight event");
  queueReplan("old queued memo");
  cancelReplan();
  reset();
  const freshDb = read();
  assert.ok(finishPlan(pending[0], "Stale plan").error);
  await older;
  t.mock.timers.tick(1500);
  assert.equal(pending.length, 1, "the cancelled timer never runs");
  assert.equal(freshDb.buddy.plan, null);
  assert.equal(freshDb.buddy.chat.length, 0);
  assert.equal(freshDb.audit.length, 0);
  queueReplan("fresh event");
  t.mock.timers.tick(1500);
  assert.equal(pending.length, 2);
  assert.match(pending[1].messages[0].content, /fresh event/);
  assert.doesNotMatch(pending[1].messages[0].content, /old queued memo/);
  finishPlan(pending[1], "Fresh plan");
  await new Promise(setImmediate);
  assert.equal(read().buddy.plan.summary, "Fresh plan");
});

test("disabling Buddy while a model is running blocks plan tools and chat notes", async (t) => {
  const pending = controlledModel(t);
  const task = replan("purchase");
  read().settings.buddyEnabled = false;
  assert.ok(finishPlan(pending[0], "Disabled plan").error);
  assert.ok(pending[0].executeTool("propose_mission", { title: "Stale mission", points: 20 }).error);
  await task;
  assert.equal(read().buddy.plan, null);
  assert.equal(read().buddy.chat.length, 0);
  assert.equal(read().approvals.filter((a) => a.kind === "mission_proposal").length, 0);
  assert.equal(read().audit.length, 0);
  await replan("still disabled");
  assert.equal(pending.length, 1);
});

test("disabling Buddy after the plan tool also blocks the final chat note", async (t) => {
  const pending = controlledModel(t);
  const task = replan("purchase");
  pending[0].executeTool("update_savings_plan", planInput("Current plan"));
  read().settings.buddyEnabled = false;
  pending[0].resolve({ reply: "Late note", completed: true });
  await task;
  assert.equal(read().buddy.plan.summary, "Current plan");
  assert.equal(read().buddy.chat.length, 0);
});

test("stale model errors cannot install an offline fallback after reset", async (t) => {
  const pending = controlledModel(t);
  t.mock.method(console, "error", () => {});
  const task = replan("old event");
  cancelReplan();
  reset();
  pending[0].reject(new Error("connection failed"));
  await task;
  assert.equal(read().buddy.plan, null);
  assert.equal(read().buddy.chat.length, 0);
});

test("offline replans honor disabled Buddy and redact their saved reason", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await replan("Bought from mia@example.com");
  assert.equal(read().buddy.plan.reason, "Bought from [email removed]");
  assert.doesNotMatch(JSON.stringify(read().audit), /mia@example.com/);
  const plan = read().buddy.plan;
  read().settings.buddyEnabled = false;
  await replan("disabled event");
  assert.equal(read().buddy.plan, plan);
});

test("replan replies without a successful plan tool are audited without auto notes", async (t) => {
  read().buddy.plan = offlinePlan(read(), "existing plan");
  t.mock.method(_internals, "runClaude", async () => ({ reply: "No update needed.", toolsUsed: [] }));
  await replan("purchase");
  assert.equal(read().buddy.chat.length, 0);
  assert.equal(read().buddy.plan.reason, "existing plan");
  assert.equal(read().audit.at(-1).action, "replan_no_note");
});

test("refusal and loop-exhausted fallbacks never become auto plan notes", async (t) => {
  for (const outcome of ["refusal", "loop"]) {
    _setForTest(seed(Date.now()));
    let calls = 0;
    const stub = t.mock.method(_internals, "callClaude", async () => {
      calls += 1;
      if (outcome === "refusal") return { stop_reason: "refusal", content: [] };
      return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `plan_${calls}`, name: "update_savings_plan", input: planInput("Saving plan") }] };
    });
    await replan("purchase");
    assert.equal(calls, outcome === "refusal" ? 1 : 6);
    assert.equal(read().buddy.chat.length, 0);
    assert.equal(read().audit.at(-1).action, "replan_no_note");
    stub.mock.restore();
  }
});

test("a completed model plan update posts one cheerful auto note", async (t) => {
  let calls = 0;
  t.mock.method(_internals, "callClaude", async () => calls++ === 0
    ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "plan", name: "update_savings_plan", input: planInput("Keep saving $5 each week") }] }
    : { stop_reason: "end_turn", content: [{ type: "text", text: "You're getting closer!" }] });
  await replan("saved $5");
  assert.equal(read().buddy.plan.summary, "Keep saving $5 each week");
  assert.equal(read().buddy.plan.reason, "saved $5");
  assert.equal(read().buddy.chat.length, 1);
  assert.equal(read().buddy.chat[0].auto, true);
  assert.equal(read().buddy.chat[0].text, "You're getting closer!");
});

const guardFallback = "Hmm, let's talk about your savings or Maple's next trip instead! Want to see how close you are to your goal?";

test("systemPrompt includes child background, every content rule and money-tool rules under 1800 words (the kid guide rides along)", () => {
  const prompt = _internals.systemPrompt(read());
  for (const keyword of [
    "Who you are talking to", "7–12", "alone with the device", "parent reads every transcript",
    "money-learning game", "bear named by the child", "Mia", "9 years old", "Maple",
    "Content rules", "violence", "horror", "sexual", "romantic", "drugs", "alcohol", "gambling",
    "self-harm", "hate", "politics", "religion", "personal details", "links", "app/store recommendations",
    "pretending to be a human or a parent", "promises about real money", "one gentle sentence",
    "trusted grown-up", "return to money or the bear", "get_snapshot", "simulate_purchase",
    "update_savings_plan", "propose_mission", "cannot move, send, or spend money",
  ]) assert.ok(prompt.includes(keyword), keyword);
  assert.ok(prompt.split(/\s+/).length < 1800);
});

test("guard BLOCK replaces a chat reply and only audits the first 80 blocked characters", async (t) => {
  const blocked = "An unsuitable model reply. ".repeat(6);
  t.mock.method(_internals, "runClaude", async () => ({ reply: blocked, toolsUsed: ["get_snapshot"] }));
  t.mock.method(_internals, "runGuard", async (reply) => {
    assert.equal(reply, blocked);
    assert.ok(!JSON.stringify(read().buddy.chat).includes(blocked), "screen before storing");
    return "BLOCK";
  });
  const result = await chat("How is my goal going?");
  assert.equal(result.reply, guardFallback);
  assert.deepEqual(result.toolsUsed, ["get_snapshot"]);
  assert.equal(read().buddy.chat.at(-1).text, guardFallback);
  assert.ok(!JSON.stringify(read().buddy.chat).includes(blocked));
  assert.equal(read().audit.at(-1).action, "buddy_guard_blocked");
  assert.equal(read().audit.at(-1).detail, blocked.slice(0, 80));
});

test("a throwing guard blocks the chat reply", async (t) => {
  const blocked = "An unchecked reply.";
  t.mock.method(_internals, "runClaude", async () => ({ reply: blocked }));
  t.mock.method(_internals, "runGuard", async () => { throw new Error("guard unavailable"); });
  assert.equal((await chat("How much have I saved?")).reply, guardFallback);
  assert.equal(read().audit.at(-1).action, "buddy_guard_blocked");
  assert.ok(!read().buddy.chat.some((m) => m.text === blocked));
});

test("only OK from the guard (surrounding whitespace allowed) lets a chat reply pass unchanged", async (t) => {
  const reply = "You have $20 saved. Want to save a little more?";
  t.mock.method(_internals, "runClaude", async () => ({ reply }));
  for (const verdict of ["OK", "OK.", " OK", "OK\n", "okay", "", null, undefined]) {
    _setForTest(seed(Date.now()));
    const guard = t.mock.method(_internals, "runGuard", async () => verdict);
    const passes = typeof verdict === "string" && verdict.trim() === "OK";
    const expected = passes ? reply : guardFallback;
    assert.equal((await chat("How much have I saved?")).reply, expected, JSON.stringify(verdict));
    assert.equal(read().buddy.chat.at(-1).text, expected);
    assert.equal(read().audit.some((a) => a.action === "buddy_guard_blocked"), !passes);
    guard.mock.restore();
  }
});

test("an empty guard verdict is retried once; two empties still block", async (t) => {
  let calls = 0;
  t.mock.method(_internals, "callGuard", async () => ({ content: calls++ === 0 ? [] : [{ type: "text", text: " OK\n" }] }));
  assert.equal(await runGuard("Save a little."), "OK"); assert.equal(calls, 2);
  calls = 0;
  t.mock.method(_internals, "callGuard", async () => { calls++; return { content: [{ type: "text", text: "  " }] }; });
  assert.equal(await runGuard("Save a little."), ""); assert.equal(calls, 2);
  calls = 0;
  t.mock.method(_internals, "callGuard", async () => { calls++; return { content: [{ type: "text", text: "BLOCK" }] }; });
  assert.equal(await runGuard("Save a little."), "BLOCK"); assert.equal(calls, 1, "a real verdict is never retried");
});

test("guard request uses its own model, strict prompt, five tokens and no thinking", async (t) => {
  t.mock.method(_internals, "runGuard", runGuard);
  const requests = [];
  t.mock.method(_internals, "callGuard", async (params) => {
    requests.push(params);
    return { content: [{ type: "text", text: "OK" }] };
  });
  assert.equal(await _internals.runGuard("Save a little."), "OK");
  process.env.BUDDY_GUARD_MODEL = "test-guard-model";
  assert.equal(await _internals.runGuard("Save with memo@example.com"), "OK");
  assert.equal(requests[0].model, "claude-haiku-5-5");
  assert.equal(requests[1].model, "test-guard-model");
  assert.deepEqual(requests[0].messages, [{ role: "user", content: "Save a little." }]);
  assert.deepEqual(requests[1].messages, [{ role: "user", content: "Save with [email removed]" }]);
  for (const params of requests) {
    assert.equal(params.max_tokens, 5);
    assert.equal(params.system, "You check messages written to a child aged 7–12 inside a money-learning game. Answer with exactly OK or BLOCK. BLOCK if the message contains or alludes to: violence, horror, sexual/romantic content, drugs/alcohol/gambling, self-harm, hate or slurs, personal data requests, links, promises that the bear or the app will give, send or win real money, or anything a careful parent would not want a 9-year-old to read. Talking about the child's own allowance, savings, spending, goals, prices, points and budgets is the whole point of the game and is always OK, numbers included. Plain instructions for using the Bearly Spent app are always OK: friend codes and friend requests, postcard swaps, the bear's trips, savings goals, missions, lessons, the weekly budget, Apple Cash receipts, dressing the bear, the Me sheet, signing out, or what a parent sees. Otherwise OK.");
    for (const allowed of ["friend codes", "trips", "savings goals", "missions", "lessons", "dressing the bear", "signing out", "what a parent sees", "allowance, savings, spending, goals, prices, points and budgets", "numbers included"]) assert.ok(params.system.includes(allowed), allowed);
    for (const key of ["thinking", "output_config", "tools", "betas", "fallbacks"]) assert.ok(!(key in params), key);
  }
});

test("automatic plan notes are screened and replace blocked or unchecked text before storing", async (t) => {
  const pending = controlledModel(t);
  for (const verdict of ["BLOCK", "throw", "OK"]) {
    _setForTest(seed(Date.now()));
    const note = "A model-written plan note.";
    const guard = t.mock.method(_internals, "runGuard", async (reply) => {
      assert.equal(reply, note);
      assert.equal(read().buddy.chat.length, 0);
      if (verdict === "throw") throw new Error("guard unavailable");
      return verdict;
    });
    const task = replan("saved $5");
    finishPlan(pending.at(-1), note);
    await task;
    assert.equal(read().buddy.chat.length, 1);
    assert.equal(read().buddy.chat[0].auto, true);
    assert.equal(read().buddy.chat[0].text, verdict === "OK" ? note : guardFallback);
    assert.equal(read().audit.some((a) => a.action === "buddy_guard_blocked"), verdict !== "OK");
    guard.mock.restore();
  }
});

test("replan reset, disabling and newer events during a guard check prevent late notes and audits", async (t) => {
  const pending = controlledModel(t);
  for (const change of ["reset", "disable", "new event"]) {
    for (const verdict of ["OK", "BLOCK"]) {
      cancelReplan();
      _setForTest(seed(Date.now()));
      let finishGuard;
      const guard = t.mock.method(_internals, "runGuard", () => new Promise((resolve) => { finishGuard = resolve; }));
      const task = replan("old event");
      finishPlan(pending.at(-1), "Old note");
      await new Promise(setImmediate);
      assert.equal(typeof finishGuard, "function");
      if (change === "reset") {
        cancelReplan();
        reset();
      } else if (change === "disable") read().settings.buddyEnabled = false;
      else queueReplan("new event");
      const auditCount = read().audit.length;
      const version = read().version;
      finishGuard(verdict);
      await task;
      assert.equal(read().buddy.chat.length, 0, `${change}: ${verdict}`);
      assert.equal(read().audit.length, auditCount, `${change}: ${verdict}`);
      assert.equal(read().version, version, "stale guard results do not mutate the store");
      guard.mock.restore();
    }
  }
  cancelReplan();
});

test("refusals are audited, keep the friendly reply and pass through the chat guard", async (t) => {
  t.mock.method(_internals, "callClaude", async () => ({ stop_reason: "refusal", content: [] }));
  const reply = "Hmm, I can't help with that one. Want to talk about your savings goal or an adventure instead?";
  const result = await chat("Tell me something else");
  assert.equal(result.reply, reply);
  assert.equal(_internals.runGuard.mock.calls.length, 1);
  assert.deepEqual(_internals.runGuard.mock.calls[0].arguments, [reply]);
  assert.equal(read().audit.at(-1).action, "buddy_refusal");
  await replan("purchase");
  assert.equal(read().audit.filter((a) => a.action === "buddy_refusal").length, 2);
  assert.equal(read().audit.at(-1).action, "replan_no_note");
  assert.equal(_internals.runGuard.mock.calls.length, 1, "no guard call for a note that will not be shown");
});

test("a late replan refusal after reset cannot add audit entries to the fresh store", async (t) => {
  let finishModel;
  t.mock.method(_internals, "callClaude", () => new Promise((resolve) => { finishModel = resolve; }));
  const task = replan("old event");
  cancelReplan();
  reset();
  finishModel({ stop_reason: "refusal", content: [] });
  await task;
  assert.equal(read().audit.length, 0);
  assert.equal(read().buddy.chat.length, 0);
});

test("offline replies do not call the model guard", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const result = await chat("How much have I saved?");
  assert.match(result.reply, /\$20.00/);
  assert.equal(_internals.runGuard.mock.calls.length, 0);
});


test("F36.5: offline Maple trip copy", () => {
  for (const question of ["How many points?", "How do I find the secret places?"]) {
    const reply = offlineReply(read(), question);
    assert.match(reply, /send Maple on a trip from Home!/);
    assert.match(reply, /Secret places turn up on trips as you build good saving habits/);
    assert.doesNotMatch(reply, /somewhere on the Map/);
  }
  assert.match(offlineReply(read(), "Hi"), /I'm Maple/);
  assert.doesNotMatch(offlineReply(read(), "Hi"), /Money Buddy/);
});
