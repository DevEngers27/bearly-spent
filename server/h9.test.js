import { childIdFor as lessonChildId } from "./store.js";
import { pickLessonIndexes } from "../shared/lessonPick.js";
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { _databaseForTest, closeDatabase } from "./db.js";
import { _clearStoreForTest, readChild, mutateChild, friendCode, seed } from "./store.js";
import { dispatch } from "./index.js";
import { _clearLimitsForTest } from "./limits.js";
import { cancelReplan, snapshot, _internals } from "./buddy.js";
import { actions } from "./actions.js";
import { LESSONS, POINTS } from "./catalog.js";
import { policies } from "./limits.js";
import { readFile } from "node:fs/promises";
import * as game from "./domain.js";

const lessonAnswers = (db, lesson) => pickLessonIndexes(lessonChildId(db), lesson.id, db.child.lessonAttempts?.[lesson.id] || 0).map((i) => lesson.questions[i].answer);
const originalDemo = process.env.MQ_DEMO;
const originalDir = process.env.MQ_DATA_DIR;
const form = (name) => ({ email: `${name.replaceAll(" ", "")}@example.test`, password: "parent-password", parentName: name, childName: name, childAge: 9, bearName: "Pip" });
function device(ip = "127.0.0.1") {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    async call(method, url, body, { now = Date.now(), write = true, headers = {} } = {}) {
      const parsed = new URL(url, "http://local");
      const req = Object.assign(new EventEmitter(), {
        headers: { cookie, ...headers }, body, ip, query: Object.fromEntries(parsed.searchParams),
        get(key) { return this.headers[key.toLowerCase()]; },
      });
      const res = Object.assign(new EventEmitter(), {
        headers: {}, statusCode: 200, chunks: [], ended: false,
        set(key, value) { if (typeof key === "object") { for (const [k, v] of Object.entries(key)) this.set(k, v); } else this.headers[key.toLowerCase()] = value; return this; },
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; return this; },
        flushHeaders() {},
        write(chunk) { this.chunks.push(chunk); return write; },
        end() { this.ended = true; this.emit("close"); },
      });
      await dispatch(method, parsed.pathname, req, res, now);
      if (res.headers["set-cookie"]) cookie = res.headers["set-cookie"].split(";")[0];
      return { status: res.statusCode, body: res.body, headers: res.headers, req, res };
    },
  };
}
async function family(name) {
  const browser = device(name);
  const result = await browser.call("POST", "/api/auth/register", form(name));
  assert.equal(result.status, 200);
  return { browser, id: result.body.activeChild.id, familyId: result.body.family.id };
}
beforeEach(() => {
  cancelReplan();
  _clearLimitsForTest();
  _clearStoreForTest();
  _databaseForTest();
  delete process.env.MQ_DEMO;
});
after(() => {
  cancelReplan();
  closeDatabase();
  if (originalDemo === undefined) delete process.env.MQ_DEMO; else process.env.MQ_DEMO = originalDemo;
  if (originalDir === undefined) delete process.env.MQ_DATA_DIR; else process.env.MQ_DATA_DIR = originalDir;
});

async function pair(parent, id) {
  const link = await parent.call("POST", `/api/parent/children/${id}/link`, {});
  const kid = device("kid");
  assert.equal((await kid.call("POST", "/api/auth/link", { code: link.body.code })).status, 200);
  return kid;
}

test("H9.1 paired kid logout revokes cookie and keeps parent session usable", async () => {
  const a = await family("Mia"), kid = await pair(a.browser, a.id);
  const oldCookie = kid.cookie;
  const logout = await kid.call("POST", "/api/auth/logout", {});
  assert.equal(logout.status, 200);
  assert.match(logout.headers["set-cookie"], /mq_session=;.*Max-Age=0/);
  assert.equal(kid.cookie, "mq_session=");
  assert.equal((await kid.call("GET", "/api/state")).status, 401);
  assert.equal((await device().call("GET", "/api/state", undefined, { headers: { cookie: oldCookie } })).status, 401);
  assert.equal((await a.browser.call("GET", "/api/auth/me")).status, 200);
});

