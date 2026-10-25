# Changelog

All notable changes to MoneyQuest are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Each entry names the review trail:
every batch was implemented by Codex, reviewed by Gemini, and verified and
merged by Claude (see `docs/VERSIONING.md`).

## [Unreleased]

### In progress (branches)
- (none)

## [0.8.7] — 2026-10-25

### Fixed
- The "Tap to talk" pill on the bear's home is a real button now: tapping it
  opens the talk bar, the same as tapping the bear. It steps aside while
  the bar is open or the bear is away. The owner's report: the pill did
  nothing.

### Review trail
- Fixed directly on `fix/tap-hint`, Gemini review, checked in the built
  app at phone width. 371 server tests and 228 client tests.

## [0.8.6] — 2026-10-25

### Fixed
- Talking to the bear no longer throws the page around on a phone. The
  talk bar used to be a panel pinned above the tab bar that grabbed the
  cursor the moment it opened; on an iPhone the keyboard popped at once and
  Safari scrolled the whole page to the bottom, tab bar and all. The bar
  now sits in the page right under the bear scene, phones get no automatic
  cursor (tap the box when you want to type), the bar scrolls itself into
  view gently, and tapping a suggestion sends it without opening the
  keyboard. Laptops still get the cursor straight away. Taps inside the bar
  no longer close the bear's speech bubble.

### Review trail
- Fixed directly on `fix/talk-bar-inline`, Gemini review, checked in the
  built app at phone and desktop widths; iPhone keyboard behaviour listed
  in `client/CHECKLIST.md` for a hands-on check. 371 server tests and 227
  client tests.

## [0.8.5] — 2026-10-25

### Fixed
- Dress up: tapping a locked item now lights its card (solid border, honey
  background, caption "Buy this?") while the "Spend N points…" box is open,
  so a child can see which item the box is about. "Not now" dims it again
  and tapping the lit card a second time cancels. The owner's report:
  locked clothes did not light up when selected.

### Review trail
- Fixed directly on `fix/pending-swatch`, Gemini review, tried at phone
  width in the built app. 371 server tests and 222 client tests.

## [0.8.4] — 2026-10-25

### Added
- The bear knows the child's world: its snapshot now carries the wardrobe
  (what is worn, what is owned, the whole shop with prices and what the
  child can afford right now, the next unlock), postcards and whether the
  bear is away, friends by first name with pending requests and swaps,
  lessons finished and the next topics, the weekly budget, Apple Cash
  receipts waiting for a parent, and the current goal. Answers like "Can I
  buy the explorer jacket?" use real numbers; nothing private (codes,
  emails, family labels, the surprise destination) ever reaches the model.
- A help knowledge base in the app's own words (`docs/help/kid.md` and
  `docs/help/parent.md`, every button name checked against the screens by
  a test). The kid guide rides inside the bear's prompt, so asking the bear
  "How do I add a friend?" or "How do I sign out?" gets the exact steps; a
  `lookup_help` tool double-checks. Parents get an "Ask about MoneyQuest"
  panel under More (20 questions an hour per family, nothing stored) and a
  public `/help` page linked from Welcome and More. A "How do I…?" chip in
  the talk bar.

### Changed
- The wardrobe layers were re-cut per region (hats, eyes, neck, outfits,
  held props, friends) and re-registered against the base bear: halos,
  doubled edges and stray fragments are gone. The art moved from
  `/bear/w2` to `/bear/w3` and the service worker cache became `mq-v8`, so
  an installed app can never mix old and new pieces; it reloads itself.
- The kid-safety guard now lets plain app instructions through (friend
  codes, trips, goals, missions, lessons, dressing the bear, signing out)
  instead of replacing them with the fallback line.

### Review trail
- H11 (Buddy knowledge + help): Codex implemented, Gemini APPROVE (plus a
  delta review of the guard/shop follow-up), live check with the real key.
- Wardrobe re-cut: Sonnet per-region QA workflow, Gemini review of the
  path move, browser check against a stale `mq-v7` cache before release.
- 371 server tests and 222 client tests.

## [0.8.3] — 2026-10-25

### Added
- Thirty money lessons with six questions each (the first fifteen gained
  questions). Each try shows four questions that rotate per child and per
  attempt, so a review never repeats the same set; three of four passes.
  Fifteen new topics: coins and bills, making change, planning an allowance,
  needs by season, the whole price with shipping, subscriptions, choosing one
  thing, a gift together, meeting your bank, savings that grow, a party on a
  plan, toys finding a new home, choosing a cause, built to last, rainy-day
  savings. 360 server tests and 217 client tests.

## [0.8.2] — 2026-10-25

