# Trophy Room — Stage 1 pipeline report

Generated 2026-09-18 by `npx tsx src/trophy/report.ts` from the shards
in `data/kp/trophy/`. Every figure is read back off disk, not carried over from the build.

## Shard sizes

GitHub Pages serves these gzipped, so the compressed column is what a phone actually pulls.

| Shard | Raw | Gzipped | Rows |
|---|---|---|---|
| `seasons.json` | 117 KB | 14 KB | 18 seasons |
| `weekly.json` | 333 KB | 100 KB | 4,848 team-weeks |
| `matchups.json` | 79 KB | 19 KB | 2,424 matchups |
| `transactions.json` | 636 KB | 107 KB | 10,416 transactions |

**Recommendation: do not split `weekly.json` per season.** Stored positionally it is 333 KB raw and 100 KB over the wire, smaller than `kp/matchups/2026.json` (392 KB) which the app already loads for a single season. The Stage 4 records wing ranks all-time top and bottom fives, so it needs every season at once; splitting would turn one request into eighteen and make the tables wait on the slowest.

Everything except transactions comes to 133 KB gzipped. `transactions.json` is the one heavy shard and belongs only to the records wing that uses it, so it should be lazy-loaded — which `useJson` already does by only fetching a path when a view asks for it.

## Validation, season by season

| Season | Team-weeks | Matchups | Reg. weeks | Champion | Runner-up | Last (reg.) | Standings recompute | Gaps |
|---|---|---|---|---|---|---|---|---|
| 2009 | 280 | 140 | 21 | Dan | Galen | Brudner | pass | no at-bat denominator |
| 2010 | 280 | 140 | 21 | mike | Rob | Mark | pass | week 23 Jamison completed no games (consolation); no at-bat denominator |
| 2011 | 280 | 140 | 21 | Nick | Hingston | Mark | pass | 2 transactions unavailable; no at-bat denominator |
| 2012 | 268 | 134 | 20 | mike | Mark | Other Dan | pass | no at-bat denominator |
| 2013 | 280 | 140 | 21 | joey | KC | Other Dan | pass | no at-bat denominator |
| 2014 | 280 | 140 | 21 | Hingston | joey | Will | pass | no at-bat denominator |
| 2015 | 280 | 140 | 21 | Hingston | mike | Nick | pass | no at-bat denominator |
| 2016 | 280 | 140 | 21 | Mark | Dan | joey | pass | week 23 Jamison completed no games (placement); no at-bat denominator |
| 2017 | 280 | 140 | 21 | Brudner | joey | Galen | pass | no at-bat denominator |
| 2018 | 280 | 140 | 21 | Hingston | mike | KC | pass | no at-bat denominator |
| 2019 | 280 | 140 | 21 | KC | Nick | Hingston | pass | no at-bat denominator |
| 2020 | 100 | 50 | 7 | mike | joey | Will | pass | no at-bat denominator |
| 2021 | 280 | 140 | 21 | Galen | Will | Brudner | pass | no at-bat denominator |
| 2022 | 268 | 134 | 20 | KC | Galen | Will | pass | no at-bat denominator |
| 2023 | 280 | 140 | 21 | Dan | Galen | Nick | pass | none |
| 2024 | 280 | 140 | 21 | Brudner | Hingston | joey | pass | none |
| 2025 | 280 | 140 | 21 | Dan | Jamison | mike | pass | none |
| 2026 | 292 | 146 | 22 | — | — | — | pass | none |

## Checks

| Check | Result | Cases |
|---|---|---|
| regular-season standings recompute from the stored matchups | pass | 216 |
| every regular-season week is a full slate | pass | 363 |
| each matchup's W+L+T equals the season's category count | pass | 2,424 |
| the computed champion won the championship final | pass | 17 |
| no consolation result is ever tagged championship | pass | 88 |
| every weekly row is well formed and uniquely keyed | pass | 4,848 |
| team-weeks and matchups agree | pass | 18 |
| every scored category is classified as a rate or a counting stat | pass | 12 |
| week metadata is internally consistent | pass | 416 |
| transactions reference known owners, players and seasons | pass | 10,416 |
| keepers and first picks resolve to real owners | pass | 18 |
| every reported keeper set is five per team | pass | 12 |

No season failed validation.

## Known gaps

Everything the shards cannot answer, and why. Nothing here is interpolated.

| Season | Gap | Effect |
|---|---|---|
| 2011 | Transaction at list index 93 | Yahoo returns HTTP 400: the transaction references a player record it has deleted. Transaction counts for 2011 are a known undercount by one. |
| 2011 | Transaction at list index 166 | Yahoo returns HTTP 400: the transaction references a player record it has deleted. Transaction counts for 2011 are a known undercount by one. |
| 2009–2022 | No at-bat denominator | Yahoo only carries the H/AB display stat from 2023 on, so the minimum-AB qualifier for AVG and OBP cannot be applied to these seasons. Innings pitched is present throughout, so ERA and WHIP qualify normally. |
| 2010 | week 23 Jamison completed no games (consolation) | Not a missing value. The roster was in place and every player benched, so the counting categories are genuinely zero and the rate categories are undefined. |
| 2016 | week 23 Jamison completed no games (placement) | Not a missing value. The roster was in place and every player benched, so the counting categories are genuinely zero and the rate categories are undefined. |

No season is missing a week, a matchup, a standings row, a champion or a category value.
