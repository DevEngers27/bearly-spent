// Validated route actions, kept separate from the listening HTTP server for tests.
import * as game from "./domain.js";
import { spendPolicy } from "./guardian.js";
import { chat } from "./buddy.js";
import { childIdFor } from "./store.js";
import { PLACES, POINTS } from "./catalog.js";
import { money, integer, str, bool, id, oneOf, object, profileName } from "./validate.js";

const action = (fn) => (db, body, ...args) => fn(db, object(body), ...args);
const optionalNote = (body) => Object.hasOwn(body, "note") ? str(body.note, { required: false }) : "";

function clearFundingEscalations(db) {
  // A parent deposit can unblock parent-funded payouts, not child spending.
  db.approvals.forEach((a) => {
    if (a.escalatedAt && !a.paidTxnId && ["reward", "extra"].includes(a.kind)) delete a.escalatedAt;
    if (a.kind === "topup" && a.status === "pending") game.resolveEscalation(db, a, "approved");
  });
}

function renameProfileBear(db, name) {
  const bearName = profileName(name);
  db.child.bear.name = bearName;
  game.audit(db, "child", "bear_renamed", `Renamed the bear to ${bearName}`);
  game.notify(db, "parent", `${db.child.name} renamed the bear to ${bearName}`);
}

export const actions = {
  walletPing: action(() => ({ ok: true })),
  save: action((db, body, now) => game.childSave(db, money(body.amount, { min: 100 }), now)),
  spend: action((db, body, now) => game.childSpend(db, {
    amount: money(body.amount, { min: 1 }), memo: str(body.memo),
  }, spendPolicy, now)),
  walletSpend: action((db, body, now) => game.childWalletSpend(db, {
    amount: money(body.amount, { min: 1 }), merchant: str(body.merchant),
    at: body.at, external_id: body.external_id,
  }, spendPolicy, now)),
  walletReceive: action((db, body, now) => game.childWalletReceive(db, {
    amount: money(body.amount, { min: 1 }), note: str(body.note), request_id: body.request_id,
  }, spendPolicy, now)),
  walletSend: action(() => game.parentWalletSend()),
  walletRecord: action((db, body, pendingId, now) => game.recordWalletPending(db, id(pendingId), spendPolicy, now)),
  walletDismiss: action((db, body, pendingId) => game.dismissWalletPending(db, id(pendingId))),
  extra: action((db, body) => game.requestExtraAllowance(db, {
    amount: money(body.amount, { min: 100, max: 5000 }), reason: str(body.reason),
  })),
  journal: action((db, body, now) => {
    let prices;
    if (Object.hasOwn(body, "prices")) {
      if (!Array.isArray(body.prices) || body.prices.length !== 2) throw new game.GameError("Add two prices to compare");
      prices = body.prices.map((p) => money(p, { min: 1 }));
    }
    return game.journal(db, {
      direction: oneOf(body.direction, ["received", "spent", "saved"]), amount: money(body.amount), note: str(body.note),
      ...(prices ? { prices } : {}),
    }, now);
  }),
  budget: action((db, body) => {
    const allocations = object(body.allocations);
    const validated = Object.fromEntries(Object.entries(allocations).map(([k, v]) => [k, money(v)]));
    for (const key of ["save", "needs", "fun", "give"]) {
      if (!Object.hasOwn(validated, key)) throw new game.GameError("Fill in every part of your budget");
    }
    const total = Object.hasOwn(body, "total") ? money(body.total, { min: 100, max: 20000 }) : 2000;
    return game.completeBudget(db, validated, undefined, total);
  }),
  lesson: action((db, body, now) => {
    const lessonId = id(body.lessonId);
    if (!Array.isArray(body.answers) || !body.answers.every((v) => Number.isInteger(v))) throw new game.GameError("Answer every question with a choice");
    const attempt = Object.hasOwn(body, "attempt") ? integer(body.attempt) : undefined;
    return game.completeLesson(db, lessonId, body.answers, now, attempt);
  }),
  adventureSeen: (db, adventureId) => game.markAdventureSeen(db, id(adventureId)),
  cancelGoal: (db, goalId) => game.cancelParentGoal(db, id(goalId)),
  missionDone: (db, missionId) => game.childMarkMissionDone(db, id(missionId)),
  missionSeen: action((db, body, now) => game.missionSeen(db, id(body.key), now)),
  trip: action((db, body, now) => game.startTrip(db, now)),
  adventure: action((db, body) => game.startAdventure(db, id(body.destId))),
  buyCosmetic: action((db, body) => game.buyCosmetic(db, id(body.id))),
  equip: action((db, body, now) => game.equip(db, id(body.kind), body.value === null ? null : id(body.value), now)),
  renameBear: action((db, body) => renameProfileBear(db, body.name)),
  profile: action((db, body) => renameProfileBear(db, body.bearName)),
  friend: action((db, body) => game.friendView(game.addFriendByCode(db, id(body.code)))),
  trade: action((db, body) => {
    const friendId = id(body.friendId), give = id(body.give), get = id(body.get);
    if (!Object.hasOwn(PLACES, give) || !Object.hasOwn(PLACES, get)) throw new game.GameError("Pick two postcards");
    return game.proposeTrade(db, friendId, give, get);
  }),
  greet: action((db, body, now) => game.sendGreeting(db, id(body.friendId), integer(body.index, { max: game.GREETINGS.length - 1 }), now)),
  chat: action((db, body, send = (text) => chat(childIdFor(db), text)) => {
    if (typeof body.text === "string" && !body.text.trim()) throw new game.GameError("Say something first!");
    const text = str(body.text, { max: 500 });
    if (!db.settings.buddyEnabled) throw new game.GameError("Money Buddy is turned off by your grown-up");
    return send(text);
  }),
  approval: action((db, body, approvalId) => game.decide(db, id(approvalId), bool(body.approve), optionalNote(body))),
  goal: action((db, body) => game.createParentGoal(db, {
    title: str(body.title), type: oneOf(body.type, ["lessons", "tasks", "save_actions"]),
    count: integer(body.count, { min: 1, max: 50 }), reward: money(body.reward, { max: 10000 }) / 100,
  })),
  mission: action((db, body) => game.createParentMission(db, {
    title: str(body.title), points: Object.hasOwn(body, "points") ? integer(body.points, { min: 5, max: 100 }) : POINTS.parent,
  })),
  allowance: action((db, body) => {
    const update = {};
    if (Object.hasOwn(body, "amount")) update.amount = money(body.amount, { max: 10000 });
    if (Object.hasOwn(body, "savePct")) update.savePct = integer(body.savePct, { max: 100 });
    if (Object.hasOwn(body, "spendLimit")) update.spendLimit = money(body.spendLimit);
    if (Object.hasOwn(body, "rewardDestination")) update.rewardDestination = oneOf(body.rewardDestination, ["spending", "savings"]);
    const a = Object.assign(db.allowance, update);
    game.audit(db, "parent", "allowance_updated", `Allowance $${(a.amount / 100).toFixed(2)}/wk, ${a.savePct}% saved, purchase limit $${(a.spendLimit / 100).toFixed(2)}`);
  }),
  fundingAdd: action((db, body) => {
    const amount = money(body.amount, { min: 100, max: 100000 });
    const note = optionalNote(body);
    game.recordFunding(db, amount, note);
    clearFundingEscalations(db);
  }),
  topup: action((db, body) => {
    const amount = money(body.amount, { min: 1, max: 100000 });
    db.accounts.parent.balance += amount;
    clearFundingEscalations(db);
    game.notify(db, "parent", `Funding topped up: $${(amount / 100).toFixed(2)}`, "money");
    game.audit(db, "parent", "topup", `Added $${(amount / 100).toFixed(2)} to the funding account (simulated deposit)`);
  }),
  settings: action((db, body) => {
    const update = {};
    for (const key of ["requireTradeApproval", "buddyEnabled", "coopChallenge"]) {
      if (Object.hasOwn(body, key)) update[key] = bool(body[key]);
    }
    if (Object.hasOwn(body, "timezone")) {
      const timezone = str(body.timezone);
      if (/^[+-]/.test(timezone)) throw new game.GameError("Choose a time zone from the list");
      try {
        update.timezone = new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
      } catch {
        throw new game.GameError("Choose a time zone from the list");
      }
    }
    if (childIdFor(db) && body.coopChallenge === true && !game.isDemoChild(db)) throw new game.GameError("Team challenges are only in the demo for now");
    Object.assign(db.settings, update);
    const labels = { requireTradeApproval: "Trade approval", buddyEnabled: "Buddy", coopChallenge: "Team challenge" };
    const detail = Object.entries(update).map(([key, value]) => key === "timezone" ? `Time zone set to ${value}` : `${labels[key]} turned ${value ? "on" : "off"}`).join(". ");
    game.audit(db, "parent", "settings", detail || "Settings unchanged");
  }),
  goalSave: action((db, body, goalId = null, actor = "child") => {
    const update = {};
    if (!goalId || Object.hasOwn(body, "title")) update.title = str(body.title, { max: 40 });
    if (!goalId || Object.hasOwn(body, "target")) update.target = money(body.target, { min: 100, max: 100000 });
    if (!goalId || Object.hasOwn(body, "icon")) update.icon = oneOf(body.icon, game.GOAL_ICONS);
    return game.saveSavingsGoal(db, update, goalId && id(goalId), actor);
  }),
  goalCurrent: (db, goalId, actor) => game.selectSavingsGoal(db, id(goalId), actor),
  goalRestore: (db, goalId, actor) => game.restoreSavingsGoal(db, id(goalId), actor),
  goalArchive: (db, goalId, actor) => game.retireSavingsGoal(db, id(goalId), actor),
  goalDelete: (db, goalId) => game.retireSavingsGoal(db, id(goalId), "parent", true),
  goalPurchase: (db, goalId) => game.requestGoalPurchase(db, id(goalId)),
  savingsGoal: action(() => { throw new game.GameError("Use the savings goals controls instead", 410); }),
};
