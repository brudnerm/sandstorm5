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
const CACHE_PATH = path.join(ROOT, 'token-cache.json')
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token'

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true })

interface TokenCache {
  accessToken: string
  refreshToken: string
  /** epoch ms when the access token expires */
  expiresAt: number
}

function readCache(): TokenCache | null {
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
  const candidates = [readCache()?.refreshToken, process.env.YAHOO_REFRESH_TOKEN]
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

/** Return a valid access token, refreshing if the cached one has expired. */
export async function getAccessToken(): Promise<string> {
  const cached = readCache()
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken
  return (await refreshAccessToken()).accessToken
}
