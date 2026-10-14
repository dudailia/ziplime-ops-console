# ziplime Ops Console: plan

A Next.js app that shows what Limex could run on top of the ziplime dry-run feature (issue #5, branch `feat/dry-run-orders`; the commit the seed ran against is recorded in `data/seed/manifest.json`). A trader sees why their strategy would or would not have traded. The Limex team sees which accounts need help, and answers them with drafts grounded in the account's own dry-run file.

Nothing in this project imports, edits or installs into `../ziplime`. The seed script only runs it.

## 1. The file, as the engine writes it

Read from `_write_dry_run_record`, `_dry_run_order_fields`, `_record_dry_run_order`, `submit_order` and `cancel_order` in `lime_trader_sdk_exchange.py`, and from `test_lime_dry_run.py`.

Every line is one JSON object, keys sorted, terminated by `\n`, fsynced. Common fields on every line:

| field | type | note |
|---|---|---|
| `event` | `"place" \| "refuse" \| "skip" \| "cancel"` | |
| `recorded_at` | ISO-8601 UTC, microseconds | wall clock when written |
| `account` | string or `null` | masked: `de***nt`; `****` if 4 chars or fewer; `null` if no account id was set |

Per event:

| event | fields beyond the common ones |
|---|---|
| `place` | `dry_run_id` (`dryrun-` + client_order_id), `ziplime_order_id`, `order_dt`, `symbol`, `requested_amount` (float, signed, after lot rounding), `client_order_id`, `side` (`buy`/`sell`), `quantity` (string, unsigned), `order_type` (`market`/`limit`), `limit_price` (string or `null`), `time_in_force`, `route`, `broker_validated` (bool) |
| `refuse` | `ziplime_order_id`, `order_dt`, `symbol`, `requested_amount` (signed, after rounding), `reason` (`"<ExceptionType>: <message>"`) |
| `skip` | `ziplime_order_id`, `order_dt`, `symbol`, `requested_amount` (signed, fractional, before rounding), `reason` (`"0.6 NVDA is below one lot (1 share); order not sent"`) |
| `cancel` | `dry_run_id` (the id that was cancelled; a plain broker id if `known_order` is false), `known_order` (bool), `symbol` (`null` when unknown). No `order_dt`. |

Facts the UI depends on:

- A refusal has no `side`, `quantity` or `order_type`. Side comes from the sign of `requested_amount`. The console never invents fields the file doesn't have.
- `quantity` and `limit_price` are strings (Decimal in the engine). Parse with `Number()` for display, keep the raw string for the raw-line view.
- A cancel has no `order_dt`. Its time on the session clock is `recorded_at` in ET. Its session is the session of the `place` it cancels, matched by `dry_run_id`; for an unknown order it falls back to `recorded_at`'s ET date.
- Dry-run orders never fill. "Net shares" is "what would have been sent", not a position. The UI says so next to the number.
- An OSError while writing a skip means the line is missing from the file. The console can't see that and won't claim to.

## 2. Parser (`lib/dryrun/parse.ts`)

`parseDryRun(text: string, source: string): ParsedFile`

```ts
type ParsedFile = {
  source: string;                 // file name or deployment id
  events: DryRunEvent[];          // valid lines, file order kept
  errors: { line: number; message: string; raw: string }[];
  sessions: Session[];            // grouped by ET trading date, ascending
  accounts: string[];             // distinct masked ids seen
};
```

- Split on `\n`, keep 1-based line numbers. Strip a trailing `\r`. Skip blank lines.
- `JSON.parse` in a try per line. A bad line becomes an error with its line number and the first 200 chars; parsing continues.
- Validate by event with a hand-written type guard (no schema library). Missing required field, wrong type, unknown `event`: error with the field named, line kept out of `events`.
- Unknown extra fields are kept on the event (`extra`), so a newer engine version doesn't break the console.
- A final line with no trailing newline still parses; it's flagged as a warning "last line has no newline (run may have been cut off)".
- Times: `order_dt` keeps its own offset. All clock math runs in `America/New_York` via `Intl.DateTimeFormat`, no date library.
- File size cap for uploads: 10 MB, checked before reading.

Tests (vitest): the real `../sample_dry_run.jsonl` copied in as a fixture; every event type; malformed JSON on line 3 of 5 still yields 4 events and one error at line 3; wrong types; unknown event; CRLF; empty file; no trailing newline; cancel matched to its place across sessions; cancel of unknown order; session grouping across DST (ET offset `-04:00` vs `-05:00`).

## 3. Reason to explanation (`lib/dryrun/explain.ts`)

Every refusal string the engine can write, taken from the source. Each rule: id, regex, title, what happened, which setting fired, what to change. Deterministic, no network.

| id | reason matches | setting | what to tell the trader |
|---|---|---|---|
| `allowlist` | `Lime order symbol '(X)' is not allowlisted` | `ZIPLIME_ALLOWED_SYMBOLS` | X isn't in the list. Add it, or set `*` to allow all. |
| `max-quantity` | `quantity exceeds the configured risk limit` | `ZIPLIME_MAX_ORDER_QUANTITY` | Shows requested shares vs the limit when the profile is known. Raise the limit or size down. |
| `sell-disabled` | `sell orders are disabled by the configured risk limits` | `ZIPLIME_ALLOW_SELL` | Must say the true thing: under `ZIPLIME_REQUIRE_ORDER_RISK_LIMITS=true` the engine refuses to start with `ZIPLIME_ALLOW_SELL=true`, because it can't yet prove a sell won't open a short. The fix is a buy-only strategy, or running without the fail-closed profile. |
| `notional` | `order notional exceeds` (limit orders) | `ZIPLIME_MAX_ORDER_NOTIONAL_USD` | quantity × limit price vs the cap. |
| `market-notional` | `market order notional exceeds` | `ZIPLIME_MAX_ORDER_NOTIONAL_USD` | Priced at the ask for buys, the bid for sells. |
| `no-quote` | `returned no current quote` / `carries no usable price` | notional cap needs a quote | Fail-closed: no quote, no market order. Use a limit order or retry later. |
| `max-orders` | `order count exceeds the per-invocation` | `ZIPLIME_MAX_ORDERS_PER_INVOCATION` | Counts attempts, refused ones included. |
| `bad-quantity` / `bad-limit` | `must be positive and finite` | none | Strategy bug: NaN, infinite or negative input. |
| `order-style` | `supports MarketOrder and LimitOrder only` | none | Stop and other styles aren't supported on Lime. |
| `deadline` | `order deadline expired before broker submission` | `ZIPLIME_ORDER_DEADLINE_UTC` | The signal went stale in the queue. Investigate latency, don't just move the deadline. |
| `deadline-config` | `invalid ZIPLIME_ORDER_DEADLINE_UTC` / `must include a timezone` | `ZIPLIME_ORDER_DEADLINE_UTC` | Config error. |
| `broker-validation` | `Lime rejected order during validation: (msg)` | `validate_order` | Lime's own pre-trade check said no. Known sub-messages (`insufficient buying power`, more as the seed shows them) get their own text. Any other `msg` is "known rule, unknown broker message". |
| `account` | `not available to these credentials` / `Several Lime accounts` / `no brokerage accounts` | `LIME_SDK_ACCOUNT_ID` | Credential or account selection problem. |
| `skip-lot` | `is below one lot` (event `skip`) | `LOT_SIZE = 1` | Not an error. Whole shares only; a rebalance asked for a fraction. |

Anything that matches no rule (for example a `ConnectionError` or an unrecognised broker message) shows "No built-in explanation" with an "Ask Claude" button. Server route `POST /api/explain` sends only the reason string, the event and the deployment's risk profile. Response is cached per reason in localStorage. Without a key the button reads "AI drafting is off" and the raw reason stays visible.

Tests: every row above against a real string from the seed; an unknown string returns `null`; the regexes are anchored so `market-notional` doesn't also match `notional`.

## 4. Derived numbers (`lib/dryrun/metrics.ts`)

- **Session**: one ET trading date. Counts per event, events in time order, place count, refusal rate = refuse / (place + refuse). Skips are excluded from the rate because the engine treats them as warnings, not failures.
- **Net shares per symbol**: sum of signed `quantity` over `place` events, minus the cancelled ones. Shown with "if every uncancelled order had filled".
- **Health** (`lib/health.ts`), over the last 5 sessions, against a fixed demo date (`asOf` in the seed manifest, so colours don't drift with real time):
  - red: refusal rate ≥ 20%, or 2+ broker-validation refusals, or any unexplained reason
  - amber: refusal rate ≥ 5%, or 1 broker-validation refusal, or last session more than 3 trading days before `asOf`, or any deployment with `broker_validated: false`
  - green: otherwise
  - grey: no sessions
  - The function returns the colour and the list of reasons, and the UI shows the reasons. Tests cover each boundary.
- **Ready to go live?** (N adjustable, default 3):
  1. At least N sessions recorded.
  2. No refusals in the last N sessions.
  3. No allowlist refusals, and when the profile is known, every placed symbol is in `ZIPLIME_ALLOWED_SYMBOLS`.
  4. Stable order counts: each of the last N sessions within ±30% of their median place count.
  5. Every placed order went through `validate_order` (`broker_validated: true`). A dry run with `validate_orders=False` never asked Lime, so it proves less.
  6. The file parsed with no malformed lines.
  Each item shows pass/fail and the evidence (which session, which line).

## 5. Seed script (`scripts/generate_seed.py`)

Runs the real engine with the test suite's fake client, the way `test_lime_dry_run.py` does.

```
PYTHONDONTWRITEBYTECODE=1 ../ziplime/.venv/bin/python scripts/generate_seed.py
```

- Puts `../ziplime` on `sys.path` and imports `LimeTraderSdkExchange`, `Order`, `MarketOrder`, `LimitOrder`, and `FakeAsyncLimeClient`, `FakeAssetService`, `_asset`, `_balance` from `tests.exchanges.test_lime_trader_sdk_exchange`. `PYTHONDONTWRITEBYTECODE` keeps it from writing `__pycache__` into `../ziplime`. Nothing is installed.
- One fictional account number per account (e.g. `LX-40217` masks to `LX***17`), passed to `_balance()` so `_get_account_balance` finds it.
- Each deployment has a strategy name, a symbol universe, a risk profile (the `ZIPLIME_*` env vars, set in `os.environ` before the exchange is built, since the engine snapshots them at construction), `validate_orders`, and a seeded RNG. Same seed, same files.
- Each session is one exchange instance (one invocation, so the per-invocation order count resets) on an NYSE trading day from the calendar ziplime uses, 10 sessions ending 2026-10-09.
- Order intents are generated per session (symbol, signed amount, market or limit, price), each with `dt` set to a bar time between 09:31 and 15:59 ET, then `await exchange.submit_order(order)`. Refusals raise; the script catches them, as ziplime's `stop_on_error=False` does. Some placed orders are cancelled with `exchange.cancel_order`.
- Scenarios come from the fake client's real knobs: `client.trading.validation_response` for broker rejections, `client.market.quotes` for market-order pricing and missing quotes, a past `ZIPLIME_ORDER_DEADLINE_UTC` for a stale signal.
- The one thing the script replaces is the wall clock. It swaps the module's `datetime` for a shim whose `now()` returns the simulated bar time plus a few milliseconds. Without it every `recorded_at` would be today, cancels would have no position on the session clock, and the deadline scenario couldn't run. The README says this plainly.
- Writes `data/seed/dryruns/<deployment>.jsonl` (the engine's own output, untouched) and `data/seed/manifest.json`: ziplime commit hash, `asOf`, the risk profile each deployment actually ran with, line counts. CRM-only fields (names, plans, tickets) live separately in `data/seed/accounts.json`, hand-written.
- A vitest test parses every seed file and fails on any parse error, so seed and parser can't drift apart.

Ten fictional accounts, 14 deployments, each built to show one behaviour:

| account | what its files show | expected health |
|---|---|---|
| Harbor Lane Capital (Dana Okafor) | clean, steady buys | green, ready to go live |
| Priya Raman | trades symbols outside her allowlist | red |
| Tomás Ibarra | notional cap too tight for his limit prices | red |
| Wen Li | rebalancer that tries to sell under the fail-closed profile; refusals 3 sessions in a row | red, triggers an automation |
| Greta Lindqvist | hits the per-invocation order count on busy days | amber |
| Kofi Mensah | fractional rebalances, many skips, no refusals | green (skips are benign) |
| Sofia Marchetti | broker validation: insufficient buying power | red |
| Aaron Feld | `validate_orders=False` | amber, checklist fails item 5 |
| Nadia Haddad | market orders, one day with no quote | amber |
| Jonas Weber | one stale-deadline session and one unrecognised broker message | amber, shows the Claude path |

## 6. Pages

App Router, all data pages are client components reading seed JSON imported at build time.

| route | audience | content |
|---|---|---|
| `/` | anyone | What this is in four sentences, the path an order takes (strategy, lot rounding, risk limits, deadline, `validate_order`, then the file instead of `place_order`), two entry points. Readable in under a minute. |
| `/portal` | trader | Deployment picker (seeded) and "Open a .jsonl file". Session strip, session clock, counts, order tape, net shares, readiness checklist. `?d=<deployment>&s=<date>` in the URL. |
| `/ops` | Limex team | Accounts table: trader, plan, deployments, last session, health with its reasons, open tickets. Sort and filter. |
| `/ops/accounts/[id]` | Limex team | Deployments, risk profile per deployment, refusal history chart (stacked by event per session), open tickets, activity log, link into the portal view of each deployment. |
| `/ops/inbox` | Limex team | Ticket list and ticket detail. Linked account and linked orders (by `ziplime_order_id` / `dry_run_id`) shown inline with their explanation. Reply composer with AI draft, guard, approve. |
| `/ops/automations` | Limex team | Rules with on/off, "Run rules now", run log. |

Every page: a top band "Sample data. Fictional accounts." and the footer "Unofficial concept built on the open-source ziplime engine. Sample data." No Limex logo, no Limex name in the brand mark; the product name is "ziplime Ops Console".

## 7. Components

- `SessionStrip`: one cell per session, coloured by worst event, count inside. Picks the session.
- `SessionClock`: the memorable element. x axis 09:30 to 16:00 ET with hour ticks, one lane per symbol. Place is a solid tick, refuse a red cross, skip a hollow ring, cancel a line from the place to the cancel time. Hover or tap shows the event; click selects it in the tape. SVG, scrolls horizontally inside its own box on phones.
- `EventCounts`: would-send / refused / skipped / cancelled, with the session's refusal rate.
- `OrderTape`: dense table, filter by event, symbol, side; search by id. Each row expands to the raw JSON line and, for refuse/skip, the explanation panel.
- `WhyPanel`: rule title, what happened, setting, what to change, the raw reason. "Ask Claude" for unmatched reasons.
- `NetShares`: per symbol, buys, sells, cancelled, net.
- `ReadinessChecklist`: the six items with evidence, N stepper.
- `HealthBadge`: colour plus the first reason in words, never colour alone.
- `HistoryChart`: per-session stacked bars (place, refuse, skip, cancel), hand-rolled SVG. I'll read the dataviz skill before drawing it.
- `TicketThread`, `DraftEditor`, `GuardReport`, `RuleCard`, `RunLog`, `UploadDrop` (shows line-numbered parse errors above the data).

## 8. Support inbox, AI drafting and the guard

- Tickets are seeded (7, linked to accounts and orders) and created by automations. State machine per reply: `empty → draft → flagged | in_review → approved (counts as sent)`. Editing a reply sends it back to review. Only a human click on Approve moves it to approved, and Approve is disabled while the guard reports anything.
- `POST /api/draft` (server route, `@anthropic-ai/sdk`, key from `ANTHROPIC_API_KEY`, model id checked against the claude-api skill at build time, overridable with `ANTHROPIC_MODEL`). The request carries only this account's data: ticket thread, linked events, their deterministic explanations, the deployment's risk profile, session counts. No other account's data is ever in the prompt, which is the first defence against mentioning other clients. The system prompt states the three rules.
- `GET /api/ai-status` tells the client whether a key is set. Without one, the AI button is replaced by "AI drafting is off" plus "Insert template reply", a deterministic draft built from the same data, so the review and approve flow still works end to end.
- Guard (`lib/guard.ts`), run on every draft and every edit, client side and again in `/api/draft`:
  - promises of returns: guarantee(d), risk-free, can't lose, will make/earn, assured profit, `\d+% (return|gain)`, outperform
  - investment advice: you should (buy|sell|hold), I('d| would) recommend (buying|selling), good investment, price target, will go up/down, now is a good time to
  - other clients: any other seeded account's name, company, account number or masked id; phrases like "other clients", "another customer", "other traders"
  - Returns each hit with category, matched text and position; the editor highlights them. Tests cover each category, case-insensitivity, word boundaries (so "guaranteed" hits but "guardrail" doesn't), and the clean case.
- The guard is a phrase check, not a compliance system. The UI says that under the report.

## 8b. Beta intake (`/ops/intake`)

A person at Limex reads every signup by hand. This queue helps them do it faster without taking the decision away from them.

**What limex.com actually collects** (live bundle `index-3zRYaaTq.js`, checked 2026-10-13 15:30 ET). The copy says "Tell us how you trade and we'll tailor your access, and your spot in what ships next" and "No card. We read every single answer." Step 1 is an email field. Step 2, "One more thing, 30 seconds", is optional and is all buttons, no text box:

| key | question | options (multi-select) |
|---|---|---|
| `trade` | What do you trade? | Stocks, Options, Futures, Crypto |
| `style` | How do you trade? | Day trading, Swing, Part-time, Just starting |
| `funded` | Funded / prop account? | Trading one now, Working toward it, Not my thing |
| `pain` | Biggest frustrations today? | Manual entry, No real insight, My own psychology, Price, Privacy, Other |

Plus a toggle "I have a track record and want to hear about Trading Pod. (invite-only)". The row posted to `/api/leads` is `{email, source, wants_call, wants_pod, trade, style, funded, pain, answers, page, ts}`, with multi-select values joined by ", ".

**Data model** (`lib/intake/types.ts`), mirroring that row: `Signup { id, email, ts, trade[], style[], funded[], pain[], wantsPod, note? }`. `note` is the one field limex.com doesn't have (decision 4 in section 13).

**Seed**: 30 fictional signups in `data/seed/signups.json`, `.example` emails, varied: beginners, part-timers, day traders, options sellers, futures, crypto-only, prop traders, quants, some who skipped step 2 entirely (it's optional, so an email-only row is realistic).

**Triage** (`lib/intake/triage.ts`), the same fields from rules or from Claude:
- trader type, assets (from `trade`, plus the note), priority with its reasons, suggested Workspace, welcome email draft.
- **Likely broker**, from the six brokers limex.com lists as connected via SnapTrade: Robinhood, Charles Schwab, Fidelity, E*TRADE, Interactive Brokers, Coinbase ("+ 19 more via SnapTrade US"). Always tagged `stated` (the note names it), `inferred` (for example crypto only, so Coinbase is a guess), or `unknown`. The form doesn't ask for a broker, so most rows are `unknown`, and the UI says so rather than guessing confidently.
- **Priority, deterministic**: high if `wants_pod` or funded "Trading one now"; low if step 2 was skipped and there's no note; normal otherwise. Claude can't override priority, only explain it.
- **Rules first**: keyword and option rules always run and need no key. "Triage with Claude" (`POST /api/triage`, structured JSON output, Sonnet from `ANTHROPIC_MODEL`) refines type, assets, broker and the email, and the UI shows what changed from the rules version. Without a key: "AI drafting is off", and the rules version is the whole triage.

**Review**: `new → triaged → in review | flagged → approved | dismissed`. The welcome email goes through the same guard as support drafts, plus one intake check: no promise of Trading Pod access (it's invite-only) and no ship dates. Approve is disabled while the guard reports anything. Approving creates a CRM account on Beta with no deployments (health grey, "no sessions yet") and an activity entry "approved from intake by <reviewer>".

Tests: rules triage per persona, broker tags (`stated` beats `inferred`, nothing beats nothing), priority boundaries, guard on welcome emails, approval creating exactly one account.

## 9. Automation rules (`lib/automations.ts`)

Pure functions over (seed data, current state) returning effects, so they're testable and the run log shows exactly what each run did.

1. Refusals in 3 sessions in a row: open a ticket on that account, linked to the latest refusal, with a template draft in review. Never sends.
2. Any broker-validation refusal in the last session: add an activity entry and an amber note.
3. No dry-run session for 3+ trading days before `asOf`: activity entry "dry run stale".
4. A deployment passes all six readiness checks: activity entry "ready for live review", for a human to act on.

Idempotent: a rule that already opened a ticket for the same account and trigger doesn't open another. The run log lists each rule, account, effect, and "skipped: already open".

## 10. State

React context with a reducer, persisted to localStorage under a versioned key (`ziplime-ops-console:v1`), every read and write in try/catch. Uploaded files stay in memory for the tab. A "Reset demo" button in the header clears local state back to seed. No database.

## 11. Design direction

Subject: an order blotter for strategies that haven't gone live yet. Audience: a trader checking their run, and an ops person triaging 10 accounts. Job: make "would it have traded, and if not why" readable at a glance.

- **Colour** (light / dark): ground `#E9EDF1` / `#0F1823` (cool slate, not black), surface `#FFFFFF` / `#16222F`, ink `#15202B` / `#DCE3EA`, would-send `#2557D6` / `#6E97FF`, refused `#C8322B` / `#FF6B5F`, skipped `#B7791F` / `#E3A94A`, cancelled is the muted ink with a strike. Event colours carry meaning everywhere and nothing else uses them. Limex's own black with lime green is deliberately not used, so this can't be mistaken for their product.
- **Type**: Archivo (variable, width axis 62 to 125) for everything. Condensed width with tabular figures for tables and numbers, wide width at heavy weight for page titles and the clock's hour labels. IBM Plex Mono only where the content is code: raw JSON lines and env var names.
- **Layout**: left rail with two groups, Portal and Ops. Content is left-aligned, a 12-column grid, panels separated by spacing and one rule weight, small radius on inputs only. The session clock spans the full width at the top of the portal; everything else sits under it.
- **Restraint**: one bold element (the clock). No gradients, no shadows on panels, no motion except the clock's selection highlight and panel expand.
- **Phone**: rail becomes a bottom bar, tables become stacked rows, the clock scrolls inside its frame. I check at 390 px.

## 12. Build order (a commit after each)

1. Scaffold (Next.js 16, TypeScript, Tailwind v4, vitest, Playwright), parser + tests.
2. Seed script + generated data + seed parse test.
3. Client portal.
4. Ops CRM: accounts list and detail.
5. Beta intake: signups, rules triage, Claude triage, the guard (built here first) + tests, approve into CRM.
6. Support inbox and AI drafting, reusing the guard.
7. Automation rules + tests.
8. Polish: production build, all tests, every page in a browser at desktop and 390 px, light and dark, README with screenshots and a 3-minute demo script.

Then I stop and ask before any deploy. No pushes to any remote.

## 13. Decisions (resolved 2026-10-13)

1. **Plan names**: one constant, `src/lib/plans.ts`, exactly as the live limex.com pricing section showed on 2026-10-13 at 15:03 ET: Beta at $0 ("Full access during the US beta", "No card required"), and Bronze, Silver and Gold locked, "Coming soon", "Available after beta", no prices. Every seeded account is on Beta. No invented prices anywhere.
2. **Model**: current Sonnet, read from `ANTHROPIC_MODEL`, with that as the default.
3. **Clock shim**: yes. The README says so plainly.

4. **Signup shape** (2026-10-13): mirror the real limex.com lead row (the four optional multi-select questions and the Trading Pod toggle), plus one optional free-text `note`. The UI labels it "Proposed field, not on limex.com today".
5. **Workspaces**: one config constant with plain descriptive names (Getting started, Options, Crypto, Swing setups, Day trading, Prop / funded). The UI says "Placeholder names; limex.com doesn't list its Workspaces yet".

## 14. Corrections found while building

- **Order count limit.** `_order_attempt_count` goes up only after the symbol, quantity, sell and limit-notional checks pass. An order refused by one of those does not count. One refused later (market notional, broker validation, deadline) does. The `max-orders` explanation says this, not "refused ones included".
- **Rounded amounts.** On a `place` line `requested_amount` is the amount after lot rounding (the engine sets `order.amount = int(quantity)` before submitting). A dropped remainder like the 0.4 in 12.4 is not in the file. Only a whole sub-lot order shows up, as a `skip`.
- **Invocation.** In the seed, one exchange instance runs one session, so `ZIPLIME_MAX_ORDERS_PER_INVOCATION` caps orders per session. On Limex's Lambda workers an invocation may be shorter; the explanation names the setting and doesn't assume which.
- **Health.** An unexplained reason makes an account amber ("needs a look"), not red. Red stays for refusal rate and repeated broker rejections.
- **Nadia Haddad is red, not amber.** Her intraday file refuses 25% of orders over the last 5 sessions (9 Oct: all three orders refused, two for a missing quote). The health rule is right and the expectation in section 5 was wrong. Seeded health: 2 green, 3 amber, 5 red.

## 15. Integration layer (plan, 2026-10-14, revised after review)

Goal: a real path from a running ziplime dry run into the console. A forwarder next to the engine sends new lines over a signed webhook. The console stores them in Postgres, and every page reads through one data interface. With no database configured, the console is the static demo it is today, unchanged.

The first draft of this section was reviewed by a separate Claude Code session acting as a strict senior engineer. Its 17 findings and what changed are in 15.10. The text below is the revised plan.

### 15.1 Decisions made without the owner

The owner is away for this run, so these are decided here, each as the simplest safe option.

| # | Decision | Why |
|---|---|---|
| D1 | No Supabase CLI and no Docker on this machine (`which supabase docker` finds neither), so local development and tests use PGlite (`@electric-sql/pglite` 0.5.8, real Postgres compiled to WebAssembly). The SQL in `supabase/migrations/` is plain Postgres, so `supabase db push` runs the same files on a real project. Docker is not installed by this run. | The run's rules. |
| D2 | The data mode is chosen when the app is built. `next.config.ts` records `CONSOLE_DATA_MODE` = `database` if `DATABASE_URL` is set at build time, else `static`. At runtime, a mismatch is logged loudly at startup and the ingest route answers 503 `misconfigured`. | With Cache Components, a static build prerenders every page, so a database added later would never be read. Failing loudly beats silently showing seed data. |
| D3 | `DATABASE_URL` forms: `pglite:<dir>` or `pglite:memory` for development and tests (migrated and seeded on first open; refused when `NODE_ENV=production`); `postgres://...` for a real server through `pg` 8.23.0 (never migrated by the app). | Production never migrates itself. Local development should just work. |
| D4 | The signature covers `<timestamp header>.<raw body bytes>`, not the body alone. | Otherwise a captured request can be replayed with a fresh timestamp header, and the 5 minute window means nothing. Stripe signs the same way. |
| D5 | Ingest secrets are 32 random bytes, generated by the server, shown once, stored in `private.ingest_keys`, which no client role can read. Not hashed, because the server must compute the HMAC. A rotate route issues a new key and the old one stops working at once. | HMAC needs the secret on both sides. Encrypting the column (Supabase Vault) is listed as a known limit. |
| D6 | In database mode the whole app sits behind HTTP Basic auth (`OPS_PASSWORD`), enforced in `proxy.ts`. Only `/api/ingest/*` is outside it (excluded in the matcher, so the proxy never buffers its body), because it has its own HMAC auth. With a database and no `OPS_PASSWORD`, every route except ingest answers 503. | Database mode holds real-looking client data and creates secrets. There is no login system, and Basic auth is the smallest thing that fails closed. The static demo has no database and no proxy rules. |
| D7 | Page reads in database mode run inside a transaction as role `authenticated` with ops claims, so RLS applies to the app. The trader policies are for a future trader login; they are tested, not used by a page yet. | The demo has no trader login. Saying so is better than faking a "view as trader". |
| D8 | The static adapter is read only. Its write methods refuse. Without a database, `POST /api/ingest/*` answers 503 `ingest_unavailable`. | The seed is immutable and the demo's edits already live in the browser. |
| D9 | Ticket replies, automation runs and the explain cache stay in browser storage in both modes. Intake approvals move to the database in database mode, because they create accounts, deployments and keys the server must know. Database mode uses its own storage key, so approvals made in the static demo on the same origin never show up as accounts that don't exist. | Keeps the change set to what the integration needs. |
| D10 | Line numbers are positions in the deployment's stream. With one file, which is how ziplime writes (append only, one line per record, fsync), they are the file's line numbers. If the file is rotated (same path, new inode), the forwarder keeps counting from where it was, so nothing is renumbered. | A per-file numbering table adds a concept the console can't show well (the portal shows one file per deployment). |
| D11 | Authenticated calls write an `ingest_batches` row and an `audit_log` row each. Calls that fail before authentication (unknown deployment, bad signature, too large) are counted per deployment id, reason and minute in one `audit_log` row each, not one row per call. | "A row for every call" without letting anyone on the internet make the server write unbounded rows. |

### 15.2 Schema (`supabase/migrations/20261014000000_init.sql`)

Text slugs (`^[a-z0-9][a-z0-9-]{0,63}$`) for accounts, deployments, tickets and signups; `uuid` for batches; `bigint identity` for events and audit rows. Every foreign key is `on delete restrict`: nothing disappears by cascade in a ledger.

```
public.accounts        id pk, trader, company?, email, account_number (unique where <> ''), plan check in
                       (beta, bronze, silver, gold), joined date, created_at
public.signups         id pk, email, ts timestamptz, page, trade/style/funded/pain text[], wants_pod bool, note?,
                       decision check in (approved, dismissed)?, decided_by?, decided_at?, account_id fk accounts? unique,
                       check: decision null or decided_by and decided_at set; approved iff account_id set
public.deployments     id pk, account_id fk, strategy, description, symbols text[], risk_env jsonb? (null = no fail-closed
                       profile), validate_orders bool, deadlines jsonb, next_line int >= 1, created_at
private.ingest_keys    deployment_id pk fk, secret bytea check octet_length = 32, created_at
public.ingest_batches  id uuid pk, deployment_id fk, received_at, status check in (stored, replay, stale, bad_request, gap),
                       file text?, body_sha256 text?, first_line int?, line_count int >= 0,
                       accepted/duplicate/rejected int >= 0, replay_of fk ingest_batches?, result jsonb?,
                       unique (deployment_id, body_sha256) where status = 'stored'
public.dry_run_events  id bigint identity pk, deployment_id fk, batch_id fk, line_no int > 0, raw_line text,
                       content_hash text check ~ '^[0-9a-f]{64}$', status check in (accepted, rejected), reject_reason?,
                       event?, recorded_at?, order_dt?, symbol?, ziplime_order_id?, dry_run_id?, client_order_id?,
                       requested_amount numeric?, side?, quantity numeric?, order_type?, limit_price numeric?, reason?,
                       broker_validated?, known_order?, account_masked?, session_date date?,
                       unique (deployment_id, content_hash), unique (deployment_id, line_no),
                       check: rejected rows have reject_reason and no event; accepted rows have event in
                       (place, refuse, skip, cancel), recorded_at and session_date; place has dry_run_id, client_order_id,
                       side in (buy, sell), quantity, order_type in (market, limit), broker_validated; refuse and skip have
                       reason, ziplime_order_id, symbol, requested_amount; cancel has dry_run_id and known_order
public.sessions        (deployment_id fk, date) pk, place/refuse/skip/cancel int >= 0, updated_at.
                       Derived: replaced from accepted events inside every ingest transaction. No foreign key from
                       events to sessions, so the recompute can delete and insert freely.
public.tickets         id pk, account_id fk, subject, created_at, messages jsonb check array, links jsonb check array,
                       draft jsonb?, rule jsonb?
public.audit_log       id bigint identity pk, at, actor ('forwarder:<deployment>', 'ops', 'anonymous', 'seed'), action
                       (ingest.stored, ingest.replay, ingest.rejected, ingest.refused, signup.approved, key.issued,
                       key.rotated), target, detail jsonb (never a secret), request_id,
                       bucket timestamptz? and count int for refused calls, unique (action, target, bucket) where bucket
                       is not null
```

`content_hash` is the hex SHA-256 of the line's UTF-8 bytes exactly as sent, without its `\n`. A shared test vector pins it.

### 15.3 Row-level security and grants

- The migration creates roles `anon` and `authenticated` if missing, so the same file runs on PGlite and on Supabase, where they exist.
- It revokes everything on every table in `public` from `anon` and `authenticated` (Supabase grants them access to new tables by default), then grants `select` to `authenticated` table by table. `anon` keeps nothing. `private` has no grants at all.
- RLS is enabled on every table in `public`. Claims are read with `nullif(current_setting('request.jwt.claims', true), '')::jsonb`, which is what Supabase's `auth.jwt()` reads, through helpers `app.is_ops()` (claim `app_role` = `ops`) and `app.account_id()` (claim `account_id`). Claims are only ever set with `set_config(..., true)`, scoped to the transaction.

| table | `authenticated` can select |
|---|---|
| accounts, tickets | ops, or the row's own account |
| deployments | ops, or its account |
| sessions, dry_run_events, ingest_batches | ops, or rows of a deployment the account owns |
| signups, audit_log | ops only |

No insert, update or delete policies exist. Writes go only through the server's owner connection (Supabase's service role). On a real project the claims come from a custom access token hook; that is documented, not built.

Tests switch to `authenticated` with `SET ROLE` (PGlite's default user is a superuser and skips RLS) and check: a trader sees only their rows in every table; ops sees all; `anon` has no privilege on any table; nothing in `private` is readable; inserts are refused; every `public` table has RLS on. One sanity test turns RLS off inside a rolled-back transaction and shows the trader test would then fail.

### 15.4 Data access layer (`src/lib/data/`)

```ts
interface DataSource {
  readonly kind: "static" | "postgres";
  load(): Promise<Dataset>;                                   // reads as ops, through RLS
  ingest(deploymentId, rawBody, headers, now): Promise<IngestResponse>;
  approveSignup(signupId, by, email): Promise<Onboarded>;     // account + deployment + key, one transaction
  rotateKey(deploymentId, by): Promise<{ secret: string }>;
}

type Dataset = {
  source: "static" | "postgres";
  calendar: { asOf: string; tradingDays: string[] };
  ziplime: { branch: string; commit: string; subject: string };
  accounts: Account[];
  deployments: Deployment[];
  files: Record<string, string>;          // deployment id -> file text, line N at line N
  tickets: Ticket[];
  signups: Signup[];
  decisions: Record<string, SignupDecision>;     // database mode only
  ingest: Record<string, IngestBatchView[]>;     // per deployment, newest first, authenticated calls only
};
```

- Static adapter: the bundled seed, exactly the objects the pages use today.
- Postgres adapter: rebuilds each file from `dry_run_events` ordered by `line_no`, rejected lines included. Line N lands on line N, with an empty line where nothing was stored, so the existing parser gives the same events, errors and line numbers as the trader's file. No second parser exists.
- Pages: the root layout puts a `DatasetProvider` around the shell. In a static build it renders synchronously with no server data, and the client uses the bundled static dataset, so the HTML and the bundle stay what they are. In a database build the layout first calls `await connection()` (so the database is never touched during the build), then awaits `load()` inside a Suspense boundary. Layouts don't re-render on client navigation, so in database mode the provider calls `router.refresh()` when the path changes, and after every approve or key rotation. That costs one extra request per navigation in database mode only, and keeps every page current.
- Components read `useDataset()` instead of importing `lib/seed`. Pure modules (`crm`, `automations`, `inbox`, `intake`, `store/state`) take the dataset as an argument. Server routes (`/api/draft`, `/api/triage`, page metadata) call `getDataSource().load()`. `generateStaticParams` keeps returning the seed ids: Cache Components rejects an empty list, and in database mode the pages render at request time anyway.
- PGlite inside Next: one instance per process on `globalThis` (so hot reload never opens the directory twice), every statement inside `pglite.transaction()`, data directory under `.data/` and in `.gitignore` (it holds secrets).

Contract suite (`src/lib/data/contract.test.ts`): one list of checks run for each adapter, the static one and PGlite migrated and seeded through the ingest path. Each compares the adapter's `load()` with the bundled seed: accounts, deployments, tickets, signups and calendar deep-equal, every file's text byte-identical, parsed sessions and counts identical. For Postgres it also checks that the `sessions` table matches the parser for every deployment. Write checks run where the adapter supports writes. For static, the check is that writes refuse.

### 15.5 Ingest API

`POST /api/ingest/{deploymentId}`, documented in `openapi.yaml`.

Headers:
- `Content-Type: application/json`
- `X-Ziplime-Timestamp`: Unix seconds, `^\d{10}$`
- `X-Ziplime-Signature`: `^v1=[0-9a-f]{64}$`, the hex HMAC-SHA256 of `<timestamp header>.<raw body bytes>` with the deployment's secret

Body: `{ "file": "greta-sector.jsonl", "first_line": 41, "lines": ["{...}", "{...}"] }`

Limits: body 1 MB (checked on `Content-Length`, then counted while reading the raw bytes), 1000 lines, 16 KB per line.

Checks in order. Each fails closed with a small JSON body and no internals.

| step | failure | status, `error` |
|---|---|---|
| a database build with a database configured | no | 503 `ingest_unavailable` or `misconfigured` |
| size | over 1 MB | 413 `too_large` |
| header format | malformed | 401 `unauthorized` |
| deployment and key | unknown | 401 `unauthorized`, after computing an HMAC with a dummy key, so timing doesn't reveal real ids |
| signature, constant-time compare of two 32-byte buffers | wrong | 401 `unauthorized` |
| timestamp within 5 minutes either way | no | 401 `stale_timestamp` (only key holders get this far) |
| body shape | not JSON, wrong types, over 1000 lines, empty `lines` | 400 `bad_request` with a one-line reason |
| `first_line` > `next_line` | gap | 409 `gap` with `expected_at_most` |

Then, in one transaction that starts with `select ... from deployments where id = $1 for update`, so batches for one deployment run one at a time:
1. Replay: if this body's SHA-256 was already stored for this deployment, write a `replay` batch row and return the stored response unchanged (same `batch_id`), with `"replay": true`. Nothing else is written.
2. Gap check, under the lock.
3. Each line in order:
   - empty: `ignored` (the engine never writes one; nothing stored, and the rebuild leaves line N empty, which is the same thing)
   - over 16 KB: `rejected`, stored truncated
   - same line number already holds the same hash: `duplicate`
   - same hash already stored at another line: `rejected`, "same record as line M"
   - line number already holds a different line: `rejected`, "line N already holds a different record" (not stored)
   - the same text earlier in this batch: `rejected`, "same record as line M"
   - the parser rejects it: `rejected` with the parser's reason, stored with `status = rejected`
   - otherwise `accepted`
4. Insert with `on conflict do nothing returning`, so a race can never turn into a 500. Recompute session dates over the whole stream with the parser. Replace `sessions` from accepted events. Set `next_line = greatest(next_line, first_line + n)`. Store the response on the batch row and write the audit row.

Response 200: `{ batch_id, deployment_id, replay, received, accepted, duplicate, rejected, ignored, results: [{ line, status, reason? }] }`. A bad line never blocks the good ones. Any unexpected error: 500 `internal` with a request id; details only in the server log.

PGlite runs one connection and serializes transactions, so local tests can't show the race the row lock prevents. The concurrency test runs only when `TEST_DATABASE_URL` points at a real Postgres. Without one it is skipped, and the test output says so.

Ops routes, all behind Basic auth, all requiring `Sec-Fetch-Site: same-origin` or a matching `Origin`, and `Content-Type: application/json` (CSRF):
- `POST /api/ops/signups/{id}/approve` with `{ subject, body }`: 200 with account, deployment, secret and command; 409 if already decided (no new key); 422 if the guard flags the email. Locks the signup row; account ids are picked under an advisory lock.
- `POST /api/ops/deployments/{id}/key`: issues a new key, the old one stops working, 200 with the secret once.

### 15.6 Forwarder (`forwarder/`)

`forwarder/ziplime_forwarder.py`, Python standard library only, no change to `../ziplime`.

```
python forwarder/ziplime_forwarder.py --file run/greta.jsonl \
  --url http://localhost:3000/api/ingest/greta-dryrun \
  --secret-file ~/.ziplime/greta-dryrun.secret --state run/greta.forwarder.json [--once]
```

- The secret comes from `--secret-file` (refused unless only the owner can read it) or the `ZIPLIME_INGEST_SECRET` environment variable, never from a flag value.
- Reads only complete lines (ending in `\n`) after the saved byte offset. A half-written last line waits. Never posts an empty batch.
- Batches by line count (500) and bytes (900 KB). A line too big for a batch on its own stops the forwarder with a clear message; the engine's lines are under 1 KB.
- Builds each batch's body bytes once and reuses them on every retry, so a retried batch is recognised as a replay.
- Retries network errors, 429 and 5xx with exponential backoff and jitter (1 s doubling, capped at 60 s, 8 tries, about 2 minutes), then exits non-zero. It is meant to run under a supervisor (systemd, launchd, a container restart policy). Does not retry 400, 401 or 413.
- On 409 `gap` it rewinds: it rescans the current file to `expected_at_most` and resends from there (the server marks the overlap as duplicates).
- Saves `{ path, inode, offset, next_line, file_first_line }` with an atomic replace, only after a 200. A restart resumes without resending. On a new inode at the same path it starts the new file at offset 0 and keeps counting lines. If the file shrank without a new inode, it stops.

Tests (`forwarder/test_forwarder.py`, pytest, a real local HTTP server in a thread): batch limits and the held-back partial line; no empty batch; the shared signature vector; resume after restart sends nothing; retry on 503 then success with the same body bytes; no retry on 401; state not advanced on failure; gap rewind; rotation keeps numbering; a shrunk file stops.

### 15.7 Onboarding

In database mode, Approve on a Beta signup calls the approve route. One transaction creates the account, one deployment (`<account>-dryrun`, buy-only fail-closed profile as a starting point), the key, the signup decision and audit rows. It runs the welcome-email guard on the server too. The intake panel shows the secret once with the exact forwarder command and a copy button, and says it won't be shown again. The secret lives only in that component's state, never in the store or browser storage. The account page gets an Ingest panel with the latest batches (time, file, status, accepted, duplicate, rejected) and every rejected line with its number and reason, plus "Issue a new key". In static mode neither appears, and approval works as it does today.

### 15.8 Proof

- `e2e-ingest/ingest.spec.ts` (Playwright, own config, `next dev` on a fresh `pglite:` temp directory, a generated `OPS_PASSWORD`, `httpCredentials` set):
  1. Run the real seed generator (`scripts/generate_seed.py --out <temp> --only greta-sector`, which never touches `data/seed`) to write the file again from the engine. The generator is deterministic, so this file reproduces the committed one; the test says reproducible, not fresh.
  2. Approve a signup through the UI; read the secret and the command from the panel.
  3. Run the forwarder with `--once`. Assert the console's numbers for the new deployment (account page totals and the portal's per-session counts) equal the numbers computed from the file in the test itself with plain `JSON.parse`.
  4. Run the forwarder again: it sends nothing. Run it with a fresh state file: every line `duplicate`, and the database row count is unchanged.
  5. A tampered signature gets 401 `unauthorized`. A timestamp 6 minutes old gets 401 `stale_timestamp`. A batch with one malformed line gets 200 with that line rejected, the rest accepted, and the rejected line shown on the account page.
  6. Navigate between pages after an ingest and see the new numbers (layout refresh).
  7. `git status --porcelain data/seed` is empty at the end.
- Run three times in a row, each on a fresh database.
- Proof the static demo is unchanged: before the refactor, capture every route's visible text and screenshots at desktop and 390 px, in both themes, plus the `next build` route table. After it, compare. Any difference is a bug.
- Database mode security tests: anonymous `GET /` and `/portal` get 401; ops routes without the same-origin header get 403; approving twice gets 409 and issues no second key; the secret never appears in browser storage or `audit_log`.
- Unit tests: signature, timestamp and header parsing (vitest); every line outcome against PGlite; RLS per role; the contract suite; Python forwarder tests.

### 15.9 Known limits, written down on purpose

- `load()` reads the whole dataset per request. Fine for tens of accounts; per-page queries are the next step.
- Session recompute reads the whole stream on every batch. Fine for thousands of lines, not millions.
- No rate limiting beyond the per-minute counting of refused calls; a real deployment puts the route behind the platform's limiter.
- Secrets are stored as plain bytes in a schema only the service role can read. Supabase Vault is the next step.
- The trader claim mapping (a custom access token hook) is described, not built. There is no trader login.
- Two identical malformed lines at different line numbers: only the first is stored (the hash is unique per deployment). The second is reported as rejected and left empty in the rebuild.
- In database mode, ticket replies and automation runs still live in the browser (D9).

### 15.10 Review of the first draft, and what changed

| # | Finding (severity) | Change |
|---|---|---|
| 1 | Database mode shipped every account's data to anonymous visitors; `/api/draft`, `/api/triage` and `/api/explain` were open; the app never used the trader policies (blocker) | Whole app behind Basic auth in database mode, only ingest outside (D6). Trader policies stated honestly as tested, not used (D7). Tests for anonymous 401. |
| 2 | No lock per deployment: lost `next_line`, broken `sessions`, 500 on concurrent replays and on duplicate lines inside one batch (blocker) | `for update` on the deployment row, gap and replay checks under it, `on conflict do nothing returning`, `greatest(...)`, in-batch duplicates classified before insert. Concurrency test on real Postgres only, and that limit stated. |
| 3 | Rejected lines not stored, so database mode hid parse errors the static mode shows (major) | Every line stored with `status` and `reject_reason`; the rebuild gives the same text. |
| 4 | Per-deployment line numbers broke new files per run and database restores (major) | Line numbers are stream positions; rotation keeps counting (D10); the forwarder rewinds on 409 `gap`. |
| 5 | Data mode decided by whatever the build saw, and a database build would query the database while prerendering (major) | `CONSOLE_DATA_MODE` recorded at build, a mismatch fails loudly (D2); `await connection()` first; seed ids kept in `generateStaticParams`. |
| 6 | Layout data goes stale on client navigation (major) | `router.refresh()` on path change and after writes in database mode; e2e step 6. |
| 7 | PGlite could be opened twice or mix one request's claims into another's (major) | One instance on `globalThis`, only `transaction()`, refused in production, data directory ignored. |
| 8 | Supabase grants new tables to `anon` by default; claims cast could throw on pooled connections; superuser skips RLS in tests (major) | Revoke then grant per table, `private` schema for keys, `nullif(...)`, `set_config(..., true)` only, `SET ROLE` in tests, an RLS-off sanity test. |
| 9 | Anyone could make the server write rows; timing told real ids from fake ones (major) | Refused calls counted per minute (D11) and kept out of the batch panel; dummy-key HMAC for unknown ids. |
| 10 | CSRF on the approve route through resent Basic auth credentials (major) | Same-origin header or Origin check plus JSON content type on every ops route, tested. |
| 11 | The seed generator lives in this repo, has no `--out`, rewrites `data/seed`, and is deterministic (major) | `--out` and `--only` flags that never touch `data/seed`; e2e checks `git status`; "reproducible, not fresh". |
| 12 | Nothing proved the static demo unchanged; static approvals would leak into database mode (major) | Before and after capture of text and screenshots of every route; separate storage key in database mode (D9). |
| 13 | Loose header parsing and `timingSafeEqual` on unequal lengths could 500; HMAC over decoded text; proxy buffering the ingest body (minor) | Strict regexes, fixed-length buffers, HMAC over raw bytes, ingest excluded in the matcher. |
| 14 | Duplicate rule too loose; blank lines had no status; hash bytes not pinned (minor) | Duplicate only at the same line number; other cases rejected with the stored line named; `ignored` for blank lines; shared test vector. |
| 15 | Forwarder: body bytes per retry, empty batches, supervisor, oversize line, secret in shell history, secret leaks (minor) | All addressed in 15.6 and 15.7, with tests. |
| 16 | Cut `accounts.from_signup`, the events-to-sessions foreign key, `source = 'seed'`; say what a replay returns; rotation (minor) | Cut all three (the seed load is marked by its audit actor). A replay returns the original `batch_id`. A rotate route is built. |
| 17 | Approving twice, or two approvals at once (minor) | 409 with no new key; the signup row is locked; account ids are picked under an advisory lock. |
