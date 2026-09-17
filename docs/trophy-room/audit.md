# Trophy Room — Stage 0 audit

## What this covers

Repo mapping, a full pull of all eighteen Keeping Pattycakes seasons from Yahoo, a
draft owner map, and a per-season data-availability report. No UI was built.

The computed half of this document lives in `audit-generated.md`, produced by
`src/trophy/write-audit.ts` from `data/.cache/trophy-recon.json`. Every figure there is
derived by code from cached raw Yahoo responses. Read the two together.

---

## A. Repo map

**Framework.** React 19 + Vite 8, TypeScript, Vitest. No router library, no state
library, no CSS framework. `npm run dev` serves the app and the local data shards
together on port 5173 (`.claude/launch.json` already defines this).

**Three layers, enforced by convention** (`README.md`):

| Layer | Role |
|---|---|
| `src/domain/` | Pure types and logic. Stats are keyed by `(role, stat_id)`, never by abbreviation. `leagues.ts` is the one hand-maintained registry. |
| `src/yahoo/` | The single typed Yahoo client (`client.ts`) plus one normalizer per endpoint. Nothing else in the codebase issues HTTP to Yahoo. |
| `src/pipeline/` | Thin CLI jobs: fetch, normalize, write a shard. |

**Routing** is a 60-line hash router, `app/lib/router.ts`. A route is
`#/{leagueId}/{view}[/{week|slug}]`. Views are a string union plus a `VIEWS` array;
adding a view means adding it to both, adding a tab to `TABS` in `app/App.tsx`, and
rendering the component. The third path segment is parsed as a week number for most
views and as a slug for `retro` — the same fork the Trophy Room needs for its wings.

**Data loading** is `app/lib/useJson.ts`: a `fetch` hook with a module-level `Map`
cache, keyed by path, called with page-relative paths like `data/kp/live.json`. It
never refetches a path twice in a session. Shards are served from the `data` branch,
copied next to the built app at deploy time by `vite.config.ts` and the Deploy
workflow.

**Theme system.** `app/styles.css` defines CSS custom properties on `:root` and
overrides them under `:root[data-theme='dark']`: `--bg`, `--surface`, `--surface-2`,
`--border`, `--text`, `--text-2`, `--text-3`, `--accent`, `--accent-soft`, `--win`,
`--loss`, `--tie`, `--live`, `--shadow`, `--radius`. `index.html` sets
`documentElement.dataset.theme` before first paint from `localStorage` or the OS
preference, so there is no flash. Both modes are real and must both be supported.

**The Season review tab is the template.** Commit `bd42805` added it in four files and
304 lines: a view component, a stylesheet, one `TABS` entry plus one render branch in
`App.tsx`, and the router change for slug segments. Its content shard,
`kp/retro/{season}.json`, is hand-written prose published on the data branch, so
releasing an article is a data-only change that never touches `main`. `app/retro.css`
also shows the house pattern for a section with its own visual language: a separate
stylesheet, a prefixed class namespace, and a serif display face layered over the
app's system sans, while still drawing every colour from the shared tokens. The
Trophy Room should follow all of this exactly.

---

## B. Yahoo access — read this first

**The refresh-token chain is safe to use locally, contrary to what `AUTH.md` warns.**
`AUTH.md` says local fetching forks CI's token chain and kills it. That was true when
written. It is not true now: the `YAHOO_REFRESH_TOKEN` secret was last written
2026-08-13, and the scheduled refresh that ran at 00:28 UTC today refreshed
successfully and **skipped** its "Store rotated refresh token" step, meaning
`needs_store` was false and Yahoo returned the same refresh token it was given. Yahoo
is no longer rotating this app's refresh token, so local and CI use the same token
without orphaning each other. The MCP server refreshed against the same app yesterday
morning and the three CI runs after it all succeeded.

I copied `.env` from the main checkout into the worktree (it is gitignored). All
recon went through the repo's own `src/yahoo/client.ts`, which already handles
pacing, retry and 401-refresh, wrapped in a new disk cache at `src/trophy/cache.ts`.

**Yahoo has stopped returning manager GUIDs.** This is the single biggest finding in
Stage 0 and it cuts against the brief's instruction to key everything on the Yahoo
manager GUID. Every endpoint — `league/{key}/teams`, `/standings`,
`/teams/managers`, `team/{key}/metadata`, and `users;use_login=1/.../teams` — now
returns the literal string `--hidden--` in place of every `guid`, including for the
authenticated user's own teams. The live site's published `kp/live.json` carries
`--hidden--` for all twelve managers today. A cache in the MCP server's repo from
March 2026 has real 26-character GUIDs for the twelve current managers, so the change
landed between March and now.

