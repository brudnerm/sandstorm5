/**
 * Fetch player-level data for every league's current season:
 *
 *   data/{leagueId}/players/current.json     every roster, stat windows
 *                                            (week / lastweek / lastmonth / season)
 *   data/{leagueId}/players/freeagents.json  waiver-wire watchlist with
 *                                            ownership trends
 *
 * Requires live.json + settings shards (run fetch:settings and fetch:live
 * first). ~60 requests per league, so a couple minutes for both leagues.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEAGUES, currentSeason } from '../domain/leagues.js'
import type { LiveShard } from '../domain/matchups.js'
import type {
  FreeAgent,
  FreeAgentsShard,
  PlayerCard,
  PlayersShard,
  RosterPlayer,
  StatWindow,
  TeamRoster,
} from '../domain/players.js'
import type { LeagueSeasonSettings } from '../domain/stats.js'
import { yahooGet } from '../yahoo/client.js'
import {
  normalizeLeaguePlayers,
  normalizeRoster,
  type ParsedPlayer,
} from '../yahoo/normalize/players.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DATA_DIR = path.join(ROOT, 'data')

/** Yahoo caps players-collection pages at 25. */
const PAGE = 25
/** Free agents discovered per sort (2 pages of last-week performers + 1 of last-month). */
const FA_LASTWEEK_PAGES = 2
const EXTRA_WINDOWS: StatWindow[] = ['lastweek', 'lastmonth', 'season']

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 1))
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function toCard(p: ParsedPlayer): Omit<PlayerCard, 'windows'> {
  return {
    playerKey: p.playerKey,
    name: p.name,
    mlbTeam: p.mlbTeam,
    positionType: p.positionType,
    displayPosition: p.displayPosition,
    eligiblePositions: p.eligiblePositions,
    headshotUrl: p.headshotUrl,
    status: p.status,
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Batch-fetch one stat window for a set of player keys and fold the stat
 * lines into `windows` maps keyed by player.
 */
async function fetchWindow(
  leagueKey: string,
  settings: LeagueSeasonSettings,
  playerKeys: string[],
  window: StatWindow,
  into: Map<string, Partial<Record<StatWindow, Record<string, string>>>>,
): Promise<void> {
  for (const batch of chunk(playerKeys, PAGE)) {
    const raw = await yahooGet(
      `league/${leagueKey}/players;player_keys=${batch.join(',')}/stats;type=${window}`,
    )
    for (const p of normalizeLeaguePlayers(raw, settings)) {
      if (!p.stats) continue
      const windows = into.get(p.playerKey) ?? {}
      windows[window] = p.stats
      into.set(p.playerKey, windows)
    }
  }
}

for (const league of LEAGUES) {
  const season = currentSeason(league)
  const leagueKey = league.seasons[season]!
  const settings = readJson<LeagueSeasonSettings>(
    path.join(DATA_DIR, league.id, 'settings', `${season}.json`),
  )
  const live = readJson<LiveShard>(path.join(DATA_DIR, league.id, 'live.json'))
  const week = live.currentWeek

  console.log(`[${league.id}] ${season} week ${week} (${leagueKey})`)

  // ── Rosters: one request per team gets membership + week stats ──────
  const rosterPlayers = new Map<string, ParsedPlayer>() // playerKey → identity
  const rosterOf = new Map<string, string[]>() // teamKey → playerKeys
  for (const row of live.standings) {
    const raw = await yahooGet(
      `team/${row.teamKey}/roster;week=${week}/players/stats;type=week;week=${week}`,
    )
    const { teamKey, players } = normalizeRoster(raw, settings)
    rosterOf.set(teamKey, players.map(p => p.playerKey))
    for (const p of players) rosterPlayers.set(p.playerKey, p)
  }
  console.log(`  rosters: ${rosterOf.size} teams, ${rosterPlayers.size} players`)

  // ── Trailing windows for every rostered player, batched ─────────────
  const windowsByKey = new Map<string, Partial<Record<StatWindow, Record<string, string>>>>()
  for (const [key, p] of rosterPlayers) {
    if (p.stats && p.coverage === 'week') windowsByKey.set(key, { week: p.stats })
  }
  const allKeys = [...rosterPlayers.keys()]
  for (const window of EXTRA_WINDOWS) {
    await fetchWindow(leagueKey, settings, allKeys, window, windowsByKey)
  }

  const rosters: TeamRoster[] = live.standings.map(row => ({
    teamKey: row.teamKey,
    players: (rosterOf.get(row.teamKey) ?? []).map((key): RosterPlayer => ({
      ...toCard(rosterPlayers.get(key)!),
      selectedPosition: rosterPlayers.get(key)!.selectedPosition,
      windows: (windowsByKey.get(key) ?? {}) as RosterPlayer['windows'],
    })),
  }))
  writeJson(path.join(DATA_DIR, league.id, 'players', 'current.json'), {
    leagueId: league.id,
    season,
    week,
    rosters,
  } satisfies PlayersShard)
  console.log(`  windows: ${EXTRA_WINDOWS.join('/')} for ${allKeys.length} players`)

  // ── Free agents: discover recent performers, then enrich ────────────
  const candidates = new Map<string, ParsedPlayer>()
  for (let page = 0; page < FA_LASTWEEK_PAGES; page++) {
    const raw = await yahooGet(
      `league/${leagueKey}/players;status=A;sort=AR;sort_type=lastweek;count=${PAGE};start=${page * PAGE}/stats;type=lastweek`,
    )
    for (const p of normalizeLeaguePlayers(raw, settings)) candidates.set(p.playerKey, p)
  }
  const lastmonthRaw = await yahooGet(
    `league/${leagueKey}/players;status=A;sort=AR;sort_type=lastmonth;count=${PAGE};start=0/stats;type=lastmonth`,
  )
  for (const p of normalizeLeaguePlayers(lastmonthRaw, settings)) {
    if (!candidates.has(p.playerKey)) candidates.set(p.playerKey, p)
  }

  const faKeys = [...candidates.keys()]
  const faWindows = new Map<string, Partial<Record<StatWindow, Record<string, string>>>>()
  for (const window of EXTRA_WINDOWS) {
    await fetchWindow(leagueKey, settings, faKeys, window, faWindows)
  }

  const ownership = new Map<string, { percentOwned: number | null; ownershipDelta: number | null }>()
  for (const batch of chunk(faKeys, PAGE)) {
    const raw = await yahooGet(
      `league/${leagueKey}/players;player_keys=${batch.join(',')}/percent_owned`,
    )
    for (const p of normalizeLeaguePlayers(raw, settings)) {
      ownership.set(p.playerKey, {
        percentOwned: p.percentOwned,
        ownershipDelta: p.ownershipDelta,
      })
    }
  }

  const freeAgents: FreeAgent[] = faKeys.map((key): FreeAgent => {
    const p = candidates.get(key)!
    const own = ownership.get(key)
    return {
      ...toCard(p),
      windows: (faWindows.get(key) ?? {}) as FreeAgent['windows'],
      percentOwned: own?.percentOwned ?? null,
      ownershipDelta: own?.ownershipDelta ?? null,
    }
  })

  writeJson(path.join(DATA_DIR, league.id, 'players', 'freeagents.json'), {
    leagueId: league.id,
    season,
    week,
    players: freeAgents,
  } satisfies FreeAgentsShard)
  console.log(`  free agents: ${freeAgents.length} candidates`)
}

console.log('\nDone.')
