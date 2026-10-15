# How I built this

## What I built and why

ziplime, Limex's open-source engine, had an open issue (#5) asking for a dry run that writes orders to a file instead of sending them to the broker. I built it with Claude Code as PR #39 to Limex-com/ziplime: every order still goes through lot rounding, the fail-closed risk limits, the deadline and Lime's `validate_order`, then goes to a JSON Lines file instead of `place_order`. This console reads those files: a portal that tells a trader why an order didn't go out, and a CRM where the Limex team sees who needs help. Its sample data is the engine's own output, made with the test suite's fake Lime client, so nothing uses real credentials or trades live. The last stage connects the two: a forwarder next to the engine sends new lines to a signed webhook, and the console stores them in Postgres.

## How I worked with AI

Claude Code wrote most of the code, from plans I approved. Each stage was a plan in `PLAN.md`, then code, tests and the production build, then a commit: 2 commits on the ziplime branch, 37 here for the build and 14 more from the review below. For the integration layer I was away, so a separate Claude Code session reviewed the plan as a strict senior engineer; its 17 findings, two of them blockers, were fixed before any code (`PLAN.md` 15.10).

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

## A second review, 14 Oct 2026

After the build, a separate Claude Code session audited the live deploy (`3747839`) as a reviewer, not as its author. It reproduced every finding before fixing it, fixed seven bugs in four commits and listed five things it left open. A third session applied those commits on my Mac, checked them, fixed the open items, and found one more test problem.

**The guard was the worst finding.** It is the check that stops a reply giving investment advice or promising returns, and it knew only the textbook forms. Of 25 everyday phrasings, such as "You should definitely buy more AAPL", "We recommend buying the dip", "You'll make 20% per year" and "zero risk", it let 24 through. The patterns now allow a short closed list of hedges and cover recommend, suggest and advise, price predictions, percent-per-period returns and no-risk promises. `guard.corpus.test.ts` holds 34 phrasings it must catch and 23 support sentences it must pass, and it runs the guard over every text the console writes itself, none of which may trip it. On the production build, the first sentence above blocks Approve (`docs/screenshots/audit/guard-blocks-approve.png`). A review before shipping then found that the wider patterns blocked ordinary support sentences, such as "Your refusal rate will drop once you raise the cap" and "You need to exit the forwarder first". Now a price prediction needs a market subject (a ticker, "the stock", "prices"), and "trim", "exit" and "add to" count only with a holding after them.

**The other bugs, each with a test that failed first:**

- Claude on the public demo. The demo has no sign-in, so the AI routes are open to anyone, and only a sentence in `docs/PUBLISH.md` kept the key off Vercel. Found by reading the routes. A static build now keeps AI off even with a key, on Vercel or any other host, and the AI routes take only JSON from the console's own origin.
- Skip reasons with an exponent. The engine writes a fraction with Python's `:g`, which gives `4e-05` below 0.0001, and the skip pattern had no exponent, so float noise turned a healthy deployment amber. Found by reading the engine source.
- Accessibility. axe on every page in both themes found an unlabelled file input, a sideways-scrolling session clock the keyboard couldn't reach, and top bars outside any landmark. All fixed; `e2e/a11y.spec.ts` runs axe on every page.
- A phone layout shift of 0.13 on the portal against the test's own 0.05 limit, because the loading skeleton was shorter than the screen. Found by the existing test.
- A dropped file over 10 MB vanished without a message. Found by trying it. It shows the same error as the button now.
- `npm run typecheck` failed on a fresh clone. It generates the route types first now.
- A front-page test failed once on this Mac, by 2^-14 px. It measured the terminal while the page's 160 ms fade-in still had a transform on it. Found by repeating it 100 times and then holding the fade halfway, which gave the same number. The test waits for the fade now.
- Symbols with a quote in them. Python's `!r` writes O'NEIL in double quotes, and five explanation patterns accepted only single quotes. Found by reading the engine's format strings.
- Refusal-streak tickets opened once per deployment, ever, so a second streak weeks later was logged as "already open". Found by the review reading the rule. The ticket id now carries the streak's first session.
- The forwarder skipped a replaced file's unsent tail without a word. It records the file size at each read and warns with the byte count, or says it can't tell.
- The link preview fetched "→" from Google Fonts on every render. Found with a test that blocks the network. The arrow is drawn now.
- The build traced the whole project into the server output (252 project files, from `README.md` to every screenshot) because of a path held in a variable in `migrate.ts`. Found from the build warning. It traces 33 files now, and `e2e/trace.spec.ts` reads the trace after every build.
- No Content-Security-Policy. Production now sends one, and `e2e/csp.spec.ts` loads every page with zero violations.

**The ingest benchmark.** Every webhook batch read every stored line, re-parsed the whole stream and rebuilt the sessions table, so a batch got slower as the stream grew. Now each new line goes in on its own date, a cancel's session is looked up from its place in SQL, and only the sessions the batch touched are recounted. On this Mac, 40 batches of 500 lines on PGlite (`npm run bench:ingest`):

| Stored lines | Before | After |
|---|---|---|
| 0 | 314 ms | 299 ms |
| 10,000 | 420 ms | 294 ms |
| 19,500 | 557 ms | 298 ms |

