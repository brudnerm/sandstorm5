/**
 * Token utility CLI.
 *   npm run token refresh    — force-refresh and cache a new access token
 *   npm run token get        — print a valid access token (refreshing if needed)
 */
import { getAccessToken, refreshAccessToken } from './auth.js'

const cmd = process.argv[2] ?? 'get'

if (cmd === 'refresh') {
  const cache = await refreshAccessToken()
  console.log(`Refreshed. Access token valid until ${new Date(cache.expiresAt).toISOString()}`)
} else if (cmd === 'get') {
  console.log(await getAccessToken())
} else {
  console.error(`Unknown command: ${cmd} (expected 'refresh' or 'get')`)
  process.exit(1)
}
