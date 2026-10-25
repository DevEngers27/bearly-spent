# MoneyQuest
### Save money. Grow your bear. Explore the world.

MoneyQuest is a money game for kids aged 7–12 and the grown-ups who give them allowance. Kids complete money lessons and missions, save real (simulated) money that makes their bear, **Maple**, grow, and spend game points to send Maple to 15 real U.S. national parks and cities, each of which sends back an illustrated postcard. Parents set allowance and reward goals and approve anything that moves money. An autonomous **Ledger Guardian** runs the books, and **Money Buddy**, built on Claude, explains trade-offs using the child's real numbers.

> The full product spec is further down: [Product spec](#product-spec).

---

## Run it

Requires Node 20.6+.

```bash
npm install
npm run dev          # API on :8787 + web on :5173 → open http://localhost:5173
```

For the judging table, use a production build:

```bash
npm run build && npm start     # everything on http://localhost:8787
npm test                       # 10 rule tests (payouts, reconciliation, privacy, unlocks)
npm run reset                  # restore the demo family
```

- Parent PIN: **1234**. Open `http://localhost:5173/?role=parent` in a second window. Both views update live.
- Keys are optional. Copy `.env.example` to `.env` to enable Claude, Nessie or Cartesia. Without keys everything still works, using a simulated bank and an offline planner. No secrets are committed.
- `ADVENTURE_SECONDS` (default 15) controls how long the bear is away on a trip.
- **Install it as an app.** MoneyQuest is a PWA. On a phone, open the production URL and choose *Add to Home Screen* (iOS Safari) or *Install app* (Android Chrome). It launches full-screen with its own icon and caches the postcards for offline viewing. Installing needs HTTPS or `localhost`; for a phone on the same Wi-Fi, use a tunnel such as `npx localtunnel --port 8787`.

## Two-minute demo

1. **Parent → Goals & tasks.** Create "Complete five financial literacy challenges" for $5. It's prefilled.
2. **Kid → Missions.** Pass the five money lessons. Then, on **Home**, tap **Save money** three times.
3. **Parent → Approvals.** "Your child completed their goal! Would you like to approve the $5.00 reward?" Approve it. The Guardian pays it within two seconds, the bear grows, and a milestone unlocks the bow tie.
4. **Kid → Map → San Francisco.** Maple walks the dotted trail across the map and comes back with the San Francisco postcard, plus the secret **Hawaiʻi Volcanoes** postcard, discovered because the child saved three times. Tap a card to turn it over and read the story, stamp and postmark.
5. **Kid → Buddy.** "I want to buy a $50 game. Can I?" Claude checks the real balances, simulates the purchase against the bike goal, and saves an updated plan to Home.
6. **Parent → Guardian log → Post a duplicate.** This simulates the bank double-posting the reward. Within one tick the Guardian finds two postings for one obligation, reverses the extra one, and records why.
7. **Kid → Album → Friends.** Propose swapping a spare Chicago postcard for Maya's Seattle postcard. The swap goes to the parent for approval.

## How it's built

| Piece | Where | What it does |
|---|---|---|
| API + autonomy loop | `server/index.js` | Express REST API, server-sent events for live sync, and a 2-second tick that brings the bear home and runs the Guardian |
| Game & family rules | `server/domain.js`, `server/catalog.js` | Missions, lessons, goals, approvals, the 15 destinations and their unlock rules, cosmetics, friends and trades |
| Ledger Guardian | `server/guardian.js` | The autonomous finance agent (see below) |
| Money Buddy | `server/buddy.js` | Claude agent loop with four tools, personal-info redaction, and an offline fallback |
| Bank | `server/bank.js` | Idempotent simulated ledger in cents, with an optional Nessie mirror |
| Voice | `server/voice.js` | Optional Cartesia Sonic TTS (`sonic-3.6`, `Cartesia-Version: 2026-08-14`). The server mints a 60-second TTS-only access token; the browser calls `/tts/bytes` directly, with a server proxy as fallback. Without a key, the browser's speech synthesis is used |
| Web app | `client/src` | React + Vite, installable as a PWA (`client/public/manifest.webmanifest`, `sw.js`). The bear (`Bear.jsx`) is layered from the illustrated PNGs in `client/public/bear` (4 poses, 22 accessories placed per item); the adventure map (`MapView.jsx`) is SVG with a hand-drawn wobble filter |
| Art | `client/public/postcards`, `client/public/bear` | The 15 postcards (source: `bear_postcard_collection_15/`) and the bear poses and accessories (source: `bear_app_assets/`, with stray slivers from the sticker sheets removed and trimmed) |
| Storage | `data/db.json` | A JSON file; delete it to reset |

### Ledger Guardian (Hyphenate: Autonomous Systems for Finance)

**The seat it fills:** the family's allowance bookkeeper. It pays on schedule, pays approved rewards, reconciles the ledger, and knows when to ask.

| Policy | Behaviour |
|---|---|
| G1 | Pays the weekly allowance on schedule, split between savings and spending by the parent's rule. If funding is short it escalates instead of overdrawing. |
| G2 | Pays parent-approved rewards, purchases and extra allowance exactly once, using an idempotency key per approval. |
| G3 | Reconciles every posting against an obligation. Duplicates are reversed automatically; postings with no matching approval are flagged for the parent and left alone. |
| G4 | Holds purchases over the parent's limit for approval, and tells the parent about spending that's unusually large. |
| G5 | Warns the parent a day ahead when funding won't cover upcoming commitments. |

Its access is limited on purpose. It can only move money that a schedule or an approval authorises, and can only reverse postings that exceed an obligation. Every decision is written to the audit log with the policy that triggered it. The "Post a duplicate" button is the recovery moment for judges.

### Money Buddy (Anthropic)

- Model `claude-opus-5` with adaptive thinking at `low` effort to keep chat fast for kids, plus server-side refusal fallbacks (`fallbacks: "default"`).
- Tools: `get_snapshot` and `simulate_purchase` are read-only. `update_savings_plan` writes the plan card on the kid's Home screen. `propose_mission` goes to the parent's approval queue. **No tool can move money.**
- After every real money event (reward paid, purchase, allowance, reversal) the server asks Buddy to re-plan and leave the child a short note.
- **Where it could go wrong, and what we do about it:**
  - Kids overshare. Phone numbers, emails, addresses, card numbers and passwords are stripped on the server before the text reaches the model, and the child gets a gentle reminder.
  - Wrong numbers. The system prompt requires tool calls before giving number-based advice, and all maths is done in code.
  - Out-of-scope or unsafe topics. The prompt redirects to a trusted adult.
  - Parents need to see what was said. The full transcript, including which tools were used and what was redacted, is in **Parent → Buddy chats**, and parents can switch Buddy off.

### What's real and what's simulated

| Real | Simulated |
|---|---|
| Ledger logic, idempotency, reconciliation, approvals, audit log | Money. Accounts are a local ledger with no real funds. |
| Claude calls (with `ANTHROPIC_API_KEY`) | Friends Maya, Sam and Zoe, and their side of swaps and team challenges |
| Postcard unlock rules: 8 common places, 4 rare ones unlocked by habits, 1 seasonal (autumn), 2 secrets discovered on other trips. Deterministic, never random or paid | "Fast-forward to payday" and "Post a duplicate" are demo controls |
| Nessie mirror and Cartesia voice when keys are set | Without keys: offline planner, simulated bank, browser speech |

## Icons

The app uses no emoji. Icons are hand-drawn SVGs in `client/src/Icons.jsx`, and a few use art from the bear pack (honey jar, picnic basket, magnifier, adventure map). Stamps and map pins use crops of each place's postcard.

To replace any icon with your own art, save a square transparent PNG as `client/public/icons/ui/<name>.png` and add the name to `CUSTOM` at the top of `Icons.jsx`:

| Name | Where it appears |
|---|---|
| `home`, `star`, `mapNav`, `album`, `chat` | Bottom navigation |
| `bell`, `lock` | Header: news and grown-ups |
| `honey` | Savings amount, "Save" items |
| `sparkle` | Adventure points, toasts, surprise badge |
| `close`, `check` | Close buttons, finished missions |
| `target`, `hourglass`, `map` | "Next up" suggestions |
| `acorn` | Progress toward a parent goal |
| `basket`, `abacus`, `magnifier`, `sprout`, `chart` | The five money lessons |
| `honey`, `basket`, `balloon`, `heart` | Budget challenge: save, needs, fun, give |
| `medal`, `heart` | Lesson passed, try again |
| `bike` | Savings goal |
| `backpack`, `paws` | Trip in progress, postcard signature |
| `speaker` | Read a Buddy message aloud |

## Known limitations

- Single family, single child. The parent PIN and session are demo-grade, not production auth.
- The Nessie mirror is best-effort, and it has **not been exercised against the live sandbox** because no key was available while building. The local ledger stays the source of truth, and Nessie errors appear in the audit log. The Cartesia requests follow the current docs and were checked against a mock, but not against a live key either.
- The Claude integration was verified against a mock of the Messages API (request shape, tool loop, plan writes), not against a live key. Without `ANTHROPIC_API_KEY`, Money Buddy runs an offline helper that answers common questions (can I afford X, when do I reach my goal, make a plan, needs vs. wants, points, allowance, saving tips) from the child's real numbers.
- Friends are simulated. Real-time multiplayer (e.g. SpacetimeDB) is the natural next step.
- Spending is logged by the child. There's no card or bank feed.

---

<a id="product-spec"></a>

# MoneyQuest
### A Financial Adventure Where Your Money Grows With You

## 1. Project Overview

**MoneyQuest** is a gamified financial education platform designed to help children learn how to earn, save, spend, and manage real money through a fun and interactive experience.

Instead of making financial education feel like homework, MoneyQuest turns saving money into an adventure. Each child has a cute virtual companion called a **Money Blob**, which grows as their savings increase. By completing financial missions, tracking their money, and practicing responsible spending, children earn points they can use to send their Money Blob on virtual adventures, collect postcards, and interact with friends.

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

### Feature 1: Money Blob — Your Virtual Financial Companion

Every child receives their own Money Blob, a cute character that represents their financial growth.

**The more money a child saves, the bigger their Money Blob grows.**

Money Blobs can have different appearances, colors, expressions, and accessories, making each child's companion feel unique.

Key interactions include:

- **Savings growth:** As children increase their savings, their Money Blob gradually grows.
- **Visual progress:** Children can directly see their savings progress through their character.
- **Customization:** Children can unlock outfits, hats, backgrounds, and accessories.
- **Character reactions:** The Money Blob celebrates completed savings goals and encourages children when they experience financial setbacks.
- **Growth milestones:** Reaching savings goals unlocks new character appearances or cosmetic upgrades.

The Money Blob never shrinks as punishment for spending money on reasonable needs. Instead, its current size can reflect savings progress, while earned growth milestones remain permanently unlocked.

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

### Feature 3: Money Blob Adventures and Postcard Collection

One of MoneyQuest's main engagement features is the ability to send Money Blobs on virtual adventures.

Children can use points earned from missions and financial tracking to send their Money Blob to different destinations.

For example:

- **Beach Vacation:** 100 points
- **Fancy Restaurant:** 80 points
- **Amusement Park:** 150 points
- **Camping Trip:** 120 points
- **Space Adventure:** 300 points

After an adventure is completed, the Money Blob returns with a unique collectible postcard.

Each postcard includes an illustration of the destination, the Money Blob enjoying the experience, a short message about the adventure, and the date it was collected.

Children can store these postcards in a personal digital collection album.

**The important distinction is that adventure points are earned through positive financial habits, not by spending real money.** Children can enjoy the game without making purchases.

### Feature 4: Hidden and Rare Postcards

To make exploration more exciting, MoneyQuest includes secret postcards that children can discover through different missions and adventure combinations.

Postcards are divided into different collection categories:

- **Common:** Collected through standard adventures.
- **Rare:** Earned through special missions or exploration challenges.
- **Secret:** Hidden postcards unlocked by discovering unusual destination combinations or completing special financial learning challenges.
- **Seasonal:** Limited-themed postcards associated with holidays or educational events.

For example, sending the Money Blob camping might occasionally unlock a hidden postcard featuring a secret forest village.

Another secret postcard could be unlocked by completing three savings-related missions and then visiting a special destination.

Some clues can appear in the postcard collection album, encouraging children to explore.

Hidden postcards should be unlocked through discoverable achievements rather than requiring random purchases or excessive daily activity.

### Feature 5: Friends and Postcard Exchange

MoneyQuest includes a social feature where children can connect with approved friends and share their postcard collections.

Children can:

- Add friends using invitation codes with parental controls.
- Visit their friends' Money Blob profiles.
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
- **Apple Cash Family compatibility:** Families could use Apple Cash outside the app for spending and allowances, although direct account synchronization and transfers would require supported integration capabilities.
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
| **Real Savings** | Actual or simulated money saved toward personal goals | Grows the Money Blob and teaches financial responsibility |
| **Adventure Points** | Earned through missions, tracking, and learning activities | Used for adventures, cosmetic rewards, and collectible postcards |

This distinction is important because spending virtual adventure points should never reduce a child's actual savings.

Children who have less money should still be able to enjoy the game, unlock adventures, and collect postcards through learning and participation.

---

## 5. Main User Flow

**Child's experience**

1. Create a Money Blob.
2. Set a savings goal.
3. Receive an allowance or record existing savings.
4. Complete missions and track financial activities.
5. Watch the Money Blob grow as savings increase.
6. Earn adventure points.
7. Send the Money Blob on trips.
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
| **Cartesia** | An interactive Money Blob voice companion, if voice becomes a core part of the experience |

These are potential track matches, not guaranteed eligibility. Each sponsor's required technology must be used meaningfully.

---

## 7. Hackathon MVP

For Cal Hacks, the goal is to deliver a polished, working prototype instead of attempting every feature at once.

**Must-have features:**

1. A child dashboard featuring an animated Money Blob.
2. A simulated savings account where savings growth changes the Money Blob's size.
3. Financial missions and a working adventure-points system.
4. A selection of virtual destinations.
5. A collectible postcard album, including at least one hidden postcard.
6. Parent-created missions and a goal-completion approval notification.
7. A simulated allowance transfer and transaction history.
8. A working AI financial assistant that can update plans after financial changes.

**Stretch goals:**

- Friend invitation and postcard trading.
- More Money Blob customization.
- Real-time collaborative financial missions.
- Voice interaction using Cartesia.
- Broader financial account integrations.

### Hackathon Demo Scenario

A parent creates a $5 reward for completing a set of learning missions.

The child completes those missions and earns adventure points. Their parent receives an approval notification and releases a simulated $5 allowance.

The child's savings balance increases, causing their Money Blob to grow.

The child spends their adventure points to send the Money Blob on a beach vacation. When the Blob returns, it brings back a postcard—and unexpectedly discovers a hidden collectible.

Finally, the child can view their collection and prepare a postcard exchange with a friend.

This demonstrates the connection between real financial habits, parental involvement, AI guidance, and a playful reward system.

---

## 8. Long-Term Vision

MoneyQuest aims to become more than a children's banking companion or financial literacy game.

By combining a personal virtual character, real financial progress, missions, exploration, and collectible postcards, MoneyQuest gives children a reason to return to financial learning voluntarily.

For children, it is a game about raising their Money Blob, exploring destinations, and collecting memories.

For parents, it is a tool for teaching financial responsibility, managing allowances, and celebrating their child's progress.

**Our vision is to make saving money feel rewarding, managing money feel approachable, and financial education become part of everyday childhood experiences.**

**Tagline: Save money. Grow your Blob. Explore the world.**