The change was gated on `store.diff.test.ts`, which runs the old store and the new one side by side on 200 random streams, 3,128 batches, and requires the same rows and the same response after every batch. They differ in one case, tested on its own: the old store let a place line the database had just refused set a cancel's session until the next batch.

**Still open:**

- The CSP allows inline scripts. Next's bootstrap needs them unless every page gets a nonce, and a nonce would make the prerendered demo dynamic.
- The new index (`20261014120000_dry_run_id_index.sql`) has to be pushed to any real database. None exists yet.

**Before shipping, one more review.** A fresh Claude Code session that had not seen the work read the whole diff since the live deploy and looked for bugs, security holes, missing tests and claims the code doesn't back up. It found no blocker and seven things, all fixed here with a test that failed first:

- The wider guard blocked 11 ordinary support sentences ("Your refusal rate will drop once you raise the cap"). Narrowed, as described above.
- The public-demo gate knew only Vercel. A static build served with `next start` or Docker with a key set was open. It fails closed on every host now.
- No test called the AI routes themselves, so deleting the origin check from one would pass every suite. `src/app/api/ai-routes.test.ts` calls each route.
- After a failed drop, a file opened with the button left the old error on screen.
- A browser holding demo state from before the streak fix would open the same streak twice. The saved-state version is 2 now, so that state loads as the seed.
- The docs said `npm test` takes about 40 s; it took a minute. Rerunning the suites after the fixes then showed PGlite setup hooks timing out under that load, 2 runs in 4. `npm test` runs 20 of the 200 streams now (about 15 s); `npm run test:full` runs all of them.
- Wrong numbers in the docs: the old guard missed 24 of 25 phrasings, not 18 of 21, and `PUBLISH.md` showed `ai-status` without its `reason`.

**After that ship.** A key pressed in the first moments after load was lost. On a CPU slowed 6x, the page paints 18 to 348 ms before React attaches its keyboard listener, and a `?` pressed in that window did nothing. The fixed theme script in the page head now also queues up to 8 keys, and the shortcuts replay them once they're listening. The test holds the scripts back on the slowed CPU and presses `?` on the painted page; it failed before.

**The guard, measured, and a lesson in overfitting.** Until 15 Oct the guard's quality was a claim. I wrote 300 texts it must catch and 300 support sentences it must pass, split each 70/30 with a fixed seed, and tuned only on the 70. The held-out 30 looked excellent: 69 of 90 caught, no support sentence flagged. A pre-ship review then wrote 30 ordinary support sentences against the new patterns, such as "Stock prices can fall as well as rise", and the guard blocked all 30: my own pass set never used the words the tuning had added. I narrowed the patterns, then measured on a blind set a separate session wrote without seeing the code. There the guard now catches 67 of 120 (55.8%; main caught 37) and flags none of 200 support sentences (main flagged 3). It also undoes look-alike letters, invisible characters and spelled-out words before matching, while still highlighting the original text, and other clients' names are matched the same way, accented or Cyrillic. About 44% of the blind advice and promises still get through. A phrase list is not a compliance review: a person still reads and approves every reply. Method and every number: `src/lib/guard.eval/README.md`.

**The first 90-day task: a link check.** `tools/link-check/` checks the links on five public Limex start pages, one level deep, with Node and `fetch` only. It reads and obeys every `robots.txt`, sends one request per second per host, follows redirects by hand so every hop gets the same checks, never asks a private address, and sends HEAD before GET. Discord invites go to Discord's invite API, because a dead invite's page still answers 200. The first run found one thing a status check cannot see. www.limex.com answers every path with 200 and the same app shell, so `/privacy` looks alive while the browser shows "404". The tool asks each host for a made-up path, and a link that gets that same page and is missing from the sitemap is listed as probably broken, to confirm in a browser. Reports are git-ignored: a list of another company's broken links doesn't belong in a public repo. A fresh review before this ship found that the first version let redirects skip robots.txt and the delay, sent the GET retry in the same instant as the HEAD, and would request private addresses. Each is fixed with a test that failed first, and the spacing test runs on a virtual clock, so removing the delay fails it.

**How AI was used.** The review ran as a separate Claude Code session from the one that built the console, so it read the code cold. Every fix, in the review and after it, came with a test that failed on the old code first, and each commit message says what that test showed.

## Numbers

Counted after the second review, 14 Oct 2026.

| | |
|---|---|
| Commits | 68 here, 2 on ziplime's `feat/dry-run-orders` |
| Unit and integration tests (vitest) | 579 in 32 files with `npm run test:full` (572 in `npm test`, which runs 20 of the 200 ingest streams), 2 skipped on purpose (one needs a real Postgres) |
| Browser tests (Playwright) | 78 in the main suite (9 run on one screen size only), 2 in the ingest suite |
| Link check tests (node --test) | 37, offline |
| Forwarder tests (pytest) | 24, and 1 more with hypothesis installed |
| ziplime dry-run tests | 13 test functions in `test_lime_dry_run.py` |
| Seed data | 503 dry-run lines written by the engine, 14 deployments, 135 sessions, 10 accounts, 30 signups, 7 tickets |
| Pages | 8 |
