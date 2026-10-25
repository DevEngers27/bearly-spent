# Client browser regression checklist

Use this consolidated plan for the v0.4.0 release candidate. Unchecked boxes are checks to perform on the build under review; this docs pass did not start a server or run a browser. Earlier release smoke runs are recorded in [CHANGELOG.md](../CHANGELOG.md). Socket-free automated coverage is separate: `npm test` and `node --test client/*.test.mjs` (215 server tests and 92 client checks on this candidate).

Use a production app origin (HTTPS or localhost), DevTools Network/Application panels, desktop and 390×844 phone viewports, and two separate browser profiles/devices. Enable demo mode for seeded balances and demo controls. Use a fresh real family for isolation/zero-balance checks; demo data is not the starting state of a new family. For offline checks, wait for worker activation and art warming before disconnecting. Record build, browser, date and results when checking boxes; include actual device evidence for install behavior.

## Accounts, family isolation and access

- [ ] **B5b — Create/sign in:** Welcome offers Sign in, Create family and I have a kid code. Register with parent name/email, an 8+ character password, child age 7–12 and bear name; the request includes the browser IANA zone. A new child has zero balances/points and no seeded friends/cards. An HttpOnly cookie is set; no session token appears in JSON or client storage. Sign out, sign in and reload. Bad credentials preserve inputs and show inline copy; a configured PIN gates the parent view after password login.
- [ ] **B5b / W2.6/10 — Codes:** Add a second child; the header switcher updates. Generate a code for either child, including an unselected one: path ID and child query match the target. Six selectable characters count down from 15 minutes. Copy works on HTTPS; without clipboard support the read-only field can be selected. Expiry prevents copying. A replacement cancels the child's prior unused code without affecting siblings. Unknown code has distinct copy from used/expired/cancelled code.
- [ ] **B5b / W2.2 — Pair a kid:** In the second profile choose I have a kid code. Typing, paste, large keys and Delete accept only `BCDFGHJKMNPQRTVWXY346789`, uppercase before capping at six. Pair once, then reload. Only the bound child's app appears; no Sign out, Grown-ups or parent controls appear. The used code fails a second time. Pair another device for device-management checks.
- [ ] **B5b — Child selection/isolation:** Switch siblings and verify accounts (including separate funding), rules, goals, approvals, Buddy chats/settings and forms without flashing old state. State/action/SSE requests carry the selected child. Sibling SSE updates do not refresh this child's view. Reload keeps a valid selection; another family's stale selection falls back safely. A real family cannot read, mutate or pair another family's child.
- [ ] **B5b — Stale selection recovery:** Force selected-child 404: client fetches auth/me without the stale selection, persists the first current child and remounts it, including in Kid mode. An old delayed 404/recovery response must not override a new selection or sign-out. A 404 without a child query does not reset selection.
- [ ] **S6 / W2.7 — Server lock:** Set/change a 4–8 digit PIN in Security. Lock, Kid mode and PIN-sheet Back to kid view each post parent/lock and clear unlockedUntil; protected parent/state then returns locked 403. Network failure keeps the current view and reports failure. Returning through Grown-ups requires PIN. Without a PIN it returns directly and suggests setting one. A kid session cannot acquire parent access through PIN.
- [ ] **W2.4/8 — PIN limits/reset:** Successful unlocks do not consume attempts. Fail three times: two tries left; success resets. Fifth failure returns 429 and 900 retry seconds; even a correct PIN is blocked for the full lockout. Deadline displays in en-US time and Unlock is disabled. Repeat after expiry. Forgot PIN? accepts the parent's password, clears PIN/lockouts and permits a new PIN; wrong password stays inline and login rate limits apply.
- [ ] **C6 — Expiry/errors:** Revoke/expire a session then act before polling: authenticated 401 immediately clears cached identity/state and opens Welcome. Wrong-login/wrong-PIN 401 stays inline. Parent locked 403 (or 423) opens PIN; child-access 403 never exposes parent controls. A 429 shows friendly copy and reaches the form error handler. Restart alone preserves a valid stored session.
- [ ] **W2.5/6 — Sign out/devices:** Parent Sign out revokes only the current session and clears local caches; failed network logout does not claim success. Children → Devices shows browser/system, paired and last-seen times. Unlink one device: only it gets 401; locked parents and kid sessions cannot list/unlink. Sign out everywhere confirmation names parents, kids and this device/new codes: Cancel sends nothing; Confirm revokes the whole family, while another family stays signed in. Expired PIN opens unlock; errors keep the session visible.
- [ ] **W2.9 — Demo scope:** Without a cookie, auth/me discovery returns 401 with only error/demo; Welcome advertises Try the demo family only when enabled. Discovery refreshes after logout/back navigation, and delayed discovery never interrupts Sign in. Authenticated demo is true only for the demo family. Real-family Approvals/Allowance/Guardian/Settings hide Add $50, Fast-forward, Post a duplicate and Reset demo; direct requests return 404 even on a demo-enabled server.