Consequences:

- Real GUIDs are recoverable for the **twelve 2026 managers only**, from
  `yahoo-fantasy-baseball-mcp/data/team_owners.json`. This repo is public, so I have
  **not** committed them: they sit in the gitignored
  `data/.cache/trophy-owner-guids.json`, and `yahooGuid` is `null` in the draft
  `owners.json` pending your answer to question 2. A commit is permanent, so this is
  the one decision worth making before Stage 1 writes anything.
- For the three departed managers there is no GUID and no nickname — Yahoo hides both.
- The pipeline therefore cannot use GUID as its join key. The draft `owners.json`
  introduces a stable slug `id` instead, and the pipeline joins historical
  team-seasons to owners by `(season, teamName)`, which is exact because the
  season-to-team-name mapping is itself taken from Yahoo.

I would also **not publish the GUIDs** to the data branch. It is a public repo serving
a public Pages site, Yahoo itself now withholds these identifiers, and the slug does
every job the GUID would. My recommendation is to keep `yahooGuid` in the repo-side
`owners.json` and strip it from anything written under `kp/trophy/`. Say the word if
you want it published anyway.

---

## C. Identity: who is who

Twelve managers appear in every one of the eighteen seasons or close to it, and their
Yahoo nicknames are stable and still exposed. Two slots churned early:

| Slot | 2009 | 2010–2011 | 2012–2013 | 2014–2026 |
|---|---|---|---|---|
| A | `Lonley Picards` | `BenFranklinRodriguez` | KC | KC |
| B | `Dans Team` | `Dans Team` | `Dans Team` | Will Youmans |

The three names in backticks are team names, not managers: those eight team-seasons
have **no nickname and no GUID**, so I cannot tell whether they are three people who
left the league or earlier accounts belonging to KC and Will. The spans are
suspiciously complementary — `Lonley Picards` + `BenFranklinRodriguez` + KC covers
2009–2026 exactly, and `Dans Team` + Will Youmans does too — which is consistent with
either reading. I have not guessed. They are three separate entries in `owners.json`
with `displayName: "TODO"`.

Note also that `Dans Team` is **not** Dan Schwartz. The Yahoo nickname `Rich Garcis`,
which the brief identifies as Dan, appears in all eighteen seasons including every
season `Dans Team` existed, so they are two different people.

Proposed display names, all in `docs/trophy-room/owners.json`:

- From the brief: `Swan` → **Hingston**, `Rich Garcis` → **Dan**, `angel escobar` →
  **Brudner**.
- Unchanged from the existing `app/lib/managers.ts`: `Brian Bennett` → **Bennett**,
  `Will Youmans` → **Will**.
- Kept as their own handle, because that is what the league already calls them and
  guessing a real name is out of scope: KC, Mark, Nick, Galen, Jamison, mike, joey.
- **TODO**: the three unidentified early managers.

`app/lib/managers.ts` currently renders `angel escobar` as `Brudner`; the brief says
Matt Brudner. I kept `Brudner` so the Trophy Room matches the rest of the site, but
`owners.json` is the one place to change it if you would rather it read `Matt`.

---

## D. Transactions

Yahoo serves `league/{key}/transactions` for every season, and the list is not capped
— paging past the reported count returns an empty page rather than more rows.

**2011 is partly broken on Yahoo's side, and only 2011.** `league/253.l.89167/transactions`
returns HTTP 400, `Player key 253.p.5737 does not exist` — a transaction referencing a
player record Yahoo has since deleted poisons the whole response. Paging around it
recovers almost everything: fetching 25 at a time isolates the damage to two pages, and
fetching those two pages one record at a time narrows it to **exactly two unrecoverable
transactions**, at list indexes 93 and 166. A full census of all eighteen seasons
(`src/trophy/tx-census.ts`, results in section 8) retrieved 10,416 transactions and lost
only those two. The backfill should page rather than fetch whole, fall back to
single-record fetches on a 400, and record the two missing rows explicitly so 2011 counts
are labelled a known undercount rather than silently wrong.

The MCP server's repo also holds raw transaction payloads for 2009–2025 fetched in
February 2026 (2011 is absent there for the same reason). Those are a useful
cross-check but not a substitute, since they predate this season.

