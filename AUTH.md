# Yahoo API auth

All credentials live in `.env` locally and in GitHub Actions secrets in CI.
Nothing credential-shaped is ever committed: `.env`, `token-cache.json`, and
`token_response.json` are gitignored (and covered by patterns in `.gitignore`
before the first commit — there is no token material anywhere in git history).

## How it works

- **Access tokens** last ~1 hour. `src/yahoo/auth.ts` refreshes them on demand
  using the long-lived **refresh token** and caches the result in
  `token-cache.json` (gitignored).
- Yahoo **rotates the refresh token on every refresh and invalidates the
  previous one** — so exactly one token in the chain is ever live. Whoever
  refreshes rotates the chain forward; the token everyone else is holding
  dies. In CI, the workflow writes the rotated token back to the
  `YAHOO_REFRESH_TOKEN` repo secret so the next run inherits the live one.
- That write-back is **mandatory, not best-effort.** If it fails (missing
  `GH_PAT`, `gh` error), the stored token is already dead and the next run
  fails with `invalid_grant` — so the workflow now fails loudly on the run
  that caused it rather than freezing data silently until someone notices.
- Every pipeline job goes through `src/yahoo/client.ts`, which handles token
  refresh on 401 and retry/backoff on 429/5xx. No other code talks to Yahoo.

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
- **Give local dev its own credentials**: register a second Yahoo app and put
  *its* client id/secret/refresh token in `.env`, leaving the CI secrets on the
  prod app. The two chains never touch.

`auth.ts` softens the blow after an accidental fork: if the cached token is
rejected it falls back to the seed token in `YAHOO_REFRESH_TOKEN` before
failing, so refreshing `.env` (or the secret) is enough to recover without
hand-deleting `token-cache.json`.

## Commands

```bash
npm run token refresh   # force-refresh, write token-cache.json
npm run token get       # print a valid access token (auto-refresh if expired)
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