test("H9.2 thirty ordered lessons have valid icons, answers and private answer keys", async () => {
  const icons = await readFile(new URL("../client/src/Icons.jsx", import.meta.url), "utf8");
  assert.equal(LESSONS.length, 30);
  assert.equal(new Set(LESSONS.map((l) => l.id)).size, 30);
  for (const lesson of LESSONS) {
    assert.ok(lesson.title.length > 0);
    assert.ok(new Set([...icons.matchAll(/^  (\w+):/gm)].map((m) => m[1]).concat(["honey", "basket"])).has(lesson.icon), lesson.icon);
    assert.equal(lesson.questions.length, 6);
    for (const q of lesson.questions) {
      assert.ok(q.q.length > 0);
      assert.ok(q.options.length >= 2 && q.options.length <= 3);
      assert.equal(new Set(q.options).size, q.options.length);
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
    }
  }
  const a = await family("Mia");
  const view = (await a.browser.call("GET", "/api/state")).body;
  assert.deepEqual(view.lessons.next.map((l) => l.id), LESSONS.slice(0, 5).map((l) => l.id));
  assert.deepEqual(view.catalog.lessons.map((l) => l.order), Array.from({ length: 30 }, (_, i) => i));
  for (const l of [...view.catalog.lessons, ...view.lessons.next]) assert.ok(l.questions.every((q) => !("answer" in q)));
});

test("H9.2 first passes roll the server window; every replay earns zero points and money stays put", async () => {
  const a = await family("Mia");
  const money = structuredClone(readChild(a.id).accounts);
  for (const [i, lesson] of LESSONS.entries()) {
    const answers = lessonAnswers(readChild(a.id), lesson);
    const first = await a.browser.call("POST", "/api/child/lesson", { lessonId: lesson.id, answers });
    assert.equal(first.body.firstTime, true);
    const points = readChild(a.id).child.points;
    const repeat = await a.browser.call("POST", "/api/child/lesson", { lessonId: lesson.id, answers: lessonAnswers(readChild(a.id), lesson) });
    assert.equal(repeat.body.firstTime, false);
    assert.equal(readChild(a.id).child.points, points);
    const view = (await a.browser.call("GET", "/api/state")).body;
    assert.deepEqual(view.lessons.next.map((l) => l.id), LESSONS.slice(i + 1, i + 6).map((l) => l.id));
    assert.equal(view.lessons.finished.length, i + 1);
  }
  assert.deepEqual(readChild(a.id).accounts, money);
  assert.deepEqual(snapshot(readChild(a.id)).lessons, { finished: 30, total: 30, next_titles: [] });
  const d = seed(Date.now());
  // Direct first pass preserves the existing lesson reward, separate from daily mission rewards.
  const before = d.child.points;
  game.completeLesson(d, LESSONS[5].id, lessonAnswers(d, LESSONS[5]));
  assert.equal(d.child.points, before + POINTS.lesson);
});

