# Design direction: ships inside ziplime

The console should read as part of the ziplime product family: the team that built ziplime.limex.com should recognise their own visual language. The tokens below were measured from that site on 14 Oct 2026. It is still a back office, so the desk rules from before still hold: dense but calm, colour only for meaning, numbers first-class.

What we never take: Limex's or ziplime's logo or wordmark. Our mark is our own small bar glyph with "ziplime ops console" set in lowercase JetBrains Mono, which their uppercase General Sans wordmark is not. The "Sample data. Fictional accounts." band and the "Unofficial concept" footer stay on every page.

## Principles

1. **Black ground, thin lines, square corners.** Panels are near-black boxes with 1px borders and no shadow. Corners are 0 on panels and buttons, 2px on small controls.
2. **Lime is where you are and what to do next.** The primary action, the current page, focus, the selected session, the tour spotlight, and one word per headline as a solid block. Wherever dry-run events are drawn (the session clock, the order tape, the history chart, event counts), lime also marks "would send", because that is the engine's own green light. Lime is never a fill behind text. On the account history chart the would-send segment is drawn at 55% so a healthy history doesn't bury the refusals.
3. **Cyan belongs to the dot-matrix word.** One Doto word or phrase per hero, in cyan. Nothing else is cyan.
4. **Mono for anything a machine wrote.** Data, labels, tickers, ids, code, timestamps and the big numbers are JetBrains Mono. Prose is Inter. Headlines are General Sans.
5. **Status colours carry meaning and pass AA on black.** Red means refused (events) or needs help (health). Every status always comes with a word.
6. **Motion explains or announces, once.** See Motion.

## Colour

Night is the default theme and the one to perfect. Day works and is finished, but secondary.

| Token | Night (default) | Day | Job |
|---|---|---|---|
| `ground` | `#000000` | `#f6f4fb` | Page background, with the dot grid |
| `surface` | `#0b0a10` | `#ffffff` | Panels, the ticker strip, the terminal |
| `sunk` | `#16151c` | `#efedf5` | Hover, selected row, code wells |
| `ink` | `#f2f0ff` | `#0b0a10` | Text |
| `ink-2` | `#b4b1c2` | `#4a4757` | Secondary text |
| `ink-3` | `#8f8c9b` | `#5e5b6a` | Muted text, mono labels |
| `rule` | `#1e1d25` | `#e4e1ec` | 1px hairlines between and around panels |
| `rule-strong` | `#6b6878` | `#868294` | Control borders (3:1 for UI boundaries) |
| `accent` | `#a6f656` | `#a6f656` | Lime fill: primary button, current marker, highlight word, spotlight |
| `on-accent` | `#261f48` | `#261f48` | Text on a lime button |
| `on-highlight` | `#0b0a10` | `#0b0a10` | Text in a lime headline block |
| `accent-ink` | `#a6f656` | `#3a7000` | Lime as text or a 2px line |
| `pixel` | `#4dcfe7` | `#0a7489` | The Doto word only |
| `place` | `#a6f656` | `#3a7000` | Would send (clock and tape) |
| `refuse` | `#ff3355` | `#c8143c` | Refused |
| `skip` | `#f5b83d` | `#8a5800` | Skipped below one lot |
| `cancel` | `#8f8c9b` | `#5e5b6a` | Cancelled |
| `ok` / `warn` / `bad` | `#3ddc84` / `#f5b83d` / `#ff5c7a` | `#11784b` / `#8a5800` / `#b01f3a` | Healthy / watch / needs help |

Every text and status token passes 4.5:1 on `ground`, `surface` and `sunk` in both themes; `rule-strong` passes 3:1. `src/lib/design/contrast.test.ts` reads these values out of `globals.css` and fails the build if any drops below. Text on lime is 11.6:1 (`on-accent`) and 15:1 (`on-highlight`).

## Type

