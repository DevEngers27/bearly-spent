# Apple Cash tracking

MoneyQuest records Apple Cash activity; it does not connect to an Apple Cash API,
send money or read the actual Wallet balance. The tracked balance is money marked
sent by a parent minus purchases recorded manually or by a Shortcut. Use only the
Apple Cash card in your automation, not every card in Wallet.

## Create the child's Shortcut token

1. Sign in as a parent, set a PIN in Security if needed, and unlock parent mode.
2. Open Children → the child's Apple Cash tracking card → Generate Shortcut token.
3. Copy the token into the child's Shortcut. It is displayed only after creation
   or rotation and is never saved in browser storage. After leaving this screen,
   rotate to obtain a new token; the old one stops working immediately.

The token is a normal child session bound to this child, with device kind
`shortcut`, a fixed 180-day lifetime and the same child-route permissions as a
paired kid device. It cannot access parent routes or siblings. Keep it private.
Children → Devices lists **Apple Cash Shortcut**; Unlink revokes it. Family-wide
sign-out also revokes it. Rotation affects only this child's Shortcut sessions,
not paired browsers or siblings. The database stores a hash, never the raw token.

<!-- Screenshot placeholder: Children → Apple Cash tracking, token controls. -->

## iPhone automation

Use your MoneyQuest site's HTTPS origin in place of `https://YOUR_MONEYQUEST_SITE`.
The iPhone must be able to reach that site.

1. Open Shortcuts → Automation → New Automation → Transaction.
2. Select **Apple Cash** as the card and **Run Immediately**.
3. Add **Get Contents of URL**, URL
   `https://YOUR_MONEYQUEST_SITE/api/child/wallet/spend`, method **POST**.
4. Add headers:
   - `Content-Type`: `application/json`
   - `Authorization`: `Bearer YOUR_CHILD_SHORTCUT_TOKEN`
5. Select request body **JSON**. Map the transaction amount, merchant and date
   from the automation's input into the fields below. Format date as ISO 8601,
   including the time zone. Amount is dollars, not cents. This is the exact body
   shape (the sample values must be replaced for each actual purchase):

```json
{
  "amount": 4.25,
  "merchant": "Corner shop",
  "at": "2026-10-24T12:30:00-07:00",
  "external_id": "wallet-transaction-unique-id"
}
```

`amount` and `merchant` are required. Amount must be $0.01–$10,000; merchant is
1–120 characters. Optional `at` accepts ISO 8601 with a zone or Unix milliseconds;
omitting it uses receipt time. Optional `external_id` is 1–64 characters and is
the idempotency key within this child's wallet. **Always supply it in automation**:
retries with the same ID return the original transaction without another debit,
notice or points. Keep the original ID through retries; do not generate a fresh
random ID on each retry. Receipts survive rolling ledger retention and restart.

Spend requests and connection pings each allow **60 requests per hour per child
session**, with separate quotas. A full quota returns HTTP **429** with the
friendly message "Let's take a little break. Try again soon!", a `Retry-After`
header in seconds and the same value as `retryAfterSeconds` in the JSON body.
Configure the Shortcut to keep the pending purchase and retry after that delay,
using the original body and `external_id`; do not discard it or make a new ID.
The rejected request records no purchase. Invalid authenticated requests and
duplicate retries also count, so avoid immediate retry loops. Windows begin on
the first request and reset after an hour; limits reset on API restart.

If your iOS version exposes a stable transaction identifier, use it. Otherwise,
derive an ID from the original transaction date, merchant and amount (at most 64
characters). This fallback can collide for identical purchases at the same
timestamp; check the ledger against Wallet. Available transaction fields and
eligible cards vary by device/iOS: verify them on the child's phone. If Apple Cash
or the required fields are unavailable, use manual tracking instead.

<!-- Screenshot placeholder: Transaction trigger, Apple Cash, Run Immediately. -->
<!-- Screenshot placeholder: Get Contents of URL, headers, mapped JSON fields. -->

## Test the connection

The card's **Test connection** button uses the displayed child Bearer token to
POST `{}` to `/api/child/wallet/ping`. It does not replace your parent cookie or
create a transaction. For an end-to-end phone test, run a temporary Shortcut with
the same headers, POST method and empty JSON object, targeting that ping URL.
Success returns `{ "ok": true, "childId": "child_...", "at": 1792860000000 }`
(time varies); the parent wallet card shows the last successful ping time.

The browser test verifies the token and server; only a run on the child's phone
verifies the automation wiring. Check the next real purchase against the ledger.
401 means revoked/expired credentials; generate a new token and update the phone.

## Recording sent money and manual purchases

In Children, the selected child's wallet ledger has **Send via Apple Cash**.
Send through Apple's Wallet/Messages first, then record amount and optional note.
`POST /api/parent/wallet/send` accepts `{ "amount": 10, "note": "Lunch money" }`
under the usual unlocked-parent authorization and `?child=` selection.
It records `outside → wallet`, kind `wallet_in`, memo `Sent via Apple Cash`, and
notifies the child. The money comes from the parent's own pocket, outside the
child's funding record. Only the tracked wallet is credited: **recorded — this
does not change the funding record**. It works even when funding is zero and
never drives funding negative. Savings and spending pots are untouched. No Nessie
instruction or Apple payment is made.

For ledger accounting, total money is funding + savings + spending + wallet +
posted merchant outflows − posted outside inflows. An Apple Cash send increases
wallet and outside inflows equally.

The child can use My money → Spent → **Paid with Apple Cash** to record a purchase
manually. Avoid manually logging any purchase the automation already recorded:
manual entries have no shared external ID and cannot be automatically matched.
Apple Cash entries are tagged in Recent and parent Transactions.

Purchases post immediately even above the purchase limit or tracked balance:
money already left Wallet. Purchases above the limit notify the parent without
creating an approval hold; G4 also flags unusually large purchases. An uncovered
purchase carries `uncovered: true`, can make the wallet negative, and prompts the
parent to check unrecorded outside transfers. Recording those transfers reconciles
the balance; the original purchase retains its historical uncovered flag.

## Token API

- `GET /api/child/wallet/token?child=...`: unlocked parent **with a configured
  PIN**; returns `{token:null,id,expiresAt}` for an active Shortcut, or null ID/time.
  GET never creates or rotates a credential.
- `POST /api/child/wallet/token?child=...` with `{}`: same authorization;
  atomically revokes prior Shortcut sessions and returns `{token,id,expiresAt}`.
  This is the only response that exposes the raw token. Store only the hash.
- `POST /api/child/wallet/ping` with `{}`: ordinary child authorization, including
  a child's Bearer token. Tests credentials and records connection time only.
- `POST /api/child/wallet/spend`: ordinary child authorization; body above.

Parents may select children with `?child=`. A child token always stays bound to
its own child. These tracking routes work for real families and are not demo
controls. Demo-only top-up/reset/fault routes retain their existing gates.
