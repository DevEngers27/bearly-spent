# Apple Cash tracking

MoneyQuest records Apple Cash activity; it does not connect to an Apple Cash API,
send money or read the actual Wallet balance. Apple Cash purchases deduct from
**the child's savings**. When a parent sends money outside the app, the child
records it in **My money → Received**, entering the amount and who sent it. This
adds to savings without deducting parent Funding. Do not add allowance or rewards
that MoneyQuest has already credited.
Use only the Apple Cash card in your automation, not every card in Wallet.

## Create the child's Shortcut token

1. Sign in as a parent, set a PIN in Security if needed, and unlock parent mode.
2. Open Parent → Kids → Children → the child's Apple Cash tracking card → Generate Shortcut token.
3. Copy the token into the child's Shortcut. It is displayed only after creation
   or rotation and is never saved in browser storage. After leaving this screen,
   rotate to obtain a new token; the old one stops working immediately.

The token is a normal child session bound to this child, with device kind
`shortcut`, a fixed 180-day lifetime and the same child-route permissions as a
paired kid device. It cannot access parent routes or siblings. Keep it private.
The tracking card and Children → Devices both offer **Unlink** to revoke it. Family-wide
sign-out also revokes it. Rotation affects only this child's Shortcut sessions,
not paired browsers or siblings. The database stores a hash, never the raw token.


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
the idempotency key within this child's records. **Always supply it in automation**:
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


## Test the connection

Run a temporary Shortcut on the child's iPhone using the same headers, POST
method and empty JSON object, targeting
`https://YOUR_MONEYQUEST_SITE/api/child/wallet/ping`. This checks the connection
without creating a transaction.
Success returns `{ "ok": true, "childId": "child_...", "at": 1792860000000 }`
(time varies); the parent wallet card shows the last successful ping time.

A successful phone ping checks the token and connection. Check the next real
purchase against the ledger to verify the transaction automation too.
401 means revoked/expired credentials; generate a new token and update the phone.

## Received money and purchases

After receiving money from a parent, the child opens **My money → Received**,
enters the amount and sender, then taps **Add received money**. This credits
savings as `outside → savings`, kind `wallet_received`, and notifies the parent.
The client supplies a stable `request_id` for retries. The money is already
received outside the app; this entry does not send a payment, debit Funding,
or credit Spending. Avoid adding allowance or rewards already recorded.

With the Apple Cash Transaction automation configured above, each reported
purchase deducts from savings automatically. Without that automation the app
cannot observe Wallet activity. The child can manually use **My money → Spent →
Apple Cash** for an unrecorded purchase. Do not manually enter a purchase already
reported by the Shortcut. **Spending money** still uses the separate Spending pot.

New purchases post `savings → merchant`, kind `wallet_spend`. Over-limit purchases
notify the parent but are recorded because the payment already happened. When
savings are short, the API saves the original receipt and returns HTTP 409 with
`reason: "savings_short"` and `shortBy` in cents; no account goes negative. Recording
received money automatically retries waiting receipts in arrival order, stopping
at the first receipt that savings cannot cover. This includes retained receipt
IDs outside the newest-20 visible pending list. Parent Inbox also offers
**Record now** and **Dismiss**. Retrying a posted or dismissed external ID does not
deduct again. Keep the original external ID and body through network/rate retries.

Parent Funding continues to cover scheduled allowance and approved rewards.
It is separate from the child's savings and is not charged for new Apple Cash
purchases. Historical purchases keep their original source and are not recharged.
Legacy wallet migration is unchanged. Apple Cash activity shows savings, pending
receipts, and weekly/monthly purchase totals; check real payments in Wallet.

| HTTP | Meaning | What to do |
| --- | --- | --- |
| 200 | Recorded; `duplicate:true` means already processed. | Finish; do not create another ID. |
| 409 | `reason:"savings_short"`; original receipt saved without a debit. | Record genuinely received money; queued receipts retry automatically, or retry the original purchase. |
| 429 | `Retry-After` and `retryAfterSeconds` give the wait. | Preserve the original body and ID and retry after the delay. |

## Token API

- `GET /api/child/wallet/token?child=...`: unlocked parent **with a configured
  PIN**; returns `{token:null,id,expiresAt,lastPing,connected}` for an active Shortcut, or null ID/time.
  GET never creates or rotates a credential. `lastPing` is a timestamp or null;
  `connected` requires a ping since the active token was issued. Rotation starts
  disconnected until the next phone test.
- `POST /api/child/wallet/token?child=...` with `{}`: same authorization;
  atomically revokes prior Shortcut sessions and returns `{token,id,expiresAt,lastPing,connected}`.
  This is the only response that exposes the raw token. Store only the hash.
- `POST /api/child/wallet/ping` with `{}`: ordinary child authorization, including
  a child's Bearer token. Tests credentials and records connection time only.
- `POST /api/child/wallet/spend`: ordinary child authorization; body above.

Parents may select children with `?child=`. A child token always stays bound to
its own child. These tracking routes work for real families and are not demo
controls. Demo-only top-up/reset/fault routes retain their existing gates.
