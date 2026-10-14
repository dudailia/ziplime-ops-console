# ziplime Ops Console

An unofficial concept: an ops layer for ziplime's Lime dry-run mode, built on [PR #39](https://github.com/Limex-com/ziplime/pull/39) (issue #5, branch `feat/dry-run-orders`). All data is sample data. Accounts, names, emails and tickets are fictional.

Open `/` and press **Take the 3-minute tour**. Five steps, one sentence each, on the real pages: a refused order and its fix, an account on watch, the guard blocking a risky draft, a Beta signup triaged and approved, and an automation run. Arrow keys move, Escape pauses, and the tour resumes from the front page or the rail.

- **Client portal**: a trader opens a dry-run file and sees which orders would have gone out, which were refused or skipped, and why, on the 09:30 to 16:00 ET clock.
- **Ops CRM**: the Limex team sees account health, triages Beta signups, answers support tickets with drafts grounded in the account's own file, and runs automation rules.
- **People decide**: nothing counts as sent and no account is created until a person clicks Approve, and a guard blocks approval while the text promises returns, gives investment advice or mentions another client.

![Front door](docs/screenshots/front-dark.png)

## How it connects to the dry-run feature

With `LimeTraderSdkExchange(dry_run_file=...)`, every order still goes through lot rounding, the fail-closed `ZIPLIME_*` risk limits, the order deadline and Lime's `validate_order`, and is then appended to a JSON Lines file instead of reaching `place_order`. The file has four events: `place`, `refuse`, `skip` and `cancel`.

This console only reads that file:

- `src/lib/dryrun/parse.ts` parses it defensively. A malformed line is reported with its line number and the rest still loads. Unknown fields are kept, so a newer engine version doesn't break it.
- `src/lib/dryrun/explain.ts` maps every refusal string the engine can write (copied from `lime_trader_sdk_exchange.py`) to a plain explanation: what happened, which setting fired, what to change. It's deterministic. Claude is asked only about a reason that matches no rule, such as an unfamiliar message from Lime's `validate_order`.
- `src/lib/dryrun/metrics.ts` computes net shares and the six "Ready to go live?" checks. `src/lib/health.ts` computes account health.

Nothing here imports, edits or installs into `../ziplime`.

### Where the seed files come from

`scripts/generate_seed.py` runs the real engine. It imports `LimeTraderSdkExchange` from `../ziplime` and the test suite's fake Lime client (`FakeAsyncLimeClient`), builds one exchange per session with each deployment's risk profile, and submits orders. Every line in `data/seed/dryruns/*.jsonl` was written by the engine itself. No real credentials are used, and nothing runs live.

**One thing in the seed run is not real: the clock.** The script replaces the exchange module's `datetime` with a shim whose `now()` returns the simulated bar time plus a few milliseconds. Without it, every `recorded_at` would be the time the script ran, cancels couldn't sit on the session clock, and the order-deadline scenario couldn't happen. Everything else is the engine's own code path.

The commit the seed ran against is recorded in `data/seed/manifest.json` (`f67e372`, branch `feat/dry-run-orders`). Reruns produce byte-identical files.

```
npm run seed    # PYTHONDONTWRITEBYTECODE=1 ../ziplime/.venv/bin/python scripts/generate_seed.py
```

## Run it

```
npm install
npm run dev          # http://localhost:3000
```

Claude is optional. Without `ANTHROPIC_API_KEY` the app works fully: the UI says "AI drafting is off", support replies use a template built from the same facts, and intake uses the rules triage. To turn it on:

```
ANTHROPIC_API_KEY=... npm run dev
ANTHROPIC_MODEL=claude-sonnet-5-5   # optional; this is the default
```

The key stays on the server. Three routes use it: `/api/explain`, `/api/draft` and `/api/triage`. `/api/ai-status` reports only whether a key is set. Each prompt carries one account's or one signup's data. `/api/draft` looks up the linked dry-run lines server side, in that account's own files.

