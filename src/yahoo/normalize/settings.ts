/**
 * Normalize a raw Yahoo `league/{key}/settings` response into
 * LeagueSeasonSettings. This is the only code that understands the raw
 * shape; it is deliberately strict — a surprise in Yahoo's payload should
 * fail loudly here, not produce silently-wrong scoring downstream.
 */
import type {
  LeagueSeasonSettings,
  Role,
  StatCategory,
} from '../../domain/stats.js'
import type { YahooResponse } from '../client.js'

type AnyObj = Record<string, unknown>

function asObj(v: unknown): AnyObj {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as AnyObj
  return {}
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

function roleFromPositionType(positionType: unknown, abbr: string): Role {
  if (positionType === 'B') return 'batting'
  if (positionType === 'P') return 'pitching'
  throw new Error(
    `Stat "${abbr}": unexpected position_type ${JSON.stringify(positionType)} — cannot assign role`,
  )
}

export function normalizeSettings(
  raw: YahooResponse,
  leagueId: string,
): LeagueSeasonSettings {
  const leagueArr = raw.fantasy_content?.['league']
  if (!Array.isArray(leagueArr) || leagueArr.length < 2) {
    throw new Error('Unexpected settings payload: fantasy_content.league is not a 2-element array')
  }

  const meta = asObj(leagueArr[0])
  const settingsList = asObj(leagueArr[1])['settings']
  if (!Array.isArray(settingsList) || settingsList.length === 0) {
    throw new Error('Unexpected settings payload: league[1].settings missing')
  }
  const settings = asObj(settingsList[0])

  const statsWrapper = asObj(settings['stat_categories'])['stats']
  if (!Array.isArray(statsWrapper) || statsWrapper.length === 0) {
    throw new Error('Unexpected settings payload: stat_categories.stats missing or empty')
  }

  const categories: StatCategory[] = statsWrapper.map(entry => {
    const stat = asObj(asObj(entry)['stat'])
    const statId = num(stat['stat_id'])
    const abbr = String(stat['display_name'] ?? '')
    const name = String(stat['name'] ?? abbr)
    if (statId === null || !abbr) {
      throw new Error(`Stat entry missing stat_id or display_name: ${JSON.stringify(stat).slice(0, 200)}`)
    }
    const sortOrder = String(stat['sort_order'] ?? '')
    if (sortOrder !== '0' && sortOrder !== '1') {
      throw new Error(`Stat "${abbr}" (${statId}): unexpected sort_order ${JSON.stringify(stat['sort_order'])}`)
    }
    return {
      statId,
      role: roleFromPositionType(stat['position_type'], abbr),
      abbr,
      name,
      // Yahoo sort_order: '1' = higher is better, '0' = lower is better.
      higherIsBetter: sortOrder === '1',
      isDisplayOnly: String(stat['is_only_display_stat'] ?? '0') === '1',
    }
  })

  const season = String(meta['season'] ?? '')
  const leagueKey = String(meta['league_key'] ?? '')
  if (!season || !leagueKey) {
    throw new Error('Unexpected settings payload: league meta missing season or league_key')
  }

  return {
    leagueKey,
    leagueId,
    season,
    name: String(meta['name'] ?? ''),
    numTeams: num(meta['num_teams']) ?? 0,
    scoringType: String(meta['scoring_type'] ?? ''),
    draftType: String(settings['is_auction_draft'] ?? '0') === '1' ? 'auction' : 'snake',
    currentWeek: num(meta['current_week']),
    startWeek: num(meta['start_week']),
    endWeek: num(meta['end_week']),
    categories,
  }
}