---

## E. Open questions

1. **The three unidentified managers.** Are `Dans Team` (2009–2013),
   `BenFranklinRodriguez` (2010–2011) and `Lonley Picards` (2009) three people who
   left the league, or early accounts of Will and KC? If they left, what should the
   Trophy Room call them? They own two last-place finishes and one runner-up, so they
   will appear on the page either way.

2. **Publishing GUIDs.** I recommend keeping manager GUIDs out of the published
   shards, for the reasons in section B. Confirm.

3. **The 5th-place game is in Yahoo's championship bracket.** The brief says to tag
   matchups `regular | championship | consolation` and to include championship-bracket
   weeks in the weekly records. But Yahoo flags `is_consolation = 0` on the 3rd-place
   and 5th-place games too, not just the title path. In the middle playoff week there
   are three such games: two semifinals and the 5th-place game. My recommendation is a
   fourth tag, `placement`, for games that are neither on the title path nor in the
   consolation bracket, included in weekly records but never described as playoff
   results. The alternative is to fold them into `championship` as Yahoo does.

4. **One zero-stat team-week inside the championship bracket.** 2016 week 23, Xander
   Onatopp, is a non-consolation playoff game in which the team reported no values at
   all in any of the twelve categories. Included as written, it takes first place on
   every "worst week" list. My recommendation: treat a team-week with no reported
   values as data unavailable and exclude it from records, rather than record twelve
   zeroes. It is also `placement` under question 3, which would exclude it a second
   way.

5. **2020's regular-season order below the bracket.** Yahoo assigned `playoff_seed` to
   only the eight teams that made a bracket that year, so the bottom four have none.
   Their final `rank` (9th–12th) is usable because they played no bracket games, but
   two of them are tied on record — 27-48-9 and 28-49-7 both compute to `.375` — and I
   cannot see Yahoo's tiebreak. I propose using Yahoo's `rank` for 2020's bottom four
   and flagging the season in the data. That makes 2020's last place MAINEiacs (Will).

6. **`owners.json` placement.** The draft is at `docs/trophy-room/owners.json` for
   review. I propose promoting it to `src/domain/owners.json` in Stage 1, beside
   `leagues.ts`, since it is hand-maintained identity config of exactly the same kind.

---

## F. What Stage 1 will do differently from the brief

- **One request per season, not one per week.** Yahoo accepts a comma-separated week
  list, so `league/{key}/scoreboard;week=1,2,…,24` returns a whole season's matchups
  and per-category team totals in a single response. The full eighteen-season backfill
  is roughly 18 scoreboard + 18 standings + 18 settings + 18 teams calls, plus about
  450 paged transaction calls. That is minutes, not hours.
- **The cache is already built.** `src/trophy/cache.ts` stores every raw response
  under `data/.cache/yahoo/` keyed by resource path, so reruns cost nothing and the
  backfill is idempotent by construction.
- **Champion determination uses two independent sources.** Trace the bracket, then
  assert it equals Yahoo's final standings rank 1. They agree in all seventeen
  finished seasons today; Stage 1 will fail loudly if they ever disagree.
- **`src/yahoo/client.ts` needs a request timeout.** It calls `fetch` with no
  `AbortSignal`, so a stalled Yahoo connection hangs forever rather than retrying. That
  is exactly what happened during this recon: a transaction run sat dead for ten minutes
  on one request until I killed it. The scheduled refresh workflow has the same exposure
  today. `src/trophy/tx-census.ts` works around it with a 20-second
  `AbortSignal.timeout`; Stage 1 should move that into the shared client.
---

# Computed findings

Generated 2026-09-17 from live Yahoo responses cached under `data/.cache/yahoo/`.
Every figure below is produced by `src/trophy/recon.ts`, `src/trophy/tx-census.ts` and `src/trophy/write-audit.ts`. Nothing here is hand-typed.

## 1. Seasons

