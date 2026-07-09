/**
 * Enumerate every MLB fantasy league the authenticated user has ever been
 * in, grouped by lineage, and print registry-ready `seasons` tables.
 * Use this to fill in src/domain/leagues.ts when adding a league or season.
 *
 *   npm run discover-leagues
 */
import { yahooGet } from '../yahoo/client.js'

type AnyObj = Record<string, unknown>

interface DiscoveredLeague {
  leagueKey: string
  name: string
  season: string
}

function asObj(v: unknown): AnyObj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyObj) : {}
}

/** Iterate Yahoo's `{ count, "0": ..., "1": ... }` pseudo-arrays. */
function* indexed(obj: AnyObj): Generator<unknown> {
  const count = Number(obj['count'] ?? 0)
  for (let i = 0; i < count; i++) yield obj[String(i)]
}

const raw = await yahooGet('users;use_login=1/games;game_codes=mlb/leagues')

const usersObj = asObj(asObj(raw.fantasy_content)['users'])
const userArr = asObj(usersObj['0'])['user'] as unknown[]
const gamesObj = asObj(asObj(userArr?.[1])['games'])

const leagues: DiscoveredLeague[] = []
for (const gameEntry of indexed(gamesObj)) {
  const gameArr = asObj(gameEntry)['game'] as unknown[]
  if (!Array.isArray(gameArr)) continue
  const gameMeta = asObj(gameArr[0])
  const season = String(gameMeta['season'] ?? '')
  const leaguesObj = asObj(asObj(gameArr[1])['leagues'])
  for (const leagueEntry of indexed(leaguesObj)) {
    const leagueArr = asObj(leagueEntry)['league'] as unknown[]
    const meta = asObj(leagueArr?.[0])
    if (!meta['league_key']) continue
    leagues.push({
      leagueKey: String(meta['league_key']),
      name: String(meta['name'] ?? ''),
      season,
    })
  }
}

// Group by league name (lineage across seasons)
const byName = new Map<string, DiscoveredLeague[]>()
for (const l of leagues) {
  const list = byName.get(l.name) ?? []
  list.push(l)
  byName.set(l.name, list)
}

console.log(`Found ${leagues.length} league-seasons across ${byName.size} league names.\n`)
for (const [name, list] of byName) {
  list.sort((a, b) => a.season.localeCompare(b.season))
  console.log(`// ${name} (${list.length} seasons)`)
  console.log('seasons: {')
  for (const l of list) console.log(`  '${l.season}': '${l.leagueKey}',`)
  console.log('},\n')
}
