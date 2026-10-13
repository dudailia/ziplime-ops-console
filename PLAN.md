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
5. Support inbox, AI drafting, guard + tests.
6. Automation rules + tests.
7. Polish: production build, all tests, every page in a browser at desktop and 390 px, light and dark, README with screenshots and a 3-minute demo script.

Then I stop and ask before any deploy. No pushes to any remote.

## 13. Decisions (resolved 2026-10-13)

1. **Plan names**: one constant, `src/lib/plans.ts`, exactly as the live limex.com pricing section showed on 2026-10-13 at 15:03 ET: Beta at $0 ("Full access during the US beta", "No card required"), and Bronze, Silver and Gold locked, "Coming soon", "Available after beta", no prices. Every seeded account is on Beta. No invented prices anywhere.
2. **Model**: current Sonnet, read from `ANTHROPIC_MODEL`, with that as the default.
3. **Clock shim**: yes. The README says so plainly.

## 14. Corrections found while building

- **Order count limit.** `_order_attempt_count` goes up only after the symbol, quantity, sell and limit-notional checks pass. An order refused by one of those does not count. One refused later (market notional, broker validation, deadline) does. The `max-orders` explanation says this, not "refused ones included".
- **Rounded amounts.** On a `place` line `requested_amount` is the amount after lot rounding (the engine sets `order.amount = int(quantity)` before submitting). A dropped remainder like the 0.4 in 12.4 is not in the file. Only a whole sub-lot order shows up, as a `skip`.
- **Invocation.** In the seed, one exchange instance runs one session, so `ZIPLIME_MAX_ORDERS_PER_INVOCATION` caps orders per session. On Limex's Lambda workers an invocation may be shorter; the explanation names the setting and doesn't assume which.
- **Health.** An unexplained reason makes an account amber ("needs a look"), not red. Red stays for refusal rate and repeated broker rejections.
