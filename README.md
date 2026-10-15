# ziplime Ops Console

**Live demo: https://ziplime-ops-console.vercel.app** (static build, sample data, no database, no API key)

**Built on [ziplime PR #39](https://github.com/Limex-com/ziplime/pull/39)**, the dry-run mode for Lime live trading.

An unofficial concept: an ops layer for ziplime's Lime dry-run mode, built on [PR #39](https://github.com/Limex-com/ziplime/pull/39) (issue #5, branch `feat/dry-run-orders`). All data is sample data. Accounts, names, emails and tickets are fictional.

Open `/` and press **Take the 3-minute tour**. Five steps, one sentence each, on the real pages: a refused order and its fix, an account on watch, the guard blocking a risky draft, a Beta signup triaged and approved, and an automation run. Arrow keys move, Escape pauses, and the tour resumes from the front page or the rail.

- **Client portal**: a trader opens a dry-run file and sees which orders would have gone out, which were refused or skipped, and why, on the 09:30 to 16:00 ET clock.
- **Ops CRM**: the Limex team sees account health, triages Beta signups, answers support tickets with drafts grounded in the account's own file, and runs automation rules.
- **People decide**: nothing counts as sent and no account is created until a person clicks Approve, and a guard blocks approval while the text promises returns, gives investment advice or mentions another client.
- **A real integration path**: a forwarder next to the engine sends new dry-run lines to a signed webhook, the console stores them in Postgres (Supabase), and approving a signup issues that trader's ingest key. Without a database it is the static demo, unchanged.

How it was built with AI, and how each part was checked: [docs/HOW_I_BUILT_THIS.md](docs/HOW_I_BUILT_THIS.md), also at `/about`.

![Front door](docs/screenshots/front-dark.png)

## How it connects to the dry-run feature

With `LimeTraderSdkExchange(dry_run_file=...)`, every order still goes through lot rounding, the fail-closed `ZIPLIME_*` risk limits, the order deadline and Lime's `validate_order`, and is then appended to a JSON Lines file instead of reaching `place_order`. The file has four events: `place`, `refuse`, `skip` and `cancel`.

This console only reads that file:

- `src/lib/dryrun/parse.ts` parses it defensively. A malformed line is reported with its line number and the rest still loads. Unknown fields are kept, so a newer engine version doesn't break it.
- `src/lib/dryrun/explain.ts` maps every refusal string the engine can write (copied from `lime_trader_sdk_exchange.py`) to a plain explanation: what happened, which setting fired, what to change. It's deterministic. Claude is asked only about a reason that matches no rule, such as an unfamiliar message from Lime's `validate_order`.
- `src/lib/dryrun/metrics.ts` computes net shares and the six "Ready to go live?" checks. `src/lib/health.ts` computes account health.

Nothing here imports, edits or installs into `../ziplime`.

## Integration: from the engine to the console

```
 trader's machine                                    the console
 ----------------                                    -----------
 ziplime, dry run                                    POST /api/ingest/{deployment}
   dry_run_file="run/x.jsonl"                          HMAC-SHA256 of "<timestamp>.<body>", 5 min window,
        | appends one line per order event             1 MB cap, per-line results, same batch twice = replay
        v                                                     |
 run/x.jsonl  --new lines-->  forwarder  --signed batch-->    v
                              (Python, stdlib;          Postgres: dry_run_events (every line, accepted or
                               remembers its offset,     rejected), sessions, ingest_batches, audit_log, ...
                               retries with backoff)     row-level security; keys in a private schema
                                                              |
                                                              v
                                                        one data interface (lib/data) -> every page
                                                        static seed when there is no database
```

- **Two data sources behind one interface** (`src/lib/data`): the bundled seed, and Postgres when `DATABASE_URL` is set at build time. A contract suite runs the same checks on both; the database must give back every seed file byte for byte. The database rebuilds each file from its stored lines, so the one parser the console has gives the same events and line numbers.
- **Schema and RLS** in `supabase/migrations/`, plain Postgres: foreign keys everywhere, per-event check constraints, `unique (deployment_id, content_hash)`. A trader reads only their own rows, ops reads all, `anon` gets nothing, and the app's own page reads go through RLS as ops.
- **The webhook** (`openapi.yaml`): an unknown deployment gets the same 401 as a bad signature; batches for one deployment run under a row lock; a bad line never blocks the good ones.
- **The forwarder** (`forwarder/ziplime_forwarder.py`): reads only complete lines, signs, retries 429 and 5xx, rewinds on a gap, and saves its place only after a 200.
- **Onboarding**: in database mode, approving a signup creates the account, a first deployment and a 32-byte ingest key, shown once with the exact commands. The account page shows every batch and every rejected line.
- **Database mode is private**: the whole console sits behind HTTP Basic auth (`OPS_PASSWORD`), except the signed webhook.

The plan, its review (17 findings, two blockers, all fixed before code) and what changed while building are in `PLAN.md` section 15.

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

The key stays on the server. Three routes use it: `/api/explain`, `/api/draft` and `/api/triage`. They take only JSON from the console's own origin, so another site can't make a signed-in reviewer's browser spend tokens. `/api/ai-status` reports only whether AI is on and, if not, why.

A static build has no sign-in, so served by anything but `npm run dev` (Vercel, `npm start`, Docker) it counts as the public demo and keeps AI off even with a key set (`src/lib/ai/access.ts`). Database mode sits behind Basic auth and is not affected. `ZIPLIME_ALLOW_PUBLIC_AI=true` overrides that. Don't set it unless you accept that anyone on the internet can spend the key. Each prompt carries one account's or one signup's data. `/api/draft` looks up the linked dry-run lines server side, in that account's own files.

### With a database

No Supabase CLI or Docker is needed locally: PGlite runs real Postgres inside Node and applies the same migrations.

```
DATABASE_URL=pglite:.data/dev OPS_PASSWORD=$(openssl rand -hex 16) npm run dev
```

Sign in with any user name and that password. The database is created, migrated and seeded on first open; `.data/` is git-ignored because it holds ingest keys. For a real Supabase project, see [docs/PUBLISH.md](docs/PUBLISH.md) (`supabase db push`, then `npm run db:seed`).

State lives in `localStorage` (`ziplime-ops-console:v1`, `ziplime-ops-console:v1:database` in database mode, and `ziplime-ops-console:tour` for the tour). **Reset demo** in the rail clears it. Opened `.jsonl` files stay in memory for the tab and are never uploaded.

Keyboard: `?` shows every shortcut. `t` starts or resumes the tour, `g` then a letter opens a page (`r` review, `a` accounts, `i` intake, `s` support inbox, `u` automations, `h` front page), `j` and `k` move through list rows, `/` focuses the page's search. Shortcuts never fire while you type.

## Tests

```
npm test               # vitest: 468 tests in 26 files, 2 skipped on purpose (one needs a real Postgres); about 15 s. Run it on every change.
npm run test:full      # the same, with the old-versus-new ingest store on all 200 streams, not 20, and the property tests on a fresh random seed (printed; replay with FUZZ_SEED=<n>). Run it before a merge or after touching src/lib/ingest/store.ts.
npm run test:forwarder # pytest: 23 forwarder tests
npm run test:link-check # node --test: 37 offline tests for tools/link-check (fixtures, no network)
npm run test:e2e       # Playwright over the production build, desktop and a 390 px phone: 78 tests (9 run on one size only)
npm run test:ingest    # the end-to-end ingest test on a fresh database: 2 tests
npm run bench:ingest   # what one 500-line webhook batch costs at 0, 10,000 and 19,500 stored lines
npm run lint && npm run typecheck && npm run build
```

What they cover:

- **Parser**: malformed lines, wrong types, CRLF, BOM, DST, cancels across sessions, and dates Postgres would refuse (it used to read 30 February as 2 March).
- **Seed files, explanations, health and readiness, the guard, intake triage, approve flows, automations, the tour and shortcuts**: each against the real seed. Every seed file parses and matches the manifest; every engine message has an explanation; every tour sentence still matches the data.
- **Schema and RLS** (`src/lib/db/schema.test.ts`): a trader sees only their rows in every table, ops sees all, no claims sees nothing, `anon` has no privilege, keys can't be read, writes are refused, and a sanity test fails when RLS is off.
- **Contract** (`src/lib/data/contract.test.ts`): the same checks on the static source and on PGlite seeded through the ingest path.
- **Ingest** (`src/lib/ingest/ingest.test.ts`): the shared signature vector, strict headers, every line outcome, replay, gap, each refusal, no internals in a 500, no secret in the audit log. A concurrency test runs when `TEST_DATABASE_URL` points at a real Postgres.
- **Ingest store, old against new** (`src/lib/ingest/store.diff.test.ts`): the store before 14 Oct 2026 and the current one on 20 random streams in `npm test` and 200 in `npm run test:full` (out of order, overlaps, replays, gaps, holes filled later, late cancels, rejected lines). After every batch both databases must match row for row and return the same response, and a 10-line batch on 2,000 stored lines must read under 100 rows.
- **The guard against real phrasings** (`src/lib/guard.corpus.test.ts`): 34 kinds of advice and return promises it must catch, 23 support sentences it must pass, and every text the console writes itself, which must never trip it.
- **Browser checks beyond the walk-through**: axe on every page in both themes (`e2e/a11y.spec.ts`), the Content-Security-Policy with zero violations on every page (`e2e/csp.spec.ts`), and the build's traced files (`e2e/trace.spec.ts`).
- **Property tests** (`*.fuzz.test.ts`, fast-check, 1,000 runs each, a fixed seed in `npm test`): `parseDryRun` never throws on any text and puts every error on a line inside the file; the ingest webhook never answers 500 for any body, headers or signature, and every line it calls accepted or rejected is in the database; every guard hit slices back out of the original text. They found one bug: a NUL character or half a surrogate pair in a batch made Postgres refuse the write and the webhook answer 500. `forwarder/test_forwarder_properties.py` does the same for `read_lines` (a seeded loop always, hypothesis too when installed): only complete lines, never a split character.
- **Link check** (`tools/link-check/lib.test.mjs`): link extraction, robots.txt rules, the moved-page guess, the Discord invite check, soft 404s and a whole offline run. How the tool works: `tools/link-check/README.md`.
- **Onboarding and ops auth**: one key per approval, 409 the second time, the server-side guard, key rotation, Basic auth, same-origin, JSON only.
- **Forwarder** (`forwarder/test_forwarder.py`, against a real local HTTP server): batching by lines and bytes, the held-back half line, resume, retry with the same body, no retry on 401, gap rewind, rotation (with a warning naming the old file's unsent bytes), a shrunk file, a private secret file.
- **End to end** (`e2e-ingest/ingest.spec.ts`): the real seed generator writes a file from the engine, a signup is approved in the UI, the real forwarder sends the file, and the account page and every portal session match counts taken from the file with plain `JSON.parse`. Then: a second run sends nothing, a resend stores nothing, a tampered signature and an old timestamp get 401, a malformed line is rejected and shown, `data/seed` is untouched. It passed three runs in a row, each on a new database.

The Playwright smoke test walks through:

1. Portal, plus an upload with a malformed line.
2. CRM.
3. Approving a signup into an account.
4. A flagged draft that can't be approved, then a template reply that can.
5. Running the rules twice.
6. Reload and reset.
7. A check that no page scrolls sideways.

The other specs cover the tour end to end by keyboard (pause, resume, the card's Approve and Run buttons, a page that jumps to the top on its own, the visitor's own scroll), shortcuts, page titles, the icon and share image, security headers, empty states, layout shift on every page, reduced motion, the rail's full height and the phone tab bar at a real 390 px viewport.

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
| `/about` | anyone | How this was built and verified: `docs/HOW_I_BUILT_THIS.md` itself |

Night, the default theme, at 1440 px:

| | |
|---|---|
| ![Dry-run review](docs/screenshots/portal-dark.png) | ![Account detail](docs/screenshots/account-dark.png) |
| ![Accounts](docs/screenshots/accounts-dark.png) | ![Beta intake](docs/screenshots/intake-dark.png) |
| ![Support inbox](docs/screenshots/inbox-dark.png) | ![Automations](docs/screenshots/automations-dark.png) |
| ![Tour, step 1](docs/screenshots/tour-refusal-dark.png) | ![Tour, step 2](docs/screenshots/tour-watch-dark.png) |
| ![Tour, step 3](docs/screenshots/tour-guard-dark.png) | ![How I built this](docs/screenshots/about-dark.png) |
| ![Link preview](docs/screenshots/og.png) | |

Day:

| | |
|---|---|
| ![Front door, day](docs/screenshots/front-light.png) | ![Dry-run review, day](docs/screenshots/portal-light.png) |
| ![Account detail, day](docs/screenshots/account-light.png) | ![Support inbox, day](docs/screenshots/inbox-light.png) |

Database mode:

| | |
|---|---|
| ![The one-time ingest key after approving a signup](docs/screenshots/onboarding-key-dark.png) | ![Ingest batches and a rejected line](docs/screenshots/account-ingest-dark.png) |
| ![Ingest, day](docs/screenshots/account-ingest-light.png) | |

Phone, 390 px:

| | | |
|---|---|---|
| ![Front door on a phone](docs/screenshots/front-phone-dark.png) | ![Portal on a phone](docs/screenshots/portal-phone-dark.png) | ![Inbox on a phone](docs/screenshots/inbox-phone-dark.png) |
| ![Tour step 3 on a phone](docs/screenshots/tour-guard-phone-dark.png) | ![Ingest on a phone](docs/screenshots/account-ingest-phone-dark.png) | ![Front door on a phone, day](docs/screenshots/front-phone-light.png) |

`docs/screenshots` has every page and tour step in both themes at both sizes. `node scripts/screenshots.mjs static <url>` retakes them against a running build, and `node scripts/screenshots.mjs db <url> <OPS_PASSWORD>` retakes the database-mode ones against a fresh `pglite:` dev server.

## Design

`DESIGN.md` is the direction: the console should read as part of the ziplime product family. Its tokens were measured from ziplime.limex.com on 14 Oct 2026: a pure black ground with a faint dot grid, #F2F0FF ink, lime #A6F656 only for the primary action, the current page, focus and one headline word, and cyan #4DCFE7 only for the Doto dot-matrix word. Headlines are uppercase General Sans, data and labels JetBrains Mono, body Inter. Corners are square, borders 1 px. Night is the default theme; day works too. `src/lib/design/contrast.test.ts` checks every text and status colour for WCAG AA on all three backgrounds in both themes.

It never borrows Limex's or ziplime's logo or wordmark: the mark is the console's own (three session-clock ticks) with "ziplime ops console" in lowercase mono. General Sans comes from Fontshare under the ITF Free Font License, which allows self-hosting but not redistribution through a public repository, so `scripts/fetch-fonts.mjs` downloads it (SHA-256 pinned) before every build instead of the files living in git.

Motion has a job or doesn't happen: the hero terminal types one real engine line and its explanation once, the ticker scrolls real seed events slowly and pauses on hover, focus or its button, the Doto word flickers in once, clock marks draw in time order, KPIs count up once, guard hits sweep in one by one, approvals flash once, and pages fade in 160 ms. Reduced motion shows the final state of every one of them.

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
- **The guard is a phrase check, not a compliance system.** The UI says that wherever it runs. Until 14 Oct 2026 it caught only the textbook forms and let 24 of 25 everyday phrasings through; `guard.corpus.test.ts` now holds the phrasings it must catch and the support sentences it must pass. A phrasing not in that list can still get past it, which is why a person approves every reply.

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
- **No real Supabase project.** The migrations, RLS and the whole integration run on PGlite, which is real Postgres; two checks only a hosted project can answer are in `docs/PUBLISH.md`.
- **Concurrency on a real Postgres.** The row lock that keeps batches for one deployment apart can't be shown on PGlite, which runs one connection; that test is skipped without `TEST_DATABASE_URL`.
- **Only the static demo is deployed.** The live demo runs with no database and no API key, so the integration, onboarding and Claude paths are not live anywhere. `docs/PUBLISH.md` has the commands for an optional private deployment with a real Supabase project.
