# How I built this

## What I built and why

ziplime, Limex's open-source engine, had an open issue (#5) asking for a dry run that writes orders to a file instead of sending them to the broker. I built it with Claude Code as PR #39 to Limex-com/ziplime: every order still goes through lot rounding, the fail-closed risk limits, the deadline and Lime's `validate_order`, then goes to a JSON Lines file instead of `place_order`. This console reads those files: a portal that tells a trader why an order didn't go out, and a CRM where the Limex team sees who needs help. Its sample data is the engine's own output, made with the test suite's fake Lime client, so nothing uses real credentials or trades live. The last stage connects the two: a forwarder next to the engine sends new lines to a signed webhook, and the console stores them in Postgres.

## How I worked with AI

Claude Code wrote most of the code, from plans I approved. Each stage was a plan in `PLAN.md`, then code, tests and the production build, then a commit: 2 commits on the ziplime branch, 31 here. For the integration layer I was away, so a separate Claude Code session reviewed the plan as a strict senior engineer; its 17 findings, two of them blockers, were fixed before any code (`PLAN.md` 15.10).

## How I verified it

- **PR review by a separate Claude Code session acting as a strict maintainer.** It found that deduplicating ids in `get_orders_by_ids` changed the live path, and that a failed write on a below-one-lot skip escaped silently. Each got a failing test, then a fix (`f67e372b`).
- **Seed from the real engine.** Regenerating gives byte-identical files (checked again by regenerating all 14 and diffing), and `seed.test.ts` checks each file against the manifest.
- **Reading the engine caught a wrong fix.** The refused-sell explanation first said to set `ZIPLIME_ALLOW_SELL=true`, which `_load_order_risk_limits` refuses under the fail-closed profile. It now says to make the strategy buy-only, and a test holds it.
- **limex.com facts checked on the live site.** The brief named four plan tiers; the site shows Beta at $0 and locked Bronze, Silver and Gold, so the console uses those. The intake mirrors the real signup form's fields, and the one extra field is labeled as proposed.
- **Screenshot review by a second reviewer** found the sidebar stopping short and readiness using 3 sessions where health used 5 (`b31b5d9`).
- **The integration end to end.** One contract suite runs on both data sources and needs every seed file back byte for byte. The ingest test runs the real generator and forwarder and compares the console with counts taken by plain `JSON.parse`, three runs in a row on new databases.

## What AI got wrong, and how it was caught

- Live `get_orders_by_ids` behaviour changed by the patch: the PR review, then a failing test.
- A failed skip write escaped silently: the same review, then a failing test.
- A fix that would have told traders to enable sells: reading the engine's risk-limit code.
- "Refused orders count toward the order limit": wrong; reading `_order_attempt_count` showed which checks run before the counter (`PLAN.md` 14).
- The plan expected Nadia Haddad to be amber: the health rule, run on the generated files, said red, and the rule was right (`PLAN.md` 14).
- The sidebar height and the 3 versus 5 session mismatch: screenshot review.
- A React hydration error after saved state loaded, in the production build only: the Playwright smoke test (`dececad`).
- A flaky tour test: a scroll trace under CPU throttling showed Next.js resetting the scroll on a slow navigation (`3c099d8`).
- The first integration plan would have shown every account to anonymous visitors in database mode, and had no lock for concurrent batches: the plan review.
- The parser read 30 February as 2 March: matching the parser to what Postgres accepts (`a00727c`).
- The forwarder's batch size left out the body's own fields: its batch-by-bytes test.
- Rows came back in the wrong order because PGlite's clock ties within a millisecond: the contract test.

## What I would do differently

- Put the data interface in from the first commit. Adding it later changed 48 files in one commit and needed a before-and-after capture of every page to prove the demo didn't change.
- Run the tests against a real Postgres as well as PGlite. The concurrency test that matters most for the webhook is skipped here.
- Query per page instead of loading the whole dataset on every request, before there are more than a few dozen accounts.

## Numbers

Counted when this page was written.

| | |
|---|---|
| Commits | 31 here, 2 on ziplime's `feat/dry-run-orders` |
| Unit and integration tests (vitest) | 326 in 19 files, 2 skipped on purpose (one needs a real Postgres) |
| Browser tests (Playwright) | 36 in the main suite (3 skipped by design), 2 in the ingest suite |
| Forwarder tests (pytest) | 19 |
| ziplime dry-run tests | 13 test functions in `test_lime_dry_run.py` |
| Seed data | 503 dry-run lines written by the engine, 14 deployments, 135 sessions, 10 accounts, 30 signups, 7 tickets |
| Pages | 8 |
