// Money Buddy — Claude-powered, age-appropriate financial guide.
//
// Claude gets read-only views of the child's finances plus two write tools
// that cannot move money: `update_savings_plan` (shown on the dashboard) and
// `propose_mission` (goes to the parent's approval queue). When no API key is
// configured, a small deterministic fallback keeps the demo working.
import Anthropic from "@anthropic-ai/sdk";
import { read, mutate, uid } from "./store.js";
import { audit, notify, weeksToGoal, GameError } from "./domain.js";

const MODEL = process.env.BUDDY_MODEL || "claude-opus-5";
const EFFORT = process.env.BUDDY_EFFORT || "low"; // kid chat: keep latency low
const dollars = (c) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;

let client = null;
export function buddyMode() {
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "claude" : "offline";
}
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

// ------------------------------------------------------------------ safety
// Kids type things they shouldn't share. Strip obvious personal info before it
// leaves the server, and tell the child why.
const PII = [
  { re: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, label: "phone number" },
  { re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, label: "email" },
  { re: /\b\d{1,5}\s+\w+(\s\w+)?\s(street|st|avenue|ave|road|rd|lane|ln|drive|dr|blvd)\b/gi, label: "address" },
  { re: /\b(?:\d[ -]*?){13,19}\b/g, label: "card number" },
  { re: /\b(password|passcode|pin)\s*(is|:)?\s*\S+/gi, label: "password" },
];
export function redact(text) {
  let out = text;
  const found = [];
  for (const { re, label } of PII) {
    re.lastIndex = 0;
    if (re.test(out)) {
      found.push(label);
      out = out.replace(re, `[${label} removed]`);
    }
    re.lastIndex = 0;
  }
  return { text: out, found };
}

// ------------------------------------------------------------------ tools
function snapshot(db) {
  const goals = db.savingsGoals.map((g) => ({
    id: g.id, title: g.title, target: dollars(g.target),
    saved_so_far: dollars(Math.min(db.accounts.savings.balance, g.target)),
    weeks_left_at_current_pace: weeksToGoal(db, g),
  }));
  return {
    child_name: db.child.name,
    age: db.child.age,
    savings_balance: dollars(db.accounts.savings.balance),
    spending_balance: dollars(db.accounts.spending.balance),
    weekly_allowance: dollars(db.allowance.amount),
    allowance_saved_percent: db.allowance.savePct,
    next_allowance_date: new Date(db.allowance.nextRun).toDateString(),
    purchase_limit_without_parent: dollars(db.allowance.spendLimit),
    adventure_points: db.child.points,
    savings_goals: goals,
    parent_goals: db.parentGoals.filter((g) => g.status === "active").map((g) => ({ title: g.title, progress: `${g.progress}/${g.count}`, reward: dollars(g.reward) })),
    recent_transactions: db.transactions.filter((t) => t.status === "posted" && (t.to !== "parent")).slice(-8).map((t) => ({
      date: new Date(t.ts).toDateString(), what: t.memo, amount: dollars(t.amount), direction: t.to === "merchant" ? "spent" : `into ${t.to}`,
    })),
    current_plan: db.buddy.plan?.summary || null,
  };
}

function simulatePurchase(db, { price_dollars, pay_from }) {
  const price = Math.round(Number(price_dollars) * 100);
  if (!(price > 0)) return { error: "price must be positive" };
  const from = pay_from === "savings" ? "savings" : "spending";
  const bal = db.accounts[from].balance;
  const result = { price: dollars(price), pay_from: from, can_afford: bal >= price, balance_after: dollars(bal - price) };
  const shortfall = Math.max(0, price - db.accounts.spending.balance);
  // How goals shift if the purchase (or its shortfall) comes out of savings.
  const hit = from === "savings" ? price : 0;
  result.goal_impact = db.savingsGoals.map((g) => ({
    goal: g.title,
    weeks_left_now: weeksToGoal(db, g),
    weeks_left_after_purchase: weeksToGoal(db, g, -hit),
  }));
  if (from === "spending" && shortfall > 0) result.note = `Spending money is ${dollars(shortfall)} short; would need savings or waiting.`;
  const weekly = Math.round((db.allowance.amount * (100 - db.allowance.savePct)) / 100);
  if (shortfall > 0 && weekly > 0) result.weeks_to_afford_from_spending_money = Math.ceil(shortfall / weekly);
  if (price > db.allowance.spendLimit) result.needs_parent_ok = true;
  return result;
}

