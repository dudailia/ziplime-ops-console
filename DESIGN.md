# Design direction: the desk

The console is a trading desk's back office, not a marketing site. People read it the way a desk reads a blotter: scanning columns, comparing numbers, looking for the one row that is wrong. Everything below serves that.

## Principles

1. **Dense but calm.** Lots of data on screen, almost no decoration. Colour is reserved for meaning, so a red mark always means a refused order and nothing else is red.
2. **One accent, used sparingly.** Lime marks *where you are and what to do next*: the primary action on a screen, the current nav item, the selected session, focus, the tour's spotlight. Never a fill behind data, never a status.
3. **Numbers are first-class.** Tabular figures everywhere. Numeric columns right-aligned. Counts never move when they change.
4. **Alignment is a grid, not a vibe.** Panels share one 16 px inner gutter. Labels, values and table columns line up across panels on the same row.
5. **Hierarchy from size and width, not colour.** Archivo's width axis does the work: wide and heavy for page titles and dates, condensed for dense table cells, normal for prose.
6. **Motion explains a change or it doesn't happen.** See Motion.

## Colour

Event and health colours carry meaning and appear nowhere else. The accent is a fill with dark text on it in both themes, so it never has to pass contrast as text on white.

| Token | Day | Night | Job |
|---|---|---|---|
| `ground` | `#eef0f2` | `#0d1215` | Page background |
| `surface` | `#ffffff` | `#141a1e` | Panels |
| `sunk` | `#f5f6f8` | `#10161a` | Hover, selected row, code wells |
| `ink` / `ink-2` / `ink-3` | `#12181c` / `#4a5761` / `#5f6b75` | `#e4e9ec` / `#a4b0b8` / `#7a8790` | Text, three steps |
| `rule` / `rule-strong` | `#dde1e5` / `#b3bcc4` | `#232c32` / `#3a464e` | Hairlines, control borders |
| `accent` | `#c5ef3a` | `#c5ef3a` | Lime fill: primary button, current marker, spotlight |
| `accent-ink` | `#4c7300` | `#c5ef3a` | Lime as text or a 2 px line (5.6:1 on white) |
| `on-accent` | `#12181c` | `#0d1215` | Text on the lime fill |
| `place` / `refuse` / `skip` / `cancel` | blue / red / amber / grey | lifted for dark | The four dry-run events |
| `ok` / `warn` / `bad` | green / ochre / deep red | lifted for dark | Account health, always with a word |

All text tokens pass 4.5:1 on `surface` and `ground` in both themes. Night is the default look for the front door's hero shot, and day must be just as finished.

## Type

- **Archivo** (variable, `wdth` 62 to 125). One family for everything except code.
  - Page titles and session dates: wide (118%), weight 760, tracking -0.01em.
  - Panel titles: semi-condensed (90%), weight 600, 15 px.
  - Table cells, chips, meta: condensed (80%), 12 to 13 px.
  - Prose: normal width, 14 px, 65 to 72 ch measure.
- **IBM Plex Mono** only for things that are literally code or data: env vars, order ids, raw JSON lines.
- Scale (px): 11, 12, 13, 14, 15, 18, 26, 34, 48. No fluid type in the app; the front door's headline is the one clamp.

## Layout

- Desktop: a 224 px rail (full height, sticky), content in a 12-column grid with 16 px gaps.
- Phone: brand row, sample band, content, and a 5-item tab bar on the bottom edge with 52 px targets.
- Panels: 1 px `rule` border, 6 px radius, no shadow. Controls: 4 px radius. One elevation exists: the tour card and the shortcut sheet, with a soft offset shadow, because they float over the page.
- Rows: 32 to 36 px in tables, hover tint on every row so the eye can track across.

## Motion

Each animation has a job. Each element animates for 250 ms or less unless noted, use `cubic-bezier(0.23, 1, 0.32, 1)` (strong ease-out), and collapse to a plain fade or nothing under `prefers-reduced-motion`.

| Moment | Job | How |
|---|---|---|
| Session clock marks | Show the session happen in time order | Each mark fades and scales from 0.6 with a delay proportional to its minute, 450 ms total |
| KPI numbers | Draw the eye once, on first view | Count up over 600 ms, once per page load; width reserved so nothing shifts; the real value is always what assistive tech reads |
| Order tape rows | Show the list arrived | 140 ms fade and 4 px settle, 18 ms stagger, capped at 12 rows |
| Guard highlights | Show each risky phrase being found | Highlights sweep in one after another, 90 ms apart |
| Approve | Make the state change unmistakable | The new sent message or approved line flashes lime once and fades over 1.4 s; it never delays the click |
| Page change | Keep continuity without waiting | 160 ms fade of the main column |

Never animated: keyboard shortcuts, sorting, filtering, typing. Data is never hidden while it animates for longer than the stagger window.

## Anti-references

- No Limex logo or wordmark. "ziplime" is set in plain Archivo as text.
- No hero-metric cards, gradient text, glass, or decorative charts.
- No eyebrow labels in caps above headings.
- No icon-in-a-circle feature grids.

Reduced motion: page, card and tape fades shorten to 120 ms with no movement; clock marks, guard sweeps and count-ups show their final state at once; press scaling is off; the approve flash stays because it confirms an action.