| Season | League key | Teams | Weeks | Regular season | Playoffs | Playoff teams | Categories | Finished |
|---|---|---|---|---|---|---|---|---|
| 2009 | `215.l.134803` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2010 | `238.l.429668` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2011 | `253.l.89167` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2012 | `268.l.116014` | 12 | 2–24 | 2–21 (20) | 22–24 (3) | 6 | 12 | yes |
| 2013 | `308.l.61021` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2014 | `328.l.60208` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2015 | `346.l.36240` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2016 | `357.l.2951` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2017 | `370.l.29314` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2018 | `378.l.4717` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2019 | `388.l.12105` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2020 | `398.l.8122` | 12 | 1–9 | 1–7 (7) | 8–9 (2) | 4 | 12 | yes |
| 2021 | `404.l.33954` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2022 | `412.l.13714` | 12 | 1–23 | 1–20 (20) | 21–23 (3) | 6 | 12 | yes |
| 2023 | `422.l.20451` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2024 | `431.l.11978` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2025 | `458.l.19784` | 12 | 1–24 | 1–21 (21) | 22–24 (3) | 6 | 12 | yes |
| 2026 | `469.l.13624` | 12 | 1–25 | 1–22 (22) | 23–25 (3) | 6 | 12 | in progress |

## 2. Scoring categories

The scored-category set is **identical in all 18 seasons**. One signature covers the league's whole history:

- `R HR RBI SB AVG OBP W L↓ SV K ERA↓ WHIP↓` — 2009–2026 (18 seasons)

Display-only stats (shown, never scored) did change:

- `IP` — 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022
- `H/AB IP` — 2023, 2024, 2025, 2026

`↓` marks a category where lower is better. This means every all-time category record is comparable across the full 2009–2026 range, and no "(2015–2026)" style span label is needed for any scored category.

## 3. Week metadata

416 league-weeks total. Day-count distribution:

| Days | Weeks | Classification |
|---|---|---|
| 5 | 1 | `isShort` |
| 7 | 385 | standard |
| 8 | 5 | `isExtended` |
| 11 | 6 | `isExtended` |
| 14 | 15 | `isExtended` |
| 16 | 1 | `isExtended` |
| 19 | 2 | `isExtended` |
| 20 | 1 | `isExtended` |

Only 385 of 416 weeks are a standard 7 days. Every non-standard week:

| Season | Week | Dates | Days |
|---|---|---|---|
| 2009 | 1 | 2009-03-30 → 2009-04-12 | 14 |
| 2010 | 1 | 2010-04-04 → 2010-04-11 | 8 |
| 2011 | 1 | 2011-03-31 → 2011-04-10 | 11 |
| 2012 | 15 | 2012-07-09 → 2012-07-22 | 14 |
| 2013 | 1 | 2013-03-31 → 2013-04-07 | 8 |
| 2013 | 15 | 2013-07-08 → 2013-07-21 | 14 |
| 2014 | 1 | 2014-03-22 → 2014-04-06 | 16 |
| 2014 | 15 | 2014-07-07 → 2014-07-20 | 14 |
| 2015 | 1 | 2015-04-05 → 2015-04-12 | 8 |
| 2015 | 15 | 2015-07-13 → 2015-07-26 | 14 |
| 2016 | 1 | 2016-04-03 → 2016-04-10 | 8 |
| 2016 | 15 | 2016-07-11 → 2016-07-24 | 14 |
| 2017 | 1 | 2017-04-02 → 2017-04-09 | 8 |
| 2017 | 15 | 2017-07-10 → 2017-07-23 | 14 |
| 2018 | 1 | 2018-03-29 → 2018-04-08 | 11 |
| 2018 | 16 | 2018-07-16 → 2018-07-29 | 14 |
| 2019 | 1 | 2019-03-20 → 2019-04-07 | 19 |
| 2019 | 15 | 2019-07-08 → 2019-07-21 | 14 |
| 2020 | 1 | 2020-07-23 → 2020-08-02 | 11 |
| 2021 | 1 | 2021-04-01 → 2021-04-11 | 11 |
| 2021 | 15 | 2021-07-12 → 2021-07-25 | 14 |
| 2022 | 1 | 2022-04-07 → 2022-04-17 | 11 |
| 2022 | 15 | 2022-07-18 → 2022-07-31 | 14 |
| 2023 | 1 | 2023-03-30 → 2023-04-09 | 11 |
| 2023 | 15 | 2023-07-10 → 2023-07-23 | 14 |
| 2024 | 1 | 2024-03-20 → 2024-04-07 | 19 |
| 2024 | 15 | 2024-07-08 → 2024-07-21 | 14 |
| 2025 | 1 | 2025-03-18 → 2025-04-06 | 20 |
| 2025 | 15 | 2025-07-07 → 2025-07-20 | 14 |
| 2026 | 1 | 2026-03-25 → 2026-03-29 | 5 |
| 2026 | 17 | 2026-07-13 → 2026-07-26 | 14 |

