# Apple Cash savings flow

User request: purchases paid using the child’s Apple Cash automatically reduce the app balance; the child manually records money received from a parent.

Implementation uses Savings as that balance. Keep Spending and parent Funding separate. A configured iPhone Transaction Shortcut reports purchases to the existing spend endpoint. Add a child-authorized receive endpoint and a Received form; money already received outside the app credits Savings without another parent debit. Preserve durable idempotency for purchases and received entries, never allow negative balances, retain short receipts and retry them after received money. Preserve historical transactions and existing approval/allowance behavior. Update Buddy, parent/child copy, API docs, and regression coverage.

Verification: server and client suites, build, dispatch tests with child Bearer credentials, persistence and sibling isolation, actual local HTTP flow and browser at phone width. This branch remains separate from main for the review process in VERSIONING.md.

## Verification results

- Server: 375 tests passed, including received-money idempotency after SQLite reload, input validation, sibling isolation, pending-receipt settlement and Savings-based goal recalculation.
- Client: 223 tests passed, including the Received form and stable request ID on retry.
- Production Vite build passed.
- Live local HTTP check passed: receive $20 → spend $4.25 → receive $10 → queue $30 purchase → receive $5 → settle to $0.75. Replayed purchase and receipt IDs did not change the balance. Parent Funding and Spending stayed at zero.
- Browser smoke reached the new five-tab My money sheet at 390 × 844. The next UI action was blocked because automatic approval review reached its usage limit; the Received form still needs visual acceptance on a phone.
- Independent Gemini review and Claude verification/merge from VERSIONING.md remain pending; this implementation is not merged or deployed.
