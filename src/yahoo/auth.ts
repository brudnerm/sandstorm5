/**
 * Yahoo OAuth token management.
 *
 * Credentials come from this repo's .env (or process env in CI) — see
 * .env.example and AUTH.md. Access tokens live ~1 hour; we refresh with the
 * long-lived refresh token and cache the result in token-cache.json
 * (gitignored). Yahoo rotates the refresh token on every refresh and
 * invalidates the previous one, so exactly one token in the chain is ever
 * live: the cache holds the newest. If the cached token has been orphaned
 * (e.g. CI and local dev forked the chain), we fall back to the seed token
 * in YAHOO_REFRESH_TOKEN before giving up. See AUTH.md.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token'

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true })

/**
 * Where the rotated token is cached. Overridable via `YAHOO_TOKEN_CACHE` so
 * tests never touch the real token-cache.json — clobbering it would invalidate
 * a live refresh token and force a manual browser re-auth.
 */
const CACHE_PATH = process.env.YAHOO_TOKEN_CACHE
  ? path.resolve(process.env.YAHOO_TOKEN_CACHE)
  : path.join(ROOT, 'token-cache.json')

export interface TokenCache {
  accessToken: string
  refreshToken: string
  /** epoch ms when the access token expires */
  expiresAt: number
}

/**
 * Read the cached token, or null if there isn't a usable one.
 *
 * Exported because the live token has to be re-read *after* the fetch
 * pipelines run: `client.ts` refreshes on a 401, so a rotation can happen long
 * after `ensureFreshToken()` reported none. Re-reading is what catches it.
 */
export function readTokenCache(): TokenCache | null {
  try {
    const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as TokenCache
    return cache.accessToken && cache.refreshToken ? cache : null
  } catch {
    return null
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill it in (see AUTH.md).`,
    )
  }
  return value
}

async function tryRefresh(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ ok: true; cache: TokenCache } | { ok: false; status: number; body: string }> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      redirect_uri: 'oob',
    }),
  })

  const body = await resp.text()
  if (!resp.ok) return { ok: false, status: resp.status, body }

  const json = JSON.parse(body) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  const cache: TokenCache = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in - 120) * 1000,
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2))
  return { ok: true, cache }
}

export async function refreshAccessToken(): Promise<TokenCache> {
  const clientId = requireEnv('YAHOO_CLIENT_ID')
  const clientSecret = requireEnv('YAHOO_CLIENT_SECRET')

  // Prefer the cache's rotated token, but fall back to the seed token from
  // .env / the CI secret when the cached one is rejected — e.g. right after
  // a manual re-auth that updated .env while a stale token-cache.json still
  // holds a dead token. Dedup so a matching pair isn't tried twice.
  const candidates = [readTokenCache()?.refreshToken, process.env.YAHOO_REFRESH_TOKEN]
    .filter((t): t is string => !!t)
    .filter((t, i, arr) => arr.indexOf(t) === i)
  if (candidates.length === 0) {
    throw new Error(
      'No Yahoo refresh token available. Set YAHOO_REFRESH_TOKEN in .env (see AUTH.md).',
    )
  }

  let lastBody = ''
  for (const refreshToken of candidates) {
    const result = await tryRefresh(clientId, clientSecret, refreshToken)
    if (result.ok) return result.cache
    lastBody = result.body
    // Non-400 (network, 5xx, bad client creds) won't be fixed by another
    // token — surface it directly.
    if (result.status !== 400) {
      throw new Error(`Token refresh failed (HTTP ${result.status}): ${result.body.slice(0, 300)}`)
    }
  }

  throw new Error(
    'Yahoo refresh token rejected (invalid_grant): every available token is dead. ' +
    'Yahoo rotates the refresh token on each use and invalidates the previous one, ' +
    'so a token shared between CI and local dev — or refreshed out of order — gets ' +
    'orphaned. Re-authenticate per AUTH.md ("Re-authenticating from scratch"). ' +
    `Last response: ${lastBody.slice(0, 200)}`,
  )
}

/**
 * Ensure a valid access token exists, refreshing ONLY when the cached one has
 * expired. Returns the live cache plus whether a refresh actually happened.
 *
 * This is what CI should use. Forcing a refresh on every run rotates the
 * refresh token every time, and each rotation is a chance to break the chain
 * (the old token dies the moment the new one is issued). Access tokens last an
 * hour, so as long as token-cache.json survives between runs, a workflow
 * running every 15 minutes only needs to rotate about once an hour instead of
 * on all four runs. See AUTH.md.
 */
export async function ensureFreshToken(): Promise<{
  cache: TokenCache
  refreshed: boolean
}> {
  const cached = readTokenCache()
  if (cached && cached.expiresAt > Date.now()) return { cache: cached, refreshed: false }
  return { cache: await refreshAccessToken(), refreshed: true }
}

/**
 * Does the live refresh token still need writing back to the durable store
 * (the YAHOO_REFRESH_TOKEN secret / .env)?
 *
 * Deliberately compares against the stored value rather than tracking "did we
 * just rotate?". A stored token that disagrees with the live one is not merely
 * stale, it is DEAD — Yahoo revoked it when the newer token was issued. Asking
 * the question this way also self-heals the dangerous case: if an earlier run
 * rotated but failed to persist, the next run still reports that a write is
 * owed instead of assuming no rotation happened.
 */
export function needsStore(
  liveRefreshToken: string,
  storedRefreshToken: string | undefined,
): boolean {
  return liveRefreshToken !== storedRefreshToken
}

/** Return a valid access token, refreshing if the cached one has expired. */
export async function getAccessToken(): Promise<string> {
  return (await ensureFreshToken()).cache.accessToken
}