## Money, lessons and parent forms

- [ ] **C13 / M16 — Single submission:** Under Slow 3G, double-click/Enter twice on lesson final answer, save/spend/diary/extra, trip, task Done, budget Finish, swap, friend/greet, wardrobe/equip/rename, chat, PIN and parent mutations. Each view disables relevant POST controls until settlement, sends one action and recovers after errors. Include code generation, unlink, logout and settings.
- [ ] **C9 — Repeated saving:** Choose $1/$2 and save three times after each response: amount and sheet remain, exactly three transfers occur, and daily points do not repeat. Spend preserves the submitted amount until closing; diary entries do not move funds.
- [ ] **C5 / B6 — Budget/calendar:** Finish a valid $20 budget: Missions shows checked/disabled, no +50 after refresh/reload. Next server ISO week restores eligibility. Change device clock/zone: Today and This week still use server dayKey/weekKey. Daily reset follows the selected child's configured zone; weeks are Monday–Sunday.
- [ ] **B2 — Lessons:** A first pass gives +20 and one goal/team step; replay says “Nice review! No extra points for repeats.” Failed final request retries with exactly one answer per question.
- [ ] **D2 — Achievable/cancelled goals:** Create before first passes; after passing three lessons, count says two remaining and rejects three. Cancel an active goal: struck parent row, kind child note, no later progress. A legacy impossible goal says Ask your grown-up without a lesson suggestion. Rewards require approval; zero-dollar goals complete without a transfer.
- [ ] **C4 / D9 — Form drafts:** Edit savings-goal/allowance fields in another authorized tab: affected form refreshes. Ordinary polls/payday changes preserve drafts. Savings edits preserve reward/task drafts; Friends & privacy edits preserve allowance drafts. Sibling selection remounts for the new child.
- [ ] **C7 — Empty goals:** Intercept state with goals empty: Home/Chat/Parent Overview/Goals render Set a savings goal without crashes. My money still opens and parent inputs show useful defaults.
- [ ] **D4 — Inbox:** Approve/decline reward, task, extra, trade and friend: original reminders clear, duplicate refs collapse, resolved escalations notify once. Parent allowance note names savings/spending amounts. Empty approvals and notifications each say Nothing waiting — nice! Declined trade unlocks copies; declined friend can be requested again.
- [ ] **M3 / D5/7/11 — Guardian demo:** Fast-forward once, then immediately again: second refuses without payout/schedule drift. Repeat after a time-zone change. Inject a duplicate after a payout; next check safely reverses it, logs a readable sentence with refs only in audit data, and labels both ledgers reversed. Funding/child-funds shortfalls escalate once and retry the appropriate account. Mark handled alone moves no money.
- [ ] **D8 — Milestones:** Demo $20 + approved $5 savings reward reaches $25 and unlocks Bow tie. Home then says Flower crown at $50; Dress up keeps it locked until that milestone. Moving money before approval may change when the milestone occurs; earned milestones persist.

## Trips, postcards and simulated friends

- [ ] **F3 — Surprise trip:** At 18 points Home says Earn 12 more points; at 30+, double-submit sends one child/trip and spends 30 points, savings unchanged. Wooden On a trip sign replaces Maple; countdown reaches Any second now. Child state/action response omit destId while away; parent state includes it. Map has no walker/trail, target highlight or destination-purchase controls.
- [ ] **F3 / C16 — Reveal:** Leave a money/dress-up sheet open until return: only the full-screen reveal remains, focus trapped. Envelope body/flap/seams remain visible; card flips to picture with sparkles. Before each flip, no destination/story/postmark is readable. Afterward details appear; Add to album flies toward Album and closes without reopening the old sheet. New badges persist until that card is opened; seeded Chicago ×2 has no New badge on fresh storage.
- [ ] **F3 / M8 — Both secrets:** After three saves, a San Francisco return adds Hawaiʻi; after three first passes, a Zion return adds Arches. These need the relevant random draw (use a controlled fixture when available), not a user-selected pin. Bonus cards reveal in sequence, persist and cannot be traded. Do not expect a secret on every trip.
- [ ] **D10 — Cross-device receipt:** Add to album on A; after sync B does not replay. Inspect seen POST and revealedAt. Offline local acknowledgment retries on reconnect; failed seen POST retries without local replay.
- [ ] **D3 / M21 — Counts/trades:** Compare Album, Map and Parent Overview with duplicates and a traded card: trip places count once, all cards count, catalog total is 15. Traded Seattle does not unlock Olympic or count as a visit; three traded parks do not unlock Glacier. Practice swap needs parent approval when enabled; decline releases the reserved copy. Team progress is simulated on the friend's side and gives no completion reward.
- [ ] **F3 / C8 — Travel log:** Pan narrow map with touch/trackpad; no automatic scrolling. Space/Enter opens pins without page scroll. Visited pin shows story/stamp/visit count; future/locked pins give clues and secret clues stay hidden appropriately. No Send button, trip price or short-points copy in place sheets.