State lives in `localStorage` (`ziplime-ops-console:v1`, and `ziplime-ops-console:tour` for the tour). **Reset demo** in the rail clears it. Opened `.jsonl` files stay in memory for the tab and are never uploaded.

Keyboard: `?` shows every shortcut. `t` starts or resumes the tour, `g` then a letter opens a page (`r` review, `a` accounts, `i` intake, `s` support inbox, `u` automations, `h` front page), `j` and `k` move through list rows, `/` focuses the page's search. Shortcuts never fire while you type.

## Tests

```
npm test             # vitest: 233 tests
npm run test:e2e     # Playwright over the production build, desktop and a 390 px phone: 26 tests (3 run on one size only)
npm run lint
npm run build
```

The vitest suite covers:

- **Parser**: malformed lines, wrong types, CRLF, BOM, DST, cancels across sessions.
- **Seed files**: every one parses cleanly and matches the manifest.
- **Explanations**: every engine message is mapped, and the regexes are anchored.
- **Readiness and health**: each threshold at its boundary, plus the expected colour for every seeded account.
- **Guard**: each category, word boundaries, other-client identifiers, and the intake-only checks.
- **Intake triage**: per persona, broker tags and priority.
- **Approve flows**: exactly one account per signup; nothing sent while the guard flags the text.
- **Automations**: the second run only skips, and only Harbor Lane is ready for a live review.
- **Tour**: the reducer, the saved state (a reload mid-tour comes back paused), and that every tour sentence still matches the seed.
- **Shortcuts**: the keymap and list movement.
- **Front door**: the three numbers, from the seed.

The Playwright tests run without an API key. The smoke test walks through:

1. Portal, plus an upload with a malformed line.
2. CRM.
3. Approving a signup into an account.
4. A flagged draft that can't be approved, then a template reply that can.
5. Running the rules twice.
6. Reload and reset.
7. A check that no page scrolls sideways.

