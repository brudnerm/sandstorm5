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
npm run fetch:live        # standings + scoreboards + manifest (incremental)
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
- **Phase 2** — waiver wire & analytics (free-agent pipeline, trends)
- **Phase 3** — transaction history redesign + draft history
- **Phase 4** — hall of fame + cross-season trends