## Talk and Buddy

- [ ] **F6 — Talk/transcript:** Tap Maple or Talk to Maple: bar focuses above nav. Suggestions/text send one request; focus survives polls, Escape closes/restores opener. Bubble types short replies; screen reader announces one complete reply. See our chat opens a trapped sheet; Chat tab matches. Parent Buddy chats shows retained messages, tool names and redaction categories. Initial page is up to the full 200-message cap; a non-null chatNextBefore enables Load older with child/cursor queries, deduplicated rows, and stops at null. Pruned history is unavailable.
- [ ] **Buddy safety/offline helper:** With no Claude key, ask priced affordability questions below/above spending balance and Make me a saving plan: correct amounts and fresh Home plan, no money movement. No weekly saving amount produces useful copy, not null weeks. Supported PII formats are redacted; ordinary words like pink and secret places work. With mocked/live integration as available, guard BLOCK/error gives safe copy; do not call a mock pass live-provider verification.
- [ ] **F6 — Buddy off/away/offline:** Disable Buddy, including mid-reply: no bar/request or late reply. Away sign shows live countdown and sends no chat. Offline cached state says postcards are available, keeps bar closed and sends no chat. Thinking uses three-quarter pose, reply is happy, safety/fallback rests.

## PWA, navigation and accessibility

- [ ] **C1/2/3/11/14 / W2.1 — Install/cache:** Clear site data and visit production once. Registration starts without waiting for load; mq-v5 contains shell, hashed JS/CSS, manifest/icons and warmed available art. Block optional Google Fonts during installation: worker still activates; CSP allows both font hosts. API responses never enter Cache Storage. A 503 navigation/404 asset never replaces a good cached response; no body-used cache error.
- [ ] **W2.3/12 — Cold start/recovery:** No snapshot + unreachable API gives Loading/Retry, not Welcome. Cached parent summary offers Back to grown-ups via PIN, without restoring offline parent data. Automatic ten-second auth retry/online event recovers; Retry is immediate. A genuine 401 goes to Welcome with its discovery flag. Matching paired kid identity/state permits offline reload; parent or mismatched/missing snapshots do not grant offline parent access. Explicit logout then offline reload never restores the child.
- [ ] **C1 — Offline reading:** Pair/cache/warm, disconnect and reload. Album opens a collected card never opened online; cached Home shows Offline and mutations send zero POSTs. Reconnect replaces snapshot and enables actions. A delayed old-child response after selection/logout cannot repopulate it. Offline Add to album saves only the local receipt until reconnect.
- [ ] **D1 — Updates:** First install shows no update toast. On an already controlled page, a worker update shows persistent Updated! Tap to reload; Reload and Dismiss work and do not cover app bars.
- [ ] **C12/16 — Focus/navigation:** Type in amount/memo through two polls and an SSE refresh: focus/keyboard stay. Invalid stored tab opens Home. PIN URL keeps role=parent and rechecks cookie, local Kid/Lock mode and unlock deadline on reload. Connection errors use friendly retry copy with no hardcoded port.
- [ ] **C8 — Keyboard:** Sheets trap Tab/Shift+Tab, Escape/Close restore opener; map pins and flip cards support Space/Enter without scroll. How much? label focuses the input and contains no div. Skip link reaches main content.
- [ ] **D6/12 / W2.11 — Layout/locale:** At 390×844 check every parent section (including long device names, notes and tables), kid section and reveal; only map/nav containers may scroll horizontally. At 320px with keyboard open, talk controls remain usable. Long/unbroken bubbles, away/offline/off messages stay inside viewport. Latest toast replaces prior toast, sits below app bar; secret badge stays above card title, and points appear once in map header. Non-English browser locale still renders dates/currency/postmarks in en-US.
- [ ] **F3/F6 — Reduced motion/art:** Reduced-motion preference removes sign/envelope/card/sparkle/typewriter animation while preserving immediate picture/details and Add to album. Equipped hats/neck/held/outfit items align at phone/desktop sizes; three-quarter pose retains supported accessories and hides unsupported art cleanly.

## W2c funding record

Automated socket-free coverage: `node --test server/*.test.js` and `node --test client/*.test.mjs`. Browser checks remain pending.

- [ ] Register a real family, set a positive allowance and open Overview with zero funding: the Add money nudge names the bear. Its button opens Allowance and focuses Amount. A funding escalation's Add money button opens the same form.
- [ ] Enter $25.50 and an optional note; Add money sends one `parent/funding/add` request for the selected child. Inputs/button disable while pending. A failed request preserves the draft; success clears it and refreshes funding, Transactions and Guardian log. No money moves outside the ledger. The child sees no funding note/notification; a due allowance may generate its normal payout notification.
- [ ] Check $1/$1,000 boundaries, cent precision, required amount and 120-character note. Funding copy explains that MoneyQuest never moves real money. After funding is positive, the Overview nudge disappears. With allowance zero it is absent.
- [ ] With a PIN, lock parent mode: direct funding requests fail until unlock. A paired kid gets 403. Real families retain Add money but have no Add $50 or Fast-forward; demo keeps both one-tap controls alongside the form.