| Role | Face | Setting |
|---|---|---|
| Headlines (`t-title`) | General Sans 700 | Uppercase, tracking -0.02em, line height 1.05 |
| Buttons (`t-btn`) | General Sans 600 | Uppercase, 13px (14px large), tracking 0.06em |
| Hero word | Doto 800 | Cyan, same size as the headline |
| Data, labels, numbers, tickers, code (`t-wide`, `t-label`, `font-mono`) | JetBrains Mono | Labels 11px uppercase, tracking 0.06em, with a 6px square lime bullet. A label that is data (an email) keeps its case |
| Body, table cells, prose | Inter | 14px, 65 to 72ch measure |

General Sans is from Fontshare under the ITF Free Font License. The licence lets us self-host it on our own site but not redistribute it through a public repository, so the font files are not in git: `scripts/fetch-fonts.mjs` downloads the official files from Fontshare before each build, checks their SHA-256, and puts them in `src/app/fonts/` (ignored). The licence text is in `src/app/fonts/LICENSE-GeneralSans.txt`. Doto, JetBrains Mono and Inter come from Google Fonts through `next/font`, which self-hosts them. All four are preloaded and get fallback faces with matching metrics, so nothing shifts when they arrive.

## Signature moves

- **Dot grid.** A faint dotted grid on `ground`: 1.3px dots every 32px, 16% white in the hero and 7% behind the app.
- **Lime block word.** One word per headline set in a solid lime block with `on-highlight` text, 0.12em side padding.
- **Mono label with a square bullet.** `■ ENGINE → DRY RUN → CONSOLE`. Used for eyebrows, panel titles and rail groups.
- **Terminal panel.** A `surface` box with a 1px border, a filename bar (lime square, the file path, a line-number chip, a pulsing status dot) and rows tagged like a chat: `ENGINE` and `CONSOLE`. Where ziplime's says LIVE, ours says DRY RUN, because nothing in this console is live and the label must not claim it is.
- **Ticker strip.** A full-width mono strip with real seed events: account, symbol, outcome in its event colour.
- **Buttons.** Primary: lime fill, `on-accent` text, uppercase General Sans, square. Hover goes to `ink`. Secondary: a 10% lavender wash with `ink` text.

## Layout

- Desktop: a 224px rail (full height, sticky), content in a 12-column grid with 16px gaps.
- Phone: brand row, sample band, content, and a 5-item tab bar on the bottom edge with 52px targets.
- Panels: 1px `rule` border, square, no shadow. One elevation exists: the tour card and the shortcut sheet, because they float over the page.
- Rows: 32 to 36px in tables, hover tint on every row so the eye can track across.

## Motion

Each animation has a job. UI motion is 250ms or less with `cubic-bezier(0.23, 1, 0.32, 1)`. Under `prefers-reduced-motion` everything below shows its final state at once, except fades that confirm an action.

| Moment | Job | How |
|---|---|---|
| Hero terminal | Show what the console does with one engine line | Types the real dry-run line (4ms a character), then the explanation (5ms), about 4s in all, once per page load. A Replay button runs it again. The full text is in the DOM from the start, so nothing shifts and screen readers read it whole |
| Ticker | Show the engine is producing events | Scrolls slowly (90s a loop), pauses on hover, on focus and with its pause button |
| Doto word | Announce the hero, like a dot display warming up | Flickers in once on load, 700ms |
| Status dots | Show the feed is running | The lime square and dot pulse, 1.6s |
| Session clock marks | Show the session happen in time order | Each mark fades and scales from 0.6 in minute order, 450ms total |
| KPI numbers | Draw the eye once | Count up over 600ms, once per page load; the real value is the only text |
| Order tape rows | Show the list arrived | 140ms fade and 4px settle, 18ms stagger, capped at 12 rows |
| Guard highlights | Show each risky phrase being found | Sweep in one after another, 90ms apart |
| Approve | Make the state change unmistakable | Flashes lime once and fades over 1.4s; never delays the click |
| Page change | Keep continuity | 160ms fade of the main column |

Never animated: keyboard shortcuts, sorting, filtering, typing in a field.

## Anti-references

- No Limex or ziplime logo or wordmark.
- Cyan only on the Doto word; lime never as a status except "would send" on drawn events.
- No rounded cards, gradients, glass or drop shadows on panels.
- No decorative charts. The ticker and terminal show real seed data.
