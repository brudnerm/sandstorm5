/**
 * Yahoo OAuth token management.
 *
 * Credentials come from this repo's .env (or process env in CI) — see
 * .env.example and AUTH.md. Access tokens live ~1 hour; we refresh with the
 * long-lived refresh token and cache the result in token-cache.json
 * (gitignored). Yahoo rotates the refresh token on every refresh, so the
 * cache always holds the newest one.
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

export async function refreshAccessToken(): Promise<TokenCache> {
  const clientId = requireEnv('YAHOO_CLIENT_ID')
  const clientSecret = requireEnv('YAHOO_CLIENT_SECRET')
  const refreshToken =
    readCache()?.refreshToken ?? requireEnv('YAHOO_REFRESH_TOKEN')

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
  if (!resp.ok) {
    throw new Error(`Token refresh failed (HTTP ${resp.status}): ${body.slice(0, 300)}`)
  }
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
  return cache
}

/** Return a valid access token, refreshing if the cached one has expired. */
export async function getAccessToken(): Promise<string> {
  const cached = readCache()
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken
  return (await refreshAccessToken()).accessToken
}
