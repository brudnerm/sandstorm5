/**
 * Fetch live data for every league's current season:
 *
 *   data/{leagueId}/live.json               standings + current-week scoreboard
 *   data/{leagueId}/matchups/{season}.json  all weeks (incremental)
 *   data/manifest.json                      root index
 *
 * Incremental: weeks already stored as fully 'postevent' are never
 * re-fetched, so a steady-state refresh is ~3 requests per league.
 * Settings shards must exist (run fetch:settings first).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEAGUES, currentSeason } from '../domain/leagues.js'
import type { LiveShard, Manifest, Matchup, SeasonMatchups } from '../domain/matchups.js'
import type { LeagueSeasonSettings } from '../domain/stats.js'
import { yahooGet } from '../yahoo/client.js'
import { normalizeScoreboard } from '../yahoo/normalize/scoreboard.js'
import { normalizeStandings } from '../yahoo/normalize/standings.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DATA_DIR = path.join(ROOT, 'data')

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 1))
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function weekIsFinal(matchups: Matchup[] | undefined): boolean {
  return !!matchups && matchups.length > 0 && matchups.every(m => m.status === 'postevent')
}

const generatedAt = new Date().toISOString()
const manifest: Manifest = { generatedAt, leagues: [] }

for (const league of LEAGUES) {
  const season = currentSeason(league)
  const leagueKey = league.seasons[season]!
  const settingsPath = path.join(DATA_DIR, league.id, 'settings', `${season}.json`)
  const settings = readJson<LeagueSeasonSettings>(settingsPath)
  if (!settings) {
    throw new Error(`Missing settings shard ${settingsPath} — run fetch:settings first`)
  }

  console.log(`[${league.id}] ${season} (${leagueKey})`)

  // Current-week scoreboard (also tells us the authoritative current week)
  const currentRaw = await yahooGet(`league/${leagueKey}/scoreboard`)
  const current = normalizeScoreboard(currentRaw, settings)
  console.log(`  scoreboard: week ${current.week}, ${current.matchups.length} matchups`)

  // Standings
  const standings = normalizeStandings(await yahooGet(`league/${leagueKey}/standings`))
  console.log(`  standings: ${standings.length} teams`)

  // Season matchups, incremental
  const matchupsPath = path.join(DATA_DIR, league.id, 'matchups', `${season}.json`)
  const existing = readJson<SeasonMatchups>(matchupsPath)
  const weeks: Record<string, Matchup[]> = existing?.weeks ?? {}
  weeks[String(current.week)] = current.matchups

  let fetched = 0
  for (let w = settings.startWeek ?? 1; w <= current.currentWeek; w++) {
    if (w === current.week || weekIsFinal(weeks[String(w)])) continue
    const weekRaw = await yahooGet(`league/${leagueKey}/scoreboard;week=${w}`)
    weeks[String(w)] = normalizeScoreboard(weekRaw, settings).matchups
    fetched++
  }

  // Future weeks carry the schedule (preevent pairings, no stats). The
  // regular-season schedule is static, so fetch each week once; playoff
  // pairings change with the standings, so keep re-fetching those.
  for (let w = current.currentWeek + 1; w <= (settings.endWeek ?? current.currentWeek); w++) {
    const stored = weeks[String(w)]
    if (stored && stored.length > 0 && !stored.some(m => m.isPlayoffs)) continue
    const weekRaw = await yahooGet(`league/${leagueKey}/scoreboard;week=${w}`)
    weeks[String(w)] = normalizeScoreboard(weekRaw, settings).matchups
    fetched++
  }
  console.log(`  matchups: ${Object.keys(weeks).length} weeks stored (${fetched} re-fetched)`)

  const live: LiveShard = {
    leagueId: league.id,
    leagueKey,
    season,
    currentWeek: current.currentWeek,
    startWeek: settings.startWeek ?? 1,
    endWeek: settings.endWeek ?? current.currentWeek,
    standings,
    scoreboard: current.matchups,
  }
  writeJson(path.join(DATA_DIR, league.id, 'live.json'), live)
  writeJson(matchupsPath, { leagueId: league.id, season, weeks } satisfies SeasonMatchups)

  manifest.leagues.push({ id: league.id, name: league.name, season, currentWeek: current.currentWeek })
}

writeJson(path.join(DATA_DIR, 'manifest.json'), manifest)
console.log(`\nDone. Manifest covers ${manifest.leagues.length} leagues.`)
