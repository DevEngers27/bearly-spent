# MoneyQuest server API (B5a)

This is the contract for B5b. The server requires Node >=22.9 (built-in `node:sqlite` and the existing env-file flags). Launch/reset scripts include `--experimental-sqlite` for early Node 22 compatibility. For direct test commands on Node 22.9–22.12, use `NODE_OPTIONS=--experimental-sqlite node --test server/*.test.js`; later supported versions can run `node --test server/*.test.js`. See [Node 22.9 SQLite docs](https://nodejs.org/download/release/v22.9.0/docs/api/sqlite.html) for the flag requirement. Run `npm run dev` or `npm start` with your environment; neither command enables demo mode automatically. `.env.example` sets `MQ_DEMO=1`. Storage is `MQ_DATA_DIR/moneyquest.sqlite`, default `data/moneyquest.sqlite`.

## Conventions and authentication

All successful JSON routes return HTTP 200. Actions without another result return `{ "ok": true }`. Errors are `{ "error": "short message" }`: 400 invalid input/game rule, 401 missing/invalid/expired credentials or wrong password/PIN, 403 child attempting parent access or parent mode locked, 404 unknown route/child or unavailable integration/demo control, 413 JSON body too large, 429 rate/concurrency limit. An unknown child and another family's child both return 404. Unexpected errors return a generic 500.

The login/register/link responses set `mq_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=...`. Cookies also have `Secure` in production or on HTTPS requests. Browser requests should send credentials; do not store another parent token. `Authorization: Bearer <token>` is also accepted and takes precedence over cookies. Tokens are 32 random bytes in base64url; only SHA-256 hashes are stored. JSON login responses do not expose the token. Cookie-backed requests refresh the cookie as the parent session slides; authenticated bearer requests also receive the session cookie. Parent sessions last 30 days sliding, capped at 90 days from creation; child sessions last a fixed 180 days. Logout invalidates the current session and clears the cookie.

Auth levels in the tables:

- **Public**: no session required.
- **Session**: parent or child, even when parent mode is PIN-locked.
- **Child**: paired child, or parent acting for a child (PIN unlock is not required).
- **Parent**: parent session; also requires a current unlock when the family has a PIN.
- **Locked parent**: parent session, available before PIN unlock.

Parents select a child with `?child=<id>` on authenticated routes; the default is the first-created child. Paired child sessions can select only their bound child. `GET /api/auth/me?child=<id>` returns the selection but does not change a server-side active-child setting. B5b should retain the selected ID and send it with each request. `/api/parent/children/:id/link` uses the path ID as its pairing target. Keep `?child=` consistent if also present.

Request bodies must be JSON objects, at most **32 KB**. Strings are trimmed unless stated otherwise; ordinary notes/titles/reasons/memos cap at **120 characters**, identifiers at **64**, bear and child names at **24**, parent names at **64**, chat/speech at **500**. Passwords are untrimmed, 8–1024 characters when registering. Emails are trimmed/lowercased and at most 254 characters. Booleans must be JSON booleans. Numeric fields accept finite numbers or numeric strings; whole-number fields reject fractions. Money in requests is **dollars**, rounded to cents; money in responses and stored documents is **integer cents**. Optional fields may be omitted, not sent as null (except cosmetic unequip).

Every API response has `Cache-Control: no-store` (SSE adds `no-transform`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Permissions-Policy: camera=(), microphone=(self)`. The static app and API receive this CSP:

```text
default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://api.cartesia.ai
```

## Accounts, pairing and PIN

`ChildSummary` is `{id, name, age, bearName, version}`.

`Me` is:

```json
{
  "family": { "id": "family_...", "name": "Jordan", "timezone": "America/Los_Angeles", "pinSet": false },
  "role": "parent",
  "children": [{ "id": "child_...", "name": "Mia", "age": 9, "bearName": "Maple", "version": 1 }],
  "activeChild": { "id": "child_...", "name": "Mia", "age": 9, "bearName": "Maple", "version": 1 },
  "unlockedUntil": 0
}
```

A paired child receives only its own summary in `children`; a parent receives all family children. Times are Unix milliseconds. `unlockedUntil` is session-specific; compare it to current time only when `pinSet` is true. PIN hashes are never returned.

| Method and route | Auth | Request | Response and limits |
| --- | --- | --- | --- |
| `POST /api/auth/register` | Public | `{email, password, parentName, childName, childAge, bearName, timezone?}`; age 7–12, timezone valid IANA name (default UTC) | `Me` + parent cookie. Creates family, parent user and first child atomically. 5 attempts/hour/IP. |
| `POST /api/auth/login` | Public | `{email, password}` | `Me` + parent cookie. 10 attempts/15 minutes/IP and 5/15 minutes/normalized email. Invalid credentials return 401. |
| `POST /api/auth/logout` | Session | No fields | `{ok:true}` + cleared cookie. Revokes the current cookie/bearer session. |
| `GET /api/auth/me` | Session | `?child=` optional | `Me`; remains accessible while PIN-locked. |
| `POST /api/parent/children` | Parent | `{name, age, bearName}`; age 7–12 | New `ChildSummary`. Separate funding account and game document. |
| `POST /api/parent/children/:id/link` | Parent | No fields | `{code, expiresAt}`. Six uppercase characters without vowels/ambiguous characters; expires in 15 minutes, single use. |
| `POST /api/auth/link` | Public | `{code}` (case-insensitive) | `Me` + child cookie, bound to that child. Invalid/used/expired codes return 400. Extra guessing protection: 10 attempts/15 minutes/IP. |
| `POST /api/parent/pin` | Parent | `{pin}` as a string of 4–8 digits | `{ok:true, unlockedUntil}`. Sets/replaces a scrypt hash; unlocks this session for 15 minutes and clears other parent-session unlocks. No default PIN. |
| `POST /api/parent/unlock` | Locked parent | `{pin}` | `{ok:true, unlockedUntil}` for 15 minutes. 5 attempts/15 minutes/session; the fifth wrong PIN returns 401 and persists a further 15-minute lockout; subsequent attempts return 429. |

New children start with zero balances, zero points, no transactions, postcards, adventures, linked friends or pending approvals, and a zero-dollar allowance. They keep the starter wardrobe/bee, empty activity lists and the example bicycle savings goal. Parents must configure allowance. Each child currently has its own funding account; shared family funding is a follow-up. The simulated `DIRECTORY` friend codes remain available through `/api/child/friend`; these are practice friends, not real multiplayer. `friendView` is unchanged and never contains money.

PIN is an optional quick switch **inside a parent-authenticated device**, not a way to obtain a parent session on a paired child device. If a PIN is already set, changing it requires an unlocked parent session. A new password login starts locked until `/api/parent/unlock`. Child routes remain available from that parent session.

## State and events

| Method and route | Auth | Request | Response |
| --- | --- | --- | --- |
| `GET /api/state` | Child | `?child=` for parent | `ChildState` below. |
| `GET /api/parent/state` | Parent | `?child=`, `?before=<message-id>` optional | `ParentState` below. `before` is an exclusive chat cursor; unknown/pruned cursor returns 400. |
| `GET /api/stream` | Child | `?child=` for parent | SSE, described below. |

`ChildState` fields:

| Field | Shape |
| --- | --- |
| `childId`, `version`, `now`, `offline`, `budgetDoneThisWeek` | Selected ID, child document version, server Unix milliseconds, `false`, boolean |
| `child` | `{name, age, points, bear, ownedCosmetics, milestonesUnlocked, stats, lessonsDone, ...progressMarkers}`; bear has `name, hat, eyes, neck, outfit, held, friend, background`; stats have `savingsActions, learningDone, tracked, budgetsDone, adventures` |
| `balances` | `{savings, spending}` in cents |
| `goals` | `[{id, title, icon?, target, createdAt, weeksLeft}]`; weeksLeft can be null when nothing is saved weekly |
| `allowance` | `{amount, savePct, nextRun, spendLimit}` |
| `parentGoals`, `missions` | Goal and mission records described in the parent-action table |
| `transactions` | Latest 30, newest first; `{id, ts, from, to, amount, kind, memo, idempotencyKey, status, ref?, ...reviewFields}` |
| `notifications` | Latest 20 child notifications, newest first; `{id, ts, to, text, kind, ref, read}` |
| `adventures` | Latest 10, newest first; `{id, destId, startedAt, returnsAt, status, postcardIds, returnedAt?}` |
| `postcards` | `[{id, defId, source, collectedAt, fromAdventure?, from?, lockedForTrade?}]` |
| `friends` | Non-declined public `friendView` records: `{id, name, status, bear, postcards, greetings, coopLearning}` |
| `trades` | Latest 10, newest first; `{id, friendId, give, get, status, createdAt, ...executionFields}` |
| `pendingRequests` | Pending child-visible `{id, kind, title}` approvals |
| `plan` | Null or `{summary, steps, weeklySave, goalId, updatedAt, reason?, offline?}` |
| `chat` | Last 30, oldest first; `{id, role, text, ts, redacted?, tools?, auto?}` |
| `settings` | `{requireTradeApproval, buddyEnabled, coopChallenge}` |
| `catalog` | `{places, home, lessons, cosmetics, milestones, points, greetings}`. Lessons omit answer keys; hidden places omit their name/image, expose `{rarity:"secret", hidden:true, clue, lon, lat}` until discovered. Visible places include `image, open, lockReason, progress`. Cosmetics include `unlocked`. |
| `integrations` | `{buddy:"claude"|"offline", voice:"cartesia"|"browser", bank:"nessie"|"simulated"}` |

`ParentState` extends `ChildState` and overrides/adds:

- `family: {parentName}`, `accounts: {parent, savings, spending}` (each `{id,label,balance}`), full `allowance` including cadence, destination and schedule bookkeeping.
- All `approvals`, newest first; `{id,kind,status,createdAt,title,detail,...kindSpecificFields}`. Approval IDs belong to the selected child's document.
- Latest 30 parent `notifications`, 60 `transactions`, 120 `audit` entries (all newest first), latest 20 `tracking` entries (newest first), and unfiltered `friends`.
- `chat`: up to 200 retained messages, oldest first, exclusively before `?before=` if supplied. `chatNextBefore` is the first returned message's ID if more earlier retained messages exist, otherwise null. Retention is 200 total, so paging cannot recover pruned messages.
- Audit entries are `{id,ts,actor,action,detail,data}`; tracking entries are `{id,ts,direction,amount,note}`.

SSE immediately sends the selected child's version, then emits:

```text
data: {"childId":"child_...","version":2}

```

Parent streams receive updates for **all children in their family**; paired child streams receive only their bound child. Use the event's `childId` to decide which view to refresh. Versions are per child, not family-wide. Heartbeats are comments every 25 seconds. Maximum **4 concurrent streams/family**; opening the fifth closes the oldest. Backpressured streams close instead of buffering without bound. Disconnected streams unsubscribe. Revoked/expired sessions close on the next relevant event or heartbeat; reconnect through the usual auth flow.

## Child actions

All routes below have **Child** auth and support parent `?child=` selection. Unless listed otherwise, success is `{ok:true}`. Shared identifiers and strings have the caps above. Default money bounds are $0–$10,000, with tighter bounds below.

| Method and route | JSON request | Response / additional validation |
| --- | --- | --- |
| `POST /api/child/save` | `{amount}` | `{ok:true}`; $1–$10,000, cannot exceed spending balance. |
| `POST /api/child/spend` | `{amount,memo}` | `{held:false}` or `{held:true,reason}` pending parent approval; $0.01–$10,000, cannot exceed spending balance. |
| `POST /api/child/journal` | `{direction,amount,note}` | `{bonus:boolean}`; direction `received`, `spent` or `saved`; $0–$10,000. Records learning activity, does not move funds. |
| `POST /api/child/extra` | `{amount,reason}` | Created extra-allowance approval record; $1–$50. |
| `POST /api/child/lesson` | `{lessonId,answers:[integer,...]}` | `{passed,correct,total,firstTime?}`; one choice for every question. |
| `POST /api/child/budget` | `{allocations:{save,needs,fun,give}}` | `{pointsAwarded}`; dollar amounts must total $20, save >=$4, needs >=$5. |
| `POST /api/child/mission/:id/done` | No fields | Updated mission record, now `pending_review`. |
| `POST /api/child/adventure` | `{destId}` | Adventure record; catalog eligibility and whole available points required, at most one `away` trip. |
| `POST /api/child/cosmetic/buy` | `{id}` | `{ok:true}`; catalog item must be purchasable and affordable. |
| `POST /api/child/cosmetic/equip` | `{kind,value}` | `{ok:true}`; owned item ID; null unequips except background requires a scene. |
| `POST /api/child/bear/name` | `{name}` | `{ok:true}`; 1–24 trimmed characters. |
| `POST /api/child/friend` | `{code}` | New public `friendView` record, pending parent approval. Practice codes from `DIRECTORY` remain supported. |
| `POST /api/child/trade` | `{friendId,give,get}` | Trade record; catalog postcard IDs, approved friend, owned unlocked copy; secret postcards cannot be traded. |
| `POST /api/child/greet` | `{friendId,index}` | `{ok:true}`; predefined greeting index 0 through `catalog.greetings.length-1`, approved friend. |
| `POST /api/child/notifications/read` | No fields | `{ok:true}`; marks only child notifications read. |
| `POST /api/buddy/chat` | `{text}` | `{reply,toolsUsed}`; nonempty <=500 characters, Buddy enabled. 30/hour/child and only 1 in flight/child; returns 429 while Buddy is thinking. Redacts PII, retains Haiku screening for live replies. |
| `POST /api/buddy/speak` | `{text}` | `audio/mpeg` bytes; nonempty <=500 characters, Buddy enabled. 60/hour/child; 404 if Cartesia not configured. |
| `POST /api/voice/token` | No fields | `{token,version,request:{model_id,voice,output_format,language,generation_config}}`; Buddy enabled, 20/10 minutes/child; 404 without Cartesia. `token` is Cartesia's short-lived TTS-only token, not the MoneyQuest session. |

## Parent actions

All routes below require **Parent** auth and operate on the selected child (`?child=`). Each mutation runs reconciliation before the action and Guardian afterward, except deliberate fault injection. Guardian-only writes and adventure finalization also run on the 2-second tick, which mutates only children with due work.

| Method and route | JSON request | Response / limits |
| --- | --- | --- |
| `POST /api/parent/approval/:id` | `{approve:boolean,note?:string}` | Updated approval record. Can decline approved-but-unpaid money requests. Paid requests cannot be declined. |
| `POST /api/parent/goal` | `{title,type,count,reward}` | Goal `{id,title,type,count,reward,progress,status,createdAt}`. Type `lessons`, `tasks`, `save_actions`; count integer 1–50; reward $0–$100 (returned in cents). |
| `POST /api/parent/mission` | `{title,points?}` | Mission `{id,title,points,status,createdBy,createdAt}`; integer 5–100 points (default catalog parent points). |
| `POST /api/parent/allowance` | Partial `{amount?,savePct?,spendLimit?,rewardDestination?}` | `{ok:true}`; amount $0–$100, savePct integer 0–100, spendLimit $0–$10,000, destination `spending` or `savings`. |
| `POST /api/parent/settings` | Partial `{requireTradeApproval?,buddyEnabled?,coopChallenge?}` | `{ok:true}`; strict booleans. Disabling Buddy cancels this child's queued/in-flight replans. |
| `POST /api/parent/savings-goal` | Partial `{title?,target?}` | `{ok:true}`; updates first savings goal, target $1–$10,000. |

## Demo controls

`MQ_DEMO=1` ensures a demo family exists with parent `demo@moneyquest.test` / `demo-pass-1234` and Mia/Maple, including two Chicago postcards. The password is hashed; there is no seeded PIN. Existing demo progress is preserved on restart. Every path under `/api/demo` returns 404 when demo mode is unset.

| Method and route | Auth | Request | Response |
| --- | --- | --- | --- |
| `POST /api/demo/login` | Public, demo enabled | No fields | `Me` + demo parent cookie. A configured family PIN still gates parent routes. |
| `POST /api/parent/reset` | Parent, demo enabled, demo family only | No fields | `{ok:true}`; resets only the selected demo child, cancels its replans, adds a starting plan and `demo_reset` audit. |
| `POST /api/parent/inject-fault` | Parent, demo enabled | No fields | `{injected:transactionId}`; duplicate in selected child's ledger, corrected by next Guardian tick; `demo_fault` audit. |
| `POST /api/parent/allowance/run-now` | Parent, demo enabled | No fields | `{ok:true}`; fast-forward selected child's allowance while preserving overdue periods; rejects an already-paid current day; `demo_allowance_run` audit. |
| `POST /api/parent/topup` | Parent, demo enabled | `{amount}` | `{ok:true}`; $0.01–$1,000 to selected child's simulated parent funding account; `demo_topup` audit. |

While demo mode is enabled, topup/fault/run-now work for any authenticated parent's own selected child; reset is restricted to the demo family. These controls are not real bank deposits. `npm run reset` explicitly enables demo mode for that command and resets only the demo child in SQLite; it does not delete any family's database.

On first startup an existing `MQ_DATA_DIR/db.json` is imported as the demo child/family before optional demo-account creation, then renamed `db.json.imported`. The legacy plaintext PIN is discarded. Malformed legacy files stop initialization and are left untouched. Import does not overwrite an already-existing demo family. When demo mode is disabled, imported progress remains stored and demo login is unavailable; enable demo mode to access that legacy demo family.

## Limits, storage and integration notes

Rate windows, in-flight chat locks and SSE connection lists are **in-memory, per process**; rate windows reset on restart. PIN lockout deadlines and sessions persist in SQLite. Deploy one API process per database; multi-process rate limiting, cache invalidation and cross-process SSE are follow-ups. IP keys use Express `req.ip` without blindly trusting forwarded headers. If deploying behind a trusted reverse proxy, configure an appropriate trusted-proxy policy before relying on distinct client IPs.

Retention per child: tracking **500**, audit **2000**, transactions **5000**, Buddy chat **200**, notifications **200 per recipient**. Oldest entries are pruned on mutation. Each mutation uses a SQLite transaction and restores held document references after failures; versions and family notifications advance only after commit. Store subscribers receive `(version,childId)` within their family.

Nessie defaults to `https://api.nessieisreal.com`. With `NESSIE_API_KEY` configured, an insecure URL prevents startup unless `NESSIE_ALLOW_HTTP=1` explicitly permits local development. Mirrors and asynchronous audit callbacks retain the originating child's context. The local simulated ledger remains authoritative; no real money moves. Live external service availability was not exercised by the server tests.

Passwords and PINs use `scrypt$32768$8$1$<16-byte-salt-base64>$<64-byte-key-base64>` with constant-time verification. The optional family timezone is stored in SQLite and returned by `/api/auth/me`; this batch does not alter the existing game/calendar reward rules.

The old `POST /api/parent/login` PIN-to-token flow and `x-parent-token` header are removed. B5b must implement account login/register, cookie auth, pairing, active-child selection, PIN unlock and logout using the routes above.
