# Trophy Room — Stage 8: polish and accuracy audit

Everything below was produced by a script that can be re-run. No figure in this
document was typed by hand, and where something could not be verified it says so
rather than being left out.

## Validation

Two validators now run, and they check different things.

`backfill.ts` validates the shards it is holding immediately before writing
them. That is the right place to stop a bad build, but it only ever sees what
that particular run produced.

`verify.ts` is new in this stage and reads the seven files on disk — the same
files the site fetches — and re-runs every check against them. It also treats a
check that examined zero rows as a failure rather than a pass. That guard exists
because of a real defect found here: a run with `--skip-transactions` handed the
validator an empty transaction shard, every row in it was trivially well formed,
and it reported a pass while the 10,416-row file sat beside it unexamined. The
backfill now says plainly when it has skipped them.

Current result, against the published files:

| Check | Rows examined |
|---|---|
| Regular-season standings recompute from stored matchups | 216 |
| Every regular-season week is a full slate | 363 |
| Each matchup's W+L+T equals the season's category count | 2,424 |
| The computed champion won the championship final | 17 |
| No consolation result is tagged championship | 88 |
| Every weekly row is well formed and uniquely keyed | 4,848 |
| Team-weeks and matchups agree | 18 |
| Every scored category is classified rate or counting | 12 |
| Week metadata is internally consistent | 416 |
| Transactions reference known owners, players and seasons | 10,416 |
| Keepers and first picks resolve to real owners | 18 |
| Every reported keeper set is five per team | 12 |

18,848 rows across 12 checks, zero failures. The curated entries were checked
against the record they cite: zero fatal, zero warnings.

Separately, `matrix-check.ts` confirms all 15 owners' head-to-head totals
reconcile exactly with the all-time standings across 52,272 category decisions.
The test suite is 309 tests in 17 files, all passing, and `tsc` is clean.

## Accuracy audit

20 displayed numbers were sampled with a seeded generator and each traced back to
the raw Yahoo payload behind it. 20 of 20 matched. The sample, the seed and the
per-row trace are in [stage8-audit.md](stage8-audit.md). Re-drawing the sample is
one flag away, so this is a repeatable check rather than a one-time claim.

## Accessibility

`scripts/a11y.mjs` drives the real pages in both themes across all ten routes,
checking heading order, accessible names, tap-target size, table semantics,
keyboard reachability and visible focus.

| Width | Elements examined | Issues |
|---|---|---|
| 390px | 878 | 0 |
| 1200px | 878 | 0 |

Tap targets are held to the WCAG 2.2 minimum of 24 by 24 CSS pixels, with the
inline-in-text exception applied where it genuinely applies rather than padded
around. Focus visibility is tested with real Tab presses, because calling
`element.focus()` does not set `:focus-visible` in Chrome and testing it that way
reports a missing focus ring on a page that has one.

Contrast has its own script, since it is the one thing the structural audit
cannot see: `scripts/contrast.mjs` composites translucent backgrounds and
resolves `color-mix()` before measuring. 2,388 text nodes checked across both
themes, none below WCAG AA.

## Mobile

Every wing was captured at 390 by 844 and at 1200 by 900, in both themes: 32
full-page captures in `docs/trophy-room/screenshots/`. That directory is
gitignored, because 24 MB of PNGs does not belong in the history; regenerate it
with `scripts/screenshot.mjs` against a running dev server. One real defect was found and fixed in this stage: the Rivalries
matrix let its horizontal scroll escape into the document, so the whole page
scrolled sideways by 31.5 pixels at 1200px. `min-width: 0` was not enough;
`contain: paint` fixed it, and the sticky owner column still holds.

## Load

Measured against a production build, with each shard's size taken after gzip,
because `vite preview` serves uncompressed and GitHub Pages does not.

| Wing | Data, compressed |
|---|---|
| Landing | 14 KB |
| Champions | 40 KB |
| Records | 114 KB |
| Owners | 133 KB |
| Rivalries | 33 KB |
| Hall of Shame | 22 KB |
| Archive | 140 KB |
| Museum | 15 KB |

Per-wing lazy loading works: the landing page does not pull the transaction log,
and the records wing does not pull the curated content. The heaviest wing is the
Archive at 140 KB, which is the transaction shard. The app bundle is about 399 KB
raw on top and is cached after the first visit.

## Draft copy in production

Checked against a production build served by `vite preview`, not against the dev
server, because the two deliberately behave differently.

| Wing | Curated entries | Draft badges | Draft tags | Footnotes with copy |
|---|---|---|---|---|
| Champions | 0 | 0 | 0 | 0 |
| Hall of Shame | 0 | 0 | 0 | 0 |
| Museum | 0 | 0 | 0 | 0 |

The draft text does not reach the DOM at all — it is not hidden with CSS, it is
absent. All 34 generated blurbs and all 3 curated entries are still `draft`, so
this is the expected result and not evidence that approval works. Approving one
and re-running this check is the thing that would prove that.

## Emoji

183 source, documentation and built files were scanned, including the compiled
bundle. None found anywhere in the project.

Three pre-existing glyphs outside the Trophy Room were removed to get there: a
dingbat close glyph in the player drawer, now an ordinary multiplication sign
that renders identically; a check mark in the README phases list; and a warning
sign in AUTH.md. Arrows are excluded from the scan deliberately — they are
typographic punctuation, they appear in comments throughout the codebase, and
treating them as emoji would be a false positive.

## What is still outstanding

1. **Nothing is approved.** All 34 blurbs and all 3 curated entries are `draft`.
   They are readable in `npm run dev` and render nowhere else. Until some are
   approved, a deployed Trophy Room shows its computed records and none of its
   writing. This is the design working as specified, not a defect.
2. **CI does not rebuild the record book.** The shards are published to the
   `data` branch directly and survive every refresh, because the refresh
   workflow restores that branch and force-pushes it back untouched. What CI
   does not do is regenerate them, so after a season finishes the rebuild is a
   local `npm run fetch:trophy -- --refresh current` followed by a push. That is
   an annual operation on a workflow that carries a fragile token chain, so
   automating it was not worth the risk.
3. **Two 2011 transactions are unrecoverable.** Yahoo returns HTTP 400 for them,
   citing a player key that no longer exists. Paging isolates the failure to
   exactly those two records out of 10,416. The archive says the count is
   incomplete for that season rather than quietly reporting a smaller number.

## Changes made while going live

**Owner ids no longer carry surnames.** The `id` in `owners.json` is published
in `seasons.json` and appears in every owner-page URL. Two of them were built
from Yahoo nicknames that are full names, which would have put a surname into a
shareable link on a public site. Ids are now derived from the display name
(`hingston`, `dan`, `brudner`, `bennett`, `will`), matching the slugs the retro
views already used. The Yahoo nicknames stay in the source file because they are
how a team is matched to a person, but they are no longer published. A scan of
all seven shards finds no league member's surname; the one remaining hit for
"swan" is the player Dansby Swanson.

**The style sample is gone from production.** It is a component reference, not a
wing, and it is now gated on the same flag as draft copy. The landing page shows
no link to it and the direct URL falls back to the Trophy Room.
