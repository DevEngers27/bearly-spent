# MoneyQuest

Save money. Grow Maple. Explore the world.

MoneyQuest is a money-learning game for kids aged 7–12 and their parents, built for Cal Hacks. Kids learn, save simulated dollars, grow their bear **Maple**, and spend game points on surprise trips to collect **15 illustrated postcards** from U.S. cities and national parks. Parents manage each child's allowance, goals and approvals; the **Ledger Guardian** handles scheduled payouts and ledger checks, while **Money Buddy** uses Claude with a kid-safety guard to explain money choices through Maple.

This README describes the **v0.4.0 release candidate**. See the [changelog](CHANGELOG.md), [API contract](server/API.md), and [original hackathon spec](#product-spec).

## Run it

Requires **Node ≥22.9** and npm. From the repository root:

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. Vite serves the client on port 5173 and proxies API calls to Express on port 8787. Neither launch script enables demo mode automatically.

For the seeded family, copy the optional environment template before launching:

```bash
cp .env.example .env
```

The template sets `MQ_DEMO=1`. Welcome then shows **Try the demo family**, or you can sign in as **demo@moneyquest.test / demo-pass-1234**. The demo has Mia and Maple, $20 savings, $10 spending, $250 funding, 500 points and two Chicago postcards. There is **no default parent PIN**. Disable `MQ_DEMO` for a deployment without demo login and demo controls.

API keys are optional: without them, the server uses the simulated bank, a rule-based Buddy and browser speech. This still needs a running local API; it does not make chat work without a network connection. Set optional Claude, Nessie and Cartesia keys in `.env`; see [.env.example](.env.example). `ADVENTURE_SECONDS` defaults to **60**.

For a production build and a single app origin:

```bash
npm run build
npm start
```

Open **http://localhost:8787**. Production cookies require HTTPS when `NODE_ENV=production`. For phone testing, the **phone** npm script builds the app, starts it and opens a **cloudflared** HTTPS tunnel; it needs internet access. Install the PWA with Add to Home Screen or Install app from HTTPS or localhost.

Storage is **data/moneyquest.sqlite**, configurable with `MQ_DATA_DIR`. The first startup imports a legacy `data/db.json` once into the demo family and renames it `db.json.imported`; malformed input stops startup and stays untouched. Enable demo mode to access imported progress. On POSIX, SQLite and its sidecars are restricted to the owner's read/write access.

To reset the seeded demo child from the command line, **stop the running API first**, then run:

```bash
npm run reset
```

The command enables demo mode for that invocation and resets the demo child only; other families remain stored. Restart afterward so the API reloads the document. While the API is running, use **Parent → Friends & privacy → Reset demo** instead; that route also cancels queued Buddy replans.

## Accounts and family devices

Choose **Create family** on Welcome. Enter the parent's name, email, password (at least eight characters), first child's name and age, and bear name. The browser supplies its time zone. New children start with zero balances, zero points, a starter wardrobe and an example bicycle savings goal; the seeded demo is separate.

- **Link a kid device:** Parent → Children → Generate kid code. In a separate browser profile or on the child's device, choose **I have a kid code** and enter the six-character code. It works once, expires in 15 minutes, and a new code cancels earlier unused codes for that child. The paired device sees only its child and has no parent entry or Sign out control; parents can unlink it in Children → Devices.
- **Use a shared device:** Parent → Security sets an optional 4–8 digit PIN. Kid mode and Lock clear this session's server unlock. Returning through Grown-ups requires the PIN; an unlock lasts 15 minutes. Five failed attempts lock that session for 15 minutes. Forgot PIN? verifies the parent's password and clears the family PIN. A PIN cannot turn a paired kid session into a parent session.
- **Add siblings:** Children → Add child, then use the header switcher. Each child has their own funding, savings and spending accounts, allowance rules, goals, approvals, Buddy settings/history, game progress and postcards. The family identity, parent PIN and parent access are shared; funding is **per child**, not pooled. Time-zone game settings are also stored per child, despite the current “Family time zone” label.
- **Add money:** Parent → Allowance → Add money records funding for the selected child so allowance and approved rewards can be paid in the ledger; it does not move real money.
- **End access:** Sign out ends the current parent session. Security → **Sign out everywhere** asks for confirmation, then revokes every parent and kid session in the family, including the current device. Kid devices need new codes afterward. Other families stay signed in.

Passwords and PINs are salted **scrypt** hashes. Sessions use **HttpOnly, SameSite=Lax** cookies (`Secure` in production/HTTPS); only token hashes are stored server-side. Parent sessions slide for 30 days, with a 90-day maximum; paired kid sessions last 180 days. Login, registration, pairing, PIN attempts, Buddy and voice have rate limits. Per-child retention caps are **200 chat messages, 500 diary entries, 2,000 audit entries, 5,000 transactions and 200 notifications per recipient**. Cached child state is stored on the device for offline reading, so use a trusted device and clear site data when retiring it.

## Two-minute demo

Start with a fresh demo child; the full five-lesson walkthrough may take longer than two minutes.

1. **Parent → Goals & tasks:** Create a $5 reward goal counting all five remaining money lessons **before** doing lessons. Only first passes after goal creation count. The count cannot exceed unpassed lessons; if some are already done, lower the count or choose tasks/saving actions.
2. **Parent → Children:** Generate a kid code and link a second browser profile/device through **I have a kid code**. Keep the parent view open for live approvals. Alternatively, set a PIN in Security and use Kid mode on the shared device.
3. **Kid → Missions:** Pass the five different lessons. **Parent → Approvals:** approve the $5 reward. With the demo's default reward destination, savings go from **$20 to $25**, unlocking the **bow tie**. In Kid → Home → Dress up → Neckwear, equip it. Replaying lessons gives no extra points or goal progress.
4. **Kid → Home → Save money:** Choose **$2** and press **Save it** three times, waiting for each response. The amount stays filled in; savings become **$31**, spending **$4**. Each transfer counts as a saving action, but saving points are awarded once per local day.
5. **Kid → Home:** Tap Maple or **Talk to Maple**, then ask “Can I buy a $50 game?” Buddy checks the current amounts and explains the trade-off; the offline helper also saves a plan card on Home. Chat retains recent messages, and parents can inspect the retained history in Buddy chats.
6. **Kid → Home → Send Maple on a trip:** Spend **30 points**, with savings unchanged. The server draws an eligible surprise destination, preferring uncollected places; the map is a travel log, not a destination picker. After about 60 seconds, open the reveal, flip the card and choose **Add to album**. Hawaiʻi is a bonus on a San Francisco return after three saves; Arches is a bonus on a Zion return after three first-passed lessons. Both rules work, but this random trip need not visit either place.
7. **Parent → Allowance:** Press **Fast-forward to payday** once; the demo's $10 allowance splits $5/$5. Pressing again immediately is refused without another payout. In **Guardian log**, choose **Post a duplicate** and watch the next check reverse it. In **Kid → Album → Friends**, propose a spare Chicago for Maya's Seattle; approve it as the parent. Traded postcards count as cards, not visited places or trip unlocks.

## How it's built

| Piece | Where | Current role |
| --- | --- | --- |
| API and timer | `server/index.js` | Express routes, family-scoped SSE, reconciliation around actions, and a two-second tick that mutates only children with due work |
| Validated actions | `server/actions.js`, `server/validate.js` | Body/type/range checks; HTTP dollars become integer cents before domain actions |
| Accounts | `server/auth.js` | Family registration, password login, cookie sessions, kid codes, PIN lock/unlock/reset and device revocation |
| Storage | `server/db.js`, `server/store.js` | SQLite schema, one JSON game document per child, transactions/rollback, retention and legacy import |
| Limits and calendar | `server/limits.js`, `server/time.js` | Process-local rate/concurrency/SSE limits; time-zone day keys and Monday–Sunday ISO weeks |
| Game and catalog | `server/domain.js`, `server/catalog.js` | Lessons, goals, surprise draws, permanent milestones, wardrobe, practice friends and trades |
| Ledger Guardian | `server/guardian.js`, `server/bank.js` | G1–G5 policies, cent-based idempotent simulated transfers and optional Nessie mirror |
| Money Buddy and voice | `server/buddy.js`, `server/voice.js` | Four-tool Claude loop, redaction, output guard, rule-based fallback and optional Cartesia TTS |
| Client | `client/src/App.jsx`, `Child.jsx`, `Parent.jsx`, `api.js` | React 18 account/child selection, talk on Home, parent console, cookie requests, SSE plus five-second polling |
| Reveals and counts | `server/domain.js`, `server/index.js`, `client/src/Child.jsx` | Server `revealedAt` receipts across devices, local receipt retry, shared `metrics.postcards` for trip places versus all cards |
| PWA and art | `client/public/sw.js`, `client/src/Bear.jsx`, `MapView.jsx`, `Postcard.jsx` | Built-shell cache, warmed art, layered bear poses, read-only map and illustrated flip cards |

### Ledger Guardian (Hyphenate: Autonomous Systems for Finance)

The Guardian is a rule-based autonomous bookkeeper. Its decisions carry policy references in the audit log.

| Policy | Implemented behavior |
| --- | --- |
| G1 | Pays scheduled allowance once per period, splits savings/spending, escalates insufficient parent funding and processes at most four overdue periods per pass. Recent-payment checks prevent a time-zone change from paying twice. |
| G2 | Executes approved rewards, extra allowance and held purchases with stable idempotency keys. Insufficient funds escalate to the right account and retry when funded; approved unpaid requests can still be declined. Zero-dollar goals complete without a transfer. |
| G3 | Checks referenced postings for duplicates and approval amount mismatches; also flags parent-originated postings with neither a reference nor an idempotency key. Reverses safe duplicates, otherwise asks for review once. Seed/idempotent unreferenced entries are not a universal external-bank audit, and allowance amounts are not independently reconstructed. |
| G4 | Holds purchases above the parent's limit. Under-limit purchases can still produce an unusual-spend notice when at least three recent posted purchases exist and the new one exceeds three times their average and is at least $5. |
| G5 | Compares funding with one allowance plus pending/approved unpaid rewards and extra allowance. Warns once per shortfall episode; sufficient funding clears the warning latch. Checks run during actions or due work, with no fixed one-day-ahead guarantee. |

### Money Buddy (Anthropic)

The configured defaults are **claude-opus-5-5** with adaptive thinking at low effort and **claude-haiku-5-5** for the output guard. These are code defaults, not a claim that live provider access was verified.

- **Tools:** `get_snapshot` and `simulate_purchase` only read/calculate. `update_savings_plan` saves the Home plan card. `propose_mission` queues a parent approval. No tool moves money or approves requests; calculations use the child's current ledger.
- **Redaction:** Pattern-based filters cover U.S. phone numbers (including parenthesized formats), emails, dashed SSNs, supported street-address formats, 13–19 digit card-like numbers and explicitly labeled password/passcode/PIN values. They apply to chat, model-bound snapshots and transaction memos, tool text and replan prompts. They do not anonymize every identifier: the child's name, age and financial context can reach Claude, and unmatched personal details can slip through. Parents see which categories were removed, not the original removed values.
- **Content rules:** Short, warm money/game replies; no violence, horror, sexual/romantic content, drugs, alcohol, gambling, self-harm, hate, political/religious debate, personal-data requests, links, paid app recommendations, real-money promises or specific stock/crypto advice. Safety concerns redirect to a trusted grown-up. The Haiku guard screens live chat replies and automatic notes; anything other than exact `OK`, including guard failure, produces a safe canned reply. It screens text replies, not tool writes.
- **Parent oversight:** Buddy chats shows up to the **last 200 retained messages**, including tool names and redaction categories. The API supports an exclusive `before` cursor and the UI has Load older when a cursor exists; the first page currently holds up to the full retention cap, so paging normally adds nothing. This is not a permanent/full transcript. The kid Chat view shows the last 30. Parents can turn Buddy off per child.
- **Without a key:** The rule-based helper uses current balances for affordability, goal timing, saving plans, needs/wants, points and allowance questions. It saves Home plans on plan requests, priced affordability questions and money-event replans. It needs the local API and does not call Claude or Haiku in keyless mode. Live-model errors fall back to it, with live-mode reply screening still applied. Replans are debounced per child and stale writes are cancelled after newer events, reset or disabling Buddy.

### What's real and what's simulated

| Area | Implemented now | Boundary |
| --- | --- | --- |
| Accounts and ledger | SQLite persistence, scoped sessions, approvals, idempotency, reconciliation and audit | Ledger records only; no app-initiated bank or Apple Cash transfer |
| Trips and postcards | 15 illustrated places: 8 common, 4 rare, 1 autumn seasonal, 2 secret bonuses; 30-point surprise draw | Destination selection is random; eligibility and secret bonus conditions are deterministic; no paid draws |
| Friends | Practice friends, approval-gated linking and configurable trade approval | Friends' collections and team progress are simulated; no real multiplayer; friend views exclude balances, transactions and allowance |
| Claude | Optional Messages/tool loop, redaction and Haiku output screening | Mock-tested; live-key service/model availability was not verified for this documentation pass |
| Nessie | Optional asynchronous HTTPS sandbox mirror; local ledger remains authoritative; errors enter audit | Live sandbox unverified; best effort, not settlement or complete reconciliation; reversals are local only |
| Cartesia | Optional 60-second TTS-only token, browser bytes request, then server proxy fallback (`sonic-3.6`, API version `2026-08-14`) | Mock coverage, no live-key verification; browser speech is the final fallback where supported |
| Demo controls | Seeded balances, top-up, payday fast-forward, duplicate injection and reset | Available only to the demo family with `MQ_DEMO=1` |

### Offline postcards and icons

After an online visit to the **production build**, the service worker caches the shell and hashed assets and warms available postcard/bear art. A paired kid device with a matching cached identity and `mq_last_state` can reload offline and read its cached album; wait for cache warming before disconnecting. API responses stay out of Cache Storage. Offline actions, chat and voice are disabled; fresh state replaces the snapshot on reconnect. A first visit or missing snapshot shows a retry screen. Parent data is not restored as an offline parent session.

The UI uses hand-drawn SVGs in `client/src/Icons.jsx` plus illustrated PNGs. Custom icons can go in `client/public/icons/ui/<name>.png` and be registered in `CUSTOM`. The bear renderer has 21 wearable/companion items; the 22nd item PNG is the scene mushroom. Backgrounds are separate catalog cosmetics.

## Known limitations

- Run **one API process per database**. Document caches, rate windows, chat locks and SSE lists are process-local; restarting resets rate windows. SSE allows four connections per family, closes the oldest fifth connection and drops backpressured streams. Parent updates include all siblings; clients filter by child ID.
- Funding accounts are per child. New families start at zero; Add money records funding for ledger payouts, while demo-only top-ups simulate deposits.
- Spending outside Apple Cash is manually recorded, and the cash diary does not change balances. Savings cannot yet be withdrawn or used for an actual purchase; Buddy's savings-purchase simulation is hypothetical.
- Friends and their team contributions are simulated. Team progress has no completion reward, and some aspirational milestone effects in the catalog are not rendered.
- Browser speech and press-and-hold recognition depend on browser support and permissions. External integration badges reflect configuration, not a successful live connection.
- [Apple Cash tracking](docs/apple-cash-shortcut.md) deducts purchases logged manually or by an iPhone Shortcut from the same funding account that covers allowance. Add money in Allowance; short-funded receipts wait in Inbox for Record now or Dismiss. MoneyQuest cannot send Apple Cash or read the actual Wallet balance. Check Wallet and avoid logging a purchase twice.

## Testing and review

The original eight-way review combined independent reviews and browser reproductions, finding mismatches in money rules, privacy, accounts, offline behavior and this README. Follow-up batches used **Codex implementation → Gemini independent review → Claude verification and integration**. See [versioning and review conventions](docs/VERSIONING.md) and [CHANGELOG.md](CHANGELOG.md).

```bash
npm test
node --test client/*.test.mjs
```

The release candidate has **215 passing server tests and 92 passing client checks**. The client checks use a socket-free VM/dispatcher harness; they do not establish browser cookie behavior or live integration availability. On Node 22.9–22.12, enable SQLite for tests by setting `NODE_OPTIONS=--experimental-sqlite` in your shell environment; launch/reset scripts already include the flag.

For browser verification, follow [client/CHECKLIST.md](client/CHECKLIST.md) against a production app origin with DevTools and two separate profiles/devices. Cover family creation/linking/lock/revocation, trip/talk/reveal, offline caches and mobile layout. The checklist is a manual test plan, not a claim that every case has been rerun for this docs batch.

---

<a id="product-spec"></a>

## Original hackathon spec (October 2026)

This is the original Cal Hacks product vision, including ideas and examples that are not implemented. The sections above describe the v0.4.0 release candidate.

### A Financial Adventure Where Your Money Grows With You

## 1. Project Overview

**MoneyQuest** is a gamified financial education platform designed to help children learn how to earn, save, spend, and manage real money through a fun and interactive experience.

Instead of making financial education feel like homework, MoneyQuest turns saving money into an adventure. Each child has a cute virtual companion called **Maple**, which grows as their savings increase. By completing financial missions, tracking their money, and practicing responsible spending, children earn points they can use to send Maple on virtual adventures, collect postcards, and interact with friends.

MoneyQuest also connects children and parents through a shared financial management system. Parents can assign tasks, set allowances, review progress, and approve financial rewards. Children learn to make financial decisions while gaining more independence within boundaries set by their parents.

The goal is to make financial literacy something children **want to participate in**, while helping parents teach responsible money habits without adding extra work to their daily routines.

---

## 2. The Problem

Most children do not learn how to manage money until they are older. Financial concepts like saving, budgeting, and spending can feel abstract, especially when traditional financial education relies on lectures, worksheets, or quizzes.

Existing children's financial applications often focus on chores, allowances, and debit cards. While useful, they may not give children a strong reason to return to the app regularly.

MoneyQuest aims to solve three problems:

- **Lack of engagement:** Financial education can feel boring or disconnected from children's interests.
- **Limited understanding of real money:** Children may receive allowances without understanding the long-term impact of their financial choices.
- **Difficulty for parents:** Parents need an easy way to encourage good financial habits, assign goals, and reward progress.

MoneyQuest combines real-world financial management with virtual pet mechanics, collectible rewards, and social interaction.

---

## 3. Core Features

### Feature 1: Maple — Your Virtual Financial Companion

Every child receives a bear named Maple, a cute character that represents their financial growth.

**The more money a child saves, the bigger Maple grows.**

Bears can have different appearances, colors, expressions, and accessories, making each child's companion feel unique.

Key interactions include:

- **Savings growth:** As children increase their savings, Maple gradually grows.
- **Visual progress:** Children can directly see their savings progress through their character.
- **Customization:** Children can unlock outfits, hats, backgrounds, and accessories.
- **Character reactions:** Maple celebrates completed savings goals and encourages children when they experience financial setbacks.
- **Growth milestones:** Reaching savings goals unlocks new character appearances or cosmetic upgrades.

Maple never shrinks as punishment for spending money on reasonable needs. Instead, its current size can reflect savings progress, while earned growth milestones remain permanently unlocked.

This creates an emotional connection between children and their financial progress.

### Feature 2: Financial Missions and Daily Tracking

Children can complete missions to earn experience points, which can be used for in-game activities and rewards.

**Examples of financial missions:**

| Mission | Example points |
|---|---:|
| Record today's spending or savings | +10 |
| Complete a financial literacy mini-game | +20 |
| Save toward a personal goal | +30 |
| Complete a parent-assigned task | +40 |
| Finish a weekly budgeting challenge | +50 |
| Reach a savings milestone | +100 |

Daily tracking allows children to record their spending, savings, and allowances. If connected to a supported financial account, transactions could eventually be synchronized automatically with appropriate parental permissions.

The system can also generate age-appropriate missions based on a child's financial learning progress.

Points are **virtual rewards, not real money**, and cannot be cashed out.

### Feature 3: Maple Adventures and Postcard Collection

One of MoneyQuest's main engagement features is the ability to send bears on virtual adventures.

Children can use points earned from missions and financial tracking to send Maple to different destinations.

For example:

- **Beach Vacation:** 100 points
- **Fancy Restaurant:** 80 points
- **Amusement Park:** 150 points
- **Camping Trip:** 120 points
- **Space Adventure:** 300 points

After an adventure is completed, Maple returns with a unique collectible postcard.

Each postcard includes an illustration of the destination, Maple enjoying the experience, a short message about the adventure, and the date it was collected.

Children can store these postcards in a personal digital collection album.

**The important distinction is that adventure points are earned through positive financial habits, not by spending real money.** Children can enjoy the game without making purchases.

### Feature 4: Hidden and Rare Postcards

To make exploration more exciting, MoneyQuest includes secret postcards that children can discover through different missions and adventure combinations.

Postcards are divided into different collection categories:

- **Common:** Collected through standard adventures.
- **Rare:** Earned through special missions or exploration challenges.
- **Secret:** Hidden postcards unlocked by discovering unusual destination combinations or completing special financial learning challenges.
- **Seasonal:** Limited-themed postcards associated with holidays or educational events.

For example, sending Maple camping might occasionally unlock a hidden postcard featuring a secret forest village.

Another secret postcard could be unlocked by completing three savings-related missions and then visiting a special destination.

Some clues can appear in the postcard collection album, encouraging children to explore.

Hidden postcards should be unlocked through discoverable achievements rather than requiring random purchases or excessive daily activity.

### Feature 5: Friends and Postcard Exchange

MoneyQuest includes a social feature where children can connect with approved friends and share their postcard collections.

Children can:

- Add friends using invitation codes with parental controls.
- Visit their friends' bear profiles.
- See which postcards their friends have collected.
- Exchange eligible postcards.
- Send prewritten positive messages or postcard greetings.
- Work together toward cooperative financial literacy challenges.

For example, one child might have an extra Beach Vacation postcard and exchange it for their friend's Camping Trip postcard.

The social system encourages interaction and collaboration without revealing private financial information.

**Friends cannot see each other's real savings balances, transaction history, or allowance amounts.**

For younger users, friend connections and postcard exchanges would require parental approval. Public chat and unrestricted messaging would not be included.

### Feature 6: Parent Dashboard and Allowance Management

Parents have a separate dashboard for managing their child's financial activities.

Parents can:

- Create financial learning goals and assign tasks.
- Set weekly or monthly allowances.
- Offer real-money rewards for completed goals.
- Monitor savings progress.
- Review mission completion.
- Approve or decline additional allowances.
- Manage friend requests and privacy settings.

**Example parent-child workflow:**

1. A parent creates a goal: "Complete five financial literacy challenges to earn $5."
2. The child completes the challenges through MoneyQuest.
3. The system verifies completion and notifies the parent.
4. The parent receives a notification: "Your child completed their goal! Would you like to approve the $5 reward?"
5. The parent approves the reward.
6. The reward is recorded in MoneyQuest and, if a supported payment integration is available, transferred through an authorized financial service.

This connects in-game achievements with real financial learning while keeping parents in control.

### Feature 7: Real Money and Spending Integration

MoneyQuest is designed to help children understand and manage actual money, rather than relying entirely on a fictional currency.

Potential future integrations include:

- **Bank account connectivity:** Parents can connect eligible financial accounts to display balances and transaction histories.
- **Parent-approved transfers:** Rewards can eventually be deposited into a child's eligible financial account through an authorized provider.
- **Real savings goals:** Children can save toward actual items, such as bicycles, toys, school trips, or gifts.

For the hackathon prototype, MoneyQuest will use simulated financial transactions and accounts to demonstrate the complete experience without moving real funds.

### Feature 8: AI Financial Buddy

MoneyQuest includes an AI-powered financial assistant that helps children understand financial concepts through simple, age-appropriate explanations.

Instead of simply answering questions, the assistant responds to the child's actual goals and activities.

For example:

**Child:** "I want to buy a $50 game, but I only have $80."

**Money Buddy:** "You can afford it, but remember you're also saving for your $100 bicycle. Want to see how buying the game would change your savings timeline?"

The assistant can:

- Suggest realistic saving plans.
- Explain spending trade-offs.
- Generate financial learning missions.
- Identify changes in savings progress.
- Recommend adjustments after unexpected expenses.
- Help children set achievable goals.

The AI cannot independently move real money. Financial transfers always require the necessary adult authorization.

---

## 4. Two Connected Reward Systems

MoneyQuest separates real-world savings from virtual game rewards.

| System | How it works | Purpose |
|---|---|---|
| **Real Savings** | Actual or simulated money saved toward personal goals | Grows Maple and teaches financial responsibility |
| **Adventure Points** | Earned through missions, tracking, and learning activities | Used for adventures, cosmetic rewards, and collectible postcards |

This distinction is important because spending virtual adventure points should never reduce a child's actual savings.

Children who have less money should still be able to enjoy the game, unlock adventures, and collect postcards through learning and participation.

---

## 5. Main User Flow

**Child's experience**

1. Create a bear named Maple.
2. Set a savings goal.
3. Receive an allowance or record existing savings.
4. Complete missions and track financial activities.
5. Watch Maple grow as savings increase.
6. Earn adventure points.
7. Send Maple on trips.
8. Collect regular, rare, and hidden postcards.
9. Exchange postcards with approved friends.
10. Continue developing financial habits while unlocking new experiences.

**Parent's experience**

1. Create and manage a family account.
2. Set allowances and financial boundaries.
3. Assign goals and optional rewards.
4. Receive goal-completion notifications.
5. Approve or decline rewards.
6. Review savings progress and learning achievements.
7. Manage social permissions and account connections.

---

## 6. Potential Cal Hacks Sponsor Tracks

| Sponsor track | MoneyQuest integration |
|---|---|
| **Hyphenate — Autonomous Systems for Finance** | An AI financial agent monitors simulated allowance transactions, reconciles reward obligations, adjusts savings plans, and escalates transfers for parental approval with an audit trail |
| **Capital One — Best Use of Nessie** | Simulated bank accounts, deposits, spending, and allowance transfers |
| **Microsoft — Built for the Real World** | A production-minded financial education platform with measurable learning outcomes and parental safeguards |
| **Anthropic** | Claude-powered age-appropriate financial guidance, adaptive missions, and financial reasoning |
| **Meta — Bringing People Closer Together with AI** | Cooperative financial challenges and AI-supported family interactions, beyond basic friend lists |
| **SpacetimeDB** | Real-time synchronization for social postcard exchange and shared challenges |
| **Cartesia** | An interactive Maple voice companion, if voice becomes a core part of the experience |

These are potential track matches, not guaranteed eligibility. Each sponsor's required technology must be used meaningfully.

---

## 7. Hackathon MVP

For Cal Hacks, the goal is to deliver a polished, working prototype instead of attempting every feature at once.

**Must-have features:**

1. A child dashboard featuring an animated Maple.
2. A simulated savings account where savings growth changes Maple's size.
3. Financial missions and a working adventure-points system.
4. A selection of virtual destinations.
5. A collectible postcard album, including at least one hidden postcard.
6. Parent-created missions and a goal-completion approval notification.
7. A simulated allowance transfer and transaction history.
8. A working AI financial assistant that can update plans after financial changes.

**Stretch goals:**

- Friend invitation and postcard trading.
- More Maple customization.
- Real-time collaborative financial missions.
- Voice interaction using Cartesia.
- Broader financial account integrations.

### Hackathon Demo Scenario

A parent creates a $5 reward for completing a set of learning missions.

The child completes those missions and earns adventure points. Their parent receives an approval notification and releases a simulated $5 allowance.

The child's savings balance increases, causing Maple to grow.

The child spends their adventure points to send Maple on a beach vacation. When Maple returns, it brings back a postcard—and unexpectedly discovers a hidden collectible.

Finally, the child can view their collection and prepare a postcard exchange with a friend.

This demonstrates the connection between real financial habits, parental involvement, AI guidance, and a playful reward system.

---

## 8. Long-Term Vision

MoneyQuest aims to become more than a children's banking companion or financial literacy game.

By combining a personal virtual character, real financial progress, missions, exploration, and collectible postcards, MoneyQuest gives children a reason to return to financial learning voluntarily.

For children, it is a game about raising Maple, exploring destinations, and collecting memories.

For parents, it is a tool for teaching financial responsibility, managing allowances, and celebrating their child's progress.

**Our vision is to make saving money feel rewarding, managing money feel approachable, and financial education become part of everyday childhood experiences.**

**Tagline: Save money. Grow Maple. Explore the world.**