## W3 polish

Socket-free regressions cover named-bear rendering, bubble structure/CSS, lockout notices, readable audit copy, session cleanup, decimal inputs and demo documentation. The browser checks below remain pending.

- [ ] **W3.1 — Bear names:** Use a real child whose bear is Bo. Check Home, Album/card stories, Chat, Ask for extra, Buddy task ideas and a traded place's visit note. Disconnect after caching: both the offline notice and blocked actions name Bo. Return from a trip and trigger the offline helper; newly generated copy uses Bo.
- [ ] **W3.2 — Tall bubbles:** At 390px, show a 12-line reply and a very long/unbroken reply with reduced motion both on and off. Every visible line stays inside the rounded border; long text scrolls inside it while the outline and tail stay fixed. Short replies still fit naturally.
- [ ] **W3.3 — Lockout:** Fail the parent PIN five times. The inline lockout deadline and disabled Unlock button remain visible without a second toast covering the sheet controls. Other rate-limited actions still show their normal notices.
- [ ] **W3.4 — Goal/audit copy:** Request too many lessons before any passes, after some passes and after all passes. The messages say pick up to five, the remaining count, and choose tasks respectively. In Guardian → Show all activity, change time zone/Buddy and allowance: readable sentences and $10.00/wk appear, including older stored settings entries.
- [ ] **W3.5 — Session cleanup:** Visit Album and open cards, then unlink that kid device or Sign out everywhere. After its next authenticated 401, navigation, reveal/album receipts and legacy mute keys are removed alongside identity/state. Re-link: Home opens. An ordinary reload of the same valid session retains navigation; failed global sign-out retains it too.
- [ ] **W3.6 — Amount keyboard:** On a phone, check Add money, Allowance, purchase limit, goal reward, savings target, Save/Spent: each amount input offers the decimal keyboard.
- [ ] **W3.7/8 — Demo/docs:** On a fresh demo follow the README's payday step before Post a duplicate. Accounts explains Add money; Known limitations links the Apple Cash Shortcut guide and explains tracking boundaries.


## G1 savings goals

Socket-free regression coverage: server/goals.test.js and client/g1.test.mjs. Browser checks remain pending.

- [ ] Home Switch goal opens My goals; create with each picture, edit, switch and put away. Verify 40-character and $1/$1,000 boundaries and decimal keyboard. Polls preserve edits; server edits refresh the affected form.
- [ ] Reach the current target: one celebration, “You did it! Ask your grown-up to buy it”, one waiting request after repeated taps. Approve in parent Inbox: savings decreases once, history says bought, next live goal becomes current. With no live goals Home offers My goals to pick/create the next.
- [ ] Decline: reached goal and warm note remain, request again works. Drop savings before approval: no debit, “savings are short now”, restore savings to retry or decline the unpaid approval.
- [ ] Parent Goals & tasks: add/edit/current/archive/delete controls, bought/current delete disabled. Lock the PIN and try every parent route. A paired kid cannot delete. Switch siblings and verify independent goals.
- [ ] Buddy snapshot/plan and parent Overview follow the current goal. All four statuses appear in My goals, archived/bought history stays, permanent milestones survive purchases. Use a child and bear with custom names; check 390px layout, keyboard focus and offline disabled mutations.
## G3 real friends (browser checks pending)

Socket-free coverage: `server/friends.test.js` and `client/g3.test.mjs`. The checks
below require two real families in separate browser profiles and a paired kid
device; automated rendering tests do not establish actual browser behavior.

- [ ] Children shows eight-character Friend code separately from the expiring six-character Kid code. Replace an unselected sibling's friend code: only their code changes, the old code sends no new request, and device pairing remains separate.
- [ ] A sends B's code: only “Request sent” and an anonymous pending request appear. A's parent approves; B's parent sees the first name/family label, while B's kid sees only the first name. Accept as kid then parent, and repeat with parent then kid. Both children become friends only after every yes. Repeat with each participant declining: both sides see only “didn't go through”.
- [ ] Friends shows current bear cosmetics and postcard counts, with no balances or family labels. Real families have no Maya/Sam/Zoe/Leo practice friends and no Team challenge or team-setting switch. Demo retains practice friends and simulated team progress.
- [ ] Propose a swap: both physical copies become unavailable for another swap; B sees their own give/get orientation. Accept as B's kid, then approve each required parent in either order. With neither family's approval switch enabled, kid acceptance completes it. Both albums, notices, and audit logs update. Secret postcards never appear as trade choices.
- [ ] Decline as kid or parent, expire after seven days, and unfriend during a pending swap: both locks release and parent reminders close. With both family pages open, changes arrive through SSE without a manual reload. A failed request preserves form input.
- [ ] Send preset greetings in both directions; the 21st shared message within 24 hours is refused kindly. Unfriend from either Children or Friends & privacy: both views remove the friendship, swaps cancel, and greeting/trade attempts fail. Kid devices cannot perform code replacement, unfriend, or parent approval actions.
- [ ] At 390×844 and with keyboard only, check request/swap decisions, eight-character codes, parent Children cards, focus, disabled controls during network delay, and the empty Friends state.
## G5 profiles

