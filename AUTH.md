# Yahoo API auth

All credentials live in `.env` locally and in GitHub Actions secrets in CI.
Nothing credential-shaped is ever committed: `.env`, `token-cache.json`, and
`token_response.json` are gitignored (and covered by patterns in `.gitignore`
before the first commit — there is no token material anywhere in git history).

## How it works

- **Access tokens** last ~1 hour. `src/yahoo/auth.ts` refreshes them on demand
  using the long-lived **refresh token** and caches the result in
  `token-cache.json` (gitignored).
- Yahoo **rotates the refresh token** on every refresh. The cache always holds
  the newest one; in CI, the workflow writes the newest refresh token back to
  the `YAHOO_REFRESH_TOKEN` repo secret (best-effort — a failed write-back is
  fine because Yahoo keeps recent previous refresh tokens working).
- Every pipeline job goes through `src/yahoo/client.ts`, which handles token
  refresh on 401 and retry/backoff on 429/5xx. No other code talks to Yahoo.

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
| `YAHOO_REFRESH_TOKEN` | Long-lived token; auto-rotated by the workflow |
| `GH_PAT` (optional) | Fine-grained PAT, **this repo only**, *Secrets: read/write* — lets the workflow persist the rotated refresh token. Without it, runs still work off the stored token. |