const TOOLS = [
  {
    name: "get_snapshot",
    description: "Read the child's current balances, allowance, goals, recent transactions, adventure points and current savings plan. Call this before giving any advice that depends on numbers.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "simulate_purchase",
    description: "Calculate what happens if the child buys something: whether they can afford it, balance afterwards, and how many weeks each savings goal would be delayed. Read-only — nothing is bought.",
    input_schema: {
      type: "object",
      properties: {
        price_dollars: { type: "number", description: "Price in dollars, e.g. 50" },
        pay_from: { type: "string", enum: ["spending", "savings"], description: "Which pot the money would come from" },
      },
      required: ["price_dollars", "pay_from"],
      additionalProperties: false,
    },
  },
  {
    name: "update_savings_plan",
    description: "Save a short, kid-friendly savings plan that is shown on the child's dashboard. Use after finances change or when the child agrees to a plan. Does not move money.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One or two sentences, max 200 characters, addressed to the child." },
        weekly_save_dollars: { type: "number", description: "Suggested dollars to save each week" },
        goal_id: { type: "string", description: "Which savings goal this plan targets" },
        steps: { type: "array", items: { type: "string" }, maxItems: 4, description: "Up to 4 short concrete steps" },
      },
      required: ["summary", "weekly_save_dollars", "steps"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_mission",
    description: "Suggest a new money-learning mission. It goes to the parent for approval before the child sees it. Use sparingly — at most once per conversation.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short mission, e.g. 'Compare prices on 3 cereals at the store'" },
        points: { type: "integer", minimum: 10, maximum: 50 },
        why: { type: "string", description: "One sentence for the parent explaining what it teaches" },
      },
      required: ["title", "points", "why"],
      additionalProperties: false,
    },
  },
];

function runTool(name, input) {
  const db = read();
  switch (name) {
    case "get_snapshot":
      return snapshot(db);
    case "simulate_purchase":
      return simulatePurchase(db, input);
    case "update_savings_plan":
      return mutate((d) => {
        const summary = String(input.summary || "").slice(0, 240);
        const steps = (input.steps || []).slice(0, 4).map((s) => String(s).slice(0, 120));
        const weekly = Math.max(0, Math.round(Number(input.weekly_save_dollars) * 100) || 0);
        d.buddy.plan = { summary, steps, weeklySave: weekly, goalId: input.goal_id || d.savingsGoals[0]?.id, updatedAt: Date.now() };
        audit(d, "buddy", "plan_updated", `Money Buddy updated the savings plan: ${summary}`);
        return { ok: true };
      });
    case "propose_mission":
      return mutate((d) => {
        const already = d.approvals.some((a) => a.kind === "mission_proposal" && a.status === "pending");
        if (already) return { ok: false, reason: "A suggested mission is already waiting for the parent." };
        const points = Math.max(10, Math.min(50, Math.round(Number(input.points) || 20)));
        const a = { id: uid("apr"), kind: "mission_proposal", status: "pending", createdAt: Date.now(),
          missionTitle: String(input.title).slice(0, 100), points,
          title: `Money Buddy suggests a mission: "${String(input.title).slice(0, 100)}"`, detail: String(input.why || "").slice(0, 200) };
        d.approvals.push(a);
        notify(d, "parent", `Money Buddy suggested a mission for ${d.child.name}. Approve?`, "approval", a.id);
        audit(d, "buddy", "mission_proposed", `Proposed mission "${a.missionTitle}" (+${points}) — awaiting parent`);
        return { ok: true, status: "sent to parent for approval" };
      });
    default:
      return { error: `unknown tool ${name}` };
  }
}