const orders = [["A", "B", "kid"], ["A", "kid", "B"], ["B", "A", "kid"], ["B", "kid", "A"], ["kid", "A", "B"], ["kid", "B", "A"]];
for (const order of orders) test(`H9.3 anonymous request, consent order ${order.join(" → ")}`, async () => {
  const a = await family("Ava Smith"), b = await family("Ben Jones");
  await a.browser.call("POST", "/api/parent/family", { displayName: "The Smiths" });
  const before = structuredClone(readChild(b.id));
  const invalid = await a.browser.call("POST", "/api/child/friend", { code: "ZZZZZZZZ" });
  assert.deepEqual(readChild(b.id), before, "invalid code never touches recipient records or notices");
  const valid = await a.browser.call("POST", "/api/child/friend", { code: friendCode(b.id) });
  assert.deepEqual(valid.body, invalid.body);
  const id = readChild(a.id).friends[0].id;
  const approvals = [a, b].map((who) => readChild(who.id).approvals.find((r) => r.kind === "friend_request"));
  for (const [i, who] of [a, b].entries()) assert.ok(readChild(who.id).notifications.some((n) => n.to === "parent" && !n.read && n.ref === approvals[i].id));
  assert.ok(readChild(b.id).notifications.some((n) => n.to === "child" && n.text === "Someone sent you a friend request — your grown-ups are checking" && !n.read));
  let aApproved = false;
  for (let step = 0; step <= order.length; step++) {
    const child = (await b.browser.call("GET", "/api/state")).body;
    const parent = (await b.browser.call("GET", "/api/parent/state")).body;
    assert.equal(child.friends.length, 1);
    if (!aApproved) {
      assert.equal(child.friends[0].name, undefined);
      assert.equal(child.friends[0].familyLabel, undefined);
      assert.doesNotMatch(JSON.stringify({ child, parent }), /Ava|Smith/);
      assert.match(parent.approvals.find((r) => r.kind === "friend_request").title, /A child from another family/);
    } else if (step < 3) {
      assert.equal(child.friends[0].name, "Ava");
      assert.equal(child.friends[0].familyLabel, "The Smiths");
      assert.match(parent.approvals.find((r) => r.kind === "friend_request").title, /Ava \(from The Smiths\)/);
    }
    assert.equal(child.friends[0].status === "approved", step === 3);
    if (step === 3) break;
    const who = order[step];
    const response = who === "kid" ? await b.browser.call("POST", `/api/child/friend/${id}/respond`, { approve: true }) : await (who === "A" ? a : b).browser.call("POST", `/api/parent/approval/${approvals[who === "A" ? 0 : 1].id}`, { approve: true });
    assert.equal(response.status, 200, response.body?.error);
    if (who === "A") aApproved = true;
  }
});

for (const who of ["A", "B", "kid"]) test(`H9.3 early decline by ${who} closes both sides without leaking sender`, async () => {
  const a = await family("Ava Smith"), b = await family("Ben Jones");
  await a.browser.call("POST", "/api/child/friend", { code: friendCode(b.id) });
  const id = readChild(a.id).friends[0].id;
  const parent = who === "A" ? a : b;
  const approval = readChild(parent.id).approvals.find((r) => r.kind === "friend_request");
  const res = await parent.browser.call("POST", who === "kid" ? `/api/child/friend/${id}/respond` : `/api/parent/approval/${approval.id}`, { approve: false, note: "Private reason" });
  assert.equal(res.status, 200);
  for (const family of [a, b]) {
    const view = (await family.browser.call("GET", "/api/state")).body;
    assert.deepEqual(view.friends, []);
    assert.ok(!readChild(family.id).approvals.some((r) => r.status === "pending"));
  }
  assert.doesNotMatch(JSON.stringify((await b.browser.call("GET", "/api/parent/state")).body), /Ava|Smith|Private reason/);
});

test("H9.4 / 0.8.8 read-aloud routes are back for kids only and answer 404 until Cartesia is configured", async () => {
  const a = await family("Mia"), kid = await pair(a.browser, a.id);
  for (const path of ["/api/buddy/speak", "/api/voice/token"]) {
    const res = await kid.call("POST", path, { text: "Hi" });
    assert.equal(res.status, 404); assert.match(res.body.error, /Voice is not configured/);
    for (const [who, browser] of [["parent", a.browser], ["device", device()]]) { const status = (await browser.call("POST", path, { text: "Hi" })).status; assert.ok([401, 403, 404].includes(status), `${who} ${path} -> ${status}`); }
  }
  assert.equal((await kid.call("POST", "/api/buddy/speak", { text: "" })).status, 400);
  assert.ok("voice" in policies); assert.ok("speak" in policies);
  assert.equal(typeof actions.speakText, "function");
  assert.deepEqual(Object.keys((await kid.call("GET", "/api/state")).body.integrations).sort(), ["bank", "buddy", "voice"]);
  assert.equal((await kid.call("GET", "/api/state")).body.integrations.voice, "browser");
  // Read-aloud plays blob: audio (Cartesia bytes) and a data: primer clip; the CSP must allow both.
  const csp = (await kid.call("GET", "/api/state")).headers?.["content-security-policy"] || "";
  assert.match(csp, /media-src 'self' blob: data:/);
  assert.match(csp, /connect-src 'self' https:\/\/api\.cartesia\.ai/);
});

test("H9.5 Buddy prompt requests the safe formatting subset", () => {
  assert.match(_internals.systemPrompt(seed(Date.now())), /Use at most bold and short bullet lists, no headings, tables or links/);
});
