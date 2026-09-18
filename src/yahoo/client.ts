/**
 * The one typed Yahoo Fantasy API client. All pipeline jobs go through
 * `yahooGet` — nothing else in the codebase issues HTTP to Yahoo.
 * Handles auth, JSON format, pacing between requests, and retry with
 * backoff on transient failures (including one token refresh on 401).
 */
import { getAccessToken, refreshAccessToken } from './auth.js'

const BASE = 'https://fantasysports.yahooapis.com/fantasy/v2'
const PACE_MS = 350
const MAX_ATTEMPTS = 3
/**
 * Hard ceiling on a single request. `fetch` has no default timeout, so without
 * this a stalled Yahoo connection hangs the whole job forever instead of
 * retrying — which is exactly what happened during the trophy-room backfill:
 * one request sat dead for ten minutes and took the run with it. The scheduled
 * refresh workflow has no wall-clock limit of its own, so the same stall there
 * would silently freeze the data.
 */
const REQUEST_TIMEOUT_MS = 20_000

let lastRequestAt = 0

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export interface YahooResponse {
  fantasy_content: Record<string, unknown>
}

/**
 * GET a Yahoo Fantasy resource path (e.g. `league/469.l.13624/settings`)
 * and return the parsed JSON body.
 */
export async function yahooGet(resource: string): Promise<YahooResponse> {
  const url = `${BASE}/${resource}${resource.includes('?') ? '&' : '?'}format=json`

  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const sinceLast = Date.now() - lastRequestAt
    if (sinceLast < PACE_MS) await sleep(PACE_MS - sinceLast)
    lastRequestAt = Date.now()

    const token = await getAccessToken()
    let resp: Response
    try {
      resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      // A timeout or socket error is transient by nature — retry it the same
      // way a 5xx is retried, rather than failing the whole job on one stall.
      lastError = new Error(
        `Request failed for ${resource}: ${err instanceof Error ? err.message : String(err)}`,
      )
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * attempt)
        continue
      }
      throw lastError
    }

    if (resp.ok) {
      return (await resp.json()) as YahooResponse
    }

    const body = await resp.text()
    lastError = new Error(`HTTP ${resp.status} for ${resource}: ${body.slice(0, 300)}`)

    if (resp.status === 401 && attempt < MAX_ATTEMPTS) {
      await refreshAccessToken()
      continue
    }
    // Retry 429/5xx with backoff; anything else is a hard failure.
    if ((resp.status === 429 || resp.status >= 500) && attempt < MAX_ATTEMPTS) {
      await sleep(1000 * attempt)
      continue
    }
    throw lastError
  }
  throw lastError
}