Socket-free regression coverage: `server/profile.test.js` and `client/profile.test.mjs`. Browser checks below remain pending; no listening server was started in this batch.

- [ ] At 320px/390px and desktop sizes, Home's bear/name chip is at least 44px tall and opens the full-height profile sheet. Chat's Me button opens the same sheet. Tab/Shift+Tab stay inside; Escape, Close and the backdrop restore the opener.
- [ ] Check the equipped bear portrait, name/age, saving month, points, trip places/all catalog places and physical postcard counts, trips, lessons, missions and newest-first badges. A missing streak is omitted. Without a string `state.friendCode`, omit the Friend code row; with G3 state, Copy works. Add a friend opens the existing Friends UI, Dress up opens the closet, and paired kid sessions have no Grown-ups shortcut.
- [ ] Rename the bear: 24-character names work; blank, emoji-only and 25-character names fail. Cancel preserves the name. Success updates other screens/devices and notifies the parent; no PIN is needed.
- [ ] Parent → Account sits between Children and Security. Save parent/family names, change email with a password, and change password. Wrong-password errors preserve the signed-in session and draft. A duplicate email fails. Password success signs out other parent sessions for that user and keeps this session plus paired kid devices.
- [ ] Children → Edit profile supports Save/Cancel for each card. Update a sibling while another child is selected; summaries, account labels and kid notifications use the new names. Locking parent mode blocks all account/profile changes until unlocked; paired kids cannot use these parent routes.
- [ ] Rename the demo child/bear, then reset the demo: seed names return. No friend-request copy changes are part of G5.

## G2 parent phone layout

Socket-free regression coverage: `client/parent-mobile.test.mjs` checks the five tabs and approval counts (including approved, unpaid goal purchases), every existing section ID, Add money → Money › Allowance, remembered Money/Kids segments, preserved mounted forms, More push/Back/Forward and rapid taps, desktop/missing-matchMedia fallback, live breakpoint changes, header child switching, record labels, keyboard hints, and CSS safe-area/touch/reduced-motion rules. Existing client/server suites remain required. No server changes or listening server are part of this batch.

Browser/device checks below remain **pending**. The Playwright connector required unavailable approval, and the local socket-free Chrome launch exited under the sandbox; DOM/CSS harness checks do not establish pixel fit, native safe areas or iOS keyboard behavior.

- [ ] At **390×844 and 360×780**, with one child and multiple children, check the small bear, selected child's account name, child selector and Kid mode/Sign out/Lock. Use 24-character names and Offline status. The selector must not collide with Lock; all actions remain reachable.
- [ ] At **820px** show exactly Inbox/Home/Money/Kids/More fixed at the bottom; at **821px** restore every desktop sidebar section and integration status. Rotate/resize with an open More detail and with Goals/Allowance drafts; the current section stays reachable and drafts survive tab changes. More list falls back to Approvals when widening to desktop.
- [ ] Inbox shows the same actionable count in its heading and tab, hides zero badges, stacks approvals and gives every action a full-width button. Add money from Inbox and Home opens Money › Allowance and focuses Amount without a keyboard/focus jump.
- [ ] Money segments switch Allowance / Goals & tasks / Transactions; leaving and returning or reloading remembers the last segment. Kids switches Children / Friends & privacy; check profile Save/Cancel, friend/kid codes, devices, Apple Cash setup/token/copy actions and Apple Cash activity.
- [ ] More lists Guardian log, Buddy chats, Account and Security, with integration status below. Open each row; on-screen Back and hardware/browser Back return to More. Forward restores the detail. Rapid Back/tab taps must not leave the app. Switch siblings, Lock, and enter kid mode while pushed: no stale detail reappears.
- [ ] At both phone sizes check every section with empty data and long names, transaction memos/notes, goal titles, chat messages, Guardian detail, time zones and Shortcut URLs/tokens. Tables become labeled card rows; audit/chat rows wrap. No page, card or form scrolls horizontally. Scroll the final control above the bottom bar and safe-area inset.
- [ ] Allowance, goals/tasks, funding, wallet transfers, child profiles and Account forms use one column, inputs at least 16px, decimal keyboards for money and numeric keyboards for counts/percent/PIN. Check PIN/forgot-password sheets with the keyboard open: controls remain inside the visible viewport and scroll into reach.
- [ ] On touch and keyboard, check at least 44px targets (checkbox labels provide the hit area), visible default actions, focus rings, section focus after More pushes/Back, no clipped focus, and disabled mutations offline/pending. Enable reduced motion: push-in animation disappears. Check Safari safe-area padding in standalone PWA mode as well as Android hardware Back.
- [ ] At desktop widths confirm unchanged sidebar, tables, multicolumn forms, header and Account behavior; no mobile tabs or segmented navigation appear.