function systemPrompt(db) {
  return `You are Money Buddy, the friendly sidekick inside MoneyQuest, a game that helps kids learn to save and manage money. You're talking with ${db.child.name}, who is ${db.child.age} years old. Their bear companion is named ${db.child.bear.name}; it travels to real U.S. national parks and cities with adventure points.

How to talk:
- Use short sentences and words a ${db.child.age}-year-old knows. Keep replies under 70 words unless they ask for more. One emoji at most.
- Be warm and encouraging, never shaming. Spending on reasonable things is fine; help them see trade-offs, then let them choose.
- Use real numbers from their account. Call get_snapshot before giving number-based advice, and simulate_purchase whenever they ask about buying something. Never make up balances.
- End with a small question or a choice when it helps them think ("Want to see…?").

What you can and can't do:
- You cannot move, send, or spend money, and you can't approve anything. Purchases above ${dollars(db.allowance.spendLimit)}, rewards, and extra allowance always need their grown-up. Say so plainly if asked.
- If they agree to a saving plan, or their money situation changes, save it with update_savings_plan.
- You may suggest one learning mission with propose_mission; explain that a grown-up will check it first.
- Adventure points are game points, not money. Spending points never changes savings.

Staying safe:
- Never ask for or repeat personal details (full name, address, school, phone, passwords). If they share some, gently remind them not to.
- Don't recommend specific stocks, crypto, gambling, loot boxes, or apps that cost money. Keep investing talk at a simple "money can grow over time" level.
- If they mention being hurt, scared, bullied, or someone asking them for money or secrets online, kindly tell them to talk to a trusted grown-up right away, and stop giving money advice for that message.
- Topics far from money, saving, or the game: answer in one friendly line, then steer back.`;
}

async function callClaude(params) {
  const base = { model: MODEL, max_tokens: 2048, thinking: { type: "adaptive" }, output_config: { effort: EFFORT }, ...params };
  try {
    // Server-side fallback: if a safety classifier declines, the API reroutes
    // to an appropriate model instead of returning an empty refusal.
    return await getClient().beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) {
      return await getClient().messages.create(base);
    }
    throw e;
  }
}

const textOf = (content) => content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

/** Run the agentic loop. Returns { reply, toolsUsed }. */
async function runClaude(messages) {
  const db = read();
  const toolsUsed = [];
  const convo = [...messages];
  for (let i = 0; i < 6; i++) {
    const res = await callClaude({ system: systemPrompt(db), tools: TOOLS, messages: convo });
    if (res.stop_reason === "refusal") {
      return { reply: "Hmm, I can't help with that one. Want to talk about your savings goal or an adventure instead?", toolsUsed };
    }
    if (res.stop_reason !== "tool_use") return { reply: textOf(res.content) || "Hmm, let me think about that. Can you ask another way?", toolsUsed };
    convo.push({ role: "assistant", content: res.content });
    const results = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      toolsUsed.push(block.name);
      let out;
      try {
        out = runTool(block.name, block.input || {});
      } catch (e) {
        out = { error: e.message };
      }
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out), is_error: Boolean(out?.error) });
    }
    convo.push({ role: "user", content: results });
  }
  return { reply: "Let me think about that a bit more — ask me again in a moment!", toolsUsed };
}

