/**
 * Fetch league settings from Yahoo for every league-season in the registry,
 * normalize them, and write data shards:
 *
 *   data/{leagueId}/settings/{season}.json
 *
 * Options:
 *   --league <id>      only this league
 *   --season <year>    only this season
 *   --current          only each league's most recent season
 *   --save-fixtures    also save raw responses under fixtures/ (for tests)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEAGUES, currentSeason } from '../domain/leagues.js'
import { yahooGet } from '../yahoo/client.js'
import { normalizeSettings } from '../yahoo/normalize/settings.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DATA_DIR = path.join(ROOT, 'data')
const FIXTURES_DIR = path.join(ROOT, 'fixtures')

const args = process.argv.slice(2)
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}
const onlyLeague = argValue('--league')
const onlySeason = argValue('--season')
const onlyCurrent = args.includes('--current')
const saveFixtures = args.includes('--save-fixtures')

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2))
}

let fetched = 0
let failed = 0

for (const league of LEAGUES) {
  if (onlyLeague && league.id !== onlyLeague) continue
  for (const [season, leagueKey] of Object.entries(league.seasons)) {
    if (onlySeason && season !== onlySeason) continue
    if (onlyCurrent && season !== currentSeason(league)) continue

    process.stdout.write(`${league.id} ${season} (${leagueKey}) ... `)
    try {
      const raw = await yahooGet(`league/${leagueKey}/settings`)
      const settings = normalizeSettings(raw, league.id)

      writeJson(path.join(DATA_DIR, league.id, 'settings', `${season}.json`), settings)
      if (saveFixtures) {
        writeJson(path.join(FIXTURES_DIR, 'settings', `${league.id}-${season}.json`), raw)
      }

      const scored = settings.categories.filter(c => !c.isDisplayOnly)
      console.log(`ok — ${scored.length} scored categories (${settings.draftType})`)
      fetched++
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : err}`)
      failed++
    }
  }
}

console.log(`\nDone: ${fetched} fetched, ${failed} failed.`)
if (failed > 0) process.exit(1)