Two causes, both structural: week 1 absorbs the ragged start of the MLB season (5 to 20 days), and one mid-July week absorbs the All-Star break (14 days). 2020 is the shortened COVID season.

## 4. Playoff structure

Identical in every full season: three playoff weeks, 4 / 6 / 4 games.

| Season | Round 1 | Round 2 | Final week |
|---|---|---|---|
| 2009 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2010 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2011 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2012 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2013 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2014 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2015 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2016 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2017 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2018 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2019 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2020 | wk 8: 4 games (2 championship, 2 consolation) | wk 9: 4 games (2 championship, 2 consolation) |
| 2021 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2022 | wk 21: 4 games (2 championship, 2 consolation) | wk 22: 6 games (3 championship, 3 consolation) | wk 23: 4 games (2 championship, 2 consolation) |
| 2023 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2024 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2025 | wk 22: 4 games (2 championship, 2 consolation) | wk 23: 6 games (3 championship, 3 consolation) | wk 24: 4 games (2 championship, 2 consolation) |
| 2026 | wk 23: 4 games (2 championship, 2 consolation) | wk 24: 6 games (3 championship, 3 consolation) | wk 25: 4 games (2 championship, 2 consolation) |

## 5. Champions, runners-up and last place

Champion is the winner of the championship-bracket final, computed by tracing the bracket, then cross-checked against Yahoo's final standings rank 1. The two agreed in all 17 finished seasons. Last place is the bottom of the **regular-season** standings (Yahoo `playoff_seed`), never the consolation bracket.

| Season | Champion | Owner | Runner-up | Owner | Last (regular season) | Owner |
|---|---|---|---|---|---|---|
| 2009 | Y'all Got Boned | Dan | mannys still stoned | Galen | Fernandez Spa | Brudner |
| 2010 | The Garza Strip | mike | BenFranklinRodriguez | TODO | A Tribe Called Quest | Mark |
| 2011 | Milton's Crew | Nick | Nova Scotia | Hingston | Gone Fishin' | Mark |
| 2012 | The BraunMower Man | mike | Slippery Horse | Mark | Dans Team | TODO |
| 2013 | TapaGio | joey | Dirty Sånchez | KC | Dans Team | TODO |
| 2014 | Miggy Azalea | Hingston | IfYouWadaBeMyLover | joey | MAINEiacs | Will |
| 2015 | Cant Cutch This | Hingston | Khris from a Rose | mike | Hamilton Bradley Etc | Nick |
| 2016 | Slippery Horse | Mark | Christian Impossible | Dan | Eleven Longoria | joey |
| 2017 | Total Nolar Eclipse | Brudner | J.Deez Nuts | joey | mannys still stoned | Galen |
| 2018 | Christian Scientist | Hingston | Gattis Everdeen | mike | Buehler? Anyone? | KC |
| 2019 | Who's Your Vladdy? | KC | Country Fried Steak | Nick | Nolar Ice Cap | Hingston |
| 2020 | Blake Boss | mike | Dansby Thongsong | joey | MAINEiacs | Will |
| 2021 | mannys still stoned | Galen | MAINEiacs | Will | Walsh Terrier | Brudner |
| 2022 | Who's Your Vladdy? | KC | mannys still stoned | Galen | MAINEiacs | Will |
| 2023 | Nothing Compares to Ryu | Dan | mannys still stoned | Galen | Kirby’s Dream Land | Nick |
| 2024 | Witt Arms Wide Open | Brudner | Hell in a Snell | Hingston | Tatis-ami Mario | joey |
| 2025 | Frieding is Fundamental | Dan | Teen Jus | Jamison | Garcia Wouldn't Wanna Be Ya | mike |
| 2026 | _season in progress_ | | | | | |

Titles by owner: Dan 3, mike 3, Hingston 3, Brudner 2, KC 2, Nick 1, joey 1, Mark 1, Galen 1.

Last places by owner: Will 3, Brudner 2, Mark 2, TODO 2, Nick 2, joey 2, Galen 1, KC 1, Hingston 1, mike 1.

## 6. Weekly scoreboard availability

Per-category team totals are present for every team-week in every season, with three exceptions.

| Season | Week | Team | Bracket | Missing |
|---|---|---|---|---|
| 2010 | 22 | Assault-Rod | consolation | all 6 pitching categories |
| 2010 | 23 | Assault-Rod | consolation | all 12 categories |
| 2016 | 23 | Xander Onatopp | championship (5th-place game) | all 12 categories |

