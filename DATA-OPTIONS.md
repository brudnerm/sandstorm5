# Getting data into Sandstorm5: options and implications

**Status:** Option 3 (reduce rotation) is **implemented and tested** as of
2026-08-02. Option 1 (re-authenticate) still needs a human — it requires a
browser sign-in and cannot be automated from here. Options 2, 4, 5 and 6 remain
open decisions.

No Yahoo token was refreshed while writing this or while making the fix;
refreshing would have rotated the chain and made recovery harder.

This document exists because the refresh pipeline stopped producing data on
**2026-07-14** and the obvious fix — "just make a new Yahoo app" — no longer
works. It lays out what is actually true, what each option costs, and what it
risks.

---

## 1. What's actually broken

Two separate problems got tangled together. It's worth keeping them apart,
because they have different fixes.

### Problem A: the token chain broke (this is why data froze)

Sandstorm5 reads Yahoo data using an OAuth "refresh token" — a long-lived
password-like string that can be traded for a short-lived access token good for
one hour.

Yahoo's own documentation says this about refreshing:

> The authorization server **may** issue a new refresh token, in which case the
> client must discard the old refresh token and replace it with the new refresh
> token. The authorization server **will revoke the old refresh token after
> issuing a new refresh token** to the client.
> — [Yahoo OAuth 2.0 authorization code flow](https://developer.yahoo.com/oauth2/guide/flows_authcode/)

In plain terms: **only one refresh token is alive at a time.** Whoever uses it
gets a replacement, and everyone still holding the old one is locked out.

Evidence the chain is dead right now:

| Check | Result |
|---|---|
| `data/manifest.json` freshness | `2026-07-14T00:51:36Z` — frozen for ~3 weeks |
| `token-cache.json` access-token expiry | expired `2026-07-14 01:49 UTC` |
| Yahoo Fantasy connector in Cowork | fails with `Token refresh failed` |

The design amplifies this risk more than it needs to. `refresh-data.yml` runs
**every 15 minutes** during baseball hours and calls `npm run token refresh`
unconditionally on every single run — a forced rotation whether or not the
existing access token is still valid. That's roughly **96 rotations per day**,
and each one must successfully write the new token back into the `GH_PAT`
GitHub secret or the chain dies. It only has to fail once.

An access token lasts an hour. Refreshing 96 times a day to use tokens that
live for 60 minutes is ~4x more rotation than needed at minimum, and the
pipeline already has `getAccessToken()`, which refreshes *only when expired* —
the workflow just doesn't use it. **This is the single most likely root cause,
and it is fixable without changing data sources at all.**

### Problem B: Yahoo closed the door on new apps

This is real, not a site bug, and it's the more consequential change.

Yahoo has **moved the Fantasy Sports API behind an application and approval
process**. The old self-serve documentation URL
(`developer.yahoo.com/fantasysports/guide/`) now redirects to a new portal that
reads:

> Review the API Documentation and requirements, then provide information about
> your organization, your product, and use case(s). **Apply.** … We'll review
> your application and reach out with any follow-up questions. … **If you're
> approved**, we'll follow up with next steps.
> — [Yahoo Fantasy API developer portal](https://sports.yahoo.com/developer/)

This matches exactly what you saw. On the **Create Application** form the only
API Permissions offered are *OpenID Connect Permissions* and *TW Auction* —
Fantasy Sports is gone. But on your three **existing** apps (Sandstorm,
Sandstorm3, Sandstorm4) "Fantasy Sports - Read" is still checked and greyed
out. Greyed-out means locked, not broken: those apps hold a permission that can
no longer be granted through the form.

So the app site being flaky (you can't delete old apps) is annoying but
secondary. The substantive fact is that **your three existing apps are
now scarce assets.** Deleting one is likely irreversible.

> **Recommendation regardless of which option you pick: do not delete any of
> the three existing apps.** The fact that deletion is currently failing may be
> doing you a favor.

### One detail worth knowing

Your `.env` is currently using **Sandstorm3** credentials (App ID `S89ruj1L`),
not Sandstorm4. Sandstorm3 also carries OpenID Connect and TW Auction
permissions that Sandstorm5 doesn't need. Worth confirming which app you
actually intend to be the production one before re-authenticating, so you don't
spend an app's authorization on the wrong one.

---

## 2. What still works without Yahoo

Useful to know before weighing options, because it bounds how bad this is.

Two of the five pipeline jobs **never touch Yahoo** and are unaffected:

- `fetch:mlb` — MLBAM ID map and Statcast expected stats, from
  `statsapi.mlb.com` and `baseballsavant.mlb.com`. No authentication.
- `fetch:news` — headlines from CBS Sports and Rotowire. No authentication.

The player drawer also fetches splits, game logs and transactions directly from
`statsapi.mlb.com` in the browser at view time.

The three jobs that **do** need Yahoo are `fetch:settings`, `fetch:live` and
`fetch:players` — and they carry the parts that make Sandstorm5 *yours*:
league settings and scoring, standings, scoreboards, schedule, rosters, and
free agents.

**This is the load-bearing constraint:** your leagues' private data exists only
inside Yahoo. No public dataset, no third-party stats provider, and no scraper
of MLB data can reconstruct who is on whose roster in "Keeping Pattycakes."
Any option that doesn't end in authenticated access to Yahoo is not a
replacement — it's a reduced app.

---

## 3. The options

Ordered roughly by how much they cost you, cheapest first.

### Option 1 — Re-authenticate an existing app and stop over-rotating

**What it is:** Use the "Re-authenticating from scratch" steps already in
`AUTH.md` against one of your three existing (grandfathered) apps to mint a
fresh refresh token. Then change the workflow so it stops force-refreshing 96
times a day.

**Why it should work:** The permission is still attached to those apps. The
grant is per-app, and nothing suggests Yahoo has revoked already-granted
Fantasy permissions — the portal change gates *new* grants.

**Implications**

- Cheapest and fastest path. No approval, no waiting, no new dependencies.
- Fixes the recurring breakage, not just this instance: fewer rotations means
  fewer chances for the `GH_PAT` write-back to fail. Caching the access token
  between runs and refreshing only on expiry uses the code that already exists.
- You spend one re-authorization on one app. Do it deliberately, on the app you
  want to keep.
- **Honest uncertainty:** I could not test this. The sandbox has no outbound
  network, and re-authenticating would have rotated your live token — which you
  explicitly didn't want yet. The reasoning is sound and grounded in Yahoo's
  docs and your screenshots, but *it is untested until someone runs it.*
- Doesn't protect you if Yahoo later retires grandfathered access.

### Option 2 — Apply for official API access

**What it is:** Submit the form at
[sports.yahoo.com/developer/access](https://sports.yahoo.com/developer/access/).
It asks for expected user count and, notably, an **App ID** field:

> Existing Yahoo Developer Network users: enter the App ID from your YDN
> account. New users without a YDN account can leave this blank — access will
> be provisioned after approval.

So you can point the application at an app you already own (`4rOh2ELW`,
`266r8tf8`, or `S89ruj1L`).

**Implications**

- The only path that is durable rather than grandfathered. Everything else is
  living on borrowed time.
- Read-only by default, which is all Sandstorm5 needs — it never writes.
- Sandstorm5 is a private league dashboard for a handful of people; that's the
  "Small (< 1,000 users)" bucket. Approval is at Yahoo's discretion, and
  **there is no published SLA or approval rate.** Treat the timeline as
  unknown.
- Approval brings obligations that currently aren't met: attribution
  ("Fantasy data provided by Yahoo Fantasy" with a link back and the official
  logo), and a rate-limit/throttling clause. Your 15-minute cadence is
  probably fine, but it's now a documented expectation rather than a guess.
- **Not mutually exclusive with Option 1.** Re-auth now to unfreeze the data,
  apply in parallel for the durable path. That's the sensible sequencing.

### Option 3 — Reduce the blast radius of token rotation ✅ DONE

**What it is:** Not a data source — a resilience change, worth doing under any
option. **This has been implemented.**

What changed:

- **`ensureFreshToken()`** in `src/yahoo/auth.ts` refreshes *only* when the
  cached access token has expired. `npm run token ensure` is the new CI entry
  point; `npm run token refresh` still exists but is documented as a last
  resort.
- **CI now caches `token-cache.json` between runs** (`actions/cache`). This is
  the change that actually matters. Previously the cache was never persisted,
  so every run started tokenless and was *forced* to rotate — switching to
  "refresh only when expired" would have changed nothing on its own.
- **The secret is written only when the token actually changed**
  (`needs_store`). That check compares the live token against the stored
  secret rather than tracking "did we just rotate?", so a run that rotated but
  failed to persist is healed by the next run instead of leaving a dead secret.
- **`cancel-in-progress` is now `false`.** This was a second, independent bug:
  at a 15-minute cadence a long run gets cancelled by the next one, and a
  cancellation landing between rotating and persisting kills the token with no
  recovery short of manual re-auth.
- **The token is persisted after the pipelines, not before** (`npm run token
  check`). This was a third bug, and the subtlest: `client.ts` refreshes on a
  401 and `getAccessToken()` refreshes on expiry, so the fetch step can rotate
  the token by itself. Deciding what to store on the way *in* saved the token
  Yahoo had already revoked and threw the live replacement away with the
  runner — the same dead-chain outcome, reachable a few times a day. Both the
  secret write and the cache save now run under `if: always()`.
- Loud failure on a missing `GH_PAT` is kept. That part of the original design
  was right — it's why the break had a known date.

Net effect: roughly **96 rotations/day → about 24**, none sitting behind a
cancellable step, and every rotation persisted no matter which step caused it.

**Verification:** `tests/auth.test.ts` (12 tests) covers all of the above and
was mutation-checked — reintroducing the old always-rotate behavior, or
deciding what to persist up front, each makes it fail. Full suite 93/93
passing, `tsc --noEmit` clean.

**Implications**

- Doesn't solve access if the grandfathered permission is ever revoked.
- Does mean a single failed secret write-back no longer takes the pipeline down.
- Not sufficient on its own right now: the stored token is *already* dead, so
  Option 1 (a manual re-auth) is still required to get data flowing again. This
  change stops it from happening again.
- Still worth considering: the 15-minute schedule is aggressive for a dashboard
  whose underlying stats update far less often. Left as-is since it's a taste
  call, not a correctness one.

### Option 4 — Give local dev its own app

**What it is:** `AUTH.md` already recommends this: keep CI on one app, use a
second for local work, so the two chains never touch.

**Implications**

- You have three apps, so this is available without creating anything new.
- Worth reading the API policy first, which states developers "may create only
  a single **account**" — that's accounts, not apps, and your three apps are
  under one account, so this appears fine. But it's a policy area worth not
  pushing on while an application is under review.
- Given Option 3, this matters less than it used to: the real fix is refreshing
  less, not partitioning more.

### Option 5 — Scraping Yahoo's web pages

**What it is:** Log in as yourself in a browser and read the league pages
directly, bypassing the API.

**Implications — this is listed for completeness, not as a recommendation**

- The Fantasy Sports API terms prohibit reverse-engineering the API or
  separating its underlying data. Scraping the logged-in site to substitute for
  API access runs against the spirit and likely the letter of that agreement.
- It would actively undermine an Option 2 application.
- Technically fragile: Yahoo's fantasy pages are JavaScript-rendered, so this
  needs a real browser session, and it breaks whenever the markup changes.
- You'd be rebuilding the normalizer against an unstable, undocumented shape —
  discarding the fixture-tested `src/yahoo/normalize/` work that is currently
  one of the more solid parts of the codebase.

### Option 6 — Move off Yahoo entirely

**What it is:** Migrate the leagues to a platform with an open API (Sleeper's
is public and unauthenticated for league reads; Fleaflicker and ESPN have their
own arrangements).

**Implications**

- The only option that permanently removes Yahoo as a dependency.
- Requires every manager in both leagues to agree — a social problem, not a
  technical one, and "Keeping Pattycakes" has history going back to 2009.
- **Your 17 seasons of history do not come with you.** The `fixtures/settings/`
  archive covers 2009–2026 and the pipeline can read historical league keys;
  that only works while Yahoo access works. Phase 4 (hall of fame,
  cross-season trends) depends on it.
- If this is ever seriously considered, **pull a full historical archive out of
  Yahoo first, while access still works.** That's a good idea regardless of
  which option you choose.

---

## 4. What does not solve the problem

Ruled out during research, to save you the detour:

- **Third-party libraries** (`yfpy`, `yahoofantasy`, `yahoo-fantasy-sports-api`
  and similar). These are convenience wrappers around the same OAuth endpoints.
  They all require your own client ID and secret. They do not bypass the
  permission gate — and you already have a working typed client, so they'd be a
  lateral move at best.
- **The Yahoo Fantasy connector available in Cowork.** Tested during this
  research: it fails with `Token refresh failed`, the same underlying auth
  problem. It's not an independent path in.
- **MLB StatsAPI / Baseball Savant as a replacement.** Excellent free sources
  with no auth, already wired into `fetch:mlb` — but they have MLB data, not
  *your league's* data. They can't tell you who's on a roster.

---

## 5. Suggested sequence

1. ~~**Fix the rotation cadence** (Option 3)~~ — **done.** The trap is
   defused, so a re-auth won't be burned by the same bug.
2. **Don't delete any Yahoo app.** They can't be replaced through the form.
3. **Decide which app is production** — Sandstorm3 is what `.env` currently
   uses; Sandstorm4 is the one named for the previous project and pointed at
   GitHub Pages.
4. **Re-authenticate that one app** (Option 1) to unfreeze the data. Requires a
   browser — see below.
5. **Apply for official access** (Option 2) in parallel, citing that app's ID.
6. **Archive league history** while access works — cheap insurance for every
   scenario, and a prerequisite if Option 6 is ever on the table.

### Step 4 in detail: the re-auth (needs a human at a browser)

The stored refresh token is dead, so this can't be automated — Yahoo requires
an interactive sign-in. Run these on your machine:

```bash
# 1. Open this URL in a browser, signed in as the Yahoo account that owns the
#    leagues. Replace YOUR_CLIENT_ID with YAHOO_CLIENT_ID from .env.
#    Authorize, and Yahoo shows you a short code.
https://api.login.yahoo.com/oauth2/request_auth?client_id=YOUR_CLIENT_ID&redirect_uri=oob&response_type=code

# 2. Exchange the code for tokens (from the repo root, with .env loaded):
curl -s https://api.login.yahoo.com/oauth2/get_token \
  -u "$YAHOO_CLIENT_ID:$YAHOO_CLIENT_SECRET" \
  -d grant_type=authorization_code -d redirect_uri=oob -d code=YOUR_CODE

# 3. Put the returned refresh_token in .env, then update the CI secret so both
#    ends start from the same live token:
gh secret set YAHOO_REFRESH_TOKEN --repo <you>/sandstorm5

# 4. Confirm it works without burning a rotation:
npm run token ensure
```

Two things to watch:

- **Delete `token-cache.json` first** (or let step 4 overwrite it). It holds the
  orphaned token from July; `auth.ts` will try it before falling back to `.env`.
- **Don't run `fetch:*` locally against the production app afterwards** unless
  you've pointed `.env` at a different app — that forks the chain again. This
  is the failure mode `AUTH.md` warns about, and it's what happened on
  2026-07-14.

If step 2 returns `invalid_grant`, the authorization code expired (they're
short-lived) — redo step 1 and move faster.

---

## Sources

- [Yahoo OAuth 2.0 — Authorization Code Flow](https://developer.yahoo.com/oauth2/guide/flows_authcode/) — refresh token rotation and revocation
- [Yahoo Fantasy API developer portal](https://sports.yahoo.com/developer/) — application/review/approval process, attribution and policy requirements
- [Apply for Yahoo Fantasy Sports API access](https://sports.yahoo.com/developer/access/) — the application form and App ID field
- Repo evidence: `data/manifest.json`, `token-cache.json`, `.github/workflows/refresh-data.yml`, `src/yahoo/auth.ts`, `src/yahoo/client.ts`, `AUTH.md`
- Your screenshots of `developer.yahoo.com/apps/` and `/apps/create/`
