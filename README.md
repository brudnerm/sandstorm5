# Sandstorm5

Fantasy baseball analytics for our Yahoo leagues — scoreboard, standings,
transaction history, draft history, hall of fame, and waiver-wire trend
analysis. Mobile-first. Successor to Sandstorm4.

## Architecture

Three layers, one type system:

```
src/domain/      Pure types + logic. Stats are keyed by (role, stat_id) —
                 never by abbreviation. leagues.ts is the ONE hand-maintained
                 league registry (identity only; scoring rules are never
                 hand-written).
src/yahoo/       The one typed Yahoo client (auth, pacing, retries) and the
                 one normalizer for Yahoo's nested-array JSON. Fixture-tested.
src/pipeline/    Thin CLI jobs that fetch → normalize → write data shards.
```

Data is delivered as static sharded JSON on the `data` branch, deployed with
the app to GitHub Pages: `data/{leagueId}/settings/{season}.json`, etc. The
client loads a small manifest plus the shards a view needs — never one big
file. Expensive aggregation happens in the pipeline, not on the phone.

### The rule that keeps scoring correct

League scoring is **derived from Yahoo's settings endpoint** per league-season
(`sort_order`, `position_type`, `is_only_display_stat`) and cached as data.
The same abbreviation can score in opposite directions per role — sidebar
scores batter-GIDP (lower is better) *and* pitcher-GIDP (higher is better) —
so nothing may ever key a stat by its abbreviation or hand-encode a
direction. `tests/settings.test.ts` enforces this against recorded fixtures.

## Commands

```bash
npm run dev               # app + data shards at localhost:5173
npm test                  # vitest (normalizer fixtures, GIDP acceptance test)
npm run typecheck
npm run fetch:settings    # settings shards for every league-season (--current for latest only)
npm run fetch:live        # standings + scoreboards + full-season schedule + manifest (incremental)
npm run fetch:players     # rosters × stat windows + free-agent watchlist (needs fetch:live)
npm run fetch:mlb         # MLBAM id map + Statcast expected stats (statsapi + Savant, no auth)
npm run discover-leagues  # print registry entries for all your Yahoo leagues
npm run token refresh     # see AUTH.md
```

## Adding a league or season

Run `npm run discover-leagues`, copy the seasons table into
`src/domain/leagues.ts`, set feature flags, run `npm run fetch:settings`.
That's it — no code changes.

## Delivery phases

- **Phase 0** — foundation: registry, client, normalizer, settings pipeline ✅
- **Phase 1** — MVP: scoreboard + standings, both leagues, deployed ✅
- **Phase 2** — strategy: Home vs-field matrix with per-player breakdowns,
  waiver-wire risers vs roster slumpers (z-score valuation) ✅
- **Phase 3** — transaction history redesign + draft history
- **Phase 4** — hall of fame + cross-season trends

## Strategic views

The **Home** tab is built around a "home team" (persisted per league,
defaults to angel escobar's team): summary tiles plus a matrix of how the
home team's week would score against *every* team, ordered by the schedule
(this week's opponent first, then next meetings). Tapping any row expands
per-player stat lines with week / 7d / 30d / season windows.

The **Strategy** tab values every rostered player and free-agent candidate
as the mean z-score across the league's scored categories (direction from
league settings, per window, population = all rostered + watchlist). Rate
categories are shrunk by playing time (AB/IP from the display stats) so
tiny samples can't top the board. It flags roster spots that are cold for
a month, below league average, *and* backed by real playing time (or hurt
while occupying an active slot — dropped and IL-slotted players are
excluded), pairs them with rising free agents at the same position, and
lists full riser/roster-trend tables.

Tapping any player (Strategy tables, swap cards, or Home roster panels)
opens a profile drawer: production windows, Statcast expected stats and
quality of contact (from the `fetch:mlb` shard, matched by normalized
name), plus live vs-L/R splits, last-10 game log, and transaction news
fetched in the browser from statsapi.mlb.com (which allows CORS).
