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

## E. Open questions — all resolved 2026-09-17

> **Resolved.** 1: `Dans Team` is **Other Dan** (distinct from Dan Schwartz), 
> `BenFranklinRodriguez` is **Rob**, `Lonley Picards` is **Billy**. 2: GUIDs are not 
> published, and identifying information stays out of published output generally. 
> 3: `placement` tag approved. 4: the 2016 zero-stat week is a real result, not a gap 
> — the roster held 21 players, 20 benched and 1 on the disabled list, and the team 
> completed no games while every other team played 92 to 104. 5: the pre-2024 tiebreak 
> was head-to-head, changed to regular-season record in 2024; it cannot resolve 2020's 
> tie because those two teams never played each other, so Yahoo's rank stands and 2020's 
> last place is Will. 6: the client timeout is fixed. The original questions follow.


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