### Added
- Kids can sign out from their Me page (a new kid code brings them back).
- Ten more money lessons (fifteen in all): the Missions tab shows five at a
  time, finishing one brings the next, and finished lessons wait in a review
  list without points.
- Friend requests show up on both sides right away: the other family's parent
  gets an anonymous card and the kid a bell notice while the grown-ups check;
  names appear once the sender's parent approves; approvals can happen in any
  order.
- Chat renders bold, lists and line breaks safely.

### Removed
- Voice: the microphone, read-aloud and the Cartesia integration are gone;
  Buddy is text only. 352 server tests and 211 client tests.

## [0.8.1] — 2026-10-25

### Fixed
- Phones that still had the old wardrobe in their offline cache showed the old
  bear under the new clothes. The new art now lives under its own path
  (`/bear/w2/…`), so an old cache can never serve it, and a new build reloads
  the app by itself unless the kid is typing.

## [0.8.0] — 2026-10-25

### Changed
- A brand-new wardrobe. Twenty-six pieces (six hats, two pairs of glasses,
  four neckwear, six outfits, a camera and a purse, four things to hold, two
  little friends) are cut from one illustration so every piece shares the
  bear's canvas and lines up exactly, however many are worn at once. Things
  held with both paws (map, magnifying glass, leaf, mug) swap in the whole
  bear and set outfits aside until put down. The old pieces are retired and
  every child's wardrobe starts fresh; milestone rewards come back
  automatically for milestones already reached. 339 server tests and
  205 client tests.

## [0.7.2] — 2026-10-25

### Added
- Put-away savings goals can be brought back or edited; goal pictures are
  picked from icons instead of a dropdown.
- The weekly budget can be opened again in the same week to change the plan
  (no extra points).
- Friend requests show where they are ("Waiting for your grown-up to say
  yes", then "Sent to your friend's family"), the toast explains that a
  grown-up must approve first, and the requester's parent is told that
  approving sends the request.
- Buddy's suggested questions come from the child's real goal and balance,
  always go to the AI (one retry before any fallback), and a fallback reply
  offers "Ask again". 333 server tests and 198 client tests.

## [0.7.1] — 2026-10-25

### Added
- The bear walks the map again. During a surprise trip it roams a fixed
  mystery loop with a "?" cloud and sparkles (every pin stays labelled and
  the picture is the same whatever the destination, so nothing is given
  away). After the postcard reveal the map draws the real trail once, walks
  the bear home, calls out "New postcard!" and keeps a faint line for the
  latest trip. 326 server tests and 191 client tests.

## [0.7.0] — 2026-10-25

One pot of real money, missions that keep coming, and the polish from the
owner's two rounds of phone testing. 326 server tests and 183 client tests;
browser smoke of the new flows at 390×844 and 1280×900.

### Changed
- Apple Cash is no longer a separate account. The parent's funding account is
  the real money set aside for the child: the weekly allowance is paid from it
  and every Apple Cash purchase (iPhone Shortcut or "Paid with: Apple Cash")
  is deducted from it. Nothing can go negative: a purchase that funding cannot
  cover is refused (the Shortcut gets 409 `funding_short`) and kept as a
  pending receipt the parent records after Add money or dismisses. "Send via
  Apple Cash" is gone; old tracked balances migrate into funding with an audit
  line. Parent Overview shows four figures; the kid Home shows Savings ·
  Spending · Apple Cash money; the spend sheet asks "Paid with".
- Missions roll: three a day from a pool of eleven, a new one appears the
  moment one is finished (six rewards a day at most); finished lessons read
  "Review · no points".
- The weekly budget plans the weekly allowance by default and the amount is
  editable; the parent sees the plan.

### Added
- Sign-up takes up to four children at once; each child card starts with
  "Sign in on your child's device → Get a kid code", with the friend code
  clearly separated; the Welcome screen says where kid codes come from.
- The iPhone Shortcut instructions moved off the parent app onto a help page
  (`/help/apple-cash`); the parent card keeps only the token controls.
- Buddy's note shows when it was last updated and a pending state while a new
  tip is being written.
- Speech bubble can be closed (×, tap outside, Esc); buying clothes with
  points asks first; parents confirm goal deletion, unfriending and friend-code
  replacement; the requesting parent hears when the other family declines.

### Fixed
- Talking to the bear during a trip shows a countdown that ticks in place, never
  re-types, and lets go at 0:00; the bear is never drawn while away;
  "Linked ✓" survives leaving the Children section; album stamp strip and
  postcard counts are consistent; talk suggestions follow the current goal;
  received greetings show on the friend card; the closet confirmation is
  visible above the grid on a phone.

## [0.6.0] — 2026-10-25

Goals the family can manage, real friends, profiles, and a parent app that
works on a phone. 296 server tests and 150 client tests; browser smoke of the
new flows at 390×844 and 1280×900.

### Added
- Savings goals: several goals per child with one current goal; kids and
  parents create, edit, switch and put goals away, parents can delete
  (never the current or a bought goal). Reaching the target celebrates once
  and lets the kid ask to buy it; the parent approves from the Inbox and the
  Guardian pays savings → merchant exactly once, marks the goal bought and
  prompts for the next one. Declines and short savings leave money untouched.
  Hand-drawn goal pictures; Buddy plans against the current goal.
- Real friends: every child has a stable 8-character friend code (parents
  can replace it); a request needs both kids and both parents, shows no name
  until accepted, and declines are silent. Friends see each other's bear and
  postcards only. Postcard swaps run as one SQLite transaction across both
  albums with cards locked while pending and a 7-day expiry; prewritten
  greetings are limited to 20 a day per friendship. Practice friends and
  team challenges stay in the demo family.
- Profiles: a kid "Me" sheet (bear portrait and rename, about me, friend
  code, lifetime numbers, badges, Dress up / Add a friend shortcuts) and a
  parent Account section (name, sign-in email, password change that signs
  out other parent devices, family display name used in friend requests).
  Parents edit each child's name, age and bear name.
- Parent app on a phone: bottom tabs (Inbox, Home, Money, Kids, More),
  stacked cards instead of tables, 44px targets and safe-area padding below
  820px; the desktop sidebar is unchanged.

### Changed
- The demo family starts (and resets) with 500 points so trips and swaps can
  be tried right away; new real children still start at zero.
- Nessie mirror follows the sandbox's current schema (completed whole-dollar
  records, transfer plus deposit for internal moves) and is verified live.