The other specs cover the tour end to end by keyboard (pause, resume, the card's Approve and Run buttons), shortcuts, page titles, the icon and share image, empty states, layout shift on every page, reduced motion, the rail's full height and the phone tab bar at a real 390 px viewport.

## Pages

| Route | Who | What |
|---|---|---|
| `/` | anyone | What this is, a real session from the seed, three numbers from the seed, the tour |
| `/portal` | trader | Session strip, session clock, counts, why orders didn't go out, order tape, net shares, readiness checklist, open a `.jsonl` file |
| `/ops` | Limex team | Accounts with health in words, sortable and filterable |
| `/ops/accounts/[id]` | Limex team | Health reasons, history chart, deployments and risk profiles, tickets, plan, activity |
| `/ops/intake` | Limex team | Beta intake queue: rules triage, optional Claude triage, guarded welcome email, approve into the CRM |
| `/ops/inbox` | Limex team | Tickets linked to real orders, template or Claude drafts, guard, approve |
| `/ops/automations` | Limex team | Four rules with on/off, Run rules now, run log |

| | |
|---|---|
| ![Dry-run review](docs/screenshots/portal.png) | ![Tour, step 2](docs/screenshots/tour-amber.png) |
| ![Accounts](docs/screenshots/accounts.png) | ![Account detail](docs/screenshots/account.png) |
| ![Beta intake](docs/screenshots/intake.png) | ![Support inbox](docs/screenshots/inbox.png) |
| ![Automations](docs/screenshots/automations.png) | ![Dark mode](docs/screenshots/portal-dark.png) |
| ![Tour, step 1](docs/screenshots/tour-refusal.png) | ![Tour, step 3](docs/screenshots/tour-guard.png) |
| ![Front door, light](docs/screenshots/front-light.png) | ![Link preview](docs/screenshots/og.png) |

Phone, 390 px:

| | | |
|---|---|---|
| ![Front door on a phone](docs/screenshots/front-phone.png) | ![Portal on a phone](docs/screenshots/portal-phone-dark.png) | ![Inbox on a phone](docs/screenshots/inbox-phone.png) |

## Design

`DESIGN.md` is the direction: a trading desk's back office, dense but calm, one lime accent for "where you are and what to do next", tabular numbers, and colour reserved for meaning. Motion has a job or doesn't happen: clock marks draw in time order, KPIs count up once, tape rows settle, guard hits sweep in one by one, approvals flash once, and pages fade in 160 ms. Reduced motion keeps short fades and drops all movement. The mark is the console's own (three session-clock ticks), not a Limex logo.

## Sources and decisions

- **Plans**: `src/lib/plans.ts` is the one place plan names live. It matches what limex.com's pricing section showed on 2026-10-13 at 15:03 ET: Beta at $0 ("Full access during the US beta", "No card required"), and Bronze, Silver and Gold locked, "Coming soon. Available after beta", with no prices. Every seeded account is on Beta, and no prices are invented.
- **Beta intake form**: the signups mirror the row limex.com's early-access form posts (checked 2026-10-13, 15:30 ET):
  - an email;
  - four optional multi-select questions;
  - the Trading Pod toggle.

  The free-text `note` is a proposed field that limex.com doesn't have, and the UI labels it so.
- **Brokers**: the six that limex.com lists as connected via SnapTrade. A broker is tagged `stated`, `inferred` or `unknown`; the form never asks.
- **Workspace names**: placeholders, because limex.com doesn't list its Workspaces yet. The UI says so.
- **Health and readiness use the same window**: each deployment's last 5 sessions (`RECENT_SESSIONS`), health as of the manifest's `asOf` (2026-10-12) so the colours don't drift. With readiness on 3 sessions, Jonas Weber's breakout passed "no recent refusals" in the portal while the CRM had it on watch for the same refusals; now both agree.
  - **Needs help**: 20% or more of orders refused, or 2 or more Lime rejections.
  - **Watch**: 5% or more refused, 1 Lime rejection, a stale run, `validate_orders=False`, or a reason with no built-in explanation.
- **The guard is a phrase check, not a compliance system.** The UI says that wherever it runs.

## Demo script (3 minutes)

The tour is the demo. Open `/` and talk over it.

1. **Front door (20 s).** "ziplime's dry run sends every order through the live checks and writes it to a file. This console reads those files." Point at the clock: a real session from the engine. Then the numbers: 487 orders, 69 refused, 5 of 10 accounts need help. Press **Take the 3-minute tour**.
2. **A refused order (40 s).** The tour opens Priya Raman's 11:09 TSLA refusal. The explanation names `ZIPLIME_ALLOWED_SYMBOLS` and what it allows. Scroll to "Ready to go live?": 3 of 6 checks pass, with the evidence. Press the right arrow.
3. **An account on watch (20 s).** Jonas Weber: 11% refused over the last 5 sessions, said in words, not just a colour.
4. **The guard (40 s).** Sofia's seeded draft says "guaranteed", "you should buy" and names another client. Each phrase is highlighted and Approve is off. Optional, off tour: Insert template reply, the guard passes, Approve and send.
5. **Beta intake (30 s).** will.tanaka is high priority by rule: a funded account and a Trading Pod question. Press **Approve will.tanaka** on the card: the real Approve button runs and the CRM account exists.
6. **Automations (30 s).** Press **Run rules now** on the card. Tickets open for three refusal streaks, Sofia's Lime rejection and Nadia's stale run are noted, and Harbor Lane is flagged for a live review that a person decides. Run it again: everything skips. Press Finish.

Leftover time: `?` for shortcuts, the theme toggle, or drop a `.jsonl` file with a broken line on the portal.

## Not verified

- **The Claude paths have not been run against the live API.** No key was available while building, so the three routes are exercised only in their "AI drafting is off" state. The request shapes follow `@anthropic-ai/sdk` 0.133 (`output_config.format` with a JSON schema for triage). Run each once with a key before relying on them.
- **No deployment.** Nothing has been pushed or deployed.
