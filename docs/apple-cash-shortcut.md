# Apple Cash tracking

MoneyQuest records Apple Cash activity; it does not connect to an Apple Cash API,
send money or read the actual Wallet balance. Apple Cash purchases come out of the
child's Savings. If Savings is short, the missing amount is added automatically
as money received from the grown-up, who gets a note. Allowance is recorded
straight into Savings and Spending on schedule.
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

## Savings and manual purchases

Use **Allowance → Send money** to record money you gave your child. It credits
Savings immediately and notifies the child. The kid can record the same payment
in **My money → Received**; coordinate so only one person records each payment.
These forms accept $0.01–$500 and an optional note up to 60 characters.

The child can use **My money → Spent → Paid with → Apple Cash** (the default) to
record a purchase manually, or choose **Spending money** for that account. Apple
Cash may exceed Savings: the shortfall is added just before the full purchase,
leaving Savings at $0.00. Spending money purchases still require enough Spending.
Avoid manually logging any purchase the automation already recorded: manual
entries cannot be automatically matched to a Shortcut entry. Manual Spent,
Received and Send money forms generate a UUID `clientId` on opening and reuse it
on retries. The kid is warned about the same kind and amount within two minutes.
Apple Cash entries are tagged in Recent, parent Transactions and Apple Cash activity.

Every purchase records `savings → merchant`, kind `wallet_spend`. A shortfall posts
a `received` credit first, source `auto_cover`, note “Added to cover an Apple Cash
purchase”. The parent gets one cover notice per purchase. Purchases above the
limit still record and notify; G4 also flags unusual spending. No approval hold.

| HTTP response | Meaning |
| --- | --- |
| 200 `{recorded:true,covered:N,...}` | Recorded, including retries. `covered` is the shortfall added in cents (0 when Savings covered it). Reuse the original external ID on retry. |
| 429 `{error,retryAfterSeconds}` | Wait for `Retry-After`, then retry the original body and external ID. No purchase posted for this rejected request. |

The old funding top-up, Apple Cash send and pending record/dismiss routes return
410. Existing waiting receipts are recorded automatically from Savings during
migration. Historical transactions keep their original labels.