### Fixed
- Apple Cash card refreshes after a Shortcut is unlinked; the speech bubble
  never covers the bear's face; a used kid code shows "Linked ✓"; the Buddy
  switch label follows its state; Create goal explains the lesson limit.

## [0.5.0] — 2026-10-25

Apple Cash tracking and the post-0.4.0 polish. 241 server tests and
110 client tests.

### Added
- Apple Cash tracking: each child has an Apple Cash wallet account; parents
  record money they sent over Apple Cash (an inflow from the parent that
  never touches the funding record); the child's iPhone can post every
  Wallet transaction through a Shortcuts "Transaction" automation using a
  long-lived, PIN-gated, rotatable token that appears in the Devices list
  and can be unlinked. Spends are idempotent on `external_id`, flagged when
  the wallet is short, covered by the Guardian's unusual-spend notice and
  over-limit alert, and rate-limited. The kid Home shows an Apple Cash
  pill, ledgers tag wallet entries, the spend sheet has "Paid with Apple
  Cash", and `docs/apple-cash-shortcut.md` walks through the Shortcut.

### Fixed
- Kid copy uses the child's bear name everywhere (it said "Maple" for every
  family); tall speech bubbles keep their outline around the text; no extra
  toast on PIN lockout; clearer lesson-goal and Guardian activity copy;
  per-child browser keys clear when a kid session ends; money inputs use
  the decimal keypad; the README demo starts with Fast-forward.

## [0.4.0] — 2026-10-25

Real accounts. 220 server tests and 96 client tests; account flows,
trips, talk and the parent app verified in a real browser (12 of 12 final
checks).

### Added
- Families: parents create a family with email and password (scrypt),
  sessions are HttpOnly cookies (30 days sliding for parents, 180 days for
  kid devices), kid devices link with a single-use 6-character code, a
  parent-mode PIN (optional, hashed, 5 failures lock for 15 minutes, reset
  with the password), multiple children with a switcher, a devices list
  with unlink per child, "Sign out everywhere" (parents and kid devices),
  Lock that also clears the server unlock.
- Storage moves to `node:sqlite` (one document per child, 0600 file); a
  legacy `data/db.json` is imported once as the demo family.
- Per-family live updates, a tick that only visits children with due work,
  rate limits on login/link/unlock/chat/speech/voice, retention caps,
  security headers and a CSP, HTTPS-only Nessie, demo mode behind
  `MQ_DEMO=1` with a demo parent and a "Try the demo family" button.
- Parent chat view pages through the retained transcript.
- Parents record money set aside for the allowance ("Add money"); the
  demo top-up stays demo-only.
- README, API.md and the browser checklist describe the product as it is.

