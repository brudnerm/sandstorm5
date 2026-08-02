/**
 * Token utility CLI.
 *   npm run token get        — print a valid access token (refreshing if needed)
 *   npm run token ensure     — CI entry point, run before the pipelines: refresh
 *                              only if the cached access token has expired
 *   npm run token check      — CI entry point, run after the pipelines: report
 *                              whether the refresh token owes a write-back.
 *                              Read-only — never touches the network.
 *   npm run token refresh    — force a rotation. Rarely what you want: it burns
 *                              a refresh token even when the cached one is fine.
 *                              Prefer `ensure`.
 */
import { appendFileSync } from 'node:fs'
import {
  ensureFreshToken,
  getAccessToken,
  needsStore,
  readTokenCache,
  refreshAccessToken,
} from './auth.js'

const cmd = process.argv[2] ?? 'get'

/** Emit `key=value` lines for GitHub Actions when running in CI. */
function setOutput(values: Record<string, string | boolean>): void {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`)
  appendFileSync(file, lines.join('\n') + '\n')
}

if (cmd === 'refresh') {
  const cache = await refreshAccessToken()
  console.log(`Refreshed. Access token valid until ${new Date(cache.expiresAt).toISOString()}`)
} else if (cmd === 'get') {
  console.log(await getAccessToken())
} else if (cmd === 'ensure') {
  const { cache, refreshed } = await ensureFreshToken()

  // token-cache.json is only a performance optimization and may be evicted at
  // any time; the stored secret is the durable source of truth. See needsStore.
  const owed = needsStore(cache.refreshToken, process.env.YAHOO_REFRESH_TOKEN)

  console.log(
    refreshed
      ? `Refreshed. Access token valid until ${new Date(cache.expiresAt).toISOString()}`
      : `Cached access token still valid until ${new Date(cache.expiresAt).toISOString()} — no rotation needed.`,
  )
  console.log(
    owed
      ? 'Refresh token differs from the stored secret — it MUST be persisted.'
      : 'Refresh token matches the stored secret — nothing to persist.',
  )

  setOutput({ refreshed, needs_store: owed })
} else if (cmd === 'check') {
  // Deliberately re-reads the cache from disk instead of trusting what `ensure`
  // reported earlier in the job. client.ts refreshes on a 401, so the pipelines
  // can rotate the token long after `ensure` said no rotation was needed — and
  // that replacement exists nowhere but token-cache.json until someone stores
  // it. Run this AFTER the pipelines, and persist whatever it reports.
  const cache = readTokenCache()

  if (!cache) {
    console.log('No token cache on disk — nothing to persist.')
    setOutput({ needs_store: false })
  } else {
    const owed = needsStore(cache.refreshToken, process.env.YAHOO_REFRESH_TOKEN)
    console.log(
      owed
        ? 'Refresh token differs from the stored secret — it MUST be persisted.'
        : 'Refresh token matches the stored secret — nothing to persist.',
    )
    setOutput({ needs_store: owed })
  }
} else {
  console.error(`Unknown command: ${cmd} (expected 'get', 'ensure', 'check' or 'refresh')`)
  process.exit(1)
}
