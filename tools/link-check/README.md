# Link check

Checks the links on five public Limex start pages, one level deep. Node standard library and `fetch` only.

```sh
npm run link-check                         # report in tools/link-check/reports/ (git-ignored)
node tools/link-check/check.mjs --out ../audit/link-check-<date>.md
npm run test:link-check                    # offline unit tests, fixtures only
```

The GitHub Actions workflow `Link check` runs it on demand (`workflow_dispatch`, no schedule) and uploads the report as an artifact kept 7 days. The repo is public, so anyone signed in to GitHub can download that artifact. Run it locally if the report should stay private.

## What it does

- Reads the links on each start page: `<a href>`, `rel=canonical`, `og:url`, and JSON-LD `url` and `sameAs`. No crawling past that.
- Reads and obeys every host's `robots.txt` (RFC 9309: the group naming `ziplime-link-check`, else `*`; longest match wins; a 5xx or no answer means stay out). One request per second per host, or the host's `Crawl-delay` if longer. Timeout 10 s.
- HEAD first. On an error status it sends one GET and goes by that, because some servers answer HEAD wrongly and 405 or 501 means HEAD is not allowed.
- 401, 403, 429 and 999 are "could not verify", not broken: those are usually bot walls.
- Discord invites go to `https://discord.com/api/v10/invites/<code>`. The invite page answers 200 for a dead invite.
- Soft 404s: each host gets one request for a made-up path. If it answers 200, the host serves everything. A link that returns the same bytes and is not in the host's sitemap is listed as probably broken. A client-side app can still render such a path, so check those in a browser.
- For each broken link it guesses where the page went: a known live URL or sitemap entry on the same site whose last path segment matches (`/privacy` to `/legal/privacy`).

## Reports stay out of git

`tools/link-check/reports/` is in `.gitignore`. A committed list of another company's broken links reads as criticism.