### Changed
- The legacy PIN-only parent login and the `x-parent-token` header are gone;
  the client uses cookies and sends `?child=` for the selected child.
- Demo controls (fast-forward, post a duplicate, add $50, reset) exist only
  for the demo family.

### Fixed
- Service worker precache no longer fails under the CSP; a cold start while
  offline shows a retry screen instead of the Welcome page; kid sessions
  have no sign-out control; PIN attempts count failures only and show
  tries left; the parent app fits a phone.

## [0.3.2] — 2026-10-24

### Fixed
- Hats sit on the crown, scarves and the camera on the neck, outfits at the
  collar, held items in the paw; accessories now also appear in the
  three-quarter, side and back poses (walking away, return reveal) instead
  of vanishing. Items whose art cannot work in a pose are hidden there.

## [0.3.1] — 2026-10-24

Parent and kid views agree; fixes from the wave-1 browser smoke run.
170 server tests and 52 client tests.

### Added
- Parents can cancel an active goal; lesson goals cannot exceed the lessons
  left to pass. Parents are notified when allowance is paid and when an
  escalation is resolved. Reveal receipts are stored on the server so a
  postcard reveal is shown once per child, not once per device.

### Fixed
- No false "Updated! Tap to reload" on first install; the toast is
  dismissible and never covers the app bar.
- Allowance cannot be paid twice within a cadence after a time-zone change.
- Album, Map and Parent Overview show the same postcard counts; decided
  approvals clear their reminders; duplicate notifications collapse.
- Guardian log lines read as sentences (ids stay in audit data); dates and
  money format as en-US regardless of the browser locale; reversed ledger
  rows say "reversed"; milestone copy no longer claims unlocked items;
  parent forms keep unrelated drafts; layout fixes at 390 px.
- The offline helper saves a plan card after an affordability question.

## [0.3.0] — 2026-10-24

Surprise trips and talking to the bear. 159 server tests and 40 client
tests; verified in a real browser at 390 px.

### Added
- The child sends Maple on a trip for a flat 30 points; the destination is
  drawn on the server from open places (uncollected first, common 3 : rare
  1) and hidden until the postcard reveal. While away, a swaying wooden sign
  with a live countdown replaces the bear; on return an envelope opens, the
  card flips, a secret bonus shows as a surprise and "Add to album" flies the
  card to the Album tab, which badges it New until opened. The map is a
  read-only travel log with clues shown in the place sheet.
- Tapping the bear opens a talk bar (text, suggestion chips, press-and-hold
  mic where available); replies appear in a hand-drawn speech bubble with
  moods (thinking, happy, resting), are read aloud with a persistent mute,
  and the Chat tab keeps the transcript. Away, Buddy-off and offline states
  speak through the bubble.

### Fixed
- Speech bubbles no longer widen the page on phones; the reveal does not
  spoil the place name before the flip; a/an before place names; the
  offline helper points to the trip button.

## [0.2.0] — 2026-10-24

First hardening wave after the eight-way review. 148 server tests and
18 client tests.

### Fixed
- Route-layer validation of every API body; prototype keys rejected; points
  can never become NaN; top-up and journal input holes closed (B1).
- Ledger Guardian: already-paid periods skipped instead of logged as paid,
  bounded catch-up, child-funds escalations that retry, declinable approved
  items, amount-aware reconciliation, one escalation per finding, zero-dollar
  goals, `mutate()` rollback (B3).
- Arches reachable; declined trades and friends no longer lock state; traded
  postcards do not unlock places; lesson replays give no points; seeded
  friend request actionable (B2).
- Money Buddy: redaction no longer eats "pink"; phone/SSN/address formats
  covered; every string reaching the model is redacted; safety replies only
  on real safety phrases; thousands separators parsed; replan race fixed;
  child-safety background and a Haiku output guard (B4, B4b).
- Web client: in-flight locks on every action, stable sheet focus, parent
  lock and PIN gate, offline read-only mode with a precached shell, form
  resync, empty-goal guards, accessibility fixes (C1).
- Day and week keys follow the family's time zone (B6).

### Changed
- `npm test` runs `server/*.test.js`; Node ≥ 22.9 declared.
- Weeks run Monday–Sunday.

## [0.1.0] — 2026-10-24

Baseline: the Cal Hacks demo as reviewed. 11 rule tests.

[Unreleased]: https://github.com/DevEngers27/moneyquest/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/DevEngers27/moneyquest/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/DevEngers27/moneyquest/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/DevEngers27/moneyquest/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/DevEngers27/moneyquest/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/DevEngers27/moneyquest/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/DevEngers27/moneyquest/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DevEngers27/moneyquest/releases/tag/v0.1.0
