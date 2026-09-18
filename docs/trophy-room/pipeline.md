# Trophy Room data pipeline

Four shards under `data/kp/trophy/`, built by `npm run fetch:trophy` from cached
raw Yahoo responses.

| Shard | What it holds |
|---|---|
| `seasons.json` | Per season: league key, categories with sort direction, week metadata, playoff structure, regular-season standings, champion, runner-up, last place, and any notes a reader of those numbers needs first. Also the owner index and the column order the other shards are stored in. |
| `weekly.json` | One row per team-week: season, week, owner, days, bracket, the twelve category values, at-bats, innings, completed games. |
| `matchups.json` | One row per matchup: season, week, both owners, bracket, per-category results, and the winner. |
| `transactions.json` | Every transaction Yahoo will serve, with its players and the owners on each side. |

## Running it

```bash
npm run fetch:trophy
```

Builds every shard from the cache, fetching only what is missing. On a warm cache
this takes about two seconds and issues no requests at all.

| Flag | Use |
|---|---|
| `--refresh <season>` | Re-fetch one season, then rebuild every shard. `current` resolves to the newest season in the registry. **This is the end-of-season job.** |
| `--force` | Re-fetch all eighteen seasons. Rarely needed — finished seasons do not change. |
| `--season <season>` | Process one season only. Implies `--dry-run`. |
| `--dry-run` | Validate and report, write nothing. |
| `--skip-transactions` | Leave `transactions.json` alone. The other three shards build in seconds without it. |

`--season` deliberately refuses to write. The shards are whole-history documents,
so one built from a single season would delete the other seventeen. Use it to
debug a season, `--refresh` to update one.

## Updating at the end of a season

1. Add the new season's Yahoo league key to `src/domain/leagues.ts`. Run
   `npm run discover-leagues` to find it.
2. Confirm every manager resolves. A new owner, or a returning one under a new
   Yahoo nickname, needs an entry in `src/domain/owners.json` — the backfill
   throws rather than attributing a record to the wrong person.
3. Rebuild:

   ```bash
   npm run fetch:trophy -- --refresh current
   ```

4. Read the validation summary it prints. It writes nothing if any check fails.
5. Regenerate the report:

   ```bash
   npx tsx src/trophy/report.ts
   ```

The season only needs one final refresh, after Yahoo marks it finished. Before
that, `is_finished` is false and the champion is deliberately left null rather
than guessed from an unfinished bracket.

## Why a rerun is free

Every Yahoo read goes through `src/trophy/cache.ts`, which stores the raw
response under `data/.cache/yahoo/` keyed by resource path. `data/` is
gitignored, so nothing raw is ever committed. A rerun reads eighteen seasons off
disk and produces byte-identical shards.

The cache also records refusals. Two 2011 transactions reference player records
Yahoo has deleted and return HTTP 400 however they are requested; those are
cached as refusals, listed in `transactions.json` under `unavailable`, and
reported as a known undercount rather than silently dropped.

## Validation

Ten checks run on every build, and the pipeline refuses to write when any fails.
The load-bearing one is the first: each season's regular-season standings are
recomputed from the stored matchup results and compared to Yahoo's own outcome
totals. That is what proves the shards reproduce the league's history rather than
merely containing plausible numbers. All 216 team-seasons currently reconcile
exactly.

The champion is established twice over — by tracing the bracket backwards from
the final, and by Yahoo's final standings rank — and the build fails if the two
disagree.

## Things worth knowing before reading a number

- **Yahoo's consolation flag is not the complement of "championship".** It is
  false for the third- and fifth-place games too. Those are tagged `placement`:
  they count toward weekly records but are never reported as playoff results.
- **At-bats only exist from 2023.** Yahoo carries no H/AB display stat before
  then, so the minimum-AB qualifier for AVG and OBP cannot be applied to earlier
  seasons. Innings pitched is present throughout, so ERA and WHIP always qualify.
- **A team-week with no completed games is a result, not a gap.** Two exist. In
  both the roster was in place and every player benched, so the counting
  categories are genuinely zero and the rate categories are undefined.
- **2020 seeded only its bracket teams.** The regular-season order below the
  bracket comes from Yahoo's final rank, which cannot disagree because those
  teams played no bracket games. The league's pre-2024 head-to-head tiebreak
  cannot resolve its one tie: the two teams never played each other.
