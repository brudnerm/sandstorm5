# Yahoo API auth

All credentials live in `.env` locally and in GitHub Actions secrets in CI.
Nothing credential-shaped is ever committed: `.env`, `token-cache.json`, and
`token_response.json` are gitignored (and covered by patterns in `.gitignore`
before the first commit — there is no token material anywhere in git history).

## How it works

- **Access tokens** last ~1 hour. `src/yahoo/auth.ts` refreshes them on demand
  using the long-lived **refresh token** and caches the result in
  `token-cache.json` (gitignored).
- Yahoo **may issue a new refresh token on refresh, and revokes the previous
  one when it does** ([Yahoo's OAuth
  docs](https://developer.yahoo.com/oauth2/guide/flows_authcode/)) — so exactly
  one token in the chain is ever live. Whoever refreshes rotates the chain
  forward; the token everyone else is holding dies. In CI, the workflow writes
  the rotated token back to the `YAHOO_REFRESH_TOKEN` repo secret so the next
  run inherits the live one.
- That write-back is **mandatory, not best-effort.** If it fails (missing
  `GH_PAT`, `gh` error), the stored token is already dead and the next run
  fails with `invalid_grant` — so the workflow fails loudly on the run that
  caused it rather than freezing data silently until someone notices.
- **Rotate as little as possible.** Every rotation is a chance to break the
  chain, so nothing should refresh a token that still works:
  - `ensureFreshToken()` refreshes **only when the cached access token has
    expired**. `npm run token ensure` is the CI entry point; `npm run token
    refresh` forces a rotation and is rarely what you want.
  - CI **caches `token-cache.json` between runs** (`actions/cache`). Without
    it every run starts tokenless and is *forced* to rotate — at a 15-minute
    cadence that was ~96 rotations/day against tokens that live an hour.
  - The workflow writes the secret **only when the token actually changed**
    (`needs_store`), and that check compares against the stored secret rather
    than "did we just rotate?", so a run that rotated but failed to persist is
    healed by the next run instead of silently leaving a dead secret.
  - `concurrency.cancel-in-progress` is **`false`**. A run cancelled between
    rotating and persisting leaves the stored token dead with no recovery
    short of a manual browser re-auth.
- **Persist last, never first.** The workflow decides what to store *after* the
  fetch pipelines have run (`npm run token check`), not before. `client.ts`
  refreshes on a 401 and `getAccessToken()` refreshes on expiry, so the fetch
  itself can rotate the token — and that replacement exists nowhere but
  `token-cache.json`. Deciding up front would store the token Yahoo had already
  revoked and drop the live one when the runner is torn down. Both the secret
  write and the cache save run under `if: always()`, since a failed or cancelled
  fetch can still have rotated.
- Every pipeline job goes through `src/yahoo/client.ts`, which handles token
  refresh on 401 and retry/backoff on 429/5xx. No other code talks to Yahoo.
- `tests/auth.test.ts` locks in the rules above.

## Don't fork the chain: local dev vs CI

Because only one refresh token is ever live, **running the pipelines locally
against the same Yahoo app forks CI's chain and invalidates it** (and vice
versa): your local refresh rotates the token, orphaning the one in the CI
secret, so the next scheduled run dies. This is what froze the data on
2026-07-14.

Pick one:

- **Let CI own the token** (simplest): don't run `fetch:*` locally against the
  prod app. Use recorded fixtures for local work; let the scheduled workflow
  do the real fetching.
- **Give local dev its own credentials**: point `.env` at a *different* Yahoo
  app you already own, leaving the CI secrets on the prod app. The two chains
  never touch.

  > ⚠️ Use an **existing** app. Yahoo has moved the Fantasy Sports API behind an
  > application-and-approval process, and the Fantasy Sports permission is no
  > longer offered on the Create Application form — so a newly created app
  > cannot read fantasy data, and an existing one that has it cannot be
  > replaced. Don't delete old apps. See `DATA-OPTIONS.md`.

`auth.ts` softens the blow after an accidental fork: if the cached token is
rejected it falls back to the seed token in `YAHOO_REFRESH_TOKEN` before
failing, so refreshing `.env` (or the secret) is enough to recover without
hand-deleting `token-cache.json`.

## Commands

```bash
npm run token get       # print a valid access token (refreshes only if expired)
npm run token ensure    # CI, before the pipelines: refresh only if expired
npm run token check     # CI, after the pipelines: report whether the refresh
                        # token owes a write-back. Read-only, no network.
npm run token refresh   # force a rotation — burns a refresh token even when the
                        # cached one is fine. Prefer `ensure`.
```

## Re-authenticating from scratch

Only needed if the refresh token is lost or fully expired
(`INVALID_REFRESH_TOKEN` even after retry):

1. Take `YAHOO_CLIENT_ID` from `.env` and open (replace `YOUR_CLIENT_ID`):
   `https://api.login.yahoo.com/oauth2/request_auth?client_id=YOUR_CLIENT_ID&redirect_uri=oob&response_type=code`
2. Authorize; Yahoo shows an authorization code.
3. Exchange it (one-off, writes token-cache.json):

   ```bash
   curl -s https://api.login.yahoo.com/oauth2/get_token \
     -u "$YAHOO_CLIENT_ID:$YAHOO_CLIENT_SECRET" \
     -d grant_type=authorization_code -d redirect_uri=oob -d code=YOUR_CODE
   ```

4. Put the returned `refresh_token` into `.env` (`YAHOO_REFRESH_TOKEN=...`)
   and update the GitHub secret:

   ```bash
   gh secret set YAHOO_REFRESH_TOKEN --repo <you>/sandstorm5
   ```

## CI secrets

| Secret | Purpose |
|---|---|
| `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET` | OAuth app credentials |
| `YAHOO_REFRESH_TOKEN` | Refresh token; rotated and rewritten by the workflow every run |
| `GH_PAT` (**required**) | Fine-grained PAT, **this repo only**, *Secrets: read/write* — lets the workflow persist the rotated refresh token. Without it the chain breaks after one run; the workflow fails loudly if it's missing. |
