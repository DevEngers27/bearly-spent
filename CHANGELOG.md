# Changelog

All notable changes to MoneyQuest are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Each entry names the review trail:
every batch was implemented by Codex, reviewed by Gemini, and verified and
merged by Claude (see `docs/VERSIONING.md`).

## [Unreleased]

### In progress (branches)
- `wave2` — real accounts: SQLite storage, email+password parents, kid link
  codes, PIN lockout, multi-child, per-family SSE, rate limits, security
  headers (`fix/b5a-accounts-server`, merged into `wave2`; client in
  `fix/b5b-accounts-client`).
- `feat/f36-trip-and-talk` — surprise trips (the bear picks a random open
  destination, a wooden sign and countdown while away, a postcard reveal on
  return) and talking to the bear instead of a chat box.
- `feat/f5-bear-fit` — accessory anchors tuned per pose.

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

[Unreleased]: https://github.com/DevEngers27/moneyquest/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/DevEngers27/moneyquest/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DevEngers27/moneyquest/releases/tag/v0.1.0
