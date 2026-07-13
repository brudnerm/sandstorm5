/**
 * Normalize Yahoo player collections: team rosters
 * (`team/{key}/roster;week=N/players/stats;type=week;week=N`) and league
 * player lists (`league/{key}/players;...[/stats;type=...][/percent_owned]`).
 *
 * A player wrapper is a positional array whose elements vary by request:
 * `[infoArray, {selected_position}?, {starting_status,batting_order}?,
 * {player_stats}?, {percent_owned}?]` — so everything after the info array
 * is located by key, never by index. Stats are keyed through the league's
 * categories (stat_id → role), same as team stats.
 */
import type { PlayerCard, StatWindow } from '../../domain/players.js'
import { statKey, type LeagueSeasonSettings, type StatCategory, type StatKey } from '../../domain/stats.js'
import type { YahooResponse } from '../client.js'
import { asObj, indexed, num, parseTeamInfo, type AnyObj } from './common.js'

function infoEntry(info: unknown[], key: string): AnyObj | undefined {
  for (const item of info) {
    const obj = asObj(item)
    if (key in obj) return obj
  }
  return undefined
}

/** Find the wrapper element (after the info array) carrying `key`. */
function wrapperEntry(wrapper: unknown[], key: string): AnyObj | undefined {
  for (const element of wrapper.slice(1)) {
    const obj = asObj(element)
    if (key in obj) return obj
  }
  return undefined
}

const WINDOWS = new Set<string>(['week', 'lastweek', 'lastmonth', 'season'])

export interface ParsedPlayer extends Omit<PlayerCard, 'windows'> {
  /** Which window the stats in this response cover, if any. */
  coverage: StatWindow | null
  stats: Record<StatKey, string> | null
  selectedPosition: string | null
  percentOwned: number | null
  ownershipDelta: number | null
}

export function parsePlayer(
  wrapper: unknown[],
  byId: Map<number, StatCategory>,
): ParsedPlayer {
  const info = wrapper[0]
  if (!Array.isArray(info)) throw new Error('Player wrapper has no info array')

  const playerKey = String(infoEntry(info, 'player_key')?.['player_key'] ?? '')
  if (!playerKey) throw new Error('Player info array has no player_key')

  const name = asObj(infoEntry(info, 'name')?.['name'])
  const headshot = asObj(infoEntry(info, 'headshot')?.['headshot'])

  const eligible: string[] = []
  const eligibleArr = infoEntry(info, 'eligible_positions')?.['eligible_positions']
  if (Array.isArray(eligibleArr)) {
    for (const entry of eligibleArr) {
      const pos = asObj(entry)['position']
      if (pos) eligible.push(String(pos))
    }
  }

  // Stats: keyed via league categories; stats outside the league's
  // categories (Yahoo never sends them) would be silently dropped.
  let coverage: StatWindow | null = null
  let stats: Record<StatKey, string> | null = null
  const playerStats = wrapperEntry(wrapper, 'player_stats')?.['player_stats']
  if (playerStats) {
    const ps = asObj(playerStats)
    const coverageType = String(asObj(ps['0'])['coverage_type'] ?? '')
    coverage = WINDOWS.has(coverageType) ? (coverageType as StatWindow) : null
    stats = {}
    const statsArr = ps['stats']
    if (Array.isArray(statsArr)) {
      for (const entry of statsArr) {
        const stat = asObj(asObj(entry)['stat'])
        const statId = num(stat['stat_id'])
        if (statId === null) continue
        const category = byId.get(statId)
        if (!category) continue
        stats[statKey(category.role, category.statId)] = String(stat['value'] ?? '')
      }
    }
  }

  // selected_position is a positional array like [{coverage...}, {position}]
  let selectedPosition: string | null = null
  const selArr = wrapperEntry(wrapper, 'selected_position')?.['selected_position']
  if (Array.isArray(selArr)) {
    for (const entry of selArr) {
      const pos = asObj(entry)['position']
      if (pos) selectedPosition = String(pos)
    }
  }

  // percent_owned is a positional array like [{coverage...}, {value}, {delta}]
  let percentOwned: number | null = null
  let ownershipDelta: number | null = null
  const poArr = wrapperEntry(wrapper, 'percent_owned')?.['percent_owned']
  if (Array.isArray(poArr)) {
    for (const entry of poArr) {
      const obj = asObj(entry)
      if ('value' in obj) percentOwned = num(obj['value'])
      if ('delta' in obj) ownershipDelta = num(obj['delta'])
    }
  }

  const positionType = String(infoEntry(info, 'position_type')?.['position_type'] ?? 'B')

  return {
    playerKey,
    name: String(name['full'] ?? 'Unknown'),
    mlbTeam: String(infoEntry(info, 'editorial_team_abbr')?.['editorial_team_abbr'] ?? ''),
    positionType: positionType === 'P' ? 'P' : 'B',
    displayPosition: String(infoEntry(info, 'display_position')?.['display_position'] ?? ''),
    eligiblePositions: eligible,
    headshotUrl: headshot['url'] ? String(headshot['url']) : null,
    status: infoEntry(info, 'status')?.['status']
      ? String(infoEntry(info, 'status')!['status'])
      : null,
    coverage,
    stats,
    selectedPosition,
    percentOwned,
    ownershipDelta,
  }
}

function parsePlayersCollection(
  playersObj: AnyObj,
  byId: Map<number, StatCategory>,
): ParsedPlayer[] {
  const players: ParsedPlayer[] = []
  for (const entry of indexed(playersObj)) {
    const wrapper = asObj(entry)['player']
    if (!Array.isArray(wrapper)) throw new Error('Malformed player wrapper in collection')
    players.push(parsePlayer(wrapper, byId))
  }
  return players
}

/** Normalize a `team/{key}/roster...` response. */
export function normalizeRoster(
  raw: YahooResponse,
  settings: LeagueSeasonSettings,
): { teamKey: string; players: ParsedPlayer[] } {
  const teamArr = raw.fantasy_content?.['team']
  if (!Array.isArray(teamArr) || teamArr.length < 2) {
    throw new Error('Unexpected roster payload: fantasy_content.team is not a 2-element array')
  }
  const info = parseTeamInfo(teamArr[0] as unknown[])
  const playersObj = asObj(asObj(asObj(asObj(teamArr[1])['roster'])['0'])['players'])
  const byId = new Map(settings.categories.map(c => [c.statId, c]))
  return { teamKey: info.teamKey, players: parsePlayersCollection(playersObj, byId) }
}

/** Normalize a `league/{key}/players;...` response. */
export function normalizeLeaguePlayers(
  raw: YahooResponse,
  settings: LeagueSeasonSettings,
): ParsedPlayer[] {
  const leagueArr = raw.fantasy_content?.['league']
  if (!Array.isArray(leagueArr) || leagueArr.length < 2) {
    throw new Error('Unexpected players payload: fantasy_content.league is not a 2-element array')
  }
  const playersObj = asObj(asObj(leagueArr[1])['players'])
  const byId = new Map(settings.categories.map(c => [c.statId, c]))
  return parsePlayersCollection(playersObj, byId)
}