## H4 kid UI polish

Socket-free regression coverage: `client/h4.test.mjs` and `server/h4.test.js`.
The checks below remain pending; no listening server or browser session was started.

- [ ] At 390×844, open Weekly budget with a configured allowance, then with $0/unset allowance. Confirm its default, edit to $1, $12.50 and $200, and check rescaled sliders. Invalid/mismatched totals and save/needs below 20%/25% cannot finish. Parent Overview shows the saved total and allocations; repeating in the same week earns no extra points.
- [ ] Close a speech bubble using × (44px target), tapping outside the scene, Escape and Close talk bar. It stays hidden through countdown/state refreshes; the next talk or reply can show another. Check text scrolling, keyboard focus and reduced motion with a long reply.
- [ ] During a trip, opening talk shows only the wooden countdown sign and “<bear> is on a trip! Back in m:ss”, with only the time changing. No Home bear or Zz appears, including when talk was open before departure. Watch several countdown ticks: no typewriter restart.
- [ ] Tap a locked point-priced cosmetic: see cost and current balance, cancel with Not now, then Buy. Only Buy spends points. A shortage disables Buy with “Earn N more points”; failures retain the confirmation. Milestone locks and owned-item equip still work.
- [ ] Parent Delete goal, Unfriend in Children and Friends & privacy, and Replace friend code each require a second inline action. Cancel sends no request; a failed confirmation remains open. Verify selected child scoping and offline/pending disabling.
- [ ] Decline a friend request as the receiving kid and parent. The requester parent gets the recipient-name notice and “didn't go through” decided status. The receiving kid sees “Request closed”. Sending valid/invalid codes shows the same persistent session receipt, including after leaving Friends.
- [ ] Pair a kid device and wait for Linked ✓. Leave Children and return: the receipt remains. Generate a new code: the receipt is replaced by the new code/countdown. Confirm family/child isolation.
- [ ] With no cards, with a trade-only card and with duplicate trip cards, check that stamps and the empty hint never coexist. Profile, Album, parent Overview and friend card agree on trip places, all places and physical cards.
- [ ] Archive/replace the current goal: Talk suggestions name only the current goal, or omit the goal prompt when none exists. Send greetings both ways and check Latest hello shows the newest received note, not your own outgoing reply. Rename child/bear and verify current names throughout.
## H1 — one funding pot