The two 2010 rows sit in consolation games, which the Trophy Room excludes anyway. The 2016 row does not: it is a non-consolation playoff game, so under the Stage 4 rule it would be included and would sweep every "worst week" list with twelve zeroes.

## 7. Validation already passing

| Check | Result |
|---|---|
| Every regular-season week has 6 matchups | pass, all 18 seasons |
| Each team's regular-season W+L+T equals categories × regular-season weeks | pass, all 18 seasons |
| Computed champion matches Yahoo's final standings rank 1 | pass, all 17 finished seasons |
| Computed runner-up matches Yahoo's final standings rank 2 | pass, all 17 finished seasons |
| Every season returns 12 teams | pass, all 18 seasons |

## 8. Transactions

10,416 transactions retrieved across 18 seasons, of which 324 are trades. 2 records are unrecoverable.

| Season | Retrieved | Lost | Trades | Add/drop | Add | Drop | Commish |
|---|---|---|---|---|---|---|---|
| 2009 | 454 |  | 12 | 339 | 43 | 38 | 22 |
| 2010 | 468 |  | 7 | 348 | 52 | 45 | 16 |
| 2011 | 511 | 2 | 9 | 387 | 53 | 52 | 10 |
| 2012 | 603 |  | 8 | 480 | 55 | 52 | 8 |
| 2013 | 610 |  | 13 | 484 | 58 | 51 | 4 |
| 2014 | 658 |  | 20 | 525 | 54 | 47 | 12 |
| 2015 | 646 |  | 29 | 457 | 67 | 72 | 21 |
| 2016 | 646 |  | 28 | 451 | 67 | 63 | 37 |
| 2017 | 660 |  | 21 | 480 | 72 | 67 | 20 |
| 2018 | 711 |  | 29 | 522 | 76 | 72 | 12 |
| 2019 | 691 |  | 23 | 528 | 66 | 62 | 12 |
| 2020 | 289 |  | 5 | 215 | 29 | 23 | 17 |
| 2021 | 523 |  | 20 | 389 | 55 | 48 | 11 |
| 2022 | 574 |  | 23 | 429 | 56 | 54 | 12 |
| 2023 | 587 |  | 22 | 459 | 54 | 47 | 5 |
| 2024 | 577 |  | 16 | 448 | 56 | 49 | 8 |
| 2025 | 594 |  | 15 | 484 | 47 | 40 | 8 |
| 2026 | 614 |  | 24 | 492 | 49 | 41 | 8 |

2011 is the only season with losses: list indexes 93 and 166 reference player records Yahoo has deleted, and return HTTP 400 whether fetched in a page or alone. Paging isolates the damage to these 2 rows; the other 511 are intact.

## 9. Shard sizing

| Shard | Rows | Verbose rows | Positional rows |
|---|---|---|---|
| `weekly.json` | 4,848 team-weeks | 1,577 KB | **327 KB** |
| `matchups.json` | 2,424 matchups | 668 KB | — |
| `transactions.json` | 10,416 rows | 1,882 KB | — |
| `seasons.json` | 18 seasons | small | — |

**Recommendation: keep `weekly.json` as one file for all 18 seasons, and encode its rows positionally.**

Written the obvious way — one object per team-week with named keys, the team name and twelve category names repeated 4,848 times — the shard lands around 1,577 KB. That is four times the largest shard the app ships today (`kp/matchups/2026.json`, 392 KB), and it would be pulled over a phone connection from a group-email link, so at that size a per-season split would be forced.

It is not forced, because the size is self-inflicted. Declaring the column order once in `seasons.json` and writing each team-week as a flat array of numbers — season, week, owner index, days, bracket code, the twelve values, then AB and IP — costs about 69 bytes a row instead of 333, for 327 KB in total. That is smaller than a shard the app already loads, and it keeps every season in one request.

This matters because the Stage 4 weekly-records wing ranks all-time top and bottom fives, which needs every season at once. A per-season split would turn one 327 KB request into 18 requests of about 18 KB each and make the record tables wait on the slowest. Split `weekly.json` only if a later wing needs materially more per row than the record tables do.

`matchups.json` and `transactions.json` stay single files. Neither is on the landing page, so both should be lazy-loaded by the wing that needs them, which the existing `useJson` hook already does by only fetching a path when a view asks for it.