// ------------------------------------------------------------------ offline fallback
// Offline Money Buddy: a small rule-based helper so the chat still works
// without an API key. It reads the same real numbers Claude would.
const has = (text, re) => re.test(text.toLowerCase());
function offlineReply(db, text) {
  const goal = db.savingsGoals[0];
  const weekly = Math.round((db.allowance.amount * db.allowance.savePct) / 100);
  const bear = db.child.bear.name;
  const amount = text.match(/\$\s?(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s?(dollars|bucks)/i);
  const price = amount ? Number(amount[1] || amount[2]) : null;

  if (has(text, /\b(scared|bully|bullied|hurt|stranger|secret|password|someone (asked|wants)|unsafe)\b/)) {
    return "That sounds important. Please talk to a grown-up you trust right away, like your parent or teacher. You never have to keep secrets about money or passwords.";
  }
  if (has(text, /\b(buy|get|purchase|afford|spend|cost)\b/) && price) {
    const sim = simulatePurchase(db, { price_dollars: price, pay_from: "spending" });
    const simSave = simulatePurchase(db, { price_dollars: price, pay_from: "savings" });
    const gi = simSave.goal_impact[0];
    const limit = price * 100 > db.allowance.spendLimit ? ` It's over ${dollars(db.allowance.spendLimit)}, so your grown-up would need to say OK first.` : "";
    if (sim.can_afford) return `Yes, you can pay with your spending money and still have ${sim.balance_after} left. Your ${goal.title} savings stay safe.${limit} Want to wait one day to check you still want it?`;
    return `You have ${dollars(db.accounts.spending.balance)} to spend, so you'd need ${dollars(price * 100 - db.accounts.spending.balance)} more. If you took it from savings, your ${gi.goal} would take ${gi.weeks_left_after_purchase} weeks instead of ${gi.weeks_left_now}.${limit} Want me to make a plan to save for it?`;
  }
  if (has(text, /\b(buy|afford|purchase)\b/)) {
    return "How much does it cost? Tell me the price, like \"Can I buy a $12 book?\", and I'll check your numbers.";
  }
  if (has(text, /\b(plan|budget me|help me save)\b/)) {
    const plan = offlinePlan(db, "you asked for a plan");
    mutate((d) => {
      d.buddy.plan = plan;
      audit(d, "buddy", "plan_updated", `Offline planner made a plan: ${plan.summary}`);
    });
    return `Here's your plan: ${plan.summary} Steps: ${plan.steps.join("; ")}. I put it on your Home page!`;
  }
  if (has(text, /\b(how long|when|weeks|goal|bike|bicycle)\b/)) {
    const w = weeksToGoal(db, goal);
    if (w === 0) return `You already saved enough for your ${goal.title}! Ask your grown-up about buying it, then pick a new goal.`;
    return `You have ${dollars(db.accounts.savings.balance)} of ${dollars(goal.target)} for your ${goal.title}. Saving ${dollars(weekly)} a week, that's about ${w} more weeks. Finishing missions and lessons can earn reward money to go faster.`;
  }
  if (has(text, /\b(need|want)s?\b/) && has(text, /\b(vs|versus|difference|or)\b|what('?s| is) a (need|want)/)) {
    return "A need is something you must have to be safe and healthy, like food, a warm coat or school supplies. A want is something fun that's nice to have, like a new toy. It's good to pay for needs first, then save for wants!";
  }
  if (has(text, /\b(points?|trip|adventure|travel|map|postcard)\b/)) {
    return `You have ${db.child.points} adventure points. Points are game points, not money, so trips never touch your savings. Earn more by doing missions and lessons, then send ${bear} somewhere on the Map!`;
  }
  if (has(text, /\b(allowance|payday|get paid)\b/)) {
    return `Your allowance is ${dollars(db.allowance.amount)} a week, and ${db.allowance.savePct}% goes straight into savings. The next one comes on ${new Date(db.allowance.nextRun).toDateString()}.`;
  }
  if (has(text, /\b(how much|balance|money do i have|saved)\b/)) {
    return `You have ${dollars(db.accounts.savings.balance)} in savings and ${dollars(db.accounts.spending.balance)} to spend.`;
  }
  if (has(text, /\b(tip|tips|save more|how (do|can) i save|faster)\b/)) {
    return "Three saving tricks: save first when money comes in, wait one day before buying something you want, and compare prices before you buy. Small amounts add up!";
  }
  if (has(text, /^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/)) {
    return `Hi ${db.child.name}! I'm Money Buddy. You can ask me "Can I buy a $15 toy?", "When will I get my ${goal.title.toLowerCase()}?", or "Make me a saving plan".`;
  }
  return `I'm not sure about that one. I'm best at money questions! Try "Can I buy a $15 toy?", "When will I get my ${goal.title.toLowerCase()}?", or "Make me a saving plan".`;
}

export function offlinePlan(db, reason) {
  const goal = db.savingsGoals[0];
  const weekly = Math.round((db.allowance.amount * db.allowance.savePct) / 100);
  const w = weeksToGoal(db, goal);
  return {
    summary: w === 0
      ? `You reached your ${goal.title} goal! Time to pick a new one.`
      : `${dollars(db.accounts.savings.balance)} saved — about ${w} weeks to your ${goal.title} at ${dollars(weekly)}/week.`,
    steps: [`Keep saving ${dollars(weekly)} from each allowance`, "Finish lessons to earn reward money", "Wait a day before big buys"],
    weeklySave: weekly, goalId: goal.id, updatedAt: Date.now(), reason, offline: true,
  };
}

// ------------------------------------------------------------------ public API
export async function chat(userText) {
  const { text, found } = redact(String(userText || "").slice(0, 500));
  if (!text.trim()) throw new GameError("Say something first!");
  mutate((d) => {
    d.buddy.chat.push({ id: uid("msg"), role: "user", text, ts: Date.now(), redacted: found });
    if (found.length) audit(d, "buddy", "pii_redacted", `Removed ${found.join(", ")} from the child's message before sending to the AI`);
  });
  let reply, toolsUsed = [];
  const db = read();
  if (buddyMode() === "claude") {
    // Merge consecutive same-role turns (auto plan notes) and start on a user turn.
    const history = [];
    for (const m of db.buddy.chat.slice(-12)) {
      const last = history[history.length - 1];
      if (last && last.role === m.role) last.content += `\n\n${m.text}`;
      else history.push({ role: m.role, content: m.text });
    }
    while (history.length && history[0].role !== "user") history.shift();
    try {
      ({ reply, toolsUsed } = await runClaude(history));
    } catch (e) {
      console.error("[buddy] Claude error:", e.message);
      reply = offlineReply(read(), text) + " (I'm having trouble connecting, so this is a quick answer.)";
    }
  } else {
    reply = offlineReply(db, text);
  }
  if (found.length) reply = `Quick tip: let's keep things like your ${found.join(" and ")} private, okay?\n\n${reply}`;
  mutate((d) => {
    d.buddy.chat.push({ id: uid("msg"), role: "assistant", text: reply, ts: Date.now(), tools: toolsUsed });
    if (d.buddy.chat.length > 60) d.buddy.chat.splice(0, d.buddy.chat.length - 60);
  });
  return { reply, toolsUsed };
}

/**
 * Re-plan after a money event (reward paid, purchase, allowance). Called by the
 * server, debounced. Claude decides whether the plan needs to change and leaves
 * the child a short note.
 */
export async function replan(reason) {
  if (buddyMode() !== "claude") {
    mutate((d) => {
      d.buddy.plan = offlinePlan(d, reason);
      audit(d, "buddy", "plan_updated", `Recalculated plan after: ${reason} (offline planner)`);
    });
    return;
  }
  const prompt = `[Automatic update — not typed by ${read().child.name}] Something changed: ${reason}. Check the snapshot, then call update_savings_plan with a refreshed plan. Then write one short, cheerful note (max 35 words) telling ${read().child.name} what changed for their goal.`;
  try {
    const { reply } = await runClaude([{ role: "user", content: prompt }]);
    mutate((d) => {
      if (d.buddy.plan) d.buddy.plan.reason = reason;
      d.buddy.chat.push({ id: uid("msg"), role: "assistant", text: reply, ts: Date.now(), auto: true });
    });
  } catch (e) {
    console.error("[buddy] replan error:", e.message);
    mutate((d) => {
      d.buddy.plan = offlinePlan(d, reason);
    });
  }
}
