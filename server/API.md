# MoneyQuest server API

This is the API contract for the v0.4.0 release candidate; the cookie-based client is implemented in `client/src`. The server requires Node >=22.9 (built-in `node:sqlite` and the existing env-file flags). Launch/reset scripts include `--experimental-sqlite` for early Node 22 compatibility. For direct test commands on Node 22.9–22.12, use `NODE_OPTIONS=--experimental-sqlite node --test server/*.test.js`; later supported versions can run `node --test server/*.test.js`. See [Node 22.9 SQLite docs](https://nodejs.org/download/release/v22.9.0/docs/api/sqlite.html) for the flag requirement. Run `npm run dev` or `npm start` with your environment; neither command enables demo mode automatically. `.env.example` sets `MQ_DEMO=1`. Storage is `MQ_DATA_DIR/moneyquest.sqlite`, default `data/moneyquest.sqlite`.

## Conventions and authentication

All successful JSON routes return HTTP 200. Actions without another result return `{ "ok": true }`. Errors are `{ "error": "short message" }` (except the `/api/auth/me` 401 shape below): 400 invalid input/game rule, 401 missing/invalid/expired credentials or wrong password/PIN, 403 child attempting parent access or parent mode locked, 404 unknown route/child or unavailable integration/demo control, 413 JSON body too large, 429 rate/concurrency limit. An unknown child and another family's child both return 404. Unexpected errors return a generic 500.

The login/register/link responses set `mq_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=...`. Cookies also have `Secure` in production or on HTTPS requests. Browser requests should send credentials; do not store another parent token. `Authorization: Bearer <token>` is also accepted and takes precedence over cookies. Tokens are 32 random bytes in base64url; only SHA-256 hashes are stored. JSON login responses do not expose the token. Cookie-backed requests refresh the cookie as the parent session slides; authenticated bearer requests also receive the session cookie. Parent sessions last 30 days sliding, capped at 90 days from creation; child sessions last a fixed 180 days. Logout invalidates the current session and clears the cookie.

Auth levels in the tables:

- **Public**: no session required.
- **Session**: parent or child, even when parent mode is PIN-locked.
- **Child**: paired child, or parent acting for a child (PIN unlock is not required).
- **Parent**: parent session; also requires a current unlock when the family has a PIN.
- **Locked parent**: parent session, available before PIN unlock.

Parents select a child with `?child=<id>` on authenticated routes; the default is the first-created child. Paired child sessions can select only their bound child. `GET /api/auth/me?child=<id>` returns the selection but does not change a server-side active-child setting. The client retains the selected ID and sends it with each request. `/api/parent/children/:id/link` uses the path ID as its pairing target. Keep `?child=` consistent if also present.

Request bodies must be JSON objects, at most **32 KB**. Strings are trimmed unless stated otherwise; ordinary notes/titles/reasons/memos cap at **120 characters**, identifiers at **64**, bear and child names at **24**, parent names at **64**, chat/speech at **500**. Passwords are untrimmed, 8–1024 characters when registering. Emails are trimmed/lowercased and at most 254 characters. Booleans must be JSON booleans. Numeric fields accept finite numbers or numeric strings; whole-number fields reject fractions. Money in requests is **dollars**, rounded to cents; money in responses and stored documents is **integer cents**. Optional fields may be omitted, not sent as null (except cosmetic unequip).

Every API response has `Cache-Control: no-store` (SSE adds `no-transform`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Permissions-Policy: camera=(), microphone=(self)`. The static app and API receive this CSP:

```text
default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://api.cartesia.ai https://fonts.googleapis.com https://fonts.gstatic.com
```

## Accounts, pairing and PIN

`ChildSummary` is `{id, name, age, bearName, version}`.

`Me` is:

```json
{
  "demo": false,
  "family": { "id": "family_...", "name": "Jordan", "timezone": "America/Los_Angeles", "pinSet": false },
  "role": "parent",
  "children": [{ "id": "child_...", "name": "Mia", "age": 9, "bearName": "Maple", "version": 1 }],
  "activeChild": { "id": "child_...", "name": "Mia", "age": 9, "bearName": "Maple", "version": 1 },
  "unlockedUntil": 0
}
```

A paired child receives only its own summary in `children`; a parent receives all family children. Times are Unix milliseconds. `unlockedUntil` is session-specific; compare it to current time only when `pinSet` is true. PIN hashes are never returned.

`demo` is always a boolean: true exactly when `MQ_DEMO=1` and the signed-in family is the demo family. Real families always receive false. Without a valid session, `GET /api/auth/me` returns HTTP 401 with `{ "error": "short message", "demo": false }` (or `demo: true` when enabled). This lets the Welcome screen discover demo availability before login; no family or session details are included in that response.

| Method and route | Auth | Request | Response and limits |
| --- | --- | --- | --- |
| `POST /api/auth/register` | Public | `{email, password, parentName, childName, childAge, bearName, timezone?}`; age 7–12, timezone valid IANA name (default UTC) | `Me` + parent cookie. Creates family, parent user and first child atomically. 5 attempts/hour/IP. |
| `POST /api/auth/login` | Public | `{email, password}` | `Me` + parent cookie. 10 attempts/15 minutes/IP and 5/15 minutes/normalized email. Invalid credentials return 401. |
| `POST /api/auth/logout` | Session | No fields | `{ok:true}` + cleared cookie. Revokes the current cookie/bearer session. |
| `POST /api/auth/logout-all` | Parent | No fields | `{ok:true}` + cleared cookie. Revokes every session of the family, including all parents, paired kid devices and the current cookie/bearer session. Requires PIN unlock when a PIN is set. Other families are untouched. Kid devices need new codes to pair again. |
| `GET /api/auth/me` | Session (401 discovery available without a session) | `?child=` optional | `Me`, including `demo`; remains accessible while PIN-locked. Missing/invalid/expired session: 401 `{error,demo}`. |
| `POST /api/parent/children` | Parent | `{name, age, bearName}`; age 7–12 | New `ChildSummary`. Separate funding account and game document. |
| `POST /api/parent/children/:id/link` | Parent | No fields | `{code, expiresAt}`. Six uppercase characters without vowels/ambiguous characters; expires in 15 minutes, single use. 5 generation attempts/15 minutes/child; excess returns 429 with `Let's take a little break. Try again soon!`. Each new code cancels older unused codes for that child. Known used/expired/cancelled codes remain as tombstones for specific error copy; other children's codes are untouched. |
| `POST /api/auth/link` | Public | `{code}` (case-insensitive) | `Me` + child cookie, bound to that child. Unknown codes return 400 `{error,reason:"unknown"}`; known used/expired/cancelled codes return 400 `{error,reason:"used_or_expired"}`. Extra guessing protection: 10 attempts/15 minutes/IP. |
| `GET /api/parent/children/:id/link` | Parent | `?code=<code>` (case-insensitive) | `{status:"pending"\|"linked"\|"expired"}` for that exact child's code. Used codes stay `linked` after expiry or device unlink; cancelled unused codes are `expired`. Unknown codes or codes belonging to another child/family return 404. Read-only; does not consume or extend a code. |
| `POST /api/parent/pin` | Parent | `{pin}` as a string of 4–8 digits | `{ok:true, unlockedUntil}`. Sets/replaces a scrypt hash; unlocks this session for 15 minutes and clears other parent-session unlocks. No default PIN. |
| `POST /api/parent/unlock` | Locked parent | `{pin}` | `{ok:true, unlockedUntil}` for 15 minutes. Only failed attempts count (5/15 minutes/session); success resets the counter. Failures 1–4 return 401 `{error,attemptsLeft}`. The fifth failure locks for 15 minutes from that failure and returns 429 `{error,attemptsLeft:0,retryAfterSeconds:900}`. Attempts during the lock return 429 with remaining `retryAfterSeconds` and a matching `Retry-After` header. A correct PIN cannot bypass the lock. |
| `POST /api/parent/lock` | Locked parent | No fields | `{ok:true,unlockedUntil:0}`; clears this session's server unlock immediately, even if already locked. |
| `POST /api/parent/pin/reset` | Locked parent | `{password}` | Verifies the current parent's password and clears the family PIN plus all parent unlock/lockout deadlines. `{ok:true,unlockedUntil:0}`; wrong password: 401. Shares login limits (10/15 minutes/IP, 5/15 minutes/normalized email). |
| `GET /api/parent/children/:id/devices` | Parent | No fields | Array of active paired child devices: `{id,created_at,last_seen,name}`. Times in Unix milliseconds; `name` is a short user-agent description. IDs are separate opaque digests, not session tokens or stored credential hashes. |
| `DELETE /api/parent/children/:id/devices/:sessionId` | Parent | No fields | `{ok:true}`; revokes only that child's device within this family. Unknown child/device: 404. Requires PIN unlock when set. |

New children start with zero balances, zero points, no transactions, postcards, adventures, linked friends or pending approvals, and a zero-dollar allowance. They keep the starter wardrobe/bee, empty activity lists and the example bicycle savings goal. Parents must configure allowance. Each child currently has its own funding account; shared family funding is a follow-up. New non-demo families cannot add funding through the current UI/API because top-ups are demo-only; configuring allowance alone does not fund it. The simulated `DIRECTORY` friend codes remain available through `/api/child/friend`; these are practice friends, not real multiplayer. `friendView` is unchanged and never contains money.

PIN is an optional quick switch **inside a parent-authenticated device**, not a way to obtain a parent session on a paired child device. If a PIN is already set, changing it requires an unlocked parent session. A new password login starts locked until `/api/parent/unlock`. Child routes remain available from that parent session.

## State and events

| Method and route | Auth | Request | Response |
| --- | --- | --- | --- |
| `GET /api/state` | Child | `?child=` for parent | `ChildState` below. |
| `GET /api/parent/state` | Parent | `?child=`, `?before=<message-id>` optional | `ParentState` below. `before` is an exclusive chat cursor; unknown/pruned cursor returns 400. |
| `GET /api/stream` | Child | `?child=` for parent | SSE, described below. |

`ChildState` fields (game calendar keys use the selected child document's `settings.timezone`, falling back to the server zone):

| Field | Shape |
| --- | --- |
| `childId`, `version`, `now`, `dayKey`, `weekKey`, `offline`, `budgetDoneThisWeek` | Selected ID, child document version, server Unix milliseconds, zoned `YYYY-MM-DD`, ISO `YYYY-Www`, `false`, boolean |
| `child` | `{name, age, points, bear, ownedCosmetics, milestonesUnlocked, stats, lessonsDone, ...progressMarkers}`; bear has `name, hat, eyes, neck, outfit, held, friend, background`; stats have `savingsActions, learningDone, tracked, budgetsDone, adventures` |
| `balances` | `{savings, spending}` in cents |
| `goals` | `[{id, title, icon?, target, createdAt, weeksLeft}]`; weeksLeft can be null when nothing is saved weekly |
| `allowance` | `{amount, savePct, nextRun, spendLimit}` |
| `parentGoals`, `missions` | Goal and mission records described in the parent-action table |
| `transactions` | Latest 30, newest first; `{id, ts, from, to, amount, kind, memo, idempotencyKey, status, ref?, ...reviewFields}` |
| `notifications` | Latest 20 child notifications, newest first; `{id, ts, to, text, kind, ref, read}` |
| `adventures` | Latest 10, newest first; `destId` omitted while away in child state; `{id, destId, startedAt, returnsAt, status, postcardIds, returnedAt?}` |
| `metrics` | `{postcards:{places,cards,total}}`; unique trip places, all cards, and catalog total |
| `postcards` | `[{id, defId, source, collectedAt, fromAdventure?, from?, lockedForTrade?}]` |
| `friends` | Non-declined public `friendView` records: `{id, name, status, bear, postcards, greetings, coopLearning}` |
| `trades` | Latest 10, newest first; `{id, friendId, give, get, status, createdAt, ...executionFields}` |
| `pendingRequests` | Pending child-visible `{id, kind, title}` approvals |
| `plan` | Null or `{summary, steps, weeklySave, goalId, updatedAt, reason?, offline?}` |
| `chat` | Last 30, oldest first; `{id, role, text, ts, redacted?, tools?, auto?}` |
| `settings` | `{requireTradeApproval, buddyEnabled, coopChallenge, timezone?}`; timezone is an IANA name stored per child |
| `catalog` | `{places, home, lessons, cosmetics, milestones, points, trip, greetings}`. Lessons omit answer keys; hidden places omit their name/image, expose `{rarity:"secret", hidden:true, clue, lon, lat}` until discovered. Visible places include `image, open, lockReason, progress`. Cosmetics include `unlocked`. |
| `integrations` | `{buddy:"claude"|"offline", voice:"cartesia"|"browser", bank:"nessie"|"simulated"}` |

`ParentState` extends `ChildState` and overrides/adds:

- `adventures` includes `destId` while away; parent notification refs are deduplicated.
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
| `POST /api/child/trip` | No fields | Surprise adventure record without `destId`; costs `catalog.trip.cost` (30 points), at most one away trip; draws only open places. |
| `POST /api/child/adventure/:id/seen` | No fields | Returned adventure record; records idempotent `revealedAt` on the selected child's returned adventure. |
| `POST /api/child/adventure` | `{destId}` | Adventure record without `destId`; catalog eligibility and whole available points required, at most one `away` trip. |
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
| `POST /api/parent/goal` | `{title,type,count,reward}` | Goal `{id,title,type,count,reward,progress,status,createdAt}`. Type `lessons`, `tasks`, `save_actions`; count integer 1–50 (lessons cannot exceed remaining unpassed lessons); reward $0–$100 (returned in cents). |
| `POST /api/parent/goal/:id/cancel` | No fields | Cancelled active goal; kindly notifies the child and writes audit. |
| `POST /api/parent/mission` | `{title,points?}` | Mission `{id,title,points,status,createdBy,createdAt}`; integer 5–100 points (default catalog parent points). |
| `POST /api/parent/allowance` | Partial `{amount?,savePct?,spendLimit?,rewardDestination?}` | `{ok:true}`; amount $0–$100, savePct integer 0–100, spendLimit $0–$10,000, destination `spending` or `savings`. |
| `POST /api/parent/funding/add` | `{amount,note?:string}` | `{ok:true}`; $1–$1,000, optional trimmed note up to 120 characters. Any family; PIN unlock required when set. Records a `funding_in` transaction (`external` → `parent`) for the selected child's funding account, with memo from note or `Added by <parentName>`. Audits `Recorded $X added to <childName>'s funding — real money stays with you`. No child notification; funding entries/notes stay in parent state. Clears parent-funded escalations so allowance/rewards can pay on the next Guardian pass (including the post-action pass). No route-specific rate limit; normal body limits apply. |
| `POST /api/parent/settings` | Partial `{requireTradeApproval?,buddyEnabled?,coopChallenge?,timezone?}` | `{ok:true}`; strict booleans; timezone must be a valid IANA name. Disabling Buddy cancels this child's queued/in-flight replans. |
| `POST /api/parent/savings-goal` | Partial `{title?,target?}` | `{ok:true}`; updates first savings goal, target $1–$10,000. |

## Apple Cash tracking (F2)

| Method and route | Auth | Request / response |
| --- | --- | --- |
| `POST /api/parent/wallet/send` | Parent | `{amount,note?}` records an already-sent inflow `outside → wallet`, `kind:wallet_in`, memo `Sent via Apple Cash`; returns the transaction. $0.01–$10,000. Money comes from the parent's own pocket: only wallet is credited, with no debit or change to the child's funding record, savings or spending. This is tracking, not a payment instruction. |
| `POST /api/child/wallet/spend` | Child | `{amount,merchant,at?,external_id?}` records `wallet → merchant`, `kind:wallet_spend`; returns the transaction plus `duplicate`. Amount $0.01–$10,000; merchant <=120 chars; date ISO 8601 with zone or Unix milliseconds; external ID <=64 chars. Keys persist per child after ledger retention. Short balances post with `uncovered:true`; over-limit purchases notify without a hold. G4 anomaly notices apply. |
| `GET /api/child/wallet/token` | Parent + configured, unlocked PIN | `{token:null,id,expiresAt}` for the selected child's active Shortcut, null ID/time if absent; no mutation. |
| `POST /api/child/wallet/token` | Parent + configured, unlocked PIN | `{}` rotates/revokes only that child's Shortcut sessions; returns `{token,id,expiresAt}`. Raw token is shown only in this response; hashes only in storage. |
| `POST /api/child/wallet/ping` | Child | `{}` returns `{ok:true,childId,at}` and records the connection time without a transaction. |

Ping and spend each allow 60 requests per hour per authenticated session and
selected child, in independent fixed windows starting with the first request.
This includes Shortcut Bearer tokens, paired child browsers and parent sessions
using child routes. Authenticated invalid payloads and idempotent retries count.
Excess requests return 429 with `{error:"Let's take a little break. Try again soon!",
retryAfterSeconds:N}` and a matching `Retry-After: N` header; they do not change the
wallet or ping time. Keep pending Shortcut purchases and retry after that delay
with the original body and `external_id`. Limits are process-local and reset on
API restart, like the other request limits.

The ledger invariant is funding + savings + spending + wallet + posted merchant
outflows − posted outside inflows. Recording sent Apple Cash increases wallet
and outside inflows equally; it never reduces funding or drives funding negative.

All routes honor `?child=`. Shortcut credentials are child-bound, fixed 180-day
sessions with device kind `shortcut`. Devices responses now include `kind`
(`browser` or `shortcut`); Shortcut name is `Apple Cash Shortcut`. Existing Unlink
and family-wide logout revoke them. Normal paired sessions are unaffected by
Shortcut rotation. Browser setup tests must omit cookies when using the Bearer
token so the test cannot replace the parent's session cookie.

New and migrated documents have `accounts.wallet` (`Apple Cash`, initial balance
0). Child state adds `balances.wallet` and `walletLastTransaction` (null or latest
recorded wallet transaction). Parent state includes `accounts.wallet`, up to 60
`walletTransactions` newest first, and `walletLastPing` (null or Unix milliseconds).
Wallet transactions include `note` for parent sends and `merchant`, `recordedAt`,
`uncovered` and optional `external_id` for purchases. `uncovered` is historical;
later incoming records reconcile the balance without rewriting that flag.
These are real-family tracking routes, independent of demo controls. See
[Shortcut setup](../docs/apple-cash-shortcut.md) for the exact automation body.

## Demo controls

`MQ_DEMO=1` ensures a demo family exists with parent `demo@moneyquest.test` / `demo-pass-1234` and Mia/Maple, including two Chicago postcards. The password is hashed; there is no seeded PIN. Existing demo progress is preserved on restart. Every path under `/api/demo` returns 404 when demo mode is unset.

| Method and route | Auth | Request | Response |
| --- | --- | --- | --- |
| `POST /api/demo/login` | Public, demo enabled | No fields | `Me` + demo parent cookie. A configured family PIN still gates parent routes. |
| `POST /api/parent/reset` | Parent, demo enabled, demo family only | No fields | `{ok:true}`; resets only the selected demo child, cancels its replans, adds a starting plan and `demo_reset` audit. |
| `POST /api/parent/inject-fault` | Parent, demo enabled, demo family only | No fields | `{injected:transactionId}`; duplicate in selected child's ledger, corrected by next Guardian tick; `demo_fault` audit. |
| `POST /api/parent/allowance/run-now` | Parent, demo enabled, demo family only | No fields | `{ok:true}`; fast-forward selected child's allowance while preserving overdue periods; rejects an already-paid current day; `demo_allowance_run` audit. |
| `POST /api/parent/topup` | Parent, demo enabled, demo family only | `{amount}` | **Demo-only**; `{ok:true}`; $0.01–$1,000 to selected child's simulated parent funding account; `demo_topup` audit. Real families receive 404; use `POST /api/parent/funding/add` to record money set aside. |

All four demo controls require demo mode and the demo family; real families receive 404 even when demo mode is enabled. These controls are not real bank deposits. `npm run reset` explicitly enables demo mode for that command and resets only the demo child in SQLite; it does not delete any family's database. Stop the API before using the CLI reset and restart afterward: a running process caches documents and can write its old copy back. Use `POST /api/parent/reset` for a live demo reset, which also cancels queued/in-flight Buddy work for the selected child.

On first startup an existing `MQ_DATA_DIR/db.json` is imported as the demo child/family before optional demo-account creation, then renamed `db.json.imported`. The legacy plaintext PIN is discarded. Malformed legacy files stop initialization and are left untouched. Import does not overwrite an already-existing demo family. When demo mode is disabled, imported progress remains stored and demo login is unavailable; enable demo mode to access that legacy demo family.

## Limits, storage and integration notes

Rate windows, in-flight chat locks and SSE connection lists are **in-memory, per process**; rate windows reset on restart. PIN lockout deadlines and sessions persist in SQLite. Deploy one API process per database; multi-process rate limiting, cache invalidation and cross-process SSE are follow-ups. IP keys use Express `req.ip` without blindly trusting forwarded headers. If deploying behind a trusted reverse proxy, configure an appropriate trusted-proxy policy before relying on distinct client IPs.

On POSIX, opening/creating `MQ_DATA_DIR/moneyquest.sqlite` restricts its mode to **0600** (owner read/write only), along with any existing `-wal` and `-shm` files. Permissions are reapplied after WAL/schema initialization to cover newly created sidecars. Windows skips chmod; unsupported-platform/filesystem chmod errors are ignored.

Retention per child: tracking **500**, audit **2000**, transactions **5000**, Buddy chat **200**, notifications **200 per recipient**. Oldest entries are pruned on mutation. Each mutation uses a SQLite transaction and restores held document references after failures; versions and family notifications advance only after commit. Store subscribers receive `(version,childId)` within their family.

Nessie defaults to `https://api.nessieisreal.com`. With `NESSIE_API_KEY` configured, an insecure URL prevents startup unless `NESSIE_ALLOW_HTTP=1` explicitly permits local development. Mirrors and asynchronous audit callbacks retain the originating child's context. The local simulated ledger remains authoritative; no real money moves. Live external service availability was not exercised by the server tests.

Passwords and PINs use `scrypt$32768$8$1$<16-byte-salt-base64>$<64-byte-key-base64>` with constant-time verification. The registration timezone is stored on the SQLite family row and returned by `/api/auth/me`. Game/calendar rules currently use each child document's `settings.timezone`, falling back to the server zone. The parent UI initializes a missing child setting from the browser and edits it through `/api/parent/settings`; changing it does not update the family row or siblings.

The old `POST /api/parent/login` PIN-to-token flow and `x-parent-token` header are removed. The client implements account login/register, cookie auth, pairing, active-child selection, PIN unlock/reset, device unlinking and family-wide logout using the routes above.