- [ ] At 360px and desktop widths, Overview has four figures (savings, spending, funding, adventure points). `$545.00` uses the body font, tabular numerals and stays within its card; long values wrap without overlap.
- [ ] Home under the greeting shows Savings, Spending and Apple Cash money (funding), with “set aside by your grown-up”. Each opens My money. The Apple Cash pill shows the latest purchase and today's total.
- [ ] Spent defaults to Apple Cash. Paid with switches sources and “You have” updates. Record is disabled with a reason if the amount exceeds that source. Spending money still shows the over-limit approval copy.
- [ ] A short-funded Shortcut purchase returns 409, leaves funding nonnegative, and makes one pending receipt/notification. Retry with the same external ID does not add a card or notice.
- [ ] Inbox pending receipt has Add money (focuses Allowance's existing funding input), Record now, and Dismiss. Record while still short shows the friendly error. Add funds then Record posts once; retrying Record or the original Shortcut does not debit again. Dismiss removes the card and audits it.
- [ ] Children links to the Shortcut setup guide and Apple Cash activity shows funding, weekly/monthly totals, purchase flags and receipts waiting for funding. No Send form remains. Recent and Transactions tag Apple Cash; legacy sends say “Sent via Apple Cash (before 0.7)”.
- [ ] Check on an actual iPhone that 200 finishes, 409 preserves receipt/ID for funding retry, and 429 respects Retry-After. Token scope, PIN gating, expiry and revocation still work.
## H2 daily missions
- Open Missions: Today shows up to three server-assigned missions with hints and rewards; Home's Next up matches the first one.
- Finish an active mission: it is checked and struck through briefly, then slides away; its replacement slides in with New! Polling must not restart or freeze this transition.
- Enable reduced motion: completion and replacement have no animation.
- Complete six missions: Today says “All done for today — amazing!”; This week and parent tasks remain usable.
- Visit a place on Map, read a postcard story, and check goals: use the confirmation button in each screen. Buttons disappear after completion and are disabled offline/busy.
- Price detective opens Cash diary; enter a note and two prices. One price or an invalid price cannot submit; both are stored with the diary entry.
- Finish a lesson: its card says “Review · no points”; reviewing adds no points. First-time lesson, track and save mission rewards are not doubled.
- Reopen after family-local midnight: missions roll once and persist across refresh/restart. Parent state and Buddy show the same current missions.

## H5 mystery map walker

Socket-free regression coverage: `client/h5.test.mjs` checks the fixed loop's
40px clearance from all 15 destination pin centres, real-time/reload progress,
travel direction, rendered SVG privacy (including a throwing away destination
getter), local/server reveal receipts, latest-trip ordering, child-scoped one-time
playback, home arrival, pin celebration, reduced-motion waypoints, visibility
pause/resume, auto-scroll behavior, legend names and empty travel history.
The older F3 no-walker assertion in `client/c1.test.mjs` now expects the mystery
walker and excludes the real trail. No server behavior changed.

Browser/device checks below remain pending; no listening server was started.

- [ ] At 360/390px and desktop widths, send the bear on a surprise trip. It follows the same closed mystery loop for every destination, with a small ? cloud, sparkle tail and correct facing. Destination pins remain normally labelled while away without indicating the target. Tap/keyboard pin exploration remains read-only.
- [ ] Reload halfway through a trip: the bear stays at the same real-time position. Let the timer reach zero before the server return arrives: the bear waits at Home. Drag/touch-scroll the map and confirm auto-scroll waits until the interaction has ended for two seconds.
- [ ] Complete Add to album, then open Map. The revealed trail marches while the bear walks from the destination to Home over about 2.5 seconds. The destination pulses “New postcard!” briefly, then only a faint dotted latest-trip trail remains. Polling, reopening Map and reloading never replay it; leaving halfway through consumes it too. Repeat with a new trip and a sibling.
- [ ] With an unseen returned postcard, no real trip trail appears before the reveal receipt. Try both a local offline receipt and a server-revealed return from another device. A newer unseen return must not show an older seen trip as the latest trail.
- [ ] Hide the browser tab during the walk: animations/tick stop and the remaining homeward time resumes on return. Leaving the Map section removes its clock; returning shows the faint trail. The one-time walk receipt is browser-local and scoped to the child.
- [ ] Enable reduced motion, including changing it while Map is open. The bear hops between fixed waypoints, with no bounce, marching trail or smooth auto-scroll. Check the ? cloud and pin callout fit inside the map at every waypoint.


## H6 phone notes

Socket-free coverage: `client/h6.test.mjs`, additions to `server/auth.test.js`,
and updated superseded assertions in `client/c1.test.mjs`, `client/h4.test.mjs`,
`client/w4.test.mjs` and `server/wallet.test.js`. Tests cover countdown identity,
return/refresh, both away-bear paths, note freshness/current goal, token status,
escaped public help, atomic multi-child registration and pairing layout order.
The 360/390px checks validate structure and CSS rules, not browser geometry.

Browser pixel verification remains **pending**: the browser URL policy rejected
navigation to the socket-free local HTML fixture (`file:` is blocked), and this
batch prohibits starting a listening server. No server or deployment was started.

- [ ] At 360×780 and 390×844, check Get a kid code is the first full-width primary action in each child card, with no internal card scrolling or clipping. Generate, Copy, expire, link, leave and return; the linked receipt persists. Friend code remains clearly separate below.
- [ ] Open talk before departure, send the bear away, and reload mid-trip. Home always has the wooden sign and no bear. Open the trip bubble: only the countdown changes. At zero, “Any second now…” lasts at most five seconds; a late state requests refresh, and a returned trip proceeds to the reveal without an old trip bubble.
- [ ] Change money and the current goal: Thinking appears while a replan is queued/running; the current goal is acknowledged in that same state refresh and Updated uses the configured time zone. Successful and failed replans both clear pending state.
- [ ] Each child's Apple Cash card has status/last ping, Generate or Rotate, Copy, Unlink and the help link. Rotation waits for a fresh ping. No instructions or JSON appear in the app; the help page has the correct HTTPS host and no private token. Test the actual iPhone Shortcut and compare a purchase with activity.
- [ ] Create a family with one, two and four children; remove a middle row and refill it. Confirm the first saver is selected and siblings stay independent. Parent → Kids → Children opens Add a child in one tap at the top; failed saves preserve the draft.
- [ ] Welcome describes where to get a kid code. Check long child/bear names, touch targets, keyboard focus, reduced motion and offline disabled actions on a phone.

## H7 goals, weekly replanning, friend receipts and Buddy questions

Socket-free coverage: `client/h7.test.mjs` and `server/h7.test.js` exercise both
restore routes, parent PIN/child/family isolation, read-only bought goals, restoring
through edits, current-goal selection, picture buttons, saved budget cents and
zero repeat points, both approval stages and requester notification copy, identical
initial valid/invalid code receipts, state-based suggestions, Claude retry timing,
fallback metadata and Ask-again actions. Superseded expectations were updated in
`client/c1.test.mjs`, `client/g1.test.mjs`, `client/g3.test.mjs`,
`client/h2.test.mjs` and `client/h4.test.mjs`. Guardian and money paths are unchanged.

Browser/device verification remains pending. No listening server was started.

- [ ] At 360/390px and desktop widths, bring back an archived goal with and without another live current goal. Edit an archived goal, save it, then switch goals. Bought goals remain memories. Check the seven picture buttons in both forms wrap cleanly, show their labels, have 44px targets and visible keyboard focus, and never submit when picking a picture.
- [ ] Finish the weekly budget, then open the checked item again. Verify “This week's plan”, the saved amount and four allocations, the free-change note and “Plan updated!” after saving. Points do not increase. Home Next up never suggests a completed budget. Start a new week and check allowance defaults.
- [ ] With two real families, send a friend code: the child sees the waiting status, and the requester parent gets the Approvals instruction and explanatory card. Approve it and verify the sender sees “Sent to your friend's family”. The recipient flow stays unchanged. After both families agree the friend card replaces the waiting status. Repeat with an invalid code and compare the initial receipt/status; it must look the same. Reopen Friends in the same browser session.
- [ ] Change the current goal and spending money; talk chips use that goal's name/target and a nearby price. With Claude configured, ask a chip question and inspect an answer using the child's numbers. Simulate one failure then success, then two failures: there is one 800ms retry, and the fallback has an “Ask <bear> again” button in the bubble and transcript. Use the button to resend the question. With no key, planner replies still work. Check off/offline/away states disable chatting.


## H8 wardrobe refresh (manual browser checks pending)

- [ ] At 360/390px and desktop widths, open Dress up with a custom bear name. Check all eight tabs (including Bags), all 26 thumbnail images, live preview, None, scene selection and milestone locks. Buy confirmation must still show cost, balance, Not now, disabled shortage and retry after failure.
- [ ] Try each hat, glasses, neckwear, outfit, bag and friend on the new front bear. Layers share the full 428×414 canvas without offsets, rotation or mirroring; friends float. Check the map, magnifying glass, leaf and mug each replace the base once, hide outfit/neck/bag, retain hat/glasses/friend, and show the named two-paw hint. Put the prop down: the same clothes return.
- [ ] Trigger happy/resting/eating moods with empty and occupied slots: map/sleep cap/mug only fill empty slots. Travel/reveal/thinking poses remain plain. Check reduced motion and name/preview layout.
- [ ] Open an existing child save: retired IDs vanish, the three defaults are owned, bags exist, earned milestone items return, points and money stay unchanged, and exactly one wardrobe audit line survives reload/restart. Practice friends use the new IDs; a fresh real child still starts with zero points and money.
- [ ] Upgrade an installed production PWA from the old wardrobe, wait for worker activation and art warming, then reload offline. The new front bear, layers, thumbnails and icons must all use the refreshed art with no retired-image requests.

## H9 fourth-round notes

- [ ] Paired kid: Me → This device → Sign out. Stay here cancels; Confirm sign out requires a successful cookie logout, clears per-child keys and shows Welcome with the new-code hint. Failed/offline logout keeps the device linked. Parent-session Kid mode still uses Grown-ups, with no kid sign-out section.
- [ ] Missions shows up to five unpassed Next lessons, ordered by the server. Complete one: after closing the result sheet it slides out and its replacement says New! Reduced motion removes animation. Finished is collapsed and reviews earn no points; passing all fifteen shows the completion message. Overview and Buddy use the fifteen-lesson total.
- [ ] Valid friend code: both parents get Inbox and bell notices immediately, receiving kid gets an anonymous bell and Friends card. Before sender-parent approval, inspect all receiving-side state and notifications: no sender name/family label. Approve in each order, including recipient parent first and anonymous kid consent first; friendship requires both parents and the receiving kid. Sender-parent approval reveals name/label. Declining closes both sides; invalid code creates no recipient notices or records.
- [ ] Chat and talk bar have text input only, with no microphone, speaker, mute or read-aloud controls. Parent Integrations lists Buddy and Bank.
- [ ] Verify bold, italic, paragraphs/breaks, short lists and inline code in child chat, bubble and parent log. HTML and URL text never run/open. Unclosed/nested markers stay readable; long replies wrap and bubble scrolls; typewriter and reduced motion still work.

Socket-free coverage: `client/h9.test.mjs` and `server/h9.test.js`. These checks do not establish real-device/browser visual acceptance; record actual browser and date when checking the items above.

## H11 app help and Buddy knowledge

Socket-free coverage: `server/h11.test.js` and `client/h11.test.mjs`.

- [ ] At 360/390px and desktop widths, open Ask about MoneyQuest from More or the sidebar. Ask about kid codes and Apple Cash; check loading, errors/retry, keyboard focus, wrapped Markdown steps, and Help links. Navigate away or switch children during a pending answer; the old answer must not appear in the new panel. Device-offline disables asking; no-key server mode still returns guide text.
- [ ] Open Help from Welcome and parent More. Parent guide appears first, kid guide second, with readable numbered steps and a working Apple Cash setup link. No credentials or family data appear in the public page.
- [ ] Tap the How do I…? chip in the kid talk bar. Finish a question about friends or goals and check exact UI steps and the custom bear name. With Claude configured, inspect lookup_help's kid-only results and personalised wardrobe, postcards, budget, pending Apple Cash and current-goal facts. No model/provider live verification is implied by stubbed tests